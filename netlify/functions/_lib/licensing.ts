import { execute, query, queryOne } from './db.js';
import { isMissingRelationError } from './db-errors.js';
import { getPlatformSettings } from './platform-settings.js';

export interface WorkspaceLicensingSettings {
  platform_licensing_enabled: boolean;
  workspace_licensing_enabled: boolean;
  effective_licensing_enabled: boolean;
  inherit_platform_free_tier: boolean;
  free_enabled: boolean;
  free_seat_limit: number;
  workspace_free_enabled: boolean;
  workspace_free_seat_limit: number;
  platform_default_free_enabled: boolean;
  platform_default_free_seat_limit: number;
  billing_method: 'stripe' | 'invoice' | 'disabled';
  customer_owner_enabled: boolean;
  grace_day_block: number;
  grace_day_disable: number;
  grace_day_wipe: number;
}

export interface EnvironmentLicensingSnapshot {
  environment_id: string;
  environment_name: string;
  workspace_id: string;
  active_device_count: number;
  entitled_seats: number;
  overage_count: number;
  open_case_id: string | null;
  overage_started_at: string | null;
  overage_age_days: number;
  overage_phase: 'warn' | 'block' | 'disable' | 'wipe' | 'resolved';
  enrollment_blocked: boolean;
}

const DEFAULT_SETTINGS: WorkspaceLicensingSettings = {
  platform_licensing_enabled: true,
  workspace_licensing_enabled: true,
  effective_licensing_enabled: true,
  inherit_platform_free_tier: true,
  free_enabled: true,
  free_seat_limit: 10,
  workspace_free_enabled: true,
  workspace_free_seat_limit: 10,
  platform_default_free_enabled: true,
  platform_default_free_seat_limit: 10,
  billing_method: 'stripe',
  customer_owner_enabled: false,
  grace_day_block: 10,
  grace_day_disable: 30,
  grace_day_wipe: 45,
};

function normalizeSettings(settings: WorkspaceLicensingSettings): WorkspaceLicensingSettings {
  const normalized = { ...settings };
  const normalizeSeatLimit = (value: number): number => Math.min(1_000_000, Math.max(0, value));
  normalized.platform_default_free_seat_limit = normalizeSeatLimit(normalized.platform_default_free_seat_limit);
  normalized.workspace_free_seat_limit = normalizeSeatLimit(normalized.workspace_free_seat_limit);
  normalized.free_seat_limit = normalizeSeatLimit(normalized.free_seat_limit);

  const hasValidGraceOrder =
    normalized.grace_day_block >= 0 &&
    normalized.grace_day_block < normalized.grace_day_disable &&
    normalized.grace_day_disable < normalized.grace_day_wipe;

  if (!hasValidGraceOrder) {
    normalized.grace_day_block = DEFAULT_SETTINGS.grace_day_block;
    normalized.grace_day_disable = DEFAULT_SETTINGS.grace_day_disable;
    normalized.grace_day_wipe = DEFAULT_SETTINGS.grace_day_wipe;
  }

  return normalized;
}

export function isLicensingEnforcementEnabled(): boolean {
  return process.env.LICENSING_ENFORCEMENT_ENABLED === 'true';
}

export function isLicensingDryRun(): boolean {
  // Default to dry-run unless explicitly disabled.
  return process.env.LICENSING_DRY_RUN !== 'false';
}

export function getOveragePhaseForAgeDays(
  ageDays: number,
  settings: WorkspaceLicensingSettings
): 'warn' | 'block' | 'disable' | 'wipe' {
  if (ageDays >= settings.grace_day_wipe) return 'wipe';
  if (ageDays >= settings.grace_day_disable) return 'disable';
  if (ageDays >= settings.grace_day_block) return 'block';
  return 'warn';
}

