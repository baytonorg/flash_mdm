import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import Roles from '@/pages/Roles';

const mocks = vi.hoisted(() => ({
  owner: false,
  updateMatrix: vi.fn(),
  clearOverride: vi.fn(),
  rbacQuery: {
    data: {
      workspace_id: 'ws_1',
      environment_id: 'env_1',
      has_override: false,
      can_manage: true,
      defaults: {
        policy: { read: 'viewer', write: 'member', assign: 'admin', delete: 'admin' },
        workspace: {
          read: 'viewer',
          write: 'admin',
          delete: 'owner',
        },
      },
      matrix: {
        policy: { read: 'viewer', write: 'member', assign: 'admin', delete: 'admin' },
        workspace: {
          read: 'viewer',
          write: 'admin',
          delete: 'owner',
        },
      },
      meta: {
        roles: ['viewer', 'member', 'admin', 'owner'],
        resource_order: ['workspace', 'policy'],
        action_order: ['read', 'write', 'assign', 'delete'],
      },
    },
    isLoading: false,
    error: null,
  },
}));

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    user: { id: 'u_member', is_superadmin: mocks.owner },
  }),
}));

vi.mock('@/stores/context', () => ({
  useContextStore: () => ({
    activeWorkspace: {
      id: 'ws_1',
      name: 'Workspace One',
      user_role: 'member',
    },
    activeEnvironment: {
      id: 'env_1',
      name: 'Testing',
      user_role: 'member',
    },
  }),
}));

vi.mock('@/api/queries/rbac', () => ({
  useWorkspaceRbacMatrix: () => mocks.rbacQuery,
  useUpdateWorkspaceRbacMatrix: () => ({
    mutateAsync: mocks.updateMatrix,
    isPending: false,
  }),
  useClearWorkspaceRbacOverride: () => ({
    mutateAsync: mocks.clearOverride,
    isPending: false,
  }),
}));

describe('Roles page read-only viewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.owner = false;
  });

  it('shows assignment alongside editing and prevents below-Admin selection in both views', () => {
    mocks.owner = true;
    render(<Roles />);
    const assignmentLabels = screen.getAllByText('Assign');
    expect(assignmentLabels).toHaveLength(4);
    const assignmentChecks = assignmentLabels.map(label => label.closest('label')!.querySelector('input')!);
    expect(assignmentChecks.map(input => input.disabled)).toEqual([true, false, true, true]);
    expect(assignmentChecks.map(input => input.checked)).toEqual([true, true, false, false]);
    fireEvent.click(screen.getByRole('button', { name: 'Raw Matrix' }));
    const assignmentSelect = screen.getByText('Assign').closest('.rounded-lg')!.querySelector('select')!;
    expect(Array.from(assignmentSelect.options).map(option => [option.value, option.disabled])).toEqual([
      ['viewer', true], ['member', true], ['admin', false], ['owner', false],
    ]);
    fireEvent.change(assignmentSelect, { target: { value: 'owner' } });
    expect(assignmentSelect.value).toBe('owner');
  });

  it('shows read-only banner and disables permission inputs for non-owner users', () => {
    render(<Roles />);

    expect(
      screen.getByText('Read-only permissions view: owner defines policy, admins and members can review role-based permissions here.')
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save RBAC' })).not.toBeInTheDocument();

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBeGreaterThan(0);
    expect(checkboxes[0]).toBeDisabled();
  });
});
