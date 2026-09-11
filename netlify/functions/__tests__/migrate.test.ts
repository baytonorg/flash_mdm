import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync } from 'node:fs';
import path from 'node:path';

const {
  mockConnect,
  mockEnd,
  mockQuery,
} = vi.hoisted(() => ({
  mockConnect: vi.fn(),
  mockEnd: vi.fn(),
  mockQuery: vi.fn(),
}));

vi.mock('pg', () => ({
  default: {
    Client: class MockClient {
      connect = mockConnect;
      end = mockEnd;
      query = mockQuery;
    },
  },
}));

import handler, { MIGRATIONS } from '../migrate.ts';

const originalEnv = { ...process.env };
const historicalMigrationNames = [
  '001_foundation',
  '002_rbac',
  '003_policies',
  '004_devices',
  '005_enrollment',
  '006_events',
  '007_audit',
  '008_workflows',
  '009_geofences',
  '010_licensing',
  '011_certificates',
  '012_apps',
  '013_rate_limits',
  '014_session_impersonation',
  '015_support_session_metadata',
  '016_platform_settings',
  '017_auth_schema_compat',
  '018_policy_assignment_scope',
  '019_workspace_access_scope',
  '020_network_deployments',
  '021_policy_derivatives',
  '022_network_deployments_network_type',
  '023_strip_deployment_fields_from_policy_config',
  '024_device_last_policy_sync_name',
  '025_schema_cleanup',
  '026_device_name',
  '027_policy_overrides_and_locks',
  '028_deployment_jobs',
  '029_app_model_rework',
  '030_default_policy_backfill',
  '031_workspace_default_pubsub_topic',
  '032_signup_links',
  '033_signin_enrollment',
  '034_signup_links_allowed_domains',
  '035_api_keys',
  '036_audit_log_actor_visibility',
  '037_app_scope_config_app_policy',
  '038_audit_log_api_key_actor',
  '039_workflow_scope_environment_enforcement',
  '040_api_keys_optional_expiry',
  '041_two_tier_licensing',
  '042_licensing_hardening',
  '043_licensing_free_tier_notifications',
  '044_licensing_enable_switch',
  '045_billing_notifications',
  '046_workspace_billing_customer_defaults',
  '047_flashagent',
  '048_aer_zero_touch_and_app_feedback',
  '049_app_feedback_unique_null_handling',
  '050_signup_links_purpose',
  '051_align_workspace_scoped_roles',
  '052_signup_links_slug_unique',
  '053_totp_pending_created_at',
  '054_apps_distribution_channel',
  '055_wifi_trusted_ca_certificates',
  '056_magic_links_email_text',
  '057_command_operation_ledger',
] as const;

function migrationRequest(): Request {
  return new Request('http://localhost/api/migrate', {
    method: 'GET',
    headers: { 'x-migration-secret': 'migration-test-secret' },
  });
}

beforeEach(() => {
  process.env = {
    ...originalEnv,
    MIGRATION_SECRET: 'migration-test-secret',
    DATABASE_URL: 'postgresql://flash:test@localhost:5432/flash_test',
    NODE_ENV: 'development',
  };
  mockConnect.mockReset().mockResolvedValue(undefined);
  mockEnd.mockReset().mockResolvedValue(undefined);
  mockQuery.mockReset();
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('migration manifest', () => {
  it('covers every numbered SQL migration exactly once and in order', () => {
    const migrationsDir = path.resolve(process.cwd(), 'netlify/migrations');
    const fileIds = readdirSync(migrationsDir)
      .filter((name) => /^\d{3}_.+\.sql$/.test(name))
      .sort()
      .map((name) => name.slice(0, 3));
    const manifestIds = MIGRATIONS.map(({ name }) => name.slice(0, 3));

    expect(new Set(fileIds).size).toBe(fileIds.length);
    expect(new Set(manifestIds).size).toBe(manifestIds.length);
    expect(manifestIds).toEqual(fileIds);
    expect(manifestIds).toEqual(
      Array.from({ length: manifestIds.length }, (_, index) => String(index + 1).padStart(3, '0'))
    );
    expect(MIGRATIONS.map(({ name }) => name)).toEqual(historicalMigrationNames);
    expect(MIGRATIONS.at(-1)?.name).toBe('057_command_operation_ledger');
  });

  it('applies migration 057 and records it in the same transaction', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({
        rows: MIGRATIONS.slice(0, -1).map(({ name }) => ({ name })),
        rowCount: MIGRATIONS.length - 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const response = await handler(migrationRequest(), {} as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      summary: { total: 57, applied: 1, skipped: 56, errors: 0 },
      results: expect.arrayContaining([
        { name: '057_command_operation_ledger', status: 'applied' },
      ]),
    });
    const statements = mockQuery.mock.calls.map(([sql]) => String(sql).trim());
    expect(statements.at(-4)).toBe('BEGIN');
    expect(statements.at(-3)).toContain('CREATE TABLE command_operations');
    expect(statements.at(-3)).toContain("'command_reconcile',\n  co.environment_id");
    expect(statements.at(-2)).toBe('INSERT INTO _migrations (name) VALUES ($1)');
    expect(statements.at(-1)).toBe('COMMIT');
    expect(mockQuery.mock.calls.at(-2)?.[1]).toEqual(['057_command_operation_ledger']);
    expect(mockEnd).toHaveBeenCalledOnce();
  });

  it('is idempotent when migration 057 is already recorded', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({
        rows: MIGRATIONS.map(({ name }) => ({ name })),
        rowCount: MIGRATIONS.length,
      });

    const response = await handler(migrationRequest(), {} as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      summary: { total: 57, applied: 0, skipped: 57, errors: 0 },
    });
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockEnd).toHaveBeenCalledOnce();
  });

  it('rolls back and does not record 057 when its SQL fails', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({
        rows: MIGRATIONS.slice(0, -1).map(({ name }) => ({ name })),
        rowCount: MIGRATIONS.length - 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockRejectedValueOnce(new Error('simulated migration failure'))
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const response = await handler(migrationRequest(), {} as never);
    const payload = await response.json();

    expect({ status: response.status, payload }).toMatchObject({
      status: 500,
      payload: {
        summary: { total: 57, applied: 0, skipped: 56, errors: 1 },
        results: expect.arrayContaining([
          {
            name: '057_command_operation_ledger',
            status: 'error',
            error: 'simulated migration failure',
          },
        ]),
      },
    });
    const statements = mockQuery.mock.calls.map(([sql]) => String(sql).trim());
    expect(statements.at(-1)).toBe('ROLLBACK');
    expect(statements).not.toContain('INSERT INTO _migrations (name) VALUES ($1)');
  });
});