export async function getWorkspaceLicensingSettings(workspaceId: string): Promise<WorkspaceLicensingSettings> {
  const loadWorkspaceRow = async () => {
    try {
      return await queryOne<{
        licensing_enabled?: boolean;
        inherit_platform_free_tier?: boolean;
        free_enabled?: boolean;
        free_seat_limit?: number;
        billing_method?: WorkspaceLicensingSettings['billing_method'];
        customer_owner_enabled?: boolean;
        grace_day_block?: number;
        grace_day_disable?: number;
        grace_day_wipe?: number;
      }>(
        `SELECT licensing_enabled, inherit_platform_free_tier, free_enabled, free_seat_limit, billing_method, customer_owner_enabled,
                grace_day_block, grace_day_disable, grace_day_wipe
         FROM workspace_licensing_settings
         WHERE workspace_id = $1`,
        [workspaceId]
      );
    } catch (err) {
      const code = typeof err === 'object' && err !== null && 'code' in err ? (err as { code?: string }).code : undefined;
      if (code === '42P01') return null;
      if (code !== '42703') throw err;
      try {
        return await queryOne<{
          inherit_platform_free_tier?: boolean;
          free_enabled?: boolean;
          free_seat_limit?: number;
          billing_method?: WorkspaceLicensingSettings['billing_method'];
          customer_owner_enabled?: boolean;
          grace_day_block?: number;
          grace_day_disable?: number;
          grace_day_wipe?: number;
        }>(
          `SELECT inherit_platform_free_tier, free_enabled, free_seat_limit, billing_method, customer_owner_enabled,
                  grace_day_block, grace_day_disable, grace_day_wipe
           FROM workspace_licensing_settings
           WHERE workspace_id = $1`,
          [workspaceId]
        );
      } catch (legacyErr) {
        const legacyCode = typeof legacyErr === 'object' && legacyErr !== null && 'code' in legacyErr
          ? (legacyErr as { code?: string }).code
          : undefined;
        if (legacyCode === '42P01') return null;
        if (legacyCode !== '42703') throw legacyErr;
        return queryOne<{
          free_enabled?: boolean;
          free_seat_limit?: number;
          billing_method?: WorkspaceLicensingSettings['billing_method'];
          customer_owner_enabled?: boolean;
          grace_day_block?: number;
          grace_day_disable?: number;
          grace_day_wipe?: number;
        }>(
          `SELECT free_enabled, free_seat_limit, billing_method, customer_owner_enabled,
                  grace_day_block, grace_day_disable, grace_day_wipe
           FROM workspace_licensing_settings
           WHERE workspace_id = $1`,
          [workspaceId]
        );
      }
    }
  };

  const [row, platform] = await Promise.all([loadWorkspaceRow(), getPlatformSettings()]);

  const platformLicensingEnabled = platform.licensing_enabled ?? DEFAULT_SETTINGS.platform_licensing_enabled;
  const platformFreeEnabled = platform.default_free_enabled ?? DEFAULT_SETTINGS.platform_default_free_enabled;
  const platformFreeSeatLimit = platform.default_free_seat_limit ?? DEFAULT_SETTINGS.platform_default_free_seat_limit;
  if (!row) {
    return normalizeSettings({
      ...DEFAULT_SETTINGS,
      platform_licensing_enabled: platformLicensingEnabled,
      workspace_licensing_enabled: DEFAULT_SETTINGS.workspace_licensing_enabled,
      effective_licensing_enabled: platformLicensingEnabled && DEFAULT_SETTINGS.workspace_licensing_enabled,
      inherit_platform_free_tier: true,
      workspace_free_enabled: platformFreeEnabled,
      workspace_free_seat_limit: platformFreeSeatLimit,
      free_enabled: platformFreeEnabled,
      free_seat_limit: platformFreeSeatLimit,
      platform_default_free_enabled: platformFreeEnabled,
      platform_default_free_seat_limit: platformFreeSeatLimit,
    });
  }

  const workspaceLicensingEnabled = row.licensing_enabled ?? DEFAULT_SETTINGS.workspace_licensing_enabled;
  const inheritPlatform = row.inherit_platform_free_tier ?? true;
  const workspaceFreeEnabled = row.free_enabled ?? platformFreeEnabled;
  const workspaceFreeSeatLimit = row.free_seat_limit ?? platformFreeSeatLimit;
  const effectiveFreeEnabled = inheritPlatform ? platformFreeEnabled : workspaceFreeEnabled;
  const effectiveFreeSeatLimit = inheritPlatform ? platformFreeSeatLimit : workspaceFreeSeatLimit;

  return normalizeSettings({
    platform_licensing_enabled: platformLicensingEnabled,
    workspace_licensing_enabled: workspaceLicensingEnabled,
    effective_licensing_enabled: platformLicensingEnabled && workspaceLicensingEnabled,
    inherit_platform_free_tier: inheritPlatform,
    free_enabled: effectiveFreeEnabled,
    free_seat_limit: effectiveFreeSeatLimit,
    workspace_free_enabled: workspaceFreeEnabled,
    workspace_free_seat_limit: workspaceFreeSeatLimit,
    platform_default_free_enabled: platformFreeEnabled,
    platform_default_free_seat_limit: platformFreeSeatLimit,
    billing_method: (row.billing_method as WorkspaceLicensingSettings['billing_method']) ?? DEFAULT_SETTINGS.billing_method,
    customer_owner_enabled: row.customer_owner_enabled ?? DEFAULT_SETTINGS.customer_owner_enabled,
    grace_day_block: row.grace_day_block ?? DEFAULT_SETTINGS.grace_day_block,
    grace_day_disable: row.grace_day_disable ?? DEFAULT_SETTINGS.grace_day_disable,
    grace_day_wipe: row.grace_day_wipe ?? DEFAULT_SETTINGS.grace_day_wipe,
  });
}

