import type { Context } from '@netlify/functions';
import { queryOne, transaction } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { requireEnvironmentPermission } from './_lib/rbac.js';
import { logAudit } from './_lib/audit.js';
import { parseOncDocument, parseApnPolicy, getApnSettingKey } from './_lib/policy-merge.js';
import { jsonResponse, errorResponse, parseJsonBody, getClientIp } from './_lib/helpers.js';
import { syncAffectedPoliciesToAmapi, selectPoliciesForDeploymentScope } from './_lib/deployment-sync.js';

type DeployBody = {
  environment_id: string;
  network_type?: 'wifi' | 'apn';
  name?: string;
  ssid?: string;
  hidden_ssid?: boolean;
  auto_connect?: boolean;
  onc_document?: unknown;
  apn_policy?: unknown;
  scope_type: 'environment' | 'group' | 'device';
  scope_id: string;
};

type PolicyRow = {
  id: string;
  config: Record<string, unknown> | string | null;
  amapi_name: string | null;
};

type NormalizedWifiDeployment = {
  networkType: 'wifi';
  dbKey: string;
  name: string;
  hiddenSsid: boolean;
  autoConnect: boolean;
  storedProfile: Record<string, unknown>;
  summary: {
    ssid: string;
  };
};

type NormalizedApnDeployment = {
  networkType: 'apn';
  dbKey: string;
  name: string;
  hiddenSsid: false;
  autoConnect: true;
  storedProfile: Record<string, unknown>;
  apnPolicy: Record<string, unknown>;
  summary: {
    apn: string;
    apnName: string;
    overrideApns: string;
  };
};

type NormalizedDeployment = NormalizedWifiDeployment | NormalizedApnDeployment;

