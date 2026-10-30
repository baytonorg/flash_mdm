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
  tokens: [] as Array<Record<string, unknown>>,
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
    data: mocks.tokens,
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
    mocks.tokens = [{
      id: 't1',
      name: 'Test token',
      qr_data: null,
      token_value: null,
      allow_personal_usage: false,
      expires_at: '2099-11-05T13:12:23Z',
      created_at: '2026-01-01T00:00:00Z',
    }];
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

  it('renders the API expires_at field in the list and detail view', async () => {
    const user = userEvent.setup();
    render(<EnrollmentTokens />);

    expect(screen.queryByText('Never')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open enrolment token Test token' }));
    const detailExpiryLabel = screen.getAllByText('Expires').at(-1);
    expect(detailExpiryLabel?.nextElementSibling).not.toHaveTextContent('Never');
  });

  it('prefers expires_at over a conflicting legacy expiry value', () => {
    mocks.tokens = [{
      ...mocks.tokens[0],
      expiry: null,
      expires_at: '2000-01-01T00:00:00Z',
    }];

    render(<EnrollmentTokens />);

    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.queryByText('Never')).not.toBeInTheDocument();
  });

  it('retains the legacy expiry field as a compatibility fallback', () => {
    mocks.tokens = [{
      ...mocks.tokens[0],
      expiry: '2000-01-01T00:00:00Z',
      expires_at: undefined,
    }];

    render(<EnrollmentTokens />);

    expect(screen.getByText('Expired')).toBeInTheDocument();
  });

  it('renders Never only when both expiry fields are absent', () => {
    mocks.tokens = [{
      ...mocks.tokens[0],
      expiry: null,
      expires_at: null,
    }];

    render(<EnrollmentTokens />);

    expect(screen.getByText('Never')).toBeInTheDocument();
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
