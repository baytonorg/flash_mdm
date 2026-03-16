import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Building2, Users, Smartphone, Globe, Search, ChevronRight,
  Ban, CheckCircle, Crown, UserCheck, Trash2, Loader2, AlertTriangle,
  TrendingUp, Plus, Mail,
} from 'lucide-react';
import { apiClient } from '@/api/client';
import type { LicenseStatusResponse } from '@/api/queries/licenses';
import { parseMajorInputToMinorUnits } from '@/utils/currency';
import { formatDate } from '@/utils/format';
import { DURATION_MONTH_OPTIONS, normalizeBillingDurationMonths } from '@/constants/billing';
import type { WorkspaceLicenseSettingsResponse } from '@/types/licensing';
import UserAccessAssignmentsModal from '@/components/users/UserAccessAssignmentsModal';
import LivePageIndicator from '@/components/common/LivePageIndicator';

// --- Interfaces ---

interface WorkspaceListItem {
  id: string;
  name: string;
  created_at: string;
  device_count: number;
  user_count: number;
  plan_name: string | null;
  license_status: string | null;
}

interface WorkspaceDetail {
  workspace: {
    id: string;
    name: string;
    created_at: string;
    stripe_customer_id: string | null;
    disabled: boolean;
  };
  environments: Array<{
    id: string;
    name: string;
    enterprise_name: string | null;
    created_at: string;
  }>;
  users: Array<{
    id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    role: string;
    is_superadmin: boolean;
  }>;
  support_sessions: Array<{
    id: string;
    user_id: string;
    target_email: string | null;
    impersonated_by: string | null;
    by_email: string | null;
    impersonation_mode: string | null;
    support_reason: string | null;
    support_ticket_ref: string | null;
    customer_notice_acknowledged_at: string | null;
    created_at: string;
    expires_at: string;
    active: boolean;
  }>;
  support_audit: Array<{
    id: string;
    action: string;
    created_at: string;
    ip_address: string | null;
    details: Record<string, unknown>;
    actor_email: string | null;
  }>;
  license: {
    id: string;
    plan_id: string;
    status: string;
    plan_name: string;
    max_devices: number;
    current_period_end: string | null;
    stripe_subscription_id: string | null;
  } | null;
}

interface PlatformStats {
  total_workspaces: number;
  total_environments: number;
  total_devices: number;
  total_users: number;
  devices_by_plan: Array<{ plan_name: string; device_count: number }>;
  recent_signups: Array<{ date: string; count: number }>;
  function_logs?: {
    pubsub_webhook?: {
      events: Array<{
        environment_id: string;
        message_id: string;
        notification_type: string;
        device_amapi_name: string | null;
        status: string;
        error: string | null;
        created_at: string;
        processed_at: string | null;
        raw_preview: {
          received_at?: string | null;
          attributes?: Record<string, string> | null;
          payload?: Record<string, unknown> | null;
        } | null;
      }>;
    };
    derivative_selection?: {
      events: Array<{
        id: string;
        workspace_id: string | null;
        workspace_name: string | null;
        environment_id: string | null;
        environment_name: string | null;
        device_id: string | null;
        device_amapi_name: string | null;
        serial_number: string | null;
        created_at: string;
        details: {
          policy_id: string | null;
          expected_scope: string | null;
          expected_amapi_name: string | null;
          reason_code: string | null;
          can_noop: boolean | null;
          used_device_derivative: boolean | null;
          device_derivative_required: boolean | null;
          device_derivative_redundant: boolean | null;
          expected_generation_hash: string | null;
          stored_generation_hash: string | null;
        };
      }>;
    };
    job_queue?: {
      events: Array<{
        id: string;
        job_type: string;
        environment_id: string | null;
        environment_name: string | null;
        status: string;
        attempts: number;
        max_attempts: number;
        scheduled_for: string | null;
        locked_at: string | null;
        completed_at: string | null;
        error: string | null;
        created_at: string;
        payload_summary: Record<string, unknown> | null;
      }>;
    };
    workflow_execution?: {
      events: Array<{
        id: string;
        workflow_id: string;
        workflow_name: string | null;
        environment_id: string | null;
        environment_name: string | null;
        device_id: string | null;
        device_amapi_name: string | null;
        serial_number: string | null;
        status: string;
        created_at: string;
        result_preview: Record<string, unknown> | null;
      }>;
    };
    geofence_worker?: {
      events: Array<{
        id: string;
        environment_id: string | null;
        environment_name: string | null;
        device_id: string | null;
        device_amapi_name: string | null;
        serial_number: string | null;
        action: string;
        created_at: string;
        details: Record<string, unknown> | null;
      }>;
    };
    sync_reconcile?: {
      events: Array<{
        id: string;
        environment_id: string | null;
        environment_name: string | null;
        resource_type: string | null;
        resource_id: string | null;
        action: string;
        created_at: string;
        details: Record<string, unknown> | null;
      }>;
    };
  };
}

interface PlanOption {
  id: string;
  name: string;
  max_devices?: number;
  stripe_price_id?: string | null;
  unit_amount_cents?: number;
  currency?: string;
  features?: Record<string, unknown>;
}

interface PlatformSettings {
  invite_only_registration: boolean;
  licensing_enabled: boolean;
  default_free_enabled: boolean;
  default_free_seat_limit: number;
  assistant_enabled: boolean;
}

interface SuperadminUserListItem {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  is_superadmin: boolean;
  totp_enabled: boolean;
  created_at: string;
  last_login_at: string | null;
  last_login_method: string | null;
  workspace_count: number;
  workspaces: Array<{
    id: string;
    name: string;
    role: string;
    access_scope?: 'workspace' | 'scoped';
    environment_count?: number;
    group_count?: number;
  }>;
}

interface MigrationRunResult {
  message: string;
  summary?: {
    total: number;
    applied: number;
    skipped: number;
    errors: number;
  };
  results?: Array<{
    name: string;
    status: string;
    error?: string;
  }>;
}

interface SuperadminBillingInvoice {
  id: string;
  workspace_id: string;
  workspace_name: string;
  invoice_type: string;
  status: string;
  subtotal_cents: number;
  currency: string;
  due_at: string | null;
  paid_at: string | null;
  source: string | null;
  created_at: string;
}

interface WorkspaceGrantLedger {
  grants: Array<{
    id: string;
    source: string;
    seat_count: number;
    starts_at: string;
    ends_at: string | null;
    status: string;
    created_at: string;
  }>;
  invoices: Array<{
    id: string;
    status: string;
    subtotal_cents: number;
    currency: string;
    due_at: string | null;
    paid_at: string | null;
    created_at: string;
  }>;
}

const HIDDEN_PLAN_MAX_DEVICES_DEFAULT = 100;
type PlanDraft = {
  name: string;
  max_devices: number;
  stripe_price_id: string;
  unit_amount_major: string;
  currency: string;
  stripe_interval_months: number;
  hidden: boolean;
};

