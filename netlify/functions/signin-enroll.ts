import type { Context } from '@netlify/functions';
import { randomInt } from 'crypto';
import { queryOne, execute, query } from './_lib/db.js';
import { amapiCall } from './_lib/amapi.js';
import { hashToken } from './_lib/crypto.js';
import { consumeToken } from './_lib/rate-limiter.js';
import { sendEmail, signinVerificationEmail } from './_lib/resend.js';
import { logAudit } from './_lib/audit.js';
import { jsonResponse, errorResponse, parseJsonBody, getClientIp } from './_lib/helpers.js';
import { assertEnvironmentEnrollmentAllowed } from './_lib/licensing.js';

// --- Interfaces ---

interface SigninConfig {
  id: string;
  environment_id: string;
  enabled: boolean;
  allowed_domains: string[];
  default_group_id: string | null;
  allow_personal_usage: string;
}

interface AmapiEnrollmentToken {
  name: string;
  value?: string;
  qrCode?: string;
  expirationTimestamp?: string;
}

interface AmapiProvisioningInfoResult {
  enterprise?: { name?: string; id?: string };
  authenticatedUserEmail?: string;
}

// --- Helpers ---

/**
 * Resolve the environment from provisioning info.
 * Prefer AMAPI provisioningInfo.get, then fall back to local heuristics.
 */
async function resolveEnvironmentFromProvisioningInfo(
  provisioningInfo: string | undefined
): Promise<{
  environmentId: string;
  enterpriseName: string;
  workspaceId: string;
  projectId: string;
} | null> {
  if (!provisioningInfo) return null;

  // Strategy 0 (preferred): call AMAPI provisioningInfo.get using candidate
  // workspaces that currently have sign-in enrollment enabled.
  const candidateWorkspaces = await query<{
    workspace_id: string;
    gcp_project_id: string;
  }>(
    `SELECT DISTINCT e.workspace_id, w.gcp_project_id
     FROM signin_configurations sc
     JOIN environments e ON e.id = sc.environment_id
     JOIN workspaces w ON w.id = e.workspace_id
     WHERE sc.enabled = true
       AND e.enterprise_name IS NOT NULL
       AND w.gcp_project_id IS NOT NULL`,
    []
  );

  for (const candidate of candidateWorkspaces) {
    try {
      const info = await amapiCall<AmapiProvisioningInfoResult>(
        `provisioningInfo/${encodeURIComponent(provisioningInfo)}:get`,
        candidate.workspace_id,
        {
          projectId: candidate.gcp_project_id,
          resourceType: 'general',
        }
      );

      const enterpriseName = info.enterprise?.name
        ?? (info.enterprise?.id ? `enterprises/${info.enterprise.id}` : undefined);
      if (!enterpriseName) continue;

      const env = await queryOne<{
        id: string; enterprise_name: string; workspace_id: string;
      }>(
        'SELECT id, enterprise_name, workspace_id FROM environments WHERE enterprise_name = $1',
        [enterpriseName]
      );
      if (!env) continue;

      return {
        environmentId: env.id,
        enterpriseName: env.enterprise_name,
        workspaceId: env.workspace_id,
        projectId: candidate.gcp_project_id,
      };
    } catch {
      // Continue scanning candidate workspaces.
    }
  }

  // provisioningInfo is a base64-encoded JSON string from Google.
  // It may contain enterprise info. Try to parse it.
  let enterpriseId: string | null = null;

  if (provisioningInfo) {
    try {
      const decoded = Buffer.from(provisioningInfo, 'base64').toString('utf8');
      const info = JSON.parse(decoded);
      // AMAPI provisioning info may contain enterprise name or identifier
      enterpriseId = info.enterprise?.id ?? info.enterpriseId ?? null;
    } catch {
      // Not parseable — that's OK, provisioningInfo format isn't strictly documented
    }
  }

  // Strategy 1: If we extracted an enterprise ID, look up by enterprise_name
  if (enterpriseId) {
    const env = await queryOne<{
      id: string; enterprise_name: string; workspace_id: string;
    }>(
      `SELECT e.id, e.enterprise_name, e.workspace_id
       FROM environments e
       WHERE e.enterprise_name = $1 OR e.enterprise_name LIKE '%/' || $1`,
      [`enterprises/${enterpriseId}`]
    );
    if (env) {
      const ws = await queryOne<{ gcp_project_id: string }>(
        'SELECT gcp_project_id FROM workspaces WHERE id = $1',
        [env.workspace_id]
      );
      if (ws?.gcp_project_id) {
        return {
          environmentId: env.id,
          enterpriseName: env.enterprise_name,
          workspaceId: env.workspace_id,
          projectId: ws.gcp_project_id,
        };
      }
    }
  }

  // Strategy 2: Look up by the environment_id (used as tokenTag in signinDetails)
  // When there's only one enabled signin config, use that
  const configs = await query<{
    environment_id: string;
  }>(
    `SELECT sc.environment_id FROM signin_configurations sc
     JOIN environments e ON e.id = sc.environment_id
     WHERE sc.enabled = true AND e.enterprise_name IS NOT NULL
     LIMIT 2`,
    []
  );

  if (configs.length === 1) {
    const envId = configs[0].environment_id;
    const env = await queryOne<{
      id: string; enterprise_name: string; workspace_id: string;
    }>(
      'SELECT id, enterprise_name, workspace_id FROM environments WHERE id = $1',
      [envId]
    );
    if (env) {
      const ws = await queryOne<{ gcp_project_id: string }>(
        'SELECT gcp_project_id FROM workspaces WHERE id = $1',
        [env.workspace_id]
      );
      if (ws?.gcp_project_id) {
        return {
          environmentId: env.id,
          enterpriseName: env.enterprise_name,
          workspaceId: env.workspace_id,
          projectId: ws.gcp_project_id,
        };
      }
    }
  }

  return null;
}

