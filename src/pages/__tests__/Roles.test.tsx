import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import Roles from '@/pages/Roles';

const mocks = vi.hoisted(() => ({
  updateMatrix: vi.fn(),
  clearOverride: vi.fn(),
  rbacQuery: {
    data: {
      workspace_id: 'ws_1',
      environment_id: 'env_1',
      has_override: false,
      defaults: {
        workspace: {
          read: 'viewer',
          write: 'admin',
          delete: 'owner',
        },
      },
      matrix: {
        workspace: {
          read: 'viewer',
          write: 'admin',
          delete: 'owner',
        },
      },
      meta: {
        roles: ['viewer', 'member', 'admin', 'owner'],
        resource_order: ['workspace'],
        action_order: ['read', 'write', 'delete'],
      },
    },
    isLoading: false,
    error: null,
  },
}));

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    user: { id: 'u_member', is_superadmin: false },
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
