# Backup & restore

## Current model

Flash MDM does not implement application-level backup. Backup is operator-managed and must cover every stateful backend used by the deployment.

- DB snapshots are operator-controlled (e.g. Postgres provider snapshots or `pg_dump`)
- Netlify deployments use provider-managed Netlify Blobs
- VPS deployments use the directory configured by `FLASH_BLOB_DIR`. If it is unset, the runtime falls back to `.flash-blobs` beneath its working directory.
- Not granular to individual writes — point-in-time recovery depends on your Postgres provider's capabilities
- Application rollback is handled separately via Netlify deploy history or the VPS release procedure

The database and blob backup form one recovery set. Restoring only PostgreSQL can leave certificates, report exports, policy artifacts, raw Pub/Sub payloads, application reports, and usage logs missing.

## Operator responsibilities

- Define backup frequency and retention for snapshots
- Take a snapshot before applying schema migrations to critical environments
- Positively identify the active blob directory from the running service environment. Refuse the backup if the path is unknown; do not assume `FLASH_BLOB_DIR` is set.
- Back up the active blob directory with file ownership, permissions, and metadata sidecars intact on VPS deployments
- Test restore procedures into a staging environment periodically
- Define RPO and RTO targets appropriate to your compliance requirements

## VPS backup procedure

1. Stop or quiesce application writes so PostgreSQL and blob state represent the same point in time.
2. Record the deployed commit and migration state.
3. Create the PostgreSQL backup using `pg_dump` or the provider snapshot mechanism.
4. Archive the complete active blob directory, including hidden files and `*.metadata.json` sidecars. Preserve file ownership and modes. Convert fallback `.flash-blobs` deployments to an explicit absolute `FLASH_BLOB_DIR` before relying on scheduled backups.
5. Store the database and blob artifacts together with their timestamp and checksum.
6. Resume the service only after both artifacts complete successfully.

Use filesystem or volume snapshots when available. When using file-copy tooling, write to a new versioned destination and publish it atomically; do not synchronise deletions into the only retained backup.

## VPS restore procedure

1. Stop the Flash service and keep public traffic away from the target.
2. Restore PostgreSQL to a new target database.
3. Restore the matching blob archive to a new absolute directory.
4. Set `DATABASE_URL` and `FLASH_BLOB_DIR` to the restored targets and apply the service account's ownership and least-privilege modes.
5. Verify the schema migration state before starting Flash.
6. Smoke-test at least one item from each populated store: `exports`, `certificates`, `policy-artifacts`, `pubsub-raw`, `device-apps`, and `usage-logs`.
7. Start Flash, repeat the smoke checks through authenticated application routes, and only then resume traffic.

> If the restored snapshot is behind the current migration state, you may need to re-run migrations. See [Migrations & rollbacks](../deployment/migrations-and-rollbacks.md).

## Netlify-to-VPS blob cutover

PostgreSQL export does not include Netlify Blobs. Before switching traffic:

1. Load `NETLIFY_SITE_ID` and `NETLIFY_API_TOKEN` from the deployment's protected secret storage without echoing them.
2. Quiesce writes for the final database recovery point, blob inventory, export, and verification. A delta inventory while writes continue is not a completeness boundary.
3. Export every object, key, and metadata value into a new archive: `node scripts/migrate-netlify-blobs.mjs export --archive /absolute/new/archive`. The command enumerates all stores and writes a checksum manifest; it refuses an existing destination.
4. Copy the completed archive and its database recovery point to the target. Run a non-writing preflight: `node scripts/migrate-netlify-blobs.mjs import --archive /absolute/archive --blob-dir /absolute/flash-blobs`.
5. Import only into a new absolute blob directory by adding `--execute`. The importer stages the complete tree and renames it into place atomically; any existing destination is refused.
6. Verify exact key, metadata, size, and SHA-256 parity: `node scripts/migrate-netlify-blobs.mjs verify --archive /absolute/archive --blob-dir /absolute/flash-blobs`.
7. Exercise representative authenticated downloads and certificate/policy paths before directing production traffic to the VPS.
8. Retain the Netlify data and the migration archive until the agreed recovery window has passed.

The archive manifest contains store names, object keys, metadata, sizes, and hashes. Protect it as operational data even though it contains no Netlify credentials. Never put tokens in command arguments or archive files.

## Related

- [Database](../deployment/database.md)
- [Migrations & rollbacks](../deployment/migrations-and-rollbacks.md)
