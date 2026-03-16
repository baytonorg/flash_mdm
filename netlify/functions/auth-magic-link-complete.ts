import type { Context } from '@netlify/functions';
import { queryOne, execute } from './_lib/db.js';
import { hashToken, generateToken } from './_lib/crypto.js';
import { setSessionCookie, clearSessionCookie, SESSION_MAX_AGE_MILLISECONDS } from './_lib/auth.js';
import { consumeBackupCode, verifyTOTP } from './_lib/totp.js';
import { decrypt, encrypt } from './_lib/crypto.js';
import { logAudit } from './_lib/audit.js';
import { jsonResponse, errorResponse, parseJsonBody, getClientIp } from './_lib/helpers.js';
import { consumeToken } from './_lib/rate-limiter.js';

interface CompleteMagicLinkMfaBody {
  token: string;
  totp_code: string;
}

export default async (request: Request, _context: Context) => {
  void _context;
  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  const body = await parseJsonBody<CompleteMagicLinkMfaBody>(request);
  const token = body.token?.trim();
  const totpCode = body.totp_code?.trim();

  if (!token || !totpCode) {
    return errorResponse('token and totp_code are required');
  }

  const clientIp = getClientIp(request);
  const ipLimit = await consumeToken(`auth:magic-link-mfa:ip:${clientIp}`, 1, 10, 10 / 300);
  if (!ipLimit.allowed) {
    return jsonResponse(
      { error: 'Too many MFA attempts. Please try again later.' },
      429,
      ipLimit.retryAfterMs
        ? { 'Retry-After': String(Math.max(1, Math.ceil(ipLimit.retryAfterMs / 1000))) }
        : {}
    );
  }

  const tokenHash = hashToken(token);
  const tokenLimit = await consumeToken(`auth:magic-link-mfa:token:${tokenHash}`, 1, 5, 5 / 300);
  if (!tokenLimit.allowed) {
    return jsonResponse(
      { error: 'Too many MFA attempts. Please try again later.' },
      429,
      tokenLimit.retryAfterMs
        ? { 'Retry-After': String(Math.max(1, Math.ceil(tokenLimit.retryAfterMs / 1000))) }
        : {}
    );
  }

  const link = await queryOne<{
    id: string;
    email: string;
    used_at: string | null;
    expires_at: string;
  }>(
    'SELECT id, email, used_at, expires_at FROM magic_links WHERE token_hash = $1',
    [tokenHash]
  );

  const pendingContext = parsePendingMfaContext(link?.email ?? null);
  if (!link || !pendingContext) {
    return errorResponse('Invalid or expired MFA session', 400);
  }
  if (link.used_at) {
    return errorResponse('This MFA session has already been used', 400);
  }
  if (new Date(link.expires_at) < new Date()) {
    return errorResponse('This MFA session has expired', 400);
  }

  const userId = pendingContext.userId;

  const user = await queryOne<{
    id: string;
    email: string;
    first_name: string;
    last_name: string;
    is_superadmin: boolean;
    totp_enabled: boolean;
    totp_secret_enc: string | null;
    totp_backup_codes_enc: string | null;
  }>(
     `SELECT u.id, u.email, u.first_name, u.last_name, u.is_superadmin, u.totp_enabled, u.totp_secret_enc,
            u.totp_backup_codes_enc
     FROM users u
     WHERE u.id = $1`,
    [userId]
  );

  if (!user || !user.totp_enabled) {
    return errorResponse('MFA is not configured for this account', 400);
  }

  let totpValid = false;
  if (user.totp_secret_enc) {
    try {
      const totpSecret = decrypt(user.totp_secret_enc, `totp:${user.id}`);
      totpValid = verifyTOTP(totpSecret, totpCode);
    } catch {
      return errorResponse('Failed to verify TOTP. Contact support.', 500);
    }
  }

  let backupCodeUsed = false;
  let pendingBackupCodeRotation:
    | { nextEnc: string; remainingCodesCount: number }
    | null = null;
  if (!totpValid && user.totp_backup_codes_enc) {
    try {
      const decryptedBackupCodes = decrypt(user.totp_backup_codes_enc, `totp_backup:${user.id}`);
      const backupCodes = JSON.parse(decryptedBackupCodes) as string[];
      const consumeResult = consumeBackupCode(backupCodes, totpCode);
      if (consumeResult.matched) {
        pendingBackupCodeRotation = {
          nextEnc: encrypt(JSON.stringify(consumeResult.remainingCodes), `totp_backup:${user.id}`),
          remainingCodesCount: consumeResult.remainingCodes.length,
        };
        backupCodeUsed = true;
      }
    } catch {
      return errorResponse('Failed to verify backup code. Contact support.', 500);
    }
  }

  if (!totpValid && !backupCodeUsed) {
    await logAudit({
      user_id: user.id,
      action: 'auth.login_failed',
      details: { reason: 'invalid_totp_magic_link' },
      ip_address: getClientIp(request),
    });
    return errorResponse('Invalid TOTP code', 401);
  }

  // Consume pending MFA token after validation so users can retry invalid codes,
  // while keeping finalization single-use and race-safe.
  const pendingTokenConsumeResult = await execute(
    'UPDATE magic_links SET used_at = now() WHERE id = $1 AND used_at IS NULL',
    [link.id]
  );
  if (pendingTokenConsumeResult.rowCount === 0) {
    return errorResponse('This MFA session has already been used', 400);
  }

  if (pendingBackupCodeRotation) {
    const updateResult = await execute(
      'UPDATE users SET totp_backup_codes_enc = $1, updated_at = now() WHERE id = $2 AND totp_backup_codes_enc = $3',
      [pendingBackupCodeRotation.nextEnc, user.id, user.totp_backup_codes_enc]
    );
    if (updateResult.rowCount === 0) {
      return errorResponse('Backup code was already used. Please try another code.', 409);
    }

    await logAudit({
      user_id: user.id,
      action: 'auth.backup_code_used',
      details: { remaining_codes: pendingBackupCodeRotation.remainingCodesCount, method: 'magic_link' },
      ip_address: getClientIp(request),
    });
  }

  if (pendingContext.kind === 'password_reset') {
    let passwordHash: string;
    try {
      passwordHash = decrypt(
        pendingContext.encryptedPasswordHash,
        `password_reset_pending:${user.id}`
      );
    } catch {
      return errorResponse('Invalid or expired MFA session', 400);
    }

    if (!passwordHash) {
      return errorResponse('Invalid or expired MFA session', 400);
    }

    await execute(
      'UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2',
      [passwordHash, user.id]
    );

    await execute('DELETE FROM sessions WHERE user_id = $1', [user.id]);

    await logAudit({
      user_id: user.id,
      action: 'auth.password_reset_completed',
      details: { method: 'password_reset_totp' },
      ip_address: clientIp,
    });

    return jsonResponse(
      { message: 'Password reset successful. Please sign in again.' },
      200,
      { 'Set-Cookie': clearSessionCookie() }
    );
  }

  const sessionToken = generateToken();
  const sessionTokenHash = hashToken(sessionToken);
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MILLISECONDS);

  const membership = await queryOne<{ workspace_id: string }>(
    'SELECT workspace_id FROM workspace_memberships WHERE user_id = $1 LIMIT 1',
    [user.id]
  );

  await execute(
    `INSERT INTO sessions (token_hash, user_id, workspace_id, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [sessionTokenHash, user.id, membership?.workspace_id ?? null, clientIp, request.headers.get('user-agent'), expiresAt]
  );

  await execute(
    'UPDATE users SET last_login_at = now(), last_login_ip = $1, last_login_method = $2 WHERE id = $3',
    [clientIp, 'magic_link', user.id]
  );

  await logAudit({
    user_id: user.id,
    workspace_id: membership?.workspace_id ?? undefined,
    action: 'auth.login',
    details: { method: 'magic_link_totp' },
    ip_address: clientIp,
  });

  return jsonResponse(
    {
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        is_superadmin: user.is_superadmin,
      },
    },
    200,
    { 'Set-Cookie': setSessionCookie(sessionToken) }
  );
};

type PendingMfaContext =
  | { kind: 'login'; userId: string }
  | { kind: 'password_reset'; userId: string; encryptedPasswordHash: string };

function parsePendingMfaContext(value: string | null): PendingMfaContext | null {
  if (!value) return null;

  if (value.startsWith('mfa_pending:')) {
    const userId = value.slice('mfa_pending:'.length);
    return userId ? { kind: 'login', userId } : null;
  }

  if (value.startsWith('password_reset_mfa_pending_v2:')) {
    const payload = value.slice('password_reset_mfa_pending_v2:'.length);
    const separatorIndex = payload.indexOf(':');
    if (separatorIndex <= 0) return null;

    const userId = payload.slice(0, separatorIndex);
    const encryptedPasswordHash = payload.slice(separatorIndex + 1);
    if (!userId || !encryptedPasswordHash) return null;

    return { kind: 'password_reset', userId, encryptedPasswordHash };
  }

  return null;
}
