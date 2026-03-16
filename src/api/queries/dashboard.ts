import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../client';

// --- Interfaces ---

export interface DashboardStats {
  [key: string]: unknown;
}

interface DashboardResponse {
  stats: DashboardStats;
}

// --- Query Keys ---

export const dashboardKeys = {
  all: ['dashboard'] as const,
  data: (environmentId: string) => [...dashboardKeys.all, 'data', environmentId] as const,
};

// --- Hooks ---

export function useDashboardData(environmentId: string) {
  return useQuery({
    queryKey: dashboardKeys.data(environmentId),
    queryFn: () =>
      apiClient.get<DashboardResponse>(`/api/dashboard/data?environment_id=${environmentId}`),
    select: (data) => data.stats,
    enabled: !!environmentId,
  });
}