/**
 * Resolve the AMAPI policy name for the configured group (or environment fallback).
 * Reuses the same resolution logic as enrollment-create.ts.
 */
async function resolveAmapiPolicyName(
  environmentId: string,
  groupId: string | null,
  enterpriseName: string
): Promise<{ policyName: string | undefined; policyId: string | null }> {
  let resolvedPolicyId: string | null = null;
  let amapiPolicyName: string | undefined;

  if (groupId) {
    const groupPolicy = await queryOne<{ policy_id: string }>(
      `SELECT pa.policy_id
       FROM group_closures gc
       JOIN policy_assignments pa ON pa.scope_type = 'group' AND pa.scope_id = gc.ancestor_id
       WHERE gc.descendant_id = $1
       ORDER BY gc.depth ASC
       LIMIT 1`,
      [groupId]
    );
    resolvedPolicyId = groupPolicy?.policy_id ?? null;
  }

  if (!resolvedPolicyId) {
    const envPolicy = await queryOne<{ policy_id: string }>(
      `SELECT policy_id FROM policy_assignments
       WHERE scope_type = 'environment' AND scope_id = $1
       LIMIT 1`,
      [environmentId]
    );
    resolvedPolicyId = envPolicy?.policy_id ?? null;
  }

  if (resolvedPolicyId) {
    // Try group-specific derivative first
    if (groupId) {
      const derivative = await queryOne<{ amapi_name: string | null }>(
        `SELECT amapi_name FROM policy_derivatives
         WHERE policy_id = $1 AND scope_type = 'group' AND scope_id = $2
           AND amapi_name IS NOT NULL
         LIMIT 1`,
        [resolvedPolicyId, groupId]
      );
      if (derivative?.amapi_name) {
        amapiPolicyName = derivative.amapi_name;
      }
    }
    // Fall back to base policy
    if (!amapiPolicyName) {
      const policy = await queryOne<{ id: string; amapi_name: string | null }>(
        'SELECT id, amapi_name FROM policies WHERE id = $1',
        [resolvedPolicyId]
      );
      if (policy) {
        amapiPolicyName = policy.amapi_name ?? `${enterpriseName}/policies/${policy.id}`;
      }
    }
  }

  return { policyName: amapiPolicyName, policyId: resolvedPolicyId };
}

// --- Handler ---

