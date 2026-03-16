import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isBlockedResolvedIp,
  validateResolvedWebhookUrlForOutbound,
  validateWebhookUrlForOutbound,
} from '../webhook-ssrf.ts';

const mockLookup = vi.fn();

beforeEach(() => {
  mockLookup.mockReset();
});

describe('validateWebhookUrlForOutbound', () => {
  it.each([
    'http://example.com/hook',
    'https://localhost/hook',
    'https://192.168.1.5/hook',
    'https://metadata.google.internal/hook',
    'https://svc.internal/hook',
  ])('rejects unsafe webhook target: %s', (url) => {
    const result = validateWebhookUrlForOutbound(url);
    expect(result.ok).toBe(false);
  });

  it('accepts normal public HTTPS URLs', () => {
    const result = validateWebhookUrlForOutbound('https://example.com/webhook');
    expect(result).toEqual({
      ok: true,
      url: new URL('https://example.com/webhook'),
    });
  });

  it('blocks sensitive resolved IP ranges including IPv4-mapped IPv6', () => {
    expect(isBlockedResolvedIp('0.0.0.0')).toBe(true);
    expect(isBlockedResolvedIp('169.254.169.254')).toBe(true);
    expect(isBlockedResolvedIp('::ffff:169.254.169.254')).toBe(true);
    expect(isBlockedResolvedIp('::ffff:0a00:0001')).toBe(true); // 10.0.0.1
    expect(isBlockedResolvedIp('8.8.8.8')).toBe(false);
    expect(isBlockedResolvedIp('2606:4700:4700::1111')).toBe(false);
  });

  it('rejects hostnames that resolve to blocked addresses', async () => {
    mockLookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);

    await expect(
      validateResolvedWebhookUrlForOutbound('https://hooks.example.com/webhook', mockLookup)
    ).resolves.toEqual({ ok: false, error: 'Webhook URL resolves to a blocked address' });
  });

  it('accepts hostnames that resolve to public addresses', async () => {
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);

    await expect(validateResolvedWebhookUrlForOutbound('https://example.com/webhook', mockLookup)).resolves.toEqual({
      ok: true,
      url: new URL('https://example.com/webhook'),
    });
  });
});
