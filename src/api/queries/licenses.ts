import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../client';

// --- Interfaces ---

export interface LicensePlan {
  id?: string;
  name: string;
  max_devices: number;
  features: Record<string, unknown>;
}

export interface License {
  id: string;
  workspace_id: string;
  plan_id: string;
  stripe_subscription_id: string | null;
  status: string;
  current_period_end: string | null;
  created_at: string;
  updated_at: string;
}

export interface LicenseStatusResponse {
  licensing_enabled?: boolean;
  license: License | null;
  plan: LicensePlan;
  device_count: number;
  device_limit: number;
  usage_percentage: number;
  stripe_enabled: boolean;
  platform_entitled_seats?: number;
  platform_consumed_seats?: number;
  platform_overage_count?: number;
  workspace_licensing_settings?: {
    platform_licensing_enabled: boolean;
    workspace_licensing_enabled: boolean;
    effective_licensing_enabled: boolean;
    inherit_platform_free_tier: boolean;
    free_enabled: boolean;
    free_seat_limit: number;
    workspace_free_enabled: boolean;
    workspace_free_seat_limit: number;
    platform_default_free_enabled: boolean;
    platform_default_free_seat_limit: number;
    billing_method: 'stripe' | 'invoice' | 'disabled';
    customer_owner_enabled: boolean;
    grace_day_block: number;
    grace_day_disable: number;
    grace_day_wipe: number;
  };
  environments?: Array<{
    environment_id: string;
    environment_name?: string;
    workspace_id: string;
    active_device_count: number;
    entitled_seats: number;
    overage_count: number;
    open_case_id: string | null;
    overage_started_at: string | null;
    overage_age_days: number;
    overage_phase: 'warn' | 'block' | 'disable' | 'wipe' | 'resolved';
    enrollment_blocked: boolean;
  }>;
}

interface CheckoutResponse {
  checkout_url: string;
}

interface AssignResponse {
  message: string;
}

// --- Query Keys ---

export const licenseKeys = {
  all: ['licenses'] as const,
  status: (scope: { workspaceId?: string | null; environmentId?: string | null }) =>
    [...licenseKeys.all, 'status', scope.workspaceId ?? '', scope.environmentId ?? ''] as const,
};

// --- Hooks ---

export function useLicenseStatus(scope: { workspaceId?: string | null; environmentId?: string | null }) {
  const workspaceId = scope.workspaceId ?? null;
  const environmentId = scope.environmentId ?? null;
  const queryString = environmentId
    ? `environment_id=${environmentId}`
    : `workspace_id=${workspaceId}`;
  return useQuery({
    queryKey: licenseKeys.status({ workspaceId, environmentId }),
    queryFn: () =>
      apiClient.get<LicenseStatusResponse>(`/api/licenses/status?${queryString}`),
    enabled: Boolean(environmentId || workspaceId),
  });
}

export function useCreateCheckout() {
  return useMutation({
    mutationFn: (params: { workspace_id: string; plan_id: string; seat_count?: number; duration_months?: number }) =>
      apiClient.post<CheckoutResponse>('/api/stripe/checkout', params),
    onSuccess: (data) => {
      // Redirect to Stripe checkout
      window.location.href = data.checkout_url;
    },
  });
}

export function useAssignLicense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { device_id: string }) =>
      apiClient.post<AssignResponse>('/api/licenses/assign', params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: licenseKeys.all });
    },
  });
}

export function useUnassignLicense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { device_id: string }) =>
      apiClient.post<AssignResponse>('/api/licenses/unassign', params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: licenseKeys.all });
    },
  });
}