export async function isPlatformLicensingEnabled(): Promise<boolean> {
  const platform = await getPlatformSettings();
  return platform.licensing_enabled ?? true;
}

export async function getWorkspacePlatformEntitledSeats(workspaceId: string): Promise<number> {
  const settings = await getWorkspaceLicensingSettings(workspaceId);
  const row = await queryOne<{ seats: string }>(
    `SELECT COALESCE(SUM(seat_count), 0) as seats
     FROM license_grants
     WHERE workspace_id = $1
       AND status = 'active'
       AND starts_at <= now()
       AND (ends_at IS NULL OR ends_at > now())`,
    [workspaceId]
  );
  const paidSeats = parseInt(row?.seats ?? '0', 10);
  return paidSeats + (settings.free_enabled ? settings.free_seat_limit : 0);
}

export async function getWorkspaceAvailableGiftSeats(workspaceId: string): Promise<number> {
  const [giftRow, consumedRow] = await Promise.all([
    queryOne<{ seats: string }>(
      `SELECT COALESCE(SUM(seat_count), 0) as seats
       FROM license_grants
       WHERE workspace_id = $1
         AND source = 'gift'
         AND status = 'active'
         AND starts_at <= now()
         AND (ends_at IS NULL OR ends_at > now())`,
      [workspaceId]
    ),
    queryOne<{ seats: string }>(
      `SELECT COALESCE(SUM(COALESCE((bii.metadata ->> 'gift_offset_seats')::integer, 0)), 0) as seats
       FROM billing_invoice_items bii
       JOIN billing_invoices bi ON bi.id = bii.invoice_id
       WHERE bi.workspace_id = $1
         AND bi.status IN ('pending', 'paid')`,
      [workspaceId]
    ),
  ]);

  const totalGiftSeats = parseInt(giftRow?.seats ?? '0', 10);
  const consumedGiftSeats = parseInt(consumedRow?.seats ?? '0', 10);
  return Math.max(0, totalGiftSeats - consumedGiftSeats);
}

export async function getEnvironmentEntitledSeats(environmentId: string): Promise<number> {
  try {
    const row = await queryOne<{ seats: string }>(
      `SELECT COALESCE(SUM(seat_count), 0) as seats
       FROM environment_entitlements
       WHERE environment_id = $1
         AND status = 'active'
         AND starts_at <= now()
         AND (ends_at IS NULL OR ends_at > now())`,
      [environmentId]
    );
    return parseInt(row?.seats ?? '0', 10);
  } catch (err) {
    if (isMissingRelationError(err)) return 0;
    throw err;
  }
}

export async function getEnvironmentSeatConsumptionCount(environmentId: string): Promise<number> {
  const row = await queryOne<{ count: string }>(
    `SELECT COUNT(*) as count
     FROM devices
     WHERE environment_id = $1
       AND deleted_at IS NULL
       AND COALESCE(state, 'ACTIVE') IN ('ACTIVE', 'DISABLED', 'PROVISIONING')`,
    [environmentId]
  );
  return parseInt(row?.count ?? '0', 10);
}

