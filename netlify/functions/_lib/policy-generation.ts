import { createHash } from 'node:crypto';
import { query } from './db.js';
import { upsertOncDeploymentInPolicyConfig, upsertApnDeploymentInPolicyConfig, parseOncDocument, parseApnPolicy, getApnSettingKey } from './policy-merge.js';

export type PolicyScopeType = 'environment' | 'group' | 'device';

export type PolicyGenerationTarget =
  | { mode: 'auto' }
  | { mode: 'scope'; scope_type: PolicyScopeType; scope_id: string };

export type PolicyGenerationMetadata = {
  model: 'layered_overrides';
  assignments_considered: Array<{ scope_type: PolicyScopeType; scope_id: string }>;
  resolved_target: { scope_type: PolicyScopeType; scope_id: string };
  ambiguous_assignment_targets: boolean;
  ambiguous_reason: string | null;
  device_scoped_variables: string[];
  requires_per_device_derivative: boolean;
  device_variable_interpolation_supported: boolean;
  group_overrides_applied: Array<{ group_id: string; group_name: string; keys: string[] }>;
  device_overrides_applied: string[];
  locked_sections: string[];
  generation_hash?: string;
};

export type GeneratedPolicyPayload = {
  payload: Record<string, unknown>;
  metadata: PolicyGenerationMetadata;
};

export function computePolicyGenerationHash(
  payload: Record<string, unknown>,
  metadata: PolicyGenerationMetadata
): string {
  const metadataForHash: PolicyGenerationMetadata = { ...metadata };
  delete metadataForHash.generation_hash;
  return createHash('sha256')
    .update(JSON.stringify({
      payload,
      metadata: metadataForHash,
    }))
    .digest('hex');
}

type AppDeploymentRow = {
  id: string;
  package_name: string;
  install_type: string;
  managed_config: Record<string, unknown> | string | null;
  auto_update_mode: string | null;
  app_policy: Record<string, unknown> | string | null;
};

type NetworkDeploymentRow = {
  id: string;
  onc_profile: Record<string, unknown> | string | null;
};

type PolicyAssignmentRow = {
  scope_type: PolicyScopeType;
  scope_id: string;
};

type DeviceTargetRow = {
  id: string;
  group_id: string | null;
};

type GroupTargetRow = {
  id: string;
};

const VARIABLE_NAMESPACE_PREFIXES = ['device.', 'user.', 'group.', 'environment.'];

export async function buildGeneratedPolicyPayload(input: {
  policyId: string;
  environmentId: string;
  baseConfig: Record<string, unknown> | string | null | undefined;
  target?: PolicyGenerationTarget;
}): Promise<GeneratedPolicyPayload> {
  const base = clonePolicyConfig(input.baseConfig);
  const assignments = await query<PolicyAssignmentRow>(
    `SELECT scope_type, scope_id
     FROM policy_assignments
     WHERE policy_id = $1
     ORDER BY CASE scope_type WHEN 'device' THEN 1 WHEN 'group' THEN 2 ELSE 3 END, scope_id`,
    [input.policyId]
  );

  const resolution = await resolveGenerationTarget({
    environmentId: input.environmentId,
    assignments,
    requestedTarget: input.target ?? { mode: 'auto' },
  });

  await applyScopedAppDeployments(base, input.environmentId, resolution.target);
  await applyScopedNetworkDeployments(base, input.environmentId, resolution.target);

  // Load and apply group-level overrides (ancestor → descendant order)
  const { groupOverrides, lockedSections } = await loadAndApplyGroupOverrides(
    base, input.policyId, input.environmentId, resolution.target
  );

  // Load and apply device-level overrides (highest priority)
  const deviceOverrideKeys = await loadAndApplyDeviceOverrides(
    base, input.policyId, input.environmentId, resolution.target, lockedSections
  );

  const deviceScopedVariables = detectDeviceScopedVariables(base);
  normalizeAmapiCompatibilityFields(base);

  const metadata: PolicyGenerationMetadata = {
      model: 'layered_overrides',
      assignments_considered: assignments.map((a) => ({ scope_type: a.scope_type, scope_id: a.scope_id })),
      resolved_target: resolution.target,
      ambiguous_assignment_targets: resolution.ambiguous,
      ambiguous_reason: resolution.ambiguousReason,
      device_scoped_variables: deviceScopedVariables,
      requires_per_device_derivative: deviceScopedVariables.length > 0 && resolution.target.scope_type !== 'device',
      device_variable_interpolation_supported: false,
      group_overrides_applied: groupOverrides,
      device_overrides_applied: deviceOverrideKeys,
      locked_sections: lockedSections,
  };
  metadata.generation_hash = computePolicyGenerationHash(base, metadata);

  return {
    payload: base,
    metadata,
  };
}

