import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db.js', () => ({
  execute: vi.fn(),
  queryOne: vi.fn(),
}));

import { execute, queryOne } from '../db.js';
import { setPlatformSettings } from '../platform-settings.js';

const mockExecute = vi.mocked(execute);
const mockQueryOne = vi.mocked(queryOne);

beforeEach(() => {
  mockExecute.mockReset();
  mockQueryOne.mockReset();
});

describe('setPlatformSettings', () => {
  it('falls back to legacy free-tier columns when licensing column is missing', async () => {
    mockQueryOne.mockResolvedValueOnce({
      invite_only_registration: false,
      licensing_enabled: true,
      default_free_enabled: true,
      default_free_seat_limit: 10,
    } as never);

    const missingColumnErr = Object.assign(new Error('column "licensing_enabled" does not exist'), { code: '42703' });
    mockExecute
      .mockRejectedValueOnce(missingColumnErr)
      .mockResolvedValueOnce({ rowCount: 1 });

    await setPlatformSettings({ invite_only_registration: true }, 'user_1');

    expect(mockExecute).toHaveBeenCalledTimes(2);
    expect(String(mockExecute.mock.calls[0]?.[0])).toContain('licensing_enabled');
    expect(String(mockExecute.mock.calls[1]?.[0])).toContain('default_free_enabled');
    expect(String(mockExecute.mock.calls[1]?.[0])).not.toContain('licensing_enabled');
  });

  it('falls back to invite-only update when free-tier columns are also missing', async () => {
    mockQueryOne.mockResolvedValueOnce({
      invite_only_registration: false,
      licensing_enabled: true,
      default_free_enabled: true,
      default_free_seat_limit: 10,
    } as never);

    const missingColumnErr = Object.assign(new Error('column does not exist'), { code: '42703' });
    mockExecute
      .mockRejectedValueOnce(missingColumnErr)
      .mockRejectedValueOnce(missingColumnErr)
      .mockResolvedValueOnce({ rowCount: 1 });

    await setPlatformSettings({ invite_only_registration: true }, 'user_1');

    expect(mockExecute).toHaveBeenCalledTimes(3);
    expect(String(mockExecute.mock.calls[2]?.[0])).toContain('invite_only_registration');
    expect(String(mockExecute.mock.calls[2]?.[0])).not.toContain('default_free_enabled');
  });
});
