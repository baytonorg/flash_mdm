import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Search, Package, X, ExternalLink, Download, Loader2, Play, Settings2, Pencil, Trash2,
} from 'lucide-react';
import clsx from 'clsx';
import { apiClient } from '@/api/client';
import { useContextStore } from '@/stores/context';
import {
  useAppSearch,
  useAppDetails,
  useDeployApp,
  useUpdateAppDeployment,
  useDeleteAppDeployment,
  useAppWebToken,
  useAppCatalog,
  useApp,
  useImportApp,
  useDeleteApp,
  useAddAppScopeConfig,
  useUpdateAppScopeConfig,
  useDeleteAppScopeConfig,
  type AppSearchResult,
  type AppDeployment,
  type CatalogApp,
  type AppScopeConfig,
} from '@/api/queries/apps';
import PlayStoreIframe from '@/components/apps/PlayStoreIframe';
import ManagedConfigEditor from '@/components/apps/ManagedConfigEditor';
import AppScopeSelector from '@/components/apps/AppScopeSelector';
import AmapiApplicationPolicyEditor from '@/components/apps/AmapiApplicationPolicyEditor';
import JsonField from '@/components/policy/fields/JsonField';

// ─── Install type options ───────────────────────────────────────────────────

const INSTALL_TYPES = [
  { value: 'INSTALL_TYPE_UNSPECIFIED', label: 'Unspecified', description: 'Use AMAPI default behavior' },
  { value: 'FORCE_INSTALLED', label: 'Force Installed', description: 'Automatically installed, cannot be removed' },
  { value: 'AVAILABLE', label: 'Available', description: 'Available in managed Play Store' },
  { value: 'PREINSTALLED', label: 'Preinstalled', description: 'Automatically installed, can be removed' },
  { value: 'BLOCKED', label: 'Blocked', description: 'App is blocked from installation' },
  { value: 'REQUIRED_FOR_SETUP', label: 'Required For Setup', description: 'Blocks setup completion until installed' },
  { value: 'KIOSK', label: 'Kiosk (Deprecated)', description: 'Prefer AMAPI app role KIOSK where possible' },
  { value: 'CUSTOM', label: 'Custom (AMAPI SDK)', description: 'Custom app installed/updated via AMAPI SDK command' },
];

const AUTO_UPDATE_MODES = [
  { value: 'AUTO_UPDATE_DEFAULT', label: 'Default' },
  { value: 'AUTO_UPDATE_POSTPONED', label: 'Postponed' },
  { value: 'AUTO_UPDATE_HIGH_PRIORITY', label: 'High Priority' },
];

function formatInstallTypeLabel(value: string) {
  return value.replace(/_/g, ' ');
}

