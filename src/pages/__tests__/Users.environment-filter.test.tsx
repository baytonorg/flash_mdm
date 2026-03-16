import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
}));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQuery: mocks.useQuery,
  };
});

vi.mock('@/stores/context', () => ({
  useContextStore: () => ({
    activeWorkspace: { id: 'ws1', name: 'Workspace 1', access_scope: 'workspace' },
    activeEnvironment: { id: 'env1', name: 'Env 1', user_role: 'admin' },
    activeGroup: null,
  }),
}));

vi.mock('@/stores/auth', () => ({
  useAuthStore: (selector: (state: { user: { id: string; is_superadmin: boolean } }) => unknown) =>
    selector({ user: { id: 'u-admin', is_superadmin: false } }),
}));

vi.mock('@/api/queries/users', () => ({
  useWorkspaceUsers: () => ({
    data: [
      {
        id: 'u-admin',
        email: 'admin@example.com',
        role: 'admin',
        access_scope: 'workspace',
        environment_assignments: [],
        group_assignments: [],
      },
      {
        id: 'u-scoped',
        email: 'scoped@example.com',
        role: 'viewer',
        access_scope: 'scoped',
        environment_assignments: [{ environment_id: 'env1', environment_name: 'Env 1', role: 'member' }],
        group_assignments: [],
      },
      {
        id: 'u-other',
        email: 'other@example.com',
        role: 'viewer',
        access_scope: 'workspace',
        environment_assignments: [],
        group_assignments: [],
      },
    ],
    isLoading: false,
    isError: false,
    error: null,
  }),
  useInviteUser: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false, error: null, reset: vi.fn() }),
  useBulkWorkspaceUsersAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/api/queries/groups', () => ({
  useGroups: () => ({ data: [] }),
}));

vi.mock('@/hooks/useBulkSelection', () => ({
  useBulkSelection: () => ({
    selectedRows: [],
    selectedCount: 0,
    allMatching: false,
    canSelectAllMatching: false,
    onSelectionChange: vi.fn(),
    selectAllMatching: vi.fn(),
    clearSelection: vi.fn(),
    selectionPayload: { ids: [] },
  }),
}));

vi.mock('@/components/users/UserAccessAssignmentsModal', () => ({
  default: () => null,
}));

import Users from '@/pages/Users';

describe('Users environment filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useQuery.mockReturnValue({ data: undefined, isLoading: false });
  });

  it('hides workspace-wide users without direct grants in the active environment', () => {
    render(<Users />);

    expect(screen.getAllByText('scoped@example.com').length).toBeGreaterThan(0);
    expect(screen.queryByText('other@example.com')).not.toBeInTheDocument();
    expect(screen.queryByText('admin@example.com')).not.toBeInTheDocument();
  });
});
