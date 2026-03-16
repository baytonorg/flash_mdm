import type { Context } from '@netlify/functions';
import { query, queryOne, execute } from './_lib/db.js';
import { logAudit } from './_lib/audit.js';
import { isInsideCircle, isInsidePolygon } from './_lib/haversine.js';
import { validateResolvedWebhookUrlForOutbound } from './_lib/webhook-ssrf.js';

export const config = {
  schedule: '*/10 * * * *',
};

interface Geofence {
  id: string;
  environment_id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  polygon: Array<{ lat: number; lng: number }> | null;
  scope_type: string;
  scope_id: string | null;
  action_on_enter: Record<string, unknown>;
  action_on_exit: Record<string, unknown>;
}

interface DeviceLocation {
  device_id: string;
  latitude: number;
  longitude: number;
  group_id: string | null;
}

interface DeviceState {
  device_id: string;
  geofence_id: string;
  inside: boolean;
}

/**
 * Determine if a device is in scope for a geofence based on scope_type and scope_id.
 */
function isDeviceInScope(device: DeviceLocation, geofence: Geofence): boolean {
  switch (geofence.scope_type) {
    case 'environment':
      // All devices in the environment are in scope
      return true;
    case 'group':
      return device.group_id === geofence.scope_id;
    case 'device':
      return device.device_id === geofence.scope_id;
    default:
      return false;
  }
}

/**
 * Check if a device is inside a geofence (circle or polygon).
 */
function isDeviceInsideFence(device: DeviceLocation, geofence: Geofence): boolean {
  // If polygon is defined, use polygon check
  if (geofence.polygon && Array.isArray(geofence.polygon) && geofence.polygon.length >= 3) {
    return isInsidePolygon(device.latitude, device.longitude, geofence.polygon);
  }
  // Otherwise use circle check
  return isInsideCircle(
    device.latitude,
    device.longitude,
    geofence.latitude,
    geofence.longitude,
    geofence.radius_meters
  );
}

/**
 * Execute the configured action when a device enters or exits a geofence.
 */
async function executeGeofenceAction(
  action: Record<string, unknown>,
  deviceId: string,
  geofence: Geofence,
  eventType: 'enter' | 'exit'
): Promise<void> {
  if (!action || Object.keys(action).length === 0) return;

  const actionType = action.type as string | undefined;
  if (!actionType || actionType === 'none') return;

  try {
    switch (actionType) {
      case 'lock':
        // Enqueue a lock command for the device
        await execute(
          `INSERT INTO job_queue (id, environment_id, job_type, payload, status)
           VALUES (gen_random_uuid(), $1, 'device_command', $2, 'pending')`,
          [
            geofence.environment_id,
            JSON.stringify({ device_id: deviceId, command_type: 'LOCK' }),
          ]
        );
        break;

      case 'notification':
        // Enqueue a notification command
        await execute(
          `INSERT INTO job_queue (id, environment_id, job_type, payload, status)
           VALUES (gen_random_uuid(), $1, 'device_command', $2, 'pending')`,
          [
            geofence.environment_id,
            JSON.stringify({
              device_id: deviceId,
              command_type: 'NOTIFICATION',
              params: {
                title: action.title ?? `Geofence ${eventType}`,
                message: action.message ?? `Device ${eventType === 'enter' ? 'entered' : 'exited'} geofence: ${geofence.name}`,
              },
            }),
          ]
        );
        break;

      case 'move_group':
        if (action.target_group_id) {
          const targetGroup = await queryOne<{ id: string }>(
            'SELECT id FROM groups WHERE id = $1 AND environment_id = $2',
            [action.target_group_id, geofence.environment_id]
          );
          if (!targetGroup) {
            console.warn(
              `Skipping geofence move_group for device ${deviceId}: target group is outside environment ${geofence.environment_id}`
            );
            break;
          }
          await execute(
            'UPDATE devices SET group_id = $1, updated_at = now() WHERE id = $2',
            [action.target_group_id, deviceId]
          );
        }
        break;

      case 'webhook':
        // Enqueue a webhook job
        if (action.url) {
          const validation = await validateResolvedWebhookUrlForOutbound(action.url);
          if (!validation.ok) {
            console.warn(
              `Skipping geofence webhook for device ${deviceId}: ${validation.error}`
            );
            break;
          }
          await execute(
            `INSERT INTO job_queue (id, environment_id, job_type, payload, status)
             VALUES (gen_random_uuid(), $1, 'webhook', $2, 'pending')`,
            [
              geofence.environment_id,
              JSON.stringify({
                url: validation.url.toString(),
                method: action.method ?? 'POST',
                body: {
                  event: `geofence.${eventType}`,
                  device_id: deviceId,
                  geofence_id: geofence.id,
                  geofence_name: geofence.name,
                  timestamp: new Date().toISOString(),
                },
              }),
            ]
          );
        }
        break;
    }
  } catch (err) {
    console.error(`Failed to execute geofence action (${actionType}) for device ${deviceId}:`, err);
  }
}

