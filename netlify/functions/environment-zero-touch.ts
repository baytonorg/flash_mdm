import type { Context } from '@netlify/functions';
import { randomUUID } from 'crypto';
import { query, queryOne, execute } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { requireEnvironmentPermission, requireEnvironmentResourcePermission } from './_lib/rbac.js';
import { amapiCall, getAmapiErrorHttpStatus } from './_lib/amapi.js';
import { jsonResponse, errorResponse, parseJsonBody, getSearchParams, getClientIp } from './_lib/helpers.js';
import { logAudit } from './_lib/audit.js';
import { assertEnvironmentEnrollmentAllowed } from './_lib/licensing.js';
import { normalizeAllowPersonalUsage } from './_lib/enrollment-token-options.js';
import {
  applyProvisioningExtrasToQrPayload,
  normalizeProvisioningExtrasInput,
  type ProvisioningExtrasInput,
} from './enrollment-create.js';

type ZeroTouchAction =
  | 'create_iframe_token'
  | 'create_enrollment_token_for_zt'
  | 'build_zt_dpc_extras';

interface AmapiEnrollmentToken {
  name: string;
  value?: string;
  qrCode?: string;
  expirationTimestamp?: string;
  oneTimeOnly?: boolean;
  allowPersonalUsage?: string;
}

const SENSITIVE_KEY_PATTERN = /(password|certificate|private[_-]?key|secret|token|credential)/i;
const ZERO_TOUCH_ENROLLMENT_TOKEN_DURATION = '315576000000s';
const ANDROID_DEVICE_POLICY_DPC_ID = 'com.google.android.apps.work.clouddpc';
const ANDROID_DEVICE_POLICY_COMPONENT = `${ANDROID_DEVICE_POLICY_DPC_ID}/.receivers.CloudDeviceAdminReceiver`;
const ANDROID_DEVICE_POLICY_SIGNATURE_CHECKSUM = 'I5YvS0O5hXY46mb01BlRjq4oJJGs2kuUcHvVkAPEXlg';
const ENROLLMENT_TOKEN_EXTRA = `${ANDROID_DEVICE_POLICY_DPC_ID}.EXTRA_ENROLLMENT_TOKEN`;

function ensureNonSensitiveExtras(extras: Record<string, unknown>): string | null {
  for (const [key, value] of Object.entries(extras)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      return `Sensitive provisioning extra key is not allowed: ${key}`;
    }
    if (typeof value === 'string' && SENSITIVE_KEY_PATTERN.test(value)) {
      return `Provisioning extras value appears sensitive for key: ${key}`;
    }
  }
  return null;
}

function buildAndroidDevicePolicyDpcExtras(
  enrollmentTokenValue: string,
  provisioningExtras: ProvisioningExtrasInput | null,
  customExtras: Record<string, unknown>
): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...customExtras };
  const syntheticQr = applyProvisioningExtrasToQrPayload('{}', provisioningExtras);

  if (syntheticQr) {
    const parsed = JSON.parse(syntheticQr) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      Object.assign(payload, parsed);
    }
  }

  // These documented ADP values are authoritative and cannot be overridden by custom extras.
  payload['android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME'] = ANDROID_DEVICE_POLICY_COMPONENT;
  payload['android.app.extra.PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM'] = ANDROID_DEVICE_POLICY_SIGNATURE_CHECKSUM;
  payload['android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE'] = {
    [ENROLLMENT_TOKEN_EXTRA]: enrollmentTokenValue,
  };

  return payload;
}

async function getEnvironmentContext(environmentId: string) {
  return queryOne<{
    id: string;
    name: string;
    workspace_id: string;
    enterprise_name: string | null;
    gcp_project_id: string | null;
  }>(
    `SELECT e.id, e.name, e.workspace_id, e.enterprise_name, w.gcp_project_id
     FROM environments e
     JOIN workspaces w ON w.id = e.workspace_id
     WHERE e.id = $1`,
    [environmentId]
  );
}

