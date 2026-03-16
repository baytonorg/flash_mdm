import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockQueryOne, mockQuery } = vi.hoisted(() => ({
  mockQueryOne: vi.fn(),
  mockQuery: vi.fn(),
}));

vi.mock('../db.js', () => ({
  queryOne: mockQueryOne,
  query: mockQuery,
}));

import {
  assertEnvironmentEnrollmentAllowed,
  getEnvironmentLicensingSnapshot,
  getEnvironmentSeatConsumptionCount,
  getOveragePhaseForAgeDays,
  getWorkspaceEnvironmentLicensingSnapshots,
  getWorkspaceLicensingSettings,
} from '../licensing.js';

beforeEach(() => {
  mockQueryOne.mockReset();
  mockQuery.mockReset();
});

describe('licensing helpers', () => {
  it('maps overage phases at grace boundaries', () => {
    const settings = {
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
      billing_method: 'stripe' as const,
      customer_owner_enabled: false,
      grace_day_block: 10,
      grace_day_disable: 30,
      grace_day_wipe: 45,
    };

    expect(getOveragePhaseForAgeDays(0, settings)).toBe('warn');
    expect(getOveragePhaseForAgeDays(10, settings)).toBe('block');
    expect(getOveragePhaseForAgeDays(30, settings)).toBe('disable');
    expect(getOveragePhaseForAgeDays(45, settings)).toBe('wipe');
  });

  it('falls back to safe default grace settings when stored ordering is invalid', async () => {
    mockQueryOne.mockResolvedValueOnce({
      free_enabled: true,
      free_seat_limit: 10,
      billing_method: 'stripe',
      customer_owner_enabled: false,
      grace_day_block: 30,
      grace_day_disable: 10,
      grace_day_wipe: 5,
    });

    const settings = await getWorkspaceLicensingSettings('ws_1');

    expect(settings.grace_day_block).toBe(10);
    expect(settings.grace_day_disable).toBe(30);
    expect(settings.grace_day_wipe).toBe(45);
  });

  it('counts ACTIVE, DISABLED and PROVISIONING devices for seat consumption', async () => {
    mockQueryOne.mockResolvedValueOnce({ count: '7' });

    const count = await getEnvironmentSeatConsumptionCount('env_1');

    expect(count).toBe(7);
    expect(mockQueryOne).toHaveBeenCalledWith(
      expect.stringContaining("COALESCE(state, 'ACTIVE') IN ('ACTIVE', 'DISABLED', 'PROVISIONING')"),
      ['env_1']
    );
  });

  it('returns licensing snapshots for all workspace environments', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 'env_1' }, { id: 'env_2' }]);

    mockQueryOne.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.includes('FROM environments WHERE id = $1')) {
        if (params[0] === 'env_1') return { workspace_id: 'ws_1', name: 'Environment One' };
        if (params[0] === 'env_2') return { workspace_id: 'ws_1', name: 'Environment Two' };
        return null;
      }
      if (sql.includes('FROM workspace_licensing_settings')) {
        return {
          free_enabled: true,
          free_seat_limit: 10,
          billing_method: 'stripe',
          customer_owner_enabled: false,
          grace_day_block: 10,
          grace_day_disable: 30,
          grace_day_wipe: 45,
        };
      }
      if (sql.includes('FROM environment_entitlements')) {
        return { seats: params[0] === 'env_1' ? '5' : '3' };
      }
      if (sql.includes('FROM devices')) {
        return { count: params[0] === 'env_1' ? '4' : '3' };
      }
      if (sql.includes('FROM license_overage_cases')) {
        return null;
      }
      return null;
    });

    const snapshots = await getWorkspaceEnvironmentLicensingSnapshots('ws_1');

    expect(snapshots).toHaveLength(2);
    expect(snapshots[0].environment_id).toBe('env_1');
    expect(snapshots[0].environment_name).toBe('Environment One');
    expect(snapshots[0].overage_count).toBe(0);
    expect(snapshots[1].environment_id).toBe('env_2');
    expect(snapshots[1].environment_name).toBe('Environment Two');
    expect(snapshots[1].entitled_seats).toBe(13);
  });

  it('allows enrollment when enforcement is disabled', async () => {
    const original = process.env.LICENSING_ENFORCEMENT_ENABLED;
    process.env.LICENSING_ENFORCEMENT_ENABLED = 'false';

    await expect(assertEnvironmentEnrollmentAllowed('env_1')).resolves.toBeUndefined();
    expect(mockQueryOne).not.toHaveBeenCalled();

    if (original === undefined) {
      delete process.env.LICENSING_ENFORCEMENT_ENABLED;
    } else {
      process.env.LICENSING_ENFORCEMENT_ENABLED = original;
    }
  });

  it('blocks enrollment with 402 when environment is over entitlement during block phase', async () => {
    const original = process.env.LICENSING_ENFORCEMENT_ENABLED;
    process.env.LICENSING_ENFORCEMENT_ENABLED = 'true';

    mockQueryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM environments WHERE id = $1')) {
        return { workspace_id: 'ws_1', name: 'Environment One' };
      }
      if (sql.includes('FROM workspace_licensing_settings')) {
        return {
          free_enabled: true,
          free_seat_limit: 10,
          billing_method: 'stripe',
          customer_owner_enabled: false,
          grace_day_block: 10,
          grace_day_disable: 30,
          grace_day_wipe: 45,
        };
      }
      if (sql.includes('FROM environment_entitlements')) {
        return { seats: '1' };
      }
      if (sql.includes('FROM devices')) {
        return { count: '14' };
      }
      if (sql.includes('FROM license_overage_cases')) {
        return {
          id: 'case_1',
          started_at: new Date(Date.now() - 15 * 86_400_000).toISOString(),
        };
      }
      return null;
    });

    try {
      await assertEnvironmentEnrollmentAllowed('env_1');
      throw new Error('Expected enrollment check to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(Response);
      const response = err as Response;
      expect(response.status).toBe(402);
      await expect(response.json()).resolves.toMatchObject({
        error: expect.stringContaining('Enrollment is blocked'),
        overage_phase: 'block',
      });
    }

    if (original === undefined) {
      delete process.env.LICENSING_ENFORCEMENT_ENABLED;
    } else {
      process.env.LICENSING_ENFORCEMENT_ENABLED = original;
    }
  });

  it('skips enrollment blocking when workspace licensing is disabled', async () => {
    const original = process.env.LICENSING_ENFORCEMENT_ENABLED;
    process.env.LICENSING_ENFORCEMENT_ENABLED = 'true';

    mockQueryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM environments WHERE id = $1')) {
        return { workspace_id: 'ws_1', name: 'Environment One' };
      }
      if (sql.includes('FROM workspace_licensing_settings')) {
        return {
          licensing_enabled: false,
          inherit_platform_free_tier: true,
          free_enabled: true,
          free_seat_limit: 10,
          billing_method: 'stripe',
          customer_owner_enabled: false,
          grace_day_block: 10,
          grace_day_disable: 30,
          grace_day_wipe: 45,
        };
      }
      if (sql.includes('FROM environment_entitlements')) {
        return { seats: '1' };
      }
      if (sql.includes('FROM devices')) {
        return { count: '4' };
      }
      if (sql.includes('FROM license_overage_cases')) {
        return {
          id: 'case_1',
          started_at: new Date(Date.now() - 30 * 86_400_000).toISOString(),
        };
      }
      return null;
    });

    await expect(assertEnvironmentEnrollmentAllowed('env_1')).resolves.toBeUndefined();

    if (original === undefined) {
      delete process.env.LICENSING_ENFORCEMENT_ENABLED;
    } else {
      process.env.LICENSING_ENFORCEMENT_ENABLED = original;
    }
  });

  it('allows enrollment during warn phase when not yet blocked', async () => {
    const original = process.env.LICENSING_ENFORCEMENT_ENABLED;
    process.env.LICENSING_ENFORCEMENT_ENABLED = 'true';

    mockQueryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM environments WHERE id = $1')) {
        return { workspace_id: 'ws_1', name: 'Environment One' };
      }
      if (sql.includes('FROM workspace_licensing_settings')) {
        return {
          free_enabled: true,
          free_seat_limit: 10,
          billing_method: 'stripe',
          customer_owner_enabled: false,
          grace_day_block: 10,
          grace_day_disable: 30,
          grace_day_wipe: 45,
        };
      }
      if (sql.includes('FROM environment_entitlements')) {
        return { seats: '1' };
      }
      if (sql.includes('FROM devices')) {
        return { count: '12' };
      }
      if (sql.includes('FROM license_overage_cases')) {
        return {
          id: 'case_warn',
          started_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
        };
      }
      return null;
    });

    await expect(assertEnvironmentEnrollmentAllowed('env_1')).resolves.toBeUndefined();

    if (original === undefined) {
      delete process.env.LICENSING_ENFORCEMENT_ENABLED;
    } else {
      process.env.LICENSING_ENFORCEMENT_ENABLED = original;
    }
  });

  it('fails open when enrollment gating hits an infrastructure error', async () => {
    const original = process.env.LICENSING_ENFORCEMENT_ENABLED;
    process.env.LICENSING_ENFORCEMENT_ENABLED = 'true';
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mockQueryOne.mockRejectedValueOnce(Object.assign(new Error('relation missing'), { code: '42P01' }));

    await expect(assertEnvironmentEnrollmentAllowed('env_1')).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      '[licensing] Failed to evaluate enrollment eligibility',
      expect.objectContaining({ environment_id: 'env_1' })
    );

    errorSpy.mockRestore();
    if (original === undefined) {
      delete process.env.LICENSING_ENFORCEMENT_ENABLED;
    } else {
      process.env.LICENSING_ENFORCEMENT_ENABLED = original;
    }
  });

  it('returns defaults when workspace licensing table is missing', async () => {
    mockQueryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM workspace_licensing_settings')) {
        throw Object.assign(new Error('workspace_licensing_settings missing'), { code: '42P01' });
      }
      return null;
    });

    const settings = await getWorkspaceLicensingSettings('ws_1');

    expect(settings).toMatchObject({
      platform_licensing_enabled: true,
      workspace_licensing_enabled: true,
      effective_licensing_enabled: true,
      free_enabled: true,
      free_seat_limit: 10,
    });
  });

  it('treats missing entitlement/overage tables as zero-state during snapshot reads', async () => {
    mockQueryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM environments WHERE id = $1')) {
        return { workspace_id: 'ws_1', name: 'Environment One' };
      }
      if (sql.includes('FROM workspace_licensing_settings')) {
        return {
          free_enabled: true,
          free_seat_limit: 10,
          billing_method: 'stripe',
          customer_owner_enabled: false,
          grace_day_block: 10,
          grace_day_disable: 30,
          grace_day_wipe: 45,
        };
      }
      if (sql.includes('FROM environment_entitlements')) {
        throw Object.assign(new Error('environment_entitlements missing'), { code: '42P01' });
      }
      if (sql.includes('FROM devices')) {
        return { count: '3' };
      }
      if (sql.includes('FROM license_overage_cases')) {
        throw Object.assign(new Error('license_overage_cases missing'), { code: '42P01' });
      }
      return null;
    });

    const snapshot = await getEnvironmentLicensingSnapshot('env_1');
    expect(snapshot.entitled_seats).toBe(10);
    expect(snapshot.open_case_id).toBeNull();
    expect(snapshot.overage_phase).toBe('resolved');
    expect(snapshot.enrollment_blocked).toBe(false);
  });
});
