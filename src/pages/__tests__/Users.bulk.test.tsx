import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  bulkMutate: vi.fn(),
  clearSelection: vi.fn(),
  selectionPayload: { ids: ['u2'] },
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
    activeEnvironment: null,
    activeGroup: null,
  }),
}));

vi.mock('@/stores/auth', () => ({
  useAuthStore: (selector: (state: { user: { id: string; is_superadmin: boolean } }) => unknown) =>
    selector({ user: { id: 'u1', is_superadmin: false } }),
}));

vi.mock('@/api/queries/users', () => ({
  useWorkspaceUsers: () => ({
    data: [
      { id: 'u1', email: 'admin@example.com', role: 'admin', access_scope: 'workspace', environment_assignments: [], group_assignments: [] },
      { id: 'u2', email: 'member@example.com', role: 'member', access_scope: 'workspace', environment_assignments: [], group_assignments: [] },
    ],
    isLoading: false,
  }),
  useInviteUser: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false, error: null, reset: vi.fn() }),
  useBulkWorkspaceUsersAction: () => ({ mutate: mocks.bulkMutate, isPending: false }),
}));

vi.mock('@/api/queries/groups', () => ({
  useGroups: () => ({ data: [] }),
}));

vi.mock('@/hooks/useBulkSelection', () => ({
  useBulkSelection: () => ({
    selectedRows: [],
    selectedCount: 1,
    allMatching: false,
    canSelectAllMatching: false,
    onSelectionChange: vi.fn(),
    selectAllMatching: vi.fn(),
    clearSelection: mocks.clearSelection,
    selectionPayload: mocks.selectionPayload,
  }),
}));

vi.mock('@/components/users/UserAccessAssignmentsModal', () => ({
  default: () => null,
}));

import Users from '@/pages/Users';

describe('Users bulk actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useQuery.mockReturnValue({ data: undefined, isLoading: false });
  });

  it('submits bulk remove after confirmation', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<Users />);

    await user.click(screen.getByRole('button', { name: 'Remove from Workspace' }));

    expect(confirmSpy).toHaveBeenCalledWith('Remove 1 user(s) from workspace?');
    expect(mocks.bulkMutate).toHaveBeenCalledWith(
      {
        workspace_id: 'ws1',
        operation: 'remove',
        selection: { ids: ['u2'] },
      },
      expect.any(Object),
    );
  });

  it('submits bulk access overwrite payload from modal', async () => {
    const user = userEvent.setup();

    render(<Users />);

    await user.click(screen.getByRole('button', { name: 'Bulk Access Edit' }));
    await user.click(screen.getByRole('button', { name: 'Apply Bulk Access' }));

    expect(mocks.bulkMutate).toHaveBeenCalledWith(
      {
        workspace_id: 'ws1',
        operation: 'access_overwrite',
        selection: { ids: ['u2'] },
        options: {
          role: undefined,
          access_scope: 'workspace',
          environment_ids: [],
          group_ids: [],
        },
      },
      expect.any(Object),
    );
  });
});
