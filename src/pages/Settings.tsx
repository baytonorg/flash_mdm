import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { useContextStore } from '@/stores/context';
import { useAuthStore } from '@/stores/auth';
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from '@/constants/auth';
import { useUpdateWorkspace, useSetWorkspaceSecrets } from '@/api/queries/workspaces';
import { useUpdateEnvironment, useBindEnvironmentStep1, useCreateEnvironment, useDeleteEnterprise, useDeleteEnvironment, useGenerateUpgradeUrl, useEnterpriseUpgradeStatus, useReconcileEnvironmentDeviceImport } from '@/api/queries/environments';
import {
  useZeroTouchCreateEnrollmentToken,
  useZeroTouchIframeToken,
  useZeroTouchOptions,
} from '@/api/queries/zero-touch';
import { useCreateApiKey, useEnvironmentApiKeys, useRevokeApiKey, useWorkspaceApiKeys } from '@/api/queries/api-keys';
import PolicyAssignmentSelect from '@/components/policy/PolicyAssignmentSelect';
import { usePolicyAssignments } from '@/api/queries/policies';
import { apiClient } from '@/api/client';
import {
  Building2, Globe, User, Upload, ExternalLink,
  Check, AlertCircle, Loader2, RotateCcw, Trash2, ArrowUpCircle, Key, Copy, Download, X,
} from 'lucide-react';
import clsx from 'clsx';
import SignupLinkSettings from '@/components/settings/SignupLinkSettings';
import { useGroups } from '@/api/queries/groups';
import { useSigninConfig, useUpdateSigninConfig } from '@/api/queries/signin-config';
import {
  useFlashiSettings,
  useFlashiWorkspaceSettings,
  useUpdateFlashiSettings,
  useUpdateFlashiWorkspaceSettings,
} from '@/api/queries/flashagent';

// ---- Tab types ----

type TabId = 'workspace' | 'environment' | 'api' | 'profile';

function isSettingsTabId(value: string | null): value is TabId {
  return value === 'workspace'
    || value === 'environment'
    || value === 'api'
    || value === 'profile';
}

interface Tab {
  id: TabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface DisassociatedEnterprise {
  enterprise_name: string;
  enterprise_id: string;
  enterprise_display_name: string | null;
  pubsub_topic: string | null;
  enabled_notification_types: string[];
  enrolled_device_count: number;
  enrolled_device_count_exact: boolean;
  read_only_policy_warning: string;
}

type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';
type PermissionAction = 'read' | 'write' | 'delete' | 'manage_users' | 'manage_settings';
type PermissionMatrix = Record<string, Partial<Record<PermissionAction, WorkspaceRole>>>;

const ROLE_LEVEL: Record<WorkspaceRole, number> = {
  viewer: 25,
  member: 50,
  admin: 75,
  owner: 100,
};

const DEFAULT_SETTINGS_PERMISSION_MATRIX: PermissionMatrix = {
  workspace: {
    read: 'viewer',
    write: 'admin',
    delete: 'owner',
    manage_users: 'admin',
    manage_settings: 'owner',
  },
  environment: {
    read: 'viewer',
    write: 'admin',
    delete: 'owner',
    manage_users: 'admin',
    manage_settings: 'admin',
  },
};

function parseWorkspaceRbacOverride(settings: unknown): PermissionMatrix | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
  const rbac = (settings as Record<string, unknown>).rbac;
  if (!rbac || typeof rbac !== 'object' || Array.isArray(rbac)) return null;
  const permissionMatrix = (rbac as Record<string, unknown>).permission_matrix;
  if (!permissionMatrix || typeof permissionMatrix !== 'object' || Array.isArray(permissionMatrix)) return null;
  return permissionMatrix as PermissionMatrix;
}

function getEffectiveSettingsPermissionMatrix(settings: unknown): PermissionMatrix {
  const merged: PermissionMatrix = JSON.parse(JSON.stringify(DEFAULT_SETTINGS_PERMISSION_MATRIX));
  const override = parseWorkspaceRbacOverride(settings);
  if (!override) return merged;

  for (const [resource, actions] of Object.entries(override)) {
    if (!actions || typeof actions !== 'object' || Array.isArray(actions)) continue;
    if (!merged[resource]) merged[resource] = {};
    for (const [action, role] of Object.entries(actions)) {
      if (typeof role !== 'string') continue;
      if (!['viewer', 'member', 'admin', 'owner'].includes(role)) continue;
      (merged[resource] as Record<string, WorkspaceRole>)[action] = role as WorkspaceRole;
    }
  }

  return merged;
}

function meetsRole(userRole: string | null | undefined, requiredRole: WorkspaceRole | undefined): boolean {
  if (!userRole || !requiredRole) return false;
  const userLevel = ROLE_LEVEL[userRole as WorkspaceRole] ?? 0;
  const requiredLevel = ROLE_LEVEL[requiredRole] ?? 999;
  return userLevel >= requiredLevel;
}

function normalizeWorkspaceRole(role: string | null | undefined): WorkspaceRole {
  if (role === 'owner' || role === 'admin' || role === 'member' || role === 'viewer') {
    return role;
  }
  return 'viewer';
}

const TABS: Tab[] = [
  { id: 'workspace', label: 'Workspace', icon: Building2 },
  { id: 'environment', label: 'Environment', icon: Globe },
  { id: 'api', label: 'API', icon: Key },
  { id: 'profile', label: 'Profile', icon: User },
];

// ---- Success / Error feedback ----

function FeedbackMessage({ success, error }: { success?: string; error?: string }) {
  if (success) {
    return (
      <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
        <Check className="h-4 w-4" />
        {success}
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-center gap-2 text-sm text-danger bg-red-50 border border-red-200 rounded-lg px-3 py-2">
        <AlertCircle className="h-4 w-4" />
        {error}
      </div>
    );
  }
  return null;
}

// ---- Workspace Tab ----

