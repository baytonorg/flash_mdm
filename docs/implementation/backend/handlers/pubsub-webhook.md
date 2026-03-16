# `netlify/functions/pubsub-webhook.ts`

> Google Cloud Pub/Sub push subscription webhook handler that receives device management events, persists them idempotently, and enqueues background processing jobs.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, context: Context) => Promise<Response>` | Default-exported Netlify function handler |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `normalizeEnterpriseId` | 201-208 | Extracts a bare enterprise ID from various formats (full resource name, bare ID) |
| `extractEnterpriseId` | 210-256 | Tries multiple payload fields to find the enterprise ID: direct fields first, then resource name candidates |
| `buildDeviceAmapiName` | 258-309 | Constructs the full AMAPI device resource name from various payload formats, including batch usage log events (`batchUsageLogEvents.device` as string or object) |
| `triggerQueueWorker` | 311-326 | Fire-and-forget HTTP POST to `sync-process-background` with 1.5s timeout |
| `fastPathUpsertDevice` | 328-420 | Immediately creates/updates a placeholder device row from the webhook payload for fast UI visibility |
| `hydrateDeviceInline` | 422-510 | Fetches full device from AMAPI and upserts (with 2.5s timeout) -- available but not called in main flow |
| `withTimeout` | 512-524 | Promise race helper with timeout |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `queryOne`, `execute` | `_lib/db` | Database operations |
| `storeBlob` | `_lib/blobs` | Storing raw payloads for audit |
| `amapiCall` | `_lib/amapi` | AMAPI device hydration (inline path) |
| `jsonResponse`, `errorResponse` | `_lib/helpers` | Response utilities |

## Key Logic

POST-only endpoint. Designed for minimal latency to return 204 quickly.

**Authentication:** If `PUBSUB_SHARED_SECRET` is set, validates the Bearer token using timing-safe comparison. Otherwise accepts unauthenticated requests.

**Message processing flow:**
1. Parse the Pub/Sub push message envelope (`message.data` is base64-encoded JSON).
2. Determine `notificationType` from message attributes or payload.
3. Extract enterprise ID using a multi-field search strategy to route to the correct environment.
4. If no matching environment is found, store the payload to `_unroutable/` in blob storage and ack with 204.
5. Idempotent insert into `pubsub_events` using `ON CONFLICT (environment_id, message_id) DO NOTHING`. Duplicates are acked immediately.
6. Store raw payload to blob storage (`pubsub-raw/{environment_id}/{message_id}.json`).
7. **Fast-path device upsert:** For ENROLLMENT and STATUS_REPORT events, immediately upsert a placeholder device row from the webhook payload so the device appears in the UI before background processing completes.
8. Enqueue a `process_{notification_type}` job in `job_queue`. For `ENTERPRISE_UPGRADE` events, an additional dedicated `process_enterprise_upgrade` job is also enqueued.
9. Best-effort trigger of the background queue worker.
10. Return 204.

**TEST notifications:** Messages with `notificationType = TEST` and no data are acked immediately with 204.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/.netlify/functions/pubsub-webhook` | Bearer token (optional, via `PUBSUB_SHARED_SECRET`) | Receive Pub/Sub push notifications for device management events |
