import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../client';

// --- Interfaces ---

export interface Device {
  id: string;
  environment_id: string;
  name: string;
  state: string;
  ownership: string;
  group_id?: string;
  policy_id?: string;
  [key: string]: unknown;
}

export interface DeviceListParams {
  environment_id: string;
  page?: number;
  per_page?: number;
  search?: string;
  state?: string;
  ownership?: string;
  group_id?: string;
  sort_by?: string;
  sort_dir?: 'asc' | 'desc';
}

interface DeviceListResponse {
  devices: Device[];
  total: number;
  page: number;
  per_page: number;
}

interface DeviceDetailResponse {
  device: Device;
  applications: unknown[];
  status_reports: unknown[];
  locations: unknown[];
  audit_log: unknown[];
}

interface DeviceCommandResponse {
  message: string;
}

interface DeviceBulkResponse {
  message: string;
  job_count: number;
}

interface DeviceCommandParams {
  device_id: string;
  command_type: string;
  params?: Record<string, unknown>;
}

interface DeviceBulkParams {
  device_ids: string[];
  action: string;
  params?: Record<string, unknown>;
}

// --- Query Keys ---

export const deviceKeys = {
  all: ['devices'] as const,
  list: (params: DeviceListParams) => [...deviceKeys.all, 'list', params] as const,
  detail: (id: string) => [...deviceKeys.all, 'detail', id] as const,
};

// --- Helpers ---

function buildDeviceListQuery(params: DeviceListParams): string {
  const searchParams = new URLSearchParams();
  searchParams.set('environment_id', params.environment_id);
  if (params.page != null) searchParams.set('page', String(params.page));
  if (params.per_page != null) searchParams.set('per_page', String(params.per_page));
  if (params.search) searchParams.set('search', params.search);
  if (params.state) searchParams.set('state', params.state);
  if (params.ownership) searchParams.set('ownership', params.ownership);
  if (params.group_id) searchParams.set('group_id', params.group_id);
  if (params.sort_by) searchParams.set('sort_by', params.sort_by);
  if (params.sort_dir) searchParams.set('sort_dir', params.sort_dir);
  return searchParams.toString();
}

// --- Hooks ---

export function useDevices(params: DeviceListParams) {
  return useQuery({
    queryKey: deviceKeys.list(params),
    queryFn: () =>
      apiClient.get<DeviceListResponse>(`/api/devices/list?${buildDeviceListQuery(params)}`),
    enabled: !!params.environment_id,
    refetchInterval: 30000,
    refetchIntervalInBackground: true,
  });
}

export function useDevice(id: string) {
  return useQuery({
    queryKey: deviceKeys.detail(id),
    queryFn: () => apiClient.get<DeviceDetailResponse>(`/api/devices/${id}`),
    enabled: !!id,
    refetchInterval: 30000,
    refetchIntervalInBackground: true,
  });
}

export function useDeviceCommand() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: DeviceCommandParams) =>
      apiClient.post<DeviceCommandResponse>('/api/devices/command', params),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: deviceKeys.detail(variables.device_id) });
      queryClient.invalidateQueries({ queryKey: [...deviceKeys.all, 'list'] });
    },
  });
}

export function useDeleteDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (deviceId: string) =>
      apiClient.delete<{ message: string }>(`/api/devices/${deviceId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: deviceKeys.all });
    },
  });
}

export function useDeviceBulkAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: DeviceBulkParams) =>
      apiClient.post<DeviceBulkResponse>('/api/devices/bulk', params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: deviceKeys.all });
    },
  });
}
