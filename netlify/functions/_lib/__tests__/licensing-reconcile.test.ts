import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockExecute,
  mockQuery,
  mockQueryOne,
  mockGetEnvironmentLicensingSnapshot,
  mockGetOveragePhaseForAgeDays,
  mockIsPlatformLicensingEnabled,
  mockGetWorkspaceLicensingSettings,
  mockSyncLicensingWindowExpiries,
  mockLogAudit,
  mockSendEmail,
  mockBuildNearExpiryEmail,
  mockGetWorkspaceScopeNames,
  mockQueueAndSendBillingEmail,
} = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockQuery: vi.fn(),
  mockQueryOne: vi.fn(),
  mockGetEnvironmentLicensingSnapshot: vi.fn(),
  mockGetOveragePhaseForAgeDays: vi.fn(),
  mockIsPlatformLicensingEnabled: vi.fn(),
  mockGetWorkspaceLicensingSettings: vi.fn(),
  mockSyncLicensingWindowExpiries: vi.fn(),
  mockLogAudit: vi.fn(),
  mockSendEmail: vi.fn(),
  mockBuildNearExpiryEmail: vi.fn(),
  mockGetWorkspaceScopeNames: vi.fn(),
  mockQueueAndSendBillingEmail: vi.fn(),
}));

vi.mock('../db.js', () => ({
  execute: mockExecute,
  query: mockQuery,
  queryOne: mockQueryOne,
}));

vi.mock('../licensing.js', () => ({
  getEnvironmentLicensingSnapshot: mockGetEnvironmentLicensingSnapshot,
  getOveragePhaseForAgeDays: mockGetOveragePhaseForAgeDays,
  isPlatformLicensingEnabled: mockIsPlatformLicensingEnabled,
  getWorkspaceLicensingSettings: mockGetWorkspaceLicensingSettings,
  syncLicensingWindowExpiries: mockSyncLicensingWindowExpiries,
}));

vi.mock('../audit.js', () => ({
  logAudit: mockLogAudit,
}));

vi.mock('../resend.js', () => ({
  sendEmail: mockSendEmail,
}));

vi.mock('../billing-notifications.js', () => ({
  buildNearExpiryEmail: mockBuildNearExpiryEmail,
  getWorkspaceScopeNames: mockGetWorkspaceScopeNames,
  queueAndSendBillingEmail: mockQueueAndSendBillingEmail,
}));

import { runLicensingReconcile } from '../licensing-reconcile.js';

beforeEach(() => {
  mockExecute.mockReset();
  mockQuery.mockReset();
  mockQueryOne.mockReset();
  mockGetEnvironmentLicensingSnapshot.mockReset();
  mockGetOveragePhaseForAgeDays.mockReset();
  mockIsPlatformLicensingEnabled.mockReset();
  mockGetWorkspaceLicensingSettings.mockReset();
  mockSyncLicensingWindowExpiries.mockReset();
  mockLogAudit.mockReset();
  mockSendEmail.mockReset();
  mockBuildNearExpiryEmail.mockReset();
  mockGetWorkspaceScopeNames.mockReset();
  mockQueueAndSendBillingEmail.mockReset();
  mockQuery.mockResolvedValue([]);
  mockIsPlatformLicensingEnabled.mockResolvedValue(true);
  mockSyncLicensingWindowExpiries.mockResolvedValue({
    platform_grants_expired: 0,
    environment_entitlements_expired: 0,
  });
  mockSendEmail.mockResolvedValue(undefined);
  mockGetWorkspaceScopeNames.mockResolvedValue({ workspaceName: 'Acme', environmentName: 'Testing' });
  mockBuildNearExpiryEmail.mockReturnValue({ subject: 'Expiry', html: '<p>Expiry</p>' });
  mockQueueAndSendBillingEmail.mockResolvedValue({ queued: true, sent: true, skipped: false });
});

