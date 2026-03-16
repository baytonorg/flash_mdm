# `netlify/functions/signin-enroll.ts`

> Public-facing sign-in enrollment endpoint that verifies a user's email via a 6-digit code, then creates a short-lived AMAPI enrollment token for device provisioning.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` | `(request: Request, _context: Context) => Promise<Response>` | Netlify function handler |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `resolveEnvironmentFromProvisioningInfo` | 41-179 | Multi-strategy environment resolution: (1) calls AMAPI `provisioningInfo.get` across candidate workspaces with sign-in enabled, (2) parses base64 provisioning info for enterprise ID, (3) falls back to the single enabled sign-in config |
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

**Environment resolution**: Uses `environment_id` from the request body first, then falls back to `resolveEnvironmentFromProvisioningInfo` which tries three strategies to match the device's provisioning context to a local environment.

**Email validation**: Cross-references the entered email with AMAPI's `provisioningInfo.get` authenticated user email (if available). Rejects mismatches. Validates the email domain against `signin_configurations.allowed_domains`.

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
