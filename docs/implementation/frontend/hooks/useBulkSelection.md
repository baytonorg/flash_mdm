# `src/hooks/useBulkSelection.ts`

> React hook for managing bulk row selection in tables, supporting both explicit ID lists and "select all matching" with exclusions.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `BulkSelectionPayload` | `type` | Union payload for API calls: either `{ ids: string[] }` or `{ all_matching: true, excluded_ids: string[] }` |
| `useBulkSelection` | `<T>(options: UseBulkSelectionOptions<T>) => BulkSelectionResult` | Hook that manages selection state and produces API-ready payloads |

## Internal Types

| Name | Description |
|------|-------------|
| `UseBulkSelectionOptions<T>` | Config: `rows` (currently loaded), `rowKey` (ID extractor), `totalMatching` (server-side total count) |

## Key Logic

- **Two modes**: Normal mode tracks explicitly selected row objects. "All matching" mode selects the entire server-side result set and tracks exclusions instead.
- **`selectedCount`**: In normal mode, returns `selectedRows.length`. In all-matching mode, returns `totalMatching - excludedIds.size`.
- **`canSelectAllMatching`**: True when all loaded rows are selected but the server has more rows than are currently loaded, and all-matching mode is not yet active.
- **`onSelectionChange`**: In normal mode, directly replaces the selection. In all-matching mode, diffs the new selection against loaded row IDs to update the exclusion set.
- **`selectAllMatching`**: Enters all-matching mode, clears exclusions, and selects all currently loaded rows.
- **`clearSelection`**: Resets everything back to empty normal mode.
- **`selectionPayload`**: Computed object ready for API consumption -- either `{ ids: [...] }` or `{ all_matching: true, excluded_ids: [...] }`.
