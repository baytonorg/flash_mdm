import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../client';

// --- Interfaces ---

export interface Geofence {
  id: string;
  environment_id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  polygon: Array<{ lat: number; lng: number }> | null;
  scope_type: 'environment' | 'group' | 'device';
  scope_id: string | null;
  action_on_enter: Record<string, unknown>;
  action_on_exit: Record<string, unknown>;
  enabled: boolean;
  devices_inside?: number;
  created_at: string;
  updated_at: string;
}

export interface DeviceGeofenceState {
  device_id: string;
  geofence_id: string;
  inside: boolean;
  last_checked_at: string | null;
  device_name: string;
  serial_number: string | null;
}

interface GeofenceListResponse {
  geofences: Geofence[];
}

interface GeofenceDetailResponse {
  geofence: Geofence;
  device_states: DeviceGeofenceState[];
}

interface GeofenceCreateResponse {
  geofence: Geofence;
}

interface GeofenceMutationResponse {
  message: string;
}

export interface CreateGeofenceParams {
  environment_id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  polygon?: Array<{ lat: number; lng: number }> | null;
  scope_type: string;
  scope_id?: string | null;
  action_on_enter?: Record<string, unknown>;
  action_on_exit?: Record<string, unknown>;
  enabled?: boolean;
}

export interface UpdateGeofenceParams {
  id: string;
  name?: string;
  latitude?: number;
  longitude?: number;
  radius_meters?: number;
  polygon?: Array<{ lat: number; lng: number }> | null;
  scope_type?: string;
  scope_id?: string | null;
  action_on_enter?: Record<string, unknown>;
  action_on_exit?: Record<string, unknown>;
  enabled?: boolean;
}

// --- Query Keys ---

export const geofenceKeys = {
  all: ['geofences'] as const,
  list: (environmentId: string) => [...geofenceKeys.all, 'list', environmentId] as const,
  detail: (id: string) => [...geofenceKeys.all, 'detail', id] as const,
};

// --- Hooks ---

export function useGeofences(environmentId: string) {
  return useQuery({
    queryKey: geofenceKeys.list(environmentId),
    queryFn: () =>
      apiClient.get<GeofenceListResponse>(`/api/geofences/list?environment_id=${environmentId}`),
    enabled: !!environmentId,
  });
}

export function useGeofence(id: string) {
  return useQuery({
    queryKey: geofenceKeys.detail(id),
    queryFn: () => apiClient.get<GeofenceDetailResponse>(`/api/geofences/${id}`),
    enabled: !!id,
  });
}

export function useCreateGeofence() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateGeofenceParams) =>
      apiClient.post<GeofenceCreateResponse>('/api/geofences/create', params),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: geofenceKeys.list(variables.environment_id) });
    },
  });
}

export function useUpdateGeofence() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: UpdateGeofenceParams) =>
      apiClient.put<GeofenceMutationResponse>('/api/geofences/update', params),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: geofenceKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: [...geofenceKeys.all, 'list'] });
    },
  });
}

export function useDeleteGeofence() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.delete<GeofenceMutationResponse>(`/api/geofences/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: geofenceKeys.all });
    },
  });
}

export function useToggleGeofence() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.post<GeofenceMutationResponse>(`/api/geofences/${id}/toggle`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: geofenceKeys.all });
    },
  });
}
