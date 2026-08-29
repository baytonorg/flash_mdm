# `netlify/functions/signin-enroll.ts`

> Public-facing sign-in enrollment endpoint that verifies a user's email via a 6-digit code, then creates a short-lived AMAPI enrollment token for device provisioning.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, _context: Context) => Promise<Response>` | Netlify function handler |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `resolveEnvironmentFromProvisioningInfo` | Internal | Calls the documented AMAPI `provisioningInfo.get` resource across candidate workspaces and resolves the returned string enterprise resource name to the owning environment |
| `resolveAmapiPolicyName` | 185-243 | Resolves the AMAPI policy name for enrollment using the same group-hierarchy and derivative logic as `enrollment-create.ts` |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `queryOne`, `execute`, `query` | `_lib/db.js` | Database operations |
| `amapiCall` | `_lib/amapi.js` | AMAPI provisioningInfo lookup and enrollment token creation |
| `hashToken` | `_lib/crypto.js` | Hash verification codes for secure storage |
| `consumeToken` | `_lib/rate-limiter.js` | Rate limiting for code sends and verifications |
| `sendEmail`, `signinVerificationEmail` | `_lib/resend.js` | Send verification code emails |
| `logAudit` | `_lib/audit.js` | Audit logging |
| `jsonResponse`, `errorResponse`, `parseJsonBody`, `getClientIp` | `_lib/helpers.js` | HTTP utilities |
| `assertEnvironmentEnrollmentAllowed` | `_lib/licensing.js` | Licensing gate for enrollment limits |

## Key Logic

**This is a public endpoint -- no user authentication required.** It implements its own verification flow.

**Environment resolution**: Requires the device's `provisioningInfo` identifier and resolves it through Google's authoritative `GET /v1/provisioningInfo/{id}` response. Missing, unverifiable, or malformed provisioning data fails closed; there is no direct environment, decoded-payload, or single-environment fallback.

**Email validation**: Cross-references the entered email with AMAPI's `authenticatedUserEmail` when Google authentication already occurred and rejects mismatches. When that optional field is absent, Flash's email-code flow authenticates the entered address. The resolved address is validated against `signin_configurations.allowed_domains`.

**Verification binding**: Stores the canonical `provisioningInfo/{id}` resource with the email code and requires the same resource when redeeming it, preventing a code from being moved between device provisioning flows.

**Action: `send-code`**:
1. Rate limits: 5 codes per email per hour, 20 per IP per hour (token bucket via `consumeToken`).
2. Generates a 6-digit code, stores its hash in `signin_verifications` with 10-minute expiry.
3. Sends the code via email using `signinVerificationEmail` template.

**Action: `verify`**:
1. Rate limits: 30 verification attempts per IP per hour.
2. Looks up the latest non-expired, non-verified code for the email/environment.
3. Enforces max 5 attempts per code (burns the verification on overflow).
4. On successful verification:
   - Resolves the AMAPI policy name via group hierarchy and derivatives.
   - Checks licensing limits via `assertEnvironmentEnrollmentAllowed`.
   - Creates a one-time, 1-hour AMAPI enrollment token with the resolved policy and group in `additionalData`.
   - Stores the token locally in `enrollment_tokens` (marked as `signin_enroll`).
   - Returns a redirect URL: `https://enterprise.google.com/android/enroll?et={token}`.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/api/signin-enroll` | None (public, rate-limited) | Send verification code or verify and get enrollment token |
