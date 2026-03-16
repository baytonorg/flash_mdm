# Migrations & rollbacks

## 1) What "rollback" means here

Flash MDM is deployed on Netlify, so application rollbacks are straightforward.

Database rollback is a different problem:

- **App rollback:** revert to a previous Netlify deploy via the Netlify dashboard.
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
- Prefer additive, backward-compatible changes.
- If you must do a breaking change:
  - deploy code that supports both old and new schema
  - migrate data
  - then remove old paths in a later release

See: [Database](./database.md)
