import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock('../../client', () => ({
  apiClient: {
    get: mocks.get,
  },
}));

import { useFlashiWorkspaceSettings } from '../flashagent';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useFlashiWorkspaceSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.get.mockResolvedValue({ workspace_assistant_enabled: true });
  });

  it('does not request workspace settings without effective workspace read access', () => {
    renderHook(() => useFlashiWorkspaceSettings('workspace-1', false), { wrapper });

    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('requests workspace settings when effective workspace read access is present', async () => {
    renderHook(() => useFlashiWorkspaceSettings('workspace-1', true), { wrapper });

    await waitFor(() => {
      expect(mocks.get).toHaveBeenCalledWith('/api/flashagent/workspace-settings?workspace_id=workspace-1');
    });
  });
});
