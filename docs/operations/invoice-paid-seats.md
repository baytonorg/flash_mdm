# Mark-paid invoice seat contract

For a supported seat item, requested seats minus its gift offset equals its
billable seats. The paid invoice grant contains only billable seats, once per
invoice item, for the item's requested duration. Billing intervals multiply
charged quantity and price, not the number of concurrent licensed seats.
A wholly gifted supported item creates no redundant invoice grant.

The writer accepts current net quantities and documented legacy gross quantities
when requested/gift/billable/interval metadata and the invoice subtotal agree.
A plain legacy item without seat metadata retains its one-interval quantity
fallback. Ambiguous, fractional, out-of-range, inconsistent or partially repriced
metadata returns 409 for deliberate operator review before any write. PostgreSQL
checks exact persisted numbers before JSON decoding can round a fractional value.
No historical invoice or grant is corrected automatically.

Invoice locking serialises competing mark-paid requests. Its configuration reads
use the same transaction client, including safe legacy read savepoints, so a full
five-connection pool cannot deadlock behind the invoice it already holds. Invoice
state, net grants and the first terminal payment audit commit together. A repeated
paid request creates neither another grant nor another terminal payment audit.

The manual gift grant, pending invoice repricing and terminal audit use one
workspace-row-locked transaction. Requested seats remain stable; gift offsets
increase only by newly available seats, net quantity is billable seats times
billing intervals, and subtotal is the sum of those net item quantities times
unit prices. An invoice is automatically paid only when every requested seat is
covered. Repeated offsets never subtract the prior gift twice. A touched legacy
gross invoice is normalised consistently across all its supported items. Invalid
or already inconsistent pending invoices return 409 without retaining the new
gift. Historical paid invoices and grants are not reconciled automatically.

The repricer locks the same pending workspace-to-superadmin invoice snapshot
used by mark-paid. It cannot alter an invoice that became paid while waiting.
Multiple positive invoice items have deterministic per-item grant references;
single-item invoice references stay compatible. Every new grant records invoice
and item provenance. Explicit requested-net-v1 metadata requires net quantities;
only unmarked legacy rows accept the documented gross representation.

Migration 061 permits quantity zero only for guarded requested-net-v1 metadata
with canonical integer requested and gift counts and exact full coverage. Gift
consumption remains visible through the item, with no redundant zero grant.
Older binaries never emit the marker, so their unguarded zero inserts still fail
closed while accepted rows remain readable. No existing row is migrated.

Local invoice requests and manual gifts serialise with workspace FOR NO KEY
UPDATE before invoice locks, compatible with foreign-key KEY SHARE during
mark-paid. Availability uses a post-lock statement_timestamp snapshot. Current
actor, workspace-wide billing authority, effective licensing and priced plan
identity are rechecked after waiting. Remote Stripe checkout reservations and
expiry remain the separate unresolved product decision in #207. These fixes
resolve prospective local arithmetic in #208/#209 and full-gift creation #386.

Workspace invoice grants feed workspace entitlement displays and expiry notices.
Managed-device enforcement uses environment entitlements plus workspace free
seats, independently of these invoice grants. The real PostgreSQL acceptance
compares its environment snapshot, entitlements and job state before and after.
There is no production payment, gift/grant/invoice mutation, device action or
credential change in the maintenance acceptance procedure.
