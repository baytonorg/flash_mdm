import type { Context } from '@netlify/functions';
import { queryOne, execute, transaction } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { requireEnvironmentPermission } from './_lib/rbac.js';
import { logAudit } from './_lib/audit.js';
import { parseOncDocument, getApnSettingKey, removeOncDeploymentFromPolicyConfig, removeApnDeploymentFromPolicyConfig } from './_lib/policy-merge.js';
import { jsonResponse, errorResponse, parseJsonBody, getClientIp } from './_lib/helpers.js';
import { syncAffectedPoliciesToAmapi, selectPoliciesForDeploymentScope } from './_lib/deployment-sync.js';

type DeploymentRow = {
  id: string;
  environment_id: string;
  network_type: string;
  name: string;
  ssid: string;
  hidden_ssid: boolean;
  auto_connect: boolean;
  scope_type: 'environment' | 'group' | 'device';
  scope_id: string;
  onc_profile: Record<string, unknown> | string | null;
  created_at: string;
  updated_at: string;
};

type PolicyRow = {
  id: string;
  config: Record<string, unknown> | string | null;
  amapi_name: string | null;
};

type BulkSelection = {
  ids?: string[];
  all_matching?: boolean;
  excluded_ids?: string[];
};

type NetworkBulkBody = {
  environment_id?: string;
  operation?: 'delete';
  selection?: BulkSelection;
};

// ─────────────────────────────────────────────────────────────────────────────

export default async (request: Request, _context: Context) => {
  try {
    const url = new URL(request.url);
    const segments = url.pathname.replace(/^\/api\/networks\/?/, '').split('/').filter(Boolean);
    const resourceId = segments[0];

  if (!resourceId) {
    return errorResponse('Resource ID is required', 400);
  }

  if (request.method === 'POST' && resourceId === 'bulk') {
    return await handleBulk(request);
  }

  if (request.method === 'DELETE') {
    return await handleDelete(request, resourceId);
  }

  if (request.method === 'PUT') {
    return await handleUpdate(request, resourceId);
  }

  if (request.method === 'GET') {
    return await handleGet(request, resourceId);
  }

    return errorResponse('Method not allowed', 405);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('network-crud error:', err);
    return errorResponse('Internal server error', 500);
  }
};

