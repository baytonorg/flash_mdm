import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../client';

// --- Interfaces ---

export interface DeviceOperation {
  name?: string;
  done?: boolean;
  metadata?: Record<string, unknown>;
  error?: { code: number; message: string };
  response?: Record<string, unknown>;
  source?: 'amapi' | 'ledger' | 'ledger_and_amapi';
  ledgerStatus?: 'submitted' | 'delivery_uncertain' | 'reconciling' | 'succeeded' | 'failed' | 'cancelled' | 'unresolved';
  ledgerId?: string;
  reconciliation?: { pagesScanned: number; lastCheckedAt?: string };
  [key: string]: unknown;
}

export interface OperationsResponse {
  operations: DeviceOperation[];
  nextPageToken?: string;
  unavailable?: boolean;
  message?: string;
}

export function getDeviceOperationsRefetchInterval(data?: OperationsResponse): number | false {
  return data?.operations.some((operation) =>
    operation.ledgerStatus === 'delivery_uncertain'
    || operation.ledgerStatus === 'reconciling'
    || (!operation.done && !operation.error)
  ) ? 3000 : false;
}

// --- Query Keys ---

export const deviceOperationKeys = {
  all: ['device-operations'] as const,
  list: (deviceId: string) => [...deviceOperationKeys.all, 'list', deviceId] as const,
};

// --- Hooks ---

export function useDeviceOperations(deviceId: string) {
  const query = useInfiniteQuery({
    queryKey: deviceOperationKeys.list(deviceId),
    queryFn: ({ pageParam }) =>
      apiClient.get<OperationsResponse>(
        `/api/devices/operations?action=list&device_id=${encodeURIComponent(deviceId)}`
          + (pageParam ? `&page_token=${encodeURIComponent(pageParam)}` : '')
      ),
    initialPageParam: '',
    getNextPageParam: (lastPage) => lastPage.nextPageToken || undefined,
    enabled: !!deviceId,
    refetchInterval: (query) => getDeviceOperationsRefetchInterval(
      (query.state.data as { pages?: OperationsResponse[] } | undefined)?.pages?.[0],
    ),
  });
  const pages = query.data?.pages ?? [];
  const deduped = new Map<string, DeviceOperation>();
  for (const page of pages) {
    for (const operation of page.operations) {
      deduped.set(operation.name ?? `unnamed-${deduped.size}`, operation);
    }
  }
  return {
    ...query,
    data: query.data ? {
      operations: [...deduped.values()],
      nextPageToken: pages.at(-1)?.nextPageToken,
      unavailable: pages.some((page) => page.unavailable),
      message: pages.find((page) => page.message)?.message,
    } satisfies OperationsResponse : undefined,
  };
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
