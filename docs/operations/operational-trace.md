# Operational trace

The VPS runtime records a detailed development diagnostic trace separately from the security audit table. Superadmins can open **Stats > Logs > Operational trace** to check collection health, filter a bounded tail by actor/request or problems, and stream a retained window as NDJSON. The UI does not read every file on each refresh. Normal users and API keys cannot read or download this platform-wide trace.

## Coverage

- HTTP requests and outcomes, authenticated human/key/support identity, current scope, safe resource UUIDs, status, duration and request/span correlation.
- Browser navigation, clicks, field changes, submits, browser validation failures and JavaScript/React errors. These are explicitly client-reported; no keystrokes, form values or rendered page text are collected. API-result events link to the server request ID. Background requests do not establish human intent.
- Database operation/table category, row count, duration, transaction commit/rollback and structured error class/code/source locations. SQL text and bind values are excluded.
- AMAPI attempts, safe-retry status, OpenAI/Flashi reads, Stripe responses, mail and outbound webhook outcomes. Headers, credentials and provider payloads are excluded.
- Audit writes, job execution/completion/failure, process exceptions and console-event fingerprints/source locations. Transactional audit writes remain provisional until their transaction commits.

Request/response bodies, cookies, passwords, tokens, MFA material, signing/service keys and arbitrary exception messages never enter this event contract. Successful responses contribute only allowlisted booleans/counts/statuses. Large or streaming responses have bounded outcome inspection; unavailable detail is labelled. Unexpected HTML from an API is a protocol failure. Existing application/edge journals remain separate evidence sources.

## Storage and performance

The installer supplies `FLASH_TRACE_DIR=<installation>/data/operational-trace` and a web/worker component label through systemd. It preserves the application `.env` and all credentials. The directory is private mode 0700; new files are mode 0600. Symlinks are not followed by the reader/writer.

Rotation occurs at 09:00 Europe/London, aligned with the daily automation. Local-clock windows are 23/25 hours across DST changes; the default report is an exact rolling 24 hours. Three completed windows plus the current window are retained, subject to a 384 MiB directory budget, 128 MiB per-process/window budget, and 16 MiB segments. Concurrent writers check the shared directory every ten seconds, so transient budget overruns are possible; each writer remains bounded. Derived daily checkpoints retain 35 windows at at most 2 MiB each.

Writes are asynchronous and batched, with a 2 MiB queue and 8 KiB event limit. Disk-free protection starts below 256 MiB. Pressure or storage failure drops diagnostic events rather than blocking product work; health counters, protected writer summaries and rate-limited journal warnings expose the loss. The card checks fresh web and worker heartbeats, and reports flag stale writers that never closed. Budget eviction leaves a marker against the affected window. Logging failure is never interpreted as evidence of platform health.

Successful empty worker polls are coalesced into minute summaries. Work, provider calls, audit writes, rejected/failed requests and retries open the detailed trace. This prevents idle polling from consuming the useful diagnostic budget. These raw traces are operational evidence, not a tamper-proof compliance ledger or a complete personal-data erasure facility.

## Daily report

Run from the deployed release, as an authorised container operator:

```sh
FLASH_TRACE_DIR=<configured-private-directory> node --import tsx scripts/operational-trace-report.ts
FLASH_TRACE_DIR=<configured-private-directory> node --import tsx scripts/operational-trace-report.ts --completed --checkpoint
FLASH_TRACE_DIR=<configured-private-directory> node --import tsx scripts/operational-trace-report.ts --window YYYY-MM-DD
```

The default emits exact rolling 24-hour detail. The completed-window command records derived aggregates for rolling 7-day/30-day comparison. It refuses speculative checkpoints where no collection evidence exists. New deployment windows, invalid records, drops, evictions, limited correlation and incomplete history are reported explicitly. Human, key, support and system activity remain separate; session creation/expiry and background reads do not prove ongoing human engagement.

The daily automation must inspect both good and bad results, recoveries and repeated failures, then follow request/span/source locations before filing a defect. It still performs proactive source/logic review and the existing platform checks. Quiet logs cannot establish correctness, and raw/user-level traces must not be copied into bayton-library. Preserve only aggregates, durable findings and actionable exceptions there.
