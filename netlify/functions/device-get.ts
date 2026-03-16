import type { Context } from '@netlify/functions';
import { queryOne, query, execute } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { requireEnvironmentResourcePermission, requireGroupPermission } from './_lib/rbac.js';
import { amapiCall, getAmapiErrorHttpStatus } from './_lib/amapi.js';
import { logAudit } from './_lib/audit.js';
import { jsonResponse, errorResponse, getClientIp, parseJsonBody, isValidUuid } from './_lib/helpers.js';
import { ensurePreferredDerivativeForDevicePolicy } from './_lib/policy-derivatives.js';
import { deriveDeviceApplicationsFromSnapshot } from './_lib/device-apps.js';

type ScopeType = 'environment' | 'group' | 'device';

type DeviceRow = {
  id: string;
  environment_id: string;
  group_id: string | null;
  policy_id: string | null;
  amapi_name: string;
  snapshot: Record<string, unknown> | string | null;
  [key: string]: unknown;
};

type EffectiveLocalPolicy = {
  policy_id: string;
  policy_name: string;
  source: 'device' | 'device_legacy' | 'group' | 'environment';
  source_id: string;
  source_name: string | null;
};

type GroupAncestor = {
  group_id: string;
  group_name: string;
  depth: number;
};

type DerivativeRow = {
  policy_id: string;
  scope_type: ScopeType;
  scope_id: string;
  amapi_name: string | null;
  payload_hash: string;
  metadata: Record<string, unknown> | string | null;
};

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function resolveScopeName(scopeType: ScopeType, scopeId: string): Promise<string | null> {
  if (scopeType === 'environment') {
    const row = await queryOne<{ name: string }>('SELECT name FROM environments WHERE id = $1', [scopeId]);
    return row?.name ?? null;
  }
  if (scopeType === 'group') {
    const row = await queryOne<{ name: string }>('SELECT name FROM groups WHERE id = $1', [scopeId]);
    return row?.name ?? null;
  }
  const row = await queryOne<{ serial_number: string | null; amapi_name: string }>(
    'SELECT serial_number, amapi_name FROM devices WHERE id = $1',
    [scopeId]
  );
  return row?.serial_number ?? row?.amapi_name ?? null;
}

async function resolvePolicyName(policyId: string): Promise<string | null> {
  const row = await queryOne<{ name: string }>('SELECT name FROM policies WHERE id = $1', [policyId]);
  return row?.name ?? null;
}

async function resolveEffectiveLocalPolicy(device: DeviceRow): Promise<EffectiveLocalPolicy | null> {
  const deviceAssignment = await queryOne<{ policy_id: string }>(
    "SELECT policy_id FROM policy_assignments WHERE scope_type = 'device' AND scope_id = $1",
    [device.id]
  );
  if (deviceAssignment?.policy_id) {
    const policyName = await resolvePolicyName(deviceAssignment.policy_id);
    if (policyName) {
      return {
        policy_id: deviceAssignment.policy_id,
        policy_name: policyName,
        source: 'device',
        source_id: device.id,
        source_name: await resolveScopeName('device', device.id),
      };
    }
  }

  if (device.group_id) {
    const groupAssignment = await queryOne<{ policy_id: string; ancestor_id: string }>(
      `SELECT pa.policy_id, gc.ancestor_id
       FROM group_closures gc
       JOIN policy_assignments pa ON pa.scope_type = 'group' AND pa.scope_id = gc.ancestor_id
       WHERE gc.descendant_id = $1
       ORDER BY gc.depth ASC
       LIMIT 1`,
      [device.group_id]
    );
    if (groupAssignment?.policy_id) {
      const policyName = await resolvePolicyName(groupAssignment.policy_id);
      if (policyName) {
        return {
          policy_id: groupAssignment.policy_id,
          policy_name: policyName,
          source: 'group',
          source_id: groupAssignment.ancestor_id,
          source_name: await resolveScopeName('group', groupAssignment.ancestor_id),
        };
      }
    }
  }

  const envAssignment = await queryOne<{ policy_id: string }>(
    "SELECT policy_id FROM policy_assignments WHERE scope_type = 'environment' AND scope_id = $1",
    [device.environment_id]
  );
  if (envAssignment?.policy_id) {
    const policyName = await resolvePolicyName(envAssignment.policy_id);
    if (policyName) {
      return {
        policy_id: envAssignment.policy_id,
        policy_name: policyName,
        source: 'environment',
        source_id: device.environment_id,
        source_name: await resolveScopeName('environment', device.environment_id),
      };
    }
  }

  if (device.policy_id) {
    const policyName = await resolvePolicyName(device.policy_id);
    if (policyName) {
      return {
        policy_id: device.policy_id,
        policy_name: policyName,
        source: 'device_legacy',
        source_id: device.id,
        source_name: await resolveScopeName('device', device.id),
      };
    }
  }

  return null;
}

