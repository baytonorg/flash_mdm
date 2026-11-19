# Webhook delivery and diagnostic privacy

Workflow webhook delivery continues to use the complete validated HTTPS URL,
including query authentication and path-based hook identifiers. Prefer the
existing dedicated secret-header field where the receiver supports it. Validation,
request headers/body, redirect policy and delivery/retry decisions are unchanged.

New workflow results retain `webhook_url` as an origin-only diagnostic value,
for example `https://hooks.example.test:8443`. Userinfo, the entire path, query and
fragment are excluded. Invalid or excessive origins become `[redacted]`.
Successful and non-2xx workflow results still include the HTTP status. Response
bodies are not copied into diagnostics.

Workflow and queued geofence webhook transport exceptions are normalised before
shared handlers log them or store errors. They retain only `Webhook delivery
failed` or `Webhook delivery timed out`, without a provider message, stack cause,
URL or header value. Operational provider tracing independently records its fixed
operation, outcome, status and allowlisted error class.

This is prospective output protection. Configured destinations and queued delivery
payloads still need their full value for sending. Their protected storage and
lifecycle remain issue #282; queued non-2xx/retry semantics remain #278. This change
does not rewrite historical execution/audit/error records or alter credentials.
A historical review must use read-only counts and classifications before any
separately authorised retention action. Do not print stored destinations.

Required CI runs synthetic real PostgreSQL workflow and queued-worker controls in
`webhook-privacy.postgres.test.ts` through `test:membership-postgres`. Successful,
non-2xx, transport, abort and blocked-address cases verify the full delivery value
is preserved, while results, audit, console output, trace and queue error fields
exclude the synthetic bearer markers. The fixture's configuration and queue
payload deliberately retain fictional values; they are not diagnostic output.
