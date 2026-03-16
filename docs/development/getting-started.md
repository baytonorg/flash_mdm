# Getting started (local)

This guide is for engineers who want to run Flash MDM locally.

## Prerequisites

- Node.js 20+
- Postgres (local instance for `DATABASE_URL`)
- Netlify CLI (`npm install -g netlify-cli`) — recommended for full-stack local emulation
- A Netlify account with Netlify DB enabled

## Install

```bash
npm install
```

## Configure env vars

```bash
cp .env.example .env
```

Populate required values (see: [Environment variables](../reference/environment-variables.md)).

## Run

### Full stack (recommended)

```bash
netlify dev
```

This proxies both the Vite dev server (port 5173) and Netlify Functions together.

### Frontend only

```bash
npm run dev
```

## Tests

```bash
npm test
```

See [Testing](./testing.md) for the full test command reference.

## Common gotchas

- **DB connections**: `db.ts` disables SSL when `NODE_ENV=development`. For local Postgres, set `DATABASE_URL` and leave `NODE_ENV=development` to skip TLS.
- **AMAPI integration**: for local dev you may want a dedicated GCP project and enterprise.
- **Monaco editor assets**: copied automatically via `prebuild` and `predev` hooks (`npm run monaco:copy`). The `public/monaco/` directory is generated and should not be committed.
