import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  bulkMutate: vi.fn(),
  clearSelection: vi.fn(),
  selectionPayload: { ids: ['t1', 't2'] },
  invalidateQueries: vi.fn(),
}));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
  };
});

vi.mock('@/stores/context', () => ({
  useContextStore: () => ({
    activeEnvironment: { id: 'env1', name: 'Environment 1' },
  }),
}));

vi.mock('@/api/queries/enrollment', () => ({
  enrollmentKeys: { all: ['enrollment'] },
  useEnrollmentTokens: () => ({ data: [], isLoading: false }),
  useDeleteEnrollmentToken: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSyncEnrollmentTokens: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }),
  useBulkEnrollmentAction: () => ({ mutate: mocks.bulkMutate, isPending: false }),
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

vi.mock('@/components/enrollment/TokenCreator', () => ({
  default: () => null,
}));

import EnrollmentTokens from '@/pages/EnrollmentTokens';

describe('Enrollment tokens bulk actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('submits bulk token delete payload after confirmation', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<EnrollmentTokens />);

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(confirmSpy).toHaveBeenCalledWith('Delete 2 selected token(s)?');
    expect(mocks.bulkMutate).toHaveBeenCalledWith(
      {
        environment_id: 'env1',
        operation: 'delete',
        selection: { ids: ['t1', 't2'] },
      },
      expect.any(Object),
    );
  });

  it('does not submit bulk token delete when confirmation is cancelled', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<EnrollmentTokens />);

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(mocks.bulkMutate).not.toHaveBeenCalled();
  });
});
