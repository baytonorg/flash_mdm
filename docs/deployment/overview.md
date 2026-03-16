# Deployment overview

Flash MDM is designed to be hosted by an operator.

> In Jason’s words: “whoever hosts it is the god”.

That means: security posture, compliance posture, monitoring, backups, and operational discipline are primarily **operator responsibilities**.

## 1) Deployment shape

A typical deployment consists of:

- A **Netlify site** hosting:
  - the static React (Vite) frontend (`dist/`)
  - serverless API functions (Netlify Functions v2)
  - background and scheduled functions
- A **PostgreSQL** database reachable from the Netlify runtime
- Environment variables defining:
  - DB connection
  - encryption/auth secrets
  - AMAPI configuration
  - optional Stripe + email configuration

## 2) Environments

Flash MDM commonly runs as:

- **dev** (local / preview)
- **staging**
- **prod**

These should be separated with:

- different databases
- different AMAPI credentials/projects
- Stripe test vs live separation

See: [Environments](./environments.md)

## 3) Rollback model

- **App rollback:** via Netlify deploy rollback (one click).
- **DB rollback:** typically performed via a forward migration (“revert with a new migration”).
- **DB disaster recovery:** snapshot restore (operator-managed). Not per-write.

See: [Migrations & rollbacks](./migrations-and-rollbacks.md)


## Step-by-step

- [Netlify deployment (step-by-step)](./netlify-step-by-step.md)


## Bootstrap & access

- [Bootstrap and initial access](./bootstrap-and-access.md)