function normalizeAmapiCompatibilityFields(config: Record<string, unknown>): void {
  const legacyPrivateDns = config.privateDnsSettings;
  if (!legacyPrivateDns || typeof legacyPrivateDns !== 'object' || Array.isArray(legacyPrivateDns)) return;

  const dcm = (
    config.deviceConnectivityManagement
    && typeof config.deviceConnectivityManagement === 'object'
    && !Array.isArray(config.deviceConnectivityManagement)
  ) ? (config.deviceConnectivityManagement as Record<string, unknown>) : {};

  const currentPrivateDns = (
    dcm.privateDnsSettings
    && typeof dcm.privateDnsSettings === 'object'
    && !Array.isArray(dcm.privateDnsSettings)
  ) ? (dcm.privateDnsSettings as Record<string, unknown>) : {};

  dcm.privateDnsSettings = {
    ...(legacyPrivateDns as Record<string, unknown>),
    ...currentPrivateDns,
  };
  config.deviceConnectivityManagement = dcm;
  delete config.privateDnsSettings;
}

async function resolveGenerationTarget(input: {
  environmentId: string;
  assignments: PolicyAssignmentRow[];
  requestedTarget: PolicyGenerationTarget;
}): Promise<{
  target: { scope_type: PolicyScopeType; scope_id: string };
  ambiguous: boolean;
  ambiguousReason: string | null;
}> {
  if (input.requestedTarget.mode === 'scope') {
    await assertTargetInEnvironment(input.environmentId, input.requestedTarget.scope_type, input.requestedTarget.scope_id);
    return {
      target: { scope_type: input.requestedTarget.scope_type, scope_id: input.requestedTarget.scope_id },
      ambiguous: false,
      ambiguousReason: null,
    };
  }

  if (input.assignments.length === 0) {
    return {
      target: { scope_type: 'environment', scope_id: input.environmentId },
      ambiguous: false,
      ambiguousReason: null,
    };
  }

  if (input.assignments.length === 1) {
    const only = input.assignments[0];
    await assertTargetInEnvironment(input.environmentId, only.scope_type, only.scope_id);
    return { target: only, ambiguous: false, ambiguousReason: null };
  }

  const envAssignment = input.assignments.find((a) => a.scope_type === 'environment' && a.scope_id === input.environmentId);
  if (envAssignment) {
    return {
      target: envAssignment,
      ambiguous: true,
      ambiguousReason: 'Policy has multiple assignments; using environment target for shared AMAPI payload generation',
    };
  }

  const first = input.assignments[0];
  await assertTargetInEnvironment(input.environmentId, first.scope_type, first.scope_id);
  return {
    target: first,
    ambiguous: true,
    ambiguousReason: 'Policy has multiple scoped assignments but only one AMAPI policy name is currently stored; using highest-specificity assignment deterministically',
  };
}