async function listGroupAncestors(groupId: string | null): Promise<GroupAncestor[]> {
  if (!groupId) return [];
  return query<GroupAncestor>(
    `SELECT gc.ancestor_id as group_id, g.name as group_name, gc.depth
     FROM group_closures gc
     JOIN groups g ON g.id = gc.ancestor_id
     WHERE gc.descendant_id = $1
     ORDER BY gc.depth ASC`,
    [groupId]
  );
}

async function buildOverrideContributors(device: DeviceRow, groupAncestors: GroupAncestor[]) {
  const groupIds = groupAncestors.map((g) => g.group_id);

  const envAppOverrides = await query<{ package_name: string }>(
    `SELECT package_name
     FROM app_deployments
     WHERE environment_id = $1 AND scope_type = 'environment' AND scope_id = $1::uuid
     ORDER BY package_name`,
    [device.environment_id]
  );
  const envNetworkOverrides = await query<{ name: string; ssid: string }>(
    `SELECT name, ssid
     FROM network_deployments
     WHERE environment_id = $1 AND scope_type = 'environment' AND scope_id = $1::uuid
     ORDER BY name, ssid`,
    [device.environment_id]
  );

  const groupAppRows = groupIds.length > 0
    ? await query<{ group_id: string; group_name: string; depth: number; package_name: string }>(
        `SELECT gc.ancestor_id as group_id, g.name as group_name, gc.depth, ad.package_name
         FROM group_closures gc
         JOIN groups g ON g.id = gc.ancestor_id
         JOIN app_deployments ad ON ad.scope_type = 'group' AND ad.scope_id = gc.ancestor_id
         WHERE gc.descendant_id = $1 AND ad.environment_id = $2
         ORDER BY gc.depth ASC, ad.package_name`,
        [device.group_id, device.environment_id]
      )
    : [];
  const groupNetworkRows = groupIds.length > 0
    ? await query<{ group_id: string; group_name: string; depth: number; name: string; ssid: string }>(
        `SELECT gc.ancestor_id as group_id, g.name as group_name, gc.depth, nd.name, nd.ssid
         FROM group_closures gc
         JOIN groups g ON g.id = gc.ancestor_id
         JOIN network_deployments nd ON nd.scope_type = 'group' AND nd.scope_id = gc.ancestor_id
         WHERE gc.descendant_id = $1 AND nd.environment_id = $2
         ORDER BY gc.depth ASC, nd.name, nd.ssid`,
        [device.group_id, device.environment_id]
      )
    : [];

  const deviceAppOverrides = await query<{ package_name: string }>(
    `SELECT package_name
     FROM app_deployments
     WHERE environment_id = $1 AND scope_type = 'device' AND scope_id = $2
     ORDER BY package_name`,
    [device.environment_id, device.id]
  );
  const deviceNetworkOverrides = await query<{ name: string; ssid: string }>(
    `SELECT name, ssid
     FROM network_deployments
     WHERE environment_id = $1 AND scope_type = 'device' AND scope_id = $2
     ORDER BY name, ssid`,
    [device.environment_id, device.id]
  );

  const groupOverrideMap = new Map<string, { group_id: string; group_name: string; depth: number; apps: string[]; networks: string[] }>();
  for (const g of groupAncestors) {
    groupOverrideMap.set(g.group_id, { ...g, apps: [], networks: [] });
  }
  for (const row of groupAppRows) {
    const entry = groupOverrideMap.get(row.group_id);
    if (entry && !entry.apps.includes(row.package_name)) entry.apps.push(row.package_name);
  }
  for (const row of groupNetworkRows) {
    const entry = groupOverrideMap.get(row.group_id);
    const label = row.name || row.ssid;
    if (entry && label && !entry.networks.includes(label)) entry.networks.push(label);
  }

  return {
    environment: {
      apps: envAppOverrides.map((a) => a.package_name),
      networks: envNetworkOverrides.map((n) => n.name || n.ssid),
    },
    groups: [...groupOverrideMap.values()]
      .filter((g) => g.apps.length > 0 || g.networks.length > 0)
      .sort((a, b) => a.depth - b.depth),
    device: {
      apps: deviceAppOverrides.map((a) => a.package_name),
      networks: deviceNetworkOverrides.map((n) => n.name || n.ssid),
    },
  };
}