export default async (_request: Request, _context: Context) => {
  console.log('Geofence check started');

  const stats = {
    environments_checked: 0,
    geofences_checked: 0,
    devices_checked: 0,
    state_changes: 0,
    errors: 0,
  };

  try {
    // Find all environments that have at least one enabled geofence
    const environments = await query<{ environment_id: string }>(
      `SELECT DISTINCT environment_id FROM geofences WHERE enabled = true`
    );

    for (const env of environments) {
      stats.environments_checked++;

      try {
        // Fetch all enabled geofences for this environment
        const geofences = await query<Geofence>(
          `SELECT id, environment_id, name, latitude, longitude, radius_meters, polygon,
                  scope_type, scope_id, action_on_enter, action_on_exit
           FROM geofences
           WHERE environment_id = $1 AND enabled = true`,
          [env.environment_id]
        );

        // Fetch latest device locations for this environment
        // Use the most recent location data from the devices table
        const devices = await query<DeviceLocation>(
          `SELECT d.id as device_id, d.group_id,
                  (d.snapshot->'lastStatusReportTime') as last_report,
                  COALESCE(
                    (SELECT dl.latitude FROM device_locations dl WHERE dl.device_id = d.id ORDER BY dl.recorded_at DESC LIMIT 1),
                    (d.snapshot->'location'->>'latitude')::double precision
                  ) as latitude,
                  COALESCE(
                    (SELECT dl.longitude FROM device_locations dl WHERE dl.device_id = d.id ORDER BY dl.recorded_at DESC LIMIT 1),
                    (d.snapshot->'location'->>'longitude')::double precision
                  ) as longitude
           FROM devices d
           WHERE d.environment_id = $1 AND d.state = 'ACTIVE'`,
          [env.environment_id]
        );

        // Filter out devices without location data
        const devicesWithLocation = devices.filter(
          (d) => d.latitude != null && d.longitude != null
        );

        for (const geofence of geofences) {
          stats.geofences_checked++;

          for (const device of devicesWithLocation) {
            // Check if device is in scope for this geofence
            if (!isDeviceInScope(device, geofence)) continue;

            stats.devices_checked++;

            const isInside = isDeviceInsideFence(device, geofence);

            // Get previous state
            const prevState = await queryOne<DeviceState>(
              `SELECT device_id, geofence_id, inside
               FROM device_geofence_state
               WHERE device_id = $1 AND geofence_id = $2`,
              [device.device_id, geofence.id]
            );

            const wasInside = prevState?.inside ?? false;

            // Upsert state
            await execute(
              `INSERT INTO device_geofence_state (device_id, geofence_id, inside, last_checked_at)
               VALUES ($1, $2, $3, now())
               ON CONFLICT (device_id, geofence_id)
               DO UPDATE SET inside = $3, last_checked_at = now()`,
              [device.device_id, geofence.id, isInside]
            );

            // Check for state change
            if (isInside !== wasInside) {
              stats.state_changes++;

              const eventType = isInside ? 'enter' : 'exit';

              // Log audit entry for the state change
              await logAudit({
                environment_id: geofence.environment_id,
                device_id: device.device_id,
                actor_type: 'system',
                visibility_scope: 'privileged',
                action: `geofence.device_${eventType}`,
                resource_type: 'geofence',
                resource_id: geofence.id,
                details: {
                  geofence_name: geofence.name,
                  device_latitude: device.latitude,
                  device_longitude: device.longitude,
                },
              });

              // Execute the configured action
              const actionConfig = isInside
                ? geofence.action_on_enter
                : geofence.action_on_exit;

              await executeGeofenceAction(
                actionConfig,
                device.device_id,
                geofence,
                eventType
              );
            }
          }
        }
      } catch (err) {
        stats.errors++;
        console.error(`Error processing environment ${env.environment_id}:`, err);
      }
    }

    console.log('Geofence check completed:', stats);
  } catch (err) {
    console.error('Geofence check fatal error:', err);
  }
};
