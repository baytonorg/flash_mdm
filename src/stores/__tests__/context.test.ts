import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useContextStore } from '../context';

vi.mock('@/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import { apiClient } from '@/api/client';

const mockedGet = vi.mocked(apiClient.get);

const mockWorkspaces = [
  { id: 'ws-1', name: 'Workspace One', gcp_project_id: 'proj-1' },
  { id: 'ws-2', name: 'Workspace Two', gcp_project_id: null },
];

const mockEnvironments = [
  { id: 'env-1', workspace_id: 'ws-1', name: 'Production', enterprise_name: 'enterprises/ent1', enterprise_display_name: 'Ent 1' },
  { id: 'env-2', workspace_id: 'ws-1', name: 'Staging', enterprise_name: null, enterprise_display_name: null },
];

const mockGroups = [
  { id: 'grp-1', environment_id: 'env-1', parent_group_id: null, name: 'Engineering', description: 'Eng team' },
  { id: 'grp-2', environment_id: 'env-1', parent_group_id: 'grp-1', name: 'Frontend', description: null },
];

beforeEach(() => {
  useContextStore.setState({
    workspaces: [],
    activeWorkspace: null,
    environments: [],
    activeEnvironment: null,
    groups: [],
    activeGroup: null,
    isLoading: false,
  });
  vi.clearAllMocks();
});

describe('useContextStore', () => {
  describe('fetchWorkspaces', () => {
    it('populates workspace list on success', async () => {
      mockedGet.mockResolvedValueOnce({ workspaces: mockWorkspaces });
      await useContextStore.getState().fetchWorkspaces();

      expect(useContextStore.getState().workspaces).toEqual(mockWorkspaces);
      expect(useContextStore.getState().isLoading).toBe(false);
    });

    it('sets isLoading during fetch', async () => {
      let resolvePromise: (v: unknown) => void;
      mockedGet.mockReturnValueOnce(new Promise((r) => { resolvePromise = r; }));

      const promise = useContextStore.getState().fetchWorkspaces();
      expect(useContextStore.getState().isLoading).toBe(true);

      resolvePromise!({ workspaces: [] });
      await promise;
      expect(useContextStore.getState().isLoading).toBe(false);
    });

    it('handles API errors gracefully', async () => {
      mockedGet.mockRejectedValueOnce(new Error('Network error'));
      await useContextStore.getState().fetchWorkspaces();
      expect(useContextStore.getState().isLoading).toBe(false);
    });
  });

  describe('switchWorkspace', () => {
    it('sets active workspace and clears downstream state', async () => {
      useContextStore.setState({
        workspaces: mockWorkspaces,
        activeEnvironment: mockEnvironments[0],
        environments: mockEnvironments,
        groups: mockGroups,
        activeGroup: mockGroups[0],
      });
      mockedGet.mockResolvedValueOnce({ environments: [] });

      await useContextStore.getState().switchWorkspace('ws-1');
      const state = useContextStore.getState();
      expect(state.activeWorkspace).toEqual(mockWorkspaces[0]);
      expect(state.activeEnvironment).toBeNull();
      expect(state.activeGroup).toBeNull();
    });

    it('fetches environments for the selected workspace', async () => {
      useContextStore.setState({ workspaces: mockWorkspaces });
      mockedGet.mockResolvedValueOnce({ environments: mockEnvironments });

      await useContextStore.getState().switchWorkspace('ws-1');
      expect(mockedGet).toHaveBeenCalledWith('/api/environments/list?workspace_id=ws-1');
      expect(useContextStore.getState().environments).toEqual(mockEnvironments);
    });

    it('does nothing for an unknown workspace ID', async () => {
      useContextStore.setState({ workspaces: mockWorkspaces });

      await useContextStore.getState().switchWorkspace('ws-unknown');
      expect(useContextStore.getState().activeWorkspace).toBeNull();
      expect(mockedGet).not.toHaveBeenCalled();
    });
  });

  describe('fetchEnvironments', () => {
    it('populates environments for a workspace', async () => {
      mockedGet.mockResolvedValueOnce({ environments: mockEnvironments });
      await useContextStore.getState().fetchEnvironments('ws-1');
      expect(useContextStore.getState().environments).toEqual(mockEnvironments);
    });

    it('handles errors gracefully', async () => {
      mockedGet.mockRejectedValueOnce(new Error('fail'));
      await useContextStore.getState().fetchEnvironments('ws-1');
      expect(useContextStore.getState().environments).toEqual([]);
    });
  });

  describe('switchEnvironment', () => {
    it('sets active environment and clears group state', async () => {
      useContextStore.setState({
        environments: mockEnvironments,
        groups: mockGroups,
        activeGroup: mockGroups[0],
      });
      mockedGet.mockResolvedValueOnce({ groups: [] });

      await useContextStore.getState().switchEnvironment('env-1');
      const state = useContextStore.getState();
      expect(state.activeEnvironment).toEqual(mockEnvironments[0]);
      expect(state.activeGroup).toBeNull();
    });

    it('fetches groups for the selected environment', async () => {
      useContextStore.setState({ environments: mockEnvironments });
      mockedGet.mockResolvedValueOnce({ groups: mockGroups });

      await useContextStore.getState().switchEnvironment('env-1');
      expect(mockedGet).toHaveBeenCalledWith('/api/groups/list?environment_id=env-1');
    });

    it('does nothing for unknown environment ID', async () => {
      useContextStore.setState({ environments: mockEnvironments });
      await useContextStore.getState().switchEnvironment('env-unknown');
      expect(useContextStore.getState().activeEnvironment).toBeNull();
    });
  });

  describe('fetchGroups', () => {
    it('populates groups for an environment', async () => {
      mockedGet.mockResolvedValueOnce({ groups: mockGroups });
      await useContextStore.getState().fetchGroups('env-1');
      expect(useContextStore.getState().groups).toEqual(mockGroups);
    });
  });

  describe('switchGroup', () => {
    it('sets the active group', async () => {
      useContextStore.setState({ groups: mockGroups });
      await useContextStore.getState().switchGroup('grp-1');
      expect(useContextStore.getState().activeGroup).toEqual(mockGroups[0]);
    });

    it('clears the active group when passed an empty ID', async () => {
      useContextStore.setState({ groups: mockGroups, activeGroup: mockGroups[0] });
      await useContextStore.getState().switchGroup('');
      expect(useContextStore.getState().activeGroup).toBeNull();
    });

    it('does nothing for unknown group ID', async () => {
      useContextStore.setState({ groups: mockGroups });
      await useContextStore.getState().switchGroup('grp-unknown');
      expect(useContextStore.getState().activeGroup).toBeNull();
    });
  });
});
