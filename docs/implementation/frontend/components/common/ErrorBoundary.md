# `src/components/common/ErrorBoundary.tsx`

> React class-based error boundary that catches render errors and displays a recovery UI, with special handling for dynamic import failures.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `ErrorBoundary` | `Component<ErrorBoundaryProps, ErrorBoundaryState>` (default) | Wraps children and catches uncaught render errors |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `children` | `ReactNode` | Yes | Child components to protect with the error boundary |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `isLikelyDynamicImportError` | 13-23 | Checks if an error message matches known patterns for chunk/dynamic-import failures |
| `reloadAppWindow` (static) | 26-28 | Calls `window.location.reload()` |
| `getDerivedStateFromError` (static) | 35-37 | React lifecycle; sets `hasError: true` and stores the error |
| `componentDidCatch` | 39-41 | Logs the error and error info to the console |
| `handleReset` | 43-49 | If the error is a dynamic import failure, reloads the page; otherwise clears the error state |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `AlertTriangle` | `lucide-react` | Warning icon in the error UI |

## Key Logic

- Uses `getDerivedStateFromError` and `componentDidCatch` React lifecycle methods to capture errors.
- Distinguishes between dynamic import errors (chunk loading failures) and other errors via `isLikelyDynamicImportError`, which pattern-matches against common Vite/webpack chunk error messages.
- For dynamic import errors, the UI says "Update available" and the recovery button reloads the entire page.
- For other errors, the UI says "Something went wrong", shows the error message, and the "Try again" button resets the boundary state.
- Always provides a "Go to Dashboard" link as an escape hatch.
