import pg from 'pg';
import { normalizePostgresConnectionString } from './postgres-connection.js';
import { markDatabaseError } from './db-errors.js';

const { Pool } = pg;

let pool: InstanceType<typeof Pool> | null = null;

function getPool(): InstanceType<typeof Pool> {
  if (!pool) {
    pool = new Pool({
      connectionString: normalizePostgresConnectionString(
        process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL
      ),
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: process.env.NODE_ENV === 'development' ? false : { rejectUnauthorized: true },
    });
    // pg emits errors from idle clients on the Pool itself. Without a listener,
    // a planned database restart becomes an uncaught EventEmitter error and
    // terminates the web/worker process instead of letting the next query reconnect.
    pool.on('error', (error: Error) => {
      console.error('PostgreSQL idle client error:', error.message);
    });
  }
  return pool;
}

export async function closeDatabasePool(): Promise<void> {
  const activePool = pool;
  pool = null;
  if (activePool) await activePool.end();
}

export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const client = getPool();
  try {
    const result = await client.query(sql, params);
    return result.rows as T[];
  } catch (err) {
    throw markDatabaseError(err);
  }
}

export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function execute(
  sql: string,
  params: unknown[] = []
): Promise<{ rowCount: number }> {
  const client = getPool();
  try {
    const result = await client.query(sql, params);
    return { rowCount: result.rowCount ?? 0 };
  } catch (err) {
    throw markDatabaseError(err);
  }
}

export async function withClient<T>(
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  let client: pg.PoolClient;
  try {
    client = await getPool().connect();
  } catch (err) {
    throw markDatabaseError(err);
  }

  const databaseClient = new Proxy(client, {
    get(target, property, receiver) {
      if (property !== 'query') return Reflect.get(target, property, receiver);
      return async (...args: unknown[]) => {
        try {
          return await Reflect.apply(target.query, target, args);
        } catch (err) {
          throw markDatabaseError(err);
        }
      };
    },
  }) as pg.PoolClient;

  try {
    return await fn(databaseClient);
  } finally {
    client.release();
  }
}

export async function transaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  return withClient(async (client) => {
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}
