import type { Context } from '@netlify/functions';
import { query, queryOne, execute } from './_lib/db.js';
import { setSessionCookie, SESSION_MAX_AGE_MILLISECONDS } from './_lib/auth.js';
import { logAudit } from './_lib/audit.js';
import { jsonResponse, errorResponse, parseJsonBody, getClientIp } from './_lib/helpers.js';
import { decrypt, encrypt, generateToken, hashToken } from './_lib/crypto.js';
import { consumeBackupCode, verifyTOTP } from './_lib/totp.js';
import { consumeToken } from './_lib/rate-limiter.js';
import { createHash, randomUUID, timingSafeEqual, scryptSync, randomBytes } from 'crypto';

const SCRYPT_COST = 16384; // N=2^14 — good balance of security and speed for serverless
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_KEY_LENGTH = 64;

function hashPasswordScrypt(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
  });
  return `$flash2$${salt}$${derived.toString('hex')}`;
}

const DUMMY_PASSWORD_HASH = hashPasswordScrypt('flash_dummy_password_timing_normalization');

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (hash.startsWith('$flash2$')) {
    // New scrypt format
    const parts = hash.split('$');
    const salt = parts[2];
    const storedHash = parts[3];
    const derived = scryptSync(password, salt, SCRYPT_KEY_LENGTH, {
      N: SCRYPT_COST,
      r: SCRYPT_BLOCK_SIZE,
      p: SCRYPT_PARALLELIZATION,
    });
    const a = derived;
    const b = Buffer.from(storedHash, 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  if (hash.startsWith('$flash$')) {
    // Legacy SHA-256 format — verify but flag for migration
    const parts = hash.split('$');
    const salt = parts[2];
    const storedHash = parts[3];
    const computed = createHash('sha256').update(password + salt).digest('hex');
    const a = Buffer.from(computed);
    const b = Buffer.from(storedHash);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  return false;
}

export function hashPassword(password: string): string {
  return hashPasswordScrypt(password);
}

interface LoginBody {
  email: string;
  password: string;
  totp_code?: string;
}

function normalizeLoginEmail(email: string): string {
  return email.toLowerCase().trim();
}

function retryAfterHeader(retryAfterMs?: number): Record<string, string> {
  if (!retryAfterMs) return {};
  return { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterMs / 1000))) };
}

function throttledLoginResponse(retryAfterMs?: number): Response {
  return jsonResponse(
    { error: 'Too many login attempts. Please try again later.' },
    429,
    retryAfterHeader(retryAfterMs)
  );
}

