# `src/components/workflows/ConditionBuilder.tsx`

> Dynamic condition builder for workflow rules, supporting multiple fields, operators, and value types joined by AND logic.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `ConditionBuilder` | `default function` | Renders an editable list of condition rows with add/remove controls |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `conditions` | `ConditionRow[]` | Yes | Array of current conditions |
| `onChange` | `(conditions: ConditionRow[]) => void` | Yes | Callback with the updated conditions array |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `addCondition` | 107-112 | Appends a default condition (`device.state` / `equals` / `ACTIVE`) |
| `removeCondition` | 114-116 | Removes a condition by index |
| `updateCondition` | 118-141 | Updates a condition; resets operator and value when the field changes |
| `renderValueInput` | 143-215 | Returns the appropriate value input widget (select, boolean toggle, JSON path pair, or text) |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `ConditionRow` | `@/api/queries/workflows` | Type definition for a single condition |

## Key Logic

The builder supports seven field types defined in `FIELD_DEFINITIONS`:

| Field | Value Type | Operators |
|-------|-----------|-----------|
| `device.state` | select (ACTIVE, DISABLED, DELETED, PROVISIONING) | equals, not_equals |
| `device.ownership` | select (COMPANY_OWNED, PERSONALLY_OWNED) | equals, not_equals |
| `device.os_version` | text | eq, gt, lt, gte, lte |
| `device.manufacturer` | text | equals, contains, not_equals |
| `device.group` | text | in, not_in |
| `device.compliant` | boolean | equals, not_equals |
| `custom.field` | json (path + expected) | equals, not_equals, contains, exists |

Conditions are joined with AND connectors rendered between rows. When a field changes, the operator resets to the first available option and the value resets to a sensible default for the value type. The JSON value type renders two inputs side-by-side (path and expected), hiding the expected input when the operator is "exists". An empty state message explains that without conditions, the action runs for every trigger event.
