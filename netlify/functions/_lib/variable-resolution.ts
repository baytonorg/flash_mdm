import { queryOne } from './db.js';

/**
 * Variable resolution for device-scoped policy derivatives.
 *
 * Variables use ${namespace.key} syntax in policy JSON string values.
 * This module resolves them to actual device/user/group/environment attributes.
 */

export type VariableContext = {
  device?: {
    id?: string;
    amapi_name?: string | null;
    name?: string | null;
    sn?: string | null;
    serial?: string | null;
    serial_number?: string | null;
    imei?: string | null;
    meid?: string | null;
    model?: string | null;
    manufacturer?: string | null;
    os_version?: string | null;
    security_patch_level?: string | null;
    android_id?: string | null;
    state?: string | null;
    ownership?: string | null;
    management_mode?: string | null;
    policy_compliant?: boolean | null;
    enrollment_time?: string | null;
    last_status_report_at?: string | null;
    group_id?: string | null;
    assigneduser?: string | null;
    assigneduserfirstname?: string | null;
    assigneduserlastname?: string | null;
    assigneduseremail?: string | null;
    assigneduserrole?: string | null;
    assignedusergroup?: string | null;
  };
  user?: {
    id?: string;
    firstname?: string | null;
    lastname?: string | null;
    email?: string | null;
    role?: string | null;
    group?: string | null;
    name?: string | null;
  };
  group?: {
    id?: string;
    name?: string | null;
    description?: string | null;
    metadata?: Record<string, string | null>;
  };
  environment?: {
    id?: string;
    workspace_id?: string | null;
    name?: string | null;
    enterprise_name?: string | null;
    enterprise_display_name?: string | null;
  };
};

export type VariableResolutionResult = {
  config: Record<string, unknown>;
  resolved_variables: Record<string, string>;
  unresolved_variables: string[];
};

/**
 * Build a VariableContext for a device by querying its attributes,
 * group, user mapping, and environment.
 */
export async function buildVariableContextForDevice(
  deviceId: string,
  environmentId: string
): Promise<VariableContext> {
  const device = await queryOne<{
    id: string;
    amapi_name: string | null;
    name: string | null;
    serial_number: string | null;
    imei: string | null;
    os_version: string | null;
    security_patch_level: string | null;
    state: string | null;
    ownership: string | null;
    management_mode: string | null;
    policy_compliant: boolean | null;
    enrollment_time: string | null;
    last_status_report_at: string | null;
    model: string | null;
    manufacturer: string | null;
    group_id: string | null;
    snapshot: Record<string, unknown> | string | null;
  }>(
    `SELECT id, amapi_name, name, serial_number, imei, os_version, security_patch_level,
            state, ownership, management_mode, policy_compliant, enrollment_time, last_status_report_at,
            model, manufacturer, group_id, snapshot
       FROM devices
      WHERE id = $1 AND environment_id = $2 AND deleted_at IS NULL`,
    [deviceId, environmentId]
  );

  // After device lookup, environment and group reads are independent and can run concurrently.
  const envPromise = queryOne<{
    id: string;
    workspace_id: string;
    name: string | null;
    enterprise_name: string | null;
    enterprise_display_name: string | null;
  }>(
    `SELECT id, workspace_id, name, enterprise_name, enterprise_display_name
       FROM environments
      WHERE id = $1`,
    [environmentId]
  );

  const groupPromise = device?.group_id
    ? queryOne<{
      id: string;
      name: string | null;
      description: string | null;
      settings: Record<string, unknown> | string | null;
    }>(
      'SELECT id, name, description, settings FROM groups WHERE id = $1 AND environment_id = $2',
      [device.group_id, environmentId]
    )
    : Promise.resolve(null);

  const [env, group] = await Promise.all([envPromise, groupPromise]);

  let groupCtx: VariableContext['group'] = undefined;
  if (group) {
    const settings = parseJsonRecord(group.settings);
    const rawMetadata = isRecord(settings?.metadata) ? settings.metadata : {};
    const metadata: Record<string, string | null> = {};

    for (const [key, value] of Object.entries(rawMetadata)) {
      metadata[key] = coerceToString(value);
    }

    groupCtx = {
      id: group.id,
      name: group.name,
      description: group.description,
      metadata,
    };
  }

  const snapshot = parseJsonRecord(device?.snapshot);
  const assignedUserEmail = extractAssignedUserEmail(snapshot);
  const meid = extractSnapshotString(snapshot, [['hardwareInfo', 'meid'], ['meid']]);
  const androidId = extractSnapshotString(snapshot, [['hardwareInfo', 'androidId'], ['androidId']]);

  const userCtx = await buildUserContext({
    assignedUserEmail,
    environmentId,
    workspaceId: env?.workspace_id ?? null,
    deviceGroupId: device?.group_id ?? null,
    fallbackGroupName: groupCtx?.name ?? null,
  });

  const assignedUserName = [userCtx?.firstname, userCtx?.lastname]
    .filter(Boolean)
    .join(' ')
    .trim() || null;

  return {
    device: device
      ? {
          id: device.id,
          amapi_name: device.amapi_name,
          name: device.name,
          // Maintain legacy alias variants expected by existing templates.
          sn: device.serial_number,
          serial: device.serial_number,
          serial_number: device.serial_number,
          imei: device.imei,
          meid,
          model: device.model,
          manufacturer: device.manufacturer,
          os_version: device.os_version,
          security_patch_level: device.security_patch_level,
          android_id: androidId,
          state: device.state,
          ownership: device.ownership,
          management_mode: device.management_mode,
          policy_compliant: device.policy_compliant,
          enrollment_time: device.enrollment_time,
          last_status_report_at: device.last_status_report_at,
          group_id: device.group_id,
          // Legacy assigneduser* aliases are kept for backwards compatibility.
          // Prefer canonical user.* variables for new templates.
          assigneduser: assignedUserName,
          assigneduserfirstname: userCtx?.firstname ?? null,
          assigneduserlastname: userCtx?.lastname ?? null,
          assigneduseremail: userCtx?.email ?? assignedUserEmail,
          assigneduserrole: userCtx?.role ?? null,
          assignedusergroup: userCtx?.group ?? null,
        }
      : undefined,
    user: userCtx,
    group: groupCtx,
    environment: env
      ? {
          id: env.id,
          workspace_id: env.workspace_id,
          name: env.name,
          enterprise_name: env.enterprise_name,
          enterprise_display_name: env.enterprise_display_name,
        }
      : undefined,
  };
}

