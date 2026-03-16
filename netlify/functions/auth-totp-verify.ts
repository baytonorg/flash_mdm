import type { Context } from '@netlify/functions';
import { execute, queryOne } from './_lib/db.js';
import { requireSessionAuth } from './_lib/auth.js';
import { encrypt, decrypt } from './_lib/crypto.js';
import { verifyTOTP, consumeBackupCode } from './_lib/totp.js';
import { logAudit } from './_lib/audit.js';
import { jsonResponse, errorResponse, parseJsonBody, getClientIp } from './_lib/helpers.js';
import { consumeToken } from './_lib/rate-limiter.js';

function toRetryAfterHeader(retryAfterMs?: number): Record<string, string> {
  if (!retryAfterMs) return {};
  return { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterMs / 1000))) };
}

async function consumeTotpRateLimit(
  prefix: string,
  request: Request,
  userId: string
): Promise<Response | null> {
  const clientIp = getClientIp(request);

  const ipLimit = await consumeToken(`${prefix}:ip:${clientIp}`, 1, 10, 10 / 300);
  if (!ipLimit.allowed) {
    return jsonResponse(
      { error: 'Too many TOTP attempts. Please try again later.' },
      429,
      toRetryAfterHeader(ipLimit.retryAfterMs)
    );
  }

  const userLimit = await consumeToken(`${prefix}:user:${userId}`, 1, 5, 5 / 300);
  if (!userLimit.allowed) {
    return jsonResponse(
      { error: 'Too many TOTP attempts. Please try again later.' },
      429,
      toRetryAfterHeader(userLimit.retryAfterMs)
    );
  }

  return null;
}