export default async (request: Request, context: Context) => {
  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  const body = await parseJsonBody<LoginBody>(request);
  const { email, password, totp_code } = body;

  if (!email || !password) {
    return errorResponse('Email and password are required');
  }

  const normalizedEmail = normalizeLoginEmail(email);

  // Rate limit by IP: 10 attempts per 15 minutes
  const ip = getClientIp(request);
  const ipLimit = await consumeToken(`auth:login:ip:${ip}`, 1, 10, 10 / 900);
  if (!ipLimit.allowed) {
    return throttledLoginResponse(ipLimit.retryAfterMs);
  }

  // Secondary rate limit by normalized account identifier: 5 attempts per 15 minutes
  const accountLimit = await consumeToken(`auth:login:acct:${normalizedEmail}`, 1, 5, 5 / 900);
  if (!accountLimit.allowed) {
    return throttledLoginResponse(accountLimit.retryAfterMs);
  }

  // Find user
  const user = await queryOne<{
    id: string; email: string; password_hash: string | null;
    first_name: string; last_name: string; is_superadmin: boolean;
    totp_enabled: boolean; totp_secret_enc: string | null; totp_backup_codes_enc: string | null;
  }>(
    `SELECT u.id, u.email, u.password_hash, u.first_name, u.last_name, u.is_superadmin,
            u.totp_enabled, u.totp_secret_enc,
            u.totp_backup_codes_enc
     FROM users u
     WHERE u.email = $1`,
    [normalizedEmail]
  );

  if (!user || !user.password_hash) {
    await verifyPassword(password, DUMMY_PASSWORD_HASH);
    return errorResponse('Invalid email or password', 401);
  }

  const passwordValid = await verifyPassword(password, user.password_hash);
  if (!passwordValid) {
    await logAudit({
      user_id: user.id,
      action: 'auth.login_failed',
      details: { reason: 'invalid_password' },
      ip_address: getClientIp(request),
    });
    return errorResponse('Invalid email or password', 401);
  }

  // Migrate legacy SHA-256 hash to scrypt on successful login
  if (user.password_hash.startsWith('$flash$')) {
    const newHash = hashPassword(password);
    await execute(
      'UPDATE users SET password_hash = $1 WHERE id = $2 AND password_hash = $3',
      [newHash, user.id, user.password_hash]
    );
  }

  // TOTP check
  if (user.totp_enabled) {
    if (!totp_code) {
      return jsonResponse({ needs_totp: true }, 401);
    }

    const totpIpLimit = await consumeToken(`auth:login:totp:ip:${ip}`, 1, 10, 10 / 300);
    if (!totpIpLimit.allowed) {
      return throttledLoginResponse(totpIpLimit.retryAfterMs);
    }

    const totpUserLimit = await consumeToken(`auth:login:totp:user:${user.id}`, 1, 5, 5 / 300);
    if (!totpUserLimit.allowed) {
      return throttledLoginResponse(totpUserLimit.retryAfterMs);
    }

    let totpValid = false;
    if (user.totp_secret_enc) {
      try {
        const totpSecret = decrypt(user.totp_secret_enc, `totp:${user.id}`);
        totpValid = verifyTOTP(totpSecret, totp_code);
      } catch {
        return errorResponse('Failed to verify TOTP. Contact support.', 500);
      }
    }

    let backupCodeUsed = false;
    if (!totpValid && user.totp_backup_codes_enc) {
      try {
        const decryptedBackupCodes = decrypt(user.totp_backup_codes_enc, `totp_backup:${user.id}`);
        const backupCodes = JSON.parse(decryptedBackupCodes) as string[];
        const consumeResult = consumeBackupCode(backupCodes, totp_code);
        if (consumeResult.matched) {
          const nextEnc = encrypt(JSON.stringify(consumeResult.remainingCodes), `totp_backup:${user.id}`);
          const updateResult = await execute(
            'UPDATE users SET totp_backup_codes_enc = $1, updated_at = now() WHERE id = $2 AND totp_backup_codes_enc = $3',
            [nextEnc, user.id, user.totp_backup_codes_enc]
          );
          if (updateResult.rowCount > 0) {
            backupCodeUsed = true;
            await logAudit({
              user_id: user.id,
              action: 'auth.backup_code_used',
              details: { remaining_codes: consumeResult.remainingCodes.length },
              ip_address: getClientIp(request),
            });
          }
        }
      } catch {
        return errorResponse('Failed to verify backup code. Contact support.', 500);
      }
    }

    if (!totpValid && !backupCodeUsed) {
      await logAudit({
        user_id: user.id,
        action: 'auth.login_failed',
        details: { reason: 'invalid_totp' },
        ip_address: getClientIp(request),
      });
      return errorResponse('Invalid TOTP code', 401);
    }
  }

  // Create session — store hash in DB, send plaintext token in cookie
  const sessionToken = generateToken();
  const sessionTokenHash = hashToken(sessionToken);
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MILLISECONDS);

  // Get user's first workspace membership for default context
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
    [getClientIp(request), 'password', user.id]
  );

  await logAudit({
    user_id: user.id,
    workspace_id: membership?.workspace_id ?? undefined,
    action: 'auth.login',
    details: { method: 'password' },
    ip_address: getClientIp(request),
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

export { hashPassword as _hashPassword, verifyPassword as _verifyPassword };