function formatMinorUnitToMajorInput(minorUnits: number): string {
  const major = minorUnits / 100;
  return major.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

function toPlanDraft(plan: PlanOption): PlanDraft {
  return {
    name: plan.name,
    max_devices: Number.isInteger(plan.max_devices) ? Number(plan.max_devices) : 0,
    stripe_price_id: plan.stripe_price_id ?? '',
    unit_amount_major: formatMinorUnitToMajorInput(Number.isInteger(plan.unit_amount_cents) ? Number(plan.unit_amount_cents) : 0),
    currency: (plan.currency ?? 'usd').toLowerCase(),
    stripe_interval_months: normalizeBillingDurationMonths(plan.features?.stripe_interval_months),
    hidden: plan.features?.hidden === true,
  };
}

// --- Sub-pages ---

export function SuperadminDashboard() {
  const LIVE_REFRESH_MS = 30000;
  const queryClient = useQueryClient();
  const [defaultFreeEnabled, setDefaultFreeEnabled] = useState(true);
  const [defaultFreeSeatLimit, setDefaultFreeSeatLimit] = useState(10);
  const [planDrafts, setPlanDrafts] = useState<Record<string, PlanDraft>>({});
  const [dirtyPlanDraftIds, setDirtyPlanDraftIds] = useState<Record<string, true>>({});
  const [newPlanName, setNewPlanName] = useState('');
  const [newPlanStripePriceId, setNewPlanStripePriceId] = useState('');
  const [newPlanUnitAmountMajor, setNewPlanUnitAmountMajor] = useState('0');
  const [newPlanCurrency, setNewPlanCurrency] = useState('usd');
  const [newPlanIntervalMonths, setNewPlanIntervalMonths] = useState<number>(1);
  const [planVisibilityFilter, setPlanVisibilityFilter] = useState<'all' | 'visible' | 'hidden'>('all');
  const { data: stats, isLoading, dataUpdatedAt: statsUpdatedAt } = useQuery<PlatformStats>({
    queryKey: ['superadmin', 'stats'],
    queryFn: () => apiClient.get<PlatformStats>('/api/superadmin/stats'),
    refetchInterval: LIVE_REFRESH_MS,
    refetchIntervalInBackground: true,
  });
  const { data: platformSettings, isLoading: settingsLoading } = useQuery<PlatformSettings>({
    queryKey: ['superadmin', 'settings'],
    queryFn: () => apiClient.get<PlatformSettings>('/api/superadmin/settings'),
  });
  const { data: licensePlans, isLoading: plansLoading } = useQuery<{ plans: PlanOption[] }>({
    queryKey: ['superadmin', 'license-plans'],
    queryFn: () => apiClient.get<{ plans: PlanOption[] }>('/api/licenses/plans'),
  });
  useEffect(() => {
    if (!platformSettings) return;
    setDefaultFreeEnabled(platformSettings.default_free_enabled);
    setDefaultFreeSeatLimit(platformSettings.default_free_seat_limit);
  }, [platformSettings]);
  useEffect(() => {
    if (!licensePlans?.plans) return;
    setPlanDrafts((prev) => {
      const next: Record<string, PlanDraft> = {};
      for (const plan of licensePlans.plans) {
        if (dirtyPlanDraftIds[plan.id] && prev[plan.id]) {
          next[plan.id] = prev[plan.id];
          continue;
        }
        next[plan.id] = toPlanDraft(plan);
      }
      return next;
    });
  }, [dirtyPlanDraftIds, licensePlans?.plans]);

  const markPlanDraftDirty = (planId: string) => {
    setDirtyPlanDraftIds((prev) => (prev[planId] ? prev : { ...prev, [planId]: true }));
  };

  const clearPlanDraftDirty = (planId: string) => {
    setDirtyPlanDraftIds((prev) => {
      if (!prev[planId]) return prev;
      const next = { ...prev };
      delete next[planId];
      return next;
    });
  };

  const platformSettingsMutation = useMutation({
    mutationFn: (payload: {
      invite_only_registration?: boolean;
      licensing_enabled?: boolean;
      default_free_enabled?: boolean;
      default_free_seat_limit?: number;
      assistant_enabled?: boolean;
    }) =>
      apiClient.post<{ message: string; invite_only_registration: boolean; licensing_enabled: boolean; default_free_enabled: boolean; default_free_seat_limit: number; assistant_enabled: boolean }>(
        '/api/superadmin/settings',
        payload
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['superadmin', 'settings'] });
    },
  });
  const runMigrationsMutation = useMutation({
    mutationFn: () =>
      apiClient.post<MigrationRunResult>('/api/superadmin/actions', {
        action: 'run_migrations',
      }),
  });
  const upsertPlanMutation = useMutation({
    mutationFn: (payload: {
      id?: string;
      name: string;
      max_devices: number;
      stripe_price_id?: string | null;
      unit_amount_cents: number;
      currency: string;
      create_stripe_price?: boolean;
      stripe_interval_months?: number;
      features?: Record<string, unknown>;
    }) => apiClient.put<{ message: string; id: string }>('/api/licenses/plans', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['superadmin', 'license-plans'] });
    },
  });
  const deletePlanMutation = useMutation({
    mutationFn: (planId: string) => apiClient.delete<{ message: string; id: string }>(`/api/licenses/plans?id=${planId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['superadmin', 'license-plans'] });
    },
  });

  if (isLoading || !stats) {
    return (
      <div>
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-gray-900">Platform Overview</h1>
          <LivePageIndicator intervalMs={LIVE_REFRESH_MS} lastUpdatedAt={statsUpdatedAt} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6 mb-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 p-6 animate-pulse">
              <div className="h-4 w-24 bg-gray-200 rounded mb-2" />
              <div className="h-8 w-16 bg-gray-200 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const statCards = [
    { label: 'Workspaces', value: stats.total_workspaces, icon: Building2, color: 'text-blue-600 bg-blue-50' },
    { label: 'Environments', value: stats.total_environments, icon: Globe, color: 'text-green-600 bg-green-50' },
    { label: 'Devices', value: stats.total_devices, icon: Smartphone, color: 'text-purple-600 bg-purple-50' },
    { label: 'Users', value: stats.total_users, icon: Users, color: 'text-orange-600 bg-orange-50' },
  ];
  const allPlans = licensePlans?.plans ?? [];
  const filteredPlans = allPlans.filter((plan) => {
    if (planVisibilityFilter === 'all') return true;
    const hidden = plan.features?.hidden === true;
    return planVisibilityFilter === 'hidden' ? hidden : !hidden;
  });

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold text-gray-900">Platform Overview</h1>
        <LivePageIndicator intervalMs={LIVE_REFRESH_MS} lastUpdatedAt={statsUpdatedAt} />
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6 mb-8">
        {statCards.map((card) => (
          <div key={card.label} className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${card.color}`}>
                <card.icon className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm text-gray-500">{card.label}</p>
                <p className="text-2xl font-bold text-gray-900">{card.value.toLocaleString()}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Devices by plan */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6 lg:col-span-2">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Platform Access</h2>
              <p className="text-sm text-gray-500 mt-1">
                Invite-only mode disables self-serve registration while keeping login enabled for existing users.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={runMigrationsMutation.isPending}
                onClick={() => {
                  if (!window.confirm('Run pending database migrations now?')) return;
                  runMigrationsMutation.mutate();
                }}
                className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium bg-blue-50 text-blue-800 hover:bg-blue-100 disabled:opacity-50"
              >
                {runMigrationsMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Run Migrations
              </button>
              <button
                type="button"
                disabled={settingsLoading || platformSettingsMutation.isPending}
                onClick={() => platformSettingsMutation.mutate({
                  invite_only_registration: !(platformSettings?.invite_only_registration ?? false),
                })}
                className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
                  platformSettings?.invite_only_registration
                    ? 'bg-amber-50 text-amber-800 hover:bg-amber-100'
                    : 'bg-green-50 text-green-800 hover:bg-green-100'
                }`}
              >
                {platformSettingsMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <span className={`inline-block h-2.5 w-2.5 rounded-full ${
                    platformSettings?.invite_only_registration ? 'bg-amber-500' : 'bg-green-500'
                  }`} />
                )}
                {platformSettings?.invite_only_registration ? 'Invite-only: On' : 'Invite-only: Off'}
              </button>
              <button
                type="button"
                disabled={settingsLoading || platformSettingsMutation.isPending}
                onClick={() => platformSettingsMutation.mutate({
                  licensing_enabled: !(platformSettings?.licensing_enabled ?? true),
                })}
                className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
                  platformSettings?.licensing_enabled
                    ? 'bg-green-50 text-green-800 hover:bg-green-100'
                    : 'bg-red-50 text-red-800 hover:bg-red-100'
                }`}
              >
                {platformSettingsMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <span className={`inline-block h-2.5 w-2.5 rounded-full ${
                    platformSettings?.licensing_enabled ? 'bg-green-500' : 'bg-red-500'
                  }`} />
                )}
                {platformSettings?.licensing_enabled ? 'Licensing: On' : 'Licensing: Off'}
              </button>
              <button
                type="button"
                disabled={settingsLoading || platformSettingsMutation.isPending}
                onClick={() => platformSettingsMutation.mutate({
                  assistant_enabled: !(platformSettings?.assistant_enabled ?? false),
                })}
                className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
                  platformSettings?.assistant_enabled
                    ? 'bg-green-50 text-green-800 hover:bg-green-100'
                    : 'bg-red-50 text-red-800 hover:bg-red-100'
                }`}
              >
                {platformSettingsMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <span className={`inline-block h-2.5 w-2.5 rounded-full ${
                    platformSettings?.assistant_enabled ? 'bg-green-500' : 'bg-red-500'
                  }`} />
                )}
                {platformSettings?.assistant_enabled ? 'Assistant: On' : 'Assistant: Off'}
              </button>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-4 gap-3">
            <label className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm sm:col-span-1">
              <input
                type="checkbox"
                checked={defaultFreeEnabled}
                disabled={!platformSettings?.licensing_enabled}
                onChange={(e) => setDefaultFreeEnabled(e.target.checked)}
              />
              Default free tier enabled
            </label>
            <input
              type="number"
              min={0}
              max={1000000}
              value={defaultFreeSeatLimit}
              disabled={!platformSettings?.licensing_enabled}
              onChange={(e) => setDefaultFreeSeatLimit(Math.max(0, Math.min(1_000_000, Number(e.target.value) || 0)))}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm sm:col-span-1"
              placeholder="Default free seats"
            />
            <button
              type="button"
              disabled={settingsLoading || platformSettingsMutation.isPending || !platformSettings?.licensing_enabled}
              onClick={() => platformSettingsMutation.mutate({
                default_free_enabled: defaultFreeEnabled,
                default_free_seat_limit: defaultFreeSeatLimit,
              })}
              className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium bg-blue-50 text-blue-800 hover:bg-blue-100 disabled:opacity-50 sm:col-span-1"
            >
              {platformSettingsMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Save Free Tier Default
            </button>
            <div className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 sm:col-span-1">
              Current default: {platformSettings?.default_free_enabled ? platformSettings?.default_free_seat_limit : 0} seats
            </div>
          </div>
          {!platformSettings?.licensing_enabled && (
            <p className="mt-3 text-sm text-amber-700">
              Platform licensing is disabled. Workspace licensing pages, RBAC billing permissions, and enforcement logic are hidden/suspended.
            </p>
          )}
          {platformSettingsMutation.isError && (
            <p className="mt-3 text-sm text-red-600">Failed to update platform access setting.</p>
          )}
          {runMigrationsMutation.isError && (
            <p className="mt-3 text-sm text-red-600">
              Failed to run migrations: {String((runMigrationsMutation.error as Error)?.message ?? 'Unknown error')}
            </p>
          )}
          {runMigrationsMutation.data?.summary && (
            <div className="mt-3 space-y-2">
              <p className={`text-sm ${runMigrationsMutation.data.summary.errors > 0 ? 'text-red-700' : 'text-blue-700'}`}>
                Migration summary: {runMigrationsMutation.data.summary.applied} applied, {runMigrationsMutation.data.summary.skipped} skipped, {runMigrationsMutation.data.summary.errors} errors.
              </p>
              {runMigrationsMutation.data.results
                ?.filter((r) => r.status === 'error')
                .map((r) => (
                  <div key={r.name} className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-800">
                    <span className="font-semibold">{r.name}:</span>{' '}
                    <span className="font-mono">{r.error}</span>
                  </div>
                ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 lg:col-span-2">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Platform Plan Catalogue</h2>
          <p className="text-sm text-gray-500 mb-4">
            Manage plan tiers, unit costs, currencies, and Stripe price IDs for workspace billing.
          </p>
          <div className="mb-3 flex items-center justify-end">
            <select
              value={planVisibilityFilter}
              onChange={(e) => setPlanVisibilityFilter(e.target.value as 'all' | 'visible' | 'hidden')}
              className="rounded border border-gray-300 px-2 py-1.5 text-xs text-gray-700"
            >
              <option value="all">All plans</option>
              <option value="visible">Visible only</option>
              <option value="hidden">Hidden only</option>
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px]">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-2 py-2">Plan</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-2 py-2">Unit amount</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-2 py-2">Currency</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-2 py-2">Stripe price ID</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-2 py-2">Interval</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-2 py-2">Visibility</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-2 py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {plansLoading && (
                  <tr>
                    <td colSpan={7} className="px-2 py-4 text-sm text-gray-400">Loading plans...</td>
                  </tr>
                )}
                {filteredPlans.map((plan) => {
                  const draft = planDrafts[plan.id] ?? toPlanDraft(plan);
                  const hasStripeLink = Boolean(plan.stripe_price_id?.trim());
                  const draftHasStripeLink = Boolean(draft.stripe_price_id.trim());
                  const isDirty = Boolean(dirtyPlanDraftIds[plan.id]);
                  return (
                    <tr key={plan.id} className="border-b border-gray-50">
                      <td className="px-2 py-2">
                        <input
                          value={draft.name}
                          onChange={(e) => {
                            markPlanDraftDirty(plan.id);
                            setPlanDrafts((prev) => {
                              const current = prev[plan.id] ?? draft;
                              return { ...prev, [plan.id]: { ...current, name: e.target.value } };
                            });
                          }}
                          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          inputMode="decimal"
                          value={draft.unit_amount_major}
                          onChange={(e) => {
                            markPlanDraftDirty(plan.id);
                            setPlanDrafts((prev) => {
                              const current = prev[plan.id] ?? draft;
                              return { ...prev, [plan.id]: { ...current, unit_amount_major: e.target.value } };
                            });
                          }}
                          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <select
                          value={draft.currency}
                          onChange={(e) => {
                            markPlanDraftDirty(plan.id);
                            setPlanDrafts((prev) => {
                              const current = prev[plan.id] ?? draft;
                              return { ...prev, [plan.id]: { ...current, currency: e.target.value } };
                            });
                          }}
                          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                        >
                          <option value="usd">USD</option>
                          <option value="gbp">GBP</option>
                          <option value="eur">EUR</option>
                          <option value="cad">CAD</option>
                          <option value="aud">AUD</option>
                        </select>
                      </td>
                      <td className="px-2 py-2">
                        <input
                          value={draft.stripe_price_id}
                          onChange={(e) => {
                            markPlanDraftDirty(plan.id);
                            setPlanDrafts((prev) => {
                              const current = prev[plan.id] ?? draft;
                              return { ...prev, [plan.id]: { ...current, stripe_price_id: e.target.value } };
                            });
                          }}
                          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                          placeholder="price_..."
                        />
                      </td>
                      <td className="px-2 py-2">
                        <select
                          value={draft.stripe_interval_months}
                          onChange={(e) => {
                            markPlanDraftDirty(plan.id);
                            setPlanDrafts((prev) => {
                              const current = prev[plan.id] ?? draft;
                              return { ...prev, [plan.id]: { ...current, stripe_interval_months: Number(e.target.value) || 1 } };
                            });
                          }}
                          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                        >
                          {DURATION_MONTH_OPTIONS.map((months) => (
                            <option key={months} value={months}>{months} month{months !== 1 ? 's' : ''}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-2">
                        <label className="inline-flex items-center gap-2 text-xs text-gray-700">
                          <input
                            type="checkbox"
                            checked={!draft.hidden}
                            onChange={(e) => {
                              markPlanDraftDirty(plan.id);
                              setPlanDrafts((prev) => {
                                const current = prev[plan.id] ?? draft;
                                return { ...prev, [plan.id]: { ...current, hidden: !e.target.checked } };
                              });
                            }}
                          />
                          {draft.hidden ? 'Hidden' : 'Visible'}
                        </label>
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-2">
                          {isDirty && (
                            <span className="rounded bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-800">
                              Unsaved changes
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => upsertPlanMutation.mutate({
                              id: plan.id,
                              name: draft.name.trim(),
                              max_devices: draft.max_devices,
                              stripe_price_id: draft.stripe_price_id.trim() || null,
                              unit_amount_cents: parseMajorInputToMinorUnits(draft.unit_amount_major),
                              currency: draft.currency,
                              stripe_interval_months: draft.stripe_interval_months,
                              features: {
                                ...(plan.features ?? {}),
                                hidden: draft.hidden,
                              },
                            }, {
                              onSuccess: () => clearPlanDraftDirty(plan.id),
                            })}
                            disabled={upsertPlanMutation.isPending || !draft.name.trim()}
                            className="rounded bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-800 hover:bg-blue-100 disabled:opacity-50"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => upsertPlanMutation.mutate({
                              id: plan.id,
                              name: draft.name.trim(),
                              max_devices: draft.max_devices,
                              stripe_price_id: draft.stripe_price_id.trim() || null,
                              unit_amount_cents: parseMajorInputToMinorUnits(draft.unit_amount_major),
                              currency: draft.currency,
                              create_stripe_price: true,
                              stripe_interval_months: draft.stripe_interval_months,
                              features: {
                                ...(plan.features ?? {}),
                                hidden: draft.hidden,
                              },
                            }, {
                              onSuccess: () => clearPlanDraftDirty(plan.id),
                            })}
                            disabled={upsertPlanMutation.isPending || !draft.name.trim() || draftHasStripeLink}
                            className="rounded bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
                            title={draftHasStripeLink ? 'Clear Stripe price ID to create a new Stripe price' : undefined}
                          >
                            Create Stripe Price
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (!hasStripeLink) {
                                if (!window.confirm(`Delete platform plan "${draft.name.trim() || plan.name}"?`)) return;
                                deletePlanMutation.mutate(plan.id, {
                                  onSuccess: () => clearPlanDraftDirty(plan.id),
                                });
                                return;
                              }
                              upsertPlanMutation.mutate({
                                id: plan.id,
                                name: draft.name.trim(),
                                max_devices: draft.max_devices,
                                stripe_price_id: draft.stripe_price_id.trim() || null,
                                unit_amount_cents: parseMajorInputToMinorUnits(draft.unit_amount_major),
                                currency: draft.currency,
                                stripe_interval_months: draft.stripe_interval_months,
                                features: {
                                  ...(plan.features ?? {}),
                                  hidden: !draft.hidden,
                                },
                              }, {
                                onSuccess: () => clearPlanDraftDirty(plan.id),
                              });
                            }}
                            disabled={upsertPlanMutation.isPending || deletePlanMutation.isPending || !draft.name.trim()}
                            className={`rounded px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
                              hasStripeLink
                                ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                : 'bg-red-50 text-red-700 hover:bg-red-100'
                            }`}
                          >
                            {hasStripeLink ? (draft.hidden ? 'Unhide' : 'Hide') : 'Delete'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!plansLoading && filteredPlans.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-2 py-4 text-sm text-gray-400">
                      No plans match this filter.
                    </td>
                  </tr>
                )}
                <tr>
                  <td className="px-2 py-2">
                    <input value={newPlanName} onChange={(e) => setNewPlanName(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" placeholder="New tier name" />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      inputMode="decimal"
                      value={newPlanUnitAmountMajor}
                      onChange={(e) => setNewPlanUnitAmountMajor(e.target.value)}
                      className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <select value={newPlanCurrency} onChange={(e) => setNewPlanCurrency(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
                      <option value="usd">USD</option>
                      <option value="gbp">GBP</option>
                      <option value="eur">EUR</option>
                      <option value="cad">CAD</option>
                      <option value="aud">AUD</option>
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <input value={newPlanStripePriceId} onChange={(e) => setNewPlanStripePriceId(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" placeholder="price_..." />
                  </td>
                  <td className="px-2 py-2">
                    <select
                      className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                      value={newPlanIntervalMonths}
                      onChange={(e) => setNewPlanIntervalMonths(Number(e.target.value) || 1)}
                    >
                      {DURATION_MONTH_OPTIONS.map((months) => (
                        <option key={months} value={months}>{months} month{months !== 1 ? 's' : ''}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <span className="text-xs text-gray-400">Visible</span>
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => upsertPlanMutation.mutate({
                          name: newPlanName.trim(),
                          max_devices: HIDDEN_PLAN_MAX_DEVICES_DEFAULT,
                          stripe_price_id: newPlanStripePriceId.trim() || null,
                          unit_amount_cents: parseMajorInputToMinorUnits(newPlanUnitAmountMajor),
                          currency: newPlanCurrency,
                        }, {
                          onSuccess: () => {
                            setNewPlanName('');
                            setNewPlanStripePriceId('');
                            setNewPlanUnitAmountMajor('0');
                            setNewPlanCurrency('usd');
                            setNewPlanIntervalMonths(1);
                          },
                        })}
                        disabled={upsertPlanMutation.isPending || !newPlanName.trim()}
                        className="rounded bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                      >
                        Add
                      </button>
                      <button
                        type="button"
                        onClick={() => upsertPlanMutation.mutate({
                          name: newPlanName.trim(),
                          max_devices: HIDDEN_PLAN_MAX_DEVICES_DEFAULT,
                          unit_amount_cents: parseMajorInputToMinorUnits(newPlanUnitAmountMajor),
                          currency: newPlanCurrency,
                          create_stripe_price: true,
                          stripe_interval_months: newPlanIntervalMonths,
                        }, {
                          onSuccess: () => {
                            setNewPlanName('');
                            setNewPlanStripePriceId('');
                            setNewPlanUnitAmountMajor('0');
                            setNewPlanCurrency('usd');
                            setNewPlanIntervalMonths(1);
                          },
                        })}
                        disabled={upsertPlanMutation.isPending || !newPlanName.trim()}
                        className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        Add + Stripe Price
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          {upsertPlanMutation.isError && (
            <p className="mt-3 text-sm text-red-600">
              Failed to save plan changes: {String((upsertPlanMutation.error as Error)?.message ?? 'Unknown error')}
            </p>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Devices by Plan</h2>
          <div className="space-y-3">
            {stats.devices_by_plan.map((item) => (
              <div key={item.plan_name} className="flex items-center justify-between">
                <span className="text-sm text-gray-700">{item.plan_name}</span>
                <span className="text-sm font-semibold text-gray-900">{item.device_count.toLocaleString()}</span>
              </div>
            ))}
            {stats.devices_by_plan.length === 0 && (
              <p className="text-sm text-gray-400">No data available</p>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-green-600" />
            Recent Signups (30d)
          </h2>
          <div className="space-y-2">
            {stats.recent_signups.slice(0, 10).map((item) => (
              <div key={item.date} className="flex items-center justify-between">
                <span className="text-sm text-gray-500">{formatDate(item.date)}</span>
                <span className="text-sm font-semibold text-gray-900">{item.count}</span>
              </div>
            ))}
            {stats.recent_signups.length === 0 && (
              <p className="text-sm text-gray-400">No signups in last 30 days</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function SuperadminWorkspaces() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ action: string; targetId: string; label: string } | null>(null);
  const [forcePlanId, setForcePlanId] = useState('');
  const [impersonationMode, setImpersonationMode] = useState<'full' | 'read_only'>('read_only');
  const [supportReason, setSupportReason] = useState('');
  const [supportTicketRef, setSupportTicketRef] = useState('');
  const [noticeAck, setNoticeAck] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member' | 'viewer'>('admin');
  const [manualGrantSeats, setManualGrantSeats] = useState(10);
  const [manualGrantDurationMonths, setManualGrantDurationMonths] = useState(12);
  const [manualGrantType, setManualGrantType] = useState<'manual' | 'gift'>('manual');
  const [manualGrantNoExpiry, setManualGrantNoExpiry] = useState(false);
  const [manualGrantExpiresAt, setManualGrantExpiresAt] = useState('');
  const [manualGrantNote, setManualGrantNote] = useState('');
  const [workspaceInheritFreeTier, setWorkspaceInheritFreeTier] = useState(true);
  const [workspaceFreeEnabled, setWorkspaceFreeEnabled] = useState(true);
  const [workspaceFreeSeatLimit, setWorkspaceFreeSeatLimit] = useState(10);

  useEffect(() => {
    if (confirmAction?.action !== 'impersonate') return;
    setImpersonationMode('read_only');
    setSupportReason('');
    setSupportTicketRef('');
    setNoticeAck(false);
  }, [confirmAction?.action, confirmAction?.targetId]);

  const { data: listData, isLoading: listLoading } = useQuery<{
    workspaces: WorkspaceListItem[];
    total: number;
    page: number;
    per_page: number;
  }>({
    queryKey: ['superadmin', 'workspaces', page, search],
    queryFn: () =>
      apiClient.get(`/api/superadmin/workspaces?page=${page}&per_page=20&search=${encodeURIComponent(search)}`),
  });

  const { data: detail, isLoading: detailLoading } = useQuery<WorkspaceDetail>({
    queryKey: ['superadmin', 'workspace-detail', selectedId],
    queryFn: () => apiClient.get<WorkspaceDetail>(`/api/superadmin/workspaces/${selectedId}`),
    enabled: !!selectedId,
  });

  const { data: plans } = useQuery<{ plans: PlanOption[] }>({
    queryKey: ['license-plans'],
    queryFn: () => apiClient.get('/api/licenses/plans'),
    staleTime: 300_000,
  });

  const { data: workspaceLicenseStatus } = useQuery<LicenseStatusResponse>({
    queryKey: ['superadmin', 'workspace-license-status', selectedId],
    queryFn: () => apiClient.get<LicenseStatusResponse>(`/api/licenses/status?workspace_id=${selectedId}`),
    enabled: !!selectedId,
  });

  const { data: workspaceGrantLedger } = useQuery<WorkspaceGrantLedger>({
    queryKey: ['superadmin', 'workspace-grants', selectedId],
    queryFn: () => apiClient.get<WorkspaceGrantLedger>(`/api/licenses/grants?workspace_id=${selectedId}`),
    enabled: !!selectedId,
  });

  const { data: workspaceLicenseSettings } = useQuery<WorkspaceLicenseSettingsResponse>({
    queryKey: ['superadmin', 'workspace-license-settings', selectedId],
    queryFn: () =>
      apiClient.get<WorkspaceLicenseSettingsResponse>(`/api/licenses/settings?workspace_id=${selectedId}`),
    enabled: !!selectedId,
  });

  useEffect(() => {
    const settings = workspaceLicenseSettings?.settings;
    if (!settings) return;
    setWorkspaceInheritFreeTier(settings.inherit_platform_free_tier);
    setWorkspaceFreeEnabled(settings.workspace_free_enabled);
    setWorkspaceFreeSeatLimit(settings.workspace_free_seat_limit);
  }, [workspaceLicenseSettings?.settings]);

  const { data: workspaceInvoiceQueue } = useQuery<{ invoices: SuperadminBillingInvoice[] }>({
    queryKey: ['superadmin', 'workspace-invoice-queue', selectedId],
    queryFn: () => apiClient.get<{ invoices: SuperadminBillingInvoice[] }>(
      `/api/superadmin/billing/invoices?workspace_id=${selectedId}`
    ),
    enabled: !!selectedId,
  });

  const actionMutation = useMutation({
    mutationFn: (params: { action: string; target_id: string; params?: Record<string, unknown> }) =>
      apiClient.post<{ message: string }>('/api/superadmin/actions', params),
    onSuccess: (_data, variables) => {
      if (variables.action === 'impersonate') {
        // Force a reload so the app rehydrates against the newly-set impersonation cookie.
        window.location.href = '/';
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['superadmin'] });
      setConfirmAction(null);
    },
  });
  const createWorkspaceMutation = useMutation({
    mutationFn: (name: string) =>
      apiClient.post<{ workspace: { id: string; name: string } }>('/api/workspaces/create', { name }),
    onSuccess: (data) => {
      setNewWorkspaceName('');
      setSelectedId(data.workspace.id);
      setPage(1);
      queryClient.invalidateQueries({ queryKey: ['superadmin', 'workspaces'] });
      queryClient.invalidateQueries({ queryKey: ['superadmin'] });
    },
  });
  const inviteMutation = useMutation({
    mutationFn: (params: { workspace_id: string; email: string; role: 'admin' | 'member' | 'viewer' }) =>
      apiClient.post<{ message: string }>('/api/workspaces/invite', params),
    onSuccess: () => {
      setInviteEmail('');
    },
  });

  const markInvoicePaidMutation = useMutation({
    mutationFn: (invoiceId: string) =>
      apiClient.post<{ message: string; grants_created: number }>(`/api/superadmin/billing/invoices/${invoiceId}/mark-paid`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['superadmin', 'workspace-invoice-queue', selectedId] });
      queryClient.invalidateQueries({ queryKey: ['superadmin', 'workspace-grants', selectedId] });
      queryClient.invalidateQueries({ queryKey: ['superadmin', 'workspace-license-status', selectedId] });
    },
  });

  const manualGrantMutation = useMutation({
    mutationFn: (payload: {
      workspace_id: string;
      seat_count: number;
      duration_months?: number;
      expires_at?: string | null;
      grant_type?: 'manual' | 'gift';
      note?: string;
    }) =>
      apiClient.post<{ message: string; grant_id: string }>('/api/superadmin/billing/grants/manual', payload),
    onSuccess: () => {
      setManualGrantNote('');
      queryClient.invalidateQueries({ queryKey: ['superadmin', 'workspace-grants', selectedId] });
      queryClient.invalidateQueries({ queryKey: ['superadmin', 'workspace-license-status', selectedId] });
      queryClient.invalidateQueries({ queryKey: ['superadmin', 'workspace-invoice-queue', selectedId] });
    },
  });

  const workspaceLicenseSettingsMutation = useMutation({
    mutationFn: (payload: {
      workspace_id: string;
      inherit_platform_free_tier: boolean;
      free_enabled: boolean;
      free_seat_limit: number;
    }) =>
      apiClient.put<{ workspace_id: string; settings: WorkspaceLicenseSettingsResponse['settings'] }>(
        '/api/licenses/settings',
        payload
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['superadmin', 'workspace-license-settings', selectedId] });
      queryClient.invalidateQueries({ queryKey: ['superadmin', 'workspace-license-status', selectedId] });
    },
  });

  const executeAction = (action: string, targetId: string, params?: Record<string, unknown>) => {
    actionMutation.mutate({ action, target_id: targetId, params });
  };

  const totalPages = listData ? Math.ceil(listData.total / listData.per_page) : 0;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Workspaces</h1>

      <div className="flex flex-col gap-4 mb-6 lg:flex-row">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search workspaces..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="New workspace name"
            value={newWorkspaceName}
            onChange={(e) => setNewWorkspaceName(e.target.value)}
            className="w-full min-w-0 lg:w-72 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <button
            type="button"
            onClick={() => {
              if (!newWorkspaceName.trim()) return;
              createWorkspaceMutation.mutate(newWorkspaceName.trim());
            }}
            disabled={createWorkspaceMutation.isPending || !newWorkspaceName.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {createWorkspaceMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Create
          </button>
        </div>
      </div>
      {(createWorkspaceMutation.isError || createWorkspaceMutation.isSuccess) && (
        <p className={`mb-4 text-sm ${createWorkspaceMutation.isError ? 'text-red-600' : 'text-green-700'}`}>
          {createWorkspaceMutation.isError
            ? createWorkspaceMutation.error?.message ?? 'Failed to create workspace'
            : 'Workspace created.'}
        </p>
      )}

      <div className="flex gap-6">
        {/* Workspace list */}
        <div className="flex-1">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {listLoading ? (
              <div className="p-12 text-center">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400 mx-auto" />
              </div>
            ) : (
              <>
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left text-xs font-medium text-gray-500 uppercase px-6 py-3">Workspace</th>
                      <th className="text-left text-xs font-medium text-gray-500 uppercase px-6 py-3">Devices</th>
                      <th className="text-left text-xs font-medium text-gray-500 uppercase px-6 py-3">Users</th>
                      <th className="text-left text-xs font-medium text-gray-500 uppercase px-6 py-3">Plan</th>
                      <th className="text-left text-xs font-medium text-gray-500 uppercase px-6 py-3">Created</th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(listData?.workspaces ?? []).map((ws) => (
                      <tr
                        key={ws.id}
                        onClick={() => setSelectedId(ws.id)}
                        className={`border-b border-gray-50 cursor-pointer transition-colors ${
                          selectedId === ws.id ? 'bg-blue-50' : 'hover:bg-gray-50'
                        }`}
                      >
                        <td className="px-6 py-3 text-sm font-medium text-gray-900">{ws.name}</td>
                        <td className="px-6 py-3 text-sm text-gray-600">{ws.device_count}</td>
                        <td className="px-6 py-3 text-sm text-gray-600">{ws.user_count}</td>
                        <td className="px-6 py-3">
                          <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                            ws.plan_name === 'Enterprise'
                              ? 'bg-purple-100 text-purple-700'
                              : ws.plan_name === 'Pro'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-gray-100 text-gray-700'
                          }`}>
                            {ws.plan_name ?? 'Free'}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-sm text-gray-500">
                          {formatDate(ws.created_at)}
                        </td>
                        <td className="px-6 py-3">
                          <ChevronRight className="w-4 h-4 text-gray-400" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100">
                    <p className="text-sm text-gray-500">
                      {listData?.total} total workspaces
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page === 1}
                        className="px-3 py-1 text-sm border border-gray-300 rounded-md disabled:opacity-50"
                      >
                        Prev
                      </button>
                      <span className="px-3 py-1 text-sm text-gray-600">
                        {page} / {totalPages}
                      </span>
                      <button
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        disabled={page === totalPages}
                        className="px-3 py-1 text-sm border border-gray-300 rounded-md disabled:opacity-50"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Detail panel */}
        {selectedId && (
          <div className="w-96 shrink-0">
            {detailLoading ? (
              <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400 mx-auto" />
              </div>
            ) : detail ? (
              <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
                {/* Header */}
                <div className="p-4">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="text-lg font-semibold text-gray-900">{detail.workspace.name}</h3>
                    {detail.workspace.disabled && (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                        Disabled
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500">ID: {detail.workspace.id}</p>
                </div>

                {/* Licence */}
                <div className="p-4">
                  <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">Licence</h4>
                  {detail.license ? (
                    <div className="text-sm">
                      <p className="font-medium text-gray-900">{detail.license.plan_name} Plan</p>
                      <p className="text-gray-500">Status: {detail.license.status}</p>
                      {detail.license.current_period_end && (
                        <p className="text-gray-500">
                          Ends: {formatDate(detail.license.current_period_end)}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400">No licence (Free)</p>
                  )}

                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <div className="rounded border border-gray-200 p-2">
                      <p className="text-[10px] uppercase tracking-wide text-gray-500">Entitled</p>
                      <p className="text-sm font-semibold text-gray-900">
                        {workspaceLicenseStatus?.platform_entitled_seats ?? '-'}
                      </p>
                    </div>
                    <div className="rounded border border-gray-200 p-2">
                      <p className="text-[10px] uppercase tracking-wide text-gray-500">Consumed</p>
                      <p className="text-sm font-semibold text-gray-900">
                        {workspaceLicenseStatus?.platform_consumed_seats ?? '-'}
                      </p>
                    </div>
                    <div className="rounded border border-gray-200 p-2">
                      <p className="text-[10px] uppercase tracking-wide text-gray-500">Overage</p>
                      <p className={`text-sm font-semibold ${(workspaceLicenseStatus?.platform_overage_count ?? 0) > 0 ? 'text-red-700' : 'text-gray-900'}`}>
                        {workspaceLicenseStatus?.platform_overage_count ?? '-'}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3">
                    <h5 className="text-[11px] font-semibold uppercase text-gray-500 mb-2">Workspace Free Tier</h5>
                    <div className="grid grid-cols-1 gap-2">
                      <label className="inline-flex items-center gap-2 text-xs text-gray-700">
                        <input
                          type="checkbox"
                          checked={workspaceInheritFreeTier}
                          onChange={(e) => setWorkspaceInheritFreeTier(e.target.checked)}
                        />
                        Inherit platform default
                      </label>
                      <label className="inline-flex items-center gap-2 text-xs text-gray-700">
                        <input
                          type="checkbox"
                          checked={workspaceFreeEnabled}
                          disabled={workspaceInheritFreeTier}
                          onChange={(e) => setWorkspaceFreeEnabled(e.target.checked)}
                        />
                        Free tier enabled
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={1000000}
                        value={workspaceFreeSeatLimit}
                        disabled={workspaceInheritFreeTier}
                        onChange={(e) => setWorkspaceFreeSeatLimit(Math.max(0, Math.min(1_000_000, Number(e.target.value) || 0)))}
                        className="w-full rounded-md border border-gray-300 px-2 py-1 text-xs disabled:bg-gray-100"
                        placeholder="Workspace free seats"
                      />
                      <button
                        type="button"
                        onClick={() => workspaceLicenseSettingsMutation.mutate({
                          workspace_id: detail.workspace.id,
                          inherit_platform_free_tier: workspaceInheritFreeTier,
                          free_enabled: workspaceFreeEnabled,
                          free_seat_limit: workspaceFreeSeatLimit,
                        })}
                        disabled={workspaceLicenseSettingsMutation.isPending}
                        className="rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                      >
                        {workspaceLicenseSettingsMutation.isPending ? 'Saving...' : 'Save Free Tier'}
                      </button>
                      <p className="text-[11px] text-gray-500">
                        Effective free seats: {workspaceLicenseSettings?.settings.free_enabled ? workspaceLicenseSettings.settings.free_seat_limit : 0}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3">
                    <h5 className="text-[11px] font-semibold uppercase text-gray-500 mb-2">Manual / Gift Platform Grant</h5>
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={manualGrantType}
                        onChange={(e) => setManualGrantType(e.target.value as 'manual' | 'gift')}
                        className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                      >
                        <option value="manual">Manual</option>
                        <option value="gift">Gift</option>
                      </select>
                      <input
                        type="number"
                        min={1}
                        value={manualGrantSeats}
                        onChange={(e) => setManualGrantSeats(Number(e.target.value) || 1)}
                        className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                        placeholder="Seats"
                      />
                      <label className="col-span-2 inline-flex items-center gap-2 text-xs text-gray-700">
                        <input
                          type="checkbox"
                          checked={manualGrantNoExpiry}
                          onChange={(e) => setManualGrantNoExpiry(e.target.checked)}
                        />
                        No expiry
                      </label>
                      {!manualGrantNoExpiry && (
                        <input
                          type="number"
                          min={1}
                          max={120}
                          value={manualGrantDurationMonths}
                          onChange={(e) => setManualGrantDurationMonths(Number(e.target.value) || 1)}
                          className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                          placeholder="Months"
                        />
                      )}
                      {!manualGrantNoExpiry && (
                        <input
                          type="datetime-local"
                          value={manualGrantExpiresAt}
                          onChange={(e) => setManualGrantExpiresAt(e.target.value)}
                          className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                          placeholder="Optional fixed expiry"
                        />
                      )}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        type="text"
                        value={manualGrantNote}
                        onChange={(e) => setManualGrantNote(e.target.value)}
                        className="w-full rounded-md border border-gray-300 px-2 py-1 text-xs"
                        placeholder="Grant note (optional)"
                      />
                      <button
                        type="button"
                        onClick={() => manualGrantMutation.mutate({
                          workspace_id: detail.workspace.id,
                          seat_count: manualGrantSeats,
                          duration_months: manualGrantNoExpiry ? undefined : manualGrantDurationMonths,
                          expires_at: manualGrantNoExpiry
                            ? null
                            : (manualGrantExpiresAt ? new Date(manualGrantExpiresAt).toISOString() : undefined),
                          grant_type: manualGrantType,
                          note: manualGrantNote.trim() || undefined,
                        })}
                        disabled={manualGrantMutation.isPending}
                        className="shrink-0 rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                      >
                        {manualGrantMutation.isPending ? 'Saving...' : 'Grant'}
                      </button>
                    </div>
                  </div>

                  <div className="mt-3">
                    <h5 className="text-[11px] font-semibold uppercase text-gray-500 mb-2">Invoice Queue</h5>
                    <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                      {(workspaceInvoiceQueue?.invoices ?? [])
                        .filter((invoice) => invoice.status === 'pending')
                        .map((invoice) => (
                          <div key={invoice.id} className="flex items-center justify-between gap-2 rounded border border-gray-200 p-2 text-xs">
                            <div className="min-w-0">
                              <p className="font-medium text-gray-800 truncate">
                                {(invoice.subtotal_cents / 100).toFixed(2)} {invoice.currency.toUpperCase()}
                              </p>
                              <p className="text-gray-500 truncate">
                                Due {invoice.due_at ? formatDate(invoice.due_at) : 'N/A'} - {invoice.status}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => markInvoicePaidMutation.mutate(invoice.id)}
                              disabled={markInvoicePaidMutation.isPending}
                              className="shrink-0 rounded-md bg-green-50 px-2 py-1 font-medium text-green-700 hover:bg-green-100 disabled:opacity-50"
                            >
                              Mark paid
                            </button>
                          </div>
                        ))}
                      {(workspaceInvoiceQueue?.invoices ?? []).filter((invoice) => invoice.status === 'pending').length === 0 && (
                        <p className="text-xs text-gray-400">No pending invoices</p>
                      )}
                    </div>
                    <h5 className="text-[11px] font-semibold uppercase text-gray-500 mt-3 mb-2">Recent Invoices</h5>
                    <div className="space-y-1 max-h-28 overflow-y-auto pr-1">
                      {(workspaceInvoiceQueue?.invoices ?? []).slice(0, 4).map((invoice) => (
                        <div key={`recent-${invoice.id}`} className="rounded border border-gray-200 p-2 text-xs">
                          <p className="font-medium text-gray-800">
                            {(invoice.subtotal_cents / 100).toFixed(2)} {invoice.currency.toUpperCase()} ({invoice.status})
                          </p>
                          <p className="text-gray-500">
                            {formatDate(invoice.created_at)} {invoice.source ? `- ${invoice.source}` : ''}
                          </p>
                        </div>
                      ))}
                      {(workspaceInvoiceQueue?.invoices ?? []).length === 0 && (
                        <p className="text-xs text-gray-400">No invoices recorded</p>
                      )}
                    </div>
                  </div>

                  <div className="mt-3">
                    <h5 className="text-[11px] font-semibold uppercase text-gray-500 mb-2">Recent Platform Grants</h5>
                    <div className="space-y-1 max-h-28 overflow-y-auto pr-1">
                      {(workspaceGrantLedger?.grants ?? []).slice(0, 4).map((grant) => (
                        <div key={grant.id} className="rounded border border-gray-200 p-2 text-xs">
                          <p className="font-medium text-gray-800">{grant.seat_count} seats ({grant.source})</p>
                          <p className="text-gray-500">
                            {formatDate(grant.starts_at)} - {grant.ends_at ? formatDate(grant.ends_at) : 'No expiry'}
                          </p>
                        </div>
                      ))}
                      {(workspaceGrantLedger?.grants ?? []).length === 0 && (
                        <p className="text-xs text-gray-400">No grants recorded</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Environments */}
                <div className="p-4">
                  <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">
                    Environments ({detail.environments.length})
                  </h4>
                  <div className="space-y-1">
                    {detail.environments.map((env) => (
                      <div key={env.id} className="text-sm">
                        <span className="font-medium text-gray-700">{env.name}</span>
                        {env.enterprise_name && (
                          <span className="text-xs text-gray-400 ml-2">{env.enterprise_name}</span>
                        )}
                      </div>
                    ))}
                    {detail.environments.length === 0 && (
                      <p className="text-sm text-gray-400">No environments</p>
                    )}
                  </div>
                </div>

                {/* Users */}
                <div className="p-4">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <h4 className="text-xs font-medium text-gray-500 uppercase">
                      Users ({detail.users.length})
                    </h4>
                    <div className="flex items-center gap-1">
                      <input
                        type="email"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        placeholder="Invite email"
                        className="w-36 rounded-md border border-gray-300 px-2 py-1 text-xs"
                      />
                      <select
                        value={inviteRole}
                        onChange={(e) => setInviteRole(e.target.value as 'admin' | 'member' | 'viewer')}
                        className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                      >
                        <option value="admin">Admin</option>
                        <option value="member">Member</option>
                        <option value="viewer">Viewer</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => {
                          if (!inviteEmail.trim()) return;
                          inviteMutation.mutate({
                            workspace_id: detail.workspace.id,
                            email: inviteEmail.trim(),
                            role: inviteRole,
                          });
                        }}
                        disabled={inviteMutation.isPending || !inviteEmail.trim()}
                        className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                        title="Send workspace invite"
                      >
                        {inviteMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Mail className="w-3 h-3" />}
                        Invite
                      </button>
                    </div>
                  </div>
                  {(inviteMutation.isError || inviteMutation.isSuccess) && (
                    <p className={`mb-2 text-xs ${inviteMutation.isError ? 'text-red-600' : 'text-green-700'}`}>
                      {inviteMutation.isError
                        ? inviteMutation.error?.message ?? 'Failed to send invite'
                        : 'Invite sent'}
                    </p>
                  )}
                  <div className="space-y-1">
                    {detail.users.map((user) => (
                      <div key={user.id} className="flex items-center justify-between gap-2 text-sm">
                        <div className="min-w-0">
                          <span className="text-gray-700 truncate block">{user.email}</span>
                          <span className="text-xs text-gray-400">
                            {user.role}{user.is_superadmin ? ' • superadmin' : ''}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          {!user.is_superadmin && (
                            <button
                              onClick={() => setConfirmAction({
                                action: 'grant_superadmin',
                                targetId: user.id,
                                label: `Grant superadmin access to ${user.email}? This gives platform-wide access.`,
                              })}
                              className="shrink-0 rounded-md bg-purple-50 px-2 py-1 text-xs font-medium text-purple-700 hover:bg-purple-100"
                            >
                              Promote
                            </button>
                          )}
                          <button
                            onClick={() => setConfirmAction({
                              action: 'impersonate',
                              targetId: user.id,
                              label: `Impersonate ${user.email}? You will be logged in as this user for troubleshooting.`,
                            })}
                            className="shrink-0 rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
                          >
                            Impersonate
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Support sessions */}
                <div className="p-4">
                  <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">
                    Support Sessions ({detail.support_sessions?.length ?? 0})
                  </h4>
                  <div className="space-y-2 max-h-44 overflow-y-auto">
                    {(detail.support_sessions ?? []).map((s) => (
                      <div key={s.id} className="rounded-lg border border-gray-100 p-2 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-gray-800 truncate">{s.target_email ?? s.user_id}</span>
                          <span className={`rounded px-2 py-0.5 font-medium ${s.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                            {s.active ? 'Active' : 'Expired'}
                          </span>
                        </div>
                        <p className="mt-1 text-gray-500">
                          {s.by_email ?? 'unknown'} • {s.impersonation_mode ?? 'full'} • {new Date(s.created_at).toLocaleString()}
                        </p>
                        {s.support_reason && <p className="mt-1 text-gray-700">Reason: {s.support_reason}</p>}
                        {s.support_ticket_ref && <p className="text-gray-500">Ticket: {s.support_ticket_ref}</p>}
                      </div>
                    ))}
                    {(detail.support_sessions?.length ?? 0) === 0 && (
                      <p className="text-sm text-gray-400">No recent support sessions</p>
                    )}
                  </div>
                </div>

                {/* Support audit */}
                <div className="p-4">
                  <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">
                    Support Audit ({detail.support_audit?.length ?? 0})
                  </h4>
                  <div className="space-y-2 max-h-44 overflow-y-auto">
                    {(detail.support_audit ?? []).map((a) => (
                      <div key={a.id} className="rounded-lg border border-gray-100 p-2 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-gray-800">{a.action}</span>
                          <span className="text-gray-500">{new Date(a.created_at).toLocaleString()}</span>
                        </div>
                        <p className="mt-1 text-gray-500">
                          {a.actor_email ?? 'unknown actor'}{a.ip_address ? ` • ${a.ip_address}` : ''}
                        </p>
                      </div>
                    ))}
                    {(detail.support_audit?.length ?? 0) === 0 && (
                      <p className="text-sm text-gray-400">No impersonation audit events</p>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="p-4 space-y-2">
                  <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">Actions</h4>

                  {/* Enable/Disable */}
                  {detail.workspace.disabled ? (
                    <button
                      onClick={() => setConfirmAction({
                        action: 'enable_workspace',
                        targetId: detail.workspace.id,
                        label: 'Enable this workspace?',
                      })}
                      className="flex items-center gap-2 w-full px-3 py-2 text-sm font-medium text-green-700 bg-green-50 rounded-lg hover:bg-green-100 transition-colors"
                    >
                      <CheckCircle className="w-4 h-4" />
                      Enable Workspace
                    </button>
                  ) : (
                    <button
                      onClick={() => setConfirmAction({
                        action: 'disable_workspace',
                        targetId: detail.workspace.id,
                        label: 'Disable this workspace? Users will not be able to access it.',
                      })}
                      className="flex items-center gap-2 w-full px-3 py-2 text-sm font-medium text-yellow-700 bg-yellow-50 rounded-lg hover:bg-yellow-100 transition-colors"
                    >
                      <Ban className="w-4 h-4" />
                      Disable Workspace
                    </button>
                  )}

                  {/* Force Plan */}
                  <div className="flex items-center gap-2">
                    <select
                      value={forcePlanId}
                      onChange={(e) => setForcePlanId(e.target.value)}
                      className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-2"
                    >
                      <option value="">Select plan...</option>
                      {(plans?.plans ?? []).map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => {
                        if (!forcePlanId) return;
                        setConfirmAction({
                          action: 'force_plan',
                          targetId: detail.workspace.id,
                          label: 'Force this plan on the workspace?',
                        });
                      }}
                      disabled={!forcePlanId}
                      className="px-3 py-2 text-sm font-medium text-purple-700 bg-purple-50 rounded-lg hover:bg-purple-100 transition-colors disabled:opacity-50"
                    >
                      <Crown className="w-4 h-4" />
                    </button>
                  </div>

                  {detail.license?.stripe_subscription_id && (
                    <button
                      onClick={() => setConfirmAction({
                        action: 'cancel_workspace_subscription',
                        targetId: detail.workspace.id,
                        label: `Cancel workspace Stripe subscription ${detail.license?.stripe_subscription_id}? This stops future renewals.`,
                      })}
                      className="flex items-center gap-2 w-full px-3 py-2 text-sm font-medium text-orange-700 bg-orange-50 rounded-lg hover:bg-orange-100 transition-colors"
                    >
                      <Ban className="w-4 h-4" />
                      Cancel Stripe Subscription
                    </button>
                  )}

                  {detail.users.length > 0 && (
                    <div className="flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50/60 px-3 py-2 text-xs text-blue-800">
                      <UserCheck className="w-4 h-4" />
                      Use the per-user buttons above to impersonate the correct customer user.
                    </div>
                  )}

                  {/* Purge */}
                  <button
                    onClick={() => setConfirmAction({
                      action: 'purge_data',
                      targetId: detail.workspace.id,
                      label: 'PURGE ALL DATA for this workspace? This action cannot be undone.',
                    })}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm font-medium text-red-700 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                    Purge All Data
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Confirmation Dialog */}
      {confirmAction && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-md mx-4 shadow-xl">
            <div className="flex items-start gap-3 mb-4">
              <AlertTriangle className="w-6 h-6 text-yellow-500 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold text-gray-900 mb-1">Confirm Action</h3>
                <p className="text-sm text-gray-600">{confirmAction.label}</p>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmAction(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (confirmAction.action === 'impersonate' && (!supportReason.trim() || !noticeAck)) {
                    return;
                  }
                  const params = confirmAction.action === 'force_plan'
                    ? { plan_id: forcePlanId }
                    : confirmAction.action === 'impersonate'
                    ? {
                        impersonation_mode: impersonationMode,
                        support_reason: supportReason.trim(),
                        support_ticket_ref: supportTicketRef.trim() || undefined,
                        customer_notice_acknowledged: noticeAck,
                      }
                    : undefined;
                  executeAction(confirmAction.action, confirmAction.targetId, params);
                }}
                disabled={actionMutation.isPending || (confirmAction.action === 'impersonate' && (!supportReason.trim() || !noticeAck))}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {actionMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  'Confirm'
                )}
              </button>
            </div>
            {confirmAction.action === 'impersonate' && (
              <div className="mt-4 space-y-3 border-t border-gray-100 pt-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Support Mode</label>
                  <select
                    value={impersonationMode}
                    onChange={(e) => setImpersonationMode(e.target.value as 'full' | 'read_only')}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  >
                    <option value="read_only">Read-only (Recommended)</option>
                    <option value="full">Full access</option>
                  </select>
                  <p className="mt-1 text-xs text-gray-500">
                    Read-only blocks mutating API requests in most customer workflows.
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Support Reason (Required)</label>
                  <textarea
                    rows={3}
                    value={supportReason}
                    onChange={(e) => setSupportReason(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    placeholder="Describe the issue and why impersonation is needed"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Ticket / Case Ref (Optional)</label>
                  <input
                    type="text"
                    value={supportTicketRef}
                    onChange={(e) => setSupportTicketRef(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    placeholder="e.g. CS-1428"
                  />
                </div>
                <label className="flex items-start gap-2 text-xs text-gray-700">
                  <input
                    type="checkbox"
                    checked={noticeAck}
                    onChange={(e) => setNoticeAck(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>I confirm customer notification / consent requirements have been handled per support policy.</span>
                </label>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function SuperadminUsers() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [confirmImpersonate, setConfirmImpersonate] = useState<{ userId: string; email: string } | null>(null);
  const [impersonationMode, setImpersonationMode] = useState<'full' | 'read_only'>('read_only');
  const [supportReason, setSupportReason] = useState('');
  const [supportTicketRef, setSupportTicketRef] = useState('');
  const [noticeAck, setNoticeAck] = useState(false);
  const [editingAccess, setEditingAccess] = useState<{
    userId: string;
    userEmail: string;
    workspaceId: string;
    workspaceName: string;
  } | null>(null);
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member' | 'viewer'>('member');
  const [inviteType, setInviteType] = useState<'workspace_access' | 'platform_access'>('workspace_access');
  const [inviteWorkspaceId, setInviteWorkspaceId] = useState('');
  const [inviteMakeSuperadmin, setInviteMakeSuperadmin] = useState(false);
  const [inviteFeedback, setInviteFeedback] = useState<{ success?: string; error?: string }>({});
  const [confirmDemote, setConfirmDemote] = useState<{ userId: string; email: string } | null>(null);
  const [confirmDeleteUser, setConfirmDeleteUser] = useState<{ userId: string; email: string } | null>(null);

  const { data, isLoading } = useQuery<{
    users: SuperadminUserListItem[];
    total: number;
    page: number;
    per_page: number;
  }>({
    queryKey: ['superadmin', 'users', page, search],
    queryFn: () =>
      apiClient.get(`/api/superadmin/users?page=${page}&per_page=25&search=${encodeURIComponent(search)}`),
  });
  const { data: workspaceOptions, isLoading: workspaceOptionsLoading } = useQuery<{
    workspaces: WorkspaceListItem[];
  }>({
    queryKey: ['superadmin', 'workspace-options'],
    queryFn: () => apiClient.get('/api/superadmin/workspaces?page=1&per_page=100'),
    enabled: showAddUserModal,
  });

  useEffect(() => {
    if (!showAddUserModal) return;
    if (inviteWorkspaceId) return;
    const firstWorkspaceId = workspaceOptions?.workspaces?.[0]?.id;
    if (firstWorkspaceId) setInviteWorkspaceId(firstWorkspaceId);
  }, [showAddUserModal, inviteWorkspaceId, workspaceOptions?.workspaces]);

  useEffect(() => {
    if (!confirmImpersonate) return;
    setImpersonationMode('read_only');
    setSupportReason('');
    setSupportTicketRef('');
    setNoticeAck(false);
  }, [confirmImpersonate?.userId]);

  const inviteUserMutation = useMutation({
    mutationFn: (body: {
      workspace_id?: string;
      email: string;
      role?: 'owner' | 'admin' | 'member' | 'viewer';
      invite_type?: 'workspace_access' | 'platform_access';
    }) =>
      apiClient.post<{ message: string }>('/api/workspaces/invite', body),
  });
  const grantSuperadminMutation = useMutation({
    mutationFn: (targetId: string) =>
      apiClient.post<{ message: string }>('/api/superadmin/actions', {
        action: 'grant_superadmin',
        target_id: targetId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['superadmin', 'users'] });
    },
  });
  const revokeSuperadminMutation = useMutation({
    mutationFn: (targetId: string) =>
      apiClient.post<{ message: string }>('/api/superadmin/actions', {
        action: 'revoke_superadmin',
        target_id: targetId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['superadmin', 'users'] });
      setConfirmDemote(null);
    },
  });
  const deleteUserMutation = useMutation({
    mutationFn: (targetId: string) =>
      apiClient.post<{ message: string }>('/api/superadmin/actions', {
        action: 'delete_user',
        target_id: targetId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['superadmin', 'users'] });
      setConfirmDeleteUser(null);
    },
  });
  const impersonateMutation = useMutation({
    mutationFn: (params: {
      target_id: string;
      impersonation_mode: 'full' | 'read_only';
      support_reason: string;
      support_ticket_ref?: string;
      customer_notice_acknowledged: boolean;
    }) =>
      apiClient.post<{ message: string }>('/api/superadmin/actions', {
        action: 'impersonate',
        target_id: params.target_id,
        params: {
          impersonation_mode: params.impersonation_mode,
          support_reason: params.support_reason,
          support_ticket_ref: params.support_ticket_ref || undefined,
          customer_notice_acknowledged: params.customer_notice_acknowledged,
        },
      }),
    onSuccess: () => {
      window.location.href = '/';
    },
  });

  const handleAddUser = async () => {
    if (!inviteEmail.trim()) return;
    if (inviteType === 'workspace_access' && !inviteWorkspaceId) return;
    setInviteFeedback({});
    const email = inviteEmail.trim().toLowerCase();
    const isPlatformInvite = inviteType === 'platform_access';

    try {
      await inviteUserMutation.mutateAsync({
        ...(isPlatformInvite ? {} : { workspace_id: inviteWorkspaceId }),
        email,
        role: isPlatformInvite ? 'owner' : inviteRole,
        invite_type: inviteType,
      });

      let promoteNote = '';
      if (inviteMakeSuperadmin) {
        const lookup = await apiClient.get<{
          users: SuperadminUserListItem[];
        }>(`/api/superadmin/users?page=1&per_page=5&search=${encodeURIComponent(email)}`);
        const existing = (lookup.users ?? []).find((u) => u.email.toLowerCase() === email);
        if (existing) {
          await grantSuperadminMutation.mutateAsync(existing.id);
          promoteNote = ' Superadmin access granted.';
        } else {
          promoteNote = ' Promote to superadmin after they create/accept the account.';
        }
      }

      setInviteFeedback({ success: `Invite sent.${promoteNote}`.trim() });
      setInviteEmail('');
      setInviteRole('member');
      setInviteType('workspace_access');
      setInviteMakeSuperadmin(false);
      queryClient.invalidateQueries({ queryKey: ['superadmin', 'users'] });
    } catch (err) {
      setInviteFeedback({
        error: err instanceof Error ? err.message : 'Failed to invite user',
      });
    }
  };

  const isAddUserPending = inviteUserMutation.isPending || grantSuperadminMutation.isPending;

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.per_page)) : 1;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Users</h1>
        <button
          type="button"
          onClick={() => {
            setInviteFeedback({});
            setShowAddUserModal(true);
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          Add User
        </button>
      </div>

      <div className="flex gap-4 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search users..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400 mx-auto" />
          </div>
        ) : (
          <>
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-6 py-3">User</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-6 py-3">Access</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-6 py-3">MFA</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-6 py-3">Workspaces</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-6 py-3">Last Login</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-6 py-3">Created</th>
                </tr>
              </thead>
              <tbody>
                {(data?.users ?? []).map((user) => (
                  <tr key={user.id} className="border-b border-gray-50 align-top">
                    <td className="px-6 py-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">{user.email}</div>
                        <div className="text-xs text-gray-500">
                          {[user.first_name, user.last_name].filter(Boolean).join(' ') || 'No name set'}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {!user.is_superadmin && (
                            <button
                              type="button"
                              onClick={() => setConfirmImpersonate({ userId: user.id, email: user.email })}
                              className="rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
                            >
                              Impersonate
                            </button>
                          )}
                          {!user.is_superadmin && (
                            <button
                              type="button"
                              onClick={() => grantSuperadminMutation.mutate(user.id)}
                              disabled={grantSuperadminMutation.isPending}
                              className="rounded-md bg-purple-50 px-2 py-1 text-xs font-medium text-purple-700 hover:bg-purple-100 disabled:opacity-50"
                            >
                              {grantSuperadminMutation.isPending ? 'Promoting…' : 'Promote'}
                            </button>
                          )}
                          {user.is_superadmin && (
                            <button
                              type="button"
                              onClick={() => setConfirmDemote({ userId: user.id, email: user.email })}
                              disabled={revokeSuperadminMutation.isPending}
                              className="rounded-md bg-purple-50 px-2 py-1 text-xs font-medium text-purple-700 hover:bg-purple-100 disabled:opacity-50"
                            >
                              Demote
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteUser({ userId: user.id, email: user.email })}
                            disabled={deleteUserMutation.isPending}
                            className="rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex flex-wrap gap-1">
                        {user.is_superadmin && (
                          <span className="inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
                            Superadmin
                          </span>
                        )}
                        {!user.is_superadmin && (
                          <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                            Standard User
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-3">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        user.totp_enabled ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                      }`}>
                        {user.totp_enabled ? 'Enabled' : 'Not enabled'}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      <div className="text-xs text-gray-500 mb-1">{user.workspace_count} assigned</div>
                      <div className="flex flex-wrap gap-2 max-w-xl">
                        {user.workspaces.map((ws) => (
                          <div
                            key={`${user.id}:${ws.id}`}
                            className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700"
                            title={`${ws.name} (${ws.role})`}
                          >
                            <span>
                              {ws.name} ({ws.role}) · {ws.access_scope === 'scoped'
                                ? `${ws.environment_count ?? 0}e/${ws.group_count ?? 0}g`
                                : 'workspace'}
                            </span>
                            <button
                              type="button"
                              onClick={() => setEditingAccess({
                                userId: user.id,
                                userEmail: user.email,
                                workspaceId: ws.id,
                                workspaceName: ws.name,
                              })}
                              className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-medium text-blue-700 hover:bg-white"
                            >
                              Edit
                            </button>
                          </div>
                        ))}
                        {user.workspaces.length === 0 && (
                          <span className="text-xs text-gray-400">No workspace memberships</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-3 text-sm text-gray-600">
                      {user.last_login_at ? (
                        <div>
                          <div>{new Date(user.last_login_at).toLocaleString()}</div>
                          <div className="text-xs text-gray-400">{user.last_login_method ?? 'unknown method'}</div>
                        </div>
                      ) : (
                        <span className="text-gray-400">Never</span>
                      )}
                    </td>
                    <td className="px-6 py-3 text-sm text-gray-500">
                      {formatDate(user.created_at)}
                    </td>
                  </tr>
                ))}
                {(data?.users?.length ?? 0) === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-sm text-gray-400">
                      No users found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {data && data.total > data.per_page && (
              <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100">
                <p className="text-sm text-gray-500">{data.total} total users</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-3 py-1 text-sm border border-gray-300 rounded-md disabled:opacity-50"
                  >
                    Prev
                  </button>
                  <span className="px-3 py-1 text-sm text-gray-600">{page} / {totalPages}</span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="px-3 py-1 text-sm border border-gray-300 rounded-md disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {showAddUserModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xl rounded-xl border border-gray-200 bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Add User</h2>
                <p className="text-sm text-gray-500">
                  {inviteType === 'platform_access'
                    ? 'Invite an operator/MSP user to create their own workspace during onboarding, with optional superadmin promotion.'
                    : 'Invite a user into a workspace, with optional superadmin promotion.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddUserModal(false)}
                className="rounded-md px-2 py-1 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-700"
              >
                Close
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Invite Type</label>
                <select
                  value={inviteType}
                  onChange={(e) => setInviteType(e.target.value as 'workspace_access' | 'platform_access')}
                  disabled={isAddUserPending}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="workspace_access">Workspace team invite (default)</option>
                  <option value="platform_access">Platform/operator invite</option>
                </select>
                <p className="mt-1 text-xs text-gray-500">
                  {inviteType === 'workspace_access'
                    ? 'Best for team/customer invites into an existing workspace. Registration will not create a new workspace.'
                    : 'For operators/MSPs onboarding to the platform. Registration includes creating their own workspace and uploading their own Google credentials.'}
                </p>
              </div>

              {inviteType === 'workspace_access' && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Workspace</label>
                  <select
                    value={inviteWorkspaceId}
                    onChange={(e) => setInviteWorkspaceId(e.target.value)}
                    disabled={workspaceOptionsLoading || isAddUserPending}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  >
                    <option value="">
                      {workspaceOptionsLoading ? 'Loading workspaces...' : 'Select workspace'}
                    </option>
                    {(workspaceOptions?.workspaces ?? []).map((ws) => (
                      <option key={ws.id} value={ws.id}>
                        {ws.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Email</label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  disabled={isAddUserPending}
                  placeholder="user@example.com"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>

              {inviteType === 'workspace_access' && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Workspace Role</label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as 'admin' | 'member' | 'viewer')}
                    disabled={isAddUserPending}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  >
                    <option value="admin">Admin</option>
                    <option value="member">Member</option>
                    <option value="viewer">Viewer</option>
                  </select>
                </div>
              )}

              <label className="flex items-start gap-2 rounded-lg border border-purple-100 bg-purple-50/60 px-3 py-2 text-sm text-purple-900">
                <input
                  type="checkbox"
                  checked={inviteMakeSuperadmin}
                  onChange={(e) => setInviteMakeSuperadmin(e.target.checked)}
                  disabled={isAddUserPending}
                  className="mt-0.5"
                />
                <span>
                  Also grant platform superadmin access if this email already belongs to an existing account.
                  <span className="block text-xs text-purple-700 mt-0.5">
                    If they have not signed up yet, invite is still sent and you can promote later.
                  </span>
                </span>
              </label>

              {inviteFeedback.error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {inviteFeedback.error}
                </div>
              )}
              {inviteFeedback.success && (
                <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                  {inviteFeedback.success}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddUserModal(false)}
                  disabled={isAddUserPending}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleAddUser}
                  disabled={isAddUserPending || !inviteEmail.trim() || (inviteType === 'workspace_access' && !inviteWorkspaceId)}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {isAddUserPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Send Invite
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {editingAccess && (
        <UserAccessAssignmentsModal
          open={!!editingAccess}
          workspaceId={editingAccess.workspaceId}
          workspaceName={editingAccess.workspaceName}
          userId={editingAccess.userId}
          userEmail={editingAccess.userEmail}
          currentUserRole="owner"
          currentEnvironmentRole="owner"
          isSuperadmin={true}
          canManageWorkspaceUsers={true}
          actingEnvironmentId={null}
          viewerAccessScope="workspace"
          onClose={() => setEditingAccess(null)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['superadmin', 'users'] });
          }}
        />
      )}
      {confirmImpersonate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xl rounded-xl border border-gray-200 bg-white p-6 shadow-xl">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Impersonate User</h2>
              <p className="text-sm text-gray-500">
                You are about to sign in as <span className="font-medium text-gray-700">{confirmImpersonate.email}</span> for support/troubleshooting.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Mode</label>
                <select
                  value={impersonationMode}
                  onChange={(e) => setImpersonationMode(e.target.value as 'full' | 'read_only')}
                  disabled={impersonateMutation.isPending}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="read_only">Read-only (recommended)</option>
                  <option value="full">Full access</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Support Reason</label>
                <textarea
                  value={supportReason}
                  onChange={(e) => setSupportReason(e.target.value)}
                  disabled={impersonateMutation.isPending}
                  rows={3}
                  placeholder="Describe the issue and why impersonation is needed"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Ticket Reference (optional)</label>
                <input
                  type="text"
                  value={supportTicketRef}
                  onChange={(e) => setSupportTicketRef(e.target.value)}
                  disabled={impersonateMutation.isPending}
                  placeholder="e.g. INC-1234"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>

              <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <input
                  type="checkbox"
                  checked={noticeAck}
                  onChange={(e) => setNoticeAck(e.target.checked)}
                  disabled={impersonateMutation.isPending}
                  className="mt-0.5"
                />
                <span>I confirm the customer notice/authorization requirement has been acknowledged for this support action.</span>
              </label>

              {impersonateMutation.error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {impersonateMutation.error instanceof Error ? impersonateMutation.error.message : 'Failed to start impersonation'}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setConfirmImpersonate(null)}
                  disabled={impersonateMutation.isPending}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => impersonateMutation.mutate({
                    target_id: confirmImpersonate.userId,
                    impersonation_mode: impersonationMode,
                    support_reason: supportReason.trim(),
                    support_ticket_ref: supportTicketRef.trim(),
                    customer_notice_acknowledged: noticeAck,
                  })}
                  disabled={impersonateMutation.isPending || !supportReason.trim() || !noticeAck}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {impersonateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Start Impersonation
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {confirmDemote && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-gray-900">Revoke Superadmin Access</h2>
            <p className="mt-2 text-sm text-gray-600">
              Revoke platform superadmin access from <span className="font-medium text-gray-800">{confirmDemote.email}</span>?
            </p>
            {revokeSuperadminMutation.error && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {revokeSuperadminMutation.error instanceof Error ? revokeSuperadminMutation.error.message : 'Failed to revoke superadmin access'}
              </div>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDemote(null)}
                disabled={revokeSuperadminMutation.isPending}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => revokeSuperadminMutation.mutate(confirmDemote.userId)}
                disabled={revokeSuperadminMutation.isPending}
                className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
              >
                {revokeSuperadminMutation.isPending ? 'Revoking…' : 'Revoke'}
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmDeleteUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-red-200 bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-gray-900">Permanently Delete User</h2>
            <p className="mt-2 text-sm text-gray-600">
              Permanently delete <span className="font-medium text-gray-800">{confirmDeleteUser.email}</span>?
            </p>
            <p className="mt-1 text-xs text-red-700">
              This currently requires the user to be removed from all workspaces first.
            </p>
            {deleteUserMutation.error && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {deleteUserMutation.error instanceof Error ? deleteUserMutation.error.message : 'Failed to delete user'}
              </div>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteUser(null)}
                disabled={deleteUserMutation.isPending}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => deleteUserMutation.mutate(confirmDeleteUser.userId)}
                disabled={deleteUserMutation.isPending}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleteUserMutation.isPending ? 'Deleting…' : 'Delete User'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function SuperadminStats() {
  const LIVE_REFRESH_MS = 30000;
  const { data: stats, isLoading, dataUpdatedAt: statsUpdatedAt } = useQuery<PlatformStats>({
    queryKey: ['superadmin', 'stats'],
    queryFn: () => apiClient.get<PlatformStats>('/api/superadmin/stats'),
    refetchInterval: LIVE_REFRESH_MS,
    refetchIntervalInBackground: true,
  });

  if (isLoading || !stats) {
    return (
      <div>
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-gray-900">Platform Statistics</h1>
          <LivePageIndicator intervalMs={LIVE_REFRESH_MS} lastUpdatedAt={statsUpdatedAt} />
        </div>
        <div className="animate-pulse space-y-6">
          <div className="h-48 bg-gray-100 rounded-xl" />
          <div className="h-48 bg-gray-100 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold text-gray-900">Platform Statistics</h1>
        <LivePageIndicator intervalMs={LIVE_REFRESH_MS} lastUpdatedAt={statsUpdatedAt} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Devices by plan */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Device Distribution by Plan</h2>
          {stats.devices_by_plan.length > 0 ? (
            <div className="space-y-4">
              {stats.devices_by_plan.map((item) => {
                const total = stats.total_devices || 1;
                const pct = Math.round((item.device_count / total) * 100);
                return (
                  <div key={item.plan_name}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-medium text-gray-700">{item.plan_name}</span>
                      <span className="text-gray-500">{item.device_count} ({pct}%)</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div
                        className="h-2 rounded-full bg-blue-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-gray-400">No data available</p>
          )}
        </div>

        {/* Signup trend */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Signup Trend (Last 30 Days)</h2>
          {stats.recent_signups.length > 0 ? (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {stats.recent_signups.map((item) => (
                <div key={item.date} className="flex items-center justify-between text-sm py-1">
                  <span className="text-gray-600">{formatDate(item.date)}</span>
                  <div className="flex items-center gap-2">
                    <div className="w-24 bg-gray-100 rounded-full h-1.5">
                      <div
                        className="h-1.5 rounded-full bg-green-500"
                        style={{ width: `${Math.min(100, (item.count / Math.max(...stats.recent_signups.map(s => s.count))) * 100)}%` }}
                      />
                    </div>
                    <span className="font-medium text-gray-900 w-8 text-right">{item.count}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400">No signups in the last 30 days</p>
          )}
        </div>

        {/* Summary card */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Platform Summary</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
            <div className="text-center">
              <p className="text-3xl font-bold text-gray-900">{stats.total_workspaces}</p>
              <p className="text-sm text-gray-500 mt-1">Workspaces</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold text-gray-900">{stats.total_environments}</p>
              <p className="text-sm text-gray-500 mt-1">Environments</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold text-gray-900">{stats.total_devices}</p>
              <p className="text-sm text-gray-500 mt-1">Devices</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold text-gray-900">{stats.total_users}</p>
              <p className="text-sm text-gray-500 mt-1">Users</p>
            </div>
          </div>
        </div>

        {/* Function logs */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-6">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Logs</h2>
              <p className="text-sm text-gray-500">
                Collapsed function log sections. Starting with Pub/Sub webhook ingestion events.
              </p>
            </div>
          </div>
          <details className="group rounded-lg border border-gray-200">
            <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">pubsub-webhook</p>
                <p className="text-xs text-gray-500">
                  Recent webhook events with decoded payload preview (when blob capture exists)
                </p>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-400 transition-transform group-open:rotate-90" />
            </summary>
            <div className="border-t border-gray-100 px-4 py-3">
              {stats.function_logs?.pubsub_webhook?.events?.length ? (
                <div className="space-y-2 max-h-[34rem] overflow-y-auto">
                  {stats.function_logs.pubsub_webhook.events.map((event) => (
                    <details key={`${event.environment_id}:${event.message_id}`} className="rounded-md border border-gray-200 bg-gray-50">
                      <summary className="cursor-pointer list-none px-3 py-2">
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="font-mono text-gray-700">{event.notification_type}</span>
                            <span className={`rounded px-2 py-0.5 ${
                              event.status === 'processed'
                                ? 'bg-green-100 text-green-700'
                                : event.status === 'pending'
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'bg-red-100 text-red-700'
                            }`}>
                              {event.status}
                            </span>
                            <span className="text-gray-500">
                              {new Date(event.created_at).toLocaleString()}
                            </span>
                          </div>
                          <span className="font-mono text-[11px] text-gray-500 break-all">{event.message_id}</span>
                        </div>
                        {event.device_amapi_name && (
                          <p className="mt-1 text-xs text-gray-600 break-all">{event.device_amapi_name}</p>
                        )}
                      </summary>
                      <div className="border-t border-gray-200 bg-white px-3 py-2 space-y-2">
                        {event.error && (
                          <div className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
                            {event.error}
                          </div>
                        )}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                          <div>
                            <span className="text-gray-500">Environment:</span>{' '}
                            <span className="font-mono text-gray-700">{event.environment_id}</span>
                          </div>
                          <div>
                            <span className="text-gray-500">Processed:</span>{' '}
                            <span className="text-gray-700">
                              {event.processed_at ? new Date(event.processed_at).toLocaleString() : 'Not yet'}
                            </span>
                          </div>
                        </div>
                        <pre className="rounded bg-gray-900 text-gray-100 text-xs p-3 overflow-x-auto">
                          {JSON.stringify(event.raw_preview ?? { payload: null }, null, 2)}
                        </pre>
                      </div>
                    </details>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400">No Pub/Sub webhook events found.</p>
              )}
            </div>
          </details>
          <details className="group mt-3 rounded-lg border border-gray-200">
            <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">derivative-selection</p>
                <p className="text-xs text-gray-500">
                  Cross-workspace device derivative decisions (scope selection and no-op/assign outcomes)
                </p>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-400 transition-transform group-open:rotate-90" />
            </summary>
            <div className="border-t border-gray-100 px-4 py-3">
              {stats.function_logs?.derivative_selection?.events?.length ? (
                <div className="space-y-2 max-h-[34rem] overflow-y-auto">
                  {stats.function_logs.derivative_selection.events.map((event) => (
                    <details key={event.id} className="rounded-md border border-gray-200 bg-gray-50">
                      <summary className="cursor-pointer list-none px-3 py-2">
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="font-mono text-gray-700">{event.details.reason_code ?? 'UNKNOWN'}</span>
                            <span className={`rounded px-2 py-0.5 ${
                              event.details.can_noop ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                            }`}>
                              {event.details.can_noop ? 'noop' : 'assign'}
                            </span>
                            <span className="text-gray-500">{new Date(event.created_at).toLocaleString()}</span>
                          </div>
                          <span className="text-xs text-gray-500 truncate max-w-[280px]">
                            {event.workspace_name ?? event.workspace_id ?? 'Unknown workspace'}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-gray-600 break-all">
                          {event.serial_number ?? event.device_amapi_name ?? event.device_id ?? 'Unknown device'}
                        </p>
                      </summary>
                      <div className="border-t border-gray-200 bg-white px-3 py-2 space-y-2">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                          <div>
                            <span className="text-gray-500">Workspace:</span>{' '}
                            <span className="text-gray-700">{event.workspace_name ?? event.workspace_id ?? 'Unknown'}</span>
                          </div>
                          <div>
                            <span className="text-gray-500">Environment:</span>{' '}
                            <span className="text-gray-700">{event.environment_name ?? event.environment_id ?? 'Unknown'}</span>
                          </div>
                          <div>
                            <span className="text-gray-500">Expected scope:</span>{' '}
                            <span className="font-mono text-gray-700">{event.details.expected_scope ?? 'N/A'}</span>
                          </div>
                          <div>
                            <span className="text-gray-500">Expected AMAPI:</span>{' '}
                            <span className="font-mono text-gray-700 break-all">{event.details.expected_amapi_name ?? 'N/A'}</span>
                          </div>
                        </div>
                        <pre className="rounded bg-gray-900 text-gray-100 text-xs p-3 overflow-x-auto">
                          {JSON.stringify(event.details, null, 2)}
                        </pre>
                      </div>
                    </details>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400">No derivative decision events found.</p>
              )}
            </div>
          </details>
          <details className="group mt-3 rounded-lg border border-gray-200">
            <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">job-queue</p>
                <p className="text-xs text-gray-500">
                  Cross-worker queue state (pending/locked/completed/dead) with payload summaries.
                </p>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-400 transition-transform group-open:rotate-90" />
            </summary>
            <div className="border-t border-gray-100 px-4 py-3">
              {stats.function_logs?.job_queue?.events?.length ? (
                <div className="space-y-2 max-h-[34rem] overflow-y-auto">
                  {stats.function_logs.job_queue.events.map((event) => (
                    <details key={event.id} className="rounded-md border border-gray-200 bg-gray-50">
                      <summary className="cursor-pointer list-none px-3 py-2">
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="font-mono text-gray-700">{event.job_type}</span>
                            <span className={`rounded px-2 py-0.5 ${
                              event.status === 'completed'
                                ? 'bg-green-100 text-green-700'
                                : event.status === 'dead'
                                  ? 'bg-red-100 text-red-700'
                                  : event.status === 'locked'
                                    ? 'bg-blue-100 text-blue-700'
                                    : 'bg-amber-100 text-amber-700'
                            }`}>
                              {event.status}
                            </span>
                            <span className="text-gray-500">{new Date(event.created_at).toLocaleString()}</span>
                          </div>
                          <span className="text-xs text-gray-500 truncate max-w-[280px]">
                            {event.environment_name ?? event.environment_id ?? 'No environment'}
                          </span>
                        </div>
                      </summary>
                      <div className="border-t border-gray-200 bg-white px-3 py-2 space-y-2">
                        {event.error && (
                          <div className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
                            {event.error}
                          </div>
                        )}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                          <div>
                            <span className="text-gray-500">Attempts:</span>{' '}
                            <span className="text-gray-700">{event.attempts}/{event.max_attempts}</span>
                          </div>
                          <div>
                            <span className="text-gray-500">Completed:</span>{' '}
                            <span className="text-gray-700">
                              {event.completed_at ? new Date(event.completed_at).toLocaleString() : 'Not yet'}
                            </span>
                          </div>
                        </div>
                        <pre className="rounded bg-gray-900 text-gray-100 text-xs p-3 overflow-x-auto">
                          {JSON.stringify(event.payload_summary ?? {}, null, 2)}
                        </pre>
                      </div>
                    </details>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400">No job queue events found.</p>
              )}
            </div>
          </details>
          <details className="group mt-3 rounded-lg border border-gray-200">
            <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">workflow-execution</p>
                <p className="text-xs text-gray-500">
                  Recent workflow evaluator outcomes from background execution records.
                </p>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-400 transition-transform group-open:rotate-90" />
            </summary>
            <div className="border-t border-gray-100 px-4 py-3">
              {stats.function_logs?.workflow_execution?.events?.length ? (
                <div className="space-y-2 max-h-[34rem] overflow-y-auto">
                  {stats.function_logs.workflow_execution.events.map((event) => (
                    <details key={event.id} className="rounded-md border border-gray-200 bg-gray-50">
                      <summary className="cursor-pointer list-none px-3 py-2">
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="font-mono text-gray-700">{event.workflow_name ?? event.workflow_id}</span>
                            <span className={`rounded px-2 py-0.5 ${
                              event.status === 'success'
                                ? 'bg-green-100 text-green-700'
                                : event.status === 'failed'
                                  ? 'bg-red-100 text-red-700'
                                  : event.status === 'skipped'
                                    ? 'bg-gray-100 text-gray-700'
                                    : 'bg-amber-100 text-amber-700'
                            }`}>
                              {event.status}
                            </span>
                            <span className="text-gray-500">{new Date(event.created_at).toLocaleString()}</span>
                          </div>
                          <span className="text-xs text-gray-500 truncate max-w-[280px]">
                            {event.environment_name ?? event.environment_id ?? 'Unknown environment'}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-gray-600 break-all">
                          {event.serial_number ?? event.device_amapi_name ?? event.device_id ?? 'Unknown device'}
                        </p>
                      </summary>
                      <div className="border-t border-gray-200 bg-white px-3 py-2 space-y-2">
                        <pre className="rounded bg-gray-900 text-gray-100 text-xs p-3 overflow-x-auto">
                          {JSON.stringify(event.result_preview ?? {}, null, 2)}
                        </pre>
                      </div>
                    </details>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400">No workflow execution events found.</p>
              )}
            </div>
          </details>
          <details className="group mt-3 rounded-lg border border-gray-200">
            <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">geofence-worker</p>
                <p className="text-xs text-gray-500">
                  Geofence enter/exit detections and associated context from scheduled checks.
                </p>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-400 transition-transform group-open:rotate-90" />
            </summary>
            <div className="border-t border-gray-100 px-4 py-3">
              {stats.function_logs?.geofence_worker?.events?.length ? (
                <div className="space-y-2 max-h-[34rem] overflow-y-auto">
                  {stats.function_logs.geofence_worker.events.map((event) => (
                    <details key={event.id} className="rounded-md border border-gray-200 bg-gray-50">
                      <summary className="cursor-pointer list-none px-3 py-2">
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="font-mono text-gray-700">{event.action}</span>
                            <span className={`rounded px-2 py-0.5 ${
                              event.action === 'geofence.device_enter'
                                ? 'bg-green-100 text-green-700'
                                : 'bg-amber-100 text-amber-700'
                            }`}>
                              {event.action === 'geofence.device_enter' ? 'enter' : 'exit'}
                            </span>
                            <span className="text-gray-500">{new Date(event.created_at).toLocaleString()}</span>
                          </div>
                          <span className="text-xs text-gray-500 truncate max-w-[280px]">
                            {event.environment_name ?? event.environment_id ?? 'Unknown environment'}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-gray-600 break-all">
                          {event.serial_number ?? event.device_amapi_name ?? event.device_id ?? 'Unknown device'}
                        </p>
                      </summary>
                      <div className="border-t border-gray-200 bg-white px-3 py-2 space-y-2">
                        <pre className="rounded bg-gray-900 text-gray-100 text-xs p-3 overflow-x-auto">
                          {JSON.stringify(event.details ?? {}, null, 2)}
                        </pre>
                      </div>
                    </details>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400">No geofence worker events found.</p>
              )}
            </div>
          </details>
          <details className="group mt-3 rounded-lg border border-gray-200">
            <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">sync-reconcile</p>
                <p className="text-xs text-gray-500">
                  Reconciliation and enterprise upgrade sync outcomes emitted by background workers.
                </p>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-400 transition-transform group-open:rotate-90" />
            </summary>
            <div className="border-t border-gray-100 px-4 py-3">
              {stats.function_logs?.sync_reconcile?.events?.length ? (
                <div className="space-y-2 max-h-[34rem] overflow-y-auto">
                  {stats.function_logs.sync_reconcile.events.map((event) => (
                    <details key={event.id} className="rounded-md border border-gray-200 bg-gray-50">
                      <summary className="cursor-pointer list-none px-3 py-2">
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="font-mono text-gray-700">{event.action}</span>
                            <span className="text-gray-500">{new Date(event.created_at).toLocaleString()}</span>
                          </div>
                          <span className="text-xs text-gray-500 truncate max-w-[280px]">
                            {event.environment_name ?? event.environment_id ?? 'Unknown environment'}
                          </span>
                        </div>
                      </summary>
                      <div className="border-t border-gray-200 bg-white px-3 py-2 space-y-2">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                          <div>
                            <span className="text-gray-500">Resource type:</span>{' '}
                            <span className="text-gray-700">{event.resource_type ?? 'N/A'}</span>
                          </div>
                          <div>
                            <span className="text-gray-500">Resource ID:</span>{' '}
                            <span className="font-mono text-gray-700 break-all">{event.resource_id ?? 'N/A'}</span>
                          </div>
                        </div>
                        <pre className="rounded bg-gray-900 text-gray-100 text-xs p-3 overflow-x-auto">
                          {JSON.stringify(event.details ?? {}, null, 2)}
                        </pre>
                      </div>
                    </details>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400">No sync/reconcile events found.</p>
              )}
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}

// Default export — the dashboard route within SuperadminLayout
export default SuperadminDashboard;
