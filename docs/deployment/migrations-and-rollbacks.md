# Migrations & rollbacks

## 1) What "rollback" means here

Flash MDM supports Netlify and versioned VPS releases, so application rollbacks are separate from database recovery.

Database rollback is a different problem:

- **App rollback:** revert to a previous Netlify deploy via the Netlify dashboard.
- **VPS app rollback:** the installer builds under `<install-root>/releases/`, atomically switches `<install-root>/current`, and restores the previous target when service readiness, migration, worker startup, or Caddy activation fails.
- **DB rollback:** generally achieved by applying a new migration that reverses/adjusts prior changes.
- **DB recovery:** restore from snapshot (operator-managed), used for catastrophic scenarios.

## 2) Migration runner

Flash MDM includes a built-in migration runner at `netlify/functions/migrate.ts`, exposed as `GET /api/migrate`. It tracks applied migrations in a `_migrations` table, so it is idempotent — calling it repeatedly only applies migrations that have not run yet.

Migrations are inlined into `migrate.ts` at build time (because Netlify's esbuild bundler does not bundle `.sql` files at runtime). The canonical SQL source files live in `netlify/migrations/` for reference.

### Applying migrations

After deploying, trigger the migration runner:

```bash
curl https://<your-site>/api/migrate \
  -H "x-migration-secret: <MIGRATION_SECRET value>"
```

The endpoint requires `MIGRATION_SECRET` to be set in environment variables. It returns `500` if the variable is absent, `401` if the header value does not match.
It also returns `500` with `summary.errors > 0` when an individual migration fails. Installers and automation must require both an HTTP success status and a zero error count.

### Local development

For local development, you can apply the SQL files directly:

```bash
for f in netlify/migrations/*.sql; do
  psql "$DATABASE_URL" -f "$f"
done
```

Or use the migration endpoint via `netlify dev`.

## 3) Operational guidance

- Take a snapshot before schema migrations that affect critical workflows.
- A VPS code rollback does not reverse migrations that committed before a later activation check failed. Keep migrations backward-compatible with the previous retained release.
- Prefer additive, backward-compatible changes.
- If you must do a breaking change:
  - deploy code that supports both old and new schema
  - migrate data
  - then remove old paths in a later release

See: [Database](./database.md)
