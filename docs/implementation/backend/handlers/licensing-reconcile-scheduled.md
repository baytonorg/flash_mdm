# `netlify/functions/licensing-reconcile-scheduled.ts`

> Scheduled function that runs licensing reconciliation hourly via Netlify's cron scheduler.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `config` | `{ schedule: string }` | Netlify scheduled function config: `'0 * * * *'` (every hour at minute 0) |
| `default` (handler) | `(request: Request, _context: Context) => Promise<Response>` | Netlify function handler |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| (none) | | Delegates all reconciliation logic to `runLicensingReconcile` |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `runLicensingReconcile` | `_lib/licensing-reconcile` | Execute the reconciliation algorithm |
| `isLicensingDryRun` | `_lib/licensing` | Check if the platform is configured for dry-run mode |

## Key Logic

1. Runs on a cron schedule (`0 * * * *` -- every hour).
2. No authentication check -- invoked by the Netlify scheduler infrastructure.
3. Calls `runLicensingReconcile` with `dryRun` determined by `isLicensingDryRun()`.
4. Returns raw `Response` objects (does not use the shared `jsonResponse`/`errorResponse` helpers).

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| N/A (scheduled) | `/.netlify/functions/licensing-reconcile-scheduled` | Netlify scheduler | Hourly licensing reconciliation cron job |
