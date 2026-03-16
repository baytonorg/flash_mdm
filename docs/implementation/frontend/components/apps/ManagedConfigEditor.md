# `src/components/apps/ManagedConfigEditor.tsx`

> Dynamic form editor that renders managed configuration fields based on an app's `ManagedProperty` schema, supporting string, boolean, integer, choice, multiselect, bundle, and bundle array property types.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `ManagedConfigEditor` | `default function` | Renders the managed configuration form |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `schema` | `ManagedProperty[]` | Yes | Array of managed property definitions from the app's AMAPI schema |
| `value` | `Record<string, unknown>` | Yes | Current configuration values keyed by property key |
| `onChange` | `(value: Record<string, unknown>) => void` | Yes | Callback when any configuration value changes |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `StringField` | 21-36 | Renders a text input for STRING properties |
| `BoolField` | 38-56 | Renders a checkbox for BOOL properties |
| `IntegerField` | 58-73 | Renders a number input for INTEGER properties |
| `ChoiceField` | 75-96 | Renders a select dropdown for CHOICE properties |
| `MultiselectField` | 98-129 | Renders a checkbox list for MULTISELECT properties |
| `BundleField` | 131-171 | Renders a collapsible group for BUNDLE properties with nested child fields |
| `BundleArrayField` | 173-242 | Renders a repeatable list of bundles for BUNDLE_ARRAY properties with add/remove controls |
| `ManagedPropertyField` | 246-265 | Router component that dispatches to the correct field renderer based on `property.type` |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `ManagedProperty` | `@/api/queries/apps` | Type definition for the managed property schema |

## Key Logic

The editor dynamically generates form controls from an app's managed configuration schema. The `ManagedPropertyField` router maps AMAPI property types to specialized field components. AMAPI `HIDDEN` restrictions are not rendered in form mode (including nested hidden properties inside bundles). `BundleField` and `BundleArrayField` support recursive nesting by rendering child `ManagedPropertyField` components for `nestedProperties`. Bundle fields are collapsible (expanded by default at depth 0). BundleArrayField supports adding and removing items. Each field component handles default values from the schema and propagates changes upward through the `onChange` chain. An empty state message is shown when the schema has no properties.