async function assertTargetInEnvironment(environmentId: string, scopeType: PolicyScopeType, scopeId: string): Promise<void> {
  if (scopeType === 'environment') {
    if (scopeId !== environmentId) {
      throw new Error('Invalid generation target: environment scope_id does not match environment_id');
    }
    return;
  }

  if (scopeType === 'group') {
    const row = await query<GroupTargetRow>(
      'SELECT id FROM groups WHERE id = $1 AND environment_id = $2',
      [scopeId, environmentId]
    );
    if (!row[0]) throw new Error('Invalid generation target: group not found in environment');
    return;
  }

  const row = await query<DeviceTargetRow>(
    'SELECT id, group_id FROM devices WHERE id = $1 AND environment_id = $2 AND deleted_at IS NULL',
    [scopeId, environmentId]
  );
  if (!row[0]) throw new Error('Invalid generation target: device not found in environment');
}

async function applyScopedAppDeployments(
  config: Record<string, unknown>,
  environmentId: string,
  target: { scope_type: PolicyScopeType; scope_id: string }
): Promise<void> {
  const appDeployments = await loadAppDeploymentsForTarget(environmentId, target);
  console.log('policy-generation: applyScopedAppDeployments', {
    environment_id: environmentId,
    target_scope: target.scope_type,
    target_id: target.scope_id,
    deployments_loaded: appDeployments.length,
    packages: appDeployments.map((d) => d.package_name),
  });
  for (const deployment of appDeployments) {
    upsertApplicationInPolicyConfig(config, deployment);
  }
  const finalApps = Array.isArray(config.applications) ? config.applications : [];
  console.log('policy-generation: final applications count:', finalApps.length);
}

async function applyScopedNetworkDeployments(
  config: Record<string, unknown>,
  environmentId: string,
  target: { scope_type: PolicyScopeType; scope_id: string }
): Promise<void> {
  const networkDeployments = await loadNetworkDeploymentsForTarget(environmentId, target);
  for (const deployment of networkDeployments) {
    const parsedProfile = normalizeJsonValue(deployment.onc_profile);
    if (!parsedProfile || typeof parsedProfile !== 'object' || Array.isArray(parsedProfile)) continue;

    const profile = parsedProfile as Record<string, unknown>;
    const kind = typeof profile.kind === 'string' ? profile.kind : '';
    if (kind === 'apnPolicy' && profile.apnPolicy && typeof profile.apnPolicy === 'object' && !Array.isArray(profile.apnPolicy)) {
      upsertApnDeploymentInPolicyConfig(config, profile.apnPolicy as Record<string, unknown>);
      continue;
    }

    upsertOncDeploymentInPolicyConfig(config, profile);
  }
}

