import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/api/queries/zero-touch', () => ({
  useZeroTouchOptions: vi.fn(),
  useZeroTouchIframeToken: vi.fn(),
  useZeroTouchCreateEnrollmentToken: vi.fn(),
}));

import {
  useZeroTouchCreateEnrollmentToken,
  useZeroTouchIframeToken,
  useZeroTouchOptions,
} from '@/api/queries/zero-touch';
import { ZeroTouchConfig } from '../Settings';

const mockUseZeroTouchOptions = vi.mocked(useZeroTouchOptions);
const mockUseZeroTouchIframeToken = vi.mocked(useZeroTouchIframeToken);
const mockUseZeroTouchCreateEnrollmentToken = vi.mocked(useZeroTouchCreateEnrollmentToken);
const createIframeToken = vi.fn();
const createEnrollmentToken = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  createIframeToken.mockResolvedValue({
    iframe_token: 'web-token',
    iframe_url: 'https://enterprise.google.com/android/zero-touch/embedded/companyhome?token=web-token',
  });
  createEnrollmentToken.mockResolvedValue({
    enrollment_token: {
      token_id: 'created-token',
      token: 'created-value',
      qr_data: null,
      amapi_name: 'enterprises/e1/enrollmentTokens/created-token',
      group_id: null,
      expires_at: '9999-12-31T23:59:59Z',
    },
  });
  mockUseZeroTouchOptions.mockReturnValue({
    isLoading: false,
    data: {
      environment: { id: 'env_1', name: 'Environment', enterprise_name: 'enterprises/e1' },
      groups: [],
      active_tokens: [{
        id: 'existing-token',
        name: 'Existing token',
        group_id: null,
        group_name: null,
        one_time_use: false,
        allow_personal_usage: 'PERSONAL_USAGE_DISALLOWED',
        expires_at: '9999-12-31T23:59:59Z',
        amapi_value: 'existing-value',
      }],
    },
  } as unknown as ReturnType<typeof useZeroTouchOptions>);
  mockUseZeroTouchIframeToken.mockReturnValue({
    isPending: false,
    mutateAsync: createIframeToken,
  } as unknown as ReturnType<typeof useZeroTouchIframeToken>);
  mockUseZeroTouchCreateEnrollmentToken.mockReturnValue({
    isPending: false,
    mutateAsync: createEnrollmentToken,
  } as unknown as ReturnType<typeof useZeroTouchCreateEnrollmentToken>);
});

describe('ZeroTouchConfig', () => {
  it('requires and sends the selected enrollment token when opening the iframe', async () => {
    const user = userEvent.setup();
    render(<ZeroTouchConfig environmentId="env_1" />);

    const openButton = screen.getByRole('button', { name: 'Open Zero-touch Iframe' });
    expect(openButton).toBeDisabled();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Enrollment token' }), 'existing-token');
    await user.click(openButton);

    expect(createIframeToken).toHaveBeenCalledWith({
      environment_id: 'env_1',
      token_id: 'existing-token',
    });
    expect(await screen.findByTitle('Zero-touch iframe')).toBeInTheDocument();
  });

  it('uses a newly created enrollment token for the next iframe request', async () => {
    const user = userEvent.setup();
    render(<ZeroTouchConfig environmentId="env_1" />);

    await user.click(screen.getByRole('button', { name: 'Create token' }));
    await user.click(screen.getByRole('button', { name: 'Create Token' }));
    await user.click(screen.getByRole('button', { name: 'Open Zero-touch Iframe' }));

    expect(createEnrollmentToken).toHaveBeenCalledWith(expect.objectContaining({
      environment_id: 'env_1',
    }));
    expect(createIframeToken).toHaveBeenCalledWith({
      environment_id: 'env_1',
      token_id: 'created-token',
    });
  });
});
