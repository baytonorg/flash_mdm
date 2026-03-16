#!/usr/bin/env node
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import pg from 'pg';

function parseArgs(argv) {
  const out = {
    apply: false,
    limit: Number(process.env.BACKFILL_LIMIT ?? 0),
    environmentId: process.env.BACKFILL_ENVIRONMENT_ID ?? '',
    policyId: process.env.BACKFILL_POLICY_ID ?? '',
    dbUrl: process.env.NETLIFY_DATABASE_URL ?? '',
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--apply') {
      out.apply = true;
    } else if (arg === '--limit' && next) {
      out.limit = Number(next);
      i += 1;
    } else if (arg === '--environment-id' && next) {
      out.environmentId = next;
      i += 1;
    } else if (arg === '--policy-id' && next) {
      out.policyId = next;
      i += 1;
    } else if (arg === '--db-url' && next) {
      out.dbUrl = next;
      i += 1;
    }
  }
  if (!Number.isFinite(out.limit) || out.limit < 0) throw new Error('limit must be >= 0');
  return out;
}

function parseJsonObject(value) {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function computeGenerationHash(payload, metadata) {
  const metadataForHash = { ...metadata };
  delete metadataForHash.generation_hash;
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ payload, metadata: metadataForHash }))
    .digest('hex');
}

function resolveDbUrl(explicitDbUrl) {
  if (explicitDbUrl) return explicitDbUrl;
  return execSync('netlify env:get NETLIFY_DATABASE_URL', { encoding: 'utf8' }).trim();
}

async function main() {
  const args = parseArgs(process.argv);
  const dbUrl = resolveDbUrl(args.dbUrl);
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();

  try {
    const where = [
      `(metadata IS NULL OR jsonb_typeof(metadata) <> 'object' OR COALESCE(metadata->>'generation_hash', '') = '')`,
    ];
    const params = [];
    if (args.environmentId) {
      params.push(args.environmentId);
      where.push(`environment_id = $${params.length}`);
    }
    if (args.policyId) {
      params.push(args.policyId);
      where.push(`policy_id = $${params.length}`);
    }
    let limitClause = '';
    if (args.limit > 0) {
      params.push(args.limit);
      limitClause = `LIMIT $${params.length}`;
    }

    const rows = await client.query(
      `SELECT id, policy_id, environment_id, scope_type, scope_id, config, metadata
       FROM policy_derivatives
       WHERE ${where.join(' AND ')}
       ORDER BY updated_at DESC
       ${limitClause}`,
      params
    );

    let updatable = 0;
    let skipped = 0;
    const updates = [];

    for (const row of rows.rows) {
      const payload = parseJsonObject(row.config);
      const metadata = parseJsonObject(row.metadata);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        skipped += 1;
        continue;
      }
      const generationHash = computeGenerationHash(payload, metadata);
      updates.push({
        id: row.id,
        policy_id: row.policy_id,
        scope_type: row.scope_type,
        scope_id: row.scope_id,
        generation_hash: generationHash,
        metadata: { ...metadata, generation_hash: generationHash },
      });
      updatable += 1;
    }

    console.log(JSON.stringify({
      mode: args.apply ? 'apply' : 'dry-run',
      selected_rows: rows.rows.length,
      updatable_rows: updatable,
      skipped_rows: skipped,
      sample: updates.slice(0, 5).map((u) => ({
        id: u.id,
        policy_id: u.policy_id,
        scope_type: u.scope_type,
        scope_id: u.scope_id,
        generation_hash: u.generation_hash,
      })),
    }, null, 2));

    if (!args.apply || updates.length === 0) return;

    await client.query('BEGIN');
    try {
      for (const u of updates) {
        await client.query(
          `UPDATE policy_derivatives
           SET metadata = $2::jsonb,
               updated_at = now()
           WHERE id = $1`,
          [u.id, JSON.stringify(u.metadata)]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }

    const verify = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM policy_derivatives
       WHERE id = ANY($1::uuid[])
         AND COALESCE(metadata->>'generation_hash', '') <> ''`,
      [updates.map((u) => u.id)]
    );
    console.log(JSON.stringify({
      updated_rows: updates.length,
      verified_rows_with_hash: verify.rows[0]?.count ?? 0,
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

