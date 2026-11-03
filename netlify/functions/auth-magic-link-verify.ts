import type { Context } from '@netlify/functions';
import { queryOne, execute, transaction } from './_lib/db.js';
import { hashToken, generateToken } from './_lib/crypto.js';
import { setSessionCookie, SESSION_MAX_AGE_MILLISECONDS } from './_lib/auth.js';
import { logAudit } from './_lib/audit.js';
import { getClientIp } from './_lib/helpers.js';
import { randomUUID } from 'crypto';

export default async (request: Request, context: Context) => {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  const redirectPath = sanitizeRedirectPath(url.searchParams.get('redirect'));
  const baseUrl = process.env.URL ?? process.env.DEPLOY_PRIME_URL ?? 'http://localhost:8888';

  if (!token) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: buildLoginLocation(baseUrl, 'invalid_magic_link', redirectPath),
      },
    });
  }

  const tokenHash = hashToken(token);

  // Atomically find, validate, and consume the magic link in one step to prevent TOCTOU races
  const link = await transaction(async (client) => {
    const result = await client.query<{ user_id: string }>(
      `UPDATE magic_links SET used_at = now() FROM users u
       WHERE magic_links.token_hash = $1 AND magic_links.used_at IS NULL AND magic_links.expires_at > now()
         AND u.email = magic_links.email AND u.created_at <= magic_links.created_at
       RETURNING u.id AS user_id`, [tokenHash]);
    return result.rows[0];

  });

  if (!link) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: buildLoginLocation(baseUrl, 'expired_or_used_magic_link', redirectPath),
      },
    });
  }

  // Use the identity matched while consuming the link, even if this email
  // is re-registered before the session write.
  const user = { id: link.user_id };

  // Check if user has TOTP enabled — require MFA verification
  const userFull = await queryOne<{ totp_enabled: boolean }>(
    'SELECT totp_enabled FROM users WHERE id = $1',
    [user.id]
  );

  if (userFull?.totp_enabled) {
    // Store a pending MFA session token instead of creating a full session
    const mfaPendingToken = randomUUID();
    await execute(
      `INSERT INTO magic_links (token_hash, email, expires_at)
       VALUES ($1, $2, $3)`,
      [hashToken(mfaPendingToken), `mfa_pending:${user.id}`, new Date(Date.now() + 5 * 60 * 1000)]
    );

    // Redirect to TOTP verification page with pending token
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${baseUrl}/login?mfa_pending=${mfaPendingToken}${
          redirectPath ? `&redirect=${encodeURIComponent(redirectPath)}` : ''
        }`,
      },
    });
  }

  // Create session — store hash in DB, send plaintext token in cookie
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
    [sessionTokenHash, user.id, membership?.workspace_id ?? null, getClientIp(request), request.headers.get('user-agent'), expiresAt]
  );

  // Update last login
  await execute(
    'UPDATE users SET last_login_at = now(), last_login_ip = $1, last_login_method = $2 WHERE id = $3',
    [getClientIp(request), 'magic_link', user.id]
  );

  await logAudit({
    user_id: user.id,
    workspace_id: membership?.workspace_id ?? undefined,
    action: 'auth.login',
    details: { method: 'magic_link' },
    ip_address: getClientIp(request),
  });

  // Redirect to app with session cookie
  return new Response(null, {
    status: 302,
    headers: {
      Location: redirectPath ? `${baseUrl}${redirectPath}` : baseUrl,
      'Set-Cookie': setSessionCookie(sessionToken),
    },
  });
};

function sanitizeRedirectPath(value: string | null): string | null {
  if (!value) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  return value;
}

function buildLoginLocation(baseUrl: string, code: 'invalid_magic_link' | 'expired_or_used_magic_link', redirectPath: string | null): string {
  const loginUrl = new URL('/login', baseUrl);
  loginUrl.searchParams.set('auth_error', code);
  if (redirectPath) {
    loginUrl.searchParams.set('redirect', redirectPath);
  }
  return loginUrl.toString();
}
