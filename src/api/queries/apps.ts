import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/client';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AppSearchResult {
  package_name: string;
  title: string;
  icon_url: string;
}

export interface ManagedProperty {
  key: string;
  type: string;
  title: string;
  description?: string;
  defaultValue?: unknown;
  entries?: { name: string; value: string }[];
  nestedProperties?: ManagedProperty[];
}

export interface AppDetail {
  package_name: string;
  title: string;
  description: string;
  icon_url: string;
  permissions: { permissionId: string; name: string; description: string }[];
  managed_properties: ManagedProperty[];
  app_tracks: { trackId: string; trackAlias: string }[];
  min_android_sdk?: number;
  update_time?: string;
}

/** Legacy deployment model (backward compat) */
export interface AppDeployment {
  id: string;
  environment_id: string;
  package_name: string;
  display_name: string;
  install_type: string;
  scope_type: string;
  scope_id: string;
  scope_name?: string | null;
  managed_config: Record<string, unknown>;
  auto_update_mode: string;
  created_at: string;
  updated_at?: string;
}

/** New app catalog entry */
export interface CatalogApp {
  id: string;
  environment_id: string;
  package_name: string;
  display_name: string;
  default_install_type: string;
  default_auto_update_mode: string;
  default_managed_config: Record<string, unknown>;
  icon_url: string | null;
  scope_configs_count: number;
  created_at: string;
  updated_at: string;
}

/** Per-scope app configuration */
export interface AppScopeConfig {
  id: string;
  app_id: string;
  environment_id: string;
  scope_type: string;
  scope_id: string;
  scope_name?: string | null;
  install_type: string | null;
  auto_update_mode: string | null;
  managed_config: Record<string, unknown> | null;
  app_policy: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface WebToken {
  token: string;
  iframeUrl: string;
}

// ─── Query Keys ─────────────────────────────────────────────────────────────

export const appKeys = {
  search: (environmentId: string, query: string) => ['apps', 'search', environmentId, query] as const,
  detail: (environmentId: string, packageName: string) => ['apps', 'detail', environmentId, packageName] as const,
  deployments: (environmentId: string) => ['apps', 'deployments', environmentId] as const,
  catalog: (environmentId: string) => ['apps', 'catalog', environmentId] as const,
  app: (appId: string) => ['apps', 'app', appId] as const,
  webToken: (environmentId: string) => ['apps', 'webToken', environmentId] as const,
};

// ─── Queries ────────────────────────────────────────────────────────────────

export function useAppSearch(environmentId: string | undefined, query: string) {
  return useQuery({
    queryKey: appKeys.search(environmentId ?? '', query),
    queryFn: () =>
      apiClient.get<{ apps: AppSearchResult[] }>(
        `/api/apps/search?environment_id=${environmentId}&query=${encodeURIComponent(query)}`
      ),
    enabled: !!environmentId && query.length >= 2,
    select: (data) => data.apps,
  });
}

export function useAppDetails(environmentId: string | undefined, packageName: string | undefined) {
  return useQuery({
    queryKey: appKeys.detail(environmentId ?? '', packageName ?? ''),
    queryFn: () =>
      apiClient.get<{ app: AppDetail }>(
        `/api/apps/${packageName}?environment_id=${environmentId}`
      ),
    enabled: !!environmentId && !!packageName,
    select: (data) => data.app,
  });
}

/** Fetch the app catalog (new model) */
export function useAppCatalog(environmentId: string | undefined) {
  return useQuery({
    queryKey: appKeys.catalog(environmentId ?? ''),
    queryFn: () =>
      apiClient.get<{ apps: CatalogApp[] }>(
        `/api/apps/catalog?environment_id=${environmentId}`
      ),
    enabled: !!environmentId,
    select: (data) => data.apps,
  });
}

/** Fetch a single app with all scope configs (new model) */
export function useApp(appId: string | undefined) {
  return useQuery({
    queryKey: appKeys.app(appId ?? ''),
    queryFn: () =>
      apiClient.get<{ app: CatalogApp; scope_configs: AppScopeConfig[] }>(
        `/api/apps/${appId}`
      ),
    enabled: !!appId,
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/** Deploy app (creates catalog entry + scope config) */
export function useDeployApp() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: {
      environment_id: string;
      package_name: string;
      display_name: string;
      install_type: string;
      scope_type: string;
      scope_id: string;
      managed_config?: Record<string, unknown>;
      auto_update_mode?: string;
      icon_url?: string;
    }) => apiClient.post<{ app: CatalogApp; scope_config: AppScopeConfig }>('/api/apps/deploy', body),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: appKeys.deployments(variables.environment_id) });
      queryClient.invalidateQueries({ queryKey: appKeys.catalog(variables.environment_id) });
      queryClient.invalidateQueries({ queryKey: ['policies'] });
      queryClient.invalidateQueries({ queryKey: ['devices'] });
    },
  });
}

