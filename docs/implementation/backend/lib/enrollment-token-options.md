# `netlify/functions/_lib/enrollment-token-options.ts`

> Normalizes enrollment token request parameters — personal usage mode, one-time-use flag, and token duration — accepting various aliases and formats for API flexibility.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `normalizeAllowPersonalUsage` | `(input: unknown) => NormalizedPersonalUsage` | Maps personal usage string aliases to canonical AMAPI enum values |
| `normalizeOneTimeUse` | `(input: unknown) => boolean` | Coerces various truthy/falsy representations to a boolean |
| `resolveEnrollmentDurationDays` | `(input: { expiryDays?, durationDays?, duration?, durationSeconds?, defaultDays? }) => number` | Resolves token duration from multiple input formats to a clamped day count (1-365) |
| `NormalizedPersonalUsage` | Type alias | `'PERSONAL_USAGE_UNSPECIFIED' \| 'PERSONAL_USAGE_ALLOWED' \| 'PERSONAL_USAGE_DISALLOWED' \| 'PERSONAL_USAGE_DISALLOWED_USERLESS'` |

## Key Logic

### Personal Usage Normalization

Accepts shorthand and long-form aliases for `allowPersonalUsage`, case-insensitive with whitespace/hyphen-to-underscore normalization:

| Input aliases | Normalized value |
|---------------|-----------------|
| `PERSONAL_USAGE_UNSPECIFIED`, `UNSPECIFIED`, `DEFAULT` | `PERSONAL_USAGE_UNSPECIFIED` |
| `PERSONAL_USAGE_ALLOWED`, `ALLOWED` | `PERSONAL_USAGE_ALLOWED` |
| `PERSONAL_USAGE_DISALLOWED`, `DISALLOWED` | `PERSONAL_USAGE_DISALLOWED` |
| `PERSONAL_USAGE_DISALLOWED_USERLESS`, `DEDICATED_DEVICE_USERLESS`, `DEDICATED_DEVICE`, `DEDICATED`, `USERLESS` | `PERSONAL_USAGE_DISALLOWED_USERLESS` |

Empty, null, or unrecognized values default to `PERSONAL_USAGE_UNSPECIFIED`.

### One-Time-Use Normalization

Accepts booleans, numbers (0 = false, non-zero = true), and strings (`"true"`, `"1"`, `"yes"` → true; `"false"`, `"0"`, `"no"` → false). Unknown values default to `false`.

### Duration Resolution

Resolves token expiry from the first matching field in priority order:

1. `expiryDays` — numeric days (preferred for UI callers)
2. `durationDays` — numeric days (alias)
3. `duration` / `durationSeconds` — either a seconds string (e.g. `"604800s"`) or a bare number (interpreted as seconds), converted to days via `ceil(seconds / 86400)`
4. `defaultDays` fallback (defaults to 30 if omitted)

All values are clamped to 1-365 days.

## Internal Functions

| Name | Description |
|------|-------------|
| `clampDays` | Clamps a number to the 1-365 integer range |
| `parseDurationSecondsFromDurationValue` | Parses a duration value as seconds — supports `"Ns"` format or bare numeric strings/numbers |

## Used By

- `netlify/functions/enrollment-create.ts` — normalizes request body parameters before calling AMAPI