function WorkspaceTab() {
  const { activeWorkspace, environments, fetchWorkspaces, fetchEnvironments } = useContextStore();
  const { user } = useAuthStore();
  const updateWorkspace = useUpdateWorkspace();
  const setSecrets = useSetWorkspaceSecrets();
  const createEnvironment = useCreateEnvironment();

  const [wsName, setWsName] = useState(activeWorkspace?.name ?? '');
  const [wsDefaultPubsub, setWsDefaultPubsub] = useState(activeWorkspace?.default_pubsub_topic ?? '');

  // Sync local state when activeWorkspace changes (e.g. after async load)
  useEffect(() => {
    if (activeWorkspace?.name) {
      setWsName(activeWorkspace.name);
    }
    setWsDefaultPubsub(activeWorkspace?.default_pubsub_topic ?? '');
  }, [activeWorkspace?.name, activeWorkspace?.default_pubsub_topic]);
  const [feedback, setFeedback] = useState<{ success?: string; error?: string }>({});
  const [credFeedback, setCredFeedback] = useState<{ success?: string; error?: string }>({});
  const [orphanFeedback, setOrphanFeedback] = useState<{ success?: string; error?: string }>({});
  const [orphanedEnterprises, setOrphanedEnterprises] = useState<DisassociatedEnterprise[]>([]);
  const [orphanedLoading, setOrphanedLoading] = useState(false);
  const [orphanedLoadError, setOrphanedLoadError] = useState<string | null>(null);
  const [takingOwnershipEnterprise, setTakingOwnershipEnterprise] = useState<string | null>(null);
  const [ownershipEnvNames, setOwnershipEnvNames] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasGcpCredentials = activeWorkspace?.has_google_credentials === true;
  const permissionMatrix = useMemo(
    () => getEffectiveSettingsPermissionMatrix((activeWorkspace as { settings?: unknown } | null)?.settings),
    [activeWorkspace]
  );
  const { data: workspaceFlashiSettings } = useFlashiWorkspaceSettings(activeWorkspace?.id);
  const workspaceRole = activeWorkspace?.user_role ?? null;
  const hasWorkspaceScopedAccess = Boolean(user?.is_superadmin || activeWorkspace?.access_scope === 'workspace');
  const canWorkspaceRead = Boolean(hasWorkspaceScopedAccess && meetsRole(workspaceRole, permissionMatrix.workspace?.read));
  const canWorkspaceWrite = Boolean(hasWorkspaceScopedAccess && meetsRole(workspaceRole, permissionMatrix.workspace?.write));
  const canWorkspaceManageSettings = Boolean(
    hasWorkspaceScopedAccess && meetsRole(workspaceRole, permissionMatrix.workspace?.manage_settings)
  );
  const canRecoverLostEnterprises = Boolean(
    hasWorkspaceScopedAccess
      && (meetsRole(workspaceRole, permissionMatrix.workspace?.write)
        && meetsRole(workspaceRole, permissionMatrix.environment?.write))
  );

  const loadDisassociatedEnterprises = useCallback(async () => {
    if (!canWorkspaceWrite) {
      setOrphanedEnterprises([]);
      setOrphanedLoadError(null);
      return;
    }
    if (!activeWorkspace?.id) {
      setOrphanedEnterprises([]);
      setOrphanedLoadError(null);
      return;
    }
    if (!activeWorkspace.gcp_project_id || !hasGcpCredentials) {
      setOrphanedEnterprises([]);
      setOrphanedLoadError(null);
      return;
    }

    setOrphanedLoading(true);
    setOrphanedLoadError(null);
    try {
      const data = await apiClient.get<{ enterprises: DisassociatedEnterprise[] }>(
        `/api/workspaces/orphaned-enterprises?workspace_id=${encodeURIComponent(activeWorkspace.id)}`
      );
      setOrphanedEnterprises(data.enterprises ?? []);
      setOwnershipEnvNames((prev) => {
        const next = { ...prev };
        for (const enterprise of data.enterprises ?? []) {
          if (!next[enterprise.enterprise_name]) {
            const label = (enterprise.enterprise_display_name || enterprise.enterprise_id || 'Recovered Enterprise').trim();
            next[enterprise.enterprise_name] = `Recovered - ${label}`.slice(0, 120);
          }
        }
        return next;
      });
    } catch (err) {
      setOrphanedLoadError(err instanceof Error ? err.message : 'Failed to load disassociated enterprises');
      setOrphanedEnterprises([]);
    } finally {
      setOrphanedLoading(false);
    }
  }, [activeWorkspace?.id, activeWorkspace?.gcp_project_id, hasGcpCredentials, canWorkspaceWrite]);

  useEffect(() => {
    loadDisassociatedEnterprises();
  }, [loadDisassociatedEnterprises]);

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeWorkspace || !wsName.trim()) return;
    setFeedback({});
    try {
      await updateWorkspace.mutateAsync({
        id: activeWorkspace.id,
        name: wsName.trim(),
        default_pubsub_topic: wsDefaultPubsub.trim() || null,
      });
      await fetchWorkspaces();
      setFeedback({ success: 'Workspace settings updated.' });
    } catch (err) {
      setFeedback({ error: err instanceof Error ? err.message : 'Failed to update workspace' });
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeWorkspace) return;
    setCredFeedback({});

    try {
      const text = await file.text();
      // Validate it's JSON
      JSON.parse(text);
      await setSecrets.mutateAsync({
        workspace_id: activeWorkspace.id,
        google_credentials_json: text,
      });
      await fetchWorkspaces();
      await loadDisassociatedEnterprises();
      setCredFeedback({ success: 'GCP credentials uploaded successfully.' });
    } catch (err) {
      setCredFeedback({ error: err instanceof Error ? err.message : 'Failed to upload credentials' });
    }
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleTakeOwnership = async (enterprise: DisassociatedEnterprise) => {
    if (!activeWorkspace) return;
    const rawName = ownershipEnvNames[enterprise.enterprise_name]
      ?? `Recovered - ${enterprise.enterprise_display_name ?? enterprise.enterprise_id}`;
    const environmentName = rawName.trim();
    if (!environmentName) {
      setOrphanFeedback({ error: 'Environment name is required before taking ownership.' });
      return;
    }

    setOrphanFeedback({});
    setTakingOwnershipEnterprise(enterprise.enterprise_name);
    let createdEnvironmentId: string | null = null;
    let createdEnvironmentName = environmentName;
    try {
      const created = await createEnvironment.mutateAsync({
        workspace_id: activeWorkspace.id,
        name: environmentName,
      });
      createdEnvironmentId = created.environment.id;
      createdEnvironmentName = created.environment.name;

      const bindResult = await apiClient.post<{
        enterprise?: { name: string; display_name?: string; pubsub_topic?: string | null };
        bootstrap_sync?: { imported_devices: number; truncated: boolean; error?: string };
        warning?: string;
      }>('/api/environments/bind', {
        environment_id: createdEnvironmentId,
        existing_enterprise_name: enterprise.enterprise_name,
      });

      if (activeWorkspace?.id) {
        await fetchEnvironments(activeWorkspace.id);
      }
      await loadDisassociatedEnterprises();

      const importedDevices = bindResult.bootstrap_sync?.imported_devices ?? 0;
      const truncated = bindResult.bootstrap_sync?.truncated ? ' (truncated)' : '';
      const warningText = bindResult.warning ? ` Warning: ${bindResult.warning}` : '';
      setOrphanFeedback({
        success: `Recovered ${enterprise.enterprise_display_name ?? enterprise.enterprise_name} into environment "${createdEnvironmentName}". Imported ${importedDevices} devices${truncated}.${warningText}`,
      });
    } catch (err) {
      const base = err instanceof Error ? err.message : 'Failed to take ownership';
      setOrphanFeedback({
        error: createdEnvironmentId
          ? `${base}. Environment "${createdEnvironmentName}" was created (ID: ${createdEnvironmentId}) and may need manual cleanup or retry.`
          : base,
      });
    } finally {
      setTakingOwnershipEnterprise(null);
    }
  };

  if (!activeWorkspace) {
    return <p className="text-gray-500">Select a workspace to view settings.</p>;
  }
  if (!canWorkspaceRead) {
    return <p className="text-gray-500">You do not have permission to view workspace settings.</p>;
  }

  return (
    <div className="space-y-6">
      {/* Workspace Name */}
      <form onSubmit={handleSaveName} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Workspace Name</label>
          <input
            type="text"
            value={wsName}
            onChange={(e) => setWsName(e.target.value)}
            className="w-full max-w-md rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">GCP Project ID</label>
          <p className="text-sm text-gray-500 bg-gray-50 rounded-lg px-3 py-2 max-w-md font-mono">
            {activeWorkspace.gcp_project_id ?? 'Not configured'}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Default Pub/Sub Topic</label>
          <input
            type="text"
            value={wsDefaultPubsub}
            onChange={(e) => setWsDefaultPubsub(e.target.value)}
            placeholder="projects/<project-id>/topics/<topic-name>"
            className="w-full max-w-2xl rounded-lg border border-border bg-surface px-3 py-2 text-sm font-mono focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
          <div className="mt-2 flex items-center gap-2 text-sm">
            <span
              className={clsx(
                'inline-block h-2.5 w-2.5 rounded-full',
                wsDefaultPubsub.trim()
                  ? wsDefaultPubsub.trim() !== (activeWorkspace.default_pubsub_topic ?? '')
                    ? 'bg-amber-500'
                    : 'bg-green-500'
                  : 'bg-gray-300',
              )}
            />
            <span
              className={clsx(
                wsDefaultPubsub.trim()
                  ? wsDefaultPubsub.trim() !== (activeWorkspace.default_pubsub_topic ?? '')
                    ? 'text-amber-700'
                    : 'text-green-700'
                  : 'text-gray-500',
              )}
            >
              {wsDefaultPubsub.trim()
                ? wsDefaultPubsub.trim() !== (activeWorkspace.default_pubsub_topic ?? '')
                  ? 'Unsaved changes'
                  : 'Default Pub/Sub topic configured'
                : 'No default Pub/Sub topic configured'}
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-xs text-gray-500">
            Default Pub/Sub topic inherited by all environments. Each environment can override this.
          </p>
        </div>

        <FeedbackMessage {...feedback} />
        <button
          type="submit"
          disabled={!canWorkspaceManageSettings || updateWorkspace.isPending}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-light transition-colors disabled:opacity-50"
        >
          {updateWorkspace.isPending ? 'Saving...' : 'Save Changes'}
        </button>
      </form>

      {/* GCP Credentials */}
      <div className="border-t border-border pt-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">GCP Credentials</h3>
        <p className="text-sm text-gray-500 mb-3">
          Upload or replace the GCP service account JSON key used for enterprise binding.
        </p>
        <div className="mb-3 flex items-center gap-2 text-sm">
          <span className={clsx('inline-block h-2.5 w-2.5 rounded-full', hasGcpCredentials ? 'bg-green-500' : 'bg-gray-300')} />
          <span className={hasGcpCredentials ? 'text-green-700' : 'text-gray-500'}>
            {hasGcpCredentials ? 'Credentials uploaded' : 'No credentials uploaded yet'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleFileUpload}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!canWorkspaceManageSettings || setSecrets.isPending}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            <Upload className="h-4 w-4" />
            {setSecrets.isPending ? 'Uploading...' : hasGcpCredentials ? 'Replace JSON Key' : 'Upload JSON Key'}
          </button>
        </div>
        <div className="mt-3">
          <FeedbackMessage {...credFeedback} />
        </div>
      </div>

      {/* Disassociated Enterprises */}
      <div className="border-t border-border pt-6">
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-700 mt-0.5" />
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-amber-900">Disassociated Enterprises</h3>
              <p className="mt-1 text-sm text-amber-800">
                Enterprises found in your Android Management project that are not currently mapped to a Flash environment.
                You can take ownership to create a new environment and attach the enterprise.
              </p>
              <p className="mt-2 text-xs text-amber-900/90">
                Important: Existing enterprise-side policy state may appear read-only until you push policies from Flash to the recovered environment.
              </p>
            </div>
          </div>

          <div className="mt-4">
            <FeedbackMessage {...orphanFeedback} />
          </div>

          {!activeWorkspace?.gcp_project_id || !hasGcpCredentials ? (
            <p className="mt-4 text-sm text-amber-800">
              Configure a GCP Project ID and upload service account credentials to scan for disassociated enterprises.
            </p>
          ) : !canWorkspaceWrite ? (
            <p className="mt-4 text-sm text-amber-800">
              You do not have permission to scan for or recover disassociated enterprises in this workspace.
            </p>
          ) : orphanedLoading ? (
            <div className="mt-4 flex items-center gap-2 text-sm text-amber-900">
              <Loader2 className="h-4 w-4 animate-spin" />
              Scanning Android Enterprise for disassociated enterprises…
            </div>
          ) : orphanedLoadError ? (
            <div className="mt-4 space-y-3">
              <p className="text-sm text-red-700">{orphanedLoadError}</p>
              <button
                type="button"
                onClick={() => void loadDisassociatedEnterprises()}
                className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100"
              >
                Retry Scan
              </button>
            </div>
          ) : orphanedEnterprises.length === 0 ? (
            <p className="mt-4 text-sm text-amber-900">
              No disassociated enterprises found for this workspace’s GCP project.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {orphanedEnterprises.map((enterprise) => {
                const isTakingOwnership = takingOwnershipEnterprise === enterprise.enterprise_name;
                return (
                  <div
                    key={enterprise.enterprise_name}
                    className="rounded-lg border border-amber-200 bg-white/80 p-4 shadow-sm"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-gray-900">
                            {enterprise.enterprise_display_name || enterprise.enterprise_id}
                          </p>
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                            {enterprise.enrolled_device_count_exact
                              ? `${enterprise.enrolled_device_count} devices`
                              : `${enterprise.enrolled_device_count}+ devices`}
                          </span>
                        </div>
                        <p className="mt-1 font-mono text-xs text-gray-600 break-all">
                          {enterprise.enterprise_name}
                        </p>
                        <div className="mt-2 grid gap-1 text-xs text-gray-700">
                          <p>
                            <span className="font-medium text-gray-800">Pub/Sub:</span>{' '}
                            {enterprise.pubsub_topic || 'Not configured'}
                          </p>
                          <p>
                            <span className="font-medium text-gray-800">Notifications:</span>{' '}
                            {enterprise.enabled_notification_types.length > 0
                              ? enterprise.enabled_notification_types.join(', ')
                              : 'None'}
                          </p>
                        </div>
                      </div>

                      <div className="w-full sm:w-80 space-y-2">
                        <label className="block text-xs font-medium text-gray-700">
                          New environment name
                        </label>
                        <input
                          type="text"
                          value={ownershipEnvNames[enterprise.enterprise_name] ?? ''}
                          onChange={(e) =>
                            setOwnershipEnvNames((prev) => ({
                              ...prev,
                              [enterprise.enterprise_name]: e.target.value,
                            }))
                          }
                          className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
                          placeholder={`Recovered - ${enterprise.enterprise_display_name ?? enterprise.enterprise_id}`}
                        />
                        <button
                          type="button"
                          onClick={() => void handleTakeOwnership(enterprise)}
                          disabled={!canRecoverLostEnterprises || isTakingOwnership || createEnvironment.isPending}
                          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                        >
                          {isTakingOwnership ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Taking Ownership…
                            </>
                          ) : (
                            'Take Ownership'
                          )}
                        </button>
                        <p className="text-xs text-amber-900/80">
                          Creates a new environment, attaches this enterprise, and imports a bootstrap device inventory.
                        </p>
                        {!canRecoverLostEnterprises && (
                          <p className="text-xs text-amber-900/80">
                            Requires admin-level access to create environments in this workspace.
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      {enterprise.read_only_policy_warning}
                    </div>
                  </div>
                );
              })}

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => void loadDisassociatedEnterprises()}
                  disabled={!canWorkspaceWrite}
                  className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100"
                >
                  Refresh Scan
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Flashi Assistant */}
      {workspaceFlashiSettings?.platform_assistant_enabled !== false && (
        <div className="border-t border-border pt-6">
          <FlashiWorkspaceCard
            workspaceId={activeWorkspace.id}
            canManageSettings={canWorkspaceManageSettings}
          />
        </div>
      )}

      {/* Teammate Signup Link */}
      <div className="border-t border-border pt-6">
        <SignupLinkSettings
          scopeType="workspace"
          scopeId={activeWorkspace.id}
          environments={environments}
          purpose="standard"
          title="Teammate Signup Link"
          description="Team operator signup link. Workspace role and scope are controlled here."
        />
      </div>

      {/* Customer Signup Link */}
      <div className="border-t border-border pt-6">
        <SignupLinkSettings
          scopeType="workspace"
          scopeId={activeWorkspace.id}
          purpose="customer"
          title="Customer Signup Link"
          description="Customer onboarding link. Users create and own their first environment only."
        />
      </div>
    </div>
  );
}

// ---- Environment Tab ----

