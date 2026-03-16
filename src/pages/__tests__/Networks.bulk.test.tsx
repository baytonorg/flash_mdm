import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  bulkMutate: vi.fn(),
  clearSelection: vi.fn(),
  selectionPayload: { ids: ['n1', 'n2'] },
}));

vi.mock('@/stores/context', () => ({
  useContextStore: (selector: (state: { activeEnvironment: { id: string; name: string } }) => unknown) =>
    selector({ activeEnvironment: { id: 'env1', name: 'Environment 1' } }),
}));

vi.mock('@/api/queries/networks', () => ({
  useNetworkDeployments: () => ({ data: [], isLoading: false }),
  useDeployNetwork: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateNetworkDeployment: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteNetworkDeployment: () => ({ mutate: vi.fn(), isPending: false }),
  useBulkNetworkAction: () => ({ mutate: mocks.bulkMutate, isPending: false }),
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

import Networks from '@/pages/Networks';

describe('Networks bulk actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('submits bulk delete payload after confirmation', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<Networks />);

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(confirmSpy).toHaveBeenCalledWith('Delete 2 selected network deployment(s)?');
    expect(mocks.bulkMutate).toHaveBeenCalledWith(
      {
        environment_id: 'env1',
        operation: 'delete',
        selection: { ids: ['n1', 'n2'] },
      },
      expect.any(Object),
    );
  });

  it('does not submit bulk delete when confirmation is cancelled', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<Networks />);

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(mocks.bulkMutate).not.toHaveBeenCalled();
  });
});
