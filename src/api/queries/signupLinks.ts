import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../client';

// --- Interfaces ---

export interface SignupLink {
  id: string;
  scope_type: 'workspace' | 'environment';
  scope_id: string;
  purpose?: 'standard' | 'customer';
  slug: string | null;
  enabled: boolean;
  default_role: string;
  default_access_scope: string;
  auto_assign_environment_ids: string[];
  auto_assign_group_ids: string[];
  allow_environment_creation: boolean;
  allowed_domains: string[];
  display_name: string | null;
  display_description: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface SignupLinkResponse {
  signup_link: SignupLink | null;
}

interface CreateSignupLinkResponse {
  signup_link: SignupLink;
  token: string;
}

interface UpdateSignupLinkResponse {
  signup_link: SignupLink;
}

interface DeleteSignupLinkResponse {
  message: string;
}

export interface ResolvedSignupLink {
  scope_type: 'workspace' | 'environment';
  display_name: string | null;
  display_description: string | null;
  workspace_name: string | null;
  environment_name: string | null;
  default_role: string;
  allow_environment_creation: boolean;
  allowed_domains: string[];
}

interface CreateSignupLinkParams {
  scope_type: string;
  scope_id: string;
  purpose?: 'standard' | 'customer';
  slug?: string;
  default_role?: string;
  default_access_scope?: string;
  auto_assign_environment_ids?: string[];
  auto_assign_group_ids?: string[];
  allow_environment_creation?: boolean;
  allowed_domains?: string[];
  display_name?: string;
  display_description?: string;
}

interface UpdateSignupLinkParams {
  id: string;
  slug?: string | null;
  enabled?: boolean;
  default_role?: string;
  default_access_scope?: string;
  auto_assign_environment_ids?: string[];
  auto_assign_group_ids?: string[];
  allow_environment_creation?: boolean;
  allowed_domains?: string[];
  display_name?: string | null;
  display_description?: string | null;
}

// --- Query Keys ---

export const signupLinkKeys = {
  all: ['signup-links'] as const,
  byScope: (scopeType: string, scopeId: string, purpose: 'standard' | 'customer' = 'standard') =>
    [...signupLinkKeys.all, scopeType, scopeId, purpose] as const,
  resolve: (slugOrToken: string) =>
    [...signupLinkKeys.all, 'resolve', slugOrToken] as const,
};

// --- Hooks ---

export function useSignupLink(
  scopeType: string,
  scopeId: string,
  purpose: 'standard' | 'customer' = 'standard'
) {
  return useQuery({
    queryKey: signupLinkKeys.byScope(scopeType, scopeId, purpose),
    queryFn: () =>
      apiClient.get<SignupLinkResponse>(
        `/api/signup-links?scope_type=${encodeURIComponent(scopeType)}&scope_id=${encodeURIComponent(scopeId)}&purpose=${encodeURIComponent(purpose)}`
      ),
    select: (data) => data.signup_link,
    enabled: !!scopeType && !!scopeId,
  });
}

export function useCreateSignupLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateSignupLinkParams) =>
      apiClient.post<CreateSignupLinkResponse>('/api/signup-links', params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: signupLinkKeys.all });
    },
  });
}

export function useUpdateSignupLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...params }: UpdateSignupLinkParams) =>
      apiClient.patch<UpdateSignupLinkResponse>(`/api/signup-links/${id}`, params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: signupLinkKeys.all });
    },
  });
}

export function useDeleteSignupLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.delete<DeleteSignupLinkResponse>(`/api/signup-links/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: signupLinkKeys.all });
    },
  });
}

export function useResolveSignupLink(slugOrToken: string) {
  return useQuery({
    queryKey: signupLinkKeys.resolve(slugOrToken),
    queryFn: () =>
      apiClient.get<ResolvedSignupLink>(
        `/api/signup-links/resolve/${encodeURIComponent(slugOrToken)}`
      ),
    enabled: !!slugOrToken,
    retry: false,
  });
}
