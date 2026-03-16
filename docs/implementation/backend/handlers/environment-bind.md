# `netlify/functions/environment-bind.ts`

> Manages the Android Enterprise binding lifecycle for environments: two-step signup URL flow, attaching existing (orphaned) enterprises, unbinding, and deleting enterprises. Also bootstraps devices and pushes policies after binding.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, context: Context) => Promise<Response>` | Netlify function handler |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `pushAllPoliciesToAmapi` | 496-545 | Iterates all policies in the environment and syncs each to AMAPI via `syncPolicyDerivativesForPolicy`; promotes draft policies to production |
| `bootstrapDevicesForAttachedEnterprise` | 546-646 | Pages through AMAPI device list and upserts each device into the local `devices` table (capped at 500) |
| `cleanupEnterpriseReferences` | 653-700 | Shared cleanup for unbind/delete: clears enterprise fields, resets policies to draft, deletes derivatives and assignments, invalidates enrollment tokens, clears device policy sync state |

## Internal Interfaces

| Name | Lines | Description |
|------|-------|-------------|
| `AmapiBootstrapDevice` | 15-43 | Shape of an AMAPI device resource used during bootstrap import |
| `AmapiBootstrapDeviceListResponse` | 45-48 | Shape of the AMAPI devices.list response |

## Constants

| Name | Value | Description |
|------|-------|-------------|
| `BOOTSTRAP_DEVICE_PAGE_SIZE` | `100` | Page size for device bootstrap list calls |
| `BOOTSTRAP_DEVICE_MAX` | `500` | Maximum devices to import during bootstrap (full reconcile catches the rest) |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `query`, `queryOne`, `execute` | `_lib/db.js` | Database access |
| `requireAuth` | `_lib/auth.js` | Authentication |
| `requireEnvironmentResourcePermission` | `_lib/rbac.js` | RBAC enforcement (`manage_settings`) |
| `amapiCall`, `getAmapiErrorHttpStatus` | `_lib/amapi.js` | Calling the Android Management API |
| `logAudit` | `_lib/audit.js` | Audit logging |
| `jsonResponse`, `errorResponse`, `parseJsonBody`, `getClientIp` | `_lib/helpers.js` | HTTP helpers |
| `BRAND` | `_lib/brand.js` | Default enterprise display name fallback |
| `syncPolicyDerivativesForPolicy` | `_lib/policy-derivatives.js` | Pushing policies to AMAPI |
| `syncSigninDetailsToAmapi` | `signin-config.js` | Syncing sign-in enrollment config after bind |

## Key Logic

The handler is POST-only and uses `body.action` and the presence of `enterprise_token` / `existing_enterprise_name` to determine the operation:

1. **Cancel bind** (`action: 'cancel_bind'`): Clears a stored `signup_url_name` when the user abandons the bind flow before completing step 2.

2. **Unbind** (`action: 'unbind'`): Runs `cleanupEnterpriseReferences` to remove all local enterprise state without deleting the enterprise from Google.

3. **Delete enterprise** (`action: 'delete_enterprise'`): Calls AMAPI `DELETE` on the enterprise, then runs the same local cleanup as unbind.

4. **Attach existing enterprise** (`existing_enterprise_name` provided): Validates the enterprise name format, checks it is not already linked to another environment, fetches enterprise details from AMAPI, updates the environment record, pushes all policies, syncs sign-in config, and bootstraps devices. Returns the enterprise details and bootstrap stats.

5. **Step 2: Finalize binding** (`enterprise_token` provided): Uses the stored `signup_url_name` to call AMAPI `enterprises.create` with the token. Stores enterprise details, pushes policies, and syncs sign-in config.

6. **Step 1: Create signup URL** (default path): Calls AMAPI `signupUrls.create` with a callback URL pointing to the app's enterprise callback page. Stores the returned `signup_url_name` for step 2.

Post-bind actions (policy push, sign-in sync, device bootstrap) are best-effort -- failures are logged but do not block the bind response.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/.netlify/functions/environment-bind` | Session / API key | Enterprise binding operations (step 1, step 2, attach, unbind, delete, cancel) |
