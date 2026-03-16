# `netlify/functions/_lib/mcp-proxy.ts`

> Shared MCP proxy utilities for proxying JSON-RPC requests to Google's AMAPI MCP endpoint. Handles validation, rate limiting (best-effort in serverless), timeouts, and session ID management.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `McpProxyRequest` | `interface` | Request shape: body, accessToken, projectId, incomingSessionId |
| `McpProxyResponse` | `interface` | Response shape: status, body, sessionId |
| `validateJsonRpcBody` | `(body: string) => { method, params?, id? }` | Parses and validates a JSON-RPC body |
| `proxyToAmapiMcp` | `(req: McpProxyRequest) => Promise<McpProxyResponse>` | Proxies a request to the AMAPI MCP endpoint |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `sleep` | `_lib/helpers` | Async delay for rate limiting pacing and retry waits |

## Internal Functions

| Name | Description |
|------|-------------|
| `deriveRateLimitKey` | Builds a rate limit key from project ID and RPC method/tool name |
| `acquireRateLimitSlot` | Sliding-window + pacing rate limiter with max wait cap (30s) and iteration limit (100) |

## Key Logic

### `proxyToAmapiMcp`

1. Derives a rate limit key and acquires a slot (best-effort in serverless).
2. Sends the JSON-RPC body to `https://androidmanagement.googleapis.com/mcp` with:
   - `Authorization: Bearer {token}`
   - `x-goog-user-project: {projectId}`
   - `mcp-session-id: {sessionId}` (if provided)
3. Retries once on HTTP 503 (2-second delay).
4. Fetch timeout: 30 seconds per attempt.
5. Sanitises the upstream `mcp-session-id` header (printable ASCII only, max 256 chars).
6. Returns the response status, body, and sanitised session ID.

### Rate limiter

- In-memory sliding window with 60 calls/minute per key.
- Pacing: minimum interval between requests for the same key.
- Memory bounded: evicts stale keys when map exceeds 500 entries.
- Max wait: 30 seconds before throwing.
- **Note**: Best-effort in serverless — each cold start has fresh state. The real protection comes from the Postgres-backed `consumeToken` limiter in the calling endpoint.