/**
 * Resolve all ${variable} patterns in a policy config object.
 * Recursively walks the JSON tree and substitutes string values.
 *
 * Returns the modified config plus metadata about what was resolved.
 */
export function resolveVariables(
  config: Record<string, unknown>,
  context: VariableContext
): VariableResolutionResult {
  const variableMap = buildVariableMap(context);
  const resolved: Record<string, string> = {};
  const unresolved = new Set<string>();

  const result = walkAndResolve(config, variableMap, resolved, unresolved);

  return {
    config: result as Record<string, unknown>,
    resolved_variables: resolved,
    unresolved_variables: [...unresolved].sort(),
  };
}

/**
 * Build a flat map of namespaced variable names → values from context.
 */
function buildVariableMap(context: VariableContext): Map<string, string> {
  const map = new Map<string, string>();

  addNamespaceValues(map, 'device', context.device);
  addNamespaceValues(map, 'user', context.user);
  addNamespaceValues(map, 'group', context.group);
  addNamespaceValues(map, 'environment', context.environment);

  if (context.group?.metadata) {
    for (const [key, value] of Object.entries(context.group.metadata)) {
      const normalizedKey = normalizeKeySegment(key);
      if (!normalizedKey) continue;
      const normalizedValue = coerceToString(value);
      if (normalizedValue === null) continue;
      map.set(`group.${normalizedKey}`, normalizedValue);
    }
  }

  return map;
}

/**
 * Recursively walk a JSON value and resolve ${variable} patterns in strings.
 */
function walkAndResolve(
  value: unknown,
  variableMap: Map<string, string>,
  resolved: Record<string, string>,
  unresolved: Set<string>
): unknown {
  if (typeof value === 'string') {
    return resolveStringVariables(value, variableMap, resolved, unresolved);
  }

  if (Array.isArray(value)) {
    return value.map((item) => walkAndResolve(item, variableMap, resolved, unresolved));
  }

  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = walkAndResolve(val, variableMap, resolved, unresolved);
    }
    return result;
  }

  return value;
}

/**
 * Resolve ${namespace.key} patterns in a single string.
 * Leaves unresolved variables as-is.
 */
function resolveStringVariables(
  input: string,
  variableMap: Map<string, string>,
  resolved: Record<string, string>,
  unresolved: Set<string>
): string {
  return input.replace(/\$\{([a-zA-Z0-9_.-]+)\}/g, (match, varName: string) => {
    const normalizedName = varName.toLowerCase();
    const value = variableMap.get(normalizedName);

    if (value !== undefined) {
      resolved[normalizedName] = value;
      return value;
    }

    unresolved.add(normalizedName);
    return match;
  });
}

