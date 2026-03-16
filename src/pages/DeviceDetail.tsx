import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/client';
import StatusBadge from '@/components/common/StatusBadge';
import DeviceOverview from '@/components/device/DeviceOverview';
import DeviceInfo from '@/components/device/DeviceInfo';
import DeviceAppInventory from '@/components/device/DeviceAppInventory';
import DeviceAuditLog from '@/components/device/DeviceAuditLog';
import DeviceLocationHistory from '@/components/device/DeviceLocationHistory';
import DeviceRawSnapshot from '@/components/device/DeviceRawSnapshot';
import DeviceOperations from '@/components/device/DeviceOperations';
import CommandModal from '@/components/device/CommandModal';
import ConfirmModal from '@/components/common/ConfirmModal';
import LivePageIndicator from '@/components/common/LivePageIndicator';
import PageLoadingState from '@/components/common/PageLoadingState';
import PolicyAssignmentSelect from '@/components/policy/PolicyAssignmentSelect';
import PolicyOverrideEditor from '@/components/policy/PolicyOverrideEditor';
import { useDeleteDevice } from '@/api/queries/devices';
import { useEffectivePolicy, useExternalPolicy, usePolicy } from '@/api/queries/policies';
import { useGroups } from '@/api/queries/groups';
import { usePolicyOverride } from '@/api/queries/policy-overrides';
import { useAppFeedbackList, type AppFeedbackItem } from '@/api/queries/app-feedback';
import { groupAppFeedbackItems } from '@/components/device/appFeedbackGrouping';
import { ArrowLeft, Lock, RotateCcw, Trash2, Terminal, Loader2, FileJson, RefreshCw, Pencil, Check, X, FolderTree, Info, ExternalLink, ChevronDown, ChevronRight, AlertCircle } from 'lucide-react';
import { useEnvironmentGuard } from '@/hooks/useEnvironmentGuard';
import { useContextStore } from '@/stores/context';
import { getDeviceDisplayState } from '@/lib/device-state';
import clsx from 'clsx';

interface Device {
  id: string;
  environment_id: string;
  group_id: string | null;
  group_name: string | null;
  policy_id: string | null;
  amapi_name: string;
  name: string | null;
  serial_number: string | null;
  imei: string | null;
  manufacturer: string | null;
  model: string | null;
  os_version: string | null;
  security_patch_level: string | null;
  state: string;
  ownership: string | null;
  management_mode: string | null;
  policy_compliant: boolean | null;
  enrollment_time: string | null;
  last_status_report_at: string | null;
  snapshot: Record<string, any> | null;
}

interface Application {
  package_name: string;
  display_name: string;
  version_name: string;
  version_code: string | number;
  state: string;
  icon_url?: string | null;
}

interface AuditEntry {
  action: string;
  resource_type: string;
  details: Record<string, any> | string | null;
  created_at: string;
}

interface LocationRecord {
  latitude: number;
  longitude: number;
  accuracy: number;
  recorded_at: string;
}

interface StatusReport {
  id: string;
  [key: string]: any;
}

interface DeviceDetailResponse {
  device: Device;
  applications: Application[];
  status_reports: StatusReport[];
  locations: LocationRecord[];
  audit_log: AuditEntry[];
  policy_resolution?: DevicePolicyResolution;
}

interface DerivativeSummary {
  policy_id: string;
  scope_type: 'environment' | 'group' | 'device';
  scope_id: string;
  scope_name: string | null;
  amapi_name: string;
  payload_hash: string;
  metadata?: Record<string, unknown>;
}

interface DevicePolicyResolution {
  base_policy: {
    policy_id: string;
    policy_name: string;
    source: 'device' | 'device_legacy' | 'group' | 'environment';
    source_id: string;
    source_name: string | null;
  } | null;
  amapi: {
    applied_policy_name: string | null;
    expected_policy_name: string | null;
    matches_expected: boolean | null;
  };
  expected_derivative: DerivativeSummary | null;
  applied_derivative: DerivativeSummary | null;
  overrides: {
    environment: { apps: string[]; networks: string[] };
    groups: Array<{ group_id: string; group_name: string; depth: number; apps: string[]; networks: string[] }>;
    device: { apps: string[]; networks: string[] };
    device_scoped_variables: string[];
    requires_per_device_derivative: boolean;
  };
}

