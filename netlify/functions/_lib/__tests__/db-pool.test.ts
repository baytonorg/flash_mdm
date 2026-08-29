import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  on: vi.fn(),
  query: vi.fn(),
  Pool: vi.fn(),
}));

vi.mock('pg', () => ({
  default: {
    Pool: mocks.Pool,
  },
}));

describe('database pool', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.on.mockReset();
    mocks.query.mockReset().mockResolvedValue({ rows: [{ ok: 1 }] });
    mocks.Pool.mockReset().mockImplementation(function PoolMock() {
      return {
        on: mocks.on,
        query: mocks.query,
      };
    });
  });

  it('handles idle-client errors instead of leaving an uncaught pool event', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { query } = await import('../db.js');

    await expect(query('SELECT 1')).resolves.toEqual([{ ok: 1 }]);
    expect(mocks.on).toHaveBeenCalledWith('error', expect.any(Function));

    const listener = mocks.on.mock.calls.find(([event]) => event === 'error')?.[1];
    expect(() => listener(new Error('database restarting'))).not.toThrow();
    expect(consoleError).toHaveBeenCalledWith(
      'PostgreSQL idle client error:',
      'database restarting'
    );
    consoleError.mockRestore();
  });
});