async function buildUserContext(input: {
  assignedUserEmail: string | null;
  environmentId: string;
  workspaceId: string | null;
  deviceGroupId: string | null;
  fallbackGroupName: string | null;
}): Promise<VariableContext['user']> {
  if (!input.assignedUserEmail) return undefined;

  // Intentional NULL semantics:
  // - If workspaceId ($3) is NULL, wm.workspace_id = $3 cannot match.
  // - If deviceGroupId ($4) is NULL, gm.group_id = $4 cannot match.
  // The OR block then treats those scopes as "not a membership source" while still
  // allowing environment membership (or another provided scope) to satisfy access.
  const user = await queryOne<{
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string;
    environment_role: string | null;
    workspace_role: string | null;
    group_role: string | null;
    group_name: string | null;
  }>(
    `SELECT u.id,
            u.first_name,
            u.last_name,
            u.email,
            em.role AS environment_role,
            wm.role AS workspace_role,
            gm.role AS group_role,
            grp.name AS group_name
       FROM users u
  LEFT JOIN environment_memberships em
         ON em.user_id = u.id
        AND em.environment_id = $2
  LEFT JOIN workspace_memberships wm
         ON wm.user_id = u.id
        AND wm.workspace_id = $3
  LEFT JOIN group_memberships gm
         ON gm.user_id = u.id
        AND gm.group_id = $4
  LEFT JOIN groups grp
         ON grp.id = gm.group_id
      WHERE lower(u.email) = lower($1)
        AND (
          em.user_id IS NOT NULL
          OR wm.user_id IS NOT NULL
          OR gm.user_id IS NOT NULL
        )
      LIMIT 1`,
    [input.assignedUserEmail, input.environmentId, input.workspaceId, input.deviceGroupId]
  );

  if (!user) {
    return {
      email: input.assignedUserEmail,
      group: input.fallbackGroupName,
    };
  }

  const firstName = user.first_name;
  const lastName = user.last_name;
  const name = [firstName, lastName].filter(Boolean).join(' ').trim() || null;

  return {
    id: user.id,
    firstname: firstName,
    lastname: lastName,
    email: user.email.toLowerCase(),
    role: selectHighestRole([user.environment_role, user.workspace_role, user.group_role]),
    group: user.group_name ?? input.fallbackGroupName,
    name,
  };
}

function addNamespaceValues(
  map: Map<string, string>,
  namespace: 'device' | 'user' | 'group' | 'environment',
  values: Record<string, unknown> | undefined
): void {
  if (!values) return;

  for (const [rawKey, rawValue] of Object.entries(values)) {
    if (rawKey === 'metadata') continue;
    const key = normalizeKeySegment(rawKey);
    if (!key) continue;

    const value = coerceToString(rawValue);
    if (value === null) continue;

    map.set(`${namespace}.${key}`, value);
  }
}

function selectHighestRole(roles: Array<string | null | undefined>): string | null {
  const roleRank: Record<string, number> = {
    viewer: 1,
    member: 2,
    admin: 3,
    owner: 4,
  };

  let selected: string | null = null;
  let bestRank = 0;

  for (const role of roles) {
    if (!role) continue;

    const normalized = role.toLowerCase();
    const rank = roleRank[normalized] ?? 0;
    if (rank > bestRank) {
      bestRank = rank;
      selected = normalized;
    }
  }

  return selected;
}

function normalizeKeySegment(input: string): string {
  // Variable keys are restricted to ASCII [a-z0-9_-] for deterministic namespace matching.
  // Non-ASCII characters are stripped (e.g. "Département" -> "dpartement").
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]/g, '');
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (typeof value !== 'string') return null;

  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function coerceToString(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value);
  }

  return null;
}

function extractAssignedUserEmail(snapshot: Record<string, unknown> | null): string | null {
  const raw = extractSnapshotString(snapshot, [
    ['enrollmentTokenData', 'signin_email'],
    ['enrollmentTokenData', 'signinEmail'],
    ['enrollmentTokenData', 'email'],
    ['user', 'email'],
    ['userEmail'],
  ]);

  return raw?.toLowerCase() ?? null;
}

function extractSnapshotString(
  snapshot: Record<string, unknown> | null,
  paths: string[][]
): string | null {
  if (!snapshot) return null;

  for (const path of paths) {
    const value = getNestedValue(snapshot, path);
    const normalized = coerceToString(value);
    if (normalized !== null) return normalized;
  }

  return null;
}

function getNestedValue(input: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = input;

  for (const segment of path) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }

  return current;
}
