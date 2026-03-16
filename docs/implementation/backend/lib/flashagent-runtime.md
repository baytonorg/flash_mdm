# `netlify/functions/_lib/flashagent-runtime.ts`

> Core Flashi tool-calling runtime. Runs OpenAI chat-completions tool loops with AMAPI MCP tools and Flash internal tools, enforces scope/permission checks, and returns a final assistant reply.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `RuntimeContext` | `interface` | Execution context (auth, workspace/environment IDs, enterprise, tokens, permission matrix, API base, Flashi API key) |
| `RunFlashiOptions` | `interface` | Input payload for `runFlashi` |
| `FlashiResult` | `interface` | Output payload: `reply`, `toolCallCount`, `dataSource` |
| `runFlashi` | `(options: RunFlashiOptions) => Promise<FlashiResult>` | Main OpenAI + tool execution loop |
| `validateAmapiToolScope` | `(toolName, args, ctx) => string \| null` | Validates AMAPI enterprise scope boundaries |
| `executeToolForTests` | `(toolName, args, ctx) => Promise<string>` | Test hook for direct tool invocation |

## Tool Families

### AMAPI MCP (read-only)

- `amapi_list_devices`
- `amapi_get_device`
- `amapi_list_policies`
- `amapi_get_policy`
- `amapi_get_application`
- `amapi_list_web_apps`
- `amapi_get_web_app`

All AMAPI tools are enterprise-scoped and validated against the active environment enterprise.

### Flash Internal Tools

- `flash_api_get`
  - Read-only GET caller for OpenAPI-catalogued routes.
  - `addQueryParams()` **always overwrites** `environment_id` with the server-derived value, preventing the LLM from targeting a different environment.
  - `addQueryParams()` also forces `workspace_id` whenever the route metadata declares it or the model supplies it, ensuring workspace-scoped routes cannot escape their boundary.
- `flash_create_csv`
  - Converts tool-visible JSON rows to CSV.
  - Stores CSV in blob storage and returns a secure download URL (`/api/flashagent/download`).

## Key Logic

1. Builds messages with system prompt, route catalog context, history, and current user message.
2. Calls OpenAI chat completions with tool definitions.
3. Executes returned tool calls with RBAC/scope validation.
4. Appends tool outputs and iterates until final assistant text or tool round budget is exhausted.
5. Returns the assistant reply plus data source marker (`none`, `mcp`, `api`, `mixed`).

## Safeguards

- AMAPI tools blocked for group-scoped access mode.
- Enterprise mismatch requests rejected.
- Retry/backoff for transient OpenAI failures.
- Total runtime budget and max tool-round limits.
- CSV generation limits (row/column/file-size caps) and CSV formula sanitization.
