# `netlify/functions/_lib/enterprise-utils.ts`

> Shared enterprise resource name utilities for parsing and validating AMAPI enterprise-scoped resource names.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `extractEnterprisePrefix` | `(value: unknown) => string \| null` | Extracts the `enterprises/{id}` prefix from a resource name string. Returns `null` if the value is not a string or doesn't match. |

## Key Logic

- Uses a case-insensitive regex (`/^enterprises\/[^/]+/i`) against the trimmed input.
- Accepts any `unknown` input safely (returns `null` for non-strings).
- The extracted prefix is used for enterprise binding validation -- ensuring tool calls and MCP requests target only the environment's bound enterprise.

## Used By

| Consumer | Purpose |
|----------|---------|
| `mcp-amapi.ts` | Validates that MCP tool call arguments reference the correct enterprise |
| `flashagent-runtime.ts` | Validates enterprise scope on AMAPI tool calls within the Flashi runtime |
