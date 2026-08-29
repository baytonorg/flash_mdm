import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  bulkMutate: vi.fn(),
  clearSelection: vi.fn(),
  selectionPayload: { ids: ['t1', 't2'] },
  invalidateQueries: vi.fn(),
  deleteMutate: vi.fn(),
  deleteReset: vi.fn(),
  deleteError: null as Error | null,
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
  useEnrollmentTokens: () => ({
    data: [{
      id: 't1',
      name: 'Test token',
      qr_data: null,
      token_value: null,
      allow_personal_usage: false,
      expiry: null,
      created_at: '2026-01-01T00:00:00Z',
    }],
    isLoading: false,
  }),
  useDeleteEnrollmentToken: () => ({
    mutate: mocks.deleteMutate,
    reset: mocks.deleteReset,
    isPending: false,
    isError: mocks.deleteError !== null,
    error: mocks.deleteError,
  }),
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
    mocks.deleteError = null;
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

  it('shows a token deletion error and clears mutation state when dismissed', async () => {
    const user = userEvent.setup();
    const view = render(<EnrollmentTokens />);

    await user.click(screen.getByTitle('Delete token'));
    expect(mocks.deleteReset).toHaveBeenCalledOnce();

    mocks.deleteError = new Error('Token delete failed');
    view.rerender(<EnrollmentTokens />);
    expect(screen.getByRole('alert')).toHaveTextContent('Token delete failed');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(mocks.deleteReset).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
