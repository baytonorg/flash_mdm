import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/platform-settings.js', () => ({
  getPlatformSettings: vi.fn(),
}));

import { getPlatformSettings } from '../_lib/platform-settings.js';
import handler from '../auth-config.ts';

const mockGetPlatformSettings = vi.mocked(getPlatformSettings);

beforeEach(() => {
  mockGetPlatformSettings.mockReset();
});

describe('auth-config', () => {
  it('returns public registration mode flags', async () => {
    mockGetPlatformSettings.mockResolvedValueOnce({
      invite_only_registration: true,
      licensing_enabled: true,
      default_free_enabled: true,
      default_free_seat_limit: 10,
    });

    const res = await handler(new Request('http://localhost/.netlify/functions/auth-config'), {} as never);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      invite_only_registration: true,
    });
  });

  it('falls back to open registration config when platform settings read fails', async () => {
    mockGetPlatformSettings.mockRejectedValueOnce(new Error('db unavailable'));

    const res = await handler(new Request('http://localhost/.netlify/functions/auth-config'), {} as never);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      invite_only_registration: false,
      fallback: true,
    });
  });
});
