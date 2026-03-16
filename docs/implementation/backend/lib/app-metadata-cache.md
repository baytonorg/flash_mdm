# `netlify/functions/_lib/app-metadata-cache.ts`

> Utilities for determining when app metadata (title, icon) needs hydration from an external source and merging hydrated data back into app rows.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `AppMetadataCacheRowLike` | `interface` | Shape for an app row with `package_name`, `display_name`, and `icon_url` fields |
| `HydratedAppMetadata` | `interface` | Shape for fetched metadata: `{ title: string \| null; icon_url: string \| null }` |
| `needsAppMetadataHydration` | `(app: AppMetadataCacheRowLike) => boolean` | Returns true if the app is missing an icon URL, has no display name, or display name equals the package name |
| `mergeHydratedAppMetadata` | `<T extends AppMetadataCacheRowLike>(app: T, meta: HydratedAppMetadata \| null) => T` | Merges hydrated metadata into an app row, preferring existing non-package-name display names over hydrated titles. Returns the original object reference if nothing changed. |

## Key Logic

**`needsAppMetadataHydration`**: An app needs hydration when any of these are true:
- `icon_url` is falsy
- `display_name` is empty/whitespace
- `display_name` exactly equals `package_name` (indicating no human-readable name has been resolved)

**`mergeHydratedAppMetadata`**: Applies hydrated metadata conservatively:
- Uses the existing `display_name` if it is non-empty and differs from the `package_name`; otherwise falls back to the hydrated `title`.
- Uses the existing `icon_url` if present; otherwise uses the hydrated `icon_url`.
- Returns the original object by reference (no copy) if neither field changed, enabling efficient identity checks downstream.
