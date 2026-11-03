# Membership and account lifecycle

Membership removal and account deletion are separate actions. Deleting a resource removes its grants; it does not require transferring ownership of that deleted resource.

## Surviving access and ownership

A workspace owner is a seat with both `role=owner` and `access_scope=workspace`. An environment or group owner, including an owner label on a scoped seat, is not a workspace owner. Surviving workspaces require an owner. Surviving environments/groups require a management path under the effective permission matrix.

Direct environment roles precede workspace inheritance. The nearest direct group or ancestor grant precedes environment/workspace inheritance. Removing a direct grant can reveal a stronger inherited role. The editor shows before/after access for loaded scopes; the server validates the final result.

Single and bulk mutations use the shared membership lifecycle service. Workspace locks are acquired in stable ID order, then targets and permissions are re-read using the same transaction client. The eligible bulk batch is atomic, including ownership, assignments, session context and audit writes. Ineligible selections retain explicit per-target failures. A deferred database constraint also guards workspace ownership for registration and other seat writers.

Changing the workspace role preserves independent child roles. A combined role/scope save is one operation. An explicit scoped role or bulk role override applies to selected grants. Environment managers cannot change a parent workspace grant or cancel an invitation spanning scopes outside their authority. Pending offers that could restore removed access require an explicit cancellation choice; deliberate later re-invitation remains possible.

Session-only actions support leaving a workspace and transferring ownership to an existing member. Transfer includes acknowledgement that the successor agreed to workspace-wide ownership and the actor's resulting role or removal. Both changes commit together. There is no automatic choice of successor or promotion through an old invitation.

## Invites and onboarding

Acceptance locks and consumes the offer once, validates the authenticated email and current issuer authority, and revalidates target scopes. Conflicting existing grants return a reviewable conflict rather than being silently overwritten. Signup-link registration shares the reference lock used by signup-link writes and environment deletion, and rechecks the link before committing.

First-environment setup is scoped to the authorising workspace and consumed transactionally. Concurrent attempts cannot create two first environments, and deleting the environment does not restore the entitlement. Legacy setup flags need matching retained signup authorisation; missing evidence needs operator review. No existing accounts or grants are normalised by the migration.

## API keys and provenance

Keys remain independent workspace/environment principals. Their authority does not depend on a creator's membership or continued existence. Removing, demoting or deleting the creator does not rotate, revoke, expire, downgrade or transfer a key. Existing key-management permissions and the prohibition on key-authenticated credential management remain.

Migration 059 changes creator provenance to nullable `ON DELETE SET NULL`. Key authentication uses a real key principal and optional creator metadata. It does not fabricate a human actor. Applicable creator/actor writes accept null human provenance; creator-only membership inserts are limited to humans with a valid workspace seat. Audits attribute key requests to the key principal.

Flashi history for a key is stored under that key, separately from human history. Existing human history is retained unchanged; it is not copied into key history. API-key callers without user-management permission have no personal human membership row to list.

## Permanent user deletion

Superadmins first call `preflight_user_deletion` through `/api/superadmin/actions`. The read-only result lists memberships, sole ownership, sessions/support sessions, independent keys, grants, pending invitations, sign-in links, personal history counts and retained shared/external/billing state. Unknown user foreign-key dependencies block execution for review. Backup availability is explicitly unverified by this preflight.

Execution requires the typed email and explicit acknowledgement of sign-in credential deletion and related session termination, plus cancellation of pending invitations when present. It revalidates the preflight under locks, removes all memberships, ends related sessions, deletes addressed sign-in links and pending offers, detaches retained actor references and deletes the identity transactionally. A late audit failure rolls back the operation. API-key creator provenance detaches without deleting keys. Accepted invitation records and audit/history records may retain identifying information: this is account offboarding, not a promise of complete personal-data erasure.

No account is deleted merely because it is inactive. Production deletion still needs a separately named target and selected action. Tests use synthetic identities only.

## Resource cleanup and release validation

Environment deletion and workspace operational purge use one local cleanup implementation, including audit detachment and legacy-table savepoints. Purge retains the workspace and its members. Its UI collects the support reason and customer-notice acknowledgement. Scoped key/signup-link dependencies block purge unless separately handled through the environment's explicit cleanup flow. Google deletion/unbind and billing actions remain separate.

Group moves, subtree deletion and device group changes revalidate current authority under the workspace lock and commit local state, audit and durable policy jobs together. Direct grants follow their group. A move requires authority at both ends, and a move to root requires environment-wide authority. Deletion removes subtree grants and local assignments, ungroups active and archived devices, retains user accounts and external policy resources, and blocks on enrolment, sign-in, invitation or signup-link references without altering those records. No ownership transfer is needed for a deleted group.

The worker resolves each device's current direct, nearest group or environment policy at execution time and regenerates the appropriate derivative. Provider failures use the existing durable retry mechanism. A successful local edit means reconciliation is queued, not that a device has already applied it. Physical-device acceptance and restoration are required before release sign-off. Full workspace deletion and an authenticated existing-user signup-link join remain separate capabilities, not implemented by this change.

Run `npm run test:membership-postgres` for disposable PostgreSQL 17 acceptance. It never uses `DATABASE_URL`; it starts and removes its own local container. `MEMBERSHIP_TEST_SCHEMA_PATH` optionally supplies a schema-only deployment snapshot before applying the new migration. CI runs this suite in addition to the full unit/component suite and build.

The key matrix covers workspace/environment scopes, all roles, allowed/denied reads and writes, expiry/revocation, platform-admin denial, creator removal/deletion, material preservation and actor attribution. Destructive tests stay in fixtures. Production smoke uses approved existing keys only inside the production container and read requests only. Report any role/scope coverage unavailable in production.

Apply migration 059 before switching to the new application release. It changes no existing key material, scope, role, expiry or revocation state. A code rollback can retain the additive schema/provenance constraint; do not restore the old cascading creator FK or use rollback to restore deleted customer identities casually.

Once creator provenance has detached, any rollback must retain independent-key authentication and principal compatibility. Older creator-dependent authentication cannot serve those keys safely. Prefer a validated corrective release rather than rolling back to that behaviour.
