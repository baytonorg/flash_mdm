# `netlify/functions/_lib/variable-resolution.ts`

> Resolves `${namespace.key}` placeholders in policy JSON using device, user, group, and environment context.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `VariableContext` | `type` | Namespaced variable context with optional `device`, `user`, `group`, and `environment` objects |
| `VariableResolutionResult` | `type` | Resolution output: transformed `config`, `resolved_variables`, and `unresolved_variables` |
| `buildVariableContextForDevice` | `(deviceId: string, environmentId: string) => Promise<VariableContext>` | Builds context for one device from `devices`, `groups`, `environments`, and user membership joins |
| `resolveVariables` | `(config: Record<string, unknown>, context: VariableContext) => VariableResolutionResult` | Recursively resolves `${namespace.key}` placeholders across nested JSON |

## Internal Functions

| Name | Description |
|------|-------------|
| `buildVariableMap` | Flattens namespaced context fields into lookup entries like `device.name`, `user.email`, `group.region`, `environment.name` |
| `walkAndResolve` | Recursive JSON walker for objects/arrays/strings |
| `resolveStringVariables` | Replaces `${...}` tokens using exact namespaced lookup; unresolved tokens are preserved |
| `buildUserContext` | Resolves assigned user details from snapshot sign-in email plus membership roles |
| `extractAssignedUserEmail` | Reads `snapshot.enrollmentTokenData.signin_email` (and compatible key variants) |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `queryOne` | `_lib/db.js` | Querying device/group/environment rows and user role context |

## Supported Variable Namespaces

Variables are strict namespaced keys and are matched case-insensitively:

- `device.*`
  - Core examples: `device.name`, `device.sn`, `device.serial_number`, `device.imei`, `device.model`, `device.manufacturer`
  - Added context examples: `device.os_version`, `device.state`, `device.ownership`, `device.management_mode`, `device.policy_compliant`
  - Assigned-user shortcuts: `device.assigneduserfirstname`, `device.assigneduserlastname`, `device.assigneduseremail`, `device.assigneduserrole`, `device.assignedusergroup`
- `user.*`
  - `user.firstname`, `user.lastname`, `user.email`, `user.role`, `user.group`, `user.name`
- `group.*`
  - Built-in keys: `group.id`, `group.name`, `group.description`
  - Dynamic keys from group metadata: `group.<metadata_key>`
- `environment.*`
  - `environment.id`, `environment.workspace_id`, `environment.name`, `environment.enterprise_name`, `environment.enterprise_display_name`

## Resolution Rules

- Only `${...}` placeholders are parsed.
- Token lookups are exact after lowercasing (no legacy alias fallback like last-segment matching).
- Unresolved tokens remain unchanged in payload output and are reported in `unresolved_variables`.