function formatScopeTypeLabel(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatAutoUpdateLabel(value: string | null | undefined) {
  if (!value) return 'Default';
  return AUTO_UPDATE_MODES.find((m) => m.value === value)?.label ?? value.replace(/^AUTO_UPDATE_/, '').replace(/_/g, ' ');
}

// ─── Page Component ─────────────────────────────────────────────────────────

export default function Applications() {
  const activeEnvironment = useContextStore((s) => s.activeEnvironment);
  const environmentId = activeEnvironment?.id;

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [searchTimeout, setSearchTimeout] = useState<ReturnType<typeof setTimeout> | null>(null);

  // Detail panel
  const [selectedPackage, setSelectedPackage] = useState<string | null>(null);

  // Deploy modal
  const [deployModalOpen, setDeployModalOpen] = useState(false);
  const [deployPackage, setDeployPackage] = useState<{ package_name: string; title: string } | null>(null);
  const [installType, setInstallType] = useState('FORCE_INSTALLED');
  const [autoUpdateMode, setAutoUpdateMode] = useState('AUTO_UPDATE_DEFAULT');
  const [scope, setScope] = useState<{ scope_type: 'environment' | 'group' | 'device'; scope_id: string }>({
    scope_type: 'environment',
    scope_id: environmentId ?? '',
  });
  const [managedConfig, setManagedConfig] = useState<Record<string, unknown>>({});

  // Edit/delete state
  const [editingDeployment, setEditingDeployment] = useState<AppDeployment | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Play Store iframe
  const [showIframe, setShowIframe] = useState(false);
  const webTokenMutation = useAppWebToken();

  // Keep legacy deployments UI mounted in code for now, but hide it from users.
  const showLegacyDeployments = false;

  // Catalog state
  const [selectedCatalogApp, setSelectedCatalogApp] = useState<string | null>(null);
  const [catalogScopeModal, setCatalogScopeModal] = useState<CatalogApp | null>(null);
  const [editingScopeConfig, setEditingScopeConfig] = useState<AppScopeConfig | null>(null);
  const [scopeConfigScope, setScopeConfigScope] = useState<{ scope_type: 'environment' | 'group' | 'device'; scope_id: string }>({
    scope_type: 'environment',
    scope_id: environmentId ?? '',
  });
  const [scopeConfigInstallType, setScopeConfigInstallType] = useState('FORCE_INSTALLED');
  const [scopeConfigAutoUpdate, setScopeConfigAutoUpdate] = useState('AUTO_UPDATE_DEFAULT');
  const [scopeConfigManagedConfig, setScopeConfigManagedConfig] = useState<Record<string, unknown>>({});
  const [scopeConfigAppPolicy, setScopeConfigAppPolicy] = useState<Record<string, unknown>>({});
  const [scopeConfigTab, setScopeConfigTab] = useState<'general' | 'managed' | 'amapi'>('general');
  const [scopeConfigManagedConfigTab, setScopeConfigManagedConfigTab] = useState<'form' | 'json'>('form');
  const [deleteCatalogAppId, setDeleteCatalogAppId] = useState<string | null>(null);

  // Reset local state on environment switch
  useEffect(() => {
    setSelectedPackage(null);
    setDeployModalOpen(false);
    setDeployPackage(null);
    setEditingDeployment(null);
    setDeleteConfirmId(null);
    setSearchQuery('');
    setDebouncedQuery('');
    setSelectedCatalogApp(null);
    setCatalogScopeModal(null);
    setEditingScopeConfig(null);
    setDeleteCatalogAppId(null);
    setShowIframe(false);
    setScope({ scope_type: 'environment', scope_id: environmentId ?? '' });
    setScopeConfigScope({ scope_type: 'environment', scope_id: environmentId ?? '' });
  }, [environmentId]);

  // Queries
  const { data: searchResults = [], isLoading: isSearching } = useAppSearch(environmentId, debouncedQuery);
  const { data: appDetail, isLoading: isLoadingDetail } = useAppDetails(environmentId, selectedPackage ?? undefined);
  const deployMutation = useDeployApp();
  const updateMutation = useUpdateAppDeployment();
  const deleteMutation = useDeleteAppDeployment();

  // Catalog queries
  const { data: catalogApps = [] } = useAppCatalog(environmentId);
  const { data: selectedAppData } = useApp(selectedCatalogApp ?? undefined);
  const { data: selectedCatalogAppDetail, isLoading: isLoadingSelectedCatalogAppDetail } = useAppDetails(
    environmentId,
    selectedAppData?.app.package_name ?? undefined
  );
  const importMutation = useImportApp();
  const deleteAppMutation = useDeleteApp();
  const addScopeConfigMutation = useAddAppScopeConfig();
  const updateScopeConfigMutation = useUpdateAppScopeConfig();
  const deleteScopeConfigMutation = useDeleteAppScopeConfig();
  const { data: catalogScopeConfigAppDetail } = useAppDetails(
    environmentId,
    catalogScopeModal?.package_name ?? undefined
  );

  // Fetch deployed apps
  const { data: deploymentsData } = useQuery({
    queryKey: ['apps', 'deployments', environmentId],
    queryFn: () =>
      apiClient.get<{ deployments: AppDeployment[] }>(
        `/api/apps/list?environment_id=${environmentId}`
      ),
    enabled: !!environmentId,
  });
  const deployments = deploymentsData?.deployments ?? [];

  // ── Handlers ──
  const handleSearchInput = (value: string) => {
    setSearchQuery(value);
    if (searchTimeout) clearTimeout(searchTimeout);
    const timeout = setTimeout(() => setDebouncedQuery(value), 400);
    setSearchTimeout(timeout);
  };

  const handleSelectApp = (app: AppSearchResult) => {
    setSelectedPackage(app.package_name);
  };

  const handleOpenDeploy = (packageName: string, title: string) => {
    setDeployPackage({ package_name: packageName, title });
    setScope({ scope_type: 'environment', scope_id: environmentId ?? '' });
    setInstallType('FORCE_INSTALLED');
    setAutoUpdateMode('AUTO_UPDATE_DEFAULT');
    setManagedConfig({});
    setDeployModalOpen(true);
  };

  const handleDeploy = () => {
    if (!environmentId || !deployPackage) return;
    deployMutation.mutate(
      {
        environment_id: environmentId,
        package_name: deployPackage.package_name,
        display_name: deployPackage.title,
        install_type: installType,
        scope_type: scope.scope_type,
        scope_id: scope.scope_id || environmentId,
        managed_config: managedConfig,
        auto_update_mode: autoUpdateMode,
      },
      {
        onSuccess: () => {
          setDeployModalOpen(false);
          setDeployPackage(null);
        },
      }
    );
  };

  const handleGenerateWebToken = () => {
    if (!environmentId) return;
    webTokenMutation.mutate({ environment_id: environmentId });
    setShowIframe(true);
  };

  const handleIframeAppSelected = async (packageName: string) => {
    setSelectedPackage(packageName);
    const existingApp = catalogApps.find((app) => app.package_name === packageName);
    if (existingApp) {
      setSelectedCatalogApp(existingApp.id);
      setShowIframe(false);
      return;
    }
    if (!environmentId) return;

    let displayName = packageName;
    let iconUrl: string | undefined;
    try {
      const details = await apiClient.get<{ app: AppSearchResult & { description?: string } }>(
        `/api/apps/${packageName}?environment_id=${environmentId}`
      );
      displayName = details.app.title || packageName;
      iconUrl = details.app.icon_url || undefined;
    } catch {
      // Fall back to package name-only import if AMAPI details fetch fails.
    }

    importMutation.mutate(
      {
        environment_id: environmentId,
        package_name: packageName,
        display_name: displayName,
        icon_url: iconUrl,
      },
      {
        onSuccess: (data) => {
          setSelectedCatalogApp(data.app.id);
          setSelectedPackage(null);
          setShowIframe(false);
        },
      }
    );
  };

  const openEditDeployment = (dep: AppDeployment) => {
    setInstallType(dep.install_type);
    setAutoUpdateMode(dep.auto_update_mode ?? 'AUTO_UPDATE_DEFAULT');
    setManagedConfig(dep.managed_config ?? {});
    setEditingDeployment(dep);
    setDeployModalOpen(true);
  };

  const handleUpdateDeployment = () => {
    if (!environmentId || !editingDeployment) return;
    updateMutation.mutate(
      {
        id: editingDeployment.id,
        environment_id: environmentId,
        install_type: installType,
        auto_update_mode: autoUpdateMode,
        managed_config: managedConfig,
      },
      {
        onSuccess: () => {
          setDeployModalOpen(false);
          setEditingDeployment(null);
        },
      },
    );
  };

  const handleDeleteDeployment = (dep: AppDeployment) => {
    if (!environmentId) return;
    deleteMutation.mutate(
      { id: dep.id, environment_id: environmentId },
      {
        onSuccess: () => setDeleteConfirmId(null),
        onError: () => setDeleteConfirmId(null),
      },
    );
  };

  const handleImportApp = (app: AppSearchResult) => {
    if (!environmentId) return;
    importMutation.mutate(
      {
        environment_id: environmentId,
        package_name: app.package_name,
        display_name: app.title,
        icon_url: app.icon_url,
      },
      {
        onSuccess: () => {
          setSelectedPackage(null);
        },
      }
    );
  };

  const handleOpenScopeConfig = (app: CatalogApp, config?: AppScopeConfig) => {
    setCatalogScopeModal(app);
    setEditingScopeConfig(config ?? null);
    setScopeConfigScope(config
      ? {
        scope_type: config.scope_type as 'environment' | 'group' | 'device',
        scope_id: config.scope_id,
      }
      : { scope_type: 'environment', scope_id: environmentId ?? '' });
    setScopeConfigInstallType(config?.install_type ?? app.default_install_type);
    setScopeConfigAutoUpdate(config?.auto_update_mode ?? app.default_auto_update_mode);
    setScopeConfigManagedConfig((config?.managed_config ?? {}) as Record<string, unknown>);
    setScopeConfigAppPolicy((config?.app_policy ?? {}) as Record<string, unknown>);
    setScopeConfigTab('general');
    setScopeConfigManagedConfigTab('form');
  };

  const handleSaveScopeConfig = () => {
    if (!environmentId || !catalogScopeModal) return;

    const onSuccess = () => {
      setCatalogScopeModal(null);
      setEditingScopeConfig(null);
      setSelectedCatalogApp(catalogScopeModal.id);
    };

    if (editingScopeConfig) {
      updateScopeConfigMutation.mutate(
        {
          app_id: catalogScopeModal.id,
          config_id: editingScopeConfig.id,
          environment_id: environmentId,
          install_type: scopeConfigInstallType,
          auto_update_mode: scopeConfigAutoUpdate,
          managed_config: scopeConfigManagedConfig,
          app_policy: scopeConfigAppPolicy,
        },
        { onSuccess }
      );
      return;
    }

    addScopeConfigMutation.mutate(
      {
        app_id: catalogScopeModal.id,
        environment_id: environmentId,
        scope_type: scopeConfigScope.scope_type,
        scope_id: scopeConfigScope.scope_id || environmentId,
        install_type: scopeConfigInstallType,
        auto_update_mode: scopeConfigAutoUpdate,
        managed_config: scopeConfigManagedConfig,
        app_policy: scopeConfigAppPolicy,
      },
      { onSuccess }
    );
  };

  const handleDeleteCatalogApp = (appId: string) => {
    if (!environmentId) return;
    deleteAppMutation.mutate(
      { app_id: appId, environment_id: environmentId },
      { onSuccess: () => { setDeleteCatalogAppId(null); setSelectedCatalogApp(null); } }
    );
  };

  const handleDeleteScopeConfig = (appId: string, configId: string) => {
    if (!environmentId) return;
    deleteScopeConfigMutation.mutate({ app_id: appId, config_id: configId, environment_id: environmentId });
  };

  // No environment selected
  if (!environmentId) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Applications</h1>
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Package className="mx-auto h-12 w-12 text-gray-300 mb-4" />
          <p className="text-gray-500">Select an environment to manage applications.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Applications</h1>
          <p className="mt-1 text-sm text-gray-500">
            Search, deploy, and manage applications across your fleet.
          </p>
        </div>
        <button
          onClick={handleGenerateWebToken}
          disabled={webTokenMutation.isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent/90 disabled:opacity-50 transition-colors"
        >
          {webTokenMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          Open Managed Play
        </button>
      </div>

      {/* Search bar */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => handleSearchInput(e.target.value)}
          placeholder="Search managed Google Play apps..."
          className="block w-full rounded-lg border border-gray-300 bg-white pl-10 pr-4 py-2.5 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
        {searchQuery && (
          <button
            onClick={() => {
              setSearchQuery('');
              setDebouncedQuery('');
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="mb-4 text-sm font-medium text-gray-700">
        App Catalogue ({catalogApps.length})
      </div>

      {/* App Catalogue View */}
      <div className="space-y-6">
          {/* Catalog grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {catalogApps.map((app) => (
              <div
                key={app.id}
                className={clsx(
                  'bg-white rounded-xl border p-3 cursor-pointer transition-all hover:shadow-md',
                  selectedCatalogApp === app.id ? 'border-accent ring-2 ring-accent/20' : 'border-gray-200'
                )}
                onClick={() => setSelectedCatalogApp(selectedCatalogApp === app.id ? null : app.id)}
              >
                <div className="flex items-start gap-3">
                  {app.icon_url ? (
                    <img src={app.icon_url} alt="" className="h-10 w-10 rounded-lg flex-shrink-0" />
                  ) : (
                    <div className="h-10 w-10 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                      <Package className="h-5 w-5 text-gray-400" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-medium text-gray-900 truncate">{app.display_name}</h3>
                    <p className="text-xs text-gray-500 truncate">{app.package_name}</p>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700">
                    {formatInstallTypeLabel(app.default_install_type)}
                  </span>
                  {app.scope_configs_count > 0 && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-green-50 text-green-700">
                      {app.scope_configs_count} config{app.scope_configs_count !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {catalogApps.length === 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
              <Package className="mx-auto h-12 w-12 text-gray-300 mb-4" />
              <p className="text-gray-500 mb-2">No apps imported yet.</p>
              <p className="text-sm text-gray-400">Search for apps above and click &quot;Import App&quot; to add them to your catalogue.</p>
            </div>
          )}

          {/* Selected app detail panel */}
          {selectedCatalogApp && selectedAppData && (
            <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  {(selectedAppData.app.icon_url || selectedCatalogAppDetail?.icon_url) ? (
                    <img src={selectedAppData.app.icon_url || selectedCatalogAppDetail?.icon_url || ''} alt="" className="h-12 w-12 rounded-lg" />
                  ) : (
                    <div className="h-12 w-12 rounded-lg bg-gray-100 flex items-center justify-center">
                      <Package className="h-6 w-6 text-gray-400" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <h3 className="text-lg font-semibold text-gray-900 break-words">{selectedAppData.app.display_name}</h3>
                    <p className="text-sm text-gray-500 break-all">{selectedAppData.app.package_name}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  <a
                    href={`https://play.google.com/store/apps/details?id=${encodeURIComponent(selectedAppData.app.package_name)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex shrink-0 items-center justify-center rounded-lg border border-gray-200 p-2 text-gray-500 hover:text-accent hover:border-accent/30 transition-colors"
                    title="Open in Google Play"
                  >
                    <Play className="h-4 w-4" />
                  </a>
                  <button
                    onClick={() => handleOpenScopeConfig(selectedAppData.app)}
                    className="inline-flex min-w-0 items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-accent rounded-lg hover:bg-accent/90 transition-colors"
                  >
                    <Settings2 className="h-3.5 w-3.5" />
                    Add Config
                  </button>
                  {deleteCatalogAppId === selectedCatalogApp ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleDeleteCatalogApp(selectedCatalogApp)}
                        disabled={deleteAppMutation.isPending}
                        className="px-2 py-1 text-xs font-medium text-white bg-red-500 rounded hover:bg-red-600"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setDeleteCatalogAppId(null)}
                        className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeleteCatalogAppId(selectedCatalogApp)}
                      className="p-1.5 text-gray-400 hover:text-red-500 rounded transition-colors"
                      title="Delete app"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>

              <div className="text-xs text-gray-500">
                Default: {formatInstallTypeLabel(selectedAppData.app.default_install_type)} · {formatAutoUpdateLabel(selectedAppData.app.default_auto_update_mode)}
              </div>

              {selectedCatalogAppDetail && (
                <div className="flex flex-wrap gap-2">
                    <span className="inline-flex items-center rounded-md bg-white px-2 py-1 text-[11px] text-gray-700 border border-gray-200">
                      Permissions: {selectedCatalogAppDetail.permissions.length}
                    </span>
                    <span className="inline-flex items-center rounded-md bg-white px-2 py-1 text-[11px] text-gray-700 border border-gray-200">
                      Managed Props: {selectedCatalogAppDetail.managed_properties.length}
                    </span>
                    <span className="inline-flex items-center rounded-md bg-white px-2 py-1 text-[11px] text-gray-700 border border-gray-200">
                      Tracks: {selectedCatalogAppDetail.app_tracks.length}
                    </span>
                    {selectedCatalogAppDetail.min_android_sdk && (
                      <span className="inline-flex items-center rounded-md bg-white px-2 py-1 text-[11px] text-gray-700 border border-gray-200">
                        Min SDK: {selectedCatalogAppDetail.min_android_sdk}
                      </span>
                    )}
                    {selectedCatalogAppDetail.update_time && (
                      <span className="inline-flex items-center rounded-md bg-white px-2 py-1 text-[11px] text-gray-700 border border-gray-200">
                        Updated: {new Date(selectedCatalogAppDetail.update_time).toLocaleDateString()}
                      </span>
                    )}
                </div>
              )}

              {isLoadingSelectedCatalogAppDetail && (
                <div className="text-xs text-gray-500 flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading application metadata…
                </div>
              )}

              {/* Scope configs table */}
              <div>
                <h4 className="text-sm font-semibold text-gray-900 mb-2">
                  Scope Configurations ({selectedAppData.scope_configs.length})
                </h4>
                {selectedAppData.scope_configs.length > 0 ? (
                  <div className="border border-gray-200 rounded-lg divide-y divide-gray-200">
                    {selectedAppData.scope_configs.map((sc: AppScopeConfig) => (
                      <div key={sc.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <span className="text-sm font-medium text-gray-900">
                            {sc.scope_name ?? sc.scope_id}
                          </span>
                          <div className="mt-0.5 flex flex-wrap items-center gap-2">
                            <span className="text-xs text-gray-500">{formatScopeTypeLabel(sc.scope_type)}</span>
                            {sc.install_type && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700">
                                {formatInstallTypeLabel(sc.install_type)}
                              </span>
                            )}
                            {sc.auto_update_mode && (
                              <span className="text-[10px] text-gray-400">{formatAutoUpdateLabel(sc.auto_update_mode)}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 self-end sm:self-auto">
                          <button
                            onClick={() => handleOpenScopeConfig(selectedAppData.app, sc)}
                            className="p-1 text-gray-400 hover:text-blue-500 rounded transition-colors"
                            title="Edit scope config"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteScopeConfig(sc.app_id, sc.id)}
                            disabled={deleteScopeConfigMutation.isPending}
                            className="p-1 text-gray-400 hover:text-red-500 rounded transition-colors"
                            title="Remove scope config"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">No scope-specific configs. The app&apos;s defaults will be used everywhere.</p>
                )}
              </div>
            </div>
          )}
        </div>

      {showIframe && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-6xl rounded-xl bg-white shadow-xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Managed Google Play</h2>
                <p className="text-xs text-gray-500">Select an app to import it into the catalogue.</p>
              </div>
              <button
                onClick={() => setShowIframe(false)}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-5 overflow-auto">
              {webTokenMutation.isPending && !webTokenMutation.data ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-6 w-6 animate-spin text-accent" />
                </div>
              ) : webTokenMutation.error ? (
                <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                  {webTokenMutation.error.message ?? 'Failed to open managed Google Play.'}
                </div>
              ) : webTokenMutation.data ? (
                <PlayStoreIframe
                  token={webTokenMutation.data.token}
                  url={webTokenMutation.data.iframeUrl}
                  onAppSelected={handleIframeAppSelected}
                />
              ) : null}
              {importMutation.error && (
                <div className="mt-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                  {importMutation.error.message ?? 'Failed to import selected app.'}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Deployments View (legacy) */}
      {showLegacyDeployments && (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Search results / deployed apps */}
        <div className="lg:col-span-2 space-y-6">
          {/* Search results grid */}
          {debouncedQuery.length >= 2 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-900 mb-3">
                Search Results {isSearching && <Loader2 className="inline h-4 w-4 animate-spin ml-1" />}
              </h2>
              {searchResults.length === 0 && !isSearching ? (
                <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
                  <p className="text-sm text-gray-500">No apps found for "{debouncedQuery}"</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {searchResults.map((app) => (
                    <button
                      key={app.package_name}
                      onClick={() => handleSelectApp(app)}
                      className={clsx(
                        'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                        selectedPackage === app.package_name
                          ? 'border-accent bg-accent/5'
                          : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
                      )}
                    >
                      {app.icon_url ? (
                        <img src={app.icon_url} alt="" className="h-10 w-10 rounded-lg" />
                      ) : (
                        <div className="h-10 w-10 rounded-lg bg-gray-100 flex items-center justify-center">
                          <Package className="h-5 w-5 text-gray-400" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {app.title || app.package_name}
                        </p>
                        <p className="text-xs text-gray-500 truncate">{app.package_name}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Managed Play iframe */}
          {showIframe && webTokenMutation.data && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-900">Managed Google Play</h2>
                <button
                  onClick={() => setShowIframe(false)}
                  className="text-xs text-gray-400 hover:text-gray-600"
                >
                  Close
                </button>
              </div>
              <PlayStoreIframe
                token={webTokenMutation.data.token}
                url={webTokenMutation.data.iframeUrl}
                onAppSelected={handleIframeAppSelected}
              />
            </div>
          )}

          {/* Deployed apps list */}
          {deployments.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-900 mb-3">
                Deployed Apps ({deployments.length})
              </h2>
              <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
                {deployments.map((dep) => (
                  <div key={dep.id} className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-lg bg-gray-100 flex items-center justify-center">
                        <Package className="h-4 w-4 text-gray-400" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{dep.display_name || dep.package_name}</p>
                        <p className="text-xs text-gray-500">{dep.package_name}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          Target: {formatScopeTypeLabel(dep.scope_type)}
                          {dep.scope_name ? ` (${dep.scope_name})` : ''}
                          {' · '}
                          Updated {new Date(dep.updated_at ?? dep.created_at).toLocaleString()}
                        </p>
                        <p className="text-xs text-gray-400">
                          Auto update: {formatAutoUpdateLabel(dep.auto_update_mode)}
                          {' · '}
                          Managed config: {Object.keys(dep.managed_config ?? {}).length > 0 ? 'Yes' : 'No'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                        {formatInstallTypeLabel(dep.install_type)}
                      </span>
                      <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                        {formatScopeTypeLabel(dep.scope_type)}
                      </span>
                      <button
                        onClick={() => openEditDeployment(dep)}
                        className="p-1 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                        title="Edit"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      {deleteConfirmId === dep.id ? (
                        <span className="inline-flex items-center gap-1 text-xs">
                          <button
                            onClick={() => handleDeleteDeployment(dep)}
                            className="rounded bg-red-600 px-2 py-0.5 text-white hover:bg-red-700"
                            disabled={deleteMutation.isPending}
                          >
                            {deleteMutation.isPending ? 'Deleting...' : 'Confirm'}
                          </button>
                          <button
                            onClick={() => setDeleteConfirmId(null)}
                            className="rounded bg-gray-200 px-2 py-0.5 text-gray-700 hover:bg-gray-300"
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirmId(dep.id)}
                          className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: App detail panel */}
        <div>
          {selectedPackage ? (
            <div className="bg-white rounded-xl border border-gray-200 p-5 sticky top-6">
              {isLoadingDetail ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-accent" />
                </div>
              ) : appDetail ? (
                <>
                  {/* App header */}
                  <div className="flex items-start gap-3 mb-4">
                    {appDetail.icon_url ? (
                      <img src={appDetail.icon_url} alt="" className="h-12 w-12 rounded-xl" />
                    ) : (
                      <div className="h-12 w-12 rounded-xl bg-gray-100 flex items-center justify-center">
                        <Package className="h-6 w-6 text-gray-400" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-gray-900">{appDetail.title}</h3>
                      <p className="text-xs text-gray-500 font-mono">{appDetail.package_name}</p>
                    </div>
                    <button
                      onClick={() => setSelectedPackage(null)}
                      className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Description */}
                  {appDetail.description && (
                    <p className="text-xs text-gray-600 mb-4 line-clamp-4">{appDetail.description}</p>
                  )}

                  {/* Metadata */}
                  <dl className="space-y-2 text-xs mb-4 border-t border-gray-100 pt-4">
                    {appDetail.min_android_sdk && (
                      <div className="flex justify-between">
                        <dt className="text-gray-500">Min Android SDK</dt>
                        <dd className="font-medium text-gray-700">{appDetail.min_android_sdk}</dd>
                      </div>
                    )}
                    {appDetail.app_tracks.length > 0 && (
                      <div className="flex justify-between">
                        <dt className="text-gray-500">Tracks</dt>
                        <dd className="font-medium text-gray-700">
                          {appDetail.app_tracks.map((t) => t.trackAlias).join(', ')}
                        </dd>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <dt className="text-gray-500">Managed Config</dt>
                      <dd className="font-medium text-gray-700">
                        {appDetail.managed_properties.length > 0
                          ? `${appDetail.managed_properties.length} properties`
                          : 'None'}
                      </dd>
                    </div>
                  </dl>

                  {/* Managed config schema preview */}
                  {appDetail.managed_properties.length > 0 && (
                    <div className="mb-4 border-t border-gray-100 pt-4">
                      <h4 className="text-xs font-semibold text-gray-600 mb-2 flex items-center gap-1">
                        <Settings2 className="h-3.5 w-3.5" />
                        Managed Config Schema
                      </h4>
                      <div className="space-y-1">
                        {appDetail.managed_properties.slice(0, 8).map((prop) => (
                          <div key={prop.key} className="flex items-center justify-between text-xs">
                            <span className="text-gray-600 truncate">{prop.title}</span>
                            <span className="text-gray-400 font-mono ml-2">{prop.type}</span>
                          </div>
                        ))}
                        {appDetail.managed_properties.length > 8 && (
                          <p className="text-xs text-gray-400">
                            +{appDetail.managed_properties.length - 8} more...
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="space-y-2">
                    <button
                      onClick={() => handleImportApp({ package_name: appDetail.package_name, title: appDetail.title, icon_url: appDetail.icon_url })}
                      disabled={importMutation.isPending}
                      className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent/90 disabled:opacity-50 transition-colors"
                    >
                      {importMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                      {importMutation.isPending ? 'Importing...' : 'Import App'}
                    </button>
                    <button
                      onClick={() => handleOpenDeploy(appDetail.package_name, appDetail.title)}
                      className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-colors"
                    >
                      <Settings2 className="h-4 w-4" />
                      Import &amp; Configure
                    </button>
                  </div>

                  {/* Google Play link */}
                  <a
                    href={`https://play.google.com/store/apps/details?id=${appDetail.package_name}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 w-full inline-flex items-center justify-center gap-1 text-xs text-gray-500 hover:text-accent transition-colors"
                  >
                    <ExternalLink className="h-3 w-3" />
                    View on Google Play
                  </a>
                </>
              ) : (
                <div className="py-8 text-center">
                  <p className="text-sm text-gray-500">Failed to load app details.</p>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
              <Package className="mx-auto h-10 w-10 text-gray-300 mb-3" />
              <p className="text-sm text-gray-500">
                Search for an app or use managed Play to view app details.
              </p>
            </div>
          )}
        </div>
      </div>
      )}

      {/* Deploy / Edit modal */}
      {deployModalOpen && (deployPackage || editingDeployment) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-4xl rounded-xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">
                {editingDeployment ? 'Edit App Deployment' : 'Deploy Application'}
              </h2>
              <button
                onClick={() => { setDeployModalOpen(false); setEditingDeployment(null); }}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* App info */}
              <div className="flex items-center gap-3 rounded-lg bg-gray-50 p-3">
                <Package className="h-8 w-8 text-gray-400" />
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {editingDeployment?.display_name ?? deployPackage?.title}
                  </p>
                  <p className="text-xs text-gray-500 font-mono">
                    {editingDeployment?.package_name ?? deployPackage?.package_name}
                  </p>
                </div>
              </div>

              {/* Install type */}
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">Install Type</label>
                <select
                  value={installType}
                  onChange={(e) => setInstallType(e.target.value)}
                  className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                >
                  {INSTALL_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label} -- {t.description}
                    </option>
                  ))}
                </select>
              </div>

              {/* Auto-update mode */}
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">Auto-Update Mode</label>
                <select
                  value={autoUpdateMode}
                  onChange={(e) => setAutoUpdateMode(e.target.value)}
                  className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                >
                  {AUTO_UPDATE_MODES.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Scope selector */}
              {editingDeployment ? (
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-1">Scope</label>
                  <p className="text-sm text-gray-600">
                    {formatScopeTypeLabel(editingDeployment.scope_type)}
                    {editingDeployment.scope_name ? ` — ${editingDeployment.scope_name}` : ''}
                  </p>
                </div>
              ) : (
                <AppScopeSelector value={scope} onChange={setScope} />
              )}

              {/* Managed configuration */}
              {appDetail && appDetail.managed_properties.length > 0 && (
                <ManagedConfigEditor
                  schema={appDetail.managed_properties}
                  value={managedConfig}
                  onChange={setManagedConfig}
                />
              )}
            </div>

            {/* Error */}
            {(deployMutation.error || updateMutation.error) && (
              <div className="mt-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                {(deployMutation.error ?? updateMutation.error)?.message ?? 'Failed to save app deployment.'}
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => { setDeployModalOpen(false); setEditingDeployment(null); }}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              {editingDeployment ? (
                <button
                  onClick={handleUpdateDeployment}
                  disabled={updateMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50 transition-colors"
                >
                  {updateMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Pencil className="h-4 w-4" />
                  )}
                  {updateMutation.isPending ? 'Updating...' : 'Update'}
                </button>
              ) : (
                <button
                  onClick={handleDeploy}
                  disabled={deployMutation.isPending || !scope.scope_id}
                  className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50 transition-colors"
                >
                  {deployMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  {deployMutation.isPending ? 'Deploying...' : 'Deploy'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Add Scope Config modal */}
      {catalogScopeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-[min(1100px,calc(100vw-2rem))] rounded-xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">
                {editingScopeConfig ? 'Edit Scope Configuration' : 'Add Scope Configuration'}
              </h2>
              <button
                onClick={() => { setCatalogScopeModal(null); setEditingScopeConfig(null); }}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* App info */}
              <div className="flex items-center gap-3 rounded-lg bg-gray-50 p-3">
                {catalogScopeModal.icon_url ? (
                  <img src={catalogScopeModal.icon_url} alt="" className="h-8 w-8 rounded-lg" />
                ) : (
                  <Package className="h-8 w-8 text-gray-400" />
                )}
                <div>
                  <p className="text-sm font-medium text-gray-900">{catalogScopeModal.display_name}</p>
                  <p className="text-xs text-gray-500 font-mono">{catalogScopeModal.package_name}</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 rounded-lg border border-gray-200 bg-gray-50 p-1">
                {[
                  { key: 'general', label: 'General' },
                  { key: 'managed', label: 'Managed Config' },
                  { key: 'amapi', label: 'AMAPI App Policy' },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setScopeConfigTab(tab.key as 'general' | 'managed' | 'amapi')}
                    className={clsx(
                      'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                      scopeConfigTab === tab.key
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-600 hover:text-gray-900'
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {scopeConfigTab === 'general' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-900 mb-1">Install Type</label>
                    <select
                      value={scopeConfigInstallType}
                      onChange={(e) => setScopeConfigInstallType(e.target.value)}
                      className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                    >
                      {INSTALL_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-900 mb-1">Auto-Update Mode</label>
                    <select
                      value={scopeConfigAutoUpdate}
                      onChange={(e) => setScopeConfigAutoUpdate(e.target.value)}
                      className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                    >
                      {AUTO_UPDATE_MODES.map((m) => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                  </div>

                  {editingScopeConfig ? (
                    <div>
                      <label className="block text-sm font-medium text-gray-900 mb-1">Scope</label>
                      <p className="text-sm text-gray-600">
                        {formatScopeTypeLabel(editingScopeConfig.scope_type)}
                        {editingScopeConfig.scope_name ? ` — ${editingScopeConfig.scope_name}` : ''}
                      </p>
                    </div>
                  ) : (
                    <AppScopeSelector
                      value={scopeConfigScope}
                      onChange={setScopeConfigScope}
                    />
                  )}
                </div>
              )}

              {scopeConfigTab === 'managed' && (
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2 rounded-lg border border-gray-200 bg-gray-50 p-1">
                    {(['form', 'json'] as const).map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setScopeConfigManagedConfigTab(tab)}
                        className={clsx(
                          'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                          scopeConfigManagedConfigTab === tab
                            ? 'bg-white text-gray-900 shadow-sm'
                            : 'text-gray-600 hover:text-gray-900'
                        )}
                      >
                        {tab === 'form' ? 'Form' : 'JSON'}
                      </button>
                    ))}
                  </div>

                  {scopeConfigManagedConfigTab === 'form' ? (
                    catalogScopeConfigAppDetail && catalogScopeConfigAppDetail.managed_properties.length > 0 ? (
                      <ManagedConfigEditor
                        schema={catalogScopeConfigAppDetail.managed_properties}
                        value={scopeConfigManagedConfig}
                        onChange={setScopeConfigManagedConfig}
                      />
                    ) : (
                      <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-6 text-sm text-gray-600">
                        No managed properties available for this app. Use the JSON tab to set raw managed configuration.
                      </div>
                    )
                  ) : (
                    <JsonField
                      label="Managed Configuration (JSON)"
                      description="App managed configuration object. When the app exposes managed properties, the Form tab writes the same JSON."
                      value={scopeConfigManagedConfig}
                      onChange={(v) => setScopeConfigManagedConfig((v ?? {}) as Record<string, unknown>)}
                      kind="object"
                      rows={12}
                    />
                  )}
                </div>
              )}

              {scopeConfigTab === 'amapi' && (
                <AmapiApplicationPolicyEditor
                  value={scopeConfigAppPolicy}
                  onChange={setScopeConfigAppPolicy}
                  packageName={catalogScopeModal.package_name}
                  installType={scopeConfigInstallType}
                  autoUpdateMode={scopeConfigAutoUpdate}
                />
              )}

              {(addScopeConfigMutation.error || updateScopeConfigMutation.error) && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                  {(addScopeConfigMutation.error ?? updateScopeConfigMutation.error)?.message ?? 'Failed to save scope configuration.'}
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
                <button
                  onClick={() => { setCatalogScopeModal(null); setEditingScopeConfig(null); }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveScopeConfig}
                  disabled={
                    addScopeConfigMutation.isPending ||
                    updateScopeConfigMutation.isPending ||
                    (!editingScopeConfig && !scopeConfigScope.scope_id)
                  }
                  className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50 transition-colors"
                >
                  {addScopeConfigMutation.isPending || updateScopeConfigMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : editingScopeConfig ? (
                    <Pencil className="h-4 w-4" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  {addScopeConfigMutation.isPending || updateScopeConfigMutation.isPending
                    ? 'Saving...'
                    : editingScopeConfig
                      ? 'Save Changes'
                      : 'Add Config'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
