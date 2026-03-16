import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

const mocks = vi.hoisted(() => ({
  bulkMutate: vi.fn(),
  clearSelection: vi.fn(),
  selectionPayload: { ids: ['wf1', 'wf2'] },
}));

vi.mock('@/stores/context', () => ({
  useContextStore: (selector: (state: { activeEnvironment: { id: string; name: string } }) => unknown) =>
    selector({ activeEnvironment: { id: 'env1', name: 'Environment 1' } }),
}));

vi.mock('@/api/queries/workflows', () => ({
  useWorkflows: () => ({ data: [], isLoading: false, isError: false, error: null }),
  useDeleteWorkflow: () => ({ mutate: vi.fn(), isPending: false }),
  useToggleWorkflow: () => ({ mutate: vi.fn(), isPending: false }),
  useBulkWorkflowAction: () => ({ mutate: mocks.bulkMutate, isPending: false }),
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

import Workflows from '@/pages/Workflows';

describe('Workflows bulk actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('submits disable operation when confirmed', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <MemoryRouter>
        <Workflows />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Disable' }));

    expect(confirmSpy).toHaveBeenCalledWith('Apply "disable" to 2 workflow(s)?');
    expect(mocks.bulkMutate).toHaveBeenCalledWith(
      {
        environment_id: 'env1',
        operation: 'disable',
        selection: { ids: ['wf1', 'wf2'] },
      },
      expect.any(Object),
    );
  });

  it('does not submit delete when confirmation is cancelled', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(
      <MemoryRouter>
        <Workflows />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(mocks.bulkMutate).not.toHaveBeenCalled();
  });
});
