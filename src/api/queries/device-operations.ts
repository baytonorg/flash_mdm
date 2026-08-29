import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../client';

// --- Interfaces ---

export interface DeviceOperation {
  name?: string;
  done?: boolean;
  metadata?: Record<string, unknown>;
  error?: { code: number; message: string };
  response?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface OperationsResponse {
  operations: DeviceOperation[];
  nextPageToken?: string;
  unavailable?: boolean;
  message?: string;
}

export function getDeviceOperationsRefetchInterval(data?: OperationsResponse): number | false {
  return data?.operations.some((operation) => !operation.done && !operation.error) ? 3000 : false;
}

// --- Query Keys ---

export const deviceOperationKeys = {
  all: ['device-operations'] as const,
  list: (deviceId: string) => [...deviceOperationKeys.all, 'list', deviceId] as const,
};

// --- Hooks ---

export function useDeviceOperations(deviceId: string) {
  return useQuery({
    queryKey: deviceOperationKeys.list(deviceId),
    queryFn: () =>
      apiClient.get<OperationsResponse>(
        `/api/devices/operations?action=list&device_id=${encodeURIComponent(deviceId)}`
      ),
    enabled: !!deviceId,
    refetchInterval: (query) => getDeviceOperationsRefetchInterval(
      query.state.data as OperationsResponse | undefined,
    ),
  });
}

export function useCancelOperation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (operationName: string) =>
      apiClient.post<{ cancelled: boolean }>('/api/devices/operations', { operation_name: operationName }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: deviceOperationKeys.all });
    },
  });
}
