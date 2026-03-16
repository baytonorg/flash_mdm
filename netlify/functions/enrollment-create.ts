import type { Context } from '@netlify/functions';
import { queryOne, execute } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { requireEnvironmentPermission } from './_lib/rbac.js';
import { logAudit } from './_lib/audit.js';
import { amapiCall, getAmapiErrorHttpStatus } from './_lib/amapi.js';
import { jsonResponse, errorResponse, parseJsonBody, getClientIp } from './_lib/helpers.js';
import { assertEnvironmentEnrollmentAllowed } from './_lib/licensing.js';
import {
  normalizeAllowPersonalUsage,
  normalizeOneTimeUse,
  resolveEnrollmentDurationDays,
} from './_lib/enrollment-token-options.js';

interface AmapiEnrollmentToken {
  name: string;
  value?: string;
  qrCode?: string;
  expirationTimestamp?: string;
  policyName?: string;
  oneTimeOnly?: boolean;
  allowPersonalUsage?: string;
  additionalData?: string;
}

export type WifiSecurityType = 'WPA' | 'WEP' | 'NONE';

export interface ProvisioningExtrasInput {
  locale?: string;
  timeZone?: string;
  wifiSsid?: string;
  wifiPassword?: string;
  wifiSecurityType?: WifiSecurityType;
  wifiHidden?: boolean;
  skipEncryption?: boolean;
  skipEducationScreens?: boolean;
  leaveAllSystemAppsEnabled?: boolean;
}

export function normalizeProvisioningExtrasInput(
  input: ProvisioningExtrasInput | null | undefined
): ProvisioningExtrasInput | null {
  if (!input || typeof input !== 'object') return null;
  const extras: ProvisioningExtrasInput = {};
  if (typeof input.locale === 'string' && input.locale.trim()) extras.locale = input.locale.trim();
  if (typeof input.timeZone === 'string' && input.timeZone.trim()) extras.timeZone = input.timeZone.trim();
  if (typeof input.wifiSsid === 'string' && input.wifiSsid.trim()) extras.wifiSsid = input.wifiSsid.trim();
  if (typeof input.wifiPassword === 'string' && input.wifiPassword.trim()) extras.wifiPassword = input.wifiPassword.trim();
  if (input.wifiSecurityType === 'WPA' || input.wifiSecurityType === 'WEP' || input.wifiSecurityType === 'NONE') {
    extras.wifiSecurityType = input.wifiSecurityType;
  }
  if (typeof input.wifiHidden === 'boolean') extras.wifiHidden = input.wifiHidden;
  if (typeof input.skipEncryption === 'boolean') extras.skipEncryption = input.skipEncryption;
  if (typeof input.skipEducationScreens === 'boolean') extras.skipEducationScreens = input.skipEducationScreens;
  if (typeof input.leaveAllSystemAppsEnabled === 'boolean') {
    extras.leaveAllSystemAppsEnabled = input.leaveAllSystemAppsEnabled;
  }
  return Object.keys(extras).length ? extras : null;
}

export function applyProvisioningExtrasToQrPayload(
  rawQrData: string | null | undefined,
  extras: ProvisioningExtrasInput | null | undefined
): string | null {
  if (!rawQrData) return rawQrData ?? null;
  if (!extras) return rawQrData;

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawQrData);
  } catch {
    return rawQrData;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return rawQrData;

  const payload = { ...(parsed as Record<string, unknown>) };
  const locale = (extras.locale ?? '').trim();
  const timeZone = (extras.timeZone ?? '').trim();
  const wifiSsid = (extras.wifiSsid ?? '').trim();
  const wifiPassword = (extras.wifiPassword ?? '').trim();
  const wifiSecurityType = extras.wifiSecurityType ?? 'WPA';

  if (locale) payload['android.app.extra.PROVISIONING_LOCALE'] = locale;
  if (timeZone) payload['android.app.extra.PROVISIONING_TIME_ZONE'] = timeZone;

  if (wifiSsid) {
    payload['android.app.extra.PROVISIONING_WIFI_SSID'] = wifiSsid;
    payload['android.app.extra.PROVISIONING_WIFI_SECURITY_TYPE'] = wifiSecurityType;
    payload['android.app.extra.PROVISIONING_WIFI_HIDDEN'] = Boolean(extras.wifiHidden);
    if (wifiSecurityType !== 'NONE' && wifiPassword) {
      payload['android.app.extra.PROVISIONING_WIFI_PASSWORD'] = wifiPassword;
    } else {
      delete payload['android.app.extra.PROVISIONING_WIFI_PASSWORD'];
    }
  }

  if (extras.skipEncryption) {
    payload['android.app.extra.PROVISIONING_SKIP_ENCRYPTION'] = true;
  }
  if (extras.skipEducationScreens) {
    payload['android.app.extra.PROVISIONING_SKIP_EDUCATION_SCREENS'] = true;
  }
  if (extras.leaveAllSystemAppsEnabled) {
    payload['android.app.extra.PROVISIONING_LEAVE_ALL_SYSTEM_APPS_ENABLED'] = true;
  }

  return JSON.stringify(payload);
}

