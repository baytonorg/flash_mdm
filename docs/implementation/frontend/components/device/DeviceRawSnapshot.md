# `src/components/device/DeviceRawSnapshot.tsx`

> Interactive JSON tree viewer for the raw AMAPI device snapshot with copy-to-clipboard functionality.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `DeviceRawSnapshot` | `default function` | Renders the snapshot viewer |
| `DeviceRawSnapshotProps` | `interface` | Props type for the component |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `snapshot` | `Record<string, any> \| null` | Yes | The raw AMAPI snapshot object, or null |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `JsonNode` | 8-107 | Recursive component that renders a collapsible JSON tree node with syntax coloring |

## Key Logic

The component renders the full AMAPI device snapshot as an interactive, collapsible JSON tree. The `JsonNode` sub-component recursively renders objects and arrays with expand/collapse toggles (defaulting to expanded for depth < 2). Values are syntax-highlighted: strings in green, numbers in blue, booleans in amber, null in muted gray, and keys in purple. A "Copy JSON" button uses `navigator.clipboard.writeText` to copy the pretty-printed JSON to the clipboard, with a 2-second "Copied" confirmation state. Empty objects/arrays are rendered inline. An empty state is shown when the snapshot is null.
