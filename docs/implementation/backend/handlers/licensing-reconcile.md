# `netlify/functions/licensing-reconcile.ts`

> Manually triggers the licensing reconciliation process, restricted to internal callers.

## Exports

| Name | Type | Description |
|------|------|-------------|
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
| `requireInternalCaller` | `_lib/internal-auth` | Restrict access to internal/system callers only |
| `jsonResponse`, `errorResponse` | `_lib/helpers` | HTTP response helpers |

## Key Logic

1. Only accepts `POST` requests.
2. Validates the caller via `requireInternalCaller` (internal auth, not user-facing).
3. Runs `runLicensingReconcile` with `dryRun` determined by `isLicensingDryRun()` (environment-based toggle).
4. Returns reconciliation stats on success.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/.netlify/functions/licensing-reconcile` | Internal caller only | Trigger manual licensing reconciliation |
