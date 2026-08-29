import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  deleteMutate: vi.fn(),
  deleteReset: vi.fn(),
  uploadMutate: vi.fn(),
  uploadReset: vi.fn(),
}));

vi.mock('@/api/queries/certificates', () => ({
  useTrustedCaCertificates: () => ({
    data: [{
      id: 'cert_1',
      environment_id: 'env_1',
      name: 'Corporate Root',
      cert_type: 'server_ca',
      onc_guid: 'flash-ca-cert_1',
      fingerprint_sha256: 'AA:BB',
      not_after: '2036-08-25T19:53:58.000Z',
      subject: 'CN=Corporate Root',
      issuer_name: 'CN=Corporate Root',
      created_at: '2026-08-28T12:00:00.000Z',
    }],
    isLoading: false,
    isError: false,
    error: null,
  }),
  useUploadTrustedCa: () => ({
    mutate: mocks.uploadMutate,
    reset: mocks.uploadReset,
    isPending: false,
    isError: false,
    error: null,
  }),
  useDeleteTrustedCa: () => ({
    mutate: mocks.deleteMutate,
    reset: mocks.deleteReset,
    isPending: false,
    isError: false,
    error: null,
  }),
}));

import TrustedCaManager from '../TrustedCaManager';

describe('TrustedCaManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows validated trusted CAs and explains the supported certificate boundary', () => {
    render(<TrustedCaManager environmentId="env_1" />);

    expect(screen.getByText('Corporate Root')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add CA' }));
    expect(screen.getByRole('dialog', { name: 'Add Wi-Fi trusted CA' })).toBeInTheDocument();
    expect(screen.getByText(/Client certificates and private keys are not supported/)).toBeInTheDocument();
  });

  it('requires explicit confirmation before requesting deletion', () => {
    render(<TrustedCaManager environmentId="env_1" />);

    fireEvent.click(screen.getByTitle('Delete trusted CA'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(mocks.deleteMutate).toHaveBeenCalledWith(
      { id: 'cert_1', environment_id: 'env_1' },
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );
  });
});
