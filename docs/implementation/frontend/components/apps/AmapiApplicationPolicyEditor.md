# `src/components/apps/AmapiApplicationPolicyEditor.tsx`

> Form/JSON editor for AMAPI `applications[]` policy entry fields, supporting all standard AMAPI application policy properties including permissions, roles, install constraints, and custom app config.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `AmapiApplicationPolicyEditor` | `default function` | Renders the application policy editor with form/JSON toggle |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `value` | `JsonObject` | Yes | Current AMAPI application policy object |
| `onChange` | `(value: JsonObject) => void` | Yes | Callback when the policy object changes |
| `packageName` | `string` | No | Display-only package name shown in the info banner |
| `installType` | `string` | No | External install type override |
| `autoUpdateMode` | `string` | No | External auto-update mode override |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `obj` | 21-23 | Safely casts unknown to a plain object |
| `arr` | 25-27 | Safely casts unknown to an array |
| `str` | 29-31 | Safely casts unknown to a string |
| `boolOr` | 33-35 | Extracts a boolean with a fallback default |
| `numOr` | 37-39 | Extracts a number with a fallback default |
| `stringArray` | 41-43 | Extracts a string array, filtering non-strings |
| `setKey` | 45-51 | Immutably sets or deletes a key on a JsonObject |
| `setNestedKey` | 53-58 | Immutably sets a nested object key, removing if empty |
| `chipClass` | 60-65 | Returns toggle chip CSS classes based on active state |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `EnumField` | `@/components/policy/fields/EnumField` | Dropdown selectors for AMAPI enum values |
| `BooleanField` | `@/components/policy/fields/BooleanField` | Boolean toggle fields |
| `NumberField` | `@/components/policy/fields/NumberField` | Numeric input fields |
| `TextField` | `@/components/policy/fields/TextField` | Text input fields |
| `RepeaterField` | `@/components/policy/fields/RepeaterField` | Repeatable list fields (permissions, constraints, etc.) |
| `JsonField` | `@/components/policy/fields/JsonField` | Raw JSON editor for the full policy object |

## Key Logic

The editor toggles between a structured Form mode and a raw JSON mode. In Form mode, it renders grouped sections for: core AMAPI fields (defaultPermissionPolicy, connectedWorkAndPersonalApp, VPN lockdown, widgets, credential provider, user control, preferential network, disabled, lockTaskAllowed, minimumVersionCode, installPriority), tracks and delegation (accessibleTrackIds, delegatedScopes), permission grants (repeater of permission+policy pairs), install constraints (network/charging/idle with max 1 item), roles (multi-select checkboxes), and signing key certificates. A "Custom App Configuration" section appears conditionally when `installType` is `CUSTOM`. An info banner displays the externally-managed fields (packageName, installType, autoUpdateMode, managedConfiguration). The `extensionConfig` deprecated field is intentionally hidden in Form mode with a warning note.