function humanizeEnum(value: string | undefined | null): string | null {
  if (!value) return null;
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function describeNonCompliance(detail: Record<string, any>) {
  const settingName = humanizeEnum(detail.settingName) ?? 'Policy setting';
  const packageName = detail.packageName as string | undefined;
  const reason = humanizeEnum(detail.nonComplianceReason);
  const installFailureReason = humanizeEnum(detail.installationFailureReason);

  if (detail.settingName === 'applications' && packageName) {
    if (detail.nonComplianceReason === 'APP_NOT_INSTALLED' && detail.installationFailureReason === 'IN_PROGRESS') {
      return {
        title: 'App install in progress',
        body: `${packageName} is still installing.`,
        meta: [settingName, 'Expected state: Installed'],
      };
    }

    return {
      title: 'App compliance issue',
      body: `${packageName}${reason ? `: ${reason}.` : ' is non-compliant.'}`,
      meta: [settingName, installFailureReason ? `Install status: ${installFailureReason}` : null].filter(Boolean) as string[],
    };
  }

  return {
    title: reason ?? 'Non-compliance detected',
    body: settingName,
    meta: [],
  };
}

type TabKey = 'overview' | 'info' | 'policy' | 'applications' | 'audit' | 'operations' | 'location' | 'raw';

function isDeviceTabKey(value: string | null): value is TabKey {
  return value === 'overview'
    || value === 'info'
    || value === 'policy'
    || value === 'applications'
    || value === 'audit'
    || value === 'operations'
    || value === 'location'
    || value === 'raw';
}

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'info', label: 'Info' },
  { key: 'policy', label: 'Policy' },
  { key: 'applications', label: 'Applications' },
  { key: 'audit', label: 'Audit' },
  { key: 'operations', label: 'Operations' },
  { key: 'location', label: 'Location' },
  { key: 'raw', label: 'Raw' },
];

