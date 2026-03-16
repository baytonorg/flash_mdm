import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(),
  invalidateQueries: vi.fn(),
  bulkMutate: vi.fn(),
  clearSelection: vi.fn(),
  selectionPayload: { ids: ['p1', 'p2'] },
}));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQuery: mocks.useQuery,
    useMutation: mocks.useMutation,
    useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
  };
});

vi.mock('@/stores/context', () => ({
  useContextStore: (selector: (state: { activeEnvironment: { id: string; name: string } }) => unknown) =>
    selector({ activeEnvironment: { id: 'env1', name: 'Environment 1' } }),
}));

vi.mock('@/api/queries/policies', () => ({
  useBulkPolicyAction: () => ({ mutate: mocks.bulkMutate, isPending: false }),
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

import Policies from '@/pages/Policies';

describe('Policies bulk actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useQuery.mockReturnValue({
      data: { policies: [] },
      isLoading: false,
    });
    mocks.useMutation.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
  });

  it('submits set_production bulk payload after confirmation', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <MemoryRouter>
        <Policies />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Set Production' }));

    expect(confirmSpy).toHaveBeenCalledWith('Apply "set_production" to 2 selected policies?');
    expect(mocks.bulkMutate).toHaveBeenCalledWith(
      {
        environment_id: 'env1',
        operation: 'set_production',
        selection: {
          ids: ['p1', 'p2'],
          filters: {
            status: 'all',
            scenario: 'all',
            search: '',
          },
        },
        options: undefined,
      },
      expect.any(Object),
    );
  });

  it('does not submit delete when confirmation is cancelled', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(
      <MemoryRouter>
        <Policies />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(mocks.bulkMutate).not.toHaveBeenCalled();
  });
});
