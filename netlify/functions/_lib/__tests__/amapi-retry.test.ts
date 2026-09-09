import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../rate-limiter.js', () => ({
  checkAmapiRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

vi.mock('../crypto.js', () => ({
  decrypt: vi.fn(() => '{}'),
}));

vi.mock('../db.js', () => ({
  queryOne: vi.fn().mockResolvedValue({
    google_credentials_enc: 'encrypted-test-credentials',
    google_auth_mode: 'service_account',
  }),
}));

vi.mock('google-auth-library', () => {
  class GoogleAuth {
    async getClient() {
      return {
        getAccessToken: async () => ({ token: 'test-token' }),
      };
    }
  }
  return { GoogleAuth };
});

import {
  amapiCall,
  AmapiDeliveryUncertainError,
} from '../amapi.js';

function jsonResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: TimerHandler) => {
    if (typeof callback === 'function') callback();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout);
  vi.spyOn(Math, 'random').mockReturnValue(0);
});

describe('amapiCall retry policy', () => {
  it.each([502, 503, 504])('retries safe reads after HTTP %s', async (status) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(status, { error: { message: 'transient' } }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(amapiCall('enterprises/test', 'workspace-read', {
      projectId: 'project-test',
    })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries transport failures for safe reads', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('socket closed'))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(amapiCall('enterprises/test', 'workspace-transport-read', {
      projectId: 'project-test',
    })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('caps safe retries at three total attempts', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(502, { error: { message: 'one' } }))
      .mockResolvedValueOnce(jsonResponse(503, { error: { message: 'two' } }))
      .mockResolvedValueOnce(jsonResponse(504, { error: { message: 'three' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(amapiCall('enterprises/test', 'workspace-cap', {
      projectId: 'project-test',
    })).rejects.toThrow('AMAPI error (504): three');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries explicitly safe PATCH state updates', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(503, { error: { message: 'transient' } }))
      .mockResolvedValueOnce(jsonResponse(200, { state: 'DISABLED' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(amapiCall('enterprises/e/devices/d?updateMask=state', 'workspace-patch', {
      method: 'PATCH',
      body: { state: 'DISABLED' },
      projectId: 'project-test',
      retryMode: 'safe',
    })).resolves.toEqual({ state: 'DISABLED' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([502, 503, 504])('does not replay unsafe commands after HTTP %s', async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(status, { error: { message: 'transient' } })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(amapiCall('enterprises/e/devices/d:issueCommand', `workspace-command-${status}`, {
      method: 'POST',
      body: { type: 'REBOOT' },
      projectId: 'project-test',
      retryMode: 'never',
    })).rejects.toBeInstanceOf(AmapiDeliveryUncertainError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not replay unsafe commands after transport failures', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('socket closed'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(amapiCall('enterprises/e/devices/d:issueCommand', 'workspace-command-transport', {
      method: 'POST',
      body: { type: 'WIPE' },
      projectId: 'project-test',
      retryMode: 'never',
    })).rejects.toBeInstanceOf(AmapiDeliveryUncertainError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
