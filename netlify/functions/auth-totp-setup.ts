import type { Context } from '@netlify/functions';
import { randomBytes } from 'crypto';
import { execute, queryOne } from './_lib/db.js';
import { requireSessionAuth } from './_lib/auth.js';
import { encrypt } from './_lib/crypto.js';
import { logAudit } from './_lib/audit.js';
import { jsonResponse, errorResponse, getClientIp, retryAfterHeader } from './_lib/helpers.js';
import { consumeToken } from './_lib/rate-limiter.js';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Encode a Buffer as a base32 string (RFC 4648).
 */
function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

/**
 * Generate a set of one-time backup codes.
 */
function generateBackupCodes(count: number = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    // 8-character alphanumeric codes, grouped as XXXX-XXXX
    const raw = randomBytes(5).toString('hex').slice(0, 8).toUpperCase();
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4)}`);
  }
  return codes;
}

export default async (request: Request, context: Context) => {
  void context;
  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    const auth = await requireSessionAuth(request);
    const clientIp = getClientIp(request);

    const ipLimit = await consumeToken(`auth:totp-setup:ip:${clientIp}`, 1, 10, 10 / 900);
    if (!ipLimit.allowed) {
      return jsonResponse(
        { error: 'Too many TOTP setup attempts. Please try again later.' },
        429,
        retryAfterHeader(ipLimit.retryAfterMs)
      );
    }

    const userLimit = await consumeToken(`auth:totp-setup:user:${auth.user.id}`, 1, 5, 5 / 900);
    if (!userLimit.allowed) {
      return jsonResponse(
        { error: 'Too many TOTP setup attempts. Please try again later.' },
        429,
        retryAfterHeader(userLimit.retryAfterMs)
      );
    }

    // Check if TOTP is already enabled
    const user = await queryOne<{ totp_enabled: boolean }>(
      'SELECT totp_enabled FROM users WHERE id = $1',
      [auth.user.id]
    );

    if (user?.totp_enabled) {
      return errorResponse('TOTP is already enabled. Disable it first before setting up again.');
    }

    // Generate a 20-byte TOTP secret (160 bits, standard for TOTP)
    const secretBytes = randomBytes(20);
    const secret = base32Encode(secretBytes);

    // Generate backup codes
    const backupCodes = generateBackupCodes(10);

    // Build the otpauth:// URI
    const issuer = 'FlashMDM';
    const label = `${issuer}:${auth.user.email}`;
    const qrUrl = `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

    // Store the pending TOTP setup encrypted (not yet verified)
    const pendingData = JSON.stringify({
      secret,
      backup_codes: backupCodes,
      created_at: new Date().toISOString(),
    });
    const encryptedPending = encrypt(pendingData, `totp_pending:${auth.user.id}`);

    await execute(
      'UPDATE users SET totp_pending_enc = $1, totp_pending_created_at = now() WHERE id = $2',
      [encryptedPending, auth.user.id]
    );

    await logAudit({
      user_id: auth.user.id,
      action: 'auth.totp_setup_initiated',
      resource_type: 'user',
      resource_id: auth.user.id,
      ip_address: getClientIp(request),
    });

    return jsonResponse({
      secret,
      qr_url: qrUrl,
      backup_codes: backupCodes,
    });
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
};
