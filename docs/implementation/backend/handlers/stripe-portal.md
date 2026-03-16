# `netlify/functions/stripe-portal.ts`

> Creates a Stripe Customer Portal session so workspace billing managers can manage their subscription.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` (handler) | `(request: Request, _context: Context) => Promise<Response>` | Netlify function handler |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| (none) | | All logic is inline within the handler |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `requireAuth` | `_lib/auth` | Authenticate the caller |
| `queryOne` | `_lib/db` | Database lookups |
| `requireWorkspaceResourcePermission` | `_lib/rbac` | Permission checks |
| `createPortalSession` | `_lib/stripe` | Create a Stripe billing portal session |
| `jsonResponse`, `errorResponse`, `parseJsonBody`, `isValidUuid` | `_lib/helpers` | Request/response utilities |
| `logAudit` | `_lib/audit` | Audit trail logging |
| `getWorkspaceLicensingSettings` | `_lib/licensing` | Check licensing enablement |

## Key Logic

1. Only accepts `POST` requests.
2. Requires `STRIPE_SECRET_KEY` to be set; returns 503 otherwise.
3. API keys are forbidden.
4. Requires `workspace.read` and `billing.billing_manage` permissions.
5. Verifies licensing is enabled for the workspace.
6. Looks up the workspace's `stripe_customer_id`; returns 404 if not found.
7. Creates a Stripe Customer Portal session with a return URL of `/licenses`.
8. Logs an audit event and returns the `portal_url`.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/.netlify/functions/stripe-portal` | Session only | Create a Stripe Customer Portal session |