async function loadAppDeploymentsForTarget(
  environmentId: string,
  target: { scope_type: PolicyScopeType; scope_id: string }
): Promise<AppDeploymentRow[]> {
  const rows: AppDeploymentRow[] = [];

  // Load environment-scoped app deployments only.
  // Catalog entries in `apps` define defaults for a package, but do not imply deployment.
  rows.push(...await query<AppDeploymentRow>(
    `SELECT a.id, a.package_name,
            COALESCE(asc_e.install_type, a.default_install_type) AS install_type,
            COALESCE(asc_e.managed_config, a.default_managed_config) AS managed_config,
            COALESCE(asc_e.auto_update_mode, a.default_auto_update_mode) AS auto_update_mode,
            COALESCE(asc_e.app_policy, '{}'::jsonb) AS app_policy
     FROM app_scope_configs asc_e
     JOIN apps a ON a.id = asc_e.app_id
     WHERE a.environment_id = $1
       AND asc_e.scope_type = 'environment'
       AND asc_e.scope_id = $1::uuid
     ORDER BY asc_e.updated_at ASC, a.id ASC`,
    [environmentId]
  ));

  // Group-scoped app configs (override environment defaults)
  if (target.scope_type === 'group' || target.scope_type === 'device') {
    const groupId = target.scope_type === 'group'
      ? target.scope_id
      : await getDeviceGroupId(environmentId, target.scope_id);

    if (groupId) {
      rows.push(...await query<AppDeploymentRow>(
        `SELECT a.id, a.package_name,
                COALESCE(asc_g.install_type, a.default_install_type) AS install_type,
                COALESCE(asc_g.managed_config, a.default_managed_config) AS managed_config,
                COALESCE(asc_g.auto_update_mode, a.default_auto_update_mode) AS auto_update_mode,
                COALESCE(asc_g.app_policy, '{}'::jsonb) AS app_policy
         FROM group_closures gc
         JOIN app_scope_configs asc_g
           ON asc_g.scope_type = 'group'
          AND asc_g.scope_id = gc.ancestor_id
         JOIN apps a ON a.id = asc_g.app_id
         WHERE gc.descendant_id = $1
           AND a.environment_id = $2
         ORDER BY gc.depth DESC, asc_g.updated_at ASC, a.id ASC`,
        [groupId, environmentId]
      ));
    }
  }

  // Device-scoped app configs
  if (target.scope_type === 'device') {
    rows.push(...await query<AppDeploymentRow>(
      `SELECT a.id, a.package_name,
              COALESCE(asc_d.install_type, a.default_install_type) AS install_type,
              COALESCE(asc_d.managed_config, a.default_managed_config) AS managed_config,
              COALESCE(asc_d.auto_update_mode, a.default_auto_update_mode) AS auto_update_mode,
              COALESCE(asc_d.app_policy, '{}'::jsonb) AS app_policy
       FROM app_scope_configs asc_d
       JOIN apps a ON a.id = asc_d.app_id
       WHERE a.environment_id = $1
         AND asc_d.scope_type = 'device'
         AND asc_d.scope_id = $2
       ORDER BY asc_d.updated_at ASC, a.id ASC`,
      [environmentId, target.scope_id]
    ));
  }

  // Also load from legacy app_deployments table as fallback
  // (for any deployments not yet migrated)
  const legacyEnvRows = await query<AppDeploymentRow>(
    `SELECT id, package_name, install_type, managed_config, auto_update_mode, NULL::jsonb AS app_policy
     FROM app_deployments
     WHERE environment_id = $1
       AND scope_type = 'environment'
       AND scope_id = $1::uuid
       AND NOT EXISTS (SELECT 1 FROM apps a WHERE a.environment_id = app_deployments.environment_id AND a.package_name = app_deployments.package_name)
     ORDER BY updated_at ASC, id ASC`,
    [environmentId]
  );
  rows.push(...legacyEnvRows);

  if (target.scope_type === 'group' || target.scope_type === 'device') {
    const groupId = target.scope_type === 'group'
      ? target.scope_id
      : await getDeviceGroupId(environmentId, target.scope_id);

    if (groupId) {
      const legacyGroupRows = await query<AppDeploymentRow>(
        `SELECT ad.id, ad.package_name, ad.install_type, ad.managed_config, ad.auto_update_mode, NULL::jsonb AS app_policy
         FROM group_closures gc
         JOIN app_deployments ad
           ON ad.scope_type = 'group'
          AND ad.scope_id = gc.ancestor_id
         WHERE gc.descendant_id = $1
           AND ad.environment_id = $2
           AND NOT EXISTS (
             SELECT 1
             FROM apps a
             JOIN app_scope_configs asc_g
               ON asc_g.app_id = a.id
              AND asc_g.scope_type = 'group'
              AND asc_g.scope_id = ad.scope_id
             WHERE a.environment_id = ad.environment_id
               AND a.package_name = ad.package_name
           )
         ORDER BY gc.depth DESC, ad.updated_at ASC, ad.id ASC`,
        [groupId, environmentId]
      );
      rows.push(...legacyGroupRows);
    }
  }

  if (target.scope_type === 'device') {
    const legacyDeviceRows = await query<AppDeploymentRow>(
      `SELECT id, package_name, install_type, managed_config, auto_update_mode, NULL::jsonb AS app_policy
       FROM app_deployments
       WHERE environment_id = $1
       AND scope_type = 'device'
        AND scope_id = $2
        AND NOT EXISTS (
           SELECT 1
           FROM apps a
           JOIN app_scope_configs asc_d
             ON asc_d.app_id = a.id
            AND asc_d.scope_type = 'device'
            AND asc_d.scope_id = app_deployments.scope_id
           WHERE a.environment_id = app_deployments.environment_id
             AND a.package_name = app_deployments.package_name
         )
       ORDER BY updated_at ASC, id ASC`,
      [environmentId, target.scope_id]
    );
    rows.push(...legacyDeviceRows);
  }

  return rows;
}

