import { execute, queryOne } from './db.js';
import { isMissingRelationError } from './db-errors.js';

export interface PlatformSettings {
  invite_only_registration: boolean;
  licensing_enabled: boolean;
  default_free_enabled: boolean;
  default_free_seat_limit: number;
  assistant_enabled: boolean;
}

const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = {
  invite_only_registration: false,
  licensing_enabled: true,
  default_free_enabled: true,
  default_free_seat_limit: 10,
  assistant_enabled: false,
};

function isMissingColumnError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === '42703'
  );
}

export async function getPlatformSettings(): Promise<PlatformSettings> {
  try {
    const row = await queryOne<{
      invite_only_registration: boolean;
      licensing_enabled: boolean;
      default_free_enabled: boolean;
      default_free_seat_limit: number;
      assistant_enabled: boolean;
    }>(
      `SELECT invite_only_registration, licensing_enabled, default_free_enabled, default_free_seat_limit, assistant_enabled
       FROM platform_settings
       WHERE id = 1`,
      []
    );

    return {
      invite_only_registration: row?.invite_only_registration ?? DEFAULT_PLATFORM_SETTINGS.invite_only_registration,
      licensing_enabled: row?.licensing_enabled ?? DEFAULT_PLATFORM_SETTINGS.licensing_enabled,
      default_free_enabled: row?.default_free_enabled ?? DEFAULT_PLATFORM_SETTINGS.default_free_enabled,
      default_free_seat_limit: row?.default_free_seat_limit ?? DEFAULT_PLATFORM_SETTINGS.default_free_seat_limit,
      assistant_enabled: row?.assistant_enabled ?? DEFAULT_PLATFORM_SETTINGS.assistant_enabled,
    };
  } catch (err) {
    if (isMissingColumnError(err)) {
      try {
        const legacyWithFreeTier = await queryOne<{
          invite_only_registration: boolean;
          default_free_enabled: boolean;
          default_free_seat_limit: number;
        }>(
          `SELECT invite_only_registration, default_free_enabled, default_free_seat_limit
           FROM platform_settings
           WHERE id = 1`,
          []
        );
        return {
          invite_only_registration: legacyWithFreeTier?.invite_only_registration ?? DEFAULT_PLATFORM_SETTINGS.invite_only_registration,
          licensing_enabled: DEFAULT_PLATFORM_SETTINGS.licensing_enabled,
          default_free_enabled: legacyWithFreeTier?.default_free_enabled ?? DEFAULT_PLATFORM_SETTINGS.default_free_enabled,
          default_free_seat_limit: legacyWithFreeTier?.default_free_seat_limit ?? DEFAULT_PLATFORM_SETTINGS.default_free_seat_limit,
          assistant_enabled: DEFAULT_PLATFORM_SETTINGS.assistant_enabled,
        };
      } catch (legacyErr) {
        if (!isMissingColumnError(legacyErr)) throw legacyErr;
        const legacy = await queryOne<{ invite_only_registration: boolean }>(
          `SELECT invite_only_registration
           FROM platform_settings
           WHERE id = 1`,
          []
        );
        return {
          invite_only_registration: legacy?.invite_only_registration ?? DEFAULT_PLATFORM_SETTINGS.invite_only_registration,
          licensing_enabled: DEFAULT_PLATFORM_SETTINGS.licensing_enabled,
          default_free_enabled: DEFAULT_PLATFORM_SETTINGS.default_free_enabled,
          default_free_seat_limit: DEFAULT_PLATFORM_SETTINGS.default_free_seat_limit,
          assistant_enabled: DEFAULT_PLATFORM_SETTINGS.assistant_enabled,
        };
      }
    }

    // During rollout, default open registration if migration has not run yet.
    if (isMissingRelationError(err)) return { ...DEFAULT_PLATFORM_SETTINGS };
    throw err;
  }
}

export async function setPlatformSettings(
  updates: Partial<PlatformSettings>,
  updatedByUserId?: string,
): Promise<void> {
  const current = await getPlatformSettings();
  const inviteOnly = updates.invite_only_registration ?? current.invite_only_registration;
  const licensingEnabled = updates.licensing_enabled ?? current.licensing_enabled;
  const defaultFreeEnabled = updates.default_free_enabled ?? current.default_free_enabled;
  const defaultFreeSeatLimit = updates.default_free_seat_limit ?? current.default_free_seat_limit;
  const assistantEnabled = updates.assistant_enabled ?? current.assistant_enabled;

  try {
    await execute(
      `INSERT INTO platform_settings
         (id, invite_only_registration, licensing_enabled, default_free_enabled, default_free_seat_limit, assistant_enabled, updated_by, updated_at)
       VALUES (1, $1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (id)
       DO UPDATE SET invite_only_registration = EXCLUDED.invite_only_registration,
                     licensing_enabled = EXCLUDED.licensing_enabled,
                     default_free_enabled = EXCLUDED.default_free_enabled,
                     default_free_seat_limit = EXCLUDED.default_free_seat_limit,
                     assistant_enabled = EXCLUDED.assistant_enabled,
                     updated_by = EXCLUDED.updated_by,
                     updated_at = now()`,
      [inviteOnly, licensingEnabled, defaultFreeEnabled, defaultFreeSeatLimit, assistantEnabled, updatedByUserId ?? null]
    );
  } catch (err) {
    if (!isMissingColumnError(err)) throw err;
    try {
      await execute(
        `INSERT INTO platform_settings
           (id, invite_only_registration, default_free_enabled, default_free_seat_limit, updated_by, updated_at)
         VALUES (1, $1, $2, $3, $4, now())
         ON CONFLICT (id)
         DO UPDATE SET invite_only_registration = EXCLUDED.invite_only_registration,
                       default_free_enabled = EXCLUDED.default_free_enabled,
                       default_free_seat_limit = EXCLUDED.default_free_seat_limit,
                       updated_by = EXCLUDED.updated_by,
                       updated_at = now()`,
        [inviteOnly, defaultFreeEnabled, defaultFreeSeatLimit, updatedByUserId ?? null]
      );
    } catch (legacyErr) {
      if (!isMissingColumnError(legacyErr)) throw legacyErr;
      await execute(
        `INSERT INTO platform_settings (id, invite_only_registration, updated_by, updated_at)
         VALUES (1, $1, $2, now())
         ON CONFLICT (id)
         DO UPDATE SET invite_only_registration = EXCLUDED.invite_only_registration,
                       updated_by = EXCLUDED.updated_by,
                       updated_at = now()`,
        [inviteOnly, updatedByUserId ?? null]
      );
    }
  }
}

export async function setInviteOnlyRegistration(
  enabled: boolean,
  updatedByUserId?: string,
): Promise<void> {
  await setPlatformSettings({ invite_only_registration: enabled }, updatedByUserId);
}
