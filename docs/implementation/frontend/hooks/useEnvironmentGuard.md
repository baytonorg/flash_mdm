# `src/hooks/useEnvironmentGuard.ts`

> React hook that redirects away from a detail page when the active environment no longer matches the record's environment.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `useEnvironmentGuard` | `(recordEnvironmentId: string \| undefined \| null, fallbackPath: string) => void` | Watches for environment mismatches and navigates to the fallback path |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `useContextStore` | `@/stores/context` | Reading the current `activeEnvironment.id` |

## Key Logic

- Uses a `useEffect` that fires when `activeEnvironmentId`, `recordEnvironmentId`, or `fallbackPath` changes.
- If both IDs are present and they differ, calls `navigate(fallbackPath, { replace: true })`.
- If either ID is nullish, the guard is inert (no redirect).
- Designed for detail pages (device, policy, workflow) where a user might switch environments while viewing a record from a different environment.