async function loadNetworkDeploymentsForTarget(
  environmentId: string,
  target: { scope_type: PolicyScopeType; scope_id: string }
): Promise<NetworkDeploymentRow[]> {
  const rows: NetworkDeploymentRow[] = [];

  rows.push(...await query<NetworkDeploymentRow>(
    `SELECT id, onc_profile
     FROM network_deployments
     WHERE environment_id = $1
       AND scope_type = 'environment'
       AND scope_id = $1::uuid
     ORDER BY updated_at ASC, id ASC`,
    [environmentId]
  ));

  if (target.scope_type === 'group' || target.scope_type === 'device') {
    const groupId = target.scope_type === 'group'
      ? target.scope_id
      : await getDeviceGroupId(environmentId, target.scope_id);

    if (groupId) {
      rows.push(...await query<NetworkDeploymentRow>(
        `SELECT nd.id, nd.onc_profile
         FROM group_closures gc
         JOIN network_deployments nd
           ON nd.scope_type = 'group'
          AND nd.scope_id = gc.ancestor_id
         WHERE gc.descendant_id = $1
           AND nd.environment_id = $2
         ORDER BY gc.depth DESC, nd.updated_at ASC, nd.id ASC`,
        [groupId, environmentId]
      ));
    }
  }

  if (target.scope_type === 'device') {
    rows.push(...await query<NetworkDeploymentRow>(
      `SELECT id, onc_profile
       FROM network_deployments
       WHERE environment_id = $1
         AND scope_type = 'device'
         AND scope_id = $2
       ORDER BY updated_at ASC, id ASC`,
      [environmentId, target.scope_id]
    ));
  }

  return rows;
}

async function getDeviceGroupId(environmentId: string, deviceId: string): Promise<string | null> {
  const row = await query<DeviceTargetRow>(
    `SELECT id, group_id
     FROM devices
     WHERE id = $1
       AND environment_id = $2
       AND deleted_at IS NULL`,
    [deviceId, environmentId]
  );
  return row[0]?.group_id ?? null;
}

function clonePolicyConfig(value: Record<string, unknown> | string | null | undefined): Record<string, unknown> {
  const normalized = normalizeJsonValue(value);
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) return {};
  return JSON.parse(JSON.stringify(normalized)) as Record<string, unknown>;
}

