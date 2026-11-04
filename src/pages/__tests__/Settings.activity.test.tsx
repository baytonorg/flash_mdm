import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useContextStore } from '@/stores/context';
import { useAuthStore } from '@/stores/auth';
import { EnvironmentTab } from '../Settings';

vi.mock('@/api/client', () => ({ apiClient: { get: vi.fn().mockResolvedValue({}), post: vi.fn(), put: vi.fn() } }));
vi.mock('@/api/queries/policies', () => ({
  usePolicyAssignments: () => ({ data: [] }), useAssignPolicy: () => ({}),
  useUnassignPolicy: () => ({}), usePolicies: () => ({ data: [] }),
}));

describe('Environment settings activity', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: { id: 'u1', is_superadmin: true } as never });
  });

  it('refreshes navigation context on entry so recent actions appear without switching workspace', async () => {
    const environment = { id: 'env1', workspace_id: 'ws1', name: 'Example', enterprise_name: null, enterprise_display_name: null, created_at: '2026-10-01T08:00:00Z', last_user_action_at: null };
    const refresh = vi.fn().mockImplementation(async () => {
      const fresh = { ...environment, last_user_action_at: '2026-11-04T09:00:00Z' };
      useContextStore.setState({ environments: [fresh], activeEnvironment: fresh });
    });
    useContextStore.setState({ activeWorkspace: { id: 'ws1', name: 'Workspace', gcp_project_id: null }, environments: [environment], activeEnvironment: environment, fetchEnvironments: refresh });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><EnvironmentTab /></QueryClientProvider>);
    await waitFor(() => expect(refresh).toHaveBeenCalledExactlyOnceWith('ws1'));
    expect(screen.getAllByText(new Date('2026-11-04T09:00:00Z').toLocaleString())).toHaveLength(2);
  });
});
