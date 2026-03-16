# `netlify/functions/workflow-cron-scheduled.ts`

> Scheduled function (every 5 minutes) that finds all enabled workflows with trigger_type `scheduled`, checks if their interval has elapsed, and enqueues evaluation jobs for each in-scope device.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, context: Context) => Promise<void>` | Netlify function handler |
| `config` | `{ schedule: '*/5 * * * *' }` | Netlify scheduled function config -- runs every 5 minutes |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `getDevicesInScope` | 32-50 | Returns devices matching the workflow's scope: group-scoped uses `group_closures` to include descendant groups; environment-scoped returns all non-deleted devices |
| `shouldTrigger` | 52-61 | Compares elapsed time since `last_triggered_at` against `trigger_config.interval_minutes` (default 60) to determine if the workflow should fire |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `query`, `queryOne`, `execute` | `_lib/db.js` | Database queries and job queue inserts |

## Key Logic

1. **No auth required** -- Netlify scheduled functions cannot be invoked externally.
2. Fetches all enabled workflows where `trigger_type = 'scheduled'`.
3. For each workflow, calls `shouldTrigger` to check if enough time has elapsed since `last_triggered_at` based on `trigger_config.interval_minutes` (default 60 minutes).
4. Resolves in-scope devices via `getDevicesInScope`:
   - Group scope: joins `devices` with `group_closures` to include devices in descendant groups.
   - Environment scope (default): all non-deleted devices in the environment.
5. For each device, inserts a `workflow_evaluate` job into `job_queue` with the workflow ID, device ID, and trigger metadata.
6. Updates `last_triggered_at` on the workflow to prevent re-triggering on the next cron run.
7. If any jobs were enqueued, triggers `sync-process-background` via an internal HTTP call to process the queue immediately rather than waiting for the next PubSub event.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| N/A | `/.netlify/functions/workflow-cron-scheduled` | None (scheduled) | Cron-triggered workflow evaluation dispatcher |
