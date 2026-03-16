import { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Save,
  ArrowLeft,
  Code,
  FormInput,
  ShieldCheck,
  FileText,
  Archive,
  Info,
  Upload,
  Loader2,
} from 'lucide-react';
import clsx from 'clsx';
import { apiClient } from '@/api/client';
import { useContextStore } from '@/stores/context';
import { useEnvironmentGuard } from '@/hooks/useEnvironmentGuard';
import PolicyCategoryNav from '@/components/policy/PolicyCategoryNav';
import PolicyFormSection from '@/components/policy/PolicyFormSection';
import PolicyJsonEditor from '@/components/policy/PolicyJsonEditor';
import PolicyDerivativesPanel from '@/components/policy/PolicyDerivativesPanel';
import PageLoadingState from '@/components/common/PageLoadingState';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Policy {
  id: string;
  environment_id: string;
  name: string;
  description: string | null;
  deployment_scenario: string;
  config: Record<string, any>;
  amapi_name: string | null;
  version: number;
  status: string;
  created_at: string;
  updated_at: string;
}

interface CreatePolicyResponse {
  policy: Policy;
}

interface UpdatePolicyResponse {
  message: string;
  version: number;
  amapi_status?: number | null;
  amapi_error?: string | null;
  policy_generation?: Record<string, unknown>;
}

interface PolicySaveWarning {
  amapi_status?: number | null;
  amapi_error?: string | null;
  message: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, { bg: string; text: string; icon: typeof ShieldCheck }> = {
  draft: { bg: 'bg-gray-100', text: 'text-gray-700', icon: FileText },
  production: { bg: 'bg-green-100', text: 'text-green-700', icon: ShieldCheck },
  archived: { bg: 'bg-amber-100', text: 'text-amber-700', icon: Archive },
};

const SCENARIO_OPTIONS = [
  { value: 'fm', label: 'Fully Managed', description: 'Full device management. Best for company-owned devices.' },
  { value: 'wp', label: 'Work Profile', description: 'Separate work profile on personal or corporate devices.' },
  { value: 'dedicated', label: 'Dedicated', description: 'Locked-down kiosk or single-purpose devices.' },
];

/** Set a deeply nested value by dot-separated path, returning a new object. */
function setDeep(obj: Record<string, any>, path: string, value: any): Record<string, any> {
  const keys = path.split('.');
  const result = { ...obj };
  let current: any = result;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    current[key] = current[key] != null ? { ...current[key] } : {};
    current = current[key];
  }
  current[keys[keys.length - 1]] = value;
  return result;
}

