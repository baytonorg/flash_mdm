import { describe, it, expect, beforeAll, vi } from 'vitest';
import { randomBytes } from 'crypto';

// Set up the env var before importing the module
const TEST_KEY = randomBytes(32).toString('hex');

beforeAll(() => {
  process.env.ENCRYPTION_MASTER_KEY = TEST_KEY;
});

import { encrypt, decrypt, hashToken, generateToken } from '../crypto.js';

describe('encrypt and decrypt', () => {
  it('roundtrips a simple string', () => {
    const plaintext = 'hello world';
    const domain = 'test.example.com';
    const envelope = encrypt(plaintext, domain);
    expect(decrypt(envelope, domain)).toBe(plaintext);
  });

  it('roundtrips an empty string', () => {
    const envelope = encrypt('', 'test.example.com');
    expect(decrypt(envelope, 'test.example.com')).toBe('');
  });

  it('roundtrips unicode content', () => {
    const plaintext = 'Hello \u{1F600} \u00E9\u00E8\u00EA \u4F60\u597D \u0627\u0644\u0639\u0631\u0628\u064A\u0629';
    const envelope = encrypt(plaintext, 'unicode.test');
    expect(decrypt(envelope, 'unicode.test')).toBe(plaintext);
  });

  it('roundtrips a large payload', () => {
    const plaintext = 'x'.repeat(10000);
    const envelope = encrypt(plaintext, 'large.test');
    expect(decrypt(envelope, 'large.test')).toBe(plaintext);
  });

  it('roundtrips JSON content', () => {
    const obj = { key: 'value', nested: { arr: [1, 2, 3] } };
    const plaintext = JSON.stringify(obj);
    const envelope = encrypt(plaintext, 'json.test');
    expect(JSON.parse(decrypt(envelope, 'json.test'))).toEqual(obj);
  });

  it('produces envelope starting with v1.', () => {
    const envelope = encrypt('test', 'domain');
    expect(envelope.startsWith('v1.')).toBe(true);
  });

  it('produces envelope with 4 dot-separated parts', () => {
    const envelope = encrypt('test', 'domain');
    expect(envelope.split('.').length).toBe(4);
  });

  it('produces different ciphertext for different domains (AAD)', () => {
    const plaintext = 'same plaintext';
    const env1 = encrypt(plaintext, 'domain-a.com');
    const env2 = encrypt(plaintext, 'domain-b.com');
    // The ciphertext portions should differ (different AAD + different random IV)
    expect(env1).not.toBe(env2);
  });

  it('fails to decrypt with a different domain', () => {
    const envelope = encrypt('secret', 'domain-a.com');
    expect(() => decrypt(envelope, 'domain-b.com')).toThrow();
  });

  it('throws on tampered ciphertext', () => {
    const envelope = encrypt('secret data', 'test.com');
    const parts = envelope.split('.');
    // Tamper with the ciphertext (last part)
    const ciphertextBuf = Buffer.from(parts[3], 'base64url');
    ciphertextBuf[0] ^= 0xff;
    parts[3] = ciphertextBuf.toString('base64url');
    const tampered = parts.join('.');
    expect(() => decrypt(tampered, 'test.com')).toThrow();
  });

  it('throws on tampered auth tag', () => {
    const envelope = encrypt('secret data', 'test.com');
    const parts = envelope.split('.');
    // Tamper with the tag (second part)
    const tagBuf = Buffer.from(parts[2], 'base64url');
    tagBuf[0] ^= 0xff;
    parts[2] = tagBuf.toString('base64url');
    const tampered = parts.join('.');
    expect(() => decrypt(tampered, 'test.com')).toThrow();
  });

  it('throws on unknown envelope version', () => {
    expect(() => decrypt('v2.abc.def.ghi', 'test.com')).toThrow('Unknown encryption envelope version');
  });

  it('throws on invalid envelope format (wrong part count)', () => {
    expect(() => decrypt('v1.abc.def', 'test.com')).toThrow('Invalid encryption envelope format');
  });
});

describe('hashToken', () => {
  it('produces consistent SHA-256 hex output', () => {
    const token = 'my-secret-token';
    const hash1 = hashToken(token);
    const hash2 = hashToken(token);
    expect(hash1).toBe(hash2);
  });

  it('produces a 64 character hex string', () => {
    const hash = hashToken('test');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different hashes for different tokens', () => {
    expect(hashToken('token-a')).not.toBe(hashToken('token-b'));
  });

  it('handles empty string', () => {
    const hash = hashToken('');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('generateToken', () => {
  it('produces a 64 character hex string (32 bytes)', () => {
    const token = generateToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces unique tokens on each call', () => {
    const tokens = new Set(Array.from({ length: 20 }, () => generateToken()));
    expect(tokens.size).toBe(20);
  });
});
