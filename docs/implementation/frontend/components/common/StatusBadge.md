# `src/components/common/StatusBadge.tsx`

> Colored pill badge that auto-maps status strings to semantic color variants.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `StatusBadge` | `React.FC<StatusBadgeProps>` (default) | Renders a colored badge with the status text |
| `StatusBadgeProps` | `interface` | Props for the component |
| `BadgeVariant` | `type` | Union type: `'success' \| 'warning' \| 'danger' \| 'info' \| 'default'` |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `status` | `string` | Yes | The status string to display (automatically lowercased and underscores replaced with spaces) |
| `variant` | `BadgeVariant` | No | Explicit variant override; if omitted, the variant is resolved from `STATUS_VARIANT_MAP` |

## Key Logic

- `STATUS_VARIANT_MAP` maps common status strings (both lowercase and uppercase) to badge variants:
  - **success**: `active`, `enabled`, `production`, `compliant`, `online`
  - **warning**: `disabled`, `draft`, `pending`, `provisioning`, `offline`, `lost`, `LOST`
  - **danger**: `deleted`, `archived`, `error`, `failed`, `non_compliant`, `blocked`
- If neither an explicit `variant` prop nor a map match is found, falls back to `'default'` (gray).
- `variantClasses` maps each variant to Tailwind color classes using opacity modifiers (e.g., `bg-success/10 text-success`).
- The displayed text is always `status.toLowerCase().replace(/_/g, ' ')` with `capitalize` CSS.
