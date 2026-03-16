import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PolicyDerivativesPanel from '../PolicyDerivativesPanel';

const mockAssign = vi.fn();
const mockUnassign = vi.fn();
const mockApiGet = vi.fn();

let groups: Array<{ id: string; environment_id: string; name: string; parent_id: string | null; depth: number }> = [];
let assignments: Array<{
  id: string;
  policy_id: string;
  policy_name: string;
  scope_type: 'group';
  scope_id: string;
  scope_name: string;
  created_at: string;
}> = [];

vi.mock('@/stores/context', () => ({
  useContextStore: () => ({
    activeEnvironment: { id: 'env_1' },
  }),
}));

vi.mock('@/api/client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockApiGet(...args),
  },
}));

vi.mock('@/api/queries/groups', () => ({
  useGroups: () => ({ data: groups, isLoading: false }),
}));

vi.mock('@/api/queries/policies', () => ({
  usePolicyAssignments: () => ({ data: assignments }),
  useAssignPolicy: () => ({ mutateAsync: mockAssign, isPending: false }),
  useUnassignPolicy: () => ({ mutateAsync: mockUnassign, isPending: false }),
}));

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PolicyDerivativesPanel policyId="policy_current" policyName="Current Policy" />
    </QueryClientProvider>
  );
}

describe('PolicyDerivativesPanel', () => {
  beforeEach(() => {
    mockAssign.mockReset();
    mockUnassign.mockReset();
    mockApiGet.mockResolvedValue({ derivatives: [] });
    groups = [
      { id: 'group_a', environment_id: 'env_1', name: 'Group A', parent_id: null, depth: 0 },
      { id: 'group_b', environment_id: 'env_1', name: 'Group B', parent_id: null, depth: 0 },
      { id: 'group_c', environment_id: 'env_1', name: 'Group C', parent_id: null, depth: 0 },
    ];
    assignments = [
      {
        id: 'assign_a',
        policy_id: 'policy_other',
        policy_name: 'Other Policy',
        scope_type: 'group',
        scope_id: 'group_a',
        scope_name: 'Group A',
        created_at: '2025-01-01',
      },
      {
        id: 'assign_b',
        policy_id: 'policy_current',
        policy_name: 'Current Policy',
        scope_type: 'group',
        scope_id: 'group_b',
        scope_name: 'Group B',
        created_at: '2025-01-01',
      },
    ];
  });

  it('confirms before overriding another policy on assign', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderPanel();

    const groupA = await screen.findByRole('checkbox', { name: /Group A/ });
    await user.click(groupA);
    await user.click(await screen.findByRole('button', { name: 'Assign 1' }));

    expect(confirmSpy).toHaveBeenCalledWith(
      'Override Other Policy on Group A with Current Policy?'
    );
    await waitFor(() => {
      expect(mockAssign).toHaveBeenCalledWith({
        policy_id: 'policy_current',
        scope_type: 'group',
        scope_id: 'group_a',
      });
    });
  });

  it('unassigns a single group from the row action with confirmation', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderPanel();

    await screen.findByText('Assign to Groups');
    const unassignButtons = screen.getAllByRole('button', { name: 'Unassign' });
    const rowUnassign = unassignButtons.find((btn) => !btn.hasAttribute('disabled'));
    expect(rowUnassign).toBeTruthy();
    await user.click(rowUnassign!);

    expect(confirmSpy).toHaveBeenCalledWith(
      'Unassign Current Policy from Group B?'
    );
    await waitFor(() => {
      expect(mockUnassign).toHaveBeenCalledWith({ scope_type: 'group', scope_id: 'group_b' });
    });
  });

  it('confirms before bulk unassigning selected groups', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderPanel();

    const groupB = await screen.findByRole('checkbox', { name: /Group B/ });
    await user.click(groupB);
    await user.click(await screen.findByRole('button', { name: 'Unassign 1' }));

    expect(confirmSpy).toHaveBeenCalledWith(
      'Unassign Current Policy from Group B?'
    );
    await waitFor(() => {
      expect(mockUnassign).toHaveBeenCalledWith({ scope_type: 'group', scope_id: 'group_b' });
    });
  });
});
