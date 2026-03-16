# `netlify/functions/deployment-jobs-background.ts`

> Background function that processes a deployment job asynchronously. Called internally by `deployment-jobs.ts` after a job is queued; runs the batch AMAPI sync outside the request/response cycle.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, _context: Context) => Promise<Response>` | Netlify background function handler |
| `config` | `{ type: 'background' }` | Netlify function config marking this as a background function |

## Internal Types

| Name | Lines | Description |
|------|-------|-------------|
| `BackgroundRequestBody` | 11-13 | Expected request body shape: `{ job_id?: string }` |
| `DeploymentJobForBackground` | 15-21 | Subset of deployment job fields needed for processing |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `queryOne` | `_lib/db.js` | Database queries |
| `requireInternalCaller` | `_lib/internal-auth.js` | Validates internal function secret header |
| `getPolicyAmapiContext` | `_lib/policy-derivatives.js` | Resolves AMAPI context for the environment |
| `getDeploymentTargetDeviceIds`, `processDeploymentJob` | `./deployment-jobs.ts` | Reuses device resolution and batch processing logic from the main handler |

## Key Logic

1. Validates the caller via `requireInternalCaller` (checks `x-internal-secret` header).
2. Only accepts POST requests.
3. Fetches the deployment job by `job_id`; ignores jobs not in `pending` status.
4. Resolves AMAPI context for the job's environment; fetches target device IDs.
5. Delegates to `processDeploymentJob` (from `deployment-jobs.ts`) which handles batched device sync, progress tracking, and cancellation checks.
6. Returns a JSON response with the processing result (used for logging; the caller does not wait for it).

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/.netlify/functions/deployment-jobs-background` | Internal secret | Process a deployment job in the background |
