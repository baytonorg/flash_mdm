import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export function parseEncryptionKey(key: string, label = 'encryption key'): Buffer {
  let parsed: Buffer;
  if (/^[0-9a-f]{64}$/i.test(key)) parsed = Buffer.from(key, 'hex');
  else {
    if (!/^[A-Za-z0-9+/]{43}=$/.test(key) && !/^[A-Za-z0-9+/]{43}$/.test(key)) {
      throw new Error(`${label} must be a 32-byte hex or base64 value`);
    }
    parsed = Buffer.from(key, 'base64');
  }
  if (parsed.length !== 32) throw new Error(`${label} must decode to exactly 32 bytes`);
  return parsed;
}

function getMasterKey(): Buffer {
  const key = process.env.ENCRYPTION_MASTER_KEY;
  if (!key) throw new Error('ENCRYPTION_MASTER_KEY environment variable is required');
  return parseEncryptionKey(key, 'ENCRYPTION_MASTER_KEY');
}

function deriveAad(domain: string): Buffer {
  return createHash('sha256').update(domain).digest();
}

export function encrypt(plaintext: string, domain: string): string {
  return encryptWithKey(plaintext, domain, getMasterKey());
}

export function encryptWithKey(plaintext: string, domain: string, key: Buffer): string {
  if (key.length !== 32) throw new Error('Encryption key must be exactly 32 bytes');
  const iv = randomBytes(IV_LENGTH);
  const aad = deriveAad(domain);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: v1.<base64url-iv>.<base64url-tag>.<base64url-ciphertext>
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decrypt(envelope: string, domain: string): string {
  return decryptWithKey(envelope, domain, getMasterKey());
}

export function decryptWithKey(envelope: string, domain: string, key: Buffer): string {
  if (!envelope.startsWith('v1.')) throw new Error('Unknown encryption envelope version');
  const parts = envelope.split('.');
  if (parts.length !== 4) throw new Error('Invalid encryption envelope format');
  const [, ivB64, tagB64, ciphertextB64] = parts;
  if (key.length !== 32) throw new Error('Encryption key must be exactly 32 bytes');
  const iv = Buffer.from(ivB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  const ciphertext = Buffer.from(ciphertextB64, 'base64url');
  const aad = deriveAad(domain);
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext) + decipher.final('utf8');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateToken(): string {
  return randomBytes(32).toString('hex');
}
