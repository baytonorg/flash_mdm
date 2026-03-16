import { createHmac } from 'crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(encoded: string): Buffer {
  const cleanInput = encoded.replace(/=+$/, '').toUpperCase();
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;

  for (const char of cleanInput) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

function generateTOTP(secret: string, timeStep: number): string {
  const key = base32Decode(secret);
  const timeBuffer = Buffer.alloc(8);
  timeBuffer.writeUInt32BE(0, 0);
  timeBuffer.writeUInt32BE(timeStep, 4);

  const hmac = createHmac('sha1', key).update(timeBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return (code % 1000000).toString().padStart(6, '0');
}

function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function normalizeBackupCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9-]/g, '');
}

/**
 * Verify a TOTP code against a secret, allowing +/- 1 time step window.
 */
export function verifyTOTP(secret: string, code: string): boolean {
  const currentStep = Math.floor(Date.now() / 1000 / 30);

  for (let i = -1; i <= 1; i++) {
    const expected = generateTOTP(secret, currentStep + i);
    if (timingSafeStringEqual(code, expected)) {
      return true;
    }
  }
  return false;
}

export function consumeBackupCode(
  backupCodes: string[],
  candidate: string,
): { matched: boolean; remainingCodes: string[] } {
  const normalizedCandidate = normalizeBackupCode(candidate);
  const remaining: string[] = [];
  let matched = false;

  for (const code of backupCodes) {
    const normalized = normalizeBackupCode(code);
    if (!matched && timingSafeStringEqual(normalizedCandidate, normalized)) {
      matched = true;
      continue;
    }
    remaining.push(code);
  }

  return { matched, remainingCodes: remaining };
}
