# `netlify/functions/sync-process-background.ts`

> Background job processor that dequeues and executes PubSub event processing jobs (enrollment, status report, command, usage log) and bulk device commands via the AMAPI.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `config` | `{ type: 'background' }` | Netlify background function config |
| `default` | `(request: Request, context: Context) => Promise<Response>` | Default-exported background handler |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `parseJsonObject` | 21-32 | Safely parses a value into a plain object |
| `isUsableDevicePayloadSnapshot` | 58-65 | Validates that a payload snapshot matches the expected device AMAPI name |
| `getEnvironmentContext` | 70-82 | Fetches workspace_id, enterprise_name, gcp_project_id for an environment |
| `syncDeviceApplicationsTable` | 84-135 | Upserts device application reports and removes stale entries |
| `resolveUsageLogDeviceAmapiName` | 162-190 | Resolves device AMAPI name from usage log payloads (handles string and object device fields) |
| `extractLostModeLocationRecords` | 192-244 | Parses lost-mode location data from batch usage log events |
| `extractCommandType` | 251-275 | Extracts the command type string from a command notification payload |
| `syncAppFeedbackFromReports` | 277-502 | Extracts keyed app states from AMAPI application reports and upserts into `app_feedback_items` |
| `processEnterpriseUpgrade` | 504-555 | Handles enterprise upgrade completion: updates `enterprise_features.enterprise_upgrade_status`, triggers device re-import |
| `syncEnrollmentPolicyFromGroup` | 564-785 | Resolves the effective policy for a device (device > group hierarchy > environment) and assigns the appropriate derivative policy via AMAPI |
| `findEnrollmentTokenMatchForDevice` | 787-820 | Looks up an enrollment token by AMAPI name or sign-in email |
| `consumeEnrollmentTokenIfOneTime` | 822-828 | Deletes one-time-use enrollment tokens after consumption |
| `processEnrollment` | 833-1182 | Full enrollment event processing: AMAPI device fetch, previousDeviceNames deduplication, device upsert, group assignment from token data, policy sync, workflow dispatch |
| `processStatusReport` | 1187-1339 | Updates device state from a status report event via AMAPI |
| `processCommand` | 1344-1422 | Processes command completion events |
| `processUsageLog` | 1427-1487 | Processes usage log events, including lost-mode location extraction and insertion into `device_locations` |
| `processBulkCommand` | 1492-1527 | Executes bulk device commands against AMAPI |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `query`, `queryOne`, `execute`, `transaction` | `_lib/db` | Database operations |
| `amapiCall`, `getAmapiErrorHttpStatus` | `_lib/amapi` | Android Management API calls |
| `buildAmapiCommandPayload` | `_lib/amapi-command` | Command payload construction |
| `storeBlob` | `_lib/blobs` | Storing raw event payloads |
| `logAudit` | `_lib/audit` | Audit logging |
| `assignPolicyToDeviceWithDerivative`, `ensurePreferredDerivativeForDevicePolicy` | `_lib/policy-derivatives` | Derivative policy management |
| `requireInternalCaller` | `_lib/internal-auth` | Internal function-to-function auth |
| `dispatchWorkflowEvent` | `_lib/workflow-dispatch` | Triggering workflow automation on events |

## Key Logic

**Job queue processing:** The handler is triggered via internal POST (authenticated by `requireInternalCaller`). It claims a batch of up to 50 pending jobs from `job_queue` using `FOR UPDATE SKIP LOCKED` to allow concurrent workers. Each job is dispatched based on `job_type`:

- `process_enrollment` -- Fetches full device from AMAPI, deduplicates via `previousDeviceNames`, upserts device record, assigns group from enrollment token data (with re-enrollment detection), syncs effective policy via derivative system, dispatches `device.enrolled` workflow event.
- `process_status_report` -- Updates device hardware/software/state from AMAPI, syncs application reports, syncs app feedback from keyed app states, stores status report telemetry.
- `process_command` -- Handles command completion notifications. For `START_LOST_MODE` commands that succeed, updates the device state to `LOST`. For `STOP_LOST_MODE`, updates the device state to `ACTIVE`.
- `process_usage_log` -- Processes device usage log events. Extracts lost-mode location records from batch usage log events and inserts them into `device_locations` with source `lost_mode`.
- `process_enterprise_upgrade` -- Handles enterprise upgrade completion: updates `enterprise_features.enterprise_upgrade_status` JSONB, triggers device re-import via `reconcileEnvironmentDeviceImport`.
- `bulk_command` -- Executes a command against multiple devices in sequence via AMAPI.

**Retry logic:** Failed jobs increment `attempts` and are retried up to `MAX_ATTEMPTS` (5). Jobs exceeding max attempts are marked `dead`. Successful jobs are marked `completed`.

**Enrollment deduplication:** Handles `previousDeviceNames` by finding canonical prior records (scored by active state, IMEI/serial match, recency), collapsing transient webhook placeholder rows, and renaming the canonical record. Guards against reviving historical predecessor devices.

**Policy assignment:** Resolves effective policy through a hierarchy (device assignment > group closure walk > environment assignment) and pushes the appropriate derivative policy to AMAPI. Includes generation hash comparison for change detection and rollback on AMAPI failure.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/.netlify/functions/sync-process-background` | Internal (`x-internal-secret` header) | Process queued sync jobs in background |
