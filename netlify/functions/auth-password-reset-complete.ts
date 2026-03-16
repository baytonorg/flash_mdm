import type { Context } from '@netlify/functions';
import { transaction } from './_lib/db.js';
import { hashToken, generateToken, encrypt } from './_lib/crypto.js';
import { clearSessionCookie } from './_lib/auth.js';
import { logAudit } from './_lib/audit.js';
import { jsonResponse, errorResponse, parseJsonBody, getClientIp } from './_lib/helpers.js';
import { hashPassword } from './auth-login.js';
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from './_lib/password-policy.js';

interface PasswordResetCompleteBody {
  token: string;
  new_password: string;
}

export default async (request: Request, _context: Context) => {
  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  const body = await parseJsonBody<PasswordResetCompleteBody>(request);
  const token = body.token?.trim();
  const newPassword = body.new_password ?? '';

  if (!token || !newPassword) {
    return errorResponse('token and new_password are required');
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return errorResponse(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (newPassword.length > MAX_PASSWORD_LENGTH) {
    return errorResponse(`Password must not exceed ${MAX_PASSWORD_LENGTH} characters`);
  }

  const pendingPasswordHash = hashPassword(newPassword);

  // Atomically consume the token and either:
  // - finalize the password reset for non-TOTP users, or
  // - issue a short-lived MFA-pending reset token for TOTP-enabled users.
  const result = await transaction(async (client) => {
    // Consume the token FIRST — only the first concurrent request will succeed
    const consumed = await client.query<{ id: string; email: string }>(
      `UPDATE magic_links SET used_at = now()
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
         AND email LIKE 'password_reset:%'
       RETURNING id, email`,
      [hashToken(token)]
    );
    if (consumed.rowCount === 0) return null;

    const userId = consumed.rows[0].email.slice('password_reset:'.length);
    if (!userId) return null;

    const user = await client.query<{ id: string; totp_enabled: boolean }>(
      'SELECT id, totp_enabled FROM users WHERE id = $1',
      [userId]
    );
    if (user.rowCount === 0) return null;

    if (user.rows[0].totp_enabled) {
      const pendingToken = generateToken();
      const encryptedPendingPasswordHash = encrypt(
        pendingPasswordHash,
        `password_reset_pending:${userId}`
      );
      await client.query(
        `INSERT INTO magic_links (token_hash, email, expires_at)
         VALUES ($1, $2, $3)`,
        [
          hashToken(pendingToken),
          `password_reset_mfa_pending_v2:${userId}:${encryptedPendingPasswordHash}`,
          new Date(Date.now() + 5 * 60 * 1000),
        ]
      );
      return { userId, requiresMfa: true as const, pendingToken };
    }

    // THEN update the password (safe — token is already consumed)
    await client.query(
      'UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2',
      [pendingPasswordHash, userId]
    );

    // Invalidate all existing sessions
    await client.query('DELETE FROM sessions WHERE user_id = $1', [userId]);

    return { userId, requiresMfa: false as const };
  });

  if (!result) {
    return errorResponse('Invalid or expired reset link', 400);
  }

  const { userId } = result;

  if (result.requiresMfa) {
    return jsonResponse(
      {
        needs_mfa: true,
        mfa_pending_token: result.pendingToken,
      },
      401
    );
  }

  await logAudit({
    user_id: userId,
    action: 'auth.password_reset_completed',
    ip_address: getClientIp(request),
  });

  return jsonResponse(
    { message: 'Password reset successful. Please sign in again.' },
    200,
    { 'Set-Cookie': clearSessionCookie() }
  );
};
