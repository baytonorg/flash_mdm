# `netlify/functions/network-crud.ts`

> CRUD handler for network deployments (WiFi and APN) with policy config cleanup on delete, bulk delete support, and AMAPI derivative sync.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, _context: Context) => Promise<Response>` | Netlify function handler (default export) |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `handleBulk` | 79-148 | Bulk delete operation: accepts a selection of IDs (or all_matching with exclusions) and deletes each, collecting per-item results |
| `handleGet` | 152-183 | Retrieves a single network deployment by ID with parsed ONC profile and inferred network type |
| `handleDelete` | 187-292 | Deletes a network deployment, removes stale references from affected policy configs (ONC or APN), then syncs AMAPI derivatives |
| `handleUpdate` | 299-440 | Updates a network deployment's name, profile, hidden_ssid, and auto_connect; syncs affected AMAPI policies. Scope is not updatable. |
| `inferNetworkType` | 444-447 | Determines if a stored profile represents a WiFi or APN network based on profile shape |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `queryOne`, `execute`, `transaction` | `_lib/db.js` | Database queries, execution, and transactions |
| `requireAuth` | `_lib/auth.js` | Session/API key authentication |
| `requireEnvironmentPermission` | `_lib/rbac.js` | Environment-level RBAC enforcement |
| `logAudit` | `_lib/audit.js` | Audit trail logging |
| `parseOncDocument`, `getApnSettingKey`, `removeOncDeploymentFromPolicyConfig`, `removeApnDeploymentFromPolicyConfig` | `_lib/policy-merge.js` | ONC/APN document parsing and policy config cleanup on delete |
| `jsonResponse`, `errorResponse`, `parseJsonBody`, `getClientIp` | `_lib/helpers.js` | HTTP response builders, body parsing, IP extraction |
| `syncAffectedPoliciesToAmapi`, `selectPoliciesForDeploymentScope` | `_lib/deployment-sync.js` | AMAPI derivative policy sync |

## Key Logic

The handler routes based on HTTP method and the first URL segment after `/api/networks/`:

**GET /:id** - Returns a single deployment with its parsed ONC/APN profile and inferred network type.

**DELETE /:id** - Performs a transactional delete:
1. Identifies all policies affected by the deployment's scope.
2. Cleans stale network references from each policy's stored config:
   - For WiFi: removes ONC entries by GUID or SSID using `removeOncDeploymentFromPolicyConfig`.
   - For APN: removes APN settings by composite key using `removeApnDeploymentFromPolicyConfig`.
3. Deletes the deployment row.
4. Syncs AMAPI derivatives for all affected policies.

**PUT /:id** - Updates deployment properties. Scope (`scope_type`/`scope_id`) is immutable; to change scope, delete and re-create. Accepts `name`, `onc_document` (WiFi), `apn_policy` (APN), `hidden_ssid`, and `auto_connect`. Does NOT modify policy configs directly; `buildGeneratedPolicyPayload` re-applies from the `network_deployments` table during sync.

**POST /bulk** - Bulk delete operation accepting `{ operation: "delete", environment_id, selection: { ids?, all_matching?, excluded_ids? } }`. Iterates through targeted IDs, calling `handleDelete` for each, and returns per-item success/failure results.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | /api/networks/:id | Session (read) | Get a network deployment by ID |
| PUT | /api/networks/:id | Session (write) | Update a network deployment |
| DELETE | /api/networks/:id | Session (write) | Delete a network deployment with policy cleanup |
| POST | /api/networks/bulk | Session (write) | Bulk delete network deployments |
