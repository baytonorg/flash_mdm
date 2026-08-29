import pg from 'pg';
import { normalizePostgresConnectionString } from './postgres-connection.js';

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

export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const client = getPool();
  const result = await client.query(sql, params);
  return result.rows as T[];
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
  const result = await client.query(sql, params);
  return { rowCount: result.rowCount ?? 0 };
}

export async function withClient<T>(
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(client);
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
