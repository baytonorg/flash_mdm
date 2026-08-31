import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  end: vi.fn(),
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
    mocks.end.mockReset().mockResolvedValue(undefined);
    mocks.on.mockReset();
    mocks.query.mockReset().mockResolvedValue({ rows: [{ ok: 1 }] });
    mocks.Pool.mockReset().mockImplementation(function PoolMock() {
      return {
        end: mocks.end,
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

  it('closes and clears the active pool during graceful worker shutdown', async () => {
    const { closeDatabasePool, query } = await import('../db.js');

    await query('SELECT 1');
    await closeDatabasePool();
    await closeDatabasePool();

    expect(mocks.end).toHaveBeenCalledTimes(1);
  });
});
