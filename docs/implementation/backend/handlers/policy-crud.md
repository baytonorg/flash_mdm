# `netlify/functions/policy-crud.ts`

> Core CRUD handler for policies: list, get, create, update, delete, bulk operations, external AMAPI policy fetch, and derivative listing.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, context: Context) => Promise<Response>` | Netlify function handler |

## Internal Types

| Name | Lines | Description |
|------|-------|-------------|
| `BulkSelection` | 18-27 | Selection criteria for bulk operations: explicit IDs or filter-based matching with exclusions |
| `PolicyBulkBody` | 29-36 | Request body for bulk operations: operation type, environment, selection, and options |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `canViewPolicyInScopedEnvironment` | 38-93 | Checks whether a group-scoped user can see a specific policy based on assignment visibility through group closures and device membership |
| `pushPolicyToAmapi` | 976-1075 | Generates the AMAPI payload, validates it, PATCHes to AMAPI, updates local status to production, and syncs derivatives. Used by bulk `set_production`/`push_to_amapi` operations |
| `performPolicyDelete` | 1077-1162 | Deletes a policy after checking device usage, cleaning up AMAPI derivatives and the base AMAPI policy. Used by bulk `delete` |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `query`, `queryOne`, `execute`, `transaction` | `_lib/db.js` | Database operations |
| `requireAuth` | `_lib/auth.js` | Session/API key authentication |
| `requireEnvironmentAccessScopeForResourcePermission`, `requireEnvironmentResourcePermission` | `_lib/rbac.js` | Environment-level and group-scoped RBAC |
| `amapiCall`, `getAmapiErrorHttpStatus` | `_lib/amapi.js` | AMAPI HTTP calls and error status extraction |
| `AmapiPolicyValidationError`, `assertValidAmapiPolicyPayload` | `_lib/amapi-policy-validation.js` | Pre-flight validation of AMAPI policy payloads |
| `logAudit` | `_lib/audit.js` | Audit log entries |
| `storeBlob` | `_lib/blobs.js` | Store policy config artifacts to Netlify Blobs |
| `buildPolicyUpdateMask` | `_lib/policy-update-mask.js` | Compute AMAPI `updateMask` for partial PATCH |
| `sanitizeConfig` | `_lib/policy-recompile.js` | Strip invalid/dangerous fields from policy config |
| `buildGeneratedPolicyPayload` | `_lib/policy-generation.js` | Generate the full AMAPI policy payload with layered overrides |
| `syncPolicyDerivativesForPolicy`, `getPolicyAmapiContext` | `_lib/policy-derivatives.js` | Derivative sync and AMAPI context resolution |
| `jsonResponse`, `errorResponse`, `parseJsonBody`, `getClientIp`, `getSearchParams`, `isValidUuid` | `_lib/helpers.js` | HTTP response helpers, request parsing, UUID validation |

## Key Logic

### List (GET /list)
- Returns all policies for an environment with a computed `device_count` using the full assignment cascade (device > group > environment > legacy).
- Group-scoped users see only policies visible through their assigned groups (via assignment + device membership checks).

### Get (GET /:id)
- Returns a single policy with its environment metadata and assigned components.
- Group-scoped users are checked via `canViewPolicyInScopedEnvironment`.

### Create (POST /create)
- Creates a new policy in `draft` status with version 1.
- Sanitizes the config via `sanitizeConfig`.
- Stores an initial `policy_versions` record within a transaction.

### Update (PUT /update)
- Increments version, stores a new `policy_versions` record, and updates the policy row.
- Stores the config artifact to Netlify Blobs.
- If `push_to_amapi` is true: builds the generated payload, computes an `updateMask` (diff against previous generated payload), validates, PATCHes to AMAPI, updates status to `production`, and syncs derivatives. On AMAPI failure, returns a partial success response (saved locally).
- The Default policy cannot be edited.

### Delete (DELETE /:id)
- Blocks deletion if devices are still using the policy or if it is the Default policy.
- Cleans up AMAPI derivative resources (DELETE calls) and the base AMAPI policy before deleting the local DB row.

### Bulk (POST /bulk)
- Supports operations: `copy`, `delete`, `set_draft`, `set_production`, `push_to_amapi`.
- Selection can be explicit IDs or `all_matching` with filters (status, scenario, search) plus exclusions.
- Each policy is processed individually; results are returned per-policy with `ok`/`error` status.
- The Default policy is skipped for all bulk operations.

### External (GET /external)
- Fetches an AMAPI policy directly from Google by `amapi_name`, cross-referencing with local policy and derivative records.
- Group-scoped users must provide a `device_id` whose `appliedPolicyName` matches.

### Derivatives (GET /derivatives)
- Lists all `policy_derivatives` rows for a policy with scope names, device counts, and sync status.
- Includes a schema compatibility fallback for databases missing `status`/`last_synced_at` columns.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/.netlify/functions/policy-crud` (action=`list`) | Session | List policies for an environment |
| GET | `/.netlify/functions/policy-crud` (action=`:id`) | Session | Get a single policy by UUID |
| GET | `/.netlify/functions/policy-crud` (action=`external`) | Session | Fetch an AMAPI policy by its AMAPI name |
| GET | `/.netlify/functions/policy-crud` (action=`derivatives`) | Session | List derivatives for a policy |
| POST | `/.netlify/functions/policy-crud` (action=`create`) | Session | Create a new draft policy |
| POST | `/.netlify/functions/policy-crud` (action=`bulk`) | Session | Bulk operations on policies |
| PUT | `/.netlify/functions/policy-crud` (action=`update`) | Session | Update a policy (optionally push to AMAPI) |
| DELETE | `/.netlify/functions/policy-crud` (action=`:id`) | Session | Delete a policy |
