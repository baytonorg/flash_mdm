# `netlify/functions/_lib/device-commands.ts`

> Shared command catalog and enum guards used across single-device commands, bulk commands, and command payload validation.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `AMAPI_ISSUE_COMMAND_TYPES` | `readonly string[]` | Canonical AMAPI `:issueCommand` command types supported by Flash |
| `PATCH_STATE_COMMAND_TYPES` | `readonly string[]` | State PATCH commands (`DISABLE`, `ENABLE`) |
| `DEVICE_COMMAND_TYPES` | `readonly string[]` | Full single-device command list (`issueCommand` + PATCH commands) |
| `BULK_DEVICE_COMMAND_TYPES` | `readonly string[]` | Bulk command list (`DEVICE_COMMAND_TYPES` + `DELETE`) |
| `DEVICE_BULK_COMMAND_ALIAS_MAP` | `Record<string, string>` | Lowercase/underscore aliases normalized to canonical command names |
| `RESET_PASSWORD_FLAGS` | `readonly string[]` | Allowed enum values for `resetPasswordFlags` |
| `DEVICE_INFO_TYPES` | `readonly string[]` | Allowed enum values for `requestDeviceInfoParams.deviceInfo` |
| `ESIM_ACTIVATION_STATES` | `readonly string[]` | Allowed enum values for `addEsimParams.activationState` |
| `WIPE_DATA_FLAGS` | `readonly string[]` | Allowed enum values for `wipeParams.wipeDataFlags` |
| `isAmapiIssueCommandType` | `(value: string) => boolean` | Guard for AMAPI issue-command types |
| `isPatchStateCommandType` | `(value: string) => boolean` | Guard for PATCH state commands |
| `isDeviceCommandType` | `(value: string) => boolean` | Guard for single-device command types |
| `isBulkDeviceCommandType` | `(value: string) => boolean` | Guard for bulk command types |
| `normalizeBulkDeviceCommand` | `(requested: string) => string` | Normalizes user input (`lock`, `start_lost_mode`, etc.) to canonical command type |
| `isResetPasswordFlag`, `isDeviceInfoType`, `isEsimActivationState`, `isWipeDataFlag` | guards | Enum guards used by command payload validation |

## Key Logic

This module centralizes command and enum definitions so handlers and payload builders do not drift:

1. **Single source of truth for command lists**  
   `device-command.ts` and `device-bulk.ts` validate against shared exported arrays/guards instead of duplicating inline lists.

2. **Shared alias normalization for bulk commands**  
   `normalizeBulkDeviceCommand()` converts UI/workflow alias forms into canonical names used in queues and API calls.

3. **Shared AMAPI enum guards**  
   Payload validation in `_lib/amapi-command.ts` uses these guards for `RESET_PASSWORD`, `REQUEST_DEVICE_INFO`, `ADD_ESIM`, and `WIPE` fields.

4. **Regression safety**  
   `device-commands.test.ts` verifies the exported command/enumeration values match AMAPI discovery expectations and remain deduplicated.