export default async (request: Request, _context: Context) => {
  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    const body = await parseJsonBody<{
      action: 'send-code' | 'verify';
      email: string;
      code?: string;
      provisioning_info?: string;
      environment_id?: string;
    }>(request);

    if (!body.action || !body.email) {
      return errorResponse('action and email are required');
    }

    const requestedEmail = body.email.toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requestedEmail)) {
      return errorResponse('Invalid email address');
    }

    const clientIp = getClientIp(request);

    // Resolve environment — try environment_id first (direct), then provisioning_info
    let envContext: {
      environmentId: string;
      enterpriseName: string;
      workspaceId: string;
      projectId: string;
    } | null = null;

    if (body.environment_id) {
      const env = await queryOne<{
        id: string; enterprise_name: string; workspace_id: string;
      }>(
        'SELECT id, enterprise_name, workspace_id FROM environments WHERE id = $1',
        [body.environment_id]
      );
      if (env?.enterprise_name) {
        const ws = await queryOne<{ gcp_project_id: string }>(
          'SELECT gcp_project_id FROM workspaces WHERE id = $1',
          [env.workspace_id]
        );
        if (ws?.gcp_project_id) {
          envContext = {
            environmentId: env.id,
            enterpriseName: env.enterprise_name,
            workspaceId: env.workspace_id,
            projectId: ws.gcp_project_id,
          };
        }
      }
    }

    if (!envContext) {
      envContext = await resolveEnvironmentFromProvisioningInfo(body.provisioning_info);
    }

    if (!envContext) {
      return errorResponse('Unable to determine enrolment environment. Please contact your administrator.', 400);
    }

    let provisioningLookup: AmapiProvisioningInfoResult | null = null;
    if (body.provisioning_info) {
      try {
        provisioningLookup = await amapiCall<AmapiProvisioningInfoResult>(
          `provisioningInfo/${encodeURIComponent(body.provisioning_info)}:get`,
          envContext.workspaceId,
          {
            projectId: envContext.projectId,
            resourceType: 'general',
          }
        );
      } catch (err) {
        console.warn(
          'signin-enroll: provisioningInfo.get failed, continuing with entered email',
          err instanceof Error ? err.message : String(err)
        );
      }
    }

    const authenticatedUserEmail = provisioningLookup?.authenticatedUserEmail?.toLowerCase().trim();
    if (authenticatedUserEmail && authenticatedUserEmail !== requestedEmail) {
      return errorResponse('The signed-in Google account does not match the email address entered.', 403);
    }
    const email = authenticatedUserEmail ?? requestedEmail;

    // Load signin config
    const config = await queryOne<SigninConfig>(
      'SELECT * FROM signin_configurations WHERE environment_id = $1',
      [envContext.environmentId]
    );

    if (!config?.enabled) {
      return errorResponse('Sign-in enrolment is not enabled for this organisation.', 403);
    }

    // Validate email domain
    const emailDomain = email.split('@')[1];
    const domainAllowed = config.allowed_domains.some(
      (d) => d.toLowerCase() === emailDomain
    );
    if (!domainAllowed) {
      return errorResponse('Your email domain is not authorised for enrolment. Please contact your administrator.', 403);
    }

    // --- Action: send-code ---
    if (body.action === 'send-code') {
      // Rate limit: 5 codes per email per hour
      const emailLimit = await consumeToken(
        `signin:code:${email}`,
        1,
        5,
        5 / 3600  // 5 tokens per hour
      );
      if (!emailLimit.allowed) {
        return errorResponse('Too many verification code requests. Please try again later.', 429);
      }

      // Rate limit: 20 requests per IP per hour
      const ipLimit = await consumeToken(
        `signin:code:ip:${clientIp}`,
        1,
        20,
        20 / 3600
      );
      if (!ipLimit.allowed) {
        return errorResponse('Too many requests. Please try again later.', 429);
      }

      // Generate 6-digit code
      const code = randomInt(100000, 999999).toString();
      const codeHash = hashToken(code);

      // Store verification
      await execute(
        `INSERT INTO signin_verifications
           (id, environment_id, email, code_hash, provisioning_info, expires_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, now() + interval '10 minutes')`,
        [
          envContext.environmentId,
          email,
          codeHash,
          body.provisioning_info ?? null,
        ]
      );

      // Send email
      const { subject, html } = signinVerificationEmail(code);
      await sendEmail({ to: email, subject, html });

      await logAudit({
        environment_id: envContext.environmentId,
        action: 'signin_enrollment.code_sent',
        resource_type: 'signin_verification',
        details: {
          email,
          has_provisioning_info: Boolean(body.provisioning_info),
        },
        ip_address: clientIp,
      });

      return jsonResponse({ sent: true });
    }

    // --- Action: verify ---
    if (body.action === 'verify') {
      if (!body.code) {
        return errorResponse('Verification code is required');
      }

      // Rate limit verification attempts per IP
      const ipLimit = await consumeToken(
        `signin:verify:ip:${clientIp}`,
        1,
        30,
        30 / 3600
      );
      if (!ipLimit.allowed) {
        return errorResponse('Too many verification attempts. Please try again later.', 429);
      }

      // Find the latest non-expired, non-verified code for this email + environment
      const verification = await queryOne<{
        id: string;
        code_hash: string;
        attempts: number;
        provisioning_info: string | null;
      }>(
        `SELECT id, code_hash, attempts, provisioning_info
         FROM signin_verifications
         WHERE environment_id = $1 AND email = $2
           AND verified_at IS NULL AND expires_at > now()
         ORDER BY created_at DESC
         LIMIT 1`,
        [envContext.environmentId, email]
      );

      if (!verification) {
        return errorResponse('No pending verification found. Please request a new code.', 400);
      }

      // Increment attempts
      await execute(
        'UPDATE signin_verifications SET attempts = attempts + 1 WHERE id = $1',
        [verification.id]
      );

      if (verification.attempts >= 5) {
        // Burn the verification — too many attempts
        await execute(
          'UPDATE signin_verifications SET verified_at = now() WHERE id = $1',
          [verification.id]
        );
        await logAudit({
          environment_id: envContext.environmentId,
          action: 'signin_enrollment.verify_failed',
          resource_type: 'signin_verification',
          resource_id: verification.id,
          details: { email, reason: 'too_many_attempts' },
          ip_address: clientIp,
        });
        return errorResponse('Too many incorrect attempts. Please request a new code.', 429);
      }

      // Verify code
      const codeHash = hashToken(body.code.trim());
      if (codeHash !== verification.code_hash) {
        await logAudit({
          environment_id: envContext.environmentId,
          action: 'signin_enrollment.verify_failed',
          resource_type: 'signin_verification',
          resource_id: verification.id,
          details: { email, reason: 'incorrect_code' },
          ip_address: clientIp,
        });
        return errorResponse('Incorrect verification code. Please try again.', 400);
      }

      // Mark as verified
      await execute(
        'UPDATE signin_verifications SET verified_at = now() WHERE id = $1',
        [verification.id]
      );

      await logAudit({
        environment_id: envContext.environmentId,
        action: 'signin_enrollment.code_verified',
        resource_type: 'signin_verification',
        resource_id: verification.id,
        details: { email },
        ip_address: clientIp,
      });

      // Resolve policy for the configured group
      const { policyName: amapiPolicyName, policyId: resolvedPolicyId } =
        await resolveAmapiPolicyName(
          envContext.environmentId,
          config.default_group_id,
          envContext.enterpriseName
        );

      await assertEnvironmentEnrollmentAllowed(envContext.environmentId);

      // Create AMAPI enrollment token (short-lived, one-time)
      const amapiBody: Record<string, unknown> = {
        duration: '3600s', // 1 hour — device enrolls immediately
        oneTimeOnly: true,
        allowPersonalUsage: config.allow_personal_usage === 'PERSONAL_USAGE_DISALLOWED'
          ? 'PERSONAL_USAGE_DISALLOWED'
          : 'PERSONAL_USAGE_ALLOWED',
      };

      if (amapiPolicyName) {
        amapiBody.policyName = amapiPolicyName;
      }

      // Embed group_id + email for enrollment callback
      const additionalData: Record<string, unknown> = {};
      if (config.default_group_id) {
        additionalData.group_id = config.default_group_id;
      }
      additionalData.signin_email = email;
      amapiBody.additionalData = JSON.stringify(additionalData);

      const result = await amapiCall<AmapiEnrollmentToken>(
        `${envContext.enterpriseName}/enrollmentTokens`,
        envContext.workspaceId,
        {
          method: 'POST',
          body: amapiBody,
          projectId: envContext.projectId,
          enterpriseName: envContext.enterpriseName,
          resourceType: 'general',
        }
      );

      if (!result.value) {
        return errorResponse('Failed to create enrolment token. Please try again.', 502);
      }

      // Store locally for tracking
      const tokenId = crypto.randomUUID();
      await execute(
        `INSERT INTO enrollment_tokens
           (id, environment_id, group_id, policy_id, name, amapi_name, amapi_value,
            qr_data, one_time_use, allow_personal_usage, signin_url, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          tokenId,
          envContext.environmentId,
          config.default_group_id,
          resolvedPolicyId,
          `Sign-in: ${email}`,
          result.name || null,
          result.value,
          result.qrCode || null,
          true, // one_time_use
          config.allow_personal_usage,
          'signin_enroll', // marker for sign-in enrollment tokens
          result.expirationTimestamp ?? new Date(Date.now() + 3600_000).toISOString(),
        ]
      );

      await logAudit({
        environment_id: envContext.environmentId,
        action: 'signin_enrollment.token_created',
        resource_type: 'enrollment_token',
        resource_id: tokenId,
        details: {
          email,
          group_id: config.default_group_id,
          policy_id: resolvedPolicyId,
        },
        ip_address: clientIp,
      });

      // Return the redirect URL for the device
      const redirectUrl = `https://enterprise.google.com/android/enroll?et=${encodeURIComponent(result.value)}`;

      return jsonResponse({ redirect_url: redirectUrl });
    }

    return errorResponse('Invalid action. Use "send-code" or "verify".', 400);
  } catch (err) {
    if (err instanceof Response) return err;
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('signin-enroll handler error:', msg);
    return errorResponse('An error occurred. Please try again.', 500);
  }
};
