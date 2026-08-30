#!/usr/bin/env node
import pg from 'pg';
import { normalizePostgresConnectionString } from '../netlify/functions/_lib/postgres-connection.js';
import { parseEncryptionKey } from '../netlify/functions/_lib/crypto.js';
import { rekeyEncryptedState } from '../netlify/functions/_lib/encryption-rekey.js';

const execute = process.argv.includes('--execute');
const maintenanceConfirmed = process.argv.includes('--maintenance-confirmed');
if (execute && !maintenanceConfirmed) {
  throw new Error('--execute requires --maintenance-confirmed after all Flash writers have been stopped');
}

const databaseUrl = process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL or NETLIFY_DATABASE_URL is required');
const oldKeyRaw = process.env.OLD_ENCRYPTION_MASTER_KEY;
const newKeyRaw = process.env.NEW_ENCRYPTION_MASTER_KEY;
if (!oldKeyRaw || !newKeyRaw) throw new Error('OLD_ENCRYPTION_MASTER_KEY and NEW_ENCRYPTION_MASTER_KEY are required');
const oldKey = parseEncryptionKey(oldKeyRaw, 'OLD_ENCRYPTION_MASTER_KEY');
const newKey = parseEncryptionKey(newKeyRaw, 'NEW_ENCRYPTION_MASTER_KEY');
if (oldKey.equals(newKey)) throw new Error('Old and new encryption keys must differ');

const { Pool } = pg;
const pool = new Pool({
  connectionString: normalizePostgresConnectionString(databaseUrl),
  max: 1,
  connectionTimeoutMillis: 5000,
  ssl: process.env.NODE_ENV === 'development' ? false : { rejectUnauthorized: true },
});

const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout = '5s'");
  const advisoryLock = await client.query<{ acquired: boolean }>(
    "SELECT pg_try_advisory_xact_lock(hashtext('flash-mdm:encryption-rekey')) AS acquired"
  );
  if (!advisoryLock.rows[0]?.acquired) throw new Error('Another encryption rekey is already running');
  await client.query('LOCK TABLE workspaces, users, api_keys, workspace_billing_settings, magic_links IN ACCESS EXCLUSIVE MODE');
  const column = await client.query<{ data_type: string }>(
    "SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'magic_links' AND column_name = 'email'"
  );
  if (column.rows[0]?.data_type !== 'text') {
    throw new Error('Migration 056_magic_links_email_text must be applied before rekeying');
  }
  const counts = await rekeyEncryptedState(client, oldKey, newKey, execute);
  if (execute) await client.query('COMMIT');
  else await client.query('ROLLBACK');
  console.log(`${execute ? 'Rekey complete' : 'Dry run complete'}: ${JSON.stringify(counts)}`);
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
