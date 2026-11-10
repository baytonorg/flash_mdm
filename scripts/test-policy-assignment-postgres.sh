#!/usr/bin/env bash
set -euo pipefail
# Never accept an operator DATABASE_URL. Every run owns a fresh local fixture.
fixture_container=$(docker run --detach --rm --env POSTGRES_HOST_AUTH_METHOD=trust \
  --env POSTGRES_DB=flash_policy_assignment_fixture --publish 127.0.0.1::5432 postgres:17)
trap 'docker rm --force "$fixture_container" >/dev/null' EXIT
for attempt in {1..30}; do
  if docker exec "$fixture_container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
fixture_address=$(docker port "$fixture_container" 5432/tcp)
fixture_port=${fixture_address##*:}
POLICY_ASSIGNMENT_TEST_DATABASE_URL="postgresql://postgres@127.0.0.1:${fixture_port}/flash_policy_assignment_fixture" \
  npx vitest run netlify/functions/__tests__/policy-assignment.postgres.test.ts netlify/functions/__tests__/policy-assignment-migration.postgres.test.ts