/** Documentation map: category -> help text */
const CATEGORY_HELP: Record<string, { title: string; description: string; docLink?: string }> = {
  password: {
    title: 'Password Requirements',
    description:
      'Define password complexity, length, and lifecycle requirements. These settings apply to either the device or work profile depending on the deployment scenario. Strong passwords protect devices against brute-force attacks and unauthorized access.',
    docLink: 'https://developers.google.com/android/management/reference/rest/v1/enterprises.policies#PasswordRequirements',
  },
  screenLock: {
    title: 'Screen Lock',
    description:
      'Configure automatic screen locking behaviour including the maximum idle time before lock engages, and which features remain accessible on the lock screen such as camera, notifications, and trust agents.',
  },
  deviceSettings: {
    title: 'Device Settings',
    description:
      'Control general device capabilities such as camera access, screenshots, factory reset protection, account management, USB file transfer, Bluetooth, and external media mounting.',
  },
  network: {
    title: 'Network',
    description:
      'Manage WiFi configuration, tethering, mobile network settings, VPN, and global HTTP proxy. Network escape hatch allows temporary connectivity during provisioning.',
  },
  applications: {
    title: 'Applications',
    description:
      'Configure which applications are available, force-installed, or blocked. Set the default runtime permission policy and control the Play Store mode (allowlist vs open). Each application entry defines a package name and install type.',
  },
  security: {
    title: 'Security',
    description:
      'Manage device encryption, debugging access, safe boot, and advanced security overrides such as Google Play Protect verification and developer settings access.',
  },
  systemUpdates: {
    title: 'System Updates',
    description:
      'Define how OTA system updates and app auto-updates are handled. Options include automatic, windowed (within a daily maintenance window), or postponed updates.',
  },
  permissions: {
    title: 'Permissions',
    description:
      'Set the default runtime permission policy (prompt, grant, or deny) and define per-permission grants for specific Android permissions.',
  },
  statusReporting: {
    title: 'Status Reporting',
    description:
      'Enable or disable various device telemetry reports including application inventory, hardware status, memory, network info, display, software info, and power management events.',
  },
  personalUsage: {
    title: 'Personal Usage (Work Profile)',
    description:
      'Policies that govern the personal side of a work-profile deployment. Control personal Play Store access, camera, screen capture, and set a maximum number of days the work profile can remain off.',
  },
  kioskMode: {
    title: 'Kiosk Mode (Fully Managed)',
    description:
      'Lock the device into a focused, single-purpose experience. Configure the status bar, power button, system navigation, device settings access, and error warning visibility.',
  },
  complianceRules: {
    title: 'Compliance Rules',
    description:
      'Define conditions that trigger compliance actions. When a device does not meet a specified setting requirement, the configured action (such as disabling apps) is applied automatically.',
  },
  crossProfile: {
    title: 'Cross-Profile',
    description:
      'Manage how data flows between work and personal profiles including copy/paste, data sharing intents, work contacts visibility in personal apps, and widget placement.',
  },
  location: {
    title: 'Location',
    description:
      'Control the device location mode (high accuracy, sensors only, battery saving, off) and whether location sharing is permitted.',
  },
  advanced: {
    title: 'Advanced',
    description:
      'Additional policy settings including volume control, wallpaper, outgoing calls, SMS, data roaming, network reset, first-use hints, Play Protect, and admin support messages.',
  },
  derivatives: {
    title: 'Policy Derivatives',
    description:
      'Policy derivatives are scope-specific variations of this policy that are pushed to AMAPI. Each derivative targets a specific scope (environment, group, or device) and includes merged network and app deployments for that scope.',
  },
};

// ─── Component ──────────────────────────────────────────────────────────────

