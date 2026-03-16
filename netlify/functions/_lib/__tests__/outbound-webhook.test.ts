import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../webhook-ssrf.js', () => ({
  validateResolvedWebhookUrlForOutbound: vi.fn(),
}));

import { validateResolvedWebhookUrlForOutbound } from '../webhook-ssrf.js';
import { executeValidatedOutboundWebhook } from '../outbound-webhook.ts';

const mockValidateResolvedWebhookUrlForOutbound = vi.mocked(validateResolvedWebhookUrlForOutbound);

describe('executeValidatedOutboundWebhook', () => {
  beforeEach(() => {
    mockValidateResolvedWebhookUrlForOutbound.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects outbound webhook execution when DNS-aware validation fails', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    mockValidateResolvedWebhookUrlForOutbound.mockResolvedValueOnce({
      ok: false,
      error: 'Webhook URL resolves to a blocked address',
    });

    await expect(
      executeValidatedOutboundWebhook({ url: 'https://hooks.example.test/webhook' })
    ).rejects.toThrow('Webhook URL resolves to a blocked address');

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('enforces redirect:error and reuses validated URL for outbound fetch', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    mockValidateResolvedWebhookUrlForOutbound.mockResolvedValueOnce({
      ok: true,
      url: new URL('https://hooks.example.test/webhook'),
    });

    const response = await executeValidatedOutboundWebhook({
      url: 'https://hooks.example.test/webhook',
      method: 'PATCH',
      body: { hello: 'world' },
      headers: { 'X-Test': '1' },
    });

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledWith(
      new URL('https://hooks.example.test/webhook'),
      expect.objectContaining({
        method: 'PATCH',
        redirect: 'error',
        body: JSON.stringify({ hello: 'world' }),
      })
    );
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        'Content-Type': 'application/json',
        'X-Test': '1',
      },
    });
  });
});
