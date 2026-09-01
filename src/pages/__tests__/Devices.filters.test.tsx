import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { apiClient } from '@/api/client';
import { useContextStore } from '@/stores/context';
import Devices from '../Devices';

const response = {
  devices: [
    {
      id: 'device_1',
      environment_id: 'env_1',
      group_id: null,
      policy_id: null,
      amapi_name: 'enterprises/e1/devices/d1',
      name: 'Current page device',
      serial_number: 'SERIAL-1',
      imei: null,
      manufacturer: 'Google',
      model: 'Pixel',
      os_version: '16',
      security_patch_level: null,
      state: 'ACTIVE',
      ownership: 'COMPANY_OWNED',
      management_mode: 'DEVICE_OWNER',
      policy_compliant: true,
      enrollment_time: null,
      last_status_report_at: null,
      snapshot: null,
      report_freshness: 'unknown',
    },
  ],
  pagination: { page: 1, per_page: 25, total: 1, total_pages: 1 },
  facets: {
    manufacturers: [
      { value: 'Google', label: 'Google' },
      { value: 'Motorola', label: 'Motorola' },
    ],
  },
  device_report_stale_after_days: 7,
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Devices />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('device list filters', () => {
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
  });

  it('uses fleet facets and sends manufacturer and compliance filters together', async () => {
    const user = userEvent.setup();
    const getSpy = vi.spyOn(apiClient, 'get').mockResolvedValue(response);
    renderPage();

    expect(await screen.findByText('Current page device')).toBeInTheDocument();
    const selects = screen.getAllByRole('combobox');
    const manufacturerSelect = selects[2];
    const complianceSelect = selects[3];

    expect(within(manufacturerSelect).getByRole('option', { name: 'Motorola' })).toBeInTheDocument();
    await user.selectOptions(manufacturerSelect, 'Motorola');
    await user.selectOptions(complianceSelect, 'false');

    await waitFor(() => {
      const requestedPaths = getSpy.mock.calls.map(([path]) => path);
      expect(requestedPaths.some((path) => {
        const params = new URL(path, 'http://localhost').searchParams;
        return params.get('manufacturer') === 'Motorola'
          && params.get('policy_compliant') === 'false'
          && params.get('page') === '1';
      })).toBe(true);
    });
  });

  it('shows report health and sends the stale filter', async () => {
    const user = userEvent.setup();
    const getSpy = vi.spyOn(apiClient, 'get').mockResolvedValue(response);
    renderPage();

    expect(await screen.findByText('never reported')).toBeInTheDocument();
    const reportHealthSelect = screen.getAllByRole('combobox')[4];
    await user.selectOptions(reportHealthSelect, 'stale');

    await waitFor(() => {
      expect(getSpy.mock.calls.some(([path]) => (
        new URL(path, 'http://localhost').searchParams.get('report_freshness') === 'stale'
      ))).toBe(true);
    });
  });
});