export async function getEnvironmentLicensingSnapshot(environmentId: string): Promise<EnvironmentLicensingSnapshot> {
  const env = await queryOne<{ workspace_id: string; name: string }>(
    'SELECT workspace_id, name FROM environments WHERE id = $1',
    [environmentId]
  );
  if (!env) {
    throw new Response(JSON.stringify({ error: 'Environment not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const [settings, environmentEntitledSeats, activeDeviceCount, openCase] = await Promise.all([
    getWorkspaceLicensingSettings(env.workspace_id),
    getEnvironmentEntitledSeats(environmentId),
    getEnvironmentSeatConsumptionCount(environmentId),
    queryOne<{ id: string; started_at: string }>(
      `SELECT id, started_at
       FROM license_overage_cases
       WHERE environment_id = $1
         AND resolved_at IS NULL
       ORDER BY started_at DESC
       LIMIT 1`,
      [environmentId]
    ).catch((err) => {
      if (isMissingRelationError(err)) return null;
      throw err;
    }),
  ]);

  // Environments inherit workspace free-tier seats by default, with explicit
  // environment entitlements layered on top.
  const inheritedFreeSeats = settings.free_enabled ? settings.free_seat_limit : 0;
  const entitledSeats = environmentEntitledSeats + inheritedFreeSeats;

  const overageCount = Math.max(0, activeDeviceCount - entitledSeats);
  if (!settings.effective_licensing_enabled) {
    return {
      environment_id: environmentId,
      environment_name: env.name,
      workspace_id: env.workspace_id,
      active_device_count: activeDeviceCount,
      entitled_seats: entitledSeats,
      overage_count: 0,
      open_case_id: null,
      overage_started_at: null,
      overage_age_days: 0,
      overage_phase: 'resolved',
      enrollment_blocked: false,
    };
  }

  let overageAgeDays = 0;
  if (openCase?.started_at) {
    const startedAt = new Date(openCase.started_at).getTime();
    if (!Number.isNaN(startedAt)) {
      const diffMs = Date.now() - startedAt;
      if (diffMs > 0) overageAgeDays = Math.floor(diffMs / 86_400_000);
    }
  }

  const overagePhase = overageCount > 0
    ? getOveragePhaseForAgeDays(overageAgeDays, settings)
    : 'resolved';

  return {
    environment_id: environmentId,
    environment_name: env.name,
    workspace_id: env.workspace_id,
    active_device_count: activeDeviceCount,
    entitled_seats: entitledSeats,
    overage_count: overageCount,
    open_case_id: openCase?.id ?? null,
    overage_started_at: openCase?.started_at ?? null,
    overage_age_days: overageAgeDays,
    overage_phase: overagePhase,
    enrollment_blocked: overageCount > 0 && overageAgeDays >= settings.grace_day_block,
  };
}

export async function getWorkspaceEnvironmentLicensingSnapshots(
  workspaceId: string
): Promise<EnvironmentLicensingSnapshot[]> {
  const environments = await query<{ id: string }>(
    'SELECT id FROM environments WHERE workspace_id = $1 ORDER BY name ASC, created_at ASC',
    [workspaceId]
  );
  return Promise.all(environments.map((env) => getEnvironmentLicensingSnapshot(env.id)));
}

export async function assertEnvironmentEnrollmentAllowed(environmentId: string): Promise<void> {
  if (!isLicensingEnforcementEnabled()) return;
  try {
    const snapshot = await getEnvironmentLicensingSnapshot(environmentId);
    if (!snapshot.enrollment_blocked) return;

    throw new Response(
      JSON.stringify({
        error: 'Enrollment is blocked for this environment due to licence overage.',
        overage_count: snapshot.overage_count,
        entitled_seats: snapshot.entitled_seats,
        active_device_count: snapshot.active_device_count,
        overage_phase: snapshot.overage_phase,
      }),
      {
        status: 402,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err) {
    if (err instanceof Response) throw err;
    console.error('[licensing] Failed to evaluate enrollment eligibility', {
      environment_id: environmentId,
      error: err,
    });
  }
}

export async function syncLicensingWindowExpiries(): Promise<{ platform_grants_expired: number; environment_entitlements_expired: number }> {
  const [platformResult, environmentResult] = await Promise.all([
    execute(
      `UPDATE license_grants
       SET status = 'expired', updated_at = now()
       WHERE status = 'active'
         AND ends_at IS NOT NULL
         AND ends_at <= now()`
    ),
    execute(
      `UPDATE environment_entitlements
       SET status = 'expired', updated_at = now()
       WHERE status = 'active'
         AND ends_at IS NOT NULL
         AND ends_at <= now()`
    ),
  ]);

  return {
    platform_grants_expired: platformResult.rowCount ?? 0,
    environment_entitlements_expired: environmentResult.rowCount ?? 0,
  };
}
