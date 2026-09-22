# `netlify/functions/_lib/outbound-webhook.ts`

> Executes outbound webhook requests only after DNS-aware SSRF validation.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `executeValidatedOutboundWebhook` | `(input: ExecuteValidatedOutboundWebhookInput) => Promise<Response>` | Validates the destination URL with `validateResolvedWebhookUrlForOutbound`, then sends a JSON request with timeout and redirect blocking |

## Internal Types

| Name | Description |
|------|-------------|
| `ExecuteValidatedOutboundWebhookInput` | Request shape containing `url`, optional `method`, `body`, `headers`, and `timeoutMs` |

## Key Logic

`executeValidatedOutboundWebhook` is the shared egress point for queued outbound webhook jobs. It:

1. Calls `validateResolvedWebhookUrlForOutbound` before network egress.
2. Throws the validation error and skips `fetch` if validation fails.
3. Defaults to `POST`, JSON content type, `{}` body, and a 10 second timeout.
4. Sets `redirect: 'error'` so redirects cannot move a validated destination to a blocked address.
5. Clears the abort timeout in a `finally` block.

## Used By

| Consumer | Purpose |
|----------|---------|
| `netlify/functions/sync-process-background.ts` | Executes geofence webhook jobs enqueued by `geofence-check-scheduled` |

## Evidence

| Claim | Evidence | Confidence |
|---|---|---|
| Failed DNS-aware validation prevents outbound fetch. | `netlify/functions/_lib/outbound-webhook.ts`; `netlify/functions/_lib/__tests__/outbound-webhook.test.ts` | high |
| Redirects are blocked during webhook egress. | `netlify/functions/_lib/outbound-webhook.ts`; `netlify/functions/_lib/__tests__/outbound-webhook.test.ts` | high |