function severityPillClass(severity: string | null): string {
  switch (severity) {
    case 'ERROR':
      return 'bg-red-100 text-red-700';
    case 'WARNING':
      return 'bg-amber-100 text-amber-800';
    case 'INFO':
      return 'bg-blue-100 text-blue-700';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

function feedbackStatusPillClass(status: string): string {
  switch (status.toLowerCase()) {
    case 'open':
      return 'bg-amber-100 text-amber-800';
    case 'resolved':
      return 'bg-green-100 text-green-700';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

function formatDateTime(value: string | null): string {
  if (!value) return 'Unknown';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function DeviceAppFeedbackSection({
  environmentId,
  deviceId,
}: {
  environmentId: string;
  deviceId: string;
}) {
  const [expanded, setExpanded] = useState(true);
  const [collapsedApps, setCollapsedApps] = useState<Set<string>>(new Set());
  const appFeedbackQuery = useAppFeedbackList({
    environment_id: environmentId,
    device_id: deviceId,
    limit: 100,
  });
  const feedbackItems = appFeedbackQuery.data?.items ?? [];
  const groupedFeedback = useMemo(
    () => groupAppFeedbackItems(feedbackItems),
    [feedbackItems]
  );
  useEffect(() => {
    setCollapsedApps((previous) => {
      const available = new Set(groupedFeedback.map((group) => group.package_name));
      return new Set(Array.from(previous).filter((pkg) => available.has(pkg)));
    });
  }, [groupedFeedback]);

  const toggleAppCollapsed = (packageName: string) => {
    setCollapsedApps((previous) => {
      const next = new Set(previous);
      if (next.has(packageName)) {
        next.delete(packageName);
      } else {
        next.add(packageName);
      }
      return next;
    });
  };

  return (
    <section className="rounded-xl border border-border bg-surface">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-surface-secondary transition-colors"
      >
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown className="h-4 w-4 text-gray-500" /> : <ChevronRight className="h-4 w-4 text-gray-500" />}
          <h3 className="text-sm font-semibold text-gray-900">App Feedback</h3>
          <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
            {groupedFeedback.length}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border px-4 py-3">
          {appFeedbackQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading app feedback...
            </div>
          ) : appFeedbackQuery.isError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              Failed to load app feedback for this device.
            </div>
          ) : feedbackItems.length === 0 ? (
            <p className="text-sm text-gray-500">
              No app feedback has been reported by this device yet. Feedback appears automatically when managed apps publish keyed app state.
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">
                {groupedFeedback.length} app{groupedFeedback.length !== 1 ? 's' : ''}, {feedbackItems.length} feedback item{feedbackItems.length !== 1 ? 's' : ''}
              </p>
              {groupedFeedback.map((group) => {
                const appCollapsed = collapsedApps.has(group.package_name);
                return (
                  <article key={group.package_name} className="rounded-lg border border-border bg-surface-secondary p-3">
                    <button
                      type="button"
                      onClick={() => toggleAppCollapsed(group.package_name)}
                      className="flex w-full items-start justify-between gap-2 text-left"
                    >
                      <div className="flex min-w-0 items-start gap-2">
                        {appCollapsed ? (
                          <ChevronRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-500" />
                        ) : (
                          <ChevronDown className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-500" />
                        )}
                        <div>
                          <p className="text-sm font-medium text-gray-900 break-all">{group.package_name}</p>
                          <p className="mt-1 text-xs text-gray-500">
                            Last report: {formatDateTime(group.latest_reported_at)}
                            {' · '}
                            Open: {group.open_count}/{group.total_count}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={clsx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', severityPillClass(group.severity))}>
                          {group.severity ?? 'UNKNOWN'}
                        </span>
                        {group.open_count > 0 && (
                          <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                            {group.open_count} open
                          </span>
                        )}
                      </div>
                    </button>

                    {!appCollapsed && (
                      <div className="mt-3 space-y-2">
                        {group.items.map((item: AppFeedbackItem) => (
                          <div key={item.id} className="rounded-md border border-gray-200 bg-white px-3 py-2">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <p className="text-xs font-medium text-gray-800 break-all">{item.feedback_key}</p>
                              <span className={clsx('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium', feedbackStatusPillClass(item.status))}>
                                {item.status}
                              </span>
                            </div>
                            {item.message && (
                              <p className="mt-1 text-sm text-gray-700 break-words">{item.message}</p>
                            )}
                            <p className="mt-1 text-xs text-gray-500">
                              Updated: {formatDateTime(item.last_reported_at)}
                              {item.status === 'open' && <AlertCircle className="ml-1 inline h-3.5 w-3.5 text-amber-600" />}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default function DeviceDetail() {
  const LIVE_REFRESH_MS = 30000;
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (() => {
    const tabParam = searchParams.get('tab');
    return isDeviceTabKey(tabParam) ? tabParam : 'overview';
  })();
  const [commandModalOpen, setCommandModalOpen] = useState(false);
  const [initialCommand, setInitialCommand] = useState<string | undefined>(undefined);
  const [showExternalPolicy, setShowExternalPolicy] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const deleteDevice = useDeleteDevice();
  const queryClient = useQueryClient();

  const refreshMutation = useMutation({
    mutationFn: () => apiClient.post(`/api/devices/${id}`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devices', id] });
    },
  });

  const renameMutation = useMutation({
    mutationFn: (name: string) => apiClient.put(`/api/devices/${id}`, { name }),
    onSuccess: () => {
      setEditingName(false);
      queryClient.invalidateQueries({ queryKey: ['devices'] });
    },
  });

  const groupMutation = useMutation({
    mutationFn: (group_id: string | null) => apiClient.put(`/api/devices/${id}`, { group_id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devices'] });
      queryClient.invalidateQueries({ queryKey: ['policies'] });
      queryClient.invalidateQueries({ queryKey: ['policy-override'] });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
    },
  });

  const { data, isLoading, isError, error, dataUpdatedAt } = useQuery({
    queryKey: ['devices', id],
    queryFn: () => apiClient.get<DeviceDetailResponse>(`/api/devices/${id}`),
    enabled: !!id,
    refetchInterval: LIVE_REFRESH_MS,
    refetchIntervalInBackground: true,
  });

  useEnvironmentGuard(data?.device?.environment_id, '/devices');

  const { data: effectivePolicy } = useEffectivePolicy(id);
  const groups = useGroups(data?.device?.environment_id ?? '');
  const appliedAmapiPolicyName = typeof data?.device?.snapshot?.appliedPolicyName === 'string'
    ? data.device.snapshot.appliedPolicyName
    : undefined;
  const {
    data: externalPolicy,
    isLoading: externalPolicyLoading,
    isError: externalPolicyError,
    error: externalPolicyErrorObj,
  } = useExternalPolicy(
    data?.device?.environment_id,
    appliedAmapiPolicyName,
    showExternalPolicy,
    id
  );
  const matchedLocalExternalPolicy = externalPolicy?.local_policy ?? null;
  const environments = useContextStore((s) => s.environments);
  const deviceForHooks = data?.device;
  const policyResolutionForHooks = data?.policy_resolution;
  const basePolicyId = policyResolutionForHooks?.base_policy?.policy_id ?? undefined;
  const groupIdForHooks = deviceForHooks?.group_id ?? undefined;
  const deviceIdForHooks = deviceForHooks?.id ?? undefined;
  const { data: basePolicyData } = usePolicy(basePolicyId ?? '');
  const { data: groupPolicyOverrides } = usePolicyOverride(
    basePolicyId,
    groupIdForHooks ? 'group' : undefined,
    groupIdForHooks,
  );
  const { data: devicePolicyOverrides } = usePolicyOverride(
    basePolicyId,
    deviceIdForHooks ? 'device' : undefined,
    deviceIdForHooks,
  );

  const renderOverrideList = (items: string[], empty = 'None') => {
    if (!items.length) return <span className="text-xs text-muted">{empty}</span>;
    return (
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span
            key={item}
            className="inline-flex max-w-full items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-700 break-all"
            title={item}
          >
            {item}
          </span>
        ))}
      </div>
    );
  };

  useEffect(() => {
    const currentTab = searchParams.get('tab');
    if (currentTab && isDeviceTabKey(currentTab)) return;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('tab', 'overview');
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

  if (isLoading) {
    return <PageLoadingState label="Loading device details…" compact />;
  }

  if (isError) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => navigate('/devices')}
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-gray-900 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to devices
        </button>
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm text-red-800">
            {(error as Error)?.message || 'Failed to load device details.'}
          </p>
        </div>
      </div>
    );
  }

  if (!data?.device) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => navigate('/devices')}
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-gray-900 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to devices
        </button>
        <div className="rounded-xl border border-border bg-surface p-6 text-center">
          <p className="text-sm text-muted">Device not found.</p>
        </div>
      </div>
    );
  }

  const { device, applications = [], locations = [], audit_log = [], policy_resolution } = data;
  const deviceDisplayName = device.name || [device.manufacturer, device.model].filter(Boolean).join(' ') || device.serial_number || device.amapi_name;
  const deviceDisplayState = getDeviceDisplayState(device);
  const environmentName = environments.find((env) => env.id === device.environment_id)?.name ?? 'Environment';
  const directGroupOverride = policy_resolution?.overrides.groups.find((g) => g.depth === 0) ?? null;
  const hasPolicyMismatch = policy_resolution?.amapi.matches_expected === false;
  const appliedBranchType = policy_resolution?.expected_derivative?.scope_type ?? null;

  const appliedSource = policy_resolution?.base_policy?.source ?? effectivePolicy?.source ?? null;
  const appliedSourceLabel = appliedSource === 'group'
    ? 'Group'
    : (appliedSource === 'device' || appliedSource === 'device_legacy')
      ? 'Device'
      : 'Environment';
  const appliedPolicyDisplay = policy_resolution?.base_policy?.policy_name
    ? `${policy_resolution.base_policy.policy_name} ${appliedSourceLabel}`
    : 'No local policy';
  const appliedOverrideDisplay = appliedBranchType === 'group'
    ? `Group override: ${policy_resolution?.expected_derivative?.scope_name ?? directGroupOverride?.group_name ?? 'Unknown group'}`
    : appliedBranchType === 'device'
      ? `Device override: ${deviceDisplayName}`
      : null;

  const appAssignmentBuckets: Array<{ label: string; items: string[] }> = [
    { label: environmentName, items: policy_resolution?.overrides.environment.apps ?? [] },
    ...(policy_resolution?.overrides.groups ?? []).map((g) => ({
      label: g.depth === 0 ? (g.group_name || 'group') : `${g.group_name} (ancestor)`,
      items: g.apps,
    })),
    { label: `${deviceDisplayName} (direct assign)`, items: policy_resolution?.overrides.device.apps ?? [] },
  ];

  const networkAssignmentBuckets: Array<{ label: string; items: string[] }> = [
    { label: environmentName, items: policy_resolution?.overrides.environment.networks ?? [] },
    ...(policy_resolution?.overrides.groups ?? []).map((g) => ({
      label: g.depth === 0 ? (g.group_name || 'group') : `${g.group_name} (ancestor)`,
      items: g.networks,
    })),
    { label: `${deviceDisplayName} (direct assign)`, items: policy_resolution?.overrides.device.networks ?? [] },
  ];

  const hasMeaningfulValue = (value: unknown): boolean => {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (typeof value === 'number' || typeof value === 'boolean') return true;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
    return false;
  };
  const countConfiguredTopLevelSections = (config: Record<string, unknown> | null | undefined): number => {
    if (!config || typeof config !== 'object') return 0;
    return Object.entries(config).reduce((total, [_, value]) => (
      hasMeaningfulValue(value) ? total + 1 : total
    ), 0);
  };
  const countOverrideSections = (overrideConfig: Record<string, unknown> | undefined): number => {
    if (!overrideConfig) return 0;
    return Object.entries(overrideConfig).reduce((total, [_, value]) => (
      hasMeaningfulValue(value) ? total + 1 : total
    ), 0);
  };

  const basePolicyConfiguredSections = countConfiguredTopLevelSections(
    (basePolicyData?.policy?.config as Record<string, unknown> | undefined) ?? undefined,
  );
  const groupOverrideSections = countOverrideSections(groupPolicyOverrides?.override_config)
    + ((directGroupOverride?.apps.length ?? 0) > 0 ? 1 : 0)
    + ((directGroupOverride?.networks.length ?? 0) > 0 ? 1 : 0);
  const groupOverrideItems = countOverrideSections(groupPolicyOverrides?.override_config)
    + (directGroupOverride?.apps.length ?? 0)
    + (directGroupOverride?.networks.length ?? 0);
  const deviceOverrideSections = countOverrideSections(devicePolicyOverrides?.override_config)
    + ((policy_resolution?.overrides.device.apps.length ?? 0) > 0 ? 1 : 0)
    + ((policy_resolution?.overrides.device.networks.length ?? 0) > 0 ? 1 : 0)
    + ((policy_resolution?.overrides.device_scoped_variables.length ?? 0) > 0 ? 1 : 0);
  const deviceOverrideItems = countOverrideSections(devicePolicyOverrides?.override_config)
    + (policy_resolution?.overrides.device.apps.length ?? 0)
    + (policy_resolution?.overrides.device.networks.length ?? 0)
    + (policy_resolution?.overrides.device_scoped_variables.length ?? 0);
  const getDerivativeAmapiIdForScope = (scope: 'environment' | 'group' | 'device') => {
    if (policy_resolution?.applied_derivative?.scope_type === scope && policy_resolution.applied_derivative.amapi_name) {
      return policy_resolution.applied_derivative.amapi_name;
    }
    if (policy_resolution?.expected_derivative?.scope_type === scope && policy_resolution.expected_derivative.amapi_name) {
      return policy_resolution.expected_derivative.amapi_name;
    }
    return null;
  };
  const assignedPolicyAmapiId = getDerivativeAmapiIdForScope('environment')
    ?? policy_resolution?.amapi.expected_policy_name
    ?? policy_resolution?.amapi.applied_policy_name
    ?? null;
  const groupPolicyAmapiId = getDerivativeAmapiIdForScope('group');
  const devicePolicyAmapiId = getDerivativeAmapiIdForScope('device');

  const copyValue = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // no-op
    }
  };

  return (
    <div className="space-y-6">
      {/* Back nav */}
      <button
        type="button"
        onClick={() => navigate('/devices')}
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-gray-900 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to devices
      </button>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            {editingName ? (
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (nameInput.trim()) renameMutation.mutate(nameInput.trim());
                }}
              >
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  autoFocus
                  className="text-2xl font-bold text-gray-900 border-b-2 border-accent bg-transparent outline-none px-0 py-0"
                />
                <button
                  type="submit"
                  disabled={renameMutation.isPending || !nameInput.trim()}
                  className="p-1 text-green-600 hover:text-green-700 disabled:opacity-50"
                >
                  <Check className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={() => setEditingName(false)}
                  className="p-1 text-gray-400 hover:text-gray-600"
                >
                  <X className="h-5 w-5" />
                </button>
              </form>
            ) : (
              <div className="flex items-center gap-2">
                <h1
                  className="text-2xl font-bold text-gray-900 group cursor-pointer"
                  onClick={() => { setNameInput(device.name || deviceDisplayName); setEditingName(true); }}
                  title="Click to rename"
                >
                  {deviceDisplayName}
                  <Pencil className="inline ml-2 h-4 w-4 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                </h1>
                <LivePageIndicator intervalMs={LIVE_REFRESH_MS} lastUpdatedAt={dataUpdatedAt} />
              </div>
            )}
            {editingName && <LivePageIndicator intervalMs={LIVE_REFRESH_MS} lastUpdatedAt={dataUpdatedAt} />}
            <StatusBadge status={deviceDisplayState} />
          </div>
          {device.serial_number && (
            <p className="mt-1 text-sm text-muted">
              S/N: {device.serial_number}
              {device.os_version && <> &middot; Android {device.os_version}</>}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
            title="Refresh from AMAPI"
          >
            <RefreshCw className={`h-4 w-4 ${refreshMutation.isPending ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={() => { setInitialCommand('LOCK'); setCommandModalOpen(true); }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 transition-colors"
            title="Lock device"
          >
            <Lock className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => { setInitialCommand('REBOOT'); setCommandModalOpen(true); }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 transition-colors"
            title="Reboot device"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => { setInitialCommand('WIPE'); setCommandModalOpen(true); }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-100 px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-200 transition-colors"
            title="Wipe device"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setDeleteModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-danger px-3 py-2 text-sm font-medium text-white hover:bg-danger/90 transition-colors"
            title="Delete device"
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </button>
          <button
            type="button"
            onClick={() => { setInitialCommand(undefined); setCommandModalOpen(true); }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <Terminal className="h-4 w-4" />
            More…
          </button>
        </div>
      </div>

      {/* Tab navigation */}
      <div className="border-b border-border">
        <nav className="-mb-px flex gap-6 overflow-x-auto" aria-label="Tabs">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => {
                const nextParams = new URLSearchParams(searchParams);
                nextParams.set('tab', tab.key);
                setSearchParams(nextParams, { replace: true });
              }}
              className={clsx(
                'whitespace-nowrap border-b-2 py-3 text-sm font-medium transition-colors',
                activeTab === tab.key
                  ? 'border-accent text-accent'
                  : 'border-transparent text-muted hover:border-gray-300 hover:text-gray-700',
              )}
            >
              {tab.label}
              {tab.key === 'applications' && applications.length > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                  {applications.length}
                </span>
              )}
              {tab.key === 'audit' && audit_log.length > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                  {audit_log.length}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      <div>
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <DeviceOverview device={{ ...device, state: deviceDisplayState }} applications={applications} />

            {/* Group & Policy quick actions */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="rounded-xl border border-border bg-surface p-5">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Group</h3>
                <div className="flex items-center gap-2">
                  <FolderTree className="h-4 w-4 text-muted flex-shrink-0" />
                  <select
                    value={device.group_id ?? ''}
                    onChange={(e) => groupMutation.mutate(e.target.value || null)}
                    disabled={groupMutation.isPending}
                    className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-50"
                  >
                    <option value="">No group</option>
                    {(groups.data ?? []).map((g) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                </div>
                {device.group_name && (
                  <p className="text-xs text-muted mt-2">
                    Policies and deployments assigned to this group (and its ancestors) are inherited by this device.
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-border bg-surface p-5">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Policy</h3>
                <PolicyAssignmentSelect
                  scopeType="device"
                  scopeId={device.id}
                  environmentId={device.environment_id}
                  currentPolicyId={effectivePolicy?.policy_id ?? device.policy_id}
                  currentSource={effectivePolicy?.source ?? undefined}
                />
                {effectivePolicy?.policy_id && (
                  <div className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2">
                    <p className="text-xs text-gray-600">
                      <span className="font-medium">Effective:</span>{' '}
                      <span className="text-accent">{effectivePolicy.policy_name}</span>
                      <span className="text-muted ml-1">
                        ({effectivePolicy.source === 'device_legacy' ? 'device (legacy)' : effectivePolicy.source})
                      </span>
                    </p>
                    <button
                      type="button"
                      onClick={() => navigate(`/policies/${effectivePolicy.policy_id}`)}
                      className="rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors flex-shrink-0"
                    >
                      View
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'info' && <DeviceInfo device={device} />}

        {activeTab === 'policy' && (
          <div className="rounded-xl border border-border bg-surface p-6">
            <div className="space-y-6">
              <div className="rounded-lg border border-border bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-800">Policy compliance</span>
                      {device.policy_compliant === null ? (
                        <span className="text-sm text-muted">Unknown</span>
                      ) : device.policy_compliant ? (
                        <StatusBadge status="COMPLIANT" />
                      ) : (
                        <StatusBadge status="NON_COMPLIANT" />
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-medium text-gray-700">Device sync</span>
                      <span className={clsx(
                        'inline-flex items-center rounded-full px-2 py-0.5',
                        hasPolicyMismatch ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800',
                      )}>
                        {hasPolicyMismatch ? 'Reported policy mismatch' : 'In sync'}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {policy_resolution?.base_policy?.policy_id && (
                      <button
                        type="button"
                        onClick={() => navigate(`/policies/${policy_resolution.base_policy?.policy_id}`)}
                        className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        Open Policy
                      </button>
                    )}
                    {policy_resolution?.expected_derivative?.amapi_name && (
                      <button
                        type="button"
                        onClick={() => copyValue(policy_resolution.expected_derivative!.amapi_name)}
                        className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        Copy Expected ID
                      </button>
                    )}
                    {policy_resolution?.amapi.applied_policy_name && (
                      <button
                        type="button"
                        onClick={() => copyValue(policy_resolution.amapi.applied_policy_name!)}
                        className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        Copy Reported ID
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {device.snapshot?.nonComplianceDetails &&
                Array.isArray(device.snapshot.nonComplianceDetails) &&
                device.snapshot.nonComplianceDetails.length > 0 && (
                  <div className="mt-4">
                    <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">
                      Policy Exceptions
                    </h4>
                    <div className="space-y-2">
                      {device.snapshot.nonComplianceDetails.map(
                        (detail: Record<string, any>, idx: number) => (
                          <div
                            key={idx}
                            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900"
                          >
                            {(() => {
                              const parsed = describeNonCompliance(detail);
                              return (
                                <div className="space-y-1.5">
                                  <div className="font-medium">{parsed.title}</div>
                                  <div className="text-red-800 break-words">{parsed.body}</div>
                                  {parsed.meta.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                                      {parsed.meta.map((item) => (
                                        <span
                                          key={item}
                                          className="inline-flex items-center rounded-full border border-red-200 bg-white/70 px-2 py-0.5 text-xs text-red-700"
                                        >
                                          {item}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                  <details className="pt-1">
                                    <summary className="cursor-pointer text-xs text-red-700 hover:text-red-900">
                                      Raw details
                                    </summary>
                                    <pre className="mt-2 whitespace-pre-wrap break-words text-xs text-red-800">
                                      {JSON.stringify(detail, null, 2)}
                                    </pre>
                                  </details>
                                </div>
                              );
                            })()}
                          </div>
                        ),
                      )}
                    </div>
                  </div>
                )}

              {policy_resolution && (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div className="rounded-lg border border-border bg-white p-4 space-y-4">
                    <div>
                      <h4 className="text-sm font-semibold text-gray-900">Applied policy</h4>
                      <p className="mt-1 text-base text-gray-900">{appliedPolicyDisplay}</p>
                      {appliedOverrideDisplay && (
                        <p className="mt-1 text-xs text-muted">{appliedOverrideDisplay}</p>
                      )}
                      {policy_resolution.base_policy?.policy_id && (
                        <button
                          type="button"
                          onClick={() => navigate(`/policies/${policy_resolution.base_policy?.policy_id}`)}
                          className="mt-2 rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                        >
                          Open Policy
                        </button>
                      )}
                    </div>

                    <div className="space-y-2 rounded-md border border-gray-100 bg-gray-50 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <h5 className="text-xs font-semibold uppercase tracking-wider text-gray-700">Assigned applications</h5>
                        <button
                          type="button"
                          onClick={() => navigate('/applications')}
                          title="Open Applications"
                          className="inline-flex items-center rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {appAssignmentBuckets.map((bucket) => (
                        <div key={`apps-${bucket.label}`} className="space-y-1">
                          <p className="text-xs font-medium text-gray-700">{bucket.label}</p>
                          {renderOverrideList(bucket.items)}
                        </div>
                      ))}
                    </div>

                    <div className="space-y-2 rounded-md border border-gray-100 bg-gray-50 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <h5 className="text-xs font-semibold uppercase tracking-wider text-gray-700">Assigned networks</h5>
                        <button
                          type="button"
                          onClick={() => navigate('/networks')}
                          title="Open Networks"
                          className="inline-flex items-center rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {networkAssignmentBuckets.map((bucket) => (
                        <div key={`nets-${bucket.label}`} className="space-y-1">
                          <p className="text-xs font-medium text-gray-700">{bucket.label}</p>
                          {renderOverrideList(bucket.items)}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className={clsx(
                    'rounded-lg border bg-white p-4 space-y-4',
                    hasPolicyMismatch ? 'border-amber-300' : 'border-border',
                  )}>
                    <div>
                      <h4 className="text-sm font-semibold text-gray-900">Policy tree</h4>
                      <p className="text-xs text-muted mt-1">Resolved inheritance path for this device.</p>
                    </div>

                    <div className="space-y-2 text-sm border-l-2 border-gray-200 pl-3">
                      {(() => {
                        const isApplied = appliedBranchType === 'environment';
                        return (
                          <div className={clsx(
                            'rounded-md border px-3 py-2 ml-0',
                            isApplied
                              ? (hasPolicyMismatch ? 'border-amber-300 bg-amber-50' : 'border-emerald-300 bg-emerald-50')
                              : 'border-border bg-surface',
                            isApplied && 'font-semibold',
                          )}>
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-600">Assigned policy</p>
                              {assignedPolicyAmapiId && (
                                <button
                                  type="button"
                                  title={`AMAPI policy ID: ${assignedPolicyAmapiId}. Click to copy.`}
                                  onClick={() => copyValue(assignedPolicyAmapiId)}
                                  className="inline-flex items-center rounded p-0.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 cursor-copy"
                                >
                                  <Info className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => policy_resolution.base_policy?.policy_id && navigate(`/policies/${policy_resolution.base_policy.policy_id}`)}
                              className="mt-1 text-left text-gray-900 hover:text-accent transition-colors"
                            >
                              {policy_resolution.base_policy?.policy_name ?? 'No local policy'}
                            </button>
                            <p className="text-xs text-muted mt-1">
                              {basePolicyConfiguredSections} section{basePolicyConfiguredSections !== 1 ? 's' : ''} configured
                            </p>
                          </div>
                        );
                      })()}

                      {device.group_name && (
                        (() => {
                          const isApplied = appliedBranchType === 'group';
                          return (
                            <div className={clsx(
                              'ml-3 rounded-md border px-3 py-2',
                              isApplied
                                ? (hasPolicyMismatch ? 'border-amber-300 bg-amber-50' : 'border-emerald-300 bg-emerald-50')
                                : 'border-border bg-surface',
                              isApplied && 'font-semibold',
                            )}>
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-600">Group</p>
                                {groupPolicyAmapiId && (
                                  <button
                                    type="button"
                                    title={`AMAPI policy ID: ${groupPolicyAmapiId}. Click to copy.`}
                                    onClick={() => copyValue(groupPolicyAmapiId)}
                                    className="inline-flex items-center rounded p-0.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 cursor-copy"
                                  >
                                    <Info className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => navigate('/groups')}
                                className="mt-1 text-left text-gray-900 hover:text-accent transition-colors"
                              >
                                {device.group_name}
                              </button>
                              <p className="text-xs text-muted mt-1">
                                Overrides: {groupOverrideSections} section{groupOverrideSections !== 1 ? 's' : ''} ({groupOverrideItems} item{groupOverrideItems !== 1 ? 's' : ''})
                              </p>
                            </div>
                          );
                        })()
                      )}

                      <div className={clsx(
                        'ml-6 rounded-md border px-3 py-2',
                        appliedBranchType === 'device'
                          ? (hasPolicyMismatch ? 'border-amber-300 bg-amber-50' : 'border-emerald-300 bg-emerald-50')
                          : 'border-border bg-surface',
                        appliedBranchType === 'device' && 'font-semibold',
                      )}>
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-600">This device</p>
                          {devicePolicyAmapiId && (
                            <button
                              type="button"
                              title={`AMAPI policy ID: ${devicePolicyAmapiId}. Click to copy.`}
                              onClick={() => copyValue(devicePolicyAmapiId)}
                              className="inline-flex items-center rounded p-0.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 cursor-copy"
                            >
                              <Info className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                        <p className="mt-1 text-gray-900">{deviceDisplayName}</p>
                        <p className="text-xs text-muted mt-1">
                          Overrides: {deviceOverrideSections} section{deviceOverrideSections !== 1 ? 's' : ''} ({deviceOverrideItems} item{deviceOverrideItems !== 1 ? 's' : ''})
                        </p>
                      </div>
                    </div>

                    {hasPolicyMismatch && (
                      <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                        <p className="font-medium">Reported policy from device doesn&apos;t match assigned. Device may need to sync.</p>
                        <div className="mt-1 flex items-center gap-2">
                          <span className="break-all">{policy_resolution.amapi.applied_policy_name ?? 'Unknown'}</span>
                          {policy_resolution.amapi.applied_policy_name && (
                            <button
                              type="button"
                              title={`Copy reported AMAPI policy: ${policy_resolution.amapi.applied_policy_name}`}
                              onClick={() => copyValue(policy_resolution.amapi.applied_policy_name!)}
                              className="text-amber-700 hover:text-amber-900"
                            >
                              <Info className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Device-level policy overrides */}
              {effectivePolicy?.policy_id && (
                <div className="border-t border-gray-200 pt-4">
                  <PolicyOverrideEditor
                    policyId={effectivePolicy.policy_id}
                    scopeType="device"
                    scopeId={device.id}
                    environmentId={device.environment_id}
                  />
                </div>
              )}

              {appliedAmapiPolicyName && (
                <div className="border-t border-border pt-4 space-y-3">
                  <div className="space-y-2">
                    <div className="text-sm text-muted">
                      Device-reported AMAPI Policy: {appliedAmapiPolicyName}
                      {device.snapshot?.appliedPolicyVersion && (
                        <> (v{device.snapshot.appliedPolicyVersion})</>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowExternalPolicy((v) => !v)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      <FileJson className="h-3.5 w-3.5" />
                      {showExternalPolicy ? 'Hide AMAPI Policy JSON' : 'View AMAPI Policy JSON'}
                    </button>
                  </div>

                  {showExternalPolicy && (
                    <div className="rounded-lg border border-border bg-surface-secondary p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h4 className="text-sm font-semibold text-gray-900">External AMAPI Policy</h4>
                          <p className="text-xs text-muted mt-1 break-all">{appliedAmapiPolicyName}</p>
                        </div>
                        {matchedLocalExternalPolicy ? (
                          <button
                            type="button"
                            onClick={() => navigate(`/policies/${matchedLocalExternalPolicy.id}`)}
                            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                          >
                            Open Local Policy
                          </button>
                        ) : (
                          <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">
                            External only (not imported)
                          </span>
                        )}
                      </div>

                      {externalPolicyLoading && (
                        <div className="flex items-center gap-2 text-sm text-muted">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Loading AMAPI policy...
                        </div>
                      )}

                      {externalPolicyError && (
                        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                          {(externalPolicyErrorObj as Error)?.message || 'Failed to load AMAPI policy.'}
                        </div>
                      )}

                      {externalPolicy?.policy && (
                        <div className="rounded-lg border border-border bg-surface p-3 overflow-auto max-h-[420px]">
                          <pre className="text-xs leading-relaxed whitespace-pre-wrap break-words">
                            {JSON.stringify(externalPolicy.policy, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'applications' && (
          <div className="space-y-4">
            <DeviceAppFeedbackSection
              environmentId={device.environment_id}
              deviceId={device.id}
            />
            <DeviceAppInventory applications={applications} />
          </div>
        )}

        {activeTab === 'audit' && <DeviceAuditLog entries={audit_log} />}

        {activeTab === 'operations' && <DeviceOperations deviceId={device.id} />}

        {activeTab === 'location' && <DeviceLocationHistory locations={locations} />}

        {activeTab === 'raw' && <DeviceRawSnapshot snapshot={device.snapshot} />}
      </div>

      {/* Command modal */}
      <CommandModal
        key={`device-command-${commandModalOpen ? 'open' : 'closed'}-${initialCommand ?? 'none'}`}
        open={commandModalOpen}
        onClose={() => { setCommandModalOpen(false); setInitialCommand(undefined); }}
        deviceId={device.id}
        deviceName={deviceDisplayName}
        initialCommand={initialCommand}
      />

      {/* Delete confirmation modal */}
      <ConfirmModal
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={() => {
          deleteDevice.mutate(device.id, {
            onSuccess: () => navigate('/devices'),
          });
        }}
        title="Delete device"
        message={`This will remove "${deviceDisplayName}" from AMAPI (triggering a remote wipe) and delete it from Flash. This action cannot be undone.`}
        confirmLabel="Delete device"
        variant="danger"
        loading={deleteDevice.isPending}
      />
    </div>
  );
}
