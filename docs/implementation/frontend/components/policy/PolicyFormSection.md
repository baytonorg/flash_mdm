# `src/components/policy/PolicyFormSection.tsx`

> Mega-component that renders category-specific policy configuration forms for all AMAPI policy sections (2800+ lines).

## Exports

| Name | Type | Description |
|------|------|-------------|
| `PolicyFormSection` | `React.FC<PolicyFormSectionProps>` (default) | Renders the form UI for a single policy category using a `switch` over category IDs |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `category` | `string` | Yes | Category ID (e.g. `'password'`, `'network'`, `'applications'`) determining which form section to render |
| `config` | `Record<string, any>` | Yes | The full policy config object; values are read via dot-path helpers |
| `onChange` | `(path: string, value: any) => void` | Yes | Callback with a dot-separated path and new value when any field changes |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `getPath` | 21-23 | Reads a nested value from an object using a dot-separated path string |
| `asStringArray` | 25-27 | Safely casts a value to `string[]` |
| `uniqueNonEmptyStrings` | 29-39 | Deduplicates and trims a string array |
| `isValidSha256Hex` | 41-43 | Validates a string as a 64-char hex SHA-256 hash |
| `normalizeMinutesOfDay` | 45-49 | Clamps a number to 0-1439 (minutes in a day) |
| `minutesToTimeInput` | 51-56 | Converts minutes-of-day to `HH:MM` string for time inputs |
| `timeInputToMinutes` | 58-66 | Parses an `HH:MM` time input string back to minutes-of-day |
| `getMaintenanceWindowDurationMinutes` | 68-73 | Calculates duration between start and end minutes, handling midnight wrap |
| `getFreezeDaysInMonth` | 108 | Returns days in a month for a non-leap year (used for day-of-month clamping) |
| `toFreezeOrdinal` | 125 | Converts a month/day pair to a 1-365 ordinal (non-leap year) |
| `fromFreezeOrdinal` | 135 | Converts a 1-365 ordinal back to a month/day pair |
| `normalizeFreezeEditorItem` | 164 | Clamps a raw value into a valid `FreezePeriodEditorItem` with month 1-12, day clamped to days-in-month, and duration 1-90 |
| `policyFreezePeriodToEditorItem` | 174 | Converts an AMAPI freeze period `{ startDate, endDate }` into the editor's `{ startMonth, startDay, durationDays }` format |
| `editorItemToPolicyFreezePeriod` | 193 | Converts editor `{ startMonth, startDay, durationDays }` back to an AMAPI freeze period with `startDate` and `endDate` objects |
| `PolicyAppManagedConfigSection` | 212 | Sub-component rendering managed configuration for an app (form or JSON mode) |
| `createPasswordPolicyRow` | 312 | Creates a default password policy row object with sensible defaults |
| `buildPasswordFallbackPair` | 325 | Creates the Android 12+ complexity/non-complexity fallback pair for a scope |
| `getPasswordFallbackPairState` | 338 | Analyzes password rows for a scope and reports whether the fallback pair is complete |
| `isComplexityBasedPasswordQuality` | 377 | Checks if a password quality string is one of the complexity enum values |
| `isComplexPasswordQuality` | 381 | Checks if quality is specifically `'COMPLEX'` |
| `getPasswordRowScope` | 385 | Extracts scope string from a password policy row |
| `getPasswordRowQuality` | 389 | Extracts quality string from a password policy row |
| `countComplexCounterValues` | 393 | Sums all non-zero complex password counter fields on a row |
| `validatePasswordPolicies` | 400 | Full validation of password policy rows: checks scope, fallback pairing, and cross-scope consistency |
| `sanitizeLegacyPasswordRequirementsForMigration` | 472 | Converts a legacy `passwordRequirements` object into a `passwordPolicies` row |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `BooleanField` | `@/components/policy/fields/BooleanField` | Toggle switches for boolean policy settings |
| `SelectField` | `@/components/policy/fields/SelectField` | Dropdown selects for string-valued settings |
| `TextField` | `@/components/policy/fields/TextField` | Text inputs for string-valued settings |
| `NumberField` | `@/components/policy/fields/NumberField` | Numeric inputs with min/max |
| `EnumField` | `@/components/policy/fields/EnumField` | Radio/select groups for enum-valued AMAPI fields |
| `RepeaterField` | `@/components/policy/fields/RepeaterField` | Dynamic lists (e.g. password policies, permission grants, applications) |
| `JsonField` | `@/components/policy/fields/JsonField` | Raw JSON textarea editors for complex objects |
| `ManagedConfigEditor` | `@/components/apps/ManagedConfigEditor` | Schema-driven form for app managed configuration |
| `useAppDetails` | `@/api/queries/apps` | Fetching app managed properties schema |
| `useContextStore` | `@/stores/context` | Reading the active environment for app details |

## Key Logic

This is the largest component in the policy editor. It uses a single `switch(category)` statement with cases for every policy category: `password`, `screenLock`, `applications`, `network`, `deviceSettings`, `security`, `systemUpdates`, `permissions`, `statusReporting`, `personalUsage`, `kioskMode`, `complianceRules`, `crossProfile`, `location`, and `advanced`.

Each case renders a tailored form layout using the field components. The `password` category is the most complex, implementing Android 12+ fallback pairing logic with validation, migration from legacy `passwordRequirements`, and per-row error/hint display. The `applications` category uses `RepeaterField` with a nested sub-form per app that includes install type, managed configuration (with a `PolicyAppManagedConfigSection` sub-component that can render either a schema-driven form or raw JSON), and permission grants.

The `systemUpdates` category includes a **freeze period editor** that manages annually recurring OTA update freeze windows. Each freeze period is represented internally as a `FreezePeriodEditorItem` with `startMonth`, `startDay`, and `durationDays` (1-90). The editor converts between this internal format and the AMAPI format (`{ startDate: { month, day }, endDate: { month, day } }`) using ordinal-based date arithmetic on a non-leap 365-day year. The `RepeaterField` renders month/day selectors for the start date, a duration slider/input (1-90 days), and a computed read-only end date. Freeze period rules from Android: each period must be 1-90 days, and periods must be separated by at least 60 days.

All field changes call `onChange(path, value)` where `path` is a dot-separated string (e.g. `'passwordPolicies.0.passwordMinimumLength'`), enabling the parent to apply changes at the correct nesting depth.
