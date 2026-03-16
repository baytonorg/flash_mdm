import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getMasterKey(): Buffer {
  const key = process.env.ENCRYPTION_MASTER_KEY;
  if (!key) throw new Error('ENCRYPTION_MASTER_KEY environment variable is required');
  // Accept hex (64 chars) or base64 (44 chars)
  if (key.length === 64) return Buffer.from(key, 'hex');
  return Buffer.from(key, 'base64');
}

function deriveAad(domain: string): Buffer {
  return createHash('sha256').update(domain).digest();
}

export function encrypt(plaintext: string, domain: string): string {
  const key = getMasterKey();
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
  if (!envelope.startsWith('v1.')) throw new Error('Unknown encryption envelope version');
  const parts = envelope.split('.');
  if (parts.length !== 4) throw new Error('Invalid encryption envelope format');
  const [, ivB64, tagB64, ciphertextB64] = parts;
  const key = getMasterKey();
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
