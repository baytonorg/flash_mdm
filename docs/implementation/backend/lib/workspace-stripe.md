# `netlify/functions/_lib/workspace-stripe.ts`

> Retrieves and decrypts workspace-level Stripe credentials for workspaces that manage their own billing.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `WorkspaceStripeCredentials` | `interface` | Shape: `{ mode: 'disabled' \| 'stripe', secretKey: string \| null, webhookSecret: string \| null, publishableKey: string \| null }` |
| `getWorkspaceStripeCredentials` | `(workspaceId: string) => Promise<WorkspaceStripeCredentials>` | Loads billing settings for a workspace, decrypting the secret key and webhook secret; returns mode `'disabled'` with null keys if no row exists |
| `createWorkspaceStripeClient` | `(secretKey: string) => Stripe` | Creates a new Stripe client instance from a decrypted workspace secret key |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `queryOne` | `_lib/db.ts` | Querying `workspace_billing_settings` table |
| `decrypt` | `_lib/crypto.ts` | Decrypting AES-encrypted Stripe keys stored in the database |

## Key Logic

Workspace-level Stripe credentials are stored in the `workspace_billing_settings` table with encrypted columns (`stripe_secret_key_enc`, `stripe_webhook_secret_enc`) and a plaintext publishable key.

`getWorkspaceStripeCredentials` decrypts keys using associated data strings of the form `workspace-billing:{workspaceId}:stripe_secret_key` and `workspace-billing:{workspaceId}:stripe_webhook_secret` for authenticated encryption context.

`createWorkspaceStripeClient` creates a fresh (non-singleton) Stripe instance per workspace, using API version `2024-12-18.acacia`, enabling multi-tenant Stripe Connect or separate account patterns.
