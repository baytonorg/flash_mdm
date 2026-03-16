import { beforeEach, describe, expect, it } from 'vitest';
import { queryClient } from '@/lib/queryClient';
import { resetClientSessionState } from '@/lib/sessionReset';
import { useContextStore } from '@/stores/context';
import { useUiStore } from '@/stores/ui';
import { useFlashagentStore } from '@/stores/flashagent';

function clearStorage() {
  if (typeof localStorage.clear === 'function') {
    localStorage.clear();
    return;
  }
  localStorage.removeItem('flash_context');
  localStorage.removeItem('flashi_chat_open');
}

beforeEach(() => {
  queryClient.clear();
  clearStorage();

  useContextStore.setState({
    workspaces: [{ id: 'ws_1', name: 'Workspace', gcp_project_id: null }],
    activeWorkspace: { id: 'ws_1', name: 'Workspace', gcp_project_id: null },
    environments: [{ id: 'env_1', workspace_id: 'ws_1', name: 'Prod', enterprise_name: null, enterprise_display_name: null }],
    activeEnvironment: { id: 'env_1', workspace_id: 'ws_1', name: 'Prod', enterprise_name: null, enterprise_display_name: null },
    groups: [{ id: 'grp_1', environment_id: 'env_1', parent_group_id: null, name: 'Group', description: null }],
    activeGroup: { id: 'grp_1', environment_id: 'env_1', parent_group_id: null, name: 'Group', description: null },
    isLoading: true,
  });
  useUiStore.setState({
    sidebarOpen: false,
    viewMode: 'card',
  });
  useFlashagentStore.setState({
    chatOpen: true,
  });
  localStorage.setItem('flash_context', JSON.stringify({ workspaceId: 'ws_1' }));
});

describe('resetClientSessionState', () => {
  it('clears all non-auth session-scoped client stores and persisted flash context', () => {
    resetClientSessionState();

    // Auth store is NOT reset by this function (auth.ts owns its own reset
    // to avoid a circular dependency). See fullSessionReset in auth.ts.

    expect(useContextStore.getState().workspaces).toEqual([]);
    expect(useContextStore.getState().activeWorkspace).toBeNull();
    expect(useContextStore.getState().environments).toEqual([]);
    expect(useContextStore.getState().activeEnvironment).toBeNull();
    expect(useContextStore.getState().groups).toEqual([]);
    expect(useContextStore.getState().activeGroup).toBeNull();
    expect(useContextStore.getState().isLoading).toBe(false);

    expect(useUiStore.getState().sidebarOpen).toBe(true);
    expect(useUiStore.getState().viewMode).toBe('table');
    expect(useFlashagentStore.getState().chatOpen).toBe(false);
    expect(localStorage.getItem('flash_context')).toBeNull();
  });

  it('clears the TanStack Query cache', () => {
    queryClient.setQueryData(['session-reset-test'], { ok: true });
    expect(queryClient.getQueryData(['session-reset-test'])).toEqual({ ok: true });

    resetClientSessionState();

    expect(queryClient.getQueryData(['session-reset-test'])).toBeUndefined();
  });
});
