import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  bulkMutate: vi.fn(),
  clearSelection: vi.fn(),
  selectionPayload: { ids: ['g1', 'g2'] },
}));

vi.mock('@/stores/context', () => ({
  useContextStore: (selector?: (state: { activeEnvironment: { id: string; name: string } }) => unknown) => {
    const state = { activeEnvironment: { id: 'env1', name: 'Environment 1' } };
    return selector ? selector(state) : state;
  },
}));

vi.mock('@/api/queries/groups', () => ({
  useGroups: () => ({ data: [], isLoading: false }),
  useCreateGroup: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false, error: null }),
  useUpdateGroup: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false, error: null }),
  useDeleteGroup: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false, error: null }),
  useBulkGroupAction: () => ({ mutate: mocks.bulkMutate, isPending: false }),
}));

vi.mock('@/api/queries/policies', () => ({
  usePolicyAssignments: () => ({ data: [] }),
}));

vi.mock('@/hooks/useBulkSelection', () => ({
  useBulkSelection: () => ({
    selectedRows: [],
    selectedCount: 2,
    allMatching: false,
    canSelectAllMatching: false,
    onSelectionChange: vi.fn(),
    selectAllMatching: vi.fn(),
    clearSelection: mocks.clearSelection,
    selectionPayload: mocks.selectionPayload,
  }),
}));

import Groups from '@/pages/Groups';

describe('Groups bulk actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('submits bulk delete after confirmation', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<Groups />);

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(confirmSpy).toHaveBeenCalledWith('Delete 2 selected group(s)?');
    expect(mocks.bulkMutate).toHaveBeenCalledWith(
      {
        environment_id: 'env1',
        operation: 'delete',
        selection: { ids: ['g1', 'g2'] },
      },
      expect.any(Object),
    );
  });

  it('submits bulk move payload from move modal', async () => {
    const user = userEvent.setup();

    render(<Groups />);

    await user.click(screen.getByRole('button', { name: 'Move' }));
    await user.click(screen.getByRole('button', { name: 'Move Groups' }));

    expect(mocks.bulkMutate).toHaveBeenCalledWith(
      {
        environment_id: 'env1',
        operation: 'move',
        selection: { ids: ['g1', 'g2'] },
        options: {
          target_parent_id: null,
          clear_direct_assignments: false,
        },
      },
      expect.any(Object),
    );
  });

  it('shows warning message when bulk move returns 403', async () => {
    const user = userEvent.setup();
    mocks.bulkMutate.mockImplementationOnce((_payload, handlers) => {
      handlers?.onError?.({ status: 403, message: 'Forbidden' });
    });

    render(<Groups />);

    await user.click(screen.getByRole('button', { name: 'Move' }));
    await user.click(screen.getByRole('button', { name: 'Move Groups' }));

    expect(
      await screen.findByText('Permission denied: you do not have access to modify one or more selected groups.')
    ).toBeInTheDocument();
  });
});