function EnvironmentTab() {
  const { user } = useAuthStore();
  const {
    activeEnvironment, environments, fetchEnvironments,
    activeWorkspace, switchEnvironment,
  } = useContextStore();
  const updateEnvironment = useUpdateEnvironment();
  const createEnvironment = useCreateEnvironment();
  const bindStep1 = useBindEnvironmentStep1();
  const deleteEnterprise = useDeleteEnterprise();
  const deleteEnvironment = useDeleteEnvironment();
  const generateUpgradeUrl = useGenerateUpgradeUrl();
  const reconcileDeviceImport = useReconcileEnvironmentDeviceImport();
  const enterpriseUpgradeStatus = useEnterpriseUpgradeStatus(
    activeEnvironment?.id,
    Boolean(activeEnvironment?.enterprise_name),
  );
  const { data: assignments = [] } = usePolicyAssignments(activeEnvironment?.id);
  const envPolicyAssignment = assignments.find(
    (a) => a.scope_type === 'environment' && a.scope_id === activeEnvironment?.id
  );

  const [envName, setEnvName] = useState(activeEnvironment?.name ?? '');
  const [pubsubTopic, setPubsubTopic] = useState(activeEnvironment?.pubsub_topic ?? '');
  const [newEnvName, setNewEnvName] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [feedback, setFeedback] = useState<{ success?: string; error?: string }>({});
  const [createFeedback, setCreateFeedback] = useState<{ success?: string; error?: string }>({});
  const [showDeleteEnterprise, setShowDeleteEnterprise] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [showDeleteEnvironment, setShowDeleteEnvironment] = useState(false);
  const [deleteEnvironmentConfirmText, setDeleteEnvironmentConfirmText] = useState('');
  const permissionMatrix = useMemo(
    () => getEffectiveSettingsPermissionMatrix((activeWorkspace as { settings?: unknown } | null)?.settings),
    [activeWorkspace]
  );
  const { data: workspaceFlashiSettings } = useFlashiWorkspaceSettings(activeWorkspace?.id);
  const workspaceRole = activeWorkspace?.user_role ?? null;
  const hasWorkspaceScopedAccess = Boolean(user?.is_superadmin || activeWorkspace?.access_scope === 'workspace');
  const environmentRole = hasWorkspaceScopedAccess
    ? (workspaceRole ?? activeEnvironment?.user_role ?? null)
    : (activeEnvironment?.user_role ?? null);
  const canEnvironmentWrite = Boolean(
    user?.is_superadmin || meetsRole(environmentRole, permissionMatrix.environment?.write)
  );
  const canEnvironmentManageSettings = Boolean(
    user?.is_superadmin || meetsRole(environmentRole, permissionMatrix.environment?.manage_settings)
  );
  const minCreateRole = permissionMatrix.environment?.write ?? 'admin';
  const canCreateEnvironment = Boolean(
    user?.is_superadmin || (hasWorkspaceScopedAccess && meetsRole(workspaceRole, minCreateRole))
  );
  const minCreateRoleLabel = `${minCreateRole.charAt(0).toUpperCase()}${minCreateRole.slice(1)}`;

  // Sync local state when activeEnvironment changes
  useEffect(() => {
    setEnvName(activeEnvironment?.name ?? '');
    setPubsubTopic(activeEnvironment?.pubsub_topic ?? '');
  }, [activeEnvironment?.name, activeEnvironment?.pubsub_topic]);

  useEffect(() => {
    if (!canCreateEnvironment) setShowCreate(false);
  }, [canCreateEnvironment]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeEnvironment || !envName.trim()) return;
    setFeedback({});
    try {
      await updateEnvironment.mutateAsync({
        id: activeEnvironment.id,
        name: envName.trim(),
        pubsub_topic: pubsubTopic.trim() || null,
      });
      if (activeWorkspace) await fetchEnvironments(activeWorkspace.id);
      setFeedback({ success: 'Environment settings updated.' });
    } catch (err) {
      setFeedback({ error: err instanceof Error ? err.message : 'Failed to update environment' });
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCreateEnvironment) {
      setCreateFeedback({ error: `Requires ${minCreateRoleLabel} role or higher to create environments.` });
      return;
    }
    if (!activeWorkspace || !newEnvName.trim()) return;
    setCreateFeedback({});
    try {
      const result = await createEnvironment.mutateAsync({
        workspace_id: activeWorkspace.id,
        name: newEnvName.trim(),
      });
      await fetchEnvironments(activeWorkspace.id);
      // Switch to the new environment
      if (result.environment?.id) {
        await switchEnvironment(result.environment.id);
      }
      setNewEnvName('');
      setShowCreate(false);
      setCreateFeedback({ success: `Environment "${newEnvName.trim()}" created.` });
    } catch (err) {
      setCreateFeedback({ error: err instanceof Error ? err.message : 'Failed to create environment' });
    }
  };

  const handleBind = async () => {
    if (!activeEnvironment) return;
    setFeedback({});
    try {
      if (pubsubChanged) {
        await updateEnvironment.mutateAsync({
          id: activeEnvironment.id,
          pubsub_topic: draftPubsubTopic || null,
        });
        if (activeWorkspace) {
          await fetchEnvironments(activeWorkspace.id);
        }
      }

      const result = await bindStep1.mutateAsync({ environment_id: activeEnvironment.id });
      if (result.signup_url) {
        window.location.href = result.signup_url;
      }
    } catch (err) {
      setFeedback({ error: err instanceof Error ? err.message : 'Failed to initiate enterprise binding' });
    }
  };

  if (!activeWorkspace) {
    return <p className="text-gray-500">Select a workspace first.</p>;
  }

  const isBound = !!activeEnvironment?.enterprise_name;
  const canUpgradeEnterprise = isBound && enterpriseUpgradeStatus.data?.eligible_for_upgrade === true;
  const savedPubsubTopic = activeEnvironment?.pubsub_topic?.trim() ?? '';
  const draftPubsubTopic = pubsubTopic.trim();
  const hasSavedPubsubTopic = savedPubsubTopic.length > 0;
  const pubsubChanged = draftPubsubTopic !== savedPubsubTopic;

  const canDeleteEnvironment = Boolean(
    user?.is_superadmin || meetsRole(environmentRole, permissionMatrix.environment?.delete)
  );
  const workspaceFlashiEnabled = workspaceFlashiSettings?.workspace_assistant_enabled ?? true;
  const platformFlashiEnabled = workspaceFlashiSettings?.platform_assistant_enabled ?? true;
  const workspaceDefaultPubsub = activeWorkspace?.default_pubsub_topic?.trim() ?? '';
  const effectivePubsubTopic = savedPubsubTopic || workspaceDefaultPubsub;
  const hasEnvOverride = hasSavedPubsubTopic && workspaceDefaultPubsub.length > 0 && savedPubsubTopic !== workspaceDefaultPubsub;
  const isInheritedFromWorkspace = !hasSavedPubsubTopic && workspaceDefaultPubsub.length > 0;

  return (
    <div className="space-y-6">
      {/* Environment list */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-900">Environments</h3>
          {hasWorkspaceScopedAccess && (
            <button
              type="button"
              onClick={() => {
                if (!canCreateEnvironment) return;
                setCreateFeedback({});
                setShowCreate(!showCreate);
              }}
              disabled={!canCreateEnvironment}
              className="text-sm font-medium text-accent hover:text-accent-light transition-colors disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-accent"
            >
              {showCreate ? 'Cancel' : '+ New Environment'}
            </button>
          )}
        </div>

        {hasWorkspaceScopedAccess && !canCreateEnvironment && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Requires {minCreateRoleLabel} role or higher to create environments.
          </div>
        )}

        {/* Environment cards */}
        <div className="space-y-2 mb-4">
          {environments.map((env) => (
            <div
              key={env.id}
              onClick={() => switchEnvironment(env.id)}
              className={clsx(
                'flex items-center justify-between rounded-lg border px-4 py-3 cursor-pointer transition-colors',
                env.id === activeEnvironment?.id
                  ? 'border-accent bg-accent/5'
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50',
              )}
            >
              <div>
                <p className="text-sm font-medium text-gray-900">{env.name}</p>
                <p className="text-xs text-gray-500 font-mono">
                  {env.enterprise_name
                    ? env.enterprise_name.replace('enterprises/', '')
                    : 'Not bound'}
                </p>
              </div>
              {env.enterprise_name ? (
                <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                  Bound
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">
                  Not bound
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Create new environment */}
        {showCreate && canCreateEnvironment && (
          <form onSubmit={handleCreate} className="flex items-end gap-2 mb-4">
            <div className="flex-1 max-w-sm">
              <label className="block text-sm font-medium text-gray-700 mb-1">New Environment Name</label>
              <input
                type="text"
                value={newEnvName}
                onChange={(e) => setNewEnvName(e.target.value)}
                placeholder="e.g. Production, Staging..."
                autoFocus
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>
            <button
              type="submit"
              disabled={createEnvironment.isPending || !newEnvName.trim()}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-light transition-colors disabled:opacity-50"
            >
              {createEnvironment.isPending ? 'Creating...' : 'Create'}
            </button>
          </form>
        )}
        <FeedbackMessage {...createFeedback} />
      </div>

      {/* Active environment settings */}
      {activeEnvironment && (
        <>
          <div className="border-t border-border pt-6">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">
              Environment Settings — {activeEnvironment.name}
            </h3>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Environment Name</label>
                <input
                  type="text"
                  value={envName}
                  onChange={(e) => setEnvName(e.target.value)}
                  className="w-full max-w-md rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Enterprise Name</label>
                <p className="text-sm text-gray-500 bg-gray-50 rounded-lg px-3 py-2 max-w-md font-mono">
                  {activeEnvironment.enterprise_name ?? 'Not bound'}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Pub/Sub Topic</label>

                {canEnvironmentWrite ? (
                  <>
                    {/* Role-eligible users: editable input with override/revert */}
                    <div className="flex items-center gap-2 max-w-2xl">
                      <input
                        type="text"
                        value={pubsubTopic}
                        onChange={(e) => setPubsubTopic(e.target.value)}
                        placeholder={workspaceDefaultPubsub || 'projects/<project-id>/topics/<topic-name>'}
                        className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-mono focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                      />
                      {(hasEnvOverride || (hasSavedPubsubTopic && workspaceDefaultPubsub.length > 0)) && (
                        <button
                          type="button"
                          title="Revert to workspace default"
                          onClick={async () => {
                            setPubsubTopic('');
                            if (activeEnvironment) {
                              try {
                                await updateEnvironment.mutateAsync({
                                  id: activeEnvironment.id,
                                  pubsub_topic: null,
                                });
                                if (activeWorkspace) await fetchEnvironments(activeWorkspace.id);
                                setFeedback({ success: 'Reverted to workspace default Pub/Sub topic.' });
                              } catch (err) {
                                setFeedback({ error: err instanceof Error ? err.message : 'Failed to revert' });
                              }
                            }
                          }}
                          className="rounded-lg border border-border bg-surface p-2 text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors"
                        >
                          <RotateCcw className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-sm">
                      <span
                        className={clsx(
                          'inline-block h-2.5 w-2.5 rounded-full',
                          pubsubChanged
                            ? 'bg-amber-500'
                            : hasSavedPubsubTopic
                            ? 'bg-green-500'
                            : isInheritedFromWorkspace
                            ? 'bg-green-500'
                            : 'bg-gray-300',
                        )}
                      />
                      <span
                        className={clsx(
                          pubsubChanged
                            ? 'text-amber-700'
                            : hasSavedPubsubTopic
                            ? 'text-green-700'
                            : isInheritedFromWorkspace
                            ? 'text-green-700'
                            : 'text-gray-500',
                        )}
                      >
                        {pubsubChanged
                          ? 'Unsaved Pub/Sub topic changes'
                          : hasSavedPubsubTopic
                          ? hasEnvOverride
                            ? 'Pub/Sub topic overridden (workspace default available)'
                            : 'Pub/Sub topic configured'
                          : isInheritedFromWorkspace
                          ? 'Inherited from workspace'
                          : 'No Pub/Sub topic configured'}
                      </span>
                    </div>
                    <p className="mt-1 max-w-2xl text-xs text-gray-500">
                      Set this before binding to enable AMAPI notifications (<code className="text-xs">ENROLLMENT</code>, <code className="text-xs">STATUS_REPORT</code>, <code className="text-xs">COMMAND</code>, <code className="text-xs">USAGE_LOGS</code>, <code className="text-xs">ENTERPRISE_UPGRADE</code>) on enterprise creation.
                      {workspaceDefaultPubsub && ' Leave empty to inherit the workspace default.'}
                    </p>
                  </>
                ) : (
                  <>
                    {/* Read-only summary for users without environment write permission */}
                    <div className="flex items-center gap-2 text-sm">
                      <span
                        className={clsx(
                          'inline-block h-2.5 w-2.5 rounded-full',
                          effectivePubsubTopic ? 'bg-green-500' : 'bg-gray-300',
                        )}
                      />
                      <span className={effectivePubsubTopic ? 'text-green-700' : 'text-gray-500'}>
                        {effectivePubsubTopic ? 'Pub/Sub topic configured' : 'No Pub/Sub topic configured'}
                      </span>
                    </div>
                    {effectivePubsubTopic && (
                      <p className="mt-2 text-xs text-gray-600">
                        Configured AMAPI notifications: <code className="text-xs">ENROLLMENT</code>, <code className="text-xs">STATUS_REPORT</code>, <code className="text-xs">COMMAND</code>, <code className="text-xs">USAGE_LOGS</code>, <code className="text-xs">ENTERPRISE_UPGRADE</code>
                      </p>
                    )}
                  </>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Enterprise Binding</label>
                <div className="flex items-center gap-2">
                  <span
                    className={clsx(
                      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                      isBound
                        ? 'bg-green-100 text-green-700'
                        : 'bg-yellow-100 text-yellow-700',
                    )}
                  >
                    {isBound ? 'Bound' : 'Not bound'}
                  </span>
                  {!isBound && (
                    <button
                      type="button"
                      onClick={handleBind}
                      disabled={bindStep1.isPending || !canEnvironmentManageSettings}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      {bindStep1.isPending ? 'Binding...' : 'Bind Enterprise'}
                    </button>
                  )}
                </div>
              </div>

              <FeedbackMessage {...feedback} />

              <button
                type="submit"
                disabled={updateEnvironment.isPending || !canEnvironmentWrite}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-light transition-colors disabled:opacity-50"
              >
                {updateEnvironment.isPending ? 'Saving...' : 'Save Changes'}
              </button>
            </form>
          </div>

          {/* Enterprise Management (unbind + upgrade) */}
          {isBound && (
            <div className="border-t border-border pt-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">Enterprise Management</h3>
              <div className="space-y-4">
                {/* Upgrade Enterprise (only for managed Google Play Accounts enterprises) */}
                {canUpgradeEnterprise && (
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-blue-900">Upgrade Enterprise</p>
                        <p className="text-xs text-blue-700 mt-1">
                          This enterprise uses managed Google Play Accounts and can be upgraded to a Google Workspace-linked enterprise.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const result = await generateUpgradeUrl.mutateAsync(activeEnvironment!.id);
                            const parsedUrl = new URL(result.upgrade_url);
                            if (parsedUrl.protocol !== 'https:') {
                              throw new Error('Invalid upgrade URL');
                            }
                            window.open(parsedUrl.toString(), '_blank', 'noopener,noreferrer');
                          } catch (err) {
                            setFeedback({ error: err instanceof Error ? err.message : 'Failed to generate upgrade URL' });
                          }
                        }}
                        disabled={generateUpgradeUrl.isPending}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-50 transition-colors disabled:opacity-50 shrink-0"
                      >
                        <ArrowUpCircle className="h-3.5 w-3.5" />
                        {generateUpgradeUrl.isPending ? 'Generating...' : 'Upgrade'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Unbind Enterprise — danger zone */}
                {canEnvironmentManageSettings && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-amber-900">Re-import AMAPI Devices</p>
                        <p className="text-xs text-amber-800 mt-1">
                          Re-scan all devices from Android Management API and queue enrollment-style imports to repair missing or mis-mapped local device records.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!activeEnvironment) return;
                          setFeedback({});
                          try {
                            const result = await reconcileDeviceImport.mutateAsync(activeEnvironment.id);
                            setFeedback({
                              success: `Queued re-import for ${result.jobs_enqueued} device${result.jobs_enqueued === 1 ? '' : 's'} across ${result.pages_scanned} AMAPI page${result.pages_scanned === 1 ? '' : 's'}.`,
                            });
                          } catch (err) {
                            setFeedback({ error: err instanceof Error ? err.message : 'Failed to queue AMAPI device re-import' });
                          }
                        }}
                        disabled={reconcileDeviceImport.isPending}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100 transition-colors disabled:opacity-50 shrink-0"
                      >
                        {reconcileDeviceImport.isPending ? (
                          <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Queuing...</>
                        ) : (
                          <><RotateCcw className="h-3.5 w-3.5" /> Re-import Devices</>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-red-900">Unbind Enterprise</p>
                      <p className="text-xs text-red-700 mt-1">
                        Unbind this enterprise and remove it from Google. Private apps, policies, and user data will be irreversibly removed. A new bind will be required and will generate a new enterprise ID. This action cannot be undone.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowDeleteEnterprise(true)}
                      disabled={!canEnvironmentManageSettings}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 transition-colors shrink-0"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Unbind
                    </button>
                  </div>
                  {showDeleteEnterprise && (
                    <div className="mt-4 border-t border-red-200 pt-4">
                      <p className="text-xs text-red-800 mb-2">
                        Type <strong className="font-mono">{activeEnvironment?.enterprise_name}</strong> to confirm:
                      </p>
                      <input
                        type="text"
                        value={deleteConfirmText}
                        onChange={(e) => setDeleteConfirmText(e.target.value)}
                        placeholder={activeEnvironment?.enterprise_name ?? ''}
                        className="w-full max-w-md rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-mono focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-200"
                      />
                      <div className="flex items-center gap-2 mt-3">
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await deleteEnterprise.mutateAsync(activeEnvironment!.id);
                              setShowDeleteEnterprise(false);
                              setDeleteConfirmText('');
                              if (activeWorkspace) await fetchEnvironments(activeWorkspace.id);
                              setFeedback({ success: 'Enterprise unbound and removed from Google.' });
                            } catch (err) {
                              setFeedback({ error: err instanceof Error ? err.message : 'Failed to unbind enterprise' });
                            }
                          }}
                          disabled={deleteConfirmText !== activeEnvironment?.enterprise_name || deleteEnterprise.isPending}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-50"
                        >
                          {deleteEnterprise.isPending ? (
                            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Unbinding...</>
                          ) : (
                            'Confirm Unbind'
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setShowDeleteEnterprise(false); setDeleteConfirmText(''); }}
                          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {canDeleteEnvironment && (
            <div className="border-t border-border pt-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">Environment Danger Zone</h3>
              <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-red-900">Delete Environment</p>
                    <p className="text-xs text-red-700 mt-1">
                      Permanently delete this environment and its local data. If it is bound to an enterprise, the Google enterprise may remain as a disassociated enterprise.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowDeleteEnvironment(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 transition-colors shrink-0"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </button>
                </div>
                {showDeleteEnvironment && (
                  <div className="mt-4 border-t border-red-200 pt-4">
                    <p className="text-xs text-red-800 mb-2">
                      Type <strong className="font-mono">{activeEnvironment?.name}</strong> to confirm:
                    </p>
                    <input
                      type="text"
                      value={deleteEnvironmentConfirmText}
                      onChange={(e) => setDeleteEnvironmentConfirmText(e.target.value)}
                      placeholder={activeEnvironment?.name ?? ''}
                      className="w-full max-w-md rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-mono focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-200"
                    />
                    <div className="flex items-center gap-2 mt-3">
                      <button
                        type="button"
                        onClick={async () => {
                          if (!activeEnvironment || !activeWorkspace) return;
                          const deletedId = activeEnvironment.id;
                          const deletedName = activeEnvironment.name;
                          try {
                            await deleteEnvironment.mutateAsync(deletedId);
                            setShowDeleteEnvironment(false);
                            setDeleteEnvironmentConfirmText('');
                            await fetchEnvironments(activeWorkspace.id);
                            const nextEnvironments = useContextStore.getState().environments;
                            const nextEnvironment = nextEnvironments.find((env) => env.id !== deletedId) ?? nextEnvironments[0];
                            if (nextEnvironment) {
                              await switchEnvironment(nextEnvironment.id);
                            }
                            setFeedback({ success: `Environment "${deletedName}" deleted.` });
                          } catch (err) {
                            setFeedback({ error: err instanceof Error ? err.message : 'Failed to delete environment' });
                          }
                        }}
                        disabled={deleteEnvironmentConfirmText !== activeEnvironment?.name || deleteEnvironment.isPending}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-50"
                      >
                        {deleteEnvironment.isPending ? (
                          <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Deleting...</>
                        ) : (
                          'Confirm Delete'
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setShowDeleteEnvironment(false); setDeleteEnvironmentConfirmText(''); }}
                        className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Default Policy */}
          <div className="border-t border-border pt-6">
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Default Policy</h3>
            <p className="text-sm text-gray-500 mb-3">
              Set a default policy for this environment. Devices without a group or device-level
              policy assignment will inherit this policy.
            </p>
            <div className="max-w-md">
              <PolicyAssignmentSelect
                scopeType="environment"
                scopeId={activeEnvironment.id}
                environmentId={activeEnvironment.id}
                currentPolicyId={envPolicyAssignment?.policy_id ?? null}
              />
            </div>
          </div>

          {/* Signup Link */}
          <div className="border-t border-border pt-6">
            <EnvironmentSignupLink environmentId={activeEnvironment.id} />
          </div>

          {/* Sign-in Enrollment (Better Together) */}
          {activeEnvironment.enterprise_name && (
            <div className="border-t border-border pt-6">
              <SigninEnrollmentConfig environmentId={activeEnvironment.id} />
            </div>
          )}

          {/* Zero-touch configuration */}
          {activeEnvironment.enterprise_name && (
            <div className="border-t border-border pt-6">
              <ZeroTouchConfig environmentId={activeEnvironment.id} />
            </div>
          )}

          {/* Flashi Assistant */}
          {platformFlashiEnabled && workspaceFlashiEnabled && (
            <div className="border-t border-border pt-6">
              <FlashiAssistantToggle environmentId={activeEnvironment.id} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function EnvironmentSignupLink({ environmentId }: { environmentId: string }) {
  const { data: groupList } = useGroups(environmentId);
  return (
    <SignupLinkSettings
      scopeType="environment"
      scopeId={environmentId}
      groups={groupList}
    />
  );
}

function SigninEnrollmentConfig({ environmentId }: { environmentId: string }) {
  const { data: config, isLoading } = useSigninConfig(environmentId);
  const { data: groups } = useGroups(environmentId);
  const updateConfig = useUpdateSigninConfig();

  const [enabled, setEnabled] = useState(false);
  const [allowedDomains, setAllowedDomains] = useState('');
  const [defaultGroupId, setDefaultGroupId] = useState<string | null>(null);
  const [allowPersonalUsage, setAllowPersonalUsage] = useState('PERSONAL_USAGE_ALLOWED');
  const [feedback, setFeedback] = useState<{ success?: string; error?: string }>({});

  // Sync from server data
  useEffect(() => {
    if (config) {
      setEnabled(config.enabled);
      setAllowedDomains((config.allowed_domains ?? []).join(', '));
      setDefaultGroupId(config.default_group_id);
      setAllowPersonalUsage(config.allow_personal_usage ?? 'PERSONAL_USAGE_ALLOWED');
    }
  }, [config]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback({});

    const domains = allowedDomains
      .split(/[,\s]+/)
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);

    if (enabled && domains.length === 0) {
      setFeedback({ error: 'At least one allowed email domain is required.' });
      return;
    }

    try {
      await updateConfig.mutateAsync({
        environment_id: environmentId,
        enabled,
        allowed_domains: domains,
        default_group_id: defaultGroupId,
        allow_personal_usage: allowPersonalUsage,
      });
      setFeedback({ success: 'Sign-in enrolment configuration saved.' });
    } catch (err) {
      setFeedback({
        error: err instanceof Error ? err.message : 'Failed to save configuration.',
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading sign-in enrolment config...
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-900 mb-1">Sign-In Enrolment</h3>
      <p className="text-sm text-gray-500 mb-4">
        Allow users to set up a managed work profile by adding their work Google account.
        Users verify their email, then their device is automatically enrolled.
      </p>

      <form onSubmit={handleSave} className="space-y-4 max-w-lg">
        {/* Enabled toggle */}
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-accent focus:ring-accent"
          />
          <span className="text-sm font-medium text-gray-700">
            Enable sign-in URL enrolment
          </span>
        </label>

        {enabled && (
          <>
            {/* Allowed domains */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Allowed email domains
              </label>
              <input
                type="text"
                value={allowedDomains}
                onChange={(e) => setAllowedDomains(e.target.value)}
                placeholder="company.com, subsidiary.org"
                className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-accent focus:ring-1 focus:ring-accent outline-none"
              />
              <p className="text-xs text-gray-400 mt-1">
                Comma-separated list of email domains allowed to enrol
              </p>
            </div>

            {/* Default group */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Default group
              </label>
              <select
                value={defaultGroupId ?? ''}
                onChange={(e) => setDefaultGroupId(e.target.value || null)}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-accent focus:ring-1 focus:ring-accent outline-none bg-white"
              >
                <option value="">No group (environment default)</option>
                {(groups ?? []).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">
                Devices enrolled via sign-in will be assigned to this group
              </p>
            </div>

            {/* Personal usage */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Personal usage
              </label>
              <select
                value={allowPersonalUsage}
                onChange={(e) => setAllowPersonalUsage(e.target.value)}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-accent focus:ring-1 focus:ring-accent outline-none bg-white"
              >
                <option value="PERSONAL_USAGE_ALLOWED">Allowed</option>
                <option value="PERSONAL_USAGE_DISALLOWED">Disallowed</option>
              </select>
            </div>

            {/* AMAPI token display (read-only) */}
            {config?.amapi_signin_enrollment_token && (
              <div className="rounded-lg bg-green-50 border border-green-200 p-3">
                <p className="text-xs font-medium text-green-800 mb-1">
                  Sign-in enrolment is active
                </p>
                <p className="text-xs text-green-700 font-mono break-all">
                  Token: {config.amapi_signin_enrollment_token}
                </p>
              </div>
            )}
          </>
        )}

        {/* Feedback */}
        {feedback.success && (
          <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg p-2.5">
            <Check className="h-4 w-4" />
            {feedback.success}
          </div>
        )}
        {feedback.error && (
          <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">
            <AlertCircle className="h-4 w-4" />
            {feedback.error}
          </div>
        )}

        <button
          type="submit"
          disabled={updateConfig.isPending}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-light transition-colors disabled:opacity-50"
        >
          {updateConfig.isPending ? 'Saving...' : 'Save Sign-In Config'}
        </button>
      </form>
    </div>
  );
}

function ZeroTouchConfig({ environmentId }: { environmentId: string }) {
  const [mode, setMode] = useState<'existing' | 'create'>('existing');
  const [selectedTokenId, setSelectedTokenId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [tokenName, setTokenName] = useState('Zero-touch token');
  const [allowPersonalUsage, setAllowPersonalUsage] = useState<
    'PERSONAL_USAGE_UNSPECIFIED' | 'PERSONAL_USAGE_ALLOWED' | 'PERSONAL_USAGE_DISALLOWED' | 'PERSONAL_USAGE_DISALLOWED_USERLESS'
  >('PERSONAL_USAGE_UNSPECIFIED');
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ success?: string; error?: string }>({});

  const optionsQuery = useZeroTouchOptions(environmentId);
  const iframeTokenMutation = useZeroTouchIframeToken();
  const createTokenMutation = useZeroTouchCreateEnrollmentToken();

  const handleOpenIframe = async () => {
    setFeedback({});
    try {
      const result = await iframeTokenMutation.mutateAsync(environmentId);
      const parsedUrl = new URL(result.iframe_url);
      if (parsedUrl.protocol !== 'https:') throw new Error('Invalid zero-touch iframe URL');
      setIframeUrl(parsedUrl.toString());
    } catch (err) {
      setFeedback({ error: err instanceof Error ? err.message : 'Failed to open zero-touch iframe' });
    }
  };

  const handleCreateToken = async () => {
    setFeedback({});
    try {
      const result = await createTokenMutation.mutateAsync({
        environment_id: environmentId,
        token_name: tokenName.trim() || undefined,
        group_id: groupId || undefined,
        allow_personal_usage: allowPersonalUsage,
      });
      setSelectedTokenId(result.enrollment_token.token_id);
      setFeedback({ success: 'Zero-touch enrollment token created.' });
    } catch (err) {
      setFeedback({ error: err instanceof Error ? err.message : 'Failed to create zero-touch token' });
    }
  };

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-900 mb-1">Zero-Touch Provisioning</h3>
      <p className="text-sm text-gray-500 mb-4">
        Configure zero-touch with existing or newly created enrollment tokens. Group landing is resolved from token additional data.
      </p>

      {optionsQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading zero-touch options...
        </div>
      ) : (
        <div className="space-y-4 max-w-3xl">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setMode('existing')}
              className={clsx(
                'rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
                mode === 'existing' ? 'border-accent bg-accent/10 text-accent' : 'border-border bg-surface text-gray-700'
              )}
            >
              Use existing token
            </button>
            <button
              type="button"
              onClick={() => setMode('create')}
              className={clsx(
                'rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
                mode === 'create' ? 'border-accent bg-accent/10 text-accent' : 'border-border bg-surface text-gray-700'
              )}
            >
              Create token
            </button>
          </div>

          {mode === 'existing' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Enrollment token</label>
              <select
                value={selectedTokenId}
                onChange={(e) => setSelectedTokenId(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:ring-1 focus:ring-accent outline-none"
              >
                <option value="">Select a token</option>
                {(optionsQuery.data?.active_tokens ?? []).map((token) => (
                  <option key={token.id} value={token.id}>
                    {token.name} {token.group_name ? `- ${token.group_name}` : '- no group'}
                  </option>
                ))}
              </select>
            </div>
          )}

          {mode === 'create' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Token name</label>
                <input
                  type="text"
                  value={tokenName}
                  onChange={(e) => setTokenName(e.target.value)}
                  className="w-full max-w-md rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:ring-1 focus:ring-accent outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Landing group (optional)</label>
                <select
                  value={groupId}
                  onChange={(e) => setGroupId(e.target.value)}
                  className="w-full max-w-md rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:ring-1 focus:ring-accent outline-none"
                >
                  <option value="">No group</option>
                  {(optionsQuery.data?.groups ?? []).map((group) => (
                    <option key={group.id} value={group.id}>{group.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Allow personal usage</label>
                <select
                  value={allowPersonalUsage}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === 'PERSONAL_USAGE_DISALLOWED_USERLESS') {
                      setAllowPersonalUsage('PERSONAL_USAGE_DISALLOWED_USERLESS');
                      return;
                    }
                    if (value === 'PERSONAL_USAGE_DISALLOWED') {
                      setAllowPersonalUsage('PERSONAL_USAGE_DISALLOWED');
                      return;
                    }
                    if (value === 'PERSONAL_USAGE_ALLOWED') {
                      setAllowPersonalUsage('PERSONAL_USAGE_ALLOWED');
                      return;
                    }
                    setAllowPersonalUsage('PERSONAL_USAGE_UNSPECIFIED');
                  }}
                  className="w-full max-w-md rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:ring-1 focus:ring-accent outline-none"
                >
                  <option value="PERSONAL_USAGE_UNSPECIFIED">Unspecified</option>
                  <option value="PERSONAL_USAGE_ALLOWED">Allowed</option>
                  <option value="PERSONAL_USAGE_DISALLOWED">Disallowed</option>
                  <option value="PERSONAL_USAGE_DISALLOWED_USERLESS">Dedicated Device (Userless)</option>
                </select>
              </div>
            </>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleOpenIframe}
              disabled={iframeTokenMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {iframeTokenMutation.isPending ? 'Opening...' : 'Open Zero-touch Iframe'}
            </button>
            {mode === 'create' && (
              <button
                type="button"
                onClick={handleCreateToken}
                disabled={createTokenMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                {createTokenMutation.isPending ? 'Creating...' : 'Create Token'}
              </button>
            )}
          </div>

          {feedback.success && <p className="text-sm text-green-700">{feedback.success}</p>}
          {feedback.error && <p className="text-sm text-red-700">{feedback.error}</p>}
        </div>
      )}

      {iframeUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setIframeUrl(null)}
        >
          <div
            className="h-[85vh] w-full max-w-6xl overflow-hidden rounded-xl border border-border bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <p className="text-sm font-semibold text-gray-900">Zero-touch Iframe</p>
              <button
                type="button"
                onClick={() => setIframeUrl(null)}
                className="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                aria-label="Close zero-touch modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <iframe
              title="Zero-touch iframe"
              src={iframeUrl}
              className="h-[calc(85vh-46px)] w-full bg-white"
              sandbox="allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function FlashiWorkspaceCard({
  workspaceId,
  canManageSettings,
}: {
  workspaceId: string;
  canManageSettings: boolean;
}) {
  const { data: settings, isLoading } = useFlashiWorkspaceSettings(workspaceId);
  const updateSettings = useUpdateFlashiWorkspaceSettings();
  const [assistantEnabled, setAssistantEnabled] = useState(true);
  const [maxRole, setMaxRole] = useState<"viewer" | "member" | "admin">("admin");
  const [defaultRole, setDefaultRole] = useState<"viewer" | "member" | "admin">("viewer");
  const [openAiModel, setOpenAiModel] = useState('');
  const [openAiApiKey, setOpenAiApiKey] = useState('');
  const [feedback, setFeedback] = useState<{ success?: string; error?: string }>({});

  useEffect(() => {
    if (!settings) return;
    setAssistantEnabled(settings.workspace_assistant_enabled);
    setMaxRole(settings.workspace_assistant_max_role);
    setDefaultRole(settings.workspace_assistant_default_role);
    setOpenAiModel(settings.workspace_openai_model ?? '');
  }, [settings]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback({});
    try {
      await updateSettings.mutateAsync({
        workspace_id: workspaceId,
        assistant_enabled: assistantEnabled,
        max_role: maxRole,
        default_role: defaultRole,
        openai_model: openAiModel.trim() || null,
        ...(openAiApiKey.trim() ? { openai_api_key: openAiApiKey.trim() } : {}),
      });
      setOpenAiApiKey('');
      setFeedback({ success: 'Flashi workspace settings updated.' });
    } catch (err) {
      setFeedback({
        error: err instanceof Error ? err.message : 'Failed to update Flashi workspace settings.',
      });
    }
  };

  const handleClearOpenAiOverride = async () => {
    setFeedback({});
    try {
      await updateSettings.mutateAsync({
        workspace_id: workspaceId,
        clear_openai_api_key: true,
      });
      setOpenAiApiKey('');
      setFeedback({ success: 'Workspace OpenAI API override cleared.' });
    } catch (err) {
      setFeedback({
        error: err instanceof Error ? err.message : 'Failed to clear OpenAI override.',
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading Flashi workspace settings...
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold text-gray-900 mb-1">Flashi Assistant</h3>
      <p className="text-sm text-gray-500 mb-4">
        Control Flashi access and OpenAI configuration for all environments in this workspace.
        Environment-level Flashi toggles are visible only when workspace access is enabled here.
      </p>

      <form onSubmit={handleSave} className="space-y-4 max-w-xl">
        <label className="inline-flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={assistantEnabled}
            onChange={(e) => setAssistantEnabled(e.target.checked)}
            disabled={!canManageSettings || updateSettings.isPending}
            className="h-4 w-4 rounded border-gray-300 text-accent focus:ring-accent/20"
          />
          <span className="text-sm text-gray-700">
            Allow Flashi for environments in this workspace
          </span>
        </label>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Flashi maximum role (workspace ceiling)
            </label>
            <select
              value={maxRole}
              onChange={(e) => {
                const next = e.target.value as "viewer" | "member" | "admin";
                setMaxRole(next);
                const rank = { viewer: 1, member: 2, admin: 3 };
                if (rank[defaultRole] > rank[next]) {
                  setDefaultRole(next);
                }
              }}
              disabled={!canManageSettings || updateSettings.isPending}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-accent focus:ring-1 focus:ring-accent outline-none bg-white"
            >
              <option value="viewer">Viewer</option>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Flashi default role (new environments)
            </label>
            <select
              value={defaultRole}
              onChange={(e) => setDefaultRole(e.target.value as "viewer" | "member" | "admin")}
              disabled={!canManageSettings || updateSettings.isPending}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-accent focus:ring-1 focus:ring-accent outline-none bg-white"
            >
              <option value="viewer">Viewer</option>
              <option value="member" disabled={maxRole === "viewer"}>Member</option>
              <option value="admin" disabled={maxRole !== "admin"}>Admin</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            OpenAI model override (optional)
          </label>
          <input
            type="text"
            value={openAiModel}
            onChange={(e) => setOpenAiModel(e.target.value)}
            disabled={!canManageSettings || updateSettings.isPending}
            placeholder="e.g. gpt-4.1-mini"
            className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-accent focus:ring-1 focus:ring-accent outline-none"
          />
          <p className="text-xs text-gray-500 mt-1">
            If set, this model is used instead of the `FLASHAGENT_MODEL` environment variable.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            OpenAI API key override (optional)
          </label>
          <input
            type="password"
            value={openAiApiKey}
            onChange={(e) => setOpenAiApiKey(e.target.value)}
            disabled={!canManageSettings || updateSettings.isPending}
            placeholder="sk-..."
            className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-accent focus:ring-1 focus:ring-accent outline-none"
          />
          <p className="text-xs text-gray-500 mt-1">
            Stored encrypted. When set, this key overrides `OPENAI_API_KEY` for this workspace.
          </p>
          {settings?.workspace_openai_override_configured && (
            <p className="mt-1 text-xs text-green-700">
              A workspace OpenAI API key override is currently configured.
            </p>
          )}
          <button
            type="button"
            onClick={handleClearOpenAiOverride}
            disabled={!canManageSettings || updateSettings.isPending || !settings?.workspace_openai_override_configured}
            className="mt-2 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Clear OpenAI API override
          </button>
        </div>

        {feedback.success && (
          <p className="flex items-center gap-1 text-sm text-green-600">
            <Check className="h-4 w-4" /> {feedback.success}
          </p>
        )}
        {feedback.error && (
          <p className="flex items-center gap-1 text-sm text-red-600">
            <AlertCircle className="h-4 w-4" /> {feedback.error}
          </p>
        )}

        <button
          type="submit"
          disabled={!canManageSettings || updateSettings.isPending}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-light transition-colors disabled:opacity-50"
        >
          {updateSettings.isPending ? 'Saving...' : 'Save Flashi Workspace Settings'}
        </button>
      </form>
    </div>
  );
}

function FlashiAssistantToggle({ environmentId }: { environmentId: string }) {
  const { data: settings, isLoading } = useFlashiSettings(environmentId);
  const updateSettings = useUpdateFlashiSettings();
  const [feedback, setFeedback] = useState<{ success?: string; error?: string }>({});
  const [envRole, setEnvRole] = useState<"viewer" | "member" | "admin">("viewer");

  useEffect(() => {
    if (!settings) return;
    setEnvRole(settings.environment_assistant_role);
  }, [settings]);

  const saveSettings = async (enabled: boolean, role: "viewer" | "member" | "admin") => {
    setFeedback({});
    try {
      await updateSettings.mutateAsync({
        environment_id: environmentId,
        enabled,
        role,
      });
      setFeedback({ success: `Flashi settings updated for this environment.` });
    } catch (err) {
      setFeedback({
        error: err instanceof Error ? err.message : 'Failed to update assistant settings.',
      });
    }
  };

  const handleToggle = async () => {
    const newEnabled = !(settings?.environment_assistant_enabled ?? false);
    await saveSettings(newEnabled, envRole);
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading assistant settings...
      </div>
    );
  }

  const platformEnabled = settings?.platform_assistant_enabled ?? false;
  const workspaceEnabled = settings?.workspace_assistant_enabled ?? true;
  const workspaceMaxRole = settings?.workspace_assistant_max_role ?? "admin";
  const envEnabled = settings?.environment_assistant_enabled ?? false;
  const effectiveEnabled = settings?.effective_enabled ?? false;

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-900 mb-1">Flashi Assistant</h3>
      <p className="text-sm text-gray-500 mb-4">
        Enable the AI assistant for this environment. Flashi can query devices, policies, and groups to help answer questions.
      </p>

      {!platformEnabled && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
          The assistant is disabled at platform level. Contact your platform administrator to enable it.
        </p>
      )}
      {!workspaceEnabled && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
          The assistant is disabled at workspace level.
        </p>
      )}

      <label className="inline-flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={envEnabled}
          disabled={!platformEnabled || !workspaceEnabled || updateSettings.isPending}
          onChange={handleToggle}
          className="h-4 w-4 rounded border-gray-300 text-accent focus:ring-accent/20"
        />
        <span className="text-sm text-gray-700">
          Enable Flashi for this environment
        </span>
      </label>

      <div className="mt-3 max-w-xs">
        <label className="block text-xs font-medium text-gray-600 mb-1">
          Flashi role for this environment
        </label>
        <select
          value={envRole}
          onChange={(e) => setEnvRole(e.target.value as "viewer" | "member" | "admin")}
          disabled={!platformEnabled || !workspaceEnabled || updateSettings.isPending}
          className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-accent focus:ring-1 focus:ring-accent outline-none bg-white"
        >
          <option value="viewer">Viewer</option>
          <option value="member" disabled={workspaceMaxRole === "viewer"}>Member</option>
          <option value="admin" disabled={workspaceMaxRole !== "admin"}>Admin</option>
        </select>
        <p className="mt-1 text-xs text-gray-500">
          Workspace ceiling: {workspaceMaxRole}
        </p>
      </div>
      <button
        type="button"
        onClick={() => void saveSettings(envEnabled, envRole)}
        disabled={!platformEnabled || !workspaceEnabled || updateSettings.isPending}
        className="mt-3 rounded-lg border border-border bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        Save Flashi Role
      </button>

      {effectiveEnabled && (
        <p className="mt-2 text-xs text-green-600">✓ Flashi is active for this environment.</p>
      )}

      {feedback.success && (
        <p className="mt-2 flex items-center gap-1 text-sm text-green-600">
          <Check className="h-4 w-4" /> {feedback.success}
        </p>
      )}
      {feedback.error && (
        <p className="mt-2 flex items-center gap-1 text-sm text-red-600">
          <AlertCircle className="h-4 w-4" /> {feedback.error}
        </p>
      )}
    </div>
  );
}

// ---- API Tab ----

function ApiKeyScopePanel(props: {
  title: string;
  description: string;
  scopeType: 'workspace' | 'environment';
  scopeId: string;
  canCreate: boolean;
  canView: boolean;
  maxRole: WorkspaceRole;
}) {
  const API_KEY_ROLES: Array<{ value: 'owner' | 'admin' | 'member' | 'viewer'; label: string }> = [
    { value: 'owner', label: 'Owner' },
    { value: 'admin', label: 'Admin' },
    { value: 'member', label: 'Member' },
    { value: 'viewer', label: 'Viewer' },
  ];
  const API_KEY_DURATIONS: Array<{ value: string; label: string }> = [
    { value: '', label: 'Never expires' },
    { value: '7', label: '7 days' },
    { value: '30', label: '30 days' },
    { value: '90', label: '90 days' },
    { value: '180', label: '180 days' },
    { value: '365', label: '365 days' },
  ];
  const createApiKey = useCreateApiKey();
  const revokeApiKey = useRevokeApiKey();
  const workspaceKeys = useWorkspaceApiKeys(props.scopeType === 'workspace' ? props.scopeId : undefined);
  const environmentKeys = useEnvironmentApiKeys(props.scopeType === 'environment' ? props.scopeId : undefined);
  const keys = props.scopeType === 'workspace' ? (workspaceKeys.data ?? []) : (environmentKeys.data ?? []);
  const isLoading = props.scopeType === 'workspace' ? workspaceKeys.isLoading : environmentKeys.isLoading;
  const queryError = props.scopeType === 'workspace' ? workspaceKeys.error : environmentKeys.error;
  const [name, setName] = useState('');
  const [role, setRole] = useState<'owner' | 'admin' | 'member' | 'viewer'>(props.maxRole);
  const [expiresInDays, setExpiresInDays] = useState<string>('');
  const [feedback, setFeedback] = useState<{ success?: string; error?: string }>({});
  const [createdToken, setCreatedToken] = useState<{ name: string; token: string; token_prefix: string; expires_at: string | null } | null>(null);
  const getMaskedTokenDisplay = (keyRow: { token_prefix: string }) => `${keyRow.token_prefix}••••••••••••`;
  const allowedRoleOptions = API_KEY_ROLES.filter((option) => ROLE_LEVEL[option.value] <= ROLE_LEVEL[props.maxRole]);

  useEffect(() => {
    if (ROLE_LEVEL[role] > ROLE_LEVEL[props.maxRole]) {
      setRole(props.maxRole);
    }
  }, [role, props.maxRole]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!props.canCreate || !name.trim()) return;
    setFeedback({});
    try {
      const result = await createApiKey.mutateAsync({
        scope_type: props.scopeType,
        ...(props.scopeType === 'workspace'
          ? { workspace_id: props.scopeId }
          : { environment_id: props.scopeId }),
        name: name.trim(),
        role,
        ...(expiresInDays ? { expires_in_days: Number(expiresInDays) } : {}),
      });
      setCreatedToken({
        name: result.api_key.name,
        token: result.api_key.token ?? '',
        token_prefix: result.api_key.token_prefix,
        expires_at: result.api_key.expires_at,
      });
      setFeedback({
        success: `API key created: ${result.api_key.name}. Copy it now: the full value will not be shown again.`,
      });
      setName('');
      setExpiresInDays('');
    } catch (err) {
      setFeedback({ error: err instanceof Error ? err.message : 'Failed to create API key' });
    }
  };

  return (
    <div className="rounded-xl border border-border bg-surface p-4 sm:p-5 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">{props.title}</h3>
        <p className="mt-1 text-sm text-gray-500">{props.description}</p>
      </div>

      {props.canCreate ? (
        <form onSubmit={handleCreate} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-700 mb-1">Key name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={props.scopeType === 'workspace' ? 'Local integration (workspace-wide)' : 'Local integration (environment)'}
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
          <div className="sm:w-40">
            <label className="block text-xs font-medium text-gray-700 mb-1">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as typeof role)}
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            >
              {allowedRoleOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div className="sm:w-44">
            <label className="block text-xs font-medium text-gray-700 mb-1">Duration</label>
            <select
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value)}
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            >
              {API_KEY_DURATIONS.map((option) => (
                <option key={option.value || 'never'} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={createApiKey.isPending || !name.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-light transition-colors disabled:opacity-50"
          >
            {createApiKey.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Key className="h-4 w-4" />}
            {createApiKey.isPending ? 'Generating...' : 'Generate API Key'}
          </button>
        </form>
      ) : (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {props.scopeType === 'workspace'
            ? 'Only owners can generate keys for this scope. Admins can still view existing keys below.'
            : 'Only admins or higher can generate keys for this scope.'}
        </div>
      )}

      <FeedbackMessage {...feedback} />
      {createdToken && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-3">
          <p className="text-xs font-medium text-green-900">New API key (shown once)</p>
          <p className="mt-1 text-xs text-green-800">
            {createdToken.name} · {createdToken.token_prefix}••••••••••••
          </p>
          <p className="mt-1 text-xs text-green-800">
            Expires: {createdToken.expires_at ? new Date(createdToken.expires_at).toLocaleString() : 'Never'}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="block min-w-0 flex-1 break-all rounded border border-green-200 bg-white px-2 py-1.5 text-xs text-gray-800">
              {createdToken.token}
            </code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(createdToken.token);
                setFeedback({ success: `Copied API key "${createdToken.name}" to clipboard.` });
              }}
              className="inline-flex items-center gap-1 rounded-md border border-green-300 bg-white px-2 py-1 text-xs text-green-800 hover:bg-green-100"
            >
              <Copy className="h-3 w-3" />
              Copy
            </button>
          </div>
        </div>
      )}

      {!props.canView ? (
        <p className="text-sm text-gray-500">You need admin access in this scope to view keys.</p>
      ) : queryError ? (
        <p className="text-sm text-red-700">
          {queryError instanceof Error ? queryError.message : 'Failed to load API keys'}
        </p>
      ) : isLoading ? (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading API keys…
        </div>
      ) : keys.length === 0 ? (
        <p className="text-sm text-gray-500">No API keys created for this scope yet.</p>
      ) : (
        <div className="space-y-3">
          {keys.map((keyRow) => (
            <div key={keyRow.id} className="rounded-lg border border-border bg-white p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">{keyRow.name}</p>
                  <p className="mt-1 text-xs text-gray-500">
                    Role: <span className="font-medium text-gray-700">{keyRow.role}</span>{' · '}
                    Created {new Date(keyRow.created_at).toLocaleString()}
                    {(keyRow.created_by_name || keyRow.created_by_email)
                      ? ` by ${keyRow.created_by_name ?? keyRow.created_by_email}`
                      : ''}
                  </p>
                  <p className="text-xs text-gray-500">
                    Last used: {keyRow.last_used_at ? new Date(keyRow.last_used_at).toLocaleString() : 'Never'}
                    {keyRow.last_used_ip ? ` (${keyRow.last_used_ip})` : ''}
                  </p>
                  <p className="text-xs text-gray-500">
                    Expires: {keyRow.expires_at
                      ? `${new Date(keyRow.expires_at).toLocaleString()}${new Date(keyRow.expires_at).getTime() <= Date.now() ? ' (expired)' : ''}`
                      : 'Never'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await revokeApiKey.mutateAsync({
                        id: keyRow.id,
                        workspace_id: props.scopeType === 'workspace' ? props.scopeId : undefined,
                        environment_id: props.scopeType === 'environment' ? props.scopeId : undefined,
                      });
                      setFeedback({ success: `Revoked API key "${keyRow.name}".` });
                    } catch (err) {
                      setFeedback({ error: err instanceof Error ? err.message : 'Failed to revoke API key' });
                    }
                  }}
                  disabled={revokeApiKey.isPending}
                  className="inline-flex items-center justify-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Revoke
                </button>
              </div>
              <div className="mt-3 rounded-md bg-gray-50 border border-gray-200 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <code className="block min-w-0 flex-1 break-all text-xs text-gray-700">
                    {getMaskedTokenDisplay(keyRow)}
                  </code>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ApiTab() {
  const { activeWorkspace, activeEnvironment, environments } = useContextStore();
  const { user } = useAuthStore();
  const workspaceRole = activeWorkspace?.user_role ?? null;
  const hasWorkspaceScopedAccess = Boolean(user?.is_superadmin || activeWorkspace?.access_scope === 'workspace');
  const permissionMatrix = useMemo(
    () => getEffectiveSettingsPermissionMatrix((activeWorkspace as { settings?: unknown } | null)?.settings),
    [activeWorkspace]
  );
  const workspaceCanView = Boolean(
    hasWorkspaceScopedAccess && meetsRole(workspaceRole, permissionMatrix.workspace?.write)
  );
  const workspaceCanCreate = Boolean(
    hasWorkspaceScopedAccess && workspaceRole === 'owner'
  );
  const environmentRole = activeEnvironment?.user_role ?? workspaceRole;
  const environmentCanView = Boolean(user?.is_superadmin || meetsRole(environmentRole, permissionMatrix.environment?.write));
  const environmentCanCreate = Boolean(user?.is_superadmin || meetsRole(environmentRole, permissionMatrix.environment?.manage_settings));
  const environmentMaxKeyRole = user?.is_superadmin ? 'owner' : normalizeWorkspaceRole(environmentRole);
  const boundEnvironment = activeEnvironment?.enterprise_name
    ? activeEnvironment
    : environments.find((env) => Boolean(env.enterprise_name)) ?? null;
  const enterpriseName = boundEnvironment?.enterprise_name ?? null;
  const enterpriseId = enterpriseName ? enterpriseName.split('/').filter(Boolean).pop() ?? null : null;
  const copyValue = (value: string | null | undefined) => {
    if (!value) return;
    void navigator.clipboard.writeText(value);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-blue-900">OpenAPI Specification</h3>
            <p className="mt-1 text-sm text-blue-800">
              Download the route-complete OpenAPI document for Flash&apos;s `/api` endpoints and use a workspace/environment API key for local clients.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href="/openapi.json"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-blue-300 bg-white px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
            >
              <ExternalLink className="h-4 w-4" />
              Open Spec
            </a>
            <a
              href="/openapi.json"
              download="flash-openapi.json"
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              <Download className="h-4 w-4" />
              Download JSON
            </a>
          </div>
        </div>
        <div className="mt-3 rounded-lg border border-blue-200 bg-white px-3 py-2">
          <p className="text-xs text-blue-900 font-medium mb-1">Example</p>
          <code className="block text-xs text-blue-900 break-all">
            curl -H "Authorization: Bearer flash_workspace_..." https://flash-mdm.netlify.app/api/devices/list?environment_id=&lt;env_id&gt;
          </code>
        </div>
        <div className="mt-3 rounded-lg border border-blue-200 bg-white px-3 py-3">
          <p className="text-xs font-medium text-blue-900">Current API Context</p>
          <p className="mt-1 text-xs text-blue-800">
            Use these values to get started quickly in Swagger or curl examples.
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div className="rounded-md border border-blue-100 bg-blue-50/60 px-2.5 py-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-blue-700">Workspace ID</p>
              <div className="mt-1 flex items-start gap-2">
                <code className="min-w-0 flex-1 break-all text-xs text-blue-950">
                  {activeWorkspace?.id ?? 'Select a workspace'}
                </code>
                {activeWorkspace?.id && (
                  <button
                    type="button"
                    onClick={() => copyValue(activeWorkspace.id)}
                    className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-white px-2 py-1 text-[11px] text-blue-700 hover:bg-blue-100"
                  >
                    <Copy className="h-3 w-3" />
                    Copy
                  </button>
                )}
              </div>
            </div>
            <div className="rounded-md border border-blue-100 bg-blue-50/60 px-2.5 py-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-blue-700">Environment ID</p>
              <div className="mt-1 flex items-start gap-2">
                <code className="min-w-0 flex-1 break-all text-xs text-blue-950">
                  {activeEnvironment?.id ?? 'Select an environment'}
                </code>
                {activeEnvironment?.id && (
                  <button
                    type="button"
                    onClick={() => copyValue(activeEnvironment.id)}
                    className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-white px-2 py-1 text-[11px] text-blue-700 hover:bg-blue-100"
                  >
                    <Copy className="h-3 w-3" />
                    Copy
                  </button>
                )}
              </div>
              {boundEnvironment && (
                <p className="mt-1 text-[11px] text-blue-700">
                  From environment: {boundEnvironment.name}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {activeWorkspace && (workspaceCanView || workspaceCanCreate) ? (
        <ApiKeyScopePanel
          title={`Workspace API Keys (${activeWorkspace.name})`}
          description="Workspace keys can access workspace-scoped and inherited environment resources inside this workspace."
          scopeType="workspace"
          scopeId={activeWorkspace.id}
          canCreate={workspaceCanCreate}
          canView={workspaceCanView}
          maxRole="owner"
        />
      ) : !activeWorkspace ? (
        <p className="text-sm text-gray-500">Select a workspace to manage workspace API keys.</p>
      ) : null}

      {activeWorkspace && activeEnvironment ? (
        <ApiKeyScopePanel
          title={`Environment API Keys (${activeEnvironment.name})`}
          description="Environment keys are limited to a single environment and are intended for local clients or service tooling."
          scopeType="environment"
          scopeId={activeEnvironment.id}
          canCreate={environmentCanCreate}
          canView={environmentCanView}
          maxRole={environmentMaxKeyRole}
        />
      ) : (
        <p className="text-sm text-gray-500">Select an environment to manage environment-scoped API keys.</p>
      )}
    </div>
  );
}

// ---- Profile Tab ----

function ProfileTab() {
  const { user, fetchSession } = useAuthStore();
  const totpEnabled = user?.totp_enabled ?? false;

  const [firstName, setFirstName] = useState(user?.first_name ?? '');
  const [lastName, setLastName] = useState(user?.last_name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [profileFeedback, setProfileFeedback] = useState<{ success?: string; error?: string }>({});
  const [passwordFeedback, setPasswordFeedback] = useState<{ success?: string; error?: string }>({});
  const [totpFeedback, setTotpFeedback] = useState<{ success?: string; error?: string }>({});
  const [profileSaving, setProfileSaving] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordSetupSending, setPasswordSetupSending] = useState(false);
  const [totpSaving, setTotpSaving] = useState(false);
  const [setupStep, setSetupStep] = useState<'idle' | 'loading' | 'verify' | 'done'>('idle');
  const [setupData, setSetupData] = useState<{
    secret: string;
    qr_url: string;
    backup_codes: string[];
  } | null>(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [showDisable, setShowDisable] = useState(false);
  const [showBackupCodes, setShowBackupCodes] = useState(false);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileFeedback({});
    setProfileSaving(true);
    try {
      await apiClient.put('/api/auth/profile', {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim(),
      });
      setProfileFeedback({ success: 'Profile updated.' });
    } catch (err) {
      setProfileFeedback({ error: err instanceof Error ? err.message : 'Failed to update profile' });
    } finally {
      setProfileSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword) return;
    setPasswordFeedback({});
    setPasswordSaving(true);
    try {
      await apiClient.post('/api/auth/password-change', {
        current_password: currentPassword,
        new_password: newPassword,
      });
      setPasswordFeedback({ success: 'Password changed.' });
      setCurrentPassword('');
      setNewPassword('');
    } catch (err) {
      setPasswordFeedback({ error: err instanceof Error ? err.message : 'Failed to change password' });
    } finally {
      setPasswordSaving(false);
    }
  };

  const handleSendPasswordSetup = async () => {
    if (!user?.email) return;
    setPasswordFeedback({});
    setPasswordSetupSending(true);
    try {
      await apiClient.post('/api/auth/password-reset-start', { email: user.email });
      setPasswordFeedback({ success: 'Password setup link sent to your email.' });
    } catch (err) {
      setPasswordFeedback({ error: err instanceof Error ? err.message : 'Failed to send password setup link' });
    } finally {
      setPasswordSetupSending(false);
    }
  };

  const handleStartSetup = async () => {
    setSetupStep('loading');
    setTotpFeedback({});
    try {
      const data = await apiClient.post<{
        secret: string;
        qr_url: string;
        backup_codes: string[];
      }>('/api/auth/totp-setup', {});
      setSetupData(data);
      setSetupStep('verify');
    } catch (err) {
      setTotpFeedback({ error: err instanceof Error ? err.message : 'Failed to start TOTP setup' });
      setSetupStep('idle');
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verifyCode || verifyCode.length !== 6) {
      setTotpFeedback({ error: 'Please enter a 6-digit code' });
      return;
    }
    setTotpSaving(true);
    setTotpFeedback({});
    try {
      await apiClient.post('/api/auth/totp-verify/verify', { code: verifyCode });
      setSetupStep('done');
      setShowBackupCodes(true);
      setTotpFeedback({ success: 'TOTP enabled successfully! Save your backup codes now.' });
      await fetchSession();
    } catch (err) {
      setTotpFeedback({ error: err instanceof Error ? err.message : 'Invalid code. Please try again.' });
    } finally {
      setTotpSaving(false);
    }
  };

  const handleDisable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!disableCode.trim()) {
      setTotpFeedback({ error: 'Please enter an authenticator or backup code to disable TOTP' });
      return;
    }
    setTotpSaving(true);
    setTotpFeedback({});
    try {
      await apiClient.post('/api/auth/totp-verify/disable', { code: disableCode.trim() });
      setTotpFeedback({ success: 'TOTP disabled successfully.' });
      setShowDisable(false);
      setDisableCode('');
      await fetchSession();
    } catch (err) {
      setTotpFeedback({ error: err instanceof Error ? err.message : 'Invalid code. Please try again.' });
    } finally {
      setTotpSaving(false);
    }
  };

  const handleTotpCancel = () => {
    setSetupStep('idle');
    setSetupData(null);
    setVerifyCode('');
    setTotpFeedback({});
  };

  return (
    <div className="space-y-8">
      {/* Profile info */}
      <form onSubmit={handleSaveProfile} className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-900">Personal Information</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">First Name</label>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Last Name</label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full max-w-md rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
        </div>
        <FeedbackMessage {...profileFeedback} />
        <button
          type="submit"
          disabled={profileSaving}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-light transition-colors disabled:opacity-50"
        >
          {profileSaving ? 'Saving...' : 'Save Profile'}
        </button>
      </form>

      {/* Change Password */}
      <div className="border-t border-border pt-6">
        <form onSubmit={handleChangePassword} className="space-y-4">
          <h3 className="text-sm font-semibold text-gray-900">Change Password</h3>
          <div className="max-w-md space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Current Password</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
              <input
                type="password"
                minLength={MIN_PASSWORD_LENGTH}
                maxLength={MAX_PASSWORD_LENGTH}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
              <p className="mt-1 text-xs text-gray-500">Minimum {MIN_PASSWORD_LENGTH} characters</p>
            </div>
          </div>
          <FeedbackMessage {...passwordFeedback} />
          <button
            type="submit"
            disabled={passwordSaving || !currentPassword || newPassword.length < MIN_PASSWORD_LENGTH}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-light transition-colors disabled:opacity-50"
          >
            {passwordSaving ? 'Changing...' : 'Change Password'}
          </button>
          <button
            type="button"
            onClick={handleSendPasswordSetup}
            disabled={passwordSetupSending || !user?.email}
            className="ml-2 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            {passwordSetupSending ? 'Sending link...' : 'Send Password Setup Link'}
          </button>
        </form>
      </div>

      {/* Two-Factor Authentication */}
      <div className="border-t border-border pt-6 space-y-6">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Two-Factor Authentication (TOTP)</h3>
          <div className="flex items-center gap-3 mt-2">
            <span
              className={clsx(
                'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                totpEnabled
                  ? 'bg-green-100 text-green-700'
                  : 'bg-yellow-100 text-yellow-700',
              )}
            >
              {totpEnabled ? 'Enabled' : 'Not enabled'}
            </span>
          </div>
          <p className="text-sm text-gray-500 max-w-lg mt-2">
            Two-factor authentication adds an extra layer of security to your account
            by requiring a time-based code from an authenticator app when you log in.
          </p>
        </div>

        <FeedbackMessage {...totpFeedback} />

        {totpEnabled && setupStep === 'idle' && (
          <div className="space-y-3">
            {!showDisable ? (
              <button
                type="button"
                onClick={() => { setShowDisable(true); setTotpFeedback({}); }}
                className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
              >
                Disable TOTP
              </button>
            ) : (
              <form onSubmit={handleDisable} className="space-y-3 max-w-sm">
                <p className="text-sm text-gray-600">
                  Enter a code from your authenticator app or a backup code to confirm disabling TOTP.
                </p>
                <input
                  type="text"
                  value={disableCode}
                  onChange={(e) => setDisableCode(e.target.value)}
                  placeholder="Authenticator or backup code"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm font-mono focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                  autoFocus
                />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={totpSaving || !disableCode.trim()}
                    className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-50"
                  >
                    {totpSaving ? 'Disabling...' : 'Confirm Disable'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowDisable(false); setDisableCode(''); setTotpFeedback({}); }}
                    className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {!totpEnabled && setupStep === 'idle' && (
          <button
            type="button"
            onClick={handleStartSetup}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-light transition-colors"
          >
            Set Up TOTP
          </button>
        )}

        {setupStep === 'loading' && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            Generating TOTP secret...
          </div>
        )}

        {setupStep === 'verify' && setupData && (
          <div className="space-y-4 max-w-md">
            <div className="rounded-lg border border-border bg-gray-50 p-4 space-y-3">
              <p className="text-sm font-medium text-gray-900">
                1. Scan this URI in your authenticator app or enter the secret manually:
              </p>
              <div className="bg-white rounded border border-gray-200 p-3">
                <code className="text-xs text-gray-700 break-all select-all">{setupData.qr_url}</code>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Manual entry secret:</p>
                <code className="text-sm font-mono font-semibold text-gray-900 select-all tracking-wider">
                  {setupData.secret}
                </code>
              </div>
            </div>

            <form onSubmit={handleVerify} className="space-y-3">
              <p className="text-sm font-medium text-gray-900">
                2. Enter the 6-digit code from your authenticator to verify:
              </p>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                className="w-40 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-mono text-center tracking-widest focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={totpSaving || verifyCode.length !== 6}
                  className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-light transition-colors disabled:opacity-50"
                >
                  {totpSaving ? 'Verifying...' : 'Verify & Enable'}
                </button>
                <button
                  type="button"
                  onClick={handleTotpCancel}
                  className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {showBackupCodes && setupData && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3 max-w-md">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-600" />
              <p className="text-sm font-semibold text-amber-800">Save Your Backup Codes</p>
            </div>
            <p className="text-xs text-amber-700">
              These codes can be used to log in if you lose access to your authenticator app.
              Each code can only be used once. Store them securely.
            </p>
            <div className="grid grid-cols-2 gap-1 bg-white rounded border border-amber-200 p-3">
              {setupData.backup_codes.map((code, i) => (
                <code key={i} className="text-sm font-mono text-gray-800">{code}</code>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(setupData.backup_codes.join('\n'));
                setTotpFeedback({ success: 'Backup codes copied to clipboard' });
              }}
              className="text-xs text-accent hover:text-accent-light font-medium"
            >
              Copy to clipboard
            </button>
          </div>
        )}

        {setupStep === 'done' && (
          <button
            type="button"
            onClick={() => {
              setSetupStep('idle');
              setSetupData(null);
              setShowBackupCodes(false);
              setVerifyCode('');
            }}
            className="text-sm text-accent hover:text-accent-light font-medium"
          >
            Done
          </button>
        )}
      </div>
    </div>
  );
}

// ---- Main Settings page ----

export default function Settings() {
  const { user } = useAuthStore();
  const { activeWorkspace, activeEnvironment } = useContextStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const permissionMatrix = useMemo(
    () => getEffectiveSettingsPermissionMatrix((activeWorkspace as { settings?: unknown } | null)?.settings),
    [activeWorkspace]
  );

  const workspaceRole = activeWorkspace?.user_role ?? null;
  const hasWorkspaceScopedAccess = activeWorkspace?.access_scope === 'workspace';
  const workspaceCanRead = Boolean(
    user?.is_superadmin
      || (hasWorkspaceScopedAccess && meetsRole(workspaceRole, permissionMatrix.workspace?.read))
  );

  const envRoleCandidate = activeWorkspace?.access_scope === 'workspace'
    ? (activeWorkspace?.user_role ?? null)
    : (activeEnvironment?.user_role ?? null);
  const environmentCanRead = Boolean(user?.is_superadmin || meetsRole(envRoleCandidate, permissionMatrix.environment?.read));

  const visibleTabs = useMemo(
    () => TABS.filter((tab) => {
      if (tab.id === 'workspace') return workspaceCanRead;
      if (tab.id === 'environment') return environmentCanRead;
      return true;
    }),
    [workspaceCanRead, environmentCanRead]
  );

  const activeTab = (() => {
    const tabParam = searchParams.get('tab');
    if (isSettingsTabId(tabParam) && visibleTabs.some((t) => t.id === tabParam)) {
      return tabParam;
    }
    return visibleTabs[0]?.id ?? 'profile';
  })();

  useEffect(() => {
    const currentTab = searchParams.get('tab');
    if (currentTab === activeTab && visibleTabs.some((t) => t.id === activeTab)) return;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('tab', activeTab);
    setSearchParams(nextParams, { replace: true });
  }, [activeTab, searchParams, setSearchParams, visibleTabs]);

  const renderTab = useCallback(() => {
    switch (activeTab) {
      case 'workspace':
        return <WorkspaceTab />;
      case 'environment':
        return <EnvironmentTab />;
      case 'api':
        return <ApiTab />;
      case 'profile':
        return <ProfileTab />;
    }
  }, [activeTab]);

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Settings</h1>

      <div className="bg-white rounded-xl border border-gray-200">
        {/* Tab bar */}
        <div className="border-b border-gray-200">
          <div className="overflow-x-auto px-4">
            <nav className="flex min-w-max gap-4 sm:gap-6 -mb-px whitespace-nowrap">
            {visibleTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  const nextParams = new URLSearchParams(searchParams);
                  nextParams.set('tab', tab.id);
                  setSearchParams(nextParams, { replace: true });
                }}
                className={clsx(
                  'inline-flex items-center gap-2 py-3 text-sm font-medium border-b-2 transition-colors',
                  activeTab === tab.id
                    ? 'border-accent text-accent'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
                )}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </button>
            ))}
            </nav>
          </div>
        </div>

        {/* Tab content */}
        <div className="p-6">{renderTab()}</div>
      </div>
    </div>
  );
}