export default async (request: Request, _context: Context) => {
  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  const auth = await requireAuth(request);

  const body = await parseJsonBody<{
    environment_id: string;
    name?: string;
    group_id?: string;
    one_time_use?: boolean | string | number;
    allow_personal_usage?: string;
    expiry_days?: number;
    duration_days?: number;
    duration?: string | number;
    duration_seconds?: number;
    provisioning_extras?: ProvisioningExtrasInput;
  }>(request);

  if (!body.environment_id) {
    return errorResponse('environment_id is required');
  }

  await requireEnvironmentPermission(auth, body.environment_id, 'write');

  // Resolve environment + workspace context
  const env = await queryOne<{
    id: string;
    enterprise_name: string | null;
    workspace_id: string;
  }>(
    'SELECT id, enterprise_name, workspace_id FROM environments WHERE id = $1',
    [body.environment_id]
  );

  if (!env) return errorResponse('Environment not found', 404);
  if (!env.enterprise_name) {
    return errorResponse('Environment has no bound enterprise. Bind an enterprise first.', 400);
  }

  const workspace = await queryOne<{ gcp_project_id: string }>(
    'SELECT gcp_project_id FROM workspaces WHERE id = $1',
    [env.workspace_id]
  );
  if (!workspace?.gcp_project_id) {
    return errorResponse('Workspace has no GCP project configured', 400);
  }

  const normalizedGroupId = body.group_id?.trim() || undefined;
  if (normalizedGroupId) {
    const group = await queryOne<{ id: string }>(
      'SELECT id FROM groups WHERE id = $1 AND environment_id = $2',
      [normalizedGroupId, body.environment_id]
    );
    if (!group) {
      return errorResponse('Group not found in this environment', 404);
    }
  }

  // Build the AMAPI enrollment token request
  const expiryDays = resolveEnrollmentDurationDays({
    expiryDays: body.expiry_days,
    durationDays: body.duration_days,
    duration: body.duration,
    durationSeconds: body.duration_seconds,
    defaultDays: 30,
  });
  const oneTimeUse = normalizeOneTimeUse(body.one_time_use);
  const allowPersonalUsage = normalizeAllowPersonalUsage(body.allow_personal_usage);
  const expirationTimestamp = new Date(
    Date.now() + expiryDays * 24 * 60 * 60 * 1000
  ).toISOString();

  try {
    await assertEnvironmentEnrollmentAllowed(body.environment_id);

    // Resolve the effective policy for the selected group (or environment default).
    // This is used as the initial provisioning policy on the AMAPI token.
    // Post-enrollment, syncEnrollmentPolicyFromGroup re-resolves and assigns the
    // derivative policy based on the device's actual group membership.
    let amapiPolicyName: string | undefined;
    let resolvedPolicyId: string | null = null;
    if (normalizedGroupId) {
      // Walk group hierarchy upward to find the nearest policy assignment
      const groupPolicy = await queryOne<{ policy_id: string }>(
        `SELECT pa.policy_id
         FROM group_closures gc
         JOIN policy_assignments pa ON pa.scope_type = 'group' AND pa.scope_id = gc.ancestor_id
         WHERE gc.descendant_id = $1
         ORDER BY gc.depth ASC
         LIMIT 1`,
        [normalizedGroupId]
      );
      resolvedPolicyId = groupPolicy?.policy_id ?? null;
    }
    if (!resolvedPolicyId) {
      // Fall back to environment-level policy assignment
      const envPolicy = await queryOne<{ policy_id: string }>(
        `SELECT policy_id FROM policy_assignments
         WHERE scope_type = 'environment' AND scope_id = $1
         LIMIT 1`,
        [body.environment_id]
      );
      resolvedPolicyId = envPolicy?.policy_id ?? null;
    }
    if (resolvedPolicyId) {
      // Try group-specific derivative first for immediate correct policy on enrollment
      if (normalizedGroupId) {
        const derivative = await queryOne<{ amapi_name: string | null }>(
          `SELECT amapi_name FROM policy_derivatives
           WHERE policy_id = $1 AND scope_type = 'group' AND scope_id = $2
             AND amapi_name IS NOT NULL
           LIMIT 1`,
          [resolvedPolicyId, normalizedGroupId]
        );
        if (derivative?.amapi_name) {
          amapiPolicyName = derivative.amapi_name;
        }
      }
      // Fall back to base policy
      if (!amapiPolicyName) {
        const policy = await queryOne<{ id: string; amapi_name: string | null }>(
          'SELECT id, amapi_name FROM policies WHERE id = $1 AND environment_id = $2',
          [resolvedPolicyId, body.environment_id]
        );
        if (policy) {
          amapiPolicyName = policy.amapi_name ?? `${env.enterprise_name}/policies/${policy.id}`;
        }
      }
    }

    const amapiBody: Record<string, unknown> = {
      duration: `${expiryDays * 24 * 60 * 60}s`,
      oneTimeOnly: oneTimeUse,
    };
    // AMAPI rejects PERSONAL_USAGE_UNSPECIFIED when explicitly provided.
    if (allowPersonalUsage !== 'PERSONAL_USAGE_UNSPECIFIED') {
      amapiBody.allowPersonalUsage = allowPersonalUsage;
    }

    if (amapiPolicyName) {
      amapiBody.policyName = amapiPolicyName;
    }

    // Embed group_id for enrollment callback to use
    if (normalizedGroupId) {
      amapiBody.additionalData = JSON.stringify({ group_id: normalizedGroupId });
    }

    const result = await amapiCall<AmapiEnrollmentToken>(
      `${env.enterprise_name}/enrollmentTokens`,
      env.workspace_id,
      {
        method: 'POST',
        body: amapiBody,
        projectId: workspace.gcp_project_id,
        enterpriseName: env.enterprise_name,
        resourceType: 'general',
      }
    );

    const normalizedProvisioningExtras = normalizeProvisioningExtrasInput(body.provisioning_extras);
    const mergedQrData = applyProvisioningExtrasToQrPayload(result.qrCode || null, normalizedProvisioningExtras);

    // Store locally
    const tokenName = body.name?.trim() || result.name?.split('/').pop() || 'Unnamed';
    const tokenId = crypto.randomUUID();

    await execute(
      `INSERT INTO enrollment_tokens
        (id, environment_id, group_id, policy_id, name, amapi_name, amapi_value, qr_data,
         one_time_use, allow_personal_usage, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        tokenId,
        body.environment_id,
        normalizedGroupId || null,
        resolvedPolicyId || null,
        tokenName,
        result.name || null,
        result.value || null,
        mergedQrData,
        oneTimeUse,
        allowPersonalUsage,
        expirationTimestamp,
      ]
    );

    await logAudit({
      environment_id: body.environment_id,
      user_id: auth.user.id,
      action: 'enrollment_token.created',
      resource_type: 'enrollment_token',
      resource_id: tokenId,
      details: {
        name: tokenName,
        resolved_policy_id: resolvedPolicyId,
        group_id: normalizedGroupId,
        one_time_use: oneTimeUse,
        allow_personal_usage: allowPersonalUsage,
        expiry_days: expiryDays,
        has_provisioning_extras: Boolean(normalizedProvisioningExtras),
      },
      ip_address: getClientIp(request),
    });

    return jsonResponse({
      token: result.value || null,
      qr_data: mergedQrData,
      enrollment_token: {
        id: tokenId,
        name: tokenName,
        value: result.value || null,
        qrCode: mergedQrData,
        amapi_name: result.name || null,
        expires_at: expirationTimestamp,
      },
    });
  } catch (err) {
    if (err instanceof Response) return err;
    const status = getAmapiErrorHttpStatus(err);

    await logAudit({
      environment_id: body.environment_id,
      user_id: auth.user.id,
      action: 'enrollment_token.create_failed',
      resource_type: 'enrollment_token',
      resource_id: null,
      details: { error: err instanceof Error ? err.message : String(err) },
      ip_address: getClientIp(request),
    });

    return errorResponse(
      err instanceof Error ? err.message : 'Failed to create enrolment token',
      status ?? 502
    );
  }
};