export default async (request: Request, _context: Context) => {
  try {
    const auth = await requireAuth(request);

  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  const url = new URL(request.url);
  const segments = url.pathname.replace('/api/networks/', '').split('/').filter(Boolean);
  const action = segments[0];
  if (action !== 'deploy') {
    return errorResponse('Not found', 404);
  }

  const body = await parseJsonBody<DeployBody>(request);
  if (!body.environment_id || !body.scope_type || !body.scope_id) {
    return errorResponse('environment_id, scope_type, and scope_id are required');
  }

  const validScopeTypes: Array<DeployBody['scope_type']> = ['environment', 'group', 'device'];
  if (!validScopeTypes.includes(body.scope_type)) {
    return errorResponse(`scope_type must be one of: ${validScopeTypes.join(', ')}`);
  }

  const env = await queryOne<{ id: string; workspace_id: string; enterprise_name: string | null }>(
    'SELECT id, workspace_id, enterprise_name FROM environments WHERE id = $1',
    [body.environment_id]
  );
  if (!env) return errorResponse('Environment not found', 404);
  await requireEnvironmentPermission(auth, body.environment_id, 'write');

  if (body.scope_type === 'environment') {
    if (body.scope_id !== body.environment_id) {
      return errorResponse('For environment scope, scope_id must equal environment_id', 400);
    }
  } else if (body.scope_type === 'group') {
    const group = await queryOne<{ id: string }>(
      'SELECT id FROM groups WHERE id = $1 AND environment_id = $2',
      [body.scope_id, body.environment_id]
    );
    if (!group) return errorResponse('Group not found in environment', 404);
  } else {
    const device = await queryOne<{ id: string }>(
      'SELECT id FROM devices WHERE id = $1 AND environment_id = $2 AND deleted_at IS NULL',
      [body.scope_id, body.environment_id]
    );
    if (!device) return errorResponse('Device not found in environment', 404);
  }

  const networkType: 'wifi' | 'apn' = body.network_type === 'apn' ? 'apn' : 'wifi';
  let normalizedDeployment: NormalizedDeployment;
  try {
    if (networkType === 'apn') {
      normalizedDeployment = normalizeApnDeploymentPolicy(
        body.apn_policy ?? body.onc_document,
        {
          scopeType: body.scope_type,
          scopeId: body.scope_id,
          fallbackName: (body.name ?? '').trim() || undefined,
        }
      );
    } else {
      const normalizedOnc = normalizeOncDeploymentDocument(
        body.onc_document ?? buildOpenWifiOncDocument({
          scopeType: body.scope_type,
          scopeId: body.scope_id,
          ssid: (body.ssid ?? '').trim(),
          name: ((body.name ?? body.ssid ?? '').trim() || (body.ssid ?? '').trim()),
          hiddenSsid: !!body.hidden_ssid,
          autoConnect: body.auto_connect !== false,
        }),
        {
          scopeType: body.scope_type,
          scopeId: body.scope_id,
          fallbackName: (body.name ?? '').trim() || undefined,
        }
      );
      normalizedDeployment = {
        networkType: 'wifi',
        dbKey: normalizedOnc.ssid,
        name: normalizedOnc.name,
        hiddenSsid: normalizedOnc.hiddenSsid,
        autoConnect: normalizedOnc.autoConnect,
        storedProfile: normalizedOnc.document,
        summary: { ssid: normalizedOnc.ssid },
      };
    }
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Invalid network document', 400);
  }

  const deploymentId = crypto.randomUUID();
  const normalizedName = normalizedDeployment.name;

  // ── Step 1: Save deployment row + find affected policies ──────────────────
  const affectedPolicyIds: string[] = [];

  await transaction(async (client) => {
    await client.query<{ id: string }>(
      `INSERT INTO network_deployments (
         id, environment_id, network_type, name, ssid, hidden_ssid, auto_connect, scope_type, scope_id, onc_profile
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (environment_id, network_type, ssid, scope_type, scope_id)
       DO UPDATE SET
         name = EXCLUDED.name,
         network_type = EXCLUDED.network_type,
         hidden_ssid = EXCLUDED.hidden_ssid,
         auto_connect = EXCLUDED.auto_connect,
         onc_profile = EXCLUDED.onc_profile,
         updated_at = now()
       RETURNING id`,
      [
        deploymentId,
        body.environment_id,
        networkType,
        normalizedName,
        normalizedDeployment.dbKey,
        normalizedDeployment.hiddenSsid,
        normalizedDeployment.autoConnect,
        body.scope_type,
        body.scope_id,
        JSON.stringify(normalizedDeployment.storedProfile),
      ]
    );

    // Find base policies affected by this scope.
    // We do NOT modify policies.config — buildGeneratedPolicyPayload re-applies
    // all scoped deployments from network_deployments table automatically.
    const policies = await selectPoliciesForDeploymentScope(client, body.environment_id, body.scope_type, body.scope_id);
    for (const row of policies.rows as PolicyRow[]) {
      affectedPolicyIds.push(row.id);
    }
  });

  // ── Step 2: AMAPI sync via derivative infrastructure ────────────────────
  const syncResult = await syncAffectedPoliciesToAmapi(
    affectedPolicyIds,
    body.environment_id,
    body.scope_type,
    body.scope_id,
  );

  const existing = await queryOne<{ id: string; created_at: string; updated_at: string }>(
    `SELECT id, created_at, updated_at
     FROM network_deployments
     WHERE environment_id = $1 AND ssid = $2 AND scope_type = $3 AND scope_id = $4`,
    [body.environment_id, normalizedDeployment.dbKey, body.scope_type, body.scope_id]
  );

  await logAudit({
    environment_id: body.environment_id,
    user_id: auth.user.id,
    action: 'network.deployed',
    resource_type: 'network_deployment',
    resource_id: existing?.id ?? deploymentId,
    details: {
      name: normalizedName,
      network_type: normalizedDeployment.networkType,
      ssid: normalizedDeployment.dbKey,
      scope_type: body.scope_type,
      scope_id: body.scope_id,
      hidden_ssid: normalizedDeployment.hiddenSsid,
      auto_connect: normalizedDeployment.autoConnect,
      ...(normalizedDeployment.networkType === 'wifi'
        ? {
            wifi_ssid: normalizedDeployment.summary.ssid,
          }
        : {
            apn_name: normalizedDeployment.summary.apnName,
            apn_value: normalizedDeployment.summary.apn,
            override_apns: normalizedDeployment.summary.overrideApns,
          }),
      amapi_synced_policies: syncResult.synced,
      amapi_sync_failed_policies: syncResult.failures.map((f) => f.policy_id),
      amapi_sync_skipped_reason: syncResult.skipped_reason,
    },
    ip_address: getClientIp(request),
  });

  const response: Record<string, unknown> = {
    deployment: {
      id: existing?.id ?? deploymentId,
      environment_id: body.environment_id,
      network_type: normalizedDeployment.networkType,
      name: normalizedName,
      ssid: normalizedDeployment.dbKey,
      hidden_ssid: normalizedDeployment.hiddenSsid,
      auto_connect: normalizedDeployment.autoConnect,
      scope_type: body.scope_type,
      scope_id: body.scope_id,
      onc_profile: normalizedDeployment.storedProfile,
    },
    amapi_sync: syncResult,
  };

  if (syncResult.skipped_reason || syncResult.failed > 0) {
    response.message = 'Network deployment saved locally, but one or more AMAPI policy updates failed';
  }

    return jsonResponse(response, 201);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('network-deploy error:', err);
    return errorResponse('Internal server error', 500);
  }
};