export default async (request: Request, context: Context) => {
  void context;
  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    const auth = await requireSessionAuth(request);
    const url = new URL(request.url);
    // Handles both /api/auth/totp-verify/<action> and /.netlify/functions/auth-totp-verify/<action>
    const pathParts = url.pathname.split('/').filter(Boolean);
    const action = pathParts[pathParts.length - 1]; // last segment: 'verify' or 'disable'

    // POST /api/auth/totp/verify — verify pending TOTP setup
    if (action === 'verify') {
      const body = await parseJsonBody<{ code: string }>(request);
      const code = body.code?.trim() ?? '';
      if (code.length !== 6) {
        return errorResponse('A 6-digit code is required');
      }

      const rateLimitResponse = await consumeTotpRateLimit('auth:totp-verify', request, auth.user.id);
      if (rateLimitResponse) return rateLimitResponse;

      // Get pending TOTP data
      const user = await queryOne<{ totp_pending_enc: string | null; totp_enabled: boolean }>(
        'SELECT totp_pending_enc, totp_enabled FROM users WHERE id = $1',
        [auth.user.id]
      );

      if (user?.totp_enabled) {
        return errorResponse('TOTP is already enabled');
      }

      if (!user?.totp_pending_enc) {
        return errorResponse('No pending TOTP setup. Initiate setup first.');
      }

      // Decrypt the pending data
      let pendingData: { secret: string; backup_codes: string[]; created_at: string };
      try {
        const decrypted = decrypt(user.totp_pending_enc, `totp_pending:${auth.user.id}`);
        pendingData = JSON.parse(decrypted);
      } catch {
        return errorResponse('Failed to read pending TOTP data. Please start setup again.', 500);
      }

      // Check if pending setup has expired (15 minutes)
      const createdAt = new Date(pendingData.created_at);
      if (Date.now() - createdAt.getTime() > 15 * 60 * 1000) {
        await execute(
          'UPDATE users SET totp_pending_enc = NULL, totp_pending_created_at = NULL WHERE id = $1',
          [auth.user.id]
        );
        return errorResponse('TOTP setup has expired. Please start again.');
      }

      // Verify the code
      if (!verifyTOTP(pendingData.secret, code)) {
        return errorResponse('Invalid code. Please try again.');
      }

      // Encrypt the verified secret and backup codes for permanent storage
      const secretEnc = encrypt(pendingData.secret, `totp:${auth.user.id}`);
      const backupCodesEnc = encrypt(
        JSON.stringify(pendingData.backup_codes),
        `totp_backup:${auth.user.id}`
      );

      await execute(
        `UPDATE users
         SET totp_enabled = true,
             totp_secret_enc = $1,
             totp_backup_codes_enc = $2,
             totp_pending_enc = NULL,
             totp_pending_created_at = NULL,
             updated_at = now()
         WHERE id = $3`,
        [secretEnc, backupCodesEnc, auth.user.id]
      );

      await logAudit({
        user_id: auth.user.id,
        action: 'auth.totp_enabled',
        resource_type: 'user',
        resource_id: auth.user.id,
        ip_address: getClientIp(request),
      });

      return jsonResponse({ message: 'TOTP enabled successfully' });
    }

    // POST /api/auth/totp/disable — disable TOTP
    if (action === 'disable') {
      const body = await parseJsonBody<{ code: string }>(request);
      const code = body.code?.trim() ?? '';
      if (!code) {
        return errorResponse('A code is required to disable TOTP');
      }

      const rateLimitResponse = await consumeTotpRateLimit('auth:totp-disable', request, auth.user.id);
      if (rateLimitResponse) return rateLimitResponse;

      const user = await queryOne<{
        totp_enabled: boolean;
        totp_secret_enc: string | null;
        totp_backup_codes_enc: string | null;
      }>(
        'SELECT totp_enabled, totp_secret_enc, totp_backup_codes_enc FROM users WHERE id = $1',
        [auth.user.id]
      );

      if (!user?.totp_enabled) {
        return errorResponse('TOTP is not enabled');
      }

      let totpValid = false;
      if (user.totp_secret_enc) {
        let secret: string;
        try {
          secret = decrypt(user.totp_secret_enc, `totp:${auth.user.id}`);
        } catch {
          return errorResponse('Failed to verify TOTP. Please contact support.', 500);
        }
        totpValid = verifyTOTP(secret, code);
      }

      let backupCodeUsed = false;
      let remainingBackupCodesCount: number | null = null;
      if (!totpValid && user.totp_backup_codes_enc) {
        let backupCodes: string[];
        try {
          const decryptedBackupCodes = decrypt(user.totp_backup_codes_enc, `totp_backup:${auth.user.id}`);
          backupCodes = JSON.parse(decryptedBackupCodes) as string[];
        } catch {
          return errorResponse('Failed to verify backup code. Please contact support.', 500);
        }
        const consumeResult = consumeBackupCode(backupCodes, code);
        if (consumeResult.matched) {
          const nextEnc = encrypt(
            JSON.stringify(consumeResult.remainingCodes),
            `totp_backup:${auth.user.id}`
          );
          const updateResult = await execute(
            'UPDATE users SET totp_backup_codes_enc = $1, updated_at = now() WHERE id = $2 AND totp_backup_codes_enc = $3',
            [nextEnc, auth.user.id, user.totp_backup_codes_enc]
          );
          if (updateResult.rowCount === 0) {
            return errorResponse('Backup code was already used. Please try another code.', 409);
          }
          backupCodeUsed = true;
          remainingBackupCodesCount = consumeResult.remainingCodes.length;
        }
      }

      if (!totpValid && !backupCodeUsed) {
        return errorResponse('Invalid code. Please try again.');
      }

      // Disable TOTP
      await execute(
        `UPDATE users
         SET totp_enabled = false,
             totp_secret_enc = NULL,
             totp_backup_codes_enc = NULL,
             totp_pending_enc = NULL,
             totp_pending_created_at = NULL,
             updated_at = now()
         WHERE id = $1`,
        [auth.user.id]
      );

      if (backupCodeUsed) {
        await logAudit({
          user_id: auth.user.id,
          action: 'auth.backup_code_used',
          details: {
            remaining_codes: remainingBackupCodesCount ?? 0,
            method: 'totp_disable',
          },
          ip_address: getClientIp(request),
        });
      }

      await logAudit({
        user_id: auth.user.id,
        action: 'auth.totp_disabled',
        resource_type: 'user',
        resource_id: auth.user.id,
        ip_address: getClientIp(request),
      });

      return jsonResponse({ message: 'TOTP disabled successfully' });
    }

    return errorResponse('Not found', 404);
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
};
