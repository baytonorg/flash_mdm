# `netlify/functions/_lib/flashagent-billing.ts`

> Soft billing entitlement hook for the Flashi assistant. Currently permissive (always returns `entitled: true`). Designed as a future integration point for gating Flashi as a paid addon.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `checkAssistantEntitlement` | `(workspaceId, environmentId) => Promise<{ entitled: boolean; reason?: string }>` | Checks whether the workspace/environment is entitled to use Flashi |

## Key Logic

Currently a no-op that always returns `{ entitled: true }`. The function signature accepts `workspaceId` and `environmentId` for future use.

When billing enforcement is enabled (future), this will:
1. Check workspace licensing/billing metadata.
2. Verify the assistant addon is included in the workspace's plan.
3. Return `{ entitled: false, reason: '...' }` if the addon is not purchased.

The platform flag `assistant_paid_enforcement_enabled` (not yet added) will control when this enforcement activates.
