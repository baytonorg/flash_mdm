import type { Context } from '@netlify/functions';
import { query, queryOne, execute } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { requireEnvironmentResourcePermission } from './_lib/rbac.js';
import { logAudit } from './_lib/audit.js';
import { jsonResponse, errorResponse, parseJsonBody, getClientIp, getSearchParams } from './_lib/helpers.js';
import { validateResolvedWebhookUrlForOutbound } from './_lib/webhook-ssrf.js';

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
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

interface DeviceGeofenceState {
  device_id: string;
  geofence_id: string;
  inside: boolean;
  last_checked_at: string | null;
}

interface CreateGeofenceBody {
  environment_id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  polygon?: Array<{ lat: number; lng: number }> | null;
  scope_type: string;
  scope_id?: string | null;
  action_on_enter?: Record<string, unknown>;
  action_on_exit?: Record<string, unknown>;
  enabled?: boolean;
}

interface UpdateGeofenceBody {
  id: string;
  name?: string;
  latitude?: number;
  longitude?: number;
  radius_meters?: number;
  polygon?: Array<{ lat: number; lng: number }> | null;
  scope_type?: string;
  scope_id?: string | null;
  action_on_enter?: Record<string, unknown>;
  action_on_exit?: Record<string, unknown>;
  enabled?: boolean;
}

async function validateGeofenceScopeForEnvironment(
  environmentId: string,
  scopeType: string,
  scopeId: string | null | undefined
): Promise<string | null> {
  if (scopeType === 'environment') return null;

  if (scopeType !== 'group' && scopeType !== 'device') {
    return 'scope_type must be one of: environment, group, device';
  }

  if (!scopeId) {
    return `scope_id is required when scope_type is ${scopeType}`;
  }

  const table = scopeType === 'group' ? 'groups' : 'devices';
  const record = await queryOne<{ id: string }>(
    `SELECT id FROM ${table} WHERE id = $1 AND environment_id = $2`,
    [scopeId, environmentId]
  );

  if (!record) {
    return `scope_id does not belong to environment ${environmentId}`;
  }

  return null;
}

async function validateGeofenceActionWebhookConfig(
  action: Record<string, unknown> | undefined,
  fieldName: 'action_on_enter' | 'action_on_exit'
): Promise<string | null> {
  if (!action || typeof action !== 'object') return null;
  if (action.type !== 'webhook') return null;
  if (action.url == null) return null;

  const validation = await validateResolvedWebhookUrlForOutbound(action.url);
  if (!validation.ok) {
    return `${fieldName}: ${validation.error}`;
  }

  return null;
}

