import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router';

const mocks = vi.hoisted(() => ({
  updateMutate: vi.fn(),
  useWorkflow: vi.fn((id: string) => ({
    data: {
      workflow: {
        id,
        environment_id: 'env_1',
        name: id === 'b' ? 'Workflow B' : 'Workflow A',
        enabled: true,
        trigger_type: 'device.enrolled',
        trigger_config: {},
        conditions: [],
        action_type: 'device.command',
        action_config: { command_type: 'LOCK' },
        scope_type: 'environment',
        scope_id: null,
      },
      recent_executions: [],
    },
    isLoading: false,
    isError: false,
    error: null,
  })),
}));

vi.mock('@/api/queries/workflows', () => ({
  useWorkflow: mocks.useWorkflow,
  useCreateWorkflow: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useUpdateWorkflow: () => ({ mutate: mocks.updateMutate, isPending: false, error: null }),
  useTestWorkflow: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }),
}));
vi.mock('@/stores/context', () => ({
  useContextStore: (selector: (state: unknown) => unknown) => selector({ activeEnvironment: { id: 'env_1' }, groups: [] }),
}));
vi.mock('@/hooks/useEnvironmentGuard', () => ({ useEnvironmentGuard: vi.fn() }));
vi.mock('@/components/workflows/TriggerSelector', () => ({ default: () => <div /> }));
vi.mock('@/components/workflows/ConditionBuilder', () => ({ default: () => <div /> }));
vi.mock('@/components/workflows/ActionSelector', () => ({ default: () => <div /> }));
vi.mock('@/components/workflows/ExecutionHistory', () => ({ default: () => <div /> }));
vi.mock('@/components/common/PageLoadingState', () => ({ default: () => <div>Loading workflow</div> }));

import WorkflowBuilder from '../WorkflowBuilder';

function NavigationHarness() {
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => navigate('/workflows/b')}>Open workflow B</button>
      <button onClick={() => navigate('/workflows/new')}>Create workflow</button>
    </>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('WorkflowBuilder route state', () => {
  it('reinitializes from record B and saves B data', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/workflows/a']}>
        <NavigationHarness />
        <Routes>
          <Route path="/workflows/new" element={<WorkflowBuilder />} />
          <Route path="/workflows/:id" element={<WorkflowBuilder />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByDisplayValue('Workflow A')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open workflow B' }));
    expect(await screen.findByDisplayValue('Workflow B')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save Workflow' }));

    await waitFor(() => expect(mocks.updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'b', name: 'Workflow B' }),
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    ));
  });

  it('clears record state when navigating from an existing workflow to create mode', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/workflows/a']}>
        <NavigationHarness />
        <Routes>
          <Route path="/workflows/new" element={<WorkflowBuilder />} />
          <Route path="/workflows/:id" element={<WorkflowBuilder />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByDisplayValue('Workflow A')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Create workflow' }));

    expect(await screen.findByRole('heading', { name: 'Create Workflow' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('e.g. Lock non-compliant devices')).toHaveValue('');
    expect(screen.queryByDisplayValue('Workflow A')).not.toBeInTheDocument();
  });

  it('loads an existing workflow after abandoning dirty create state', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/workflows/new']}>
        <NavigationHarness />
        <Routes>
          <Route path="/workflows/new" element={<WorkflowBuilder />} />
          <Route path="/workflows/:id" element={<WorkflowBuilder />} />
        </Routes>
      </MemoryRouter>,
    );
    const name = await screen.findByPlaceholderText('e.g. Lock non-compliant devices');
    await user.type(name, 'Unsaved new workflow');

    await user.click(screen.getByRole('button', { name: 'Open workflow B' }));

    expect(await screen.findByDisplayValue('Workflow B')).toBeInTheDocument();
    expect(window.confirm).toHaveBeenCalledOnce();
  });
});
