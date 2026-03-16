# `netlify/functions/certificate-crud.ts`

> CRUD handler for certificate management: list, upload (with PEM parsing and blob storage), and soft-delete with AMAPI policy derivative sync.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, context: Context) => Promise<Response>` | Netlify function handler (default export) |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `parseCertificate` | 15-44 | Parses a PEM certificate to extract SHA-256 fingerprint (formatted as colon-separated hex); subject, issuer, and expiry extraction noted as requiring a dedicated ASN.1 library |
| `isValidPem` | 49-51 | Validates that a string contains PEM certificate header and footer markers |
| `syncEnvironmentPoliciesAfterCertificateChange` | 53-81 | After certificate upload or deletion, iterates all policies in the environment and re-syncs their AMAPI derivatives |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `query`, `queryOne`, `execute` | `_lib/db.js` | Database queries and execution |
| `requireAuth` | `_lib/auth.js` | Session/API key authentication |
| `requireEnvironmentResourcePermission` | `_lib/rbac.js` | Resource-level RBAC enforcement (certificate-specific) |
| `logAudit` | `_lib/audit.js` | Audit trail logging |
| `storeBlob`, `deleteBlob` | `_lib/blobs.js` | Netlify Blob storage for PEM files |
| `jsonResponse`, `errorResponse`, `parseJsonBody`, `getSearchParams`, `getClientIp` | `_lib/helpers.js` | HTTP response builders, body parsing, query params, IP extraction |
| `getPolicyAmapiContext`, `syncPolicyDerivativesForPolicy` | `_lib/policy-derivatives.js` | AMAPI context resolution and per-policy derivative sync |

## Key Logic

The handler routes based on HTTP method and the first path segment after `/api/certificates/`:

**GET /list?environment_id=** - Lists all non-deleted certificates for an environment. Includes progressive schema compatibility: falls back to queries without `subject`, `issuer_name`, `uploaded_by`, or `deleted_at` columns if they do not exist in the database (supports legacy schemas).

**POST /upload** - Uploads a new certificate:
1. Accepts `environment_id`, `name`, `cert_data` (PEM or base64-encoded PEM), and optional `cert_type` (defaults to `ca`) and `not_after`.
2. Validates PEM format (tries base64 decoding if raw PEM markers are absent).
3. Parses the certificate to extract SHA-256 fingerprint.
4. Checks for duplicate fingerprints within the environment.
5. Stores the PEM file in Netlify Blobs under `certificates/{environment_id}/{cert_id}.pem`.
6. Inserts metadata into the `certificates` table.
7. Triggers `syncEnvironmentPoliciesAfterCertificateChange` to update all AMAPI policy derivatives.

**DELETE /:id** - Soft-deletes a certificate:
1. Sets `deleted_at = now()` in the database.
2. Deletes the PEM blob from Netlify Blobs (logs error but does not fail if blob deletion fails).
3. Triggers AMAPI policy derivative sync for the environment.

All write operations are audit-logged and use resource-level RBAC (`certificate` resource type with `read`, `write`, or `delete` permissions).

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | /api/certificates/list?environment_id= | Session (certificate:read) | List all certificates for an environment |
| POST | /api/certificates/upload | Session (certificate:write) | Upload a PEM certificate with blob storage |
| DELETE | /api/certificates/:id | Session (certificate:delete) | Soft-delete a certificate and its blob |