describe('runLicensingReconcile', () => {
  it('skips processing when advisory lock is already held', async () => {
    mockQueryOne.mockResolvedValueOnce({ locked: false });

    const stats = await runLicensingReconcile({ dryRun: true });

    expect(stats.lock_acquired).toBe(false);
    expect(stats.skipped_due_to_lock).toBe(true);
    expect(stats.environments_checked).toBe(0);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('resolves open overage cases and exits early when platform licensing is disabled', async () => {
    mockQueryOne.mockResolvedValueOnce({ locked: true });
    mockIsPlatformLicensingEnabled.mockResolvedValueOnce(false);

    const stats = await runLicensingReconcile({ dryRun: false });

    expect(stats.lock_acquired).toBe(true);
    expect(stats.environments_checked).toBe(0);
    expect(
      mockExecute.mock.calls.some(([sql]) => typeof sql === 'string' && sql.includes('UPDATE license_overage_cases'))
    ).toBe(true);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('does not create cases or queue commands while dry-run is enabled', async () => {
    mockQueryOne.mockResolvedValueOnce({ locked: true });

    mockQuery
      .mockResolvedValueOnce([{ id: 'env_1', workspace_id: 'ws_1' }])
      .mockResolvedValueOnce([]);

    mockGetEnvironmentLicensingSnapshot.mockResolvedValue({
      environment_id: 'env_1',
      workspace_id: 'ws_1',
      active_device_count: 15,
      entitled_seats: 10,
      overage_count: 5,
      open_case_id: null,
      overage_started_at: null,
      overage_age_days: 0,
      overage_phase: 'warn',
      enrollment_blocked: false,
    });
    mockGetWorkspaceLicensingSettings.mockResolvedValue({
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
    });
    mockGetOveragePhaseForAgeDays.mockReturnValue('disable');

    const stats = await runLicensingReconcile({ dryRun: true });

    expect(stats.dry_run).toBe(true);
    expect(stats.overage_environments).toBe(1);
    expect(stats.cases_created).toBe(0);
    expect(stats.disable_actions_queued).toBe(0);
    expect(stats.wipe_actions_queued).toBe(0);
    expect(
      mockExecute.mock.calls.some(([sql]) => typeof sql === 'string' && sql.includes('pg_advisory_unlock'))
    ).toBe(true);
    expect(
      mockExecute.mock.calls.some(([sql]) => typeof sql === 'string' && sql.includes('license_overage_cases'))
    ).toBe(false);
    expect(
      mockExecute.mock.calls.some(([sql]) => typeof sql === 'string' && sql.includes('license_enforcement_actions'))
    ).toBe(false);
  });

  it('creates a case and queues disable commands in live mode when phase is disable', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ locked: true })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'case_live_1', started_at: '2026-01-01T00:00:00.000Z' });

    mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM environments')) {
        const offset = Number((params as unknown[] | undefined)?.[1] ?? 0);
        return offset === 0 ? [{ id: 'env_1', workspace_id: 'ws_1' }] : [];
      }
      if (sql.includes('FROM devices') && sql.includes("state = 'ACTIVE'")) {
        return [{ id: 'dev_2' }, { id: 'dev_1' }];
      }
      if (sql.includes('FROM workspace_memberships')) {
        return [];
      }
      return [];
    });

    mockGetEnvironmentLicensingSnapshot.mockResolvedValue({
      environment_id: 'env_1',
      workspace_id: 'ws_1',
      active_device_count: 12,
      entitled_seats: 10,
      overage_count: 2,
      open_case_id: null,
      overage_started_at: '2026-01-01T00:00:00.000Z',
      overage_age_days: 35,
      overage_phase: 'disable',
      enrollment_blocked: true,
    });
    mockGetWorkspaceLicensingSettings.mockResolvedValue({
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
    });
    mockGetOveragePhaseForAgeDays.mockReturnValue('disable');

    mockExecute.mockResolvedValue({ rowCount: 1 });

    const stats = await runLicensingReconcile({ dryRun: false });

    expect(stats.dry_run).toBe(false);
    expect(stats.cases_created).toBe(1);
    expect(stats.disable_actions_queued).toBe(2);
    expect(stats.wipe_actions_queued).toBe(0);
    expect(
      mockQueryOne.mock.calls.some(([sql]) =>
        typeof sql === 'string'
        && sql.includes('INSERT INTO license_overage_cases')
        && sql.includes('RETURNING id, started_at')
      )
    ).toBe(true);
    expect(
      mockExecute.mock.calls.some(
        ([sql]) => typeof sql === 'string' && sql.includes("action, status, reason, executed_at") && sql.includes("'disable'")
      )
    ).toBe(true);
    const queuedDisablePayloads = mockExecute.mock.calls
      .filter(([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO job_queue'))
      .map(([, params]) => String((params as unknown[] | undefined)?.[1] ?? ''));
    expect(queuedDisablePayloads.some((payload) => payload.includes('"device_id":"dev_1"') && payload.includes('"command_type":"DISABLE"'))).toBe(true);
    expect(queuedDisablePayloads.some((payload) => payload.includes('"device_id":"dev_2"') && payload.includes('"command_type":"DISABLE"'))).toBe(true);
  });

  it('updates existing case and queues wipe commands when phase is wipe', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ locked: true })
      .mockResolvedValueOnce({ id: 'case_live_2', started_at: '2026-01-01T00:00:00.000Z', overage_peak: 3 });

    mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM environments')) {
        const offset = Number((params as unknown[] | undefined)?.[1] ?? 0);
        return offset === 0 ? [{ id: 'env_1', workspace_id: 'ws_1' }] : [];
      }
      if (sql.includes('FROM devices') && sql.includes("state = 'ACTIVE'")) {
        return [{ id: 'dev_1' }];
      }
      if (sql.includes('FROM license_enforcement_actions lea')) {
        return [{ device_id: 'dev_1' }];
      }
      if (sql.includes('FROM workspace_memberships')) {
        return [];
      }
      return [];
    });

    mockGetEnvironmentLicensingSnapshot.mockResolvedValue({
      environment_id: 'env_1',
      workspace_id: 'ws_1',
      active_device_count: 11,
      entitled_seats: 10,
      overage_count: 1,
      open_case_id: 'case_live_2',
      overage_started_at: '2026-01-01T00:00:00.000Z',
      overage_age_days: 60,
      overage_phase: 'wipe',
      enrollment_blocked: true,
    });
    mockGetWorkspaceLicensingSettings.mockResolvedValue({
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
    });
    mockGetOveragePhaseForAgeDays.mockReturnValue('wipe');

    mockExecute.mockResolvedValue({ rowCount: 1 });

    const stats = await runLicensingReconcile({ dryRun: false });

    expect(stats.cases_created).toBe(0);
    expect(stats.disable_actions_queued).toBe(1);
    expect(stats.wipe_actions_queued).toBe(1);
    expect(
      mockExecute.mock.calls.some(([sql]) => typeof sql === 'string' && sql.includes('UPDATE license_overage_cases') && sql.includes('overage_peak'))
    ).toBe(true);
    expect(
      mockExecute.mock.calls.some(([sql, params]) =>
        typeof sql === 'string'
        && sql.includes('INSERT INTO job_queue')
        && String((params as unknown[] | undefined)?.[1] ?? '').includes('"command_type":"WIPE"')
      )
    ).toBe(true);
  });

  it('queues and sends overage milestone and phase notification emails', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-01-11T00:00:00.000Z'));

    mockQueryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) return { locked: true };
      if (sql.includes('FROM license_overage_cases') && sql.includes('ORDER BY started_at DESC')) return null;
      if (sql.includes('FROM license_overage_cases') && sql.includes('WHERE id = $1')) {
        return { id: 'case_notify_1', started_at: '2026-01-01T00:00:00.000Z' };
      }
      if (sql.includes('FROM workspaces')) return { name: 'Acme <script>alert(1)</script> & Co' };
      if (sql.includes('FROM environments')) return { name: 'Prod <b>Fleet</b> "A"' };
      return null;
    });

    mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM environments')) {
        const offset = Number((params as unknown[] | undefined)?.[1] ?? 0);
        return offset === 0 ? [{ id: 'env_1', workspace_id: 'ws_1' }] : [];
      }
      if (sql.includes('FROM workspace_memberships')) {
        return [{ email: 'owner@example.com' }];
      }
      return [];
    });

    mockGetEnvironmentLicensingSnapshot.mockResolvedValue({
      environment_id: 'env_1',
      workspace_id: 'ws_1',
      active_device_count: 15,
      entitled_seats: 10,
      overage_count: 5,
      open_case_id: null,
      overage_started_at: '2026-01-01T00:00:00.000Z',
      overage_age_days: 10,
      overage_phase: 'block',
      enrollment_blocked: true,
    });
    mockGetWorkspaceLicensingSettings.mockResolvedValue({
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
    });
    mockGetOveragePhaseForAgeDays.mockReturnValue('block');
    mockExecute.mockResolvedValue({ rowCount: 1 });

    const stats = await runLicensingReconcile({ dryRun: false });
    nowSpy.mockRestore();

    expect(stats.notifications_queued).toBe(3);
    expect(stats.notifications_sent).toBe(3);

    const subjects = mockSendEmail.mock.calls.map(([payload]) => payload.subject as string);
    expect(subjects.some((subject) => subject.includes('Overage day 1'))).toBe(true);
    expect(subjects.some((subject) => subject.includes('Overage day 7'))).toBe(true);
    expect(subjects.some((subject) => subject.includes('Enrollment blocked'))).toBe(true);
    const htmlPayloads = mockSendEmail.mock.calls.map(([payload]) => (payload as { html?: string }).html ?? '');
    expect(htmlPayloads.some((html) => html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'))).toBe(true);
    expect(htmlPayloads.some((html) => html.includes('&lt;b&gt;Fleet&lt;/b&gt;'))).toBe(true);
    expect(htmlPayloads.some((html) => html.includes('&quot;A&quot;'))).toBe(true);
    expect(htmlPayloads.some((html) => html.includes('<script>alert(1)</script>'))).toBe(false);
    expect(htmlPayloads.some((html) => html.includes('<b>Fleet</b>'))).toBe(false);

    expect(
      mockExecute.mock.calls.some(([sql]) => typeof sql === 'string' && sql.includes("SET status = 'sent'"))
    ).toBe(true);
    expect(
      mockExecute.mock.calls.some(([sql]) => typeof sql === 'string' && sql.includes("SET status = 'failed'"))
    ).toBe(false);
    expect(
      mockLogAudit.mock.calls.some(
        ([entry]) => typeof entry === 'object' && entry !== null && (entry as { action?: string }).action === 'license.overage.notification.sent'
      )
    ).toBe(true);
  });

  it('resolves overage cases, queues re-enable commands, and records failed notification sends', async () => {
    mockQueryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) return { locked: true };
      if (sql.includes('FROM workspaces')) return { name: 'Acme' };
      if (sql.includes('FROM environments')) return { name: 'Prod' };
      return null;
    });

    mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM environments')) {
        const offset = Number((params as unknown[] | undefined)?.[1] ?? 0);
        return offset === 0 ? [{ id: 'env_1', workspace_id: 'ws_1' }] : [];
      }
      if (sql.includes('FROM workspace_memberships')) {
        return [{ email: 'owner@example.com' }];
      }
      if (sql.includes('FROM license_enforcement_actions lea')) {
        return [{ device_id: 'dev_1' }, { device_id: 'dev_2' }];
      }
      return [];
    });

    mockGetEnvironmentLicensingSnapshot.mockResolvedValue({
      environment_id: 'env_1',
      workspace_id: 'ws_1',
      active_device_count: 8,
      entitled_seats: 10,
      overage_count: 0,
      open_case_id: 'case_resolve_1',
      overage_started_at: '2026-01-01T00:00:00.000Z',
      overage_age_days: 12,
      overage_phase: 'block',
      enrollment_blocked: true,
    });
    mockGetWorkspaceLicensingSettings.mockResolvedValue({
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
    });
    mockSendEmail.mockRejectedValue(new Error('smtp unavailable'));
    mockExecute.mockResolvedValue({ rowCount: 1 });

    const stats = await runLicensingReconcile({ dryRun: false });

    expect(stats.cases_resolved).toBe(1);
    expect(stats.enable_actions_queued).toBe(2);
    expect(stats.notifications_queued).toBe(1);
    expect(stats.notifications_sent).toBe(0);

    expect(
      mockExecute.mock.calls.some(([sql]) =>
        typeof sql === 'string'
        && sql.includes('UPDATE license_overage_cases')
        && sql.includes("phase = 'resolved'")
      )
    ).toBe(true);
    expect(
      mockExecute.mock.calls.some(([sql]) =>
        typeof sql === 'string'
        && sql.includes('INSERT INTO license_enforcement_actions')
        && sql.includes("'enable'")
      )
    ).toBe(true);
    expect(
      mockExecute.mock.calls.some(([sql, params]) =>
        typeof sql === 'string'
        && sql.includes('INSERT INTO job_queue')
        && String((params as unknown[] | undefined)?.[1] ?? '').includes('"command_type":"ENABLE"')
      )
    ).toBe(true);
    expect(
      mockExecute.mock.calls.some(([sql]) =>
        typeof sql === 'string'
        && sql.includes('UPDATE license_overage_notifications')
        && sql.includes("SET status = 'failed'")
      )
    ).toBe(true);
    expect(
      mockLogAudit.mock.calls.some(
        ([entry]) => typeof entry === 'object' && entry !== null && (entry as { action?: string }).action === 'license.overage.notification.failed'
      )
    ).toBe(true);
  });

  it('queues near-expiry billing notifications for platform and environment entitlements', async () => {
    mockQueryOne.mockResolvedValueOnce({ locked: true });
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM license_grants lg')) {
        return [{
          id: 'grant_1',
          workspace_id: 'ws_1',
          seat_count: 10,
          ends_at: '2026-03-31T00:00:00.000Z',
          days_remaining: 30,
        }];
      }
      if (sql.includes('FROM environment_entitlements ee')) {
        return [{
          id: 'ent_1',
          workspace_id: 'ws_1',
          environment_id: 'env_1',
          seat_count: 5,
          ends_at: '2026-03-08T00:00:00.000Z',
          days_remaining: 7,
        }];
      }
      if (sql.includes('FROM environments')) {
        return [];
      }
      return [];
    });

    const stats = await runLicensingReconcile({ dryRun: false });

    expect(stats.notifications_queued).toBe(2);
    expect(stats.notifications_sent).toBe(2);
    expect(mockQueueAndSendBillingEmail).toHaveBeenCalledTimes(2);
    expect(mockQueueAndSendBillingEmail).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws_1',
      notificationType: 'platform_near_expiry',
    }));
    expect(mockQueueAndSendBillingEmail).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws_1',
      environmentId: 'env_1',
      notificationType: 'environment_near_expiry',
    }));
  });
});