export default async (request: Request, _context: Context) => {
  try {
    const auth = await requireAuth(request);
    const url = new URL(request.url);
    const segments = url.pathname.replace('/api/geofences/', '').split('/').filter(Boolean);
    const action = segments[0];

  // GET /api/geofences/list?environment_id=...
  if (request.method === 'GET' && action === 'list') {
    const params = getSearchParams(request);
    const environmentId = params.get('environment_id');
    if (!environmentId) return errorResponse('environment_id is required');
    await requireEnvironmentResourcePermission(auth, environmentId, 'geofence', 'read');

    const geofences = await query<Geofence & { devices_inside: string }>(
      `SELECT g.*,
              COALESCE((SELECT COUNT(*) FROM device_geofence_state dgs WHERE dgs.geofence_id = g.id AND dgs.inside = true)::text, '0') as devices_inside
       FROM geofences g
       WHERE g.environment_id = $1
       ORDER BY g.name`,
      [environmentId]
    );

    return jsonResponse({
      geofences: geofences.map((g) => ({
        ...g,
        devices_inside: parseInt(g.devices_inside, 10),
      })),
    });
  }

  // GET /api/geofences/:id (where :id is a UUID)
  if (request.method === 'GET' && action && action !== 'list') {
    const geofenceId = action;

    const geofence = await queryOne<Geofence>(
      'SELECT * FROM geofences WHERE id = $1',
      [geofenceId]
    );

    if (!geofence) return errorResponse('Geofence not found', 404);
    await requireEnvironmentResourcePermission(auth, geofence.environment_id, 'geofence', 'read');

    const deviceStates = await query<DeviceGeofenceState & { device_name: string; serial_number: string | null }>(
      `SELECT dgs.*, d.amapi_name as device_name, d.serial_number
       FROM device_geofence_state dgs
       JOIN devices d ON d.id = dgs.device_id
       WHERE dgs.geofence_id = $1
       ORDER BY dgs.inside DESC, d.amapi_name`,
      [geofenceId]
    );

    return jsonResponse({ geofence, device_states: deviceStates });
  }

  // POST /api/geofences/create
  if (request.method === 'POST' && action === 'create') {
    const body = await parseJsonBody<CreateGeofenceBody>(request);

    if (!body.environment_id || !body.name) {
      return errorResponse('environment_id and name are required');
    }
    if (body.latitude == null || body.longitude == null || body.radius_meters == null) {
      return errorResponse('latitude, longitude, and radius_meters are required');
    }
    if (!body.scope_type || !['environment', 'group', 'device'].includes(body.scope_type)) {
      return errorResponse('scope_type must be one of: environment, group, device');
    }
    await requireEnvironmentResourcePermission(auth, body.environment_id, 'geofence', 'write');

    const scopeValidationError = await validateGeofenceScopeForEnvironment(
      body.environment_id,
      body.scope_type,
      body.scope_id ?? null
    );
    if (scopeValidationError) return errorResponse(scopeValidationError);

    const enterWebhookValidationError = await validateGeofenceActionWebhookConfig(body.action_on_enter, 'action_on_enter');
    if (enterWebhookValidationError) return errorResponse(enterWebhookValidationError);
    const exitWebhookValidationError = await validateGeofenceActionWebhookConfig(body.action_on_exit, 'action_on_exit');
    if (exitWebhookValidationError) return errorResponse(exitWebhookValidationError);

    const geofenceId = crypto.randomUUID();

    await execute(
      `INSERT INTO geofences (id, environment_id, name, latitude, longitude, radius_meters, polygon, scope_type, scope_id, action_on_enter, action_on_exit, enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        geofenceId,
        body.environment_id,
        body.name,
        body.latitude,
        body.longitude,
        body.radius_meters,
        body.polygon ? JSON.stringify(body.polygon) : null,
        body.scope_type,
        body.scope_id ?? null,
        JSON.stringify(body.action_on_enter ?? {}),
        JSON.stringify(body.action_on_exit ?? {}),
        body.enabled ?? true,
      ]
    );

    await logAudit({
      environment_id: body.environment_id,
      user_id: auth.user.id,
      action: 'geofence.created',
      resource_type: 'geofence',
      resource_id: geofenceId,
      details: { name: body.name, scope_type: body.scope_type },
      ip_address: getClientIp(request),
    });

    const geofence = await queryOne<Geofence>(
      'SELECT * FROM geofences WHERE id = $1',
      [geofenceId]
    );

    return jsonResponse({ geofence }, 201);
  }

  // PUT /api/geofences/update
  if (request.method === 'PUT' && action === 'update') {
    const body = await parseJsonBody<UpdateGeofenceBody>(request);
    if (!body.id) return errorResponse('Geofence ID is required');

    const geoToUpdate = await queryOne<{ environment_id: string; scope_type: string; scope_id: string | null }>(
      'SELECT environment_id, scope_type, scope_id FROM geofences WHERE id = $1',
      [body.id]
    );
    if (!geoToUpdate) return errorResponse('Geofence not found', 404);
    await requireEnvironmentResourcePermission(auth, geoToUpdate.environment_id, 'geofence', 'write');

    if (body.scope_type !== undefined && !['environment', 'group', 'device'].includes(body.scope_type)) {
      return errorResponse('scope_type must be one of: environment, group, device');
    }

    const effectiveScopeType = body.scope_type ?? geoToUpdate.scope_type;
    const effectiveScopeId = body.scope_id !== undefined ? body.scope_id : geoToUpdate.scope_id;
    const scopeValidationError = await validateGeofenceScopeForEnvironment(
      geoToUpdate.environment_id,
      effectiveScopeType,
      effectiveScopeId
    );
    if (scopeValidationError) return errorResponse(scopeValidationError);

    const enterWebhookValidationError = await validateGeofenceActionWebhookConfig(body.action_on_enter, 'action_on_enter');
    if (enterWebhookValidationError) return errorResponse(enterWebhookValidationError);
    const exitWebhookValidationError = await validateGeofenceActionWebhookConfig(body.action_on_exit, 'action_on_exit');
    if (exitWebhookValidationError) return errorResponse(exitWebhookValidationError);

    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (body.name !== undefined) { updates.push(`name = $${idx++}`); values.push(body.name); }
    if (body.latitude !== undefined) { updates.push(`latitude = $${idx++}`); values.push(body.latitude); }
    if (body.longitude !== undefined) { updates.push(`longitude = $${idx++}`); values.push(body.longitude); }
    if (body.radius_meters !== undefined) { updates.push(`radius_meters = $${idx++}`); values.push(body.radius_meters); }
    if (body.polygon !== undefined) { updates.push(`polygon = $${idx++}`); values.push(body.polygon ? JSON.stringify(body.polygon) : null); }
    if (body.scope_type !== undefined) { updates.push(`scope_type = $${idx++}`); values.push(body.scope_type); }
    if (body.scope_id !== undefined) { updates.push(`scope_id = $${idx++}`); values.push(body.scope_id); }
    if (body.action_on_enter !== undefined) { updates.push(`action_on_enter = $${idx++}`); values.push(JSON.stringify(body.action_on_enter)); }
    if (body.action_on_exit !== undefined) { updates.push(`action_on_exit = $${idx++}`); values.push(JSON.stringify(body.action_on_exit)); }
    if (body.enabled !== undefined) { updates.push(`enabled = $${idx++}`); values.push(body.enabled); }
    updates.push('updated_at = now()');

    if (updates.length === 1) return errorResponse('No fields to update');

    values.push(body.id);
    await execute(`UPDATE geofences SET ${updates.join(', ')} WHERE id = $${idx}`, values);

    await logAudit({
      user_id: auth.user.id,
      action: 'geofence.updated',
      resource_type: 'geofence',
      resource_id: body.id,
      details: { updated_fields: Object.keys(body).filter((k) => k !== 'id') },
      ip_address: getClientIp(request),
    });

    return jsonResponse({ message: 'Geofence updated' });
  }

  // DELETE /api/geofences/:id
  if (request.method === 'DELETE' && action) {
    const geofenceId = action;

    const geoToDelete = await queryOne<{ environment_id: string }>('SELECT environment_id FROM geofences WHERE id = $1', [action]);
    if (!geoToDelete) return errorResponse('Geofence not found', 404);
    await requireEnvironmentResourcePermission(auth, geoToDelete.environment_id, 'geofence', 'delete');

    // Clean up device state records first
    await execute('DELETE FROM device_geofence_state WHERE geofence_id = $1', [geofenceId]);
    const result = await execute('DELETE FROM geofences WHERE id = $1', [geofenceId]);

    if (result.rowCount === 0) return errorResponse('Geofence not found', 404);

    await logAudit({
      user_id: auth.user.id,
      action: 'geofence.deleted',
      resource_type: 'geofence',
      resource_id: geofenceId,
      ip_address: getClientIp(request),
    });

    return jsonResponse({ message: 'Geofence deleted' });
  }

  // POST /api/geofences/:id/toggle
  if (request.method === 'POST' && segments.length === 2 && segments[1] === 'toggle') {
    const geofenceId = segments[0];

    const geofence = await queryOne<Geofence>(
      'SELECT * FROM geofences WHERE id = $1',
      [geofenceId]
    );

    if (!geofence) return errorResponse('Geofence not found', 404);
    await requireEnvironmentResourcePermission(auth, geofence.environment_id, 'geofence', 'write');

    const newEnabled = !geofence.enabled;
    await execute(
      'UPDATE geofences SET enabled = $1, updated_at = now() WHERE id = $2',
      [newEnabled, geofenceId]
    );

    await logAudit({
      user_id: auth.user.id,
      action: newEnabled ? 'geofence.enabled' : 'geofence.disabled',
      resource_type: 'geofence',
      resource_id: geofenceId,
      details: { enabled: newEnabled },
      ip_address: getClientIp(request),
    });

    return jsonResponse({ message: `Geofence ${newEnabled ? 'enabled' : 'disabled'}` });
  }

    return errorResponse('Not found', 404);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('geofence-crud error:', err);
    return errorResponse('Internal server error', 500);
  }
};
