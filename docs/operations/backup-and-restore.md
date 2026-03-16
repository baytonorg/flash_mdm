# Backup & restore

## Current model

Flash MDM does not implement application-level backup. Backup is entirely operator-managed at the database layer.

- DB snapshots are operator-controlled (e.g. Postgres provider snapshots or `pg_dump`)
- Not granular to individual writes — point-in-time recovery depends on your Postgres provider's capabilities
- Application rollback (for code changes) is handled separately via Netlify deploy history

## Operator responsibilities

- Define backup frequency and retention for snapshots
- Take a snapshot before applying schema migrations to critical environments
- Test restore procedures into a staging environment periodically
- Define RPO and RTO targets appropriate to your compliance requirements

## Restore procedure (general)

1. Stop or quiesce writes if possible (e.g. put the site in maintenance mode)
2. Restore the Postgres snapshot to a target instance
3. Point `DATABASE_URL` at the restored instance
4. Verify schema version matches the deployed application (check migration state)
5. Resume traffic

> If the restored snapshot is behind the current migration state, you may need to re-run migrations. See [Migrations & rollbacks](../deployment/migrations-and-rollbacks.md).

## Related

- [Database](../deployment/database.md)
- [Migrations & rollbacks](../deployment/migrations-and-rollbacks.md)
