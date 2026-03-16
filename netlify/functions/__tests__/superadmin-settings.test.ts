import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/auth.js', () => ({
  requireSuperadmin: vi.fn(),
}));

vi.mock('../_lib/platform-settings.js', () => ({
  getPlatformSettings: vi.fn(),
  setPlatformSettings: vi.fn(),
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

import { requireSuperadmin } from '../_lib/auth.js';
import { getPlatformSettings, setPlatformSettings } from '../_lib/platform-settings.js';
import { logAudit } from '../_lib/audit.js';
import handler from '../superadmin-settings.ts';

const mockRequireSuperadmin = vi.mocked(requireSuperadmin);
const mockGetPlatformSettings = vi.mocked(getPlatformSettings);
const mockSetPlatformSettings = vi.mocked(setPlatformSettings);
const mockLogAudit = vi.mocked(logAudit);

beforeEach(() => {
  mockRequireSuperadmin.mockReset();
  mockGetPlatformSettings.mockReset();
  mockSetPlatformSettings.mockReset();
  mockLogAudit.mockReset();

  mockRequireSuperadmin.mockResolvedValue({
    sessionId: 'sess_1',
    user: { id: 'sa_1', is_superadmin: true, email: 'sa@example.com' },
  } as never);
});

describe('superadmin-settings', () => {
  it('returns current platform settings for superadmins', async () => {
    mockGetPlatformSettings.mockResolvedValueOnce({
      invite_only_registration: false,
      licensing_enabled: true,
      default_free_enabled: true,
      default_free_seat_limit: 10,
    });

    const res = await handler(new Request('http://localhost/api/superadmin/settings'), {} as never);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      invite_only_registration: false,
      licensing_enabled: true,
      default_free_enabled: true,
      default_free_seat_limit: 10,
    });
    expect(mockRequireSuperadmin).toHaveBeenCalledTimes(1);
  });

  it('updates invite-only registration mode and audits the change', async () => {
    mockGetPlatformSettings.mockResolvedValue({
      invite_only_registration: true,
      licensing_enabled: true,
      default_free_enabled: true,
      default_free_seat_limit: 10,
    });

    const res = await handler(new Request('http://localhost/api/superadmin/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({ invite_only_registration: true }),
    }), {} as never);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      message: 'Platform settings updated',
      invite_only_registration: true,
      licensing_enabled: true,
      default_free_enabled: true,
      default_free_seat_limit: 10,
    });
    expect(mockSetPlatformSettings).toHaveBeenCalledWith({
      invite_only_registration: true,
      licensing_enabled: undefined,
      default_free_enabled: undefined,
      default_free_seat_limit: undefined,
    }, 'sa_1');
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'sa_1',
      action: 'superadmin.platform_settings.updated',
      details: expect.objectContaining({
        invite_only_registration: true,
        licensing_enabled: true,
        default_free_enabled: true,
        default_free_seat_limit: 10,
      }),
    }));
  });
});
