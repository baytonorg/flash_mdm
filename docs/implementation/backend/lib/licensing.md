# `netlify/functions/_lib/licensing.ts`

> Core licensing engine: resolves workspace licensing settings, calculates seat entitlements, builds environment licensing snapshots, and enforces enrollment blocks on overage.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `WorkspaceLicensingSettings` | `interface` | Shape describing merged platform + workspace licensing configuration (free tier, grace days, billing method, etc.) |
| `EnvironmentLicensingSnapshot` | `interface` | Point-in-time licensing state for a single environment (seats, overage, phase, enrollment blocked) |
| `isLicensingEnforcementEnabled` | `() => boolean` | Returns `true` when `LICENSING_ENFORCEMENT_ENABLED` env var is `'true'` |
| `isLicensingDryRun` | `() => boolean` | Returns `true` unless `LICENSING_DRY_RUN` is explicitly `'false'` (defaults to dry-run) |
| `getOveragePhaseForAgeDays` | `(ageDays: number, settings: WorkspaceLicensingSettings) => 'warn' \| 'block' \| 'disable' \| 'wipe'` | Maps overage age in days to the escalation phase using the workspace grace-day thresholds |
| `getWorkspaceLicensingSettings` | `(workspaceId: string) => Promise<WorkspaceLicensingSettings>` | Loads and merges platform-level and workspace-level licensing settings, with column-availability fallback for schema migrations |
| `isPlatformLicensingEnabled` | `() => Promise<boolean>` | Checks the platform_settings table for the global licensing toggle |
| `getWorkspacePlatformEntitledSeats` | `(workspaceId: string) => Promise<number>` | Sums active `license_grants` seat count plus free-tier seats for a workspace |
| `getWorkspaceAvailableGiftSeats` | `(workspaceId: string) => Promise<number>` | Returns unconsumed gift seats (total gift grants minus gift offsets recorded on invoices) |
| `getEnvironmentEntitledSeats` | `(environmentId: string) => Promise<number>` | Sums active `environment_entitlements` seat count for an environment |
| `getEnvironmentSeatConsumptionCount` | `(environmentId: string) => Promise<number>` | Counts non-deleted devices in ACTIVE, DISABLED, or PROVISIONING state for an environment |
| `getEnvironmentLicensingSnapshot` | `(environmentId: string) => Promise<EnvironmentLicensingSnapshot>` | Builds a full licensing snapshot: device count, entitled seats, overage, open case, phase, enrollment-blocked flag |
| `getWorkspaceEnvironmentLicensingSnapshots` | `(workspaceId: string) => Promise<EnvironmentLicensingSnapshot[]>` | Returns licensing snapshots for every environment in a workspace |
| `assertEnvironmentEnrollmentAllowed` | `(environmentId: string) => Promise<void>` | Throws a 402 Response if enrollment is blocked due to licence overage; no-ops when enforcement is disabled |
| `syncLicensingWindowExpiries` | `() => Promise<{ platform_grants_expired: number; environment_entitlements_expired: number }>` | Marks expired `license_grants` and `environment_entitlements` rows as `'expired'` |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `normalizeSettings` | 55-74 | Clamps seat limits to 0..1,000,000 and resets grace days to defaults if they violate the required ordering (block < disable < wipe) |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `execute`, `query`, `queryOne` | `_lib/db.js` | All database queries |
| `isMissingRelationError` | `_lib/db-errors.js` | Graceful handling when tables do not yet exist |
| `getPlatformSettings` | `_lib/platform-settings.js` | Reading platform-level licensing defaults |

## Key Logic

Settings resolution merges three layers: hard-coded `DEFAULT_SETTINGS`, platform settings from `platform_settings`, and per-workspace overrides from `workspace_licensing_settings`. The workspace query uses progressive column-fallback (catching Postgres `42703` undefined-column errors) so the code works across schema migration states.

`getEnvironmentLicensingSnapshot` is the central read path. It fetches the environment's workspace settings, entitled seats, active device count, and any open overage case in parallel, then derives the overage count, phase, and whether enrollment should be blocked.

`assertEnvironmentEnrollmentAllowed` is called during device enrollment. When enforcement is enabled and the snapshot shows `enrollment_blocked`, it throws a 402 HTTP response. Errors during evaluation are logged but swallowed so enrollment is not accidentally blocked by transient failures.

Grace-day escalation follows the progression: warn -> block -> disable -> wipe, with configurable day thresholds that must be strictly ascending.
