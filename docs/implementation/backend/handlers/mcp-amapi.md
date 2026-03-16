# `netlify/functions/mcp-amapi.ts`

> AMAPI MCP proxy endpoint. Proxies JSON-RPC requests to Google's Android Management API MCP endpoint. This is a standalone Flash feature — Flashi uses it, but other features could too.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `default` (handler) | `(request: Request, _context: Context) => Promise<Response>` | Netlify function handler |

## Internal Functions

| Name | Description |
|------|-------------|
| `sanitiseSessionId` | Validates MCP session ID (printable ASCII only, max 256 chars) to prevent header injection |
| `enforceRpcAllowlistAndEnterpriseBinding` | Validates RPC method, tool name, and enterprise scope binding |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `requireAuth` | `_lib/auth` | Authenticate the caller |
| `requireWorkspaceResourcePermission`, `requireEnvironmentAccessScope` | `_lib/rbac` | Workspace + environment scope checks |
| `queryOne` | `_lib/db` | Database lookups |
| `validateJsonRpcBody`, `proxyToAmapiMcp` | `_lib/mcp-proxy` | JSON-RPC validation and upstream proxy |
| `consumeToken` | `_lib/rate-limiter` | Rate limiting (IP + principal) |
| `logAudit` | `_lib/audit` | Audit trail for every MCP call |
| `resolveAccessTokenAndProject` | `_lib/workspace-credentials` | Decrypts workspace Google credentials and mints an AMAPI access token |
| `extractEnterprisePrefix` | `_lib/enterprise-utils` | Extracts `enterprises/{id}` prefix from a resource name string |
| `retryAfterHeader` | `_lib/helpers` | Builds `Retry-After` header from milliseconds |

## Key Logic

### POST (proxy JSON-RPC)

1. Same-origin request assertion.
2. Auth + environment resolution from `?environment_id=`.
3. RBAC: `device:read` on workspace + environment scope (viewer minimum). Group-scoped users are rejected (enterprise-wide MCP tools require workspace-wide access).
4. Body size enforcement (500KB max).
5. JSON-RPC validation and allowlist enforcement:
   - **Allowed RPC methods**: `initialize`, `notifications/initialized`, `tools/list`, `tools/call`, `ping`
   - **Allowed tools** (read-only only): `list_devices`, `get_device`, `list_policies`, `get_policy`, `get_application`, `list_web_apps`, `get_web_app`
6. Enterprise binding validation: tool call arguments must reference the environment's bound enterprise.
7. Rate limits by IP (240/min) and principal+environment (90/min).
8. Mints Google access token from encrypted workspace credentials.
9. Sanitises incoming `mcp-session-id` header (prevents CRLF injection).
10. Proxies to `https://androidmanagement.googleapis.com/mcp`.
11. Returns response with `Content-Security-Policy: default-src 'none'` and `Cache-Control: no-store`.
12. Audit logs every call with method, tool name, and upstream status.

## Security Controls

- **Allowlist-only**: Only read-only MCP tools are permitted.
- **Enterprise binding**: Every tool call is validated against the environment's bound enterprise.
- **Header injection prevention**: Session IDs are sanitised to printable ASCII.
- **Credential isolation**: Error messages from credential decryption are generic (internal details logged server-side only).
- **CSP**: `default-src 'none'` on all responses.

## API Surface

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/api/mcp/amapi` | Session / API key (device:read + environment scope) | Proxy JSON-RPC to AMAPI MCP |
