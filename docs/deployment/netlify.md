# Netlify deployment

Flash MDM is deployed as a Netlify full-stack application.

## 1) What Netlify provides

- Static asset hosting for the Vite-built frontend (`dist/`)
- Serverless runtime for API endpoints (Netlify Functions v2, bundled with esbuild)
- Background and scheduled functions (e.g. sync, geofence checks, licensing reconcile)
- Build/deploy pipeline and deploy rollbacks
- Function logs

## 2) Build configuration

The build is configured in `netlify.toml`:

- **Build command:** `npm run build` (runs `tsc -b && vite build`)
- **Publish directory:** `dist`
- **Functions directory:** `netlify/functions`
- **Node bundler:** `esbuild`
- **Dev command:** `npm run dev` (Vite dev server on port 5173)

### Monaco editor assets

The policy JSON editor uses the Monaco editor, which requires its web worker and language assets to be served as static files. The `scripts/copy-monaco-assets.mjs` script copies `node_modules/monaco-editor/min/vs/` into `public/monaco/vs/` so they are included in the published `dist/` directory. This script runs automatically via `prebuild` and `predev` hooks in `package.json` (i.e. before both `npm run build` and `npm run dev`). The `netlify.toml` headers configuration includes a relaxed CSP (`unsafe-eval`) on `/policies` routes to support Monaco's dynamic evaluation.

## 3) Routing

All API routes are implemented as `[[redirects]]` rules in `netlify.toml`, mapping `/api/*` paths to the corresponding `/.netlify/functions/*` handlers. A final SPA fallback catches all unmatched paths and serves `index.html`.

Reference docs:

- `docs/reference/endpoints.md`
- `docs/reference/routes-inventory.json`

## 4) Headers and hardening

Security headers and Content Security Policy (CSP) are managed in `netlify.toml`. The `/policies` and `/policies/*` routes use a relaxed CSP (`unsafe-eval`) to support the Monaco editor. CORS headers for `/api/*` restrict `Access-Control-Allow-Origin` to your app origin (configured in `netlify.toml`).

See:

- [Hardening](../security/hardening.md)

## 5) Logs

- Netlify function logs are the first-line server logs.
- Flash MDM also exposes server logs through Superadmin pages.

See:

- [Monitoring & logs](../operations/monitoring-and-logs.md)
