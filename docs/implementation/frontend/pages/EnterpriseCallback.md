# `src/pages/EnterpriseCallback.tsx`

> Callback handler page for completing Android Enterprise binding after Google admin signup.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `EnterpriseCallback` | `React.FC` (default) | Enterprise binding callback page component |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `apiClient` | `@/api/client` | POSTing the bind request to complete enterprise binding |

## Key Logic

This page is the redirect target after a Google admin completes the managed enterprise signup flow. It reads `environment_id` and `enterpriseToken` from the URL search params. On mount, it calls `POST /api/environments/bind` with those values. The page shows three states: a loading spinner while the bind request is in progress, a success message (displaying the enterprise display name) that auto-redirects to `/settings` after 3 seconds, or an error message with a manual "Go to Settings" button. If the required URL parameters are missing, it immediately shows an error.
