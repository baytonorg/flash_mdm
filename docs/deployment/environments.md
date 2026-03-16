# Environments (dev / staging / prod)

## Model

Flash MDM environments are differentiated entirely by environment variables. There is no environment flag baked into the application — the same codebase runs in dev, staging, and prod.

Separation between environments is achieved by using:

- different `DATABASE_URL` / `NETLIFY_DATABASE_URL` values (separate databases strongly recommended)
- different AMAPI GCP projects and service account credentials
- Stripe test vs live API keys

## Recommended practice

| Environment | Database | Stripe | AMAPI |
|-------------|----------|--------|-------|
| Dev (local) | Disposable local Postgres | Test keys | Test project |
| Staging | Separate Postgres instance | Test keys | Separate test project |
| Prod | Isolated, backed-up Postgres | Live keys | Production project |

### Dev

- Run locally with `npm run dev` (Vite on port 5173, proxied through `netlify dev` on port 8888).
- `NODE_ENV=development` disables TLS on the Postgres connection.
- Use a local or throwaway Postgres instance; data loss is acceptable.

### Staging

- A production-like Netlify site (separate site or branch deploy).
- Uses a separate Postgres instance — never share a DB with prod.
- Stripe test mode. Confirm webhook behavior here before going live.
- Limited access; use it to validate migrations and feature changes before production promotion.

### Prod

- Locked down. Access to Netlify account, database, and environment variables must be tightly controlled.
- Stripe live mode with webhook verification enabled.
- TLS enforced on all Postgres connections (`rejectUnauthorized: true`).
- Audit logging active and monitored.

See:

- [Environment variables reference](../reference/environment-variables.md)
- [Netlify deployment (step-by-step)](./netlify-step-by-step.md)
