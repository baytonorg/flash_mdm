import Stripe from 'stripe';
import { queryOne } from './db.js';
import { decrypt } from './crypto.js';

export interface WorkspaceStripeCredentials {
  mode: 'disabled' | 'stripe';
  secretKey: string | null;
  webhookSecret: string | null;
  publishableKey: string | null;
}

export async function getWorkspaceStripeCredentials(workspaceId: string): Promise<WorkspaceStripeCredentials> {
  const row = await queryOne<{
    mode: 'disabled' | 'stripe';
    stripe_secret_key_enc: string | null;
    stripe_webhook_secret_enc: string | null;
    stripe_publishable_key: string | null;
  }>(
    `SELECT mode, stripe_secret_key_enc, stripe_webhook_secret_enc, stripe_publishable_key
     FROM workspace_billing_settings
     WHERE workspace_id = $1`,
    [workspaceId]
  );

  if (!row) {
    return {
      mode: 'disabled',
      secretKey: null,
      webhookSecret: null,
      publishableKey: null,
    };
  }

  let secretKey: string | null = null;
  let webhookSecret: string | null = null;

  if (row.stripe_secret_key_enc) {
    secretKey = decrypt(row.stripe_secret_key_enc, `workspace-billing:${workspaceId}:stripe_secret_key`);
  }
  if (row.stripe_webhook_secret_enc) {
    webhookSecret = decrypt(row.stripe_webhook_secret_enc, `workspace-billing:${workspaceId}:stripe_webhook_secret`);
  }

  return {
    mode: row.mode ?? 'disabled',
    secretKey,
    webhookSecret,
    publishableKey: row.stripe_publishable_key ?? null,
  };
}

export function createWorkspaceStripeClient(secretKey: string): Stripe {
  return new Stripe(secretKey, { apiVersion: '2024-12-18.acacia' });
}