export default function PolicyEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const activeEnvironment = useContextStore((s) => s.activeEnvironment);
  const environmentId = activeEnvironment?.id;

  const isNew = !id;

  // ── Local state ──
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scenario, setScenario] = useState('fm');
  const [config, setConfig] = useState<Record<string, any>>({});
  const [activeCategory, setActiveCategory] = useState('password');
  const [viewMode, setViewMode] = useState<'form' | 'json'>('form');
  const [pushToAmapi, setPushToAmapi] = useState(false);
  const [version, setVersion] = useState(1);
  const [status, setStatus] = useState('draft');
  const [hasInitialised, setHasInitialised] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [saveWarning, setSaveWarning] = useState<PolicySaveWarning | null>(null);

  // ── Fetch existing policy ──
  const { data: policyData, isLoading: isFetching } = useQuery({
    queryKey: ['policy', id],
    queryFn: () => apiClient.get<{ policy: Policy; components: any }>(`/api/policies/${id}`),
    enabled: !!id,
  });

  useEnvironmentGuard(policyData?.policy?.environment_id, '/policies');

  // Populate form from fetched policy
  useEffect(() => {
    if (policyData?.policy && !hasInitialised) {
      const p = policyData.policy;
      setName(p.name);
      setDescription(p.description ?? '');
      setScenario(p.deployment_scenario);
      setConfig(p.config ?? {});
      setVersion(p.version);
      setStatus(p.status);
      setHasInitialised(true);
    }
  }, [policyData, hasInitialised]);

  // Refresh config after component recompile changes
  useEffect(() => {
    if (policyData?.policy?.version && policyData.policy.version !== version && hasInitialised) {
      if (isDirty) {
        // User has unsaved changes — warn before overwriting
        const proceed = window.confirm(
          'A component change has updated the policy config on the server. ' +
          'Load the updated config? Your unsaved changes will be lost.'
        );
        if (!proceed) return;
      }
      setConfig(policyData.policy.config ?? {});
      setVersion(policyData.policy.version);
      setIsDirty(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policyData?.policy?.version]);

  // ── Mutations ──
  const createMutation = useMutation({
    mutationFn: (body: {
      environment_id: string;
      name: string;
      description: string;
      deployment_scenario: string;
      config: Record<string, any>;
      push_to_amapi?: boolean;
    }) => apiClient.post<CreatePolicyResponse>('/api/policies/create', body),
    onSuccess: (data) => {
      setSaveWarning(null);
      queryClient.invalidateQueries({ queryKey: ['policies', environmentId] });
      navigate(`/policies/${data.policy.id}`, { replace: true });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (body: {
      id: string;
      name: string;
      description: string;
      deployment_scenario: string;
      config: Record<string, any>;
      push_to_amapi?: boolean;
    }) => apiClient.put<UpdatePolicyResponse>('/api/policies/update', body),
    onSuccess: (data) => {
      if (typeof data.amapi_status === 'number' || data.amapi_error) {
        setSaveWarning({
          message: data.message ?? 'Policy saved locally but AMAPI sync failed',
          amapi_status: data.amapi_status ?? null,
          amapi_error: data.amapi_error ?? null,
        });
      } else {
        setSaveWarning(null);
      }
      setVersion(data.version);
      setIsDirty(false);
      queryClient.invalidateQueries({ queryKey: ['policies', environmentId] });
      queryClient.invalidateQueries({ queryKey: ['policy', id] });
    },
  });

  // ── Handlers ──
  const isDefaultPolicy = !isNew && policyData?.policy?.name === 'Default';

  const handleConfigChange = useCallback((path: string, value: any) => {
    if (isDefaultPolicy) return;
    setConfig((prev) => setDeep(prev, path, value));
    setIsDirty(true);
  }, [isDefaultPolicy]);

  const handleSave = () => {
    if (!environmentId || isDefaultPolicy) return;
    setSaveWarning(null);
    if (isNew) {
      createMutation.mutate({
        environment_id: environmentId,
        name,
        description,
        deployment_scenario: scenario,
        config,
        push_to_amapi: pushToAmapi,
      });
    } else {
      updateMutation.mutate({
        id: id!,
        name,
        description,
        deployment_scenario: scenario,
        config,
        push_to_amapi: pushToAmapi,
      });
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const saveError = createMutation.error || updateMutation.error;

  // ── Loading state ──
  if (!isNew && isFetching) {
    return <PageLoadingState label="Loading policy…" />;
  }

  // ── No environment ──
  if (!environmentId) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Policy Editor</h1>
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <ShieldCheck className="mx-auto h-12 w-12 text-gray-300 mb-4" />
          <p className="text-gray-500">Select an environment to create or edit policies.</p>
        </div>
      </div>
    );
  }

  // ── Create mode: show name/description/scenario form first ──
  if (isNew && !hasInitialised) {
    return (
      <div>
        {/* Back */}
        <button
          onClick={() => navigate('/policies')}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Policies
        </button>

        <h1 className="text-2xl font-bold text-gray-900 mb-6">Create New Policy</h1>

        <div className="max-w-xl rounded-xl border border-gray-200 bg-white p-6">
          {/* Name */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-900 mb-1">Policy Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Corporate Device Policy"
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>

          {/* Description */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-900 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description for this policy..."
              rows={3}
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 resize-y"
            />
          </div>

          {/* Deployment scenario */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-900 mb-2">Deployment Scenario</label>
            <div className="space-y-2">
              {SCENARIO_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={clsx(
                    'flex items-start gap-3 rounded-lg border p-4 cursor-pointer transition-colors',
                    scenario === opt.value
                      ? 'border-accent bg-accent/5'
                      : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50',
                  )}
                >
                  <input
                    type="radio"
                    name="scenario"
                    value={opt.value}
                    checked={scenario === opt.value}
                    onChange={() => setScenario(opt.value)}
                    className="mt-0.5 h-4 w-4 text-accent focus:ring-accent/30"
                  />
                  <div>
                    <span className="text-sm font-medium text-gray-900">{opt.label}</span>
                    <p className="mt-0.5 text-xs text-gray-500">{opt.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Continue button */}
          <button
            onClick={() => {
              if (!name.trim()) return;
              setHasInitialised(true);
            }}
            disabled={!name.trim()}
            className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-accent/90 disabled:opacity-50 transition-colors"
          >
            Continue to Editor
          </button>
        </div>
      </div>
    );
  }

  // ── Main editor ──
  const statusStyle = STATUS_STYLES[status] ?? STATUS_STYLES.draft;
  const StatusIcon = statusStyle.icon;
  const helpInfo = CATEGORY_HELP[activeCategory];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── Top bar ── */}
      <div className="flex flex-col gap-3 border-b border-gray-200 bg-white px-4 py-3 flex-shrink-0 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-3 sm:gap-4">
          <button
            onClick={() => navigate('/policies')}
            className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            title="Back to Policies"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>

          {/* Editable name */}
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            readOnly={isDefaultPolicy}
            className="min-w-0 flex-1 bg-transparent border-none text-base font-semibold text-gray-900 focus:outline-none focus:ring-0 sm:min-w-[200px] sm:flex-none sm:text-lg"
            placeholder="Policy name"
          />

          {/* Status badge */}
          <span
            className={clsx(
              'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
              statusStyle.bg,
              statusStyle.text,
            )}
          >
            <StatusIcon className="h-3 w-3" />
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </span>

          {/* Version */}
          <span className="text-xs text-gray-400">v{version}</span>
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 sm:gap-3 lg:w-auto lg:justify-end">
          {/* View toggle */}
          <div className="flex rounded-lg border border-gray-200 p-0.5">
            <button
              onClick={() => setViewMode('form')}
              className={clsx(
                'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                viewMode === 'form' ? 'bg-accent text-white' : 'text-gray-600 hover:text-gray-900',
              )}
            >
              <FormInput className="h-3.5 w-3.5" />
              Form
            </button>
            <button
              onClick={() => setViewMode('json')}
              className={clsx(
                'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                viewMode === 'json' ? 'bg-accent text-white' : 'text-gray-600 hover:text-gray-900',
              )}
            >
              <Code className="h-3.5 w-3.5" />
              JSON
            </button>
          </div>

          {/* Push to AMAPI toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={pushToAmapi}
              disabled={isDefaultPolicy}
              onChange={(e) => {
                if (isDefaultPolicy) return;
                setPushToAmapi(e.target.checked);
              }}
              className="h-4 w-4 rounded border-gray-300 text-accent focus:ring-accent/20"
            />
            <span className="text-xs font-medium text-gray-600">
              <Upload className="inline h-3.5 w-3.5 mr-0.5" />
              Push to AMAPI
            </span>
          </label>

          {/* Save */}
          <button
            onClick={handleSave}
            disabled={isSaving || !name.trim() || isDefaultPolicy}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent/90 disabled:opacity-50 transition-colors"
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Error display */}
      {saveError && (
        <div className="bg-red-50 border-b border-red-200 px-6 py-2 text-sm text-red-700 flex-shrink-0">
          {saveError instanceof Error ? saveError.message : 'Failed to save policy.'}
        </div>
      )}

      {/* Default policy read-only notice */}
      {isDefaultPolicy && (
        <div className="bg-blue-50 border-b border-blue-200 px-6 py-2 text-sm text-blue-700 flex-shrink-0">
          This is the system Default policy and cannot be edited.
        </div>
      )}

      {/* Success display */}
      {updateMutation.isSuccess && (
        <div className="bg-green-50 border-b border-green-200 px-6 py-2 text-sm text-green-700 flex-shrink-0">
          Policy saved successfully (v{version}).
        </div>
      )}
      {saveWarning && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-2 text-sm text-amber-800 flex-shrink-0">
          <div className="font-medium">{saveWarning.message}</div>
          {typeof saveWarning.amapi_status === 'number' && (
            <div className="text-xs mt-0.5">AMAPI status: {saveWarning.amapi_status}</div>
          )}
          {saveWarning.amapi_error && (
            <div className="text-xs mt-0.5 break-words">{saveWarning.amapi_error}</div>
          )}
        </div>
      )}

      {/* ── Three-panel layout ── */}
      <div className="flex flex-1 min-h-0 flex-col lg:flex-row">
        {/* Left panel: category nav */}
        <div className="w-full flex-shrink-0 border-b border-gray-200 bg-gray-50/50 overflow-y-auto max-h-64 lg:max-h-none lg:w-[250px] lg:border-b-0 lg:border-r">
          <PolicyCategoryNav
            activeCategory={activeCategory}
            onCategoryChange={setActiveCategory}
            scenario={scenario}
            isNew={isNew}
          />
        </div>

        {/* Center panel: form, JSON editor, or derivatives */}
        <div className="flex-1 min-w-0 overflow-y-auto">
          {activeCategory === 'derivatives' && !isNew && id ? (
            <div className="max-w-4xl mx-auto px-4 py-4 sm:px-6 sm:py-6">
              <PolicyDerivativesPanel policyId={id} policyName={name} />
            </div>
          ) : viewMode === 'form' ? (
            <div className="max-w-2xl mx-auto px-4 py-4 sm:px-6 sm:py-6">
              <PolicyFormSection
                category={activeCategory}
                config={config}
                onChange={handleConfigChange}
              />
            </div>
          ) : (
            <PolicyJsonEditor
              value={config}
              readOnly={isDefaultPolicy}
              onChange={(next) => {
                if (isDefaultPolicy) return;
                setConfig(next);
                setIsDirty(true);
              }}
            />
          )}

          {/* Policy components section removed — replaced by shared items model */}
        </div>

        {/* Right panel: help / documentation */}
        <div className="w-full flex-shrink-0 border-t border-gray-200 bg-gray-50/30 overflow-y-auto lg:w-[300px] lg:border-t-0 lg:border-l">
          <div className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <Info className="h-4 w-4 text-accent" />
              <h3 className="text-sm font-semibold text-gray-900">Documentation</h3>
            </div>

            {helpInfo ? (
              <>
                <h4 className="text-sm font-medium text-gray-800 mb-2">{helpInfo.title}</h4>
                <p className="text-xs text-gray-600 leading-relaxed mb-4">{helpInfo.description}</p>
                {helpInfo.docLink && (
                  <a
                    href={helpInfo.docLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                  >
                    View AMAPI Reference
                  </a>
                )}
              </>
            ) : (
              <p className="text-xs text-gray-500">
                Select a category to see documentation and field descriptions.
              </p>
            )}

            {/* Policy meta info */}
            <div className="mt-8 border-t border-gray-200 pt-4">
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Policy Info
              </h4>
              <dl className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <dt className="text-gray-500">Scenario</dt>
                  <dd className="font-medium text-gray-700">
                    {SCENARIO_OPTIONS.find((o) => o.value === scenario)?.label ?? scenario}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Version</dt>
                  <dd className="font-medium text-gray-700">v{version}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Status</dt>
                  <dd className="font-medium text-gray-700 capitalize">{status}</dd>
                </div>
                {!isNew && id && (
                  <div className="flex justify-between">
                    <dt className="text-gray-500">ID</dt>
                    <dd className="font-mono text-gray-500 truncate ml-2 max-w-[140px]" title={id}>
                      {id}
                    </dd>
                  </div>
                )}
              </dl>
            </div>

            {/* Description edit */}
            <div className="mt-6 border-t border-gray-200 pt-4">
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Description
              </label>
              <textarea
                value={description}
                readOnly={isDefaultPolicy}
                onChange={(e) => {
                  if (isDefaultPolicy) return;
                  setDescription(e.target.value);
                  setIsDirty(true);
                }}
                placeholder="Add a description..."
                rows={3}
                className="block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 placeholder:text-gray-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 resize-y"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
