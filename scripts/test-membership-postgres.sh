#!/usr/bin/env bash
set -euo pipefail

# Only a new, disposable local container is used. Never accept DATABASE_URL.
fixture_container=$(docker run --detach --rm --env POSTGRES_HOST_AUTH_METHOD=trust \
  --env POSTGRES_DB=flash_membership_fixture --publish 127.0.0.1::5432 postgres:17)
trap 'docker rm --force "$fixture_container" >/dev/null' EXIT
for attempt in {1..30}; do
  if docker exec "$fixture_container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
fixture_address=$(docker port "$fixture_container" 5432/tcp)
fixture_port=${fixture_address##*:}
MEMBERSHIP_TEST_DATABASE_URL="postgresql://postgres@127.0.0.1:${fixture_port}/flash_membership_fixture" \
  npx vitest run netlify/functions/__tests__/membership-lifecycle.postgres.test.ts

# Destructive-flow SQL checks run in a second database in this disposable
# container. Neither suite can accidentally target the operator's database.
docker exec "$fixture_container" createdb -U postgres flash_deletion_fixture
deletion_fixture_url="postgresql://postgres@127.0.0.1:${fixture_port}/flash_deletion_fixture"
FLASH_DELETION_TEST_URL="$deletion_fixture_url" node --import tsx --input-type=module <<'FLASH_DELETION_SCHEMA'
import pg from 'pg';
import { MIGRATIONS } from './netlify/functions/migrate.ts';
const url = new URL(process.env.FLASH_DELETION_TEST_URL);
if (url.hostname !== '127.0.0.1' || url.pathname !== '/flash_deletion_fixture') throw new Error('Refusing non-disposable deletion fixture');
const pool = new pg.Pool({ connectionString: url.toString() });
try {
  for (const migration of MIGRATIONS) await pool.query(migration.sql);
  await pool.query('CREATE TABLE IF NOT EXISTS _migrations (name varchar(255) PRIMARY KEY, applied_at timestamptz DEFAULT now())');
  await pool.query('INSERT INTO _migrations(name) SELECT unnest($1::text[]) ON CONFLICT DO NOTHING', [MIGRATIONS.map(migration => migration.name)]);
} finally { await pool.end(); }
FLASH_DELETION_SCHEMA
FLASH_DELETION_TEST_URL="$deletion_fixture_url" \
  npx vitest run netlify/functions/__tests__/environment-deletion.integration.test.ts
