import type { Context } from '@netlify/functions';
import { queryOne, execute } from './_lib/db.js';
import { requireSessionAuth, clearSessionCookie, getSessionTokenFromCookie } from './_lib/auth.js';
import { hashToken } from './_lib/crypto.js';
import { logAudit } from './_lib/audit.js';
import { jsonResponse, errorResponse, parseJsonBody, getClientIp } from './_lib/helpers.js';
import { hashPassword, _verifyPassword as verifyPassword } from './auth-login.js';
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from './_lib/password-policy.js';

interface PasswordChangeBody {
  current_password: string;
  new_password: string;
}

export default async (request: Request, _context: Context) => {
  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    const auth = await requireSessionAuth(request);
    const body = await parseJsonBody<PasswordChangeBody>(request);
    const currentPassword = body.current_password ?? '';
    const newPassword = body.new_password ?? '';

    if (!currentPassword || !newPassword) {
      return errorResponse('current_password and new_password are required');
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return errorResponse(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    if (newPassword.length > MAX_PASSWORD_LENGTH) {
      return errorResponse(`Password must not exceed ${MAX_PASSWORD_LENGTH} characters`);
    }

    const user = await queryOne<{ password_hash: string | null }>(
      'SELECT password_hash FROM users WHERE id = $1',
      [auth.user.id]
    );
    if (!user?.password_hash) {
      return errorResponse('Password login is not configured for this account', 400);
    }

    const validCurrent = await verifyPassword(currentPassword, user.password_hash);
    if (!validCurrent) {
      await logAudit({
        user_id: auth.user.id,
        action: 'auth.password_change_failed',
        details: { reason: 'invalid_current_password' },
        ip_address: getClientIp(request),
      });
      return errorResponse('Current password is incorrect', 401);
    }

    const nextHash = hashPassword(newPassword);
    await execute('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [nextHash, auth.user.id]);

    // Invalidate all sessions for the user, including the current one.
    await execute('DELETE FROM sessions WHERE user_id = $1', [auth.user.id]);

    const currentSessionToken = getSessionTokenFromCookie(request);
    const currentSessionId = currentSessionToken ? hashToken(currentSessionToken) : null;
    await logAudit({
      user_id: auth.user.id,
      action: 'auth.password_changed',
      details: { invalidated_all_sessions: true, current_session_id: currentSessionId },
      ip_address: getClientIp(request),
    });

    return jsonResponse(
      { message: 'Password changed. Please sign in again.' },
      200,
      { 'Set-Cookie': clearSessionCookie() }
    );
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
};
