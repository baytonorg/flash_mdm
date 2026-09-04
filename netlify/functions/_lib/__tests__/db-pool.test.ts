import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  end: vi.fn(),
  on: vi.fn(),
  query: vi.fn(),
  connect: vi.fn(),
  clientQuery: vi.fn(),
  release: vi.fn(),
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
    mocks.clientQuery.mockReset().mockResolvedValue({ rows: [] });
    mocks.release.mockReset();
    mocks.connect.mockReset().mockResolvedValue({
      query: mocks.clientQuery,
      release: mocks.release,
    });
    mocks.Pool.mockReset().mockImplementation(function PoolMock() {
      return {
        end: mocks.end,
        on: mocks.on,
        query: mocks.query,
        connect: mocks.connect,
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

  it('tags direct pool network failures as PostgreSQL infrastructure errors', async () => {
    mocks.query.mockRejectedValueOnce(Object.assign(new Error('connection refused'), {
      code: 'ECONNREFUSED',
    }));
    const { query } = await import('../db.js');
    const { isDatabaseInfrastructureError } = await import('../db-errors.js');

    const error = await query('SELECT 1').catch((caught) => caught);

    expect(isDatabaseInfrastructureError(error)).toBe(true);
  });

  it('tags execute network failures as PostgreSQL infrastructure errors', async () => {
    mocks.query.mockRejectedValueOnce(Object.assign(new Error('connection reset'), {
      code: 'ECONNRESET',
    }));
    const { execute } = await import('../db.js');
    const { isDatabaseInfrastructureError } = await import('../db-errors.js');

    const error = await execute('UPDATE jobs SET status = $1', ['completed'])
      .catch((caught) => caught);

    expect(isDatabaseInfrastructureError(error)).toBe(true);
  });

  it('tags transaction client network failures without retrying the callback', async () => {
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(Object.assign(new Error('connection reset'), {
        code: 'ECONNRESET',
      }))
      .mockResolvedValueOnce({ rows: [] });
    const { transaction } = await import('../db.js');
    const { isDatabaseInfrastructureError } = await import('../db-errors.js');
    const callback = vi.fn(async (client) => client.query('SELECT 1'));

    const error = await transaction(callback).catch((caught) => caught);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(isDatabaseInfrastructureError(error)).toBe(true);
    expect(mocks.clientQuery).toHaveBeenCalledTimes(3);
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });
});
