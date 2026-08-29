import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useNavigate, useLocation } from 'react-router';

vi.mock('@/api/client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}));
vi.mock('@/stores/context', () => ({
  useContextStore: (selector: (state: unknown) => unknown) => selector({ activeEnvironment: { id: 'env_1' } }),
}));
vi.mock('@/hooks/useEnvironmentGuard', () => ({ useEnvironmentGuard: vi.fn() }));
vi.mock('@/components/policy/PolicyCategoryNav', () => ({ default: () => <div /> }));
vi.mock('@/components/policy/PolicyFormSection', () => ({ default: () => <div /> }));
vi.mock('@/components/policy/PolicyJsonEditor', () => ({ default: () => <div /> }));
vi.mock('@/components/policy/PolicyDerivativesPanel', () => ({ default: () => <div /> }));
vi.mock('@/components/common/PageLoadingState', () => ({ default: () => <div>Loading policy</div> }));

import { apiClient } from '@/api/client';
import PolicyEditor from '../PolicyEditor';

const mockGet = vi.mocked(apiClient.get);
const mockPut = vi.mocked(apiClient.put);

function policy(id: string, name: string) {
  return {
    policy: {
      id,
      environment_id: 'env_1',
      name,
      description: `${name} description`,
      deployment_scenario: 'fm',
      config: {},
      amapi_name: null,
      version: 1,
      status: 'draft',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    components: [],
  };
}

function NavigationHarness() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <>
      <button onClick={() => navigate('/policies/b')}>Open policy B</button>
      <button onClick={() => navigate('/policies/new')}>Create policy</button>
      <output data-testid="location">{location.pathname}</output>
    </>
  );
}

function renderEditor(initialPath = '/policies/a') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <NavigationHarness />
        <Routes>
          <Route path="/policies/new" element={<PolicyEditor />} />
          <Route path="/policies/:id" element={<PolicyEditor />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockImplementation(async (path) => path.endsWith('/b') ? policy('b', 'Policy B') : policy('a', 'Policy A'));
  mockPut.mockResolvedValue({ message: 'saved', version: 2 });
});

describe('PolicyEditor route state', () => {
  it('loads record B before allowing it to be saved', async () => {
    const user = userEvent.setup();
    renderEditor();
    expect(await screen.findByDisplayValue('Policy A')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open policy B' }));
    expect(await screen.findByDisplayValue('Policy B')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockPut).toHaveBeenCalledWith('/api/policies/update', expect.objectContaining({
      id: 'b',
      name: 'Policy B',
    })));
  });

  it('returns to record A when the user keeps unsaved changes', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    renderEditor();
    const name = await screen.findByDisplayValue('Policy A');
    await user.clear(name);
    await user.type(name, 'Edited Policy A');

    await user.click(screen.getByRole('button', { name: 'Open policy B' }));

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/policies/a'));
    expect(screen.getByDisplayValue('Edited Policy A')).toBeInTheDocument();
    expect(window.confirm).toHaveBeenCalledOnce();
  });

  it('clears record state when navigating from an existing policy to create mode', async () => {
    const user = userEvent.setup();
    renderEditor();
    expect(await screen.findByDisplayValue('Policy A')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Create policy' }));

    expect(await screen.findByRole('heading', { name: 'Create New Policy' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('e.g. Corporate Device Policy')).toHaveValue('');
    expect(screen.queryByDisplayValue('Policy A')).not.toBeInTheDocument();
  });

  it('loads an existing policy after abandoning dirty create state', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    renderEditor('/policies/new');
    const name = await screen.findByPlaceholderText('e.g. Corporate Device Policy');
    await user.type(name, 'Unsaved new policy');

    await user.click(screen.getByRole('button', { name: 'Open policy B' }));

    expect(await screen.findByDisplayValue('Policy B')).toBeInTheDocument();
    expect(window.confirm).toHaveBeenCalledOnce();
  });

  it('does not carry the push-to-AMAPI choice between existing policies', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    renderEditor();
    expect(await screen.findByDisplayValue('Policy A')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /Push to AMAPI/i }));

    await user.click(screen.getByRole('button', { name: 'Open policy B' }));

    expect(await screen.findByDisplayValue('Policy B')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Push to AMAPI/i })).not.toBeChecked();
  });
});
