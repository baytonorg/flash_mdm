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

# Schedule validation runs against the same migration set in its own disposable DB.
docker exec "$fixture_container" createdb -U postgres flash_workflow_fixture
WORKFLOW_TEST_DATABASE_URL="postgresql://postgres@127.0.0.1:${fixture_port}/flash_workflow_fixture" \
  npx vitest run netlify/functions/__tests__/workflow-schedule.postgres.test.ts

# Outbound diagnostics use only synthetic URLs and transport responses.
docker exec "$fixture_container" createdb -U postgres flash_webhook_fixture
WEBHOOK_PRIVACY_TEST_DATABASE_URL="postgresql://postgres@127.0.0.1:${fixture_port}/flash_webhook_fixture" \
  npx vitest run netlify/functions/__tests__/webhook-privacy.postgres.test.ts

# Primary workflow audit effects use a dedicated synthetic database.
docker exec "$fixture_container" createdb -U postgres flash_workflow_audit_fixture
WORKFLOW_AUDIT_TEST_DATABASE_URL="postgresql://postgres@127.0.0.1:${fixture_port}/flash_workflow_audit_fixture" \
  npx vitest run netlify/functions/__tests__/workflow-audit.postgres.test.ts
# Mark-paid grants and gift repricer ordering use synthetic financial records only.
docker exec "$fixture_container" createdb -U postgres flash_invoice_paid_fixture
INVOICE_PAID_TEST_DATABASE_URL="postgresql://postgres@127.0.0.1:${fixture_port}/flash_invoice_paid_fixture" \
  npx vitest run netlify/functions/__tests__/invoice-paid.postgres.test.ts

# Prospective gift repricing uses an independent synthetic invoice database.
docker exec "$fixture_container" createdb -U postgres flash_invoice_gift_fixture
INVOICE_GIFT_TEST_DATABASE_URL="postgresql://postgres@127.0.0.1:${fixture_port}/flash_invoice_gift_fixture" \
  npx vitest run netlify/functions/__tests__/invoice-gift-repricing.postgres.test.ts

docker exec "$fixture_container" createdb -U postgres flash_user_controls_fixture
USER_CONTROLS_TEST_DATABASE_URL="postgresql://postgres@127.0.0.1:${fixture_port}/flash_user_controls_fixture" \
  npx vitest run netlify/functions/__tests__/user-management-controls.postgres.test.ts

# Generic workspace reads must never disclose protected settings envelopes.
docker exec "$fixture_container" createdb -U postgres flash_workspace_settings_fixture
WORKSPACE_SETTINGS_TEST_DATABASE_URL="postgresql://postgres@127.0.0.1:${fixture_port}/flash_workspace_settings_fixture" \
  npx vitest run netlify/functions/__tests__/workspace-settings.postgres.test.ts

# Account throttle namespaces must fit the schema for valid long addresses.
docker exec "$fixture_container" createdb -U postgres flash_login_length_fixture
LOGIN_LENGTH_TEST_DATABASE_URL="postgresql://postgres@127.0.0.1:${fixture_port}/flash_login_length_fixture" \
  npx vitest run netlify/functions/__tests__/auth-login-length.postgres.test.ts

# Environment Roles must round-trip their scoped response without workspace authority.
docker exec "$fixture_container" createdb -U postgres flash_roles_rbac_fixture
ROLES_RBAC_TEST_DATABASE_URL="postgresql://postgres@127.0.0.1:${fixture_port}/flash_roles_rbac_fixture" \
  npx vitest run netlify/functions/__tests__/roles-rbac.postgres.test.ts

# Prospective notice content uses only synthetic recipients and an inert transport.
docker exec "$fixture_container" createdb -U postgres flash_licensing_notice_fixture
LICENSING_NOTICE_TEST_DATABASE_URL="postgresql://postgres@127.0.0.1:${fixture_port}/flash_licensing_notice_fixture" \
  npx vitest run netlify/functions/__tests__/licensing-notice.postgres.test.ts

docker exec "$fixture_container" createdb -U postgres flash_audit_filter_fixture
AUDIT_FILTER_TEST_DATABASE_URL="postgresql://postgres@127.0.0.1:${fixture_port}/flash_audit_filter_fixture" \
  npx vitest run netlify/functions/__tests__/audit-filters.postgres.test.ts

docker exec "$fixture_container" createdb -U postgres flash_group_read_scope_fixture
GROUP_READ_SCOPE_TEST_DATABASE_URL="postgresql://postgres@127.0.0.1:${fixture_port}/flash_group_read_scope_fixture" \
  npx vitest run netlify/functions/__tests__/group-read-scope.postgres.test.ts

# Audit durability is verified after commit using synthetic records and traces.
docker exec "$fixture_container" createdb -U postgres flash_transaction_audit_trace_fixture
TRANSACTION_AUDIT_TRACE_TEST_DATABASE_URL="postgresql://postgres@127.0.0.1:${fixture_port}/flash_transaction_audit_trace_fixture" \
  npx vitest run netlify/functions/__tests__/transaction-audit-trace.postgres.test.ts

# Registration attribution uses isolated accounts and intercepted mail only.
docker exec "$fixture_container" createdb -U postgres flash_registration_audit_fixture
REGISTRATION_AUDIT_TEST_DATABASE_URL="postgresql://postgres@127.0.0.1:${fixture_port}/flash_registration_audit_fixture" \
  npx vitest run netlify/functions/__tests__/registration-audit.postgres.test.ts

# Destructive local flows must preserve every enrolment/sign-in carrier.
docker exec "$fixture_container" createdb -U postgres flash_environment_preservation_fixture
ENVIRONMENT_PRESERVATION_TEST_DATABASE_URL="postgresql://postgres@127.0.0.1:${fixture_port}/flash_environment_preservation_fixture" \
  npx vitest run netlify/functions/__tests__/environment-preservation.postgres.test.ts
