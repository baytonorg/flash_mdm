# Integrations

This page describes the core external systems Flash MDM depends on.

## Android Management API (AMAPI)

**What it’s used for**

- Enterprise binding (Environment ↔ AMAPI enterprise)
- Device lifecycle operations
- Policy creation/patching
- Device commands (e.g. disable/wipe)

**Auth model**

- Service account credentials are uploaded via the UI and stored encrypted at rest.
- Backend uses `google-auth-library` to mint AMAPI auth.

**Operational concerns**

- Rate limiting and retries (AMAPI is an external dependency; design assumes transient failure)
- Background reconciliation for eventual consistency

## Google Pub/Sub (AMAPI notifications)

- AMAPI can push notifications to a Pub/Sub topic.
- Flash MDM receives push notifications via a webhook endpoint and processes them asynchronously.

**Security**

- Push webhook can enforce a shared secret (`PUBSUB_SHARED_SECRET`).
- If `PUBSUB_SHARED_SECRET` is unset, the webhook falls back to unauthenticated acceptance. This is intentional for ease of initial deployment; operators should set `PUBSUB_SHARED_SECRET` in production for defence-in-depth.

## Outbound webhooks (workflow/geofence actions)

- Used for workflow `notification.webhook` actions and geofence webhook actions.
- URLs are validated with DNS-aware SSRF checks before egress.
- Geofence webhook URLs are validated at save-time and revalidated again immediately before outbound execution.
- Outbound fetches use redirect blocking (`redirect: 'error'`).

## Stripe (billing/licensing)

- Optional: used for licensing/entitlement management.
- Platform and/or workspace billing flows may exist depending on configuration.

**Key features**

- Checkout/session creation
- Portal access
- Webhook verification + idempotency

## Resend (email)

- Transactional email for auth/billing/licensing notifications.

**Security**

- Templates must escape user-provided values to prevent HTML injection.

## OpenAI (AI assistant)

- Used by Flashi for conversational AI responses via the Chat Completions API.
- Tool-calling loop: the LLM decides which tools to call, executes them, and iterates.
- Model: `gpt-4.1-mini` (configurable via `FLASHAGENT_MODEL`).
- API key stored as a Netlify environment variable (`OPENAI_API_KEY`).

**Security**

- Read-only tools only — no mutations via the LLM.
- Prompt injection defences: structured JSON context, safety reinforcement.
- Rate limiting per IP and principal.
- 5-minute total execution budget per request.

## AMAPI MCP (Model Context Protocol)

- Flash proxies JSON-RPC requests to Google's AMAPI MCP endpoint at `https://androidmanagement.googleapis.com/mcp`.
- Used by Flashi for real-time enterprise data queries, but available as a standalone feature.
- Strict read-only tool allowlist: `list_devices`, `get_device`, `list_policies`, `get_policy`, `get_application`, `list_web_apps`, `get_web_app`.
- Enterprise binding validation: every tool call must reference the environment's bound enterprise.

## Netlify

- Hosts the SPA, provides serverless functions runtime.
- Provides function logs and deploy rollback.
- Handles redirects/routing via `netlify.toml`.

See also: [Netlify deployment](../deployment/netlify.md)
