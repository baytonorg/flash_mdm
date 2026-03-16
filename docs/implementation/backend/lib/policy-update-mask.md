# `netlify/functions/_lib/policy-update-mask.ts`

> Computes an AMAPI-compatible update mask containing only the top-level keys that differ between two policy configs.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `buildPolicyUpdateMask` | `(previousConfig: Record<string, unknown>, nextConfig: Record<string, unknown>) => string \| null` | Compares two policy configs and returns a comma-separated update mask string, or `null` if nothing changed |

## Key Logic

The function produces a minimal update mask for AMAPI PATCH requests:

1. Collects all unique top-level keys from both the previous and next config objects.
2. For each key, checks three conditions:
   - **Added**: key exists in next but not in previous.
   - **Removed**: key exists in previous but not in next (AMAPI will clear the field).
   - **Modified**: key exists in both but serialized values differ (`JSON.stringify` comparison).
3. Changed keys are sorted alphabetically and joined with commas.
4. Returns `null` when no keys differ, signalling a no-op to the caller.
