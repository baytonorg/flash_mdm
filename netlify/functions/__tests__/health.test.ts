import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/db.js', () => ({ queryOne: vi.fn() }));

import { queryOne } from '../_lib/db.js';
import handler from '../health.ts';

const mockQueryOne = vi.mocked(queryOne);

beforeEach(() => {
  mockQueryOne.mockReset();
  process.env.FLASH_RUNTIME = 'vps';
  process.env.FLASH_RELEASE_COMMIT = '0123456789abcdef';
});

describe('health', () => {
  it('reports database readiness and the deployed commit', async () => {
    mockQueryOne.mockResolvedValueOnce({ ok: 1 });

    const response = await handler(new Request('https://flash.example/api/health'), {} as never);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      database: 'ok',
      version: '0123456789abcdef',
      runtime: 'vps',
    });
  });

  it('returns 503 without disclosing database error details', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('connection secret detail'));

    const response = await handler(new Request('https://flash.example/api/health'), {} as never);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: 'degraded',
      database: 'unavailable',
      version: '0123456789abcdef',
      runtime: 'vps',
    });
  });

  it('rejects non-GET requests', async () => {
    const response = await handler(
      new Request('https://flash.example/api/health', { method: 'POST' }),
      {} as never
    );

    expect(response.status).toBe(405);
    expect(mockQueryOne).not.toHaveBeenCalled();
  });
});
