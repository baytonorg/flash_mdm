import type { Context } from '@netlify/functions';
import { query, queryOne } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { requireEnvironmentAccessScopeForPermission } from './_lib/rbac.js';
import { jsonResponse, errorResponse, getSearchParams } from './_lib/helpers.js';

export default async (request: Request, context: Context) => {
  try {
    if (request.method !== 'GET') {
      return errorResponse('Method not allowed', 405);
    }

    const auth = await requireAuth(request);
    const params = getSearchParams(request);

    const environmentId = params.get('environment_id');
    if (!environmentId) return errorResponse('environment_id is required');

    const envScope = await requireEnvironmentAccessScopeForPermission(auth, environmentId, 'read');
    const scopedGroupIds = envScope.mode === 'group' ? (envScope.accessible_group_ids ?? []) : null;

    if (envScope.mode === 'group' && scopedGroupIds.length === 0) {
      return jsonResponse({
        device_count: 0,
        compliance_rate: 0,
        devices_by_state: {},
        devices_by_ownership: {},
        devices_by_management_mode: {},
        devices_by_manufacturer: {},
        devices_by_os_version: {},
        devices_by_security_patch: {},
        policy_count: 0,
        enrollment_token_count: 0,
        enrollment_trend: [],
        recent_events: [],
        total_devices: 0,
        compliance: { compliant: 0, non_compliant: 0, rate: 0 },
      });
    }

    const deviceScopeClause = envScope.mode === 'group' ? ' AND group_id = ANY($2::uuid[])' : '';
    const deviceScopeParams = envScope.mode === 'group'
      ? [environmentId, scopedGroupIds]
      : [environmentId];

    // Run all queries in parallel for performance
    const [
      devicesByState,
      devicesByOwnership,
      devicesByManagementMode,
      devicesByManufacturer,
      devicesByOsVersion,
      devicesBySecurityPatch,
      policyCount,
      enrollmentTokenCount,
      complianceStats,
      enrollmentTrend,
      recentEvents,
      totalDevices,
    ] = await Promise.all([
    // Devices by state
    query<{ state: string; count: string }>(
      `SELECT state, COUNT(*) as count
       FROM devices
       WHERE environment_id = $1 AND deleted_at IS NULL${deviceScopeClause}
       GROUP BY state
       ORDER BY count DESC`,
      deviceScopeParams
    ),

    // Devices by ownership
    query<{ ownership: string; count: string }>(
      `SELECT COALESCE(ownership, 'UNKNOWN') as ownership, COUNT(*) as count
       FROM devices
       WHERE environment_id = $1 AND deleted_at IS NULL${deviceScopeClause}
       GROUP BY ownership
       ORDER BY count DESC`,
      deviceScopeParams
    ),

    // Devices by management mode
    query<{ management_mode: string; count: string }>(
      `SELECT COALESCE(management_mode, 'UNKNOWN') as management_mode, COUNT(*) as count
       FROM devices
       WHERE environment_id = $1 AND deleted_at IS NULL${deviceScopeClause}
       GROUP BY management_mode
       ORDER BY count DESC`,
      deviceScopeParams
    ),

    // Devices by manufacturer
    query<{ manufacturer: string; count: string }>(
      `SELECT COALESCE(manufacturer, 'Unknown') as manufacturer, COUNT(*) as count
       FROM devices
       WHERE environment_id = $1 AND deleted_at IS NULL${deviceScopeClause}
       GROUP BY manufacturer
       ORDER BY count DESC
       LIMIT 10`,
      deviceScopeParams
    ),

    // Devices by OS version
    query<{ os_version: string; count: string }>(
      `SELECT COALESCE(os_version, 'Unknown') as os_version, COUNT(*) as count
       FROM devices
       WHERE environment_id = $1 AND deleted_at IS NULL${deviceScopeClause}
       GROUP BY os_version
       ORDER BY count DESC
       LIMIT 10`,
      deviceScopeParams
    ),

    // Devices by security patch level
    query<{ security_patch_level: string; count: string }>(
      `SELECT COALESCE(security_patch_level, 'Unknown') as security_patch_level, COUNT(*) as count
       FROM devices
       WHERE environment_id = $1 AND deleted_at IS NULL${deviceScopeClause}
       GROUP BY security_patch_level
       ORDER BY count DESC
       LIMIT 10`,
      deviceScopeParams
    ),

    // Policy count
    envScope.mode === 'group'
      ? Promise.resolve({ count: '0' } as { count: string })
      : queryOne<{ count: string }>(
          `SELECT COUNT(*) as count FROM policies
           WHERE environment_id = $1`,
          [environmentId]
        ),

    // Enrollment token count
    envScope.mode === 'group'
      ? Promise.resolve({ count: '0' } as { count: string })
      : queryOne<{ count: string }>(
          `SELECT COUNT(*) as count FROM enrollment_tokens
           WHERE environment_id = $1 AND expires_at > now()`,
          [environmentId]
        ),

    // Compliance rate
    query<{ compliant: boolean; count: string }>(
      `SELECT policy_compliant as compliant, COUNT(*) as count
       FROM devices
       WHERE environment_id = $1 AND deleted_at IS NULL AND state = 'ACTIVE'${deviceScopeClause}
       GROUP BY policy_compliant`,
      deviceScopeParams
    ),

    // Enrollment trend (last 30 days)
    query<{ date: string; count: string }>(
      `SELECT DATE(enrollment_time) as date, COUNT(*) as count
       FROM devices
       WHERE environment_id = $1
         AND deleted_at IS NULL
         ${envScope.mode === 'group' ? 'AND group_id = ANY($2::uuid[])' : ''}
         AND enrollment_time >= now() - interval '30 days'
       GROUP BY DATE(enrollment_time)
       ORDER BY date`,
      deviceScopeParams
    ),

    // Recent audit log events
    envScope.mode === 'group'
      ? query(
          `SELECT a.id, a.user_id, a.action, a.resource_type, a.resource_id, a.details, a.created_at
           FROM audit_log a
           JOIN devices d ON d.id = a.device_id
           WHERE a.environment_id = $1
             AND d.deleted_at IS NULL
             AND d.group_id = ANY($2::uuid[])
           ORDER BY a.created_at DESC
           LIMIT 10`,
          [environmentId, scopedGroupIds]
        )
      : query(
          `SELECT id, user_id, action, resource_type, resource_id, details, created_at
           FROM audit_log
           WHERE environment_id = $1
           ORDER BY created_at DESC
           LIMIT 10`,
          [environmentId]
        ),

    // Total devices
    queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM devices
       WHERE environment_id = $1 AND deleted_at IS NULL${deviceScopeClause}`,
      deviceScopeParams
    ),
    ]);

    // Calculate compliance rate
    const compliantCount = parseInt(
      complianceStats.find((r) => r.compliant === true)?.count ?? '0',
      10
    );
    const nonCompliantCount = parseInt(
      complianceStats.find((r) => r.compliant === false)?.count ?? '0',
      10
    );
    const activeDevices = compliantCount + nonCompliantCount;
    const complianceRate = activeDevices > 0
      ? Math.round((compliantCount / activeDevices) * 10000) / 100
      : 0;

    const devicesByStateMap = Object.fromEntries(
      devicesByState.map((r) => [r.state ?? 'UNKNOWN', parseInt(r.count, 10)])
    );
    const devicesByOwnershipMap = Object.fromEntries(
      devicesByOwnership.map((r) => [r.ownership, parseInt(r.count, 10)])
    );
    const devicesByManagementModeMap = Object.fromEntries(
      devicesByManagementMode.map((r) => [r.management_mode, parseInt(r.count, 10)])
    );
    const devicesByManufacturerMap = Object.fromEntries(
      devicesByManufacturer.map((r) => [r.manufacturer, parseInt(r.count, 10)])
    );
    const devicesByOsVersionMap = Object.fromEntries(
      devicesByOsVersion.map((r) => [r.os_version, parseInt(r.count, 10)])
    );
    const devicesBySecurityPatchMap = Object.fromEntries(
      devicesBySecurityPatch.map((r) => [r.security_patch_level, parseInt(r.count, 10)])
    );
    const enrollmentTrendRows = enrollmentTrend.map((r) => ({
      date: r.date,
      count: parseInt(r.count, 10),
    }));
    const totalDeviceCount = parseInt(totalDevices?.count ?? '0', 10);

    return jsonResponse({
      // Primary response shape used by the current dashboard frontend
      device_count: totalDeviceCount,
      compliance_rate: complianceRate,
      devices_by_state: devicesByStateMap,
      devices_by_ownership: devicesByOwnershipMap,
      devices_by_management_mode: devicesByManagementModeMap,
      devices_by_manufacturer: devicesByManufacturerMap,
      devices_by_os_version: devicesByOsVersionMap,
      devices_by_security_patch: devicesBySecurityPatchMap,
      policy_count: parseInt(policyCount?.count ?? '0', 10),
      enrollment_token_count: parseInt(enrollmentTokenCount?.count ?? '0', 10),
      enrollment_trend: enrollmentTrendRows,
      recent_events: recentEvents,

      // Backwards-compatible fields retained for older consumers
      total_devices: totalDeviceCount,
      compliance: {
        compliant: compliantCount,
        non_compliant: nonCompliantCount,
        rate: complianceRate,
      },
    });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('dashboard-data error:', err);
    return errorResponse('Internal server error', 500);
  }
};
