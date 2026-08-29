# `netlify/functions/certificate-crud.ts`

> CRUD handler for the environment-owned Wi-Fi trusted CA library used by ONC policy generation.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, context: Context) => Promise<Response>` | Netlify function handler (default export) |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
Certificate parsing and ONC reference helpers live in `_lib/certificate-policy.ts`. Node's X.509 parser validates the certificate, requires `CA:TRUE`, extracts metadata, and produces base64 DER for AMAPI's ONC `X509` field.

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `query`, `queryOne`, `transaction` | `_lib/db.js` | Database queries and transactional writes |
| `requireAuth` | `_lib/auth.js` | Session/API key authentication |
| `requireEnvironmentResourcePermission` | `_lib/rbac.js` | Resource-level RBAC enforcement (certificate-specific) |
| `logAudit` | `_lib/audit.js` | Audit trail logging |
| `storeBlob`, `deleteBlob` | `_lib/blobs.js` | Runtime-neutral blob storage for public PEM files |
| `jsonResponse`, `errorResponse`, `parseJsonBody`, `getSearchParams`, `getClientIp` | `_lib/helpers.js` | HTTP response builders, body parsing, query params, IP extraction |
| `buildOncCertificateGuid`, `collectOncServerCaRefs`, `parseServerCaCertificate` | `_lib/certificate-policy.js` | X.509 validation and ONC reference handling |

## Key Logic

The handler routes based on HTTP method and the first path segment after `/api/certificates/`:

**GET /list?environment_id=** - Lists non-deleted, cryptographically validated Wi-Fi trusted CAs for an environment, including the deterministic ONC GUID used by network profiles. PEM data is never returned. Legacy rows remain unvalidated and hidden until the certificate is re-uploaded through this handler.

**POST /upload** - Uploads a new certificate:
1. Accepts `environment_id`, `name`, and `cert_data` (PEM or base64-encoded PEM).
2. Parses the X.509 certificate and rejects malformed, expired, not-yet-valid, or non-CA input.
3. Extracts the SHA-256 fingerprint, subject, issuer, and expiry.
4. Checks for duplicate fingerprints within the environment.
5. Reconstructs canonical PEM from the parsed public certificate, discarding any trailing input, and stores it through the shared blob abstraction under `certificates/{environment_id}/{cert_id}.pem`.
6. Inserts metadata into the `certificates` table.
7. Returns its ONC GUID. Upload alone does not deploy the CA; a Wi-Fi profile must reference it.

**DELETE /:id** - Soft-deletes a certificate:
1. Rejects deletion with `409` while any Wi-Fi profile references the CA.
2. Sets `deleted_at = now()` in the database.
3. Deletes the PEM from the runtime's configured blob store.

All write operations are audit-logged and use resource-level RBAC (`certificate` resource type with `read`, `write`, or `delete` permissions).

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | /api/certificates/list?environment_id= | Session (certificate:read) | List all certificates for an environment |
| POST | /api/certificates/upload | Session (certificate:write) | Upload a public Wi-Fi server CA certificate |
| DELETE | /api/certificates/:id | Session (certificate:delete) | Soft-delete a certificate and its blob |
