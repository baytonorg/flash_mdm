# Architecture overview

This page describes Flash MDM **as built**.

## 1) What Flash MDM is

Flash MDM is a **multi-tenant** Android device management platform built on the **Android Management API (AMAPI)**.

It is deployed as a **Netlify full‑stack application**:

- **Frontend:** React SPA (Vite) served as static assets.
- **Backend:** Netlify Functions (Node.js/TypeScript, ESM).
- **Database:** Postgres (commonly Netlify DB, but any compatible Postgres can be used).

Optional enterprise capabilities include:

- **Billing/Licensing:** Stripe
- **Transactional email:** Resend
- **Audit log:** first‑class server audit log surfaced in the app

## 2) High-level model (tenancy + hierarchy)

Flash MDM’s mental model is:

- **Workspace** (tenant)
  - **Environment** (maps to an AMAPI Enterprise binding)
    - **Group** (hierarchical closure table)
      - **Devices**
      - **Policies** (component-based, deep-merged by priority)

A user’s effective access is determined by:

- membership role (owner/admin/member/viewer etc.)
- access scope (workspace vs scoped)
- and explicit environment/group assignments (where applicable)

See: [Tenancy model & isolation](./tenancy.md)

See: [Design principles](./design-principles.md)

## 3) C4 summary (text)

### Context

**Actors**

- Workspace owners/admins/members
- Superadmin platform operators (restricted)

**External systems**

- Google Android Management API (AMAPI)
- Google Pub/Sub (AMAPI notifications, push → webhook)
- Stripe (billing webhooks and portal/checkout)
- Resend (email)

### Containers

- **Web UI** (static)
- **API** (Netlify Functions)
- **Background processors** (Netlify Functions invoked internally/scheduled)
- **Postgres database**

### Key trust boundaries

- Browser ↔ API boundary (auth, CSRF)
- Tenant boundary (workspace/environment scoping)
- Operator boundary (superadmin endpoints)
- Third-party boundaries (Stripe, AMAPI)

## 4) Runtime components

### Frontend

- `src/` contains the SPA.
- State management uses Zustand and TanStack Query.
- Monaco is used for policy JSON/editor experiences.

### Backend

- `netlify/functions/*` are individual endpoints.
- `netlify/functions/_lib/*` contains shared logic:
  - auth/session, RBAC, crypto, Stripe integration, AMAPI wrappers, DB helpers.

### Database

- Migration SQL sources are in `netlify/migrations/*`; the canonical migration runner is `netlify/functions/migrate.ts` (migrations are inlined for Netlify's esbuild bundler).
- DB connection pooling is handled in `netlify/functions/_lib/db.ts`.

## 5) Primary flows (overview)

### Device enrollment & sync

- Environments bind to AMAPI enterprises.
- Enrollment tokens/QR codes are generated and devices enroll via AMAPI.
- Device state is synchronized via background processing and reconciliation jobs.

### Policy management

- Policies are component-based.
- Components can be assigned at multiple hierarchy levels and deep-merged.
- Derivatives may be generated for specific devices when necessary.

### Workflows

- Workflow rules can evaluate triggers (including scheduled/time-based triggers).
- Background evaluation functions process queued jobs.

### Billing/licensing (if enabled)

- Stripe webhooks manage entitlements/grants.
- Licensing reconcile jobs evaluate overage cases and can enforce actions (disable/wipe) based on configured grace periods.

### AI assistant (Flashi)

- Flashi is an integrated AI chat assistant that lets users query workspace data conversationally.
- Uses OpenAI tool-calling with read-only AMAPI MCP tools and Flash internal Postgres tools.
- AMAPI MCP proxy at `/api/mcp/amapi` proxies JSON-RPC to Google's AMAPI MCP endpoint (standalone feature).
- Chat history is persisted per environment+user in Postgres.
- Gated by a dual toggle: platform-level (`platform_settings.assistant_enabled`) AND per-environment (`environments.enterprise_features.assistant.enabled`).
- Ships dark-launched behind `assistant_enabled=false`.

## 6) Where to go next

- [Integrations](./integrations.md)
- [Background jobs](./background-jobs.md)
- [Data model](./data-model.md)
- [Deployment overview](../deployment/overview.md)
