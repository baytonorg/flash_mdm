# `netlify/functions/network-deploy.ts`

> Deploys a WiFi or APN network configuration to a specific scope, normalizing the ONC/APN document and syncing affected AMAPI policies.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, _context: Context) => Promise<Response>` | Netlify function handler (default export) |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `buildOpenWifiProfile` | 267-286 | Builds a single ONC WiFi NetworkConfiguration entry with a stable GUID |
| `buildOpenWifiOncDocument` | 288-300 | Wraps a WiFi profile in an ONC UnencryptedConfiguration document |
| `buildStableWifiGuid` | 302-305 | Generates a deterministic GUID from scope type, scope ID, and SSID |
| `normalizeOncDeploymentDocument` | 307-361 | Validates and normalizes an ONC document: enforces single WiFi entry, fills GUID/name, normalizes booleans |
| `normalizeApnDeploymentPolicy` | 363-414 | Validates and normalizes an APN policy: enforces single apnSettings entry, normalizes all fields, builds composite DB key |
| `normalizeApnSetting` | 416-456 | Maps and validates individual APN setting fields to AMAPI ApnSetting schema (accepts legacy field names) |
| `assignTrimmedString` | 458-462 | Helper: assigns a trimmed string to a target object if non-empty |
| `assignInteger` | 464-471 | Helper: assigns a validated non-negative integer to a target object |
| `assignEnumArray` | 473-485 | Helper: assigns a deduplicated array of trimmed strings to a target object |
| `buildStableApnKey` | 487-504 | Generates a deterministic DB key from scope, display name, APN value, and operator ID |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `queryOne`, `transaction` | `_lib/db.js` | Database queries and transactional writes |
| `requireAuth` | `_lib/auth.js` | Session/API key authentication |
| `requireEnvironmentPermission` | `_lib/rbac.js` | Environment-level RBAC enforcement |
| `logAudit` | `_lib/audit.js` | Audit trail logging |
| `parseOncDocument`, `parseApnPolicy`, `getApnSettingKey` | `_lib/policy-merge.js` | ONC/APN document parsing and key extraction |
| `jsonResponse`, `errorResponse`, `parseJsonBody`, `getClientIp` | `_lib/helpers.js` | HTTP response builders, body parsing, IP extraction |
| `syncAffectedPoliciesToAmapi`, `selectPoliciesForDeploymentScope` | `_lib/deployment-sync.js` | AMAPI derivative policy sync |

## Key Logic

The handler processes a single POST to deploy a network configuration:

1. **Validation**: Requires `environment_id`, `scope_type`, and `scope_id`. Validates scope type and verifies the target (environment/group/device) exists. For environment scope, `scope_id` must equal `environment_id`.

2. **Normalization**: Based on `network_type` (defaults to `wifi`):
   - **WiFi**: If `onc_document` is provided, normalizes it (enforces single NetworkConfiguration, fills GUID from stable hash, validates WiFi SSID). If not provided, builds an open WiFi ONC document from `ssid`, `name`, `hidden_ssid`, and `auto_connect` fields.
   - **APN**: Normalizes `apn_policy` (or `onc_document` for APN): enforces single apnSettings entry, maps legacy field names to AMAPI schema, validates required fields (`displayName`, `apn`), validates `numericOperatorId` format (5-6 digits).

3. **Transaction** (Step 1): Upserts into `network_deployments` using `ON CONFLICT (environment_id, network_type, ssid, scope_type, scope_id)`. Does NOT modify policy configs directly -- derivative sync rebuilds payloads from the deployments table.

4. **AMAPI Sync** (Step 2): Syncs all affected policies to AMAPI via `syncAffectedPoliciesToAmapi`.

5. **Audit & Response**: Logs detailed audit entry with network-type-specific metadata. Returns deployment details and sync status with a warning if sync partially failed.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | /api/networks/deploy | Session (write) | Deploy a WiFi or APN network configuration to a scope |
