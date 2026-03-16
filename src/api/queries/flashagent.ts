import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../client";

// Note: useFlashiChat hook uses apiClient directly for chat, persistence, and clearing.
// Only settings-related hooks below are used by UI components.

// --- Interfaces ---

export interface FlashiSettingsResponse {
  platform_assistant_enabled: boolean;
  workspace_assistant_enabled: boolean;
  workspace_assistant_max_role: "viewer" | "member" | "admin";
  workspace_assistant_default_role: "viewer" | "member" | "admin";
  environment_assistant_role: "viewer" | "member" | "admin";
  effective_assistant_role: "viewer" | "member" | "admin";
  environment_assistant_enabled: boolean;
  effective_enabled: boolean;
}

export interface FlashiWorkspaceSettingsResponse {
  platform_assistant_enabled: boolean;
  workspace_assistant_enabled: boolean;
  workspace_assistant_max_role: "viewer" | "member" | "admin";
  workspace_assistant_default_role: "viewer" | "member" | "admin";
  workspace_openai_override_configured: boolean;
  workspace_openai_model: string | null;
}

// --- Query keys ---

const flashagentKeys = {
  all: ["flashagent"] as const,
  settings: (environmentId: string) =>
    [...flashagentKeys.all, "settings", environmentId] as const,
  workspaceSettings: (workspaceId: string) =>
    [...flashagentKeys.all, "workspace-settings", workspaceId] as const,
};

// --- Hooks ---

export function useFlashiSettings(environmentId?: string) {
  return useQuery({
    queryKey: environmentId
      ? flashagentKeys.settings(environmentId)
      : [...flashagentKeys.all, "settings", "none"],
    enabled: Boolean(environmentId),
    queryFn: () =>
      apiClient.get<FlashiSettingsResponse>(
        `/api/flashagent/settings?environment_id=${encodeURIComponent(environmentId!)}`,
      ),
    staleTime: 30_000,
  });
}

export function useUpdateFlashiSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      environment_id: string;
      enabled: boolean;
      role?: "viewer" | "member" | "admin";
    }) =>
      apiClient.put<FlashiSettingsResponse & { message: string }>(
        "/api/flashagent/settings",
        params,
      ),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: flashagentKeys.settings(variables.environment_id),
      });
    },
  });
}

export function useFlashiWorkspaceSettings(workspaceId?: string) {
  return useQuery({
    queryKey: workspaceId
      ? flashagentKeys.workspaceSettings(workspaceId)
      : [...flashagentKeys.all, "workspace-settings", "none"],
    enabled: Boolean(workspaceId),
    queryFn: () =>
      apiClient.get<FlashiWorkspaceSettingsResponse>(
        `/api/flashagent/workspace-settings?workspace_id=${encodeURIComponent(workspaceId!)}`,
      ),
    staleTime: 30_000,
  });
}

export function useUpdateFlashiWorkspaceSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      workspace_id: string;
      assistant_enabled?: boolean;
      max_role?: "viewer" | "member" | "admin";
      default_role?: "viewer" | "member" | "admin";
      openai_api_key?: string;
      clear_openai_api_key?: boolean;
      openai_model?: string | null;
    }) =>
      apiClient.put<FlashiWorkspaceSettingsResponse>(
        "/api/flashagent/workspace-settings",
        params,
      ),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: flashagentKeys.workspaceSettings(variables.workspace_id),
      });
    },
  });
}
