import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { apiClient } from '@/api/client';
import { useContextStore } from '@/stores/context';
import Dashboard from '../Dashboard';
import Devices from '../Devices';
import Policies from '../Policies';
import EnrollmentTokens from '../EnrollmentTokens';

function renderPage(page: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{page}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  useContextStore.setState({
    activeWorkspace: { id: 'workspace_1', name: 'Workspace', gcp_project_id: null },
    activeEnvironment: {
      id: 'env_1',
      workspace_id: 'workspace_1',
      name: 'Production',
      enterprise_name: 'enterprises/e1',
      enterprise_display_name: 'Enterprise',
    },
    activeGroup: null,
  });
  vi.spyOn(apiClient, 'get').mockRejectedValue(new Error('Service unavailable'));
});

describe('primary page query failures', () => {
  it.each([
    ['dashboard', <Dashboard />, 'Unable to load dashboard'],
    ['devices', <Devices />, 'Unable to load devices'],
    ['policies', <Policies />, 'Unable to load policies'],
    ['enrolment tokens', <EnrollmentTokens />, 'Unable to load enrolment tokens'],
  ])('distinguishes a %s failure from an empty dataset', async (_name, page, message) => {
    renderPage(page);

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByText('Service unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