function buildOpenWifiProfile(params: {
  scopeType: DeployBody['scope_type'];
  scopeId: string;
  ssid: string;
  name: string;
  hiddenSsid: boolean;
  autoConnect: boolean;
}) {
  return {
    GUID: buildStableWifiGuid(params.scopeType, params.scopeId, params.ssid),
    Name: params.name,
    Type: 'WiFi',
    WiFi: {
      SSID: params.ssid,
      Security: 'None',
      AutoConnect: params.autoConnect,
      HiddenSSID: params.hiddenSsid,
    },
  };
}

function buildOpenWifiOncDocument(params: {
  scopeType: DeployBody['scope_type'];
  scopeId: string;
  ssid: string;
  name: string;
  hiddenSsid: boolean;
  autoConnect: boolean;
}) {
  return {
    Type: 'UnencryptedConfiguration',
    NetworkConfigurations: [buildOpenWifiProfile(params)],
  };
}

function buildStableWifiGuid(scopeType: string, scopeId: string, ssid: string): string {
  const ssidSlug = ssid.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'network';
  return `wifi-${scopeType}-${scopeId.slice(0, 8)}-${ssidSlug}`.slice(0, 128);
}

function normalizeOncDeploymentDocument(
  input: unknown,
  ctx: { scopeType: DeployBody['scope_type']; scopeId: string; fallbackName?: string }
): { document: Record<string, unknown>; ssid: string; name: string; hiddenSsid: boolean; autoConnect: boolean } {
  const doc = parseOncDocument(input);
  const networkConfigs = Array.isArray(doc.NetworkConfigurations) ? [...doc.NetworkConfigurations] : [];
  if (networkConfigs.length !== 1) {
    throw new Error('ONC deployment must contain exactly one NetworkConfigurations entry');
  }

  const net = networkConfigs[0] as any;
  if (!net || typeof net !== 'object' || net.Type !== 'WiFi') {
    throw new Error('The ONC deployment NetworkConfigurations entry must be Type=WiFi');
  }
  const wifi = net.WiFi;
  if (!wifi || typeof wifi !== 'object') {
    throw new Error('WiFi configuration is required');
  }
  const ssid = typeof wifi.SSID === 'string' ? wifi.SSID.trim() : '';
  if (!ssid) throw new Error('WiFi.SSID is required');

  const name =
    (typeof net.Name === 'string' && net.Name.trim()) ||
    ctx.fallbackName ||
    ssid;
  const guid =
    (typeof net.GUID === 'string' && net.GUID.trim()) ||
    buildStableWifiGuid(ctx.scopeType, ctx.scopeId, ssid);

  const normalizedEntry = {
    ...net,
    GUID: guid,
    Name: name,
    Type: 'WiFi',
    WiFi: {
      ...wifi,
      SSID: ssid,
      HiddenSSID: !!wifi.HiddenSSID,
      AutoConnect: wifi.AutoConnect !== false,
    },
  };
  const normalizedDoc: Record<string, unknown> = {
    Type: typeof doc.Type === 'string' ? doc.Type : 'UnencryptedConfiguration',
    ...doc,
    NetworkConfigurations: [normalizedEntry],
  };

  return {
    document: normalizedDoc,
    ssid,
    name,
    hiddenSsid: !!(normalizedEntry as any).WiFi.HiddenSSID,
    autoConnect: (normalizedEntry as any).WiFi.AutoConnect !== false,
  };
}

