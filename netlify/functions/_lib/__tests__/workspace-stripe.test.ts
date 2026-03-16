import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockQueryOne, mockDecrypt, mockStripeConstructor } = vi.hoisted(() => ({
  mockQueryOne: vi.fn(),
  mockDecrypt: vi.fn(),
  mockStripeConstructor: vi.fn(function (this: unknown, key: string, options: unknown) {
    return { key, options };
  }),
}));

vi.mock('../db.js', () => ({
  queryOne: mockQueryOne,
}));

vi.mock('../crypto.js', () => ({
  decrypt: mockDecrypt,
}));

vi.mock('stripe', () => ({
  default: mockStripeConstructor,
}));

import { createWorkspaceStripeClient, getWorkspaceStripeCredentials } from '../workspace-stripe.js';

const WORKSPACE_ID = '123e4567-e89b-12d3-a456-426614174000';

beforeEach(() => {
  mockQueryOne.mockReset();
  mockDecrypt.mockReset();
  mockStripeConstructor.mockReset();
});

describe('workspace-stripe helpers', () => {
  it('returns disabled credentials when workspace has no billing settings row', async () => {
    mockQueryOne.mockResolvedValue(null);

    const creds = await getWorkspaceStripeCredentials(WORKSPACE_ID);

    expect(creds).toEqual({
      mode: 'disabled',
      secretKey: null,
      webhookSecret: null,
      publishableKey: null,
    });
    expect(mockDecrypt).not.toHaveBeenCalled();
  });

  it('decrypts workspace Stripe secrets with workspace-scoped AAD labels', async () => {
    mockQueryOne.mockResolvedValue({
      mode: 'stripe',
      stripe_secret_key_enc: 'enc_secret',
      stripe_webhook_secret_enc: 'enc_webhook',
      stripe_publishable_key: 'pk_test',
    });
    mockDecrypt
      .mockReturnValueOnce('sk_test_workspace')
      .mockReturnValueOnce('whsec_workspace');

    const creds = await getWorkspaceStripeCredentials(WORKSPACE_ID);

    expect(mockDecrypt).toHaveBeenNthCalledWith(
      1,
      'enc_secret',
      `workspace-billing:${WORKSPACE_ID}:stripe_secret_key`
    );
    expect(mockDecrypt).toHaveBeenNthCalledWith(
      2,
      'enc_webhook',
      `workspace-billing:${WORKSPACE_ID}:stripe_webhook_secret`
    );
    expect(creds).toEqual({
      mode: 'stripe',
      secretKey: 'sk_test_workspace',
      webhookSecret: 'whsec_workspace',
      publishableKey: 'pk_test',
    });
  });

  it('creates Stripe client with pinned API version', () => {
    const client = createWorkspaceStripeClient('sk_workspace_test');

    expect(mockStripeConstructor).toHaveBeenCalledWith('sk_workspace_test', {
      apiVersion: '2024-12-18.acacia',
    });
    expect(client).toEqual({
      key: 'sk_workspace_test',
      options: { apiVersion: '2024-12-18.acacia' },
    });
  });
});