function normalizeJsonValue<T>(value: T | string | null | undefined): T | unknown {
  if (typeof value !== 'string') return value as unknown;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function upsertApplicationInPolicyConfig(config: Record<string, unknown>, deployment: AppDeploymentRow): boolean {
  const applications = Array.isArray(config.applications)
    ? ([...config.applications] as Array<Record<string, unknown>>)
    : [];

  const rawAppPolicy = normalizeJsonValue(deployment.app_policy);
  const appPolicy = (rawAppPolicy && typeof rawAppPolicy === 'object' && !Array.isArray(rawAppPolicy))
    ? { ...(rawAppPolicy as Record<string, unknown>) }
    : {};
  delete appPolicy.packageName;
  delete appPolicy.installType;
  delete appPolicy.autoUpdateMode;
  delete appPolicy.managedConfiguration;

  const appEntry: Record<string, unknown> = {
    packageName: deployment.package_name,
    installType: deployment.install_type,
    defaultPermissionPolicy: 'GRANT',
    ...appPolicy,
  };

  if (deployment.install_type !== 'CUSTOM') {
    appEntry.autoUpdateMode = deployment.auto_update_mode ?? 'AUTO_UPDATE_DEFAULT';
  } else {
    delete appEntry.autoUpdateMode;
    delete appEntry.installPriority;
    delete appEntry.installConstraint;
    delete appEntry.minimumVersionCode;
    delete appEntry.accessibleTrackIds;
  }

  const managedConfig = normalizeJsonValue(deployment.managed_config);
  if (managedConfig && typeof managedConfig === 'object' && !Array.isArray(managedConfig) && Object.keys(managedConfig).length > 0) {
    appEntry.managedConfiguration = managedConfig;
  }

  const existingIndex = applications.findIndex((a) => a.packageName === deployment.package_name);
  if (existingIndex >= 0) {
    applications[existingIndex] = { ...applications[existingIndex], ...appEntry };
  } else {
    applications.push(appEntry);
  }

  config.applications = applications;
  return true;
}

// ── Override loading & merging ─────────────────────────────────────────────

type GroupOverrideInfo = { group_id: string; group_name: string; keys: string[] };

async function loadAndApplyGroupOverrides(
  config: Record<string, unknown>,
  policyId: string,
  environmentId: string,
  target: { scope_type: PolicyScopeType; scope_id: string }
): Promise<{ groupOverrides: GroupOverrideInfo[]; lockedSections: string[] }> {
  const groupOverrides: GroupOverrideInfo[] = [];
  const allLockedSections = new Set<string>();

  // Only relevant for group or device scopes
  if (target.scope_type !== 'group' && target.scope_type !== 'device') {
    // Check environment-level locks
    const envLock = await query<{ locked: boolean; locked_sections: string[] | null }>(
      `SELECT locked, locked_sections FROM policy_assignments
       WHERE scope_type = 'environment' AND scope_id = $1 AND policy_id = $2`,
      [environmentId, policyId]
    );
    if (envLock[0]?.locked) {
      // Entire policy locked at env level — no overrides allowed, return all keys as locked
      return { groupOverrides: [], lockedSections: Object.keys(config) };
    }
    if (envLock[0]?.locked_sections) {
      for (const s of envLock[0].locked_sections) allLockedSections.add(s);
    }
    return { groupOverrides: [], lockedSections: [...allLockedSections] };
  }

  // Determine group ID
  let groupId: string | null = null;
  if (target.scope_type === 'group') {
    groupId = target.scope_id;
  } else {
    groupId = await getDeviceGroupId(environmentId, target.scope_id);
  }

  // Collect locks from environment level
  const envLockRows = await query<{ locked: boolean; locked_sections: string[] | null }>(
    `SELECT locked, locked_sections FROM policy_assignments
     WHERE scope_type = 'environment' AND scope_id = $1 AND policy_id = $2`,
    [environmentId, policyId]
  );
  if (envLockRows[0]?.locked) {
    return { groupOverrides: [], lockedSections: Object.keys(config) };
  }
  if (envLockRows[0]?.locked_sections) {
    for (const s of envLockRows[0].locked_sections) allLockedSections.add(s);
  }

  if (!groupId) return { groupOverrides: [], lockedSections: [...allLockedSections] };

  // Load group overrides & locks walking from ancestors → self
  // depth DESC = most distant ancestor first, then closer, then self (depth 0)
  const rows = await query<{
    ancestor_id: string;
    group_name: string;
    depth: number;
    override_config: Record<string, unknown> | string | null;
    pa_locked: boolean | null;
    pa_locked_sections: string[] | null;
  }>(
    `SELECT gc.ancestor_id, g.name AS group_name, gc.depth,
            gpo.override_config,
            pa.locked AS pa_locked, pa.locked_sections AS pa_locked_sections
     FROM group_closures gc
     JOIN groups g ON g.id = gc.ancestor_id
     LEFT JOIN group_policy_overrides gpo
       ON gpo.group_id = gc.ancestor_id AND gpo.policy_id = $2
     LEFT JOIN policy_assignments pa
       ON pa.scope_type = 'group' AND pa.scope_id = gc.ancestor_id AND pa.policy_id = $2
     WHERE gc.descendant_id = $1
     ORDER BY gc.depth DESC`,
    [groupId, policyId]
  );

  for (const row of rows) {
    // Accumulate locks from ancestors (not self at depth 0)
    if (row.depth > 0 || target.scope_type === 'device') {
      if (row.pa_locked) {
        // Fully locked — no further overrides allowed below this ancestor
        return { groupOverrides, lockedSections: Object.keys(config) };
      }
      if (row.pa_locked_sections) {
        for (const s of row.pa_locked_sections) allLockedSections.add(s);
      }
    }

    // Apply override config (skip locked sections)
    if (row.override_config) {
      const overrideObj = typeof row.override_config === 'string'
        ? JSON.parse(row.override_config)
        : row.override_config;

      if (overrideObj && typeof overrideObj === 'object') {
        const appliedKeys: string[] = [];
        for (const [key, value] of Object.entries(overrideObj as Record<string, unknown>)) {
          if (!allLockedSections.has(key)) {
            config[key] = value;
            appliedKeys.push(key);
          }
        }
        if (appliedKeys.length > 0) {
          groupOverrides.push({ group_id: row.ancestor_id, group_name: row.group_name, keys: appliedKeys });
        }
      }
    }
  }

  return { groupOverrides, lockedSections: [...allLockedSections] };
}

async function loadAndApplyDeviceOverrides(
  config: Record<string, unknown>,
  policyId: string,
  environmentId: string,
  target: { scope_type: PolicyScopeType; scope_id: string },
  lockedSections: string[]
): Promise<string[]> {
  if (target.scope_type !== 'device') return [];

  const row = await query<{ override_config: Record<string, unknown> | string | null }>(
    'SELECT override_config FROM device_policy_overrides WHERE device_id = $1 AND policy_id = $2',
    [target.scope_id, policyId]
  );

  if (!row[0]?.override_config) return [];

  const overrideObj = typeof row[0].override_config === 'string'
    ? JSON.parse(row[0].override_config)
    : row[0].override_config;

  if (!overrideObj || typeof overrideObj !== 'object') return [];

  const lockedSet = new Set(lockedSections);
  const appliedKeys: string[] = [];

  for (const [key, value] of Object.entries(overrideObj as Record<string, unknown>)) {
    if (!lockedSet.has(key)) {
      config[key] = value;
      appliedKeys.push(key);
    }
  }

  return appliedKeys;
}

export function detectDeviceScopedVariables(value: unknown): string[] {
  const found = new Set<string>();
  walkValues(value, (str) => {
    for (const token of extractVariableTokens(str)) {
      const normalized = token.toLowerCase();
      if (isDeviceScopedVariable(normalized)) found.add(normalized);
    }
  });
  return [...found].sort();
}

function isDeviceScopedVariable(token: string): boolean {
  const normalized = token.toLowerCase();
  return VARIABLE_NAMESPACE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function walkValues(value: unknown, onString: (value: string) => void): void {
  if (typeof value === 'string') {
    onString(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walkValues(item, onString);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const entry of Object.values(value as Record<string, unknown>)) {
    walkValues(entry, onString);
  }
}

function extractVariableTokens(input: string): string[] {
  const out = new Set<string>();

  const braced = /\$\{([a-zA-Z0-9_.-]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = braced.exec(input)) !== null) {
    if (match[1]) out.add(match[1].toLowerCase());
  }

  return [...out];
}
