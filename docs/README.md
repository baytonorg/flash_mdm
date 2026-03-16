# Flash MDM — Technical Documentation

This documentation is written to help:

- **IT decision makers** evaluate Flash MDM’s design, security posture, and operational fit.
- **Architects** assess alignment with common SaaS patterns and industry practices.
- **Engineers** understand how Flash MDM works (design, dependencies, deployment, operations) and how to extend it.

**Scope:** as-built (“what is running today”). Where behavior is plan/hosting dependent, we call it out.

---

## Start here

1) **Architecture** → [Architecture overview](./architecture/overview.md)
2) **Deployment** → [Deployment overview](./deployment/overview.md)
3) **Configuration** → [Environment variables](./reference/environment-variables.md)
4) **Security** → [Security overview](./security/overview.md)
5) **Operations** → [Runbook](./operations/runbook.md)

---

## Documentation map

### Architecture
- [AMAPI integration](./architecture/amapi-integration.md)
- [Architecture overview (C4-ish)](./architecture/overview.md)
- [Design principles](./architecture/design-principles.md)
- [Backend surface overview](./architecture/backend-surface.md)
- [Data model reference (generated)](./architecture/data-model-reference.md)
- [Tenancy model & isolation boundaries](./architecture/tenancy.md)
- [Data model (high level)](./architecture/data-model.md)
- [Background jobs & scheduled functions](./architecture/background-jobs.md)
- [Integrations (AMAPI, Stripe, Resend, Netlify)](./architecture/integrations.md)

### Deployment
- [Deployment overview](./deployment/overview.md)
- [Environments (dev/staging/prod)](./deployment/environments.md)
- [Database](./deployment/database.md)
- [Netlify (functions, routing, headers)](./deployment/netlify.md)
- [Migrations & rollbacks](./deployment/migrations-and-rollbacks.md)
- [Netlify deployment (step-by-step)](./deployment/netlify-step-by-step.md)
- [Bootstrap and initial access](./deployment/bootstrap-and-access.md)

### Development
- [Getting started (local)](./development/getting-started.md)
- [Testing](./development/testing.md)
- [Project structure](./development/project-structure.md)
- [Engineering conventions](./development/conventions.md)

### Security
- [Security overview](./security/overview.md)
- [Authentication & sessions (incl. MFA)](./security/auth.md)
- [RBAC & authorization](./security/rbac.md)
- [Audit logging](./security/audit-logging.md)
- [Hardening & input validation](./security/hardening.md)
- [Compliance notes (SOC2/Cyber Essentials orientation)](./security/compliance-notes.md)

### Operations
- [Data retention & cleanup](./operations/data-retention.md)
- [Runbook](./operations/runbook.md)
- [Monitoring & logs](./operations/monitoring-and-logs.md)
- [Backup & restore](./operations/backup-and-restore.md)
- [Incident response basics](./operations/incident-response.md)

### Reference
- [Environment variables](./reference/environment-variables.md)
- [Environment variables (curated/grouped)](./reference/environment-variables-curated.md)
- [Endpoints index](./reference/endpoints.md)
- [Endpoints (detailed)](./reference/endpoints-detailed.md)
- [Tech stack](./reference/tech-stack.md)
- [Glossary](./reference/glossary.md)

### Implementation Reference
- [Implementation reference index](./implementation/INDEX.md) — per-file documentation of every source file: exports, dependencies, internal functions, and key logic. Optimized for LLM-assisted development.

### ADRs
- [ADR index](./adr/README.md)

---

## Feature deep-dives

- [Policy system — implementation guide](./policies_implementation.md) — derivative stack, variable substitution, locks, overrides, deployment pipeline
- [Policy derivative stack — maintenance reference](./policy_readme.md) — how derivatives are built, synced, and extended