function normalizeApnDeploymentPolicy(
  input: unknown,
  ctx: { scopeType: DeployBody['scope_type']; scopeId: string; fallbackName?: string }
): NormalizedApnDeployment {
  const raw = (input && typeof input === 'object' && !Array.isArray(input))
    ? (input as Record<string, unknown>)
    : {};
  const apnPolicy = parseApnPolicy(('apnPolicy' in raw ? raw.apnPolicy : raw) ?? {});
  const apnSettings = Array.isArray(apnPolicy.apnSettings) ? apnPolicy.apnSettings : [];
  if (apnSettings.length !== 1) {
    throw new Error('APN deployment must contain exactly one apnSettings entry');
  }

  const normalizedSetting = normalizeApnSetting(apnSettings[0]);
  const overrideApns =
    typeof apnPolicy.overrideApns === 'string' && apnPolicy.overrideApns.trim()
      ? apnPolicy.overrideApns.trim()
      : 'OVERRIDE_APNS_UNSPECIFIED';

  const normalizedApnPolicy: Record<string, unknown> = {
    ...apnPolicy,
    overrideApns,
    apnSettings: [normalizedSetting],
  };

  const apnName = typeof normalizedSetting.displayName === 'string' ? normalizedSetting.displayName : '';
  const apnValue = typeof normalizedSetting.apn === 'string' ? normalizedSetting.apn : '';
  const displayName = (ctx.fallbackName && ctx.fallbackName.trim()) || apnName || apnValue;
  if (!displayName) {
    throw new Error('APN deployment requires a name (profile name or apnSettings[0].name)');
  }

  const dbKey = buildStableApnKey(ctx.scopeType, ctx.scopeId, displayName, apnValue, normalizedSetting.numericOperatorId as string | undefined);

  return {
    networkType: 'apn',
    dbKey,
    name: displayName,
    hiddenSsid: false,
    autoConnect: true,
    storedProfile: {
      kind: 'apnPolicy',
      apnPolicy: normalizedApnPolicy,
    },
    apnPolicy: normalizedApnPolicy,
    summary: {
      apn: apnValue,
      apnName: apnName || displayName,
      overrideApns,
    },
  };
}

function normalizeApnSetting(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('apnSettings[0] must be an object');
  }
  const src = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  // Map to AMAPI ApnSetting field names (accept both legacy and correct names)
  assignTrimmedString(out, 'displayName', src.displayName ?? src.name);
  assignTrimmedString(out, 'apn', src.apn);
  assignTrimmedString(out, 'proxyAddress', src.proxyAddress);
  assignInteger(out, 'proxyPort', src.proxyPort);
  assignTrimmedString(out, 'mmsc', src.mmsc);
  assignTrimmedString(out, 'mmsProxyAddress', src.mmsProxyAddress);
  assignInteger(out, 'mmsProxyPort', src.mmsProxyPort);
  assignTrimmedString(out, 'username', src.username ?? src.user);
  assignTrimmedString(out, 'password', src.password);
  assignTrimmedString(out, 'authType', src.authType ?? src.authenticationType);
  assignEnumArray(out, 'apnTypes', src.apnTypes);
  assignTrimmedString(out, 'protocol', src.protocol);
  assignTrimmedString(out, 'roamingProtocol', src.roamingProtocol);
  assignInteger(out, 'carrierId', src.carrierId);
  assignTrimmedString(out, 'mvnoType', src.mvnoType);
  assignTrimmedString(out, 'numericOperatorId', src.numericOperatorId);
  assignEnumArray(out, 'networkTypes', src.networkTypes);
  assignInteger(out, 'mtuV4', src.mtuV4);
  assignInteger(out, 'mtuV6', src.mtuV6);
  assignTrimmedString(out, 'alwaysOnSetting', src.alwaysOnSetting ?? src.alwaysOn);

  if (typeof out.displayName !== 'string' || !out.displayName) {
    throw new Error('apnSettings[0].displayName (name) is required');
  }
  if (typeof out.apn !== 'string' || !out.apn) {
    throw new Error('apnSettings[0].apn is required');
  }
  if (typeof out.numericOperatorId === 'string' && out.numericOperatorId && !/^\d{5,6}$/.test(out.numericOperatorId)) {
    throw new Error('apnSettings[0].numericOperatorId must be 5 or 6 digits');
  }

  return out;
}

function assignTrimmedString(target: Record<string, unknown>, key: string, value: unknown) {
  if (typeof value !== 'string') return;
  const trimmed = value.trim();
  if (trimmed) target[key] = trimmed;
}

function assignInteger(target: Record<string, unknown>, key: string, value: unknown) {
  if (value === '' || value == null) return;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    throw new Error(`${key} must be a non-negative integer`);
  }
  target[key] = n;
}

function assignEnumArray(target: Record<string, unknown>, key: string, value: unknown) {
  if (!Array.isArray(value)) return;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  if (out.length > 0) target[key] = out;
}

function buildStableApnKey(
  scopeType: string,
  scopeId: string,
  displayName: string,
  apn: string,
  numericOperatorId?: string
): string {
  const slug = (displayName || apn)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'apn';
  const apnSlug = apn
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'default';
  const operator = (numericOperatorId ?? 'any').replace(/[^0-9a-z-]/gi, '').toLowerCase();
  return `apn-${scopeType}-${scopeId.slice(0, 8)}-${slug}-${apnSlug}-${operator}`.slice(0, 255);
}
