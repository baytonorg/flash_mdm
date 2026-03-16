# `netlify/functions/_lib/device-apps.ts`

> Extracts and normalizes device application inventory from an AMAPI device snapshot.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `DeviceAppInventoryRow` | `interface` | Shape for a single app row: `package_name`, `display_name`, `version_name`, `version_code`, `state`, `source`, `icon_url` |
| `deriveDeviceApplicationsFromSnapshot` | `(snapshotValue: unknown) => DeviceAppInventoryRow[]` | Parses `applicationReports` from a device snapshot and returns a sorted array of app inventory rows |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `parseJsonObject` | 11-22 | Safely parses a value (string or object) into a plain object, returning empty object on failure |

## Key Logic

`deriveDeviceApplicationsFromSnapshot` takes a raw AMAPI device snapshot (either as a JSON string or object), extracts the `applicationReports` array, and maps each report to a `DeviceAppInventoryRow` with fields: `package_name`, `display_name`, `version_name`, `version_code`, `state` (install state), and `source` (application source). The `icon_url` is always set to `null` at this stage (populated later via metadata hydration). Results are sorted alphabetically by display name (falling back to package name).