/** Import an app (catalog entry only, no scope config) */
export function useImportApp() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: {
      environment_id: string;
      package_name: string;
      display_name: string;
      default_install_type?: string;
      default_auto_update_mode?: string;
      default_managed_config?: Record<string, unknown>;
      icon_url?: string;
    }) => apiClient.post<{ app: CatalogApp }>('/api/apps/import', body),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: appKeys.catalog(variables.environment_id) });
    },
  });
}

/** Add scope config to an app */
export function useAddAppScopeConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      app_id: string;
      environment_id: string;
      scope_type: string;
      scope_id: string;
      install_type?: string;
      auto_update_mode?: string;
      managed_config?: Record<string, unknown>;
      app_policy?: Record<string, unknown>;
    }) =>
      apiClient.post<{ scope_config: AppScopeConfig }>(`/api/apps/${body.app_id}/configs`, body),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: appKeys.app(vars.app_id) });
      queryClient.invalidateQueries({ queryKey: appKeys.catalog(vars.environment_id) });
      queryClient.invalidateQueries({ queryKey: appKeys.deployments(vars.environment_id) });
      queryClient.invalidateQueries({ queryKey: ['policies'] });
      queryClient.invalidateQueries({ queryKey: ['devices'] });
    },
  });
}

/** Update a scope config */
export function useUpdateAppScopeConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      app_id: string;
      config_id: string;
      environment_id: string;
      install_type?: string;
      auto_update_mode?: string;
      managed_config?: Record<string, unknown>;
      app_policy?: Record<string, unknown>;
    }) =>
      apiClient.put<{ scope_config: AppScopeConfig }>(`/api/apps/${body.app_id}/configs/${body.config_id}`, body),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: appKeys.app(vars.app_id) });
      queryClient.invalidateQueries({ queryKey: appKeys.catalog(vars.environment_id) });
      queryClient.invalidateQueries({ queryKey: appKeys.deployments(vars.environment_id) });
      queryClient.invalidateQueries({ queryKey: ['policies'] });
      queryClient.invalidateQueries({ queryKey: ['devices'] });
    },
  });
}

/** Delete a scope config */
export function useDeleteAppScopeConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { app_id: string; config_id: string; environment_id: string }) =>
      apiClient.delete<{ message: string }>(`/api/apps/${body.app_id}/configs/${body.config_id}`),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: appKeys.app(vars.app_id) });
      queryClient.invalidateQueries({ queryKey: appKeys.catalog(vars.environment_id) });
      queryClient.invalidateQueries({ queryKey: appKeys.deployments(vars.environment_id) });
      queryClient.invalidateQueries({ queryKey: ['policies'] });
      queryClient.invalidateQueries({ queryKey: ['devices'] });
    },
  });
}

/** Delete an entire app */
export function useDeleteApp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { app_id: string; environment_id: string }) =>
      apiClient.delete<{ message: string }>(`/api/apps/${body.app_id}`),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: appKeys.catalog(vars.environment_id) });
      queryClient.invalidateQueries({ queryKey: appKeys.deployments(vars.environment_id) });
      queryClient.invalidateQueries({ queryKey: ['policies'] });
      queryClient.invalidateQueries({ queryKey: ['devices'] });
    },
  });
}

/** Update app defaults */
export function useUpdateApp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      app_id: string;
      environment_id: string;
      display_name?: string;
      default_install_type?: string;
      default_auto_update_mode?: string;
      default_managed_config?: Record<string, unknown>;
    }) =>
      apiClient.put<{ app: CatalogApp }>(`/api/apps/${body.app_id}`, body),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: appKeys.app(vars.app_id) });
      queryClient.invalidateQueries({ queryKey: appKeys.catalog(vars.environment_id) });
    },
  });
}

/** Legacy: update deployment (backward compat) */
export function useUpdateAppDeployment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      id: string;
      environment_id: string;
      install_type?: string;
      auto_update_mode?: string;
      managed_config?: Record<string, unknown>;
    }) =>
      apiClient.put<{ deployment: AppDeployment; amapi_sync?: unknown; message?: string }>(
        `/api/apps/deployments/${body.id}`,
        body,
      ),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: appKeys.deployments(vars.environment_id) });
      queryClient.invalidateQueries({ queryKey: ['policies'] });
      queryClient.invalidateQueries({ queryKey: ['devices'] });
    },
  });
}

/** Legacy: delete deployment (backward compat) */
export function useDeleteAppDeployment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { id: string; environment_id: string }) =>
      apiClient.delete<{ message: string; amapi_sync?: unknown }>(
        `/api/apps/deployments/${body.id}`,
      ),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: appKeys.deployments(vars.environment_id) });
      queryClient.invalidateQueries({ queryKey: ['policies'] });
      queryClient.invalidateQueries({ queryKey: ['devices'] });
    },
  });
}

export function useAppWebToken() {
  return useMutation({
    mutationFn: (body: { environment_id: string }) =>
      apiClient.post<WebToken>('/api/apps/web-token', body),
  });
}
