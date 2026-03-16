# Project structure

Top-level:

- `src/` — React frontend
- `netlify/functions/` — serverless API + background/scheduled functions
- `netlify/migrations/` — Postgres schema migrations (SQL files, numbered sequentially)
- `public/` — static assets
- `scripts/` — one-off and utility Node scripts (e.g. OpenAPI generation)
- `docs/` — technical documentation

## Frontend (`src/`)

- `api/` — API client (`client.ts`) and TanStack Query hooks (`queries/`)
- `components/` — UI components, organised by domain (e.g. `device/`, `policy/`, `common/`)
- `hooks/` — shared React hooks
- `layouts/` — top-level layout wrappers (`MainLayout`, `GuestLayout`, `SuperadminLayout`)
- `pages/` — route-level page components
- `stores/` — Zustand stores (`auth`, `context`, `flashagent`, `ui`)
- `types/` — shared TypeScript types
- `lib/` — utility modules (`brand`, `haversine`, `redirect`)
- `utils/` — pure utility functions (`currency`, `format`)
- `constants/` — shared constants
- `test/` — Vitest global setup (`setup.ts`)

## Backend (`netlify/functions/`)

- `_lib/` — shared backend logic (DB helpers, RBAC, auth, crypto, audit, billing, etc.)
- `_lib/__tests__/` — unit tests for shared lib modules
- `__tests__/` — integration tests for function handlers
- Handler files in the root of `netlify/functions/` implement individual API endpoints (e.g. `auth-login.ts`, `device-list.ts`)
