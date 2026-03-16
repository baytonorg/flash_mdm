# `src/main.tsx`

> Application entry point that mounts the React root with providers and global configuration.

## Exports

None (side-effect module).

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `App` | `./App` | Root application component |
| `BRAND` | `./lib/brand` | Setting `document.title` to the product name |

## Key Logic

- **Document title**: Sets `document.title` to `BRAND.name` (`'Flash MDM'`) before rendering.
- **React Query**: Creates a `QueryClient` with default options:
  - `staleTime`: 30 seconds
  - `retry`: 1 attempt
  - `refetchOnWindowFocus`: disabled
- **Provider stack** (outermost to innermost): `StrictMode` > `QueryClientProvider` > `BrowserRouter` > `App`.
- **Mount target**: Renders into the `#root` DOM element via `createRoot`.