async function getActiveReusableEnrollmentToken(tokenId: string, environmentId: string) {
  return queryOne<{ id: string; amapi_value: string; group_id: string | null }>(
    `SELECT id, amapi_value, group_id
     FROM enrollment_tokens
     WHERE id = $1 AND environment_id = $2
       AND one_time_use = false
       AND amapi_value IS NOT NULL
       AND expires_at IS NOT NULL
       AND expires_at > now()`,
    [tokenId, environmentId]
  );
}

async function createEnrollmentTokenForZeroTouch(opts: {
  environmentId: string;
  workspaceId: string;
  enterpriseName: string;
  projectId: string;
  userId: string;
  tokenName?: string | null;
  groupId?: string | null;
  allowPersonalUsage?: string;
  provisioningExtras?: ProvisioningExtrasInput | null;
  request: Request;
}): Promise<{ token_id: string; token: string | null; qr_data: string | null; amapi_name: string | null; group_id: string | null; expires_at: string | null }> {
  await assertEnvironmentEnrollmentAllowed(opts.environmentId);

  const normalizedGroupId = opts.groupId?.trim() || null;
  if (normalizedGroupId) {
    const group = await queryOne<{ id: string }>(
      'SELECT id FROM groups WHERE id = $1 AND environment_id = $2',
      [normalizedGroupId, opts.environmentId]
    );
    if (!group) throw new Error('Group not found in this environment');
  }

  const allowPersonalUsage = normalizeAllowPersonalUsage(opts.allowPersonalUsage);

  const amapiBody: Record<string, unknown> = {
    oneTimeOnly: false,
    duration: ZERO_TOUCH_ENROLLMENT_TOKEN_DURATION,
  };
  // AMAPI rejects PERSONAL_USAGE_UNSPECIFIED when explicitly provided; omit the field for default behavior.
  if (allowPersonalUsage !== 'PERSONAL_USAGE_UNSPECIFIED') {
    amapiBody.allowPersonalUsage = allowPersonalUsage;
  }

  if (normalizedGroupId) {
    amapiBody.additionalData = JSON.stringify({ group_id: normalizedGroupId });
  }

  const amapiToken = await amapiCall<AmapiEnrollmentToken>(
    `${opts.enterpriseName}/enrollmentTokens`,
    opts.workspaceId,
    {
      method: 'POST',
      body: amapiBody,
      projectId: opts.projectId,
      enterpriseName: opts.enterpriseName,
      resourceType: 'general',
    }
  );

  if (!amapiToken.expirationTimestamp || Number.isNaN(Date.parse(amapiToken.expirationTimestamp))) {
    throw new Error('AMAPI did not return a valid enrollment token expiration timestamp');
  }
  const expirationTimestamp = amapiToken.expirationTimestamp;

  const mergedQrData = applyProvisioningExtrasToQrPayload(amapiToken.qrCode || null, opts.provisioningExtras ?? null);
  const tokenId = randomUUID();
  const effectiveName = opts.tokenName?.trim() || amapiToken.name?.split('/').pop() || 'Zero-touch token';

  await execute(
    `INSERT INTO enrollment_tokens
      (id, environment_id, group_id, name, amapi_name, amapi_value, qr_data,
       one_time_use, allow_personal_usage, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      tokenId,
      opts.environmentId,
      normalizedGroupId,
      effectiveName,
      amapiToken.name ?? null,
      amapiToken.value ?? null,
      mergedQrData,
      false,
      allowPersonalUsage,
      expirationTimestamp,
    ]
  );

  await logAudit({
    environment_id: opts.environmentId,
    user_id: opts.userId,
    action: 'environment.zero.touch.enrollment.token.created',
    resource_type: 'enrollment_token',
    resource_id: tokenId,
    details: {
      group_id: normalizedGroupId,
      one_time_use: false,
      expiration_timestamp: expirationTimestamp,
    },
    ip_address: getClientIp(opts.request),
  });

  return {
    token_id: tokenId,
    token: amapiToken.value ?? null,
    qr_data: mergedQrData,
    amapi_name: amapiToken.name ?? null,
    group_id: normalizedGroupId,
    expires_at: expirationTimestamp,
  };
}

export default async (request: Request, _context: Context) => {
  try {
    const auth = await requireAuth(request);

    if (request.method === 'GET') {
      const params = getSearchParams(request);
      const environmentId = params.get('environment_id');
      if (!environmentId) return errorResponse('environment_id is required');

      await requireEnvironmentPermission(auth, environmentId, 'read');

      const env = await getEnvironmentContext(environmentId);
      if (!env) return errorResponse('Environment not found', 404);

      const groups = await query<{ id: string; name: string }>(
        'SELECT id, name FROM groups WHERE environment_id = $1 ORDER BY name ASC',
        [environmentId]
      );

      const tokens = await query<{
        id: string;
        name: string;
        group_id: string | null;
        group_name: string | null;
        one_time_use: boolean;
        allow_personal_usage: string | null;
        expires_at: string | null;
        amapi_value: string | null;
      }>(
        `SELECT et.id, et.name, et.group_id, g.name AS group_name,
                et.one_time_use, et.allow_personal_usage, et.expires_at, et.amapi_value
         FROM enrollment_tokens et
         LEFT JOIN groups g ON g.id = et.group_id
         WHERE et.environment_id = $1
           AND et.one_time_use = false
           AND et.amapi_value IS NOT NULL
           AND et.expires_at IS NOT NULL
           AND et.expires_at > now()
         ORDER BY et.created_at DESC`,
        [environmentId]
      );

      return jsonResponse({
        environment: {
          id: env.id,
          name: env.name,
          enterprise_name: env.enterprise_name,
        },
        groups,
        active_tokens: tokens,
      });
    }

    if (request.method !== 'POST') {
      return errorResponse('Method not allowed', 405);
    }

    const body = await parseJsonBody<{
      environment_id: string;
      action: ZeroTouchAction;
      token_id?: string;
      group_id?: string;
      token_name?: string;
      allow_personal_usage?: string;
      provisioning_extras?: ProvisioningExtrasInput;
      custom_dpc_extras?: Record<string, unknown>;
    }>(request);

    if (!body.environment_id || !body.action) {
      return errorResponse('environment_id and action are required');
    }

    const env = await getEnvironmentContext(body.environment_id);
    if (!env) return errorResponse('Environment not found', 404);
    if (!env.enterprise_name) return errorResponse('Environment is not bound to an enterprise', 400);
    if (!env.gcp_project_id) return errorResponse('Workspace has no GCP project configured', 400);

    await requireEnvironmentResourcePermission(auth, body.environment_id, 'environment', 'manage_settings');

    if (body.action === 'create_iframe_token') {
      if (!body.token_id) return errorResponse('token_id is required', 400);

      const existingToken = await getActiveReusableEnrollmentToken(body.token_id, body.environment_id);
      if (!existingToken) {
        return errorResponse('Enrollment token not found, expired, or unsuitable for zero-touch', 404);
      }

      const dpcExtras = buildAndroidDevicePolicyDpcExtras(existingToken.amapi_value, null, {});
      const webToken = await amapiCall<{ value: string }>(
        `${env.enterprise_name}/webTokens`,
        env.workspace_id,
        {
          method: 'POST',
          body: {
            parentFrameUrl: process.env.URL ?? 'https://localhost:8888',
            enabledFeatures: ['ZERO_TOUCH_CUSTOMER_MANAGEMENT'],
          },
          projectId: env.gcp_project_id,
          enterpriseName: env.enterprise_name,
          resourceType: 'webTokens',
        }
      );

      await logAudit({
        environment_id: body.environment_id,
        user_id: auth.user.id,
        action: 'environment.zero.touch.iframe.token.created',
        resource_type: 'environment',
        resource_id: body.environment_id,
        details: {
          token_id: existingToken.id,
          group_id: existingToken.group_id,
        },
        ip_address: getClientIp(request),
      });

      const iframeUrl = new URL('https://enterprise.google.com/android/zero-touch/embedded/companyhome');
      iframeUrl.searchParams.set('token', webToken.value);
      iframeUrl.searchParams.set('dpcId', ANDROID_DEVICE_POLICY_DPC_ID);
      iframeUrl.searchParams.set('dpcExtras', JSON.stringify(dpcExtras));

      return jsonResponse({
        iframe_token: webToken.value,
        iframe_url: iframeUrl.toString(),
      });
    }

    if (body.action === 'create_enrollment_token_for_zt') {
      const extras = normalizeProvisioningExtrasInput(body.provisioning_extras ?? null);
      const token = await createEnrollmentTokenForZeroTouch({
        environmentId: body.environment_id,
        workspaceId: env.workspace_id,
        enterpriseName: env.enterprise_name,
        projectId: env.gcp_project_id,
        userId: auth.user.id,
        tokenName: body.token_name,
        groupId: body.group_id,
        allowPersonalUsage: body.allow_personal_usage,
        provisioningExtras: extras,
        request,
      });

      return jsonResponse({ enrollment_token: token });
    }

    if (body.action === 'build_zt_dpc_extras') {
      const extras = normalizeProvisioningExtrasInput(body.provisioning_extras ?? null);
      let enrollmentTokenValue: string | null = null;
      let resolvedGroupId: string | null = null;
      let createdTokenId: string | null = null;

      if (body.token_id) {
        const existingToken = await getActiveReusableEnrollmentToken(body.token_id, body.environment_id);
        if (!existingToken) {
          return errorResponse('Enrollment token not found, expired, or unsuitable for zero-touch', 404);
        }
        enrollmentTokenValue = existingToken.amapi_value;
        resolvedGroupId = existingToken.group_id;
      } else {
        const created = await createEnrollmentTokenForZeroTouch({
          environmentId: body.environment_id,
          workspaceId: env.workspace_id,
          enterpriseName: env.enterprise_name,
          projectId: env.gcp_project_id,
          userId: auth.user.id,
          tokenName: body.token_name,
          groupId: body.group_id,
          allowPersonalUsage: body.allow_personal_usage,
          provisioningExtras: extras,
          request,
        });
        enrollmentTokenValue = created.token;
        resolvedGroupId = created.group_id;
        createdTokenId = created.token_id;
      }

      const customExtras = body.custom_dpc_extras && typeof body.custom_dpc_extras === 'object'
        ? body.custom_dpc_extras
        : {};
      const sensitiveError = ensureNonSensitiveExtras(customExtras);
      if (sensitiveError) return errorResponse(sensitiveError, 400);
      if (!enrollmentTokenValue) return errorResponse('Enrollment token value is unavailable', 409);

      const payload = buildAndroidDevicePolicyDpcExtras(enrollmentTokenValue, extras, customExtras);

      await logAudit({
        environment_id: body.environment_id,
        user_id: auth.user.id,
        action: 'environment.zero.touch.dpc.extras.built',
        resource_type: 'environment',
        resource_id: body.environment_id,
        details: {
          token_id: body.token_id ?? createdTokenId,
          group_id: resolvedGroupId,
          extras_keys: Object.keys(payload),
        },
        ip_address: getClientIp(request),
      });

      return jsonResponse({
        dpc_extras: payload,
        token_id: body.token_id ?? createdTokenId,
        resolved_group_id: resolvedGroupId,
      });
    }

    return errorResponse('Invalid action', 400);
  } catch (err) {
    if (err instanceof Response) return err;
    const status = getAmapiErrorHttpStatus(err) ?? 500;
    return errorResponse(err instanceof Error ? err.message : 'Internal server error', status);
  }
};