function summarizeDerivativeRow(row: DerivativeRow | null, scopeNames: Record<string, string | null>) {
  if (!row || !row.amapi_name) return null;
  const metadata = parseJsonObject(row.metadata);
  const generationHash =
    typeof metadata.generation_hash === 'string' && metadata.generation_hash.trim()
      ? metadata.generation_hash.trim()
      : null;
  return {
    policy_id: row.policy_id,
    scope_type: row.scope_type,
    scope_id: row.scope_id,
    scope_name: scopeNames[`${row.scope_type}:${row.scope_id}`] ?? null,
    amapi_name: row.amapi_name,
    payload_hash: row.payload_hash,
    generation_hash: generationHash,
    metadata,
  };
}

async function buildPolicyResolution(device: DeviceRow) {
  const snapshot = parseJsonObject(device.snapshot);
  const appliedAmapiPolicyName =
    typeof snapshot.appliedPolicyName === 'string' && snapshot.appliedPolicyName.trim()
      ? snapshot.appliedPolicyName.trim()
      : null;

  const groupAncestors = await listGroupAncestors(device.group_id);
  const overrides = await buildOverrideContributors(device, groupAncestors);
  const effective = await resolveEffectiveLocalPolicy(device);
  if (!effective) {
    return {
      base_policy: null,
      amapi: {
        applied_policy_name: appliedAmapiPolicyName,
        expected_policy_name: null,
        matches_expected: appliedAmapiPolicyName == null ? null : false,
        selection_reason_code: null,
        selection_reason_details: null,
        device_derivative_required: null,
        device_derivative_redundant: null,
        source_scope: null,
      },
      expected_derivative: null,
      applied_derivative: null,
      overrides: {
        ...overrides,
        device_scoped_variables: [],
        requires_per_device_derivative: false,
      },
    };
  }

  const groupIds = groupAncestors.map((g) => g.group_id);
  const derivativeRows: DerivativeRow[] = [];

  const envDerivative = await queryOne<DerivativeRow>(
    `SELECT policy_id, scope_type, scope_id, amapi_name, payload_hash, metadata
     FROM policy_derivatives
     WHERE policy_id = $1 AND scope_type = 'environment' AND scope_id = $2`,
    [effective.policy_id, device.environment_id]
  );
  if (envDerivative) derivativeRows.push(envDerivative);

  if (groupIds.length > 0) {
    const groupDerivatives = await query<DerivativeRow>(
      `SELECT policy_id, scope_type, scope_id, amapi_name, payload_hash, metadata
       FROM policy_derivatives
       WHERE policy_id = $1
         AND scope_type = 'group'
         AND scope_id = ANY($2::uuid[])`,
      [effective.policy_id, groupIds]
    );
    derivativeRows.push(...groupDerivatives);
  }

  const deviceDerivative = await queryOne<DerivativeRow>(
    `SELECT policy_id, scope_type, scope_id, amapi_name, payload_hash, metadata
     FROM policy_derivatives
     WHERE policy_id = $1 AND scope_type = 'device' AND scope_id = $2`,
    [effective.policy_id, device.id]
  );
  if (deviceDerivative) derivativeRows.push(deviceDerivative);

  // Use the same payload-diff-aware derivative selection path as runtime assignment.
  // This may generate/backfill the expected derivative row on demand so diagnostics
  // reflect the actual derivative the server would assign.
  let expectedRow: DerivativeRow | null = null;
  let selectionReasonCode: string | null = null;
  let selectionReasonDetails: Record<string, unknown> | null = null;
  let deviceDerivativeRequired: boolean | null = null;
  let deviceDerivativeRedundant: boolean | null = null;
  let sourceScope: { scope_type: 'environment' | 'group' | 'device'; scope_id: string } | null = null;
  try {
    const preferred = await ensurePreferredDerivativeForDevicePolicy({
      policyId: effective.policy_id,
      environmentId: device.environment_id,
      deviceId: device.id,
    });
    selectionReasonCode = preferred.reason_code;
    selectionReasonDetails = preferred.reason_details ?? null;
    deviceDerivativeRequired = preferred.device_derivative_required;
    deviceDerivativeRedundant = preferred.device_derivative_redundant;
    sourceScope = preferred.source_scope;
    if (preferred.derivative?.amapi_name) {
      expectedRow =
        derivativeRows.find((r) => r.amapi_name === preferred.derivative.amapi_name)
        ?? await queryOne<DerivativeRow>(
          `SELECT policy_id, scope_type, scope_id, amapi_name, payload_hash, metadata
           FROM policy_derivatives
           WHERE policy_id = $1 AND amapi_name = $2
           LIMIT 1`,
          [effective.policy_id, preferred.derivative.amapi_name]
        )
        ?? null;
      if (expectedRow && !derivativeRows.some((r) => r.amapi_name === expectedRow?.amapi_name)) {
        derivativeRows.push(expectedRow);
      }
    }
  } catch (err) {
    console.warn('device-get: expected derivative resolution failed (non-fatal)', {
      device_id: device.id,
      policy_id: effective.policy_id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  let appliedRow = appliedAmapiPolicyName
    ? derivativeRows.find((r) => r.amapi_name === appliedAmapiPolicyName) ?? null
    : null;
  if (!appliedRow && appliedAmapiPolicyName) {
    // M4 fix: scope to the effective policy to avoid matching a derivative from a different/old policy
    appliedRow = await queryOne<DerivativeRow>(
      `SELECT policy_id, scope_type, scope_id, amapi_name, payload_hash, metadata
       FROM policy_derivatives
       WHERE amapi_name = $1 AND policy_id = $2
       LIMIT 1`,
      [appliedAmapiPolicyName, effective.policy_id]
    );
  }

  const scopeNames: Record<string, string | null> = {
    [`environment:${device.environment_id}`]: await resolveScopeName('environment', device.environment_id),
    [`device:${device.id}`]: await resolveScopeName('device', device.id),
  };
  for (const g of groupAncestors) {
    scopeNames[`group:${g.group_id}`] = g.group_name;
  }
  if (appliedRow && !( `${appliedRow.scope_type}:${appliedRow.scope_id}` in scopeNames)) {
    scopeNames[`${appliedRow.scope_type}:${appliedRow.scope_id}`] = await resolveScopeName(appliedRow.scope_type, appliedRow.scope_id);
  }

  const expectedMetadata = parseJsonObject(expectedRow?.metadata ?? null);
  const deviceScopedVariables = Array.isArray(expectedMetadata.device_scoped_variables)
    ? expectedMetadata.device_scoped_variables.filter((v): v is string => typeof v === 'string')
    : [];

  const expectedDerivative = summarizeDerivativeRow(expectedRow, scopeNames);
  const appliedDerivative = summarizeDerivativeRow(appliedRow, scopeNames);
  const expectedGenerationHash = expectedDerivative?.generation_hash ?? null;
  const appliedGenerationHash = appliedDerivative?.generation_hash ?? null;

  return {
    base_policy: {
      policy_id: effective.policy_id,
      policy_name: effective.policy_name,
      source: effective.source,
      source_id: effective.source_id,
      source_name: effective.source_name,
    },
    amapi: {
      applied_policy_name: appliedAmapiPolicyName,
      expected_policy_name: expectedDerivative?.amapi_name ?? null,
      applied_generation_hash: appliedGenerationHash,
      expected_generation_hash: expectedGenerationHash,
      matches_expected:
        appliedAmapiPolicyName == null || expectedDerivative == null
          ? null
          : appliedAmapiPolicyName === expectedDerivative.amapi_name,
      generation_hash_matches_expected:
        expectedDerivative == null
          ? null
          : (appliedDerivative == null ? false : appliedGenerationHash === expectedGenerationHash),
      selection_reason_code: selectionReasonCode,
      selection_reason_details: selectionReasonDetails,
      device_derivative_required: deviceDerivativeRequired,
      device_derivative_redundant: deviceDerivativeRedundant,
      source_scope: sourceScope,
    },
    expected_derivative: expectedDerivative,
    applied_derivative: appliedDerivative,
    overrides: {
      ...overrides,
      device_scoped_variables: deviceScopedVariables,
      requires_per_device_derivative: expectedMetadata.requires_per_device_derivative === true,
    },
  };
}

export default async (request: Request, context: Context) => {
  try {
    if (request.method !== 'GET' && request.method !== 'DELETE' && request.method !== 'POST' && request.method !== 'PUT') {
      return errorResponse('Method not allowed', 405);
    }

    const auth = await requireAuth(request);
    const url = new URL(request.url);
    const deviceId = url.pathname.split('/').pop();

    if (!deviceId) return errorResponse('Device ID is required');
    if (!isValidUuid(deviceId)) return errorResponse('device_id must be a valid UUID');

  // ── DELETE ────────────────────────────────────────────────────────
  if (request.method === 'DELETE') {
    const device = await queryOne<{
      id: string; amapi_name: string; environment_id: string;
    }>(
      'SELECT id, amapi_name, environment_id FROM devices WHERE id = $1 AND deleted_at IS NULL',
      [deviceId]
    );

    if (!device) return errorResponse('Device not found', 404);
    await requireEnvironmentResourcePermission(auth, device.environment_id, 'device', 'delete');

    // Look up workspace context for the AMAPI call
    const env = await queryOne<{ workspace_id: string; enterprise_name: string }>(
      'SELECT workspace_id, enterprise_name FROM environments WHERE id = $1',
      [device.environment_id]
    );
    const workspace = env?.workspace_id
      ? await queryOne<{ gcp_project_id: string }>(
          'SELECT gcp_project_id FROM workspaces WHERE id = $1',
          [env.workspace_id]
        )
      : null;

    // Call AMAPI devices.delete (triggers remote wipe attempt)
    if (env?.enterprise_name && workspace?.gcp_project_id) {
      try {
        await amapiCall(device.amapi_name, env.workspace_id, {
          method: 'DELETE',
          projectId: workspace.gcp_project_id,
          enterpriseName: env.enterprise_name,
          resourceType: 'devices',
          resourceId: device.amapi_name.split('/').pop(),
        });
      } catch (err) {
        // 404 = device already removed from AMAPI — continue with local cleanup
        const status = getAmapiErrorHttpStatus(err);
        if (status !== 404) {
          console.error('AMAPI device delete failed:', err instanceof Error ? err.message : String(err));
          return errorResponse('Failed to delete device from AMAPI. Please try again.', 502);
        }
      }
    }

    // Soft-delete locally + clean up device-scoped records
    await execute(
      'UPDATE devices SET deleted_at = now(), updated_at = now() WHERE id = $1',
      [device.id]
    );
    await execute("DELETE FROM app_deployments WHERE scope_type = 'device' AND scope_id = $1", [device.id]);
    await execute("DELETE FROM network_deployments WHERE scope_type = 'device' AND scope_id = $1", [device.id]);
    await execute("DELETE FROM policy_assignments WHERE scope_type = 'device' AND scope_id = $1", [device.id]);
    await execute("DELETE FROM policy_derivatives WHERE scope_type = 'device' AND scope_id = $1", [device.id]);

    await logAudit({
      workspace_id: env?.workspace_id,
      environment_id: device.environment_id,
      user_id: auth.user.id,
      device_id: device.id,
      action: 'device.deleted',
      resource_type: 'device',
      resource_id: device.id,
      details: { amapi_name: device.amapi_name },
      ip_address: getClientIp(request),
    });

    return jsonResponse({ message: 'Device deleted' });
  }

  // ── PUT (update device name or group) ────────────────────────────
  if (request.method === 'PUT') {
    const device = await queryOne<{ id: string; environment_id: string; group_id: string | null }>(
      'SELECT id, environment_id, group_id FROM devices WHERE id = $1 AND deleted_at IS NULL',
      [deviceId]
    );
    if (!device) return errorResponse('Device not found', 404);
    await requireEnvironmentResourcePermission(auth, device.environment_id, 'device', 'write');

    const body = await parseJsonBody<{ name?: string; group_id?: string | null }>(request);

    // Handle group_id update
    if ('group_id' in body) {
      const newGroupId = body.group_id || null;
      if (newGroupId && !isValidUuid(newGroupId)) {
        return errorResponse('group_id must be a valid UUID');
      }

      // Validate the target group exists and belongs to the same environment
      if (newGroupId) {
        const targetGroup = await queryOne<{ id: string }>(
          'SELECT id FROM groups WHERE id = $1 AND environment_id = $2',
          [newGroupId, device.environment_id]
        );
        if (!targetGroup) return errorResponse('Group not found in this environment', 404);
      }

      await execute(
        'UPDATE devices SET group_id = $1, updated_at = now() WHERE id = $2',
        [newGroupId, device.id]
      );

      await logAudit({
        user_id: auth.user.id,
        session_id: auth.sessionId,
        environment_id: device.environment_id,
        action: 'device.group_changed',
        resource_type: 'device',
        resource_id: device.id,
        details: { previous_group_id: device.group_id, new_group_id: newGroupId },
        ip_address: getClientIp(request),
      });

      return jsonResponse({ message: 'Device group updated', group_id: newGroupId });
    }

    // Handle name update
    if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
      return errorResponse('name is required', 400);
    }

    await execute(
      'UPDATE devices SET name = $1, updated_at = now() WHERE id = $2',
      [body.name.trim(), device.id]
    );

    await logAudit({
      user_id: auth.user.id,
      session_id: auth.sessionId,
      environment_id: device.environment_id,
      action: 'device.renamed',
      resource_type: 'device',
      resource_id: device.id,
      details: { name: body.name.trim() },
      ip_address: getClientIp(request),
    });

    return jsonResponse({ message: 'Device renamed', name: body.name.trim() });
  }

  // ── POST (refresh from AMAPI) ─────────────────────────────────────
  if (request.method === 'POST') {
    const device = await queryOne<DeviceRow>(
      'SELECT * FROM devices WHERE id = $1 AND deleted_at IS NULL',
      [deviceId]
    );
    if (!device) return errorResponse('Device not found', 404);
    await requireEnvironmentResourcePermission(auth, device.environment_id, 'device', 'read');

    const env = await queryOne<{ workspace_id: string; enterprise_name: string }>(
      'SELECT workspace_id, enterprise_name FROM environments WHERE id = $1',
      [device.environment_id]
    );
    const workspace = env?.workspace_id
      ? await queryOne<{ gcp_project_id: string }>(
          'SELECT gcp_project_id FROM workspaces WHERE id = $1',
          [env.workspace_id]
        )
      : null;

    if (!env?.enterprise_name || !workspace?.gcp_project_id) {
      return errorResponse('Environment not bound to AMAPI', 400);
    }

    const fresh = await amapiCall<Record<string, unknown>>(
      device.amapi_name,
      env.workspace_id,
      {
        projectId: workspace.gcp_project_id,
        enterpriseName: env.enterprise_name,
        resourceType: 'devices',
      }
    );

    if (!fresh) return errorResponse('Device not found in AMAPI', 404);

    const hardwareInfo = (fresh.hardwareInfo as Record<string, unknown>) ?? {};
    const softwareInfo = (fresh.softwareInfo as Record<string, unknown>) ?? {};
    const networkInfo = (fresh.networkInfo as Record<string, unknown>) ?? {};
    const primaryTelephonyInfo =
      (
        (networkInfo.telephonyInfos as Array<Record<string, unknown>> | undefined) ??
        (networkInfo.telephonyInfo as Array<Record<string, unknown>> | undefined)
      )?.[0] ?? null;
    const normalizedImei =
      (networkInfo.imei as string | undefined) ??
      (primaryTelephonyInfo?.imei as string | undefined) ??
      null;

    await execute(
      `UPDATE devices SET
         serial_number = COALESCE($2, serial_number),
         imei = COALESCE($3, imei),
         manufacturer = COALESCE($4, manufacturer),
         model = COALESCE($5, model),
         os_version = COALESCE($6, os_version),
         security_patch_level = COALESCE($7, security_patch_level),
         state = COALESCE($8, state),
         ownership = COALESCE($9, ownership),
         management_mode = COALESCE($10, management_mode),
         policy_compliant = $11,
         last_status_report_at = now(),
         snapshot = $12,
         updated_at = now()
       WHERE id = $1`,
      [
        device.id,
        hardwareInfo.serialNumber ?? null,
        normalizedImei,
        hardwareInfo.manufacturer ?? hardwareInfo.brand ?? null,
        hardwareInfo.model ?? null,
        (softwareInfo.androidVersion as string) ?? null,
        (softwareInfo.securityPatchLevel as string) ?? null,
        (fresh.state as string) ?? null,
        (fresh.ownership as string) ?? null,
        (fresh.managementMode as string) ?? null,
        fresh.policyCompliant === true,
        JSON.stringify(fresh),
      ]
    );

    await logAudit({
      workspace_id: env.workspace_id,
      environment_id: device.environment_id,
      user_id: auth.user.id,
      device_id: device.id,
      action: 'device.refreshed',
      resource_type: 'device',
      resource_id: device.id,
      details: { amapi_name: device.amapi_name },
      ip_address: getClientIp(request),
    });

    return jsonResponse({ message: 'Device refreshed from AMAPI' });
  }

  // ── GET ───────────────────────────────────────────────────────────
  // Fetch full device with related data
  const device = await queryOne<DeviceRow>(
    `SELECT d.*,
            g.name as group_name,
            p.name as policy_name, p.deployment_scenario
     FROM devices d
     LEFT JOIN groups g ON g.id = d.group_id
     LEFT JOIN policies p ON p.id = d.policy_id
     WHERE d.id = $1 AND d.deleted_at IS NULL`,
    [deviceId]
  );

  if (!device) return errorResponse('Device not found', 404);
  try {
    await requireEnvironmentResourcePermission(auth, device.environment_id, 'device', 'read');
  } catch (err) {
    if (!(err instanceof Response)) throw err;
    if (device.group_id) {
      await requireGroupPermission(auth, device.group_id, 'read');
    } else {
      throw err;
    }
  }

  // Fetch installed apps (join with apps table for icon_url)
  let apps = await query(
    `SELECT da.package_name, da.display_name, da.version_name, da.version_code, da.state, da.source,
            a.icon_url
     FROM device_applications da
     LEFT JOIN apps a ON a.package_name = da.package_name AND a.environment_id = $2
     WHERE da.device_id = $1
     ORDER BY da.display_name`,
    [deviceId, device.environment_id]
  );
  if (apps.length === 0) {
    apps = deriveDeviceApplicationsFromSnapshot(device.snapshot);
  }

  // Fetch recent status reports (last 10)
  const statusReports = await query(
    `SELECT id, received_at FROM device_status_reports
     WHERE device_id = $1 ORDER BY received_at DESC LIMIT 10`,
    [deviceId]
  );

  // Fetch recent locations (last 50)
  const locations = await query(
    `SELECT latitude, longitude, accuracy, source, recorded_at
     FROM device_locations WHERE device_id = $1 ORDER BY recorded_at DESC LIMIT 50`,
    [deviceId]
  );

  // Fetch audit log (last 20)
  const auditLog = await query(
    `SELECT a.id, a.action, a.details, a.created_at, u.email as user_email
     FROM audit_log a
     LEFT JOIN users u ON u.id = a.user_id
     WHERE a.device_id = $1
     ORDER BY a.created_at DESC LIMIT 20`,
    [deviceId]
  );

  const policyResolution = await buildPolicyResolution(device);

    return jsonResponse({
      device,
      apps,
      applications: apps,
      status_reports: statusReports,
      locations,
      audit_log: auditLog,
      policy_resolution: policyResolution,
    });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('device-get error:', err instanceof Error ? err.message : String(err));
    return errorResponse('Internal server error', 500);
  }
};
