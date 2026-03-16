# `netlify/functions/deployment-jobs.ts`

> Manages deployment jobs: queuing, listing, cancelling, and rolling back policy deployments to devices. Includes the core batch processing logic that pushes policy derivatives to AMAPI with rate-limit-aware batching.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `handler` | `(request: Request, _context: Context) => Promise<Response>` | Netlify function handler (named export as `default`) |
| `processDeploymentJob` | `(jobId, policyId, environmentId, deviceIds, amapiContext, userId) => Promise<void>` | Core deployment processor; generates derivatives and pushes to each device in batches |
| `getDeploymentTargetDeviceIds` | `(policyId, environmentId) => Promise<string[]>` | Resolves all unique device IDs affected by a policy's assignments |

## Internal Types

| Name | Lines | Description |
|------|-------|-------------|
| `DeploymentJobRow` | 14-31 | Full shape of a `deployment_jobs` DB row |
| `DeploymentJobAmapiContext` | 37-41 | AMAPI context needed for deployment: workspace_id, gcp_project_id, enterprise_name |

## Internal Constants

| Name | Value | Description |
|------|-------|-------------|
| `BATCH_SIZE` | `10` | Number of devices processed per batch |
| `BATCH_DELAY_MS` | `2000` | Delay between batches (ms) to stay within AMAPI rate limits (~30 req/min) |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `triggerDeploymentJobBackground` | 411-435 | Fires an HTTP POST to the background function endpoint with an internal secret header to kick off async processing |
| `normalizeJob` | 437-443 | Normalizes a job row for API response: parses JSON `error_log`, strips `rollback_snapshot` |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `query`, `queryOne`, `execute`, `transaction` | `_lib/db.js` | Database operations |
| `requireAuth` | `_lib/auth.js` | Session/API key authentication |
| `requireEnvironmentPermission` | `_lib/rbac.js` | Environment-level RBAC check |
| `logAudit` | `_lib/audit.js` | Audit log entries |
| `syncPolicyDerivativesForPolicy`, `getPolicyAmapiContext`, `listAffectedDevicesForPolicyContext`, `assignPolicyToDeviceWithDerivative` | `_lib/policy-derivatives.js` | Derivative sync and per-device AMAPI assignment |
| `jsonResponse`, `errorResponse`, `parseJsonBody`, `getSearchParams`, `getClientIp` | `_lib/helpers.js` | HTTP response helpers and request parsing |

## Key Logic

### Queue (POST /)
1. Validates `environment_id` and `policy_id`; requires `write` permission.
2. Fetches AMAPI context; counts affected devices via `getDeploymentTargetDeviceIds`.
3. Captures a rollback snapshot (current derivative `payload_hash` and `amapi_name` per device).
4. Creates the job in `pending` status with the rollback snapshot.
5. Triggers the background function via `triggerDeploymentJobBackground`.
6. Returns the job ID and device count.

### List/Get (GET /)
- With `id` param: returns a single job (with parsed `error_log`, without `rollback_snapshot`).
- With `environment_id` param: returns the 50 most recent jobs.

### Cancel (POST /?action=cancel)
- Only `pending` or `running` jobs can be cancelled.
- Sets status to `cancelled` and records `cancelled_at`.
- The background processor checks for cancellation before each batch.

### Rollback (POST /?action=rollback)
- Only `completed` or `failed` jobs can be rolled back.
- Sets status to `rolling_back`, then re-syncs all derivatives from the current base policy config.
- On success, sets status to `rolled_back`; on failure, sets `rollback_failed`.

### processDeploymentJob (exported)
1. Sets job status to `running`.
2. Syncs all policy derivatives (env, group, device scopes).
3. Iterates devices in batches of `BATCH_SIZE`, calling `assignPolicyToDeviceWithDerivative` for each.
4. Checks for cancellation before each batch. If cancelled, preserves progress and exits.
5. Updates progress (`completed_devices`, `failed_devices`, `skipped_devices`, `error_log`) after each batch. Keeps only the last 100 errors.
6. Final status is `completed` (if any succeeded) or `failed` (if all failed).

### getDeploymentTargetDeviceIds (exported)
- Iterates all `policy_assignments` for the policy and collects unique device IDs via `listAffectedDevicesForPolicyContext`.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/.netlify/functions/deployment-jobs` | Session | Queue a new deployment job |
| GET | `/.netlify/functions/deployment-jobs` | Session | List jobs or get a single job by ID |
| POST | `/.netlify/functions/deployment-jobs?action=cancel` | Session | Cancel a pending/running job |
| POST | `/.netlify/functions/deployment-jobs?action=rollback` | Session | Rollback a completed/failed job |
