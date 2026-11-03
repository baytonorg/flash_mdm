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