async function handleBulk(request: Request) {
  const auth = await requireAuth(request);
  const body = await parseJsonBody<NetworkBulkBody>(request);
  const operation = body.operation;
  const environmentId = body.environment_id;
  const selection = body.selection;

  if (operation !== 'delete') return errorResponse('operation must be delete', 400);
  if (!environmentId) return errorResponse('environment_id is required', 400);
  if (!selection) return errorResponse('selection is required', 400);
  await requireEnvironmentPermission(auth, environmentId, 'write');

  const excludedIds = Array.from(new Set((selection.excluded_ids ?? []).filter(Boolean)));
  const excludedIdSet = new Set(excludedIds);

  let targetIds: string[] = [];
  if (selection.all_matching) {
    const rows = await queryOne<{ ids: string[] }>(
      'SELECT COALESCE(array_agg(id), ARRAY[]::uuid[])::text[] AS ids FROM network_deployments WHERE environment_id = $1',
      [environmentId]
    );
    targetIds = (rows?.ids ?? []).filter((id) => !excludedIdSet.has(id));
  } else {
    targetIds = Array.from(new Set((selection.ids ?? []).filter(Boolean)));
    if (targetIds.length === 0) return errorResponse('selection.ids must include at least one id', 400);
  }

  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const id of targetIds) {
    try {
      const deployment = await queryOne<{ environment_id: string }>(
        'SELECT environment_id FROM network_deployments WHERE id = $1',
        [id]
      );
      if (!deployment) {
        results.push({ id, ok: false, error: 'Network deployment not found' });
        continue;
      }
      if (deployment.environment_id !== environmentId) {
        results.push({ id, ok: false, error: 'Network deployment is outside selected environment' });
        continue;
      }

      const resp = await handleDelete(request, id);
      if (!resp.ok) {
        let message = `Delete failed (${resp.status})`;
        try {
          const data = await resp.json() as { error?: string };
          if (typeof data?.error === 'string') message = data.error;
        } catch {
          // ignore parse issues
        }
        results.push({ id, ok: false, error: message });
        continue;
      }
      results.push({ id, ok: true });
    } catch (err) {
      results.push({ id, ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  }

  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.length - succeeded;
  return jsonResponse({
    total_targeted: results.length,
    succeeded,
    failed,
    results,
  });
}

// ── GET /:id ─────────────────────────────────────────────────────────────────

async function handleGet(request: Request, deploymentId: string) {
  const auth = await requireAuth(request);

  const deployment = await queryOne<DeploymentRow>(
    'SELECT * FROM network_deployments WHERE id = $1',
    [deploymentId]
  );
  if (!deployment) return errorResponse('Network deployment not found', 404);

  await requireEnvironmentPermission(auth, deployment.environment_id, 'read');

  const profile = typeof deployment.onc_profile === 'string'
    ? JSON.parse(deployment.onc_profile)
    : (deployment.onc_profile ?? {});

  return jsonResponse({
    deployment: {
      id: deployment.id,
      environment_id: deployment.environment_id,
      network_type: deployment.network_type || inferNetworkType(profile),
      name: deployment.name,
      ssid: deployment.ssid,
      hidden_ssid: deployment.hidden_ssid,
      auto_connect: deployment.auto_connect,
      scope_type: deployment.scope_type,
      scope_id: deployment.scope_id,
      onc_profile: profile,
      created_at: deployment.created_at,
      updated_at: deployment.updated_at,
    },
  });
}

// ── DELETE /:id ──────────────────────────────────────────────────────────────

async function handleDelete(request: Request, deploymentId: string) {
  const auth = await requireAuth(request);

  const deployment = await queryOne<DeploymentRow>(
    'SELECT * FROM network_deployments WHERE id = $1',
    [deploymentId]
  );
  if (!deployment) return errorResponse('Network deployment not found', 404);

  await requireEnvironmentPermission(auth, deployment.environment_id, 'write');

  const profile = typeof deployment.onc_profile === 'string'
    ? JSON.parse(deployment.onc_profile)
    : (deployment.onc_profile ?? {});
  const networkType = inferNetworkType(profile);

  // ── Step 1: Delete deployment row + clean policies.config ───────────────
  const affectedPolicyIds: string[] = [];

  await transaction(async (client) => {
    // Find affected policies BEFORE deleting the row
    const policies = await selectPoliciesForDeploymentScope(
      client,
      deployment.environment_id,
      deployment.scope_type,
      deployment.scope_id
    );
    for (const row of policies.rows as PolicyRow[]) {
      affectedPolicyIds.push(row.id);
    }

    // Remove the deleted network entry from each affected policy's stored config
    // so the policy editor UI doesn't show stale references.
    for (const row of policies.rows as PolicyRow[]) {
      const rawConfig = typeof row.config === 'string' ? JSON.parse(row.config) : (row.config ?? {});
      const config = { ...rawConfig };
      let modified = false;

      if (networkType === 'apn') {
        // Build the composite key from the stored APN profile
        const storedProfile = typeof deployment.onc_profile === 'string'
          ? JSON.parse(deployment.onc_profile)
          : (deployment.onc_profile ?? {});
        const apnPolicy = storedProfile.apnPolicy ?? storedProfile;
        const apnSettings = Array.isArray(apnPolicy?.apnSettings) ? apnPolicy.apnSettings : [];
        for (const setting of apnSettings) {
          const key = getApnSettingKey(setting);
          if (key && removeApnDeploymentFromPolicyConfig(config, key)) modified = true;
        }
      } else {
        // WiFi: remove by GUID or SSID
        const storedDoc = parseOncDocument(
          typeof deployment.onc_profile === 'string'
            ? JSON.parse(deployment.onc_profile)
            : deployment.onc_profile
        );
        const networks = Array.isArray(storedDoc.NetworkConfigurations) ? storedDoc.NetworkConfigurations : [];
        for (const net of networks) {
          const guid = (net as any)?.GUID ?? '';
          const ssid = (net as any)?.WiFi?.SSID ?? deployment.ssid;
          if (removeOncDeploymentFromPolicyConfig(config, guid, ssid)) modified = true;
        }
      }

      if (modified) {
        await client.query(
          'UPDATE policies SET config = $1::jsonb, updated_at = now() WHERE id = $2',
          [JSON.stringify(config), row.id]
        );
      }
    }

    // Delete the deployment row — derivative sync will regenerate payloads without it
    await client.query('DELETE FROM network_deployments WHERE id = $1', [deploymentId]);
  });

  // ── Step 2: AMAPI sync via derivative infrastructure ────────────────────
  const syncResult = await syncAffectedPoliciesToAmapi(
    affectedPolicyIds,
    deployment.environment_id,
    deployment.scope_type,
    deployment.scope_id,
  );

  await logAudit({
    user_id: auth.user.id,
    session_id: auth.sessionId,
    environment_id: deployment.environment_id,
    action: 'network.deleted',
    resource_type: 'network_deployment',
    resource_id: deploymentId,
    details: {
      name: deployment.name,
      ssid: deployment.ssid,
      network_type: networkType,
      scope_type: deployment.scope_type,
      scope_id: deployment.scope_id,
    },
    ip_address: getClientIp(request),
  });

  return jsonResponse({
    message: 'Network deployment deleted',
    amapi_sync: syncResult,
  });
}

// ── PUT /:id ─────────────────────────────────────────────────────────────────
// Note: scope_type/scope_id are not updatable. To change scope, delete and re-create.
// If scope changes were ever allowed, the OLD scope's policies would also need re-sync
// to remove the network config from those derivatives (H3 design constraint).

async function handleUpdate(request: Request, deploymentId: string) {
  const auth = await requireAuth(request);

  const existing = await queryOne<DeploymentRow>(
    'SELECT * FROM network_deployments WHERE id = $1',
    [deploymentId]
  );
  if (!existing) return errorResponse('Network deployment not found', 404);

  await requireEnvironmentPermission(auth, existing.environment_id, 'write');

  const body = await parseJsonBody<{
    name?: string;
    onc_document?: unknown;
    apn_policy?: unknown;
    hidden_ssid?: boolean;
    auto_connect?: boolean;
  }>(request);

  const existingProfile = typeof existing.onc_profile === 'string'
    ? JSON.parse(existing.onc_profile)
    : (existing.onc_profile ?? {});
  const networkType = inferNetworkType(existingProfile);

  // Determine updated profile
  let updatedProfile: Record<string, unknown>;
  let updatedName = body.name ?? existing.name;
  const updatedHiddenSsid = body.hidden_ssid ?? existing.hidden_ssid;
  const updatedAutoConnect = body.auto_connect ?? existing.auto_connect;

  if (networkType === 'wifi') {
    if (body.onc_document) {
      const doc = parseOncDocument(body.onc_document);
      if (!doc.NetworkConfigurations || doc.NetworkConfigurations.length === 0) {
        return errorResponse('ONC document must contain at least one NetworkConfiguration', 400);
      }
      updatedProfile = doc;
      if (!body.name) {
        const firstNet = doc.NetworkConfigurations[0] as any;
        updatedName = firstNet?.Name ?? firstNet?.WiFi?.SSID ?? existing.name;
      }
    } else {
      updatedProfile = existingProfile;
    }
  } else {
    if (body.apn_policy || body.onc_document) {
      const raw = body.apn_policy ?? body.onc_document;
      if (!raw || typeof raw !== 'object') {
        return errorResponse('APN policy must be an object', 400);
      }
      updatedProfile = raw as Record<string, unknown>;
    } else {
      updatedProfile = existingProfile;
    }
  }

  // ── Step 1: Update deployment row + find affected policies ───────────────
  const affectedPolicyIds: string[] = [];

  await transaction(async (client) => {
    // Update the deployment row
    await client.query(
      `UPDATE network_deployments
       SET name = $1, hidden_ssid = $2, auto_connect = $3, onc_profile = $4, updated_at = now()
       WHERE id = $5`,
      [updatedName, updatedHiddenSsid, updatedAutoConnect, JSON.stringify(updatedProfile), deploymentId]
    );

    // Find affected base policies — we do NOT modify policies.config,
    // buildGeneratedPolicyPayload re-applies from network_deployments table.
    const policies = await selectPoliciesForDeploymentScope(
      client,
      existing.environment_id,
      existing.scope_type,
      existing.scope_id
    );
    for (const row of policies.rows as PolicyRow[]) {
      affectedPolicyIds.push(row.id);
    }
  });

  // ── Step 2: AMAPI sync via derivative infrastructure ────────────────────
  const syncResult = await syncAffectedPoliciesToAmapi(
    affectedPolicyIds,
    existing.environment_id,
    existing.scope_type,
    existing.scope_id,
  );

  // Re-fetch for fresh timestamps
  const refreshed = await queryOne<DeploymentRow>(
    'SELECT * FROM network_deployments WHERE id = $1',
    [deploymentId]
  );

  await logAudit({
    user_id: auth.user.id,
    session_id: auth.sessionId,
    environment_id: existing.environment_id,
    action: 'network.updated',
    resource_type: 'network_deployment',
    resource_id: deploymentId,
    details: {
      name: updatedName,
      ssid: existing.ssid,
      network_type: networkType,
      scope_type: existing.scope_type,
      scope_id: existing.scope_id,
    },
    ip_address: getClientIp(request),
  });

  const refreshedProfile = refreshed
    ? (typeof refreshed.onc_profile === 'string'
        ? JSON.parse(refreshed.onc_profile)
        : (refreshed.onc_profile ?? {}))
    : updatedProfile;

  const response: Record<string, unknown> = {
    deployment: {
      id: deploymentId,
      environment_id: existing.environment_id,
      network_type: networkType,
      name: updatedName,
      ssid: existing.ssid,
      hidden_ssid: updatedHiddenSsid,
      auto_connect: updatedAutoConnect,
      scope_type: existing.scope_type,
      scope_id: existing.scope_id,
      onc_profile: refreshedProfile,
      created_at: refreshed?.created_at ?? existing.created_at,
      updated_at: refreshed?.updated_at ?? existing.updated_at,
    },
    amapi_sync: syncResult,
  };

  if (syncResult.failed > 0 || syncResult.skipped_reason) {
    response.message = 'Network deployment updated locally, but one or more AMAPI policy updates failed';
  }

  return jsonResponse(response);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function inferNetworkType(profile: Record<string, unknown>): 'wifi' | 'apn' {
  if (profile.kind === 'apnPolicy' || profile.apnPolicy || profile.apnSettings) return 'apn';
  return 'wifi';
}
