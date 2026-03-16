import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../client';

// --- Interfaces ---

export interface Workspace {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

interface WorkspacesResponse {
  workspaces: Workspace[];
}

interface CreateWorkspaceResponse {
  workspace: Workspace;
}

interface UpdateWorkspaceResponse {
  message: string;
}

interface SetSecretsResponse {
  message: string;
}

interface CreateWorkspaceParams {
  name: string;
  [key: string]: unknown;
}

interface UpdateWorkspaceParams {
  id: string;
  name?: string;
  [key: string]: unknown;
}

interface SetSecretsParams {
  workspace_id: string;
  google_credentials_json: string;
}

// --- Query Keys ---

export const workspaceKeys = {
  all: ['workspaces'] as const,
  list: () => [...workspaceKeys.all, 'list'] as const,
};

// --- Hooks ---

export function useWorkspaces() {
  return useQuery({
    queryKey: workspaceKeys.list(),
    queryFn: () => apiClient.get<WorkspacesResponse>('/api/workspaces/list'),
    select: (data) => data.workspaces,
  });
}

export function useCreateWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateWorkspaceParams) =>
      apiClient.post<CreateWorkspaceResponse>('/api/workspaces/create', params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workspaceKeys.all });
    },
  });
}

export function useUpdateWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: UpdateWorkspaceParams) =>
      apiClient.put<UpdateWorkspaceResponse>('/api/workspaces/update', params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workspaceKeys.all });
    },
  });
}

export function useSetWorkspaceSecrets() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: SetSecretsParams) =>
      apiClient.post<SetSecretsResponse>('/api/workspaces/secrets', params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workspaceKeys.all });
    },
  });
}
