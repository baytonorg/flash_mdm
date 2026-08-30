import type pg from 'pg';
import { decryptWithKey, encryptWithKey, hashToken } from './crypto.js';

const PASSWORD_RESET_MFA_PREFIX = 'password_reset_mfa_pending_v2:';

export interface RekeyCounts {
  workspace_credentials: number;
  totp_secrets: number;
  totp_pending: number;
  totp_backup_codes: number;
  api_keys: number;
  stripe_secret_keys: number;
  stripe_webhook_secrets: number;
  workspace_openai_keys: number;
  password_reset_mfa_links: number;
}

function rotate(
  envelope: string,
  domain: string,
  oldKey: Buffer,
  newKey: Buffer,
  validate?: (plaintext: string) => void
): string {
  const plaintext = decryptWithKey(envelope, domain, oldKey);
  validate?.(plaintext);
  const rotated = encryptWithKey(plaintext, domain, newKey);
  if (decryptWithKey(rotated, domain, newKey) !== plaintext) {
    throw new Error(`Post-rotation verification failed for ${domain}`);
  }
  return rotated;
}

function requireNonEmpty(label: string) {
  return (plaintext: string) => {
    if (!plaintext.trim()) throw new Error(`${label} decrypted to an empty value`);
  };
}

function validateGoogleCredentials(plaintext: string) {
  const value = JSON.parse(plaintext) as Record<string, unknown>;
  if (!value || typeof value !== 'object' || !value.client_email || !value.private_key) {
    throw new Error('Workspace Google credentials are missing required service-account fields');
  }
}

function validateTotpPending(plaintext: string) {
  const value = JSON.parse(plaintext) as Record<string, unknown>;
  if (typeof value.secret !== 'string' || !Array.isArray(value.backup_codes)) {
    throw new Error('Pending TOTP state has an invalid shape');
  }
}

function validateTotpSecret(plaintext: string) {
  if (!/^[A-Z2-7]+=*$/i.test(plaintext)) throw new Error('TOTP secret is not base32-shaped');
}

function validateBackupCodes(plaintext: string) {
  const value = JSON.parse(plaintext);
  if (!Array.isArray(value) || value.some((code) => typeof code !== 'string')) {
    throw new Error('TOTP backup-code state has an invalid shape');
  }
}

export function rekeyWorkspaceSettings(
  settings: Record<string, unknown>,
  workspaceId: string,
  oldKey: Buffer,
  newKey: Buffer
): { settings: Record<string, unknown>; changed: boolean } {
  const flashagent = settings.flashagent;
  if (!flashagent || typeof flashagent !== 'object' || Array.isArray(flashagent)) {
    return { settings, changed: false };
  }
  const encrypted = (flashagent as Record<string, unknown>).openai_api_key_enc;
  if (typeof encrypted !== 'string' || !encrypted) return { settings, changed: false };
  return {
    changed: true,
    settings: {
      ...settings,
      flashagent: {
        ...(flashagent as Record<string, unknown>),
        openai_api_key_enc: rotate(
          encrypted,
          `workspace-flashagent:${workspaceId}`,
          oldKey,
          newKey,
          requireNonEmpty('Workspace OpenAI key')
        ),
      },
    },
  };
}

export function rekeyPendingPasswordResetEmail(
  value: string,
  oldKey: Buffer,
  newKey: Buffer
): { value: string; changed: boolean } {
  if (!value.startsWith(PASSWORD_RESET_MFA_PREFIX)) return { value, changed: false };
  const payload = value.slice(PASSWORD_RESET_MFA_PREFIX.length);
  const separator = payload.indexOf(':');
  if (separator <= 0) throw new Error('Invalid encrypted password-reset MFA carrier');
  const userId = payload.slice(0, separator);
  const envelope = payload.slice(separator + 1);
  if (!envelope) throw new Error('Encrypted password-reset MFA carrier has no envelope');
  return {
    changed: true,
    value: `${PASSWORD_RESET_MFA_PREFIX}${userId}:${rotate(
      envelope,
      `password_reset_pending:${userId}`,
      oldKey,
      newKey,
      (plaintext) => {
        if (!plaintext.startsWith('$flash2$')) throw new Error('Pending password reset has an unsupported hash format');
      }
    )}`,
  };
}

async function assertUpdated(result: pg.QueryResult, label: string) {
  if (result.rowCount !== 1) throw new Error(`Concurrent update detected while rotating ${label}`);
}

export async function rekeyEncryptedState(
  client: pg.PoolClient,
  oldKey: Buffer,
  newKey: Buffer,
  execute: boolean
): Promise<RekeyCounts> {
  const counts: RekeyCounts = {
    workspace_credentials: 0,
    totp_secrets: 0,
    totp_pending: 0,
    totp_backup_codes: 0,
    api_keys: 0,
    stripe_secret_keys: 0,
    stripe_webhook_secrets: 0,
    workspace_openai_keys: 0,
    password_reset_mfa_links: 0,
  };

  const workspaces = await client.query<{
    id: string;
    google_credentials_enc: string | null;
    settings: Record<string, unknown> | null;
  }>('SELECT id, google_credentials_enc, settings FROM workspaces ORDER BY id');
  for (const workspace of workspaces.rows) {
    if (workspace.google_credentials_enc) {
      const next = rotate(
        workspace.google_credentials_enc,
        `workspace:${workspace.id}`,
        oldKey,
        newKey,
        validateGoogleCredentials
      );
      counts.workspace_credentials += 1;
      if (execute) await assertUpdated(await client.query(
        'UPDATE workspaces SET google_credentials_enc = $1 WHERE id = $2 AND google_credentials_enc = $3',
        [next, workspace.id, workspace.google_credentials_enc]
      ), `workspace credential ${workspace.id}`);
    }
    const settings = workspace.settings ?? {};
    const nextSettings = rekeyWorkspaceSettings(settings, workspace.id, oldKey, newKey);
    if (nextSettings.changed) {
      counts.workspace_openai_keys += 1;
      if (execute) await assertUpdated(await client.query(
        'UPDATE workspaces SET settings = $1::jsonb WHERE id = $2 AND settings IS NOT DISTINCT FROM $3::jsonb',
        [JSON.stringify(nextSettings.settings), workspace.id, JSON.stringify(settings)]
      ), `workspace assistant key ${workspace.id}`);
    }
  }

  const users = await client.query<{
    id: string;
    totp_secret_enc: string | null;
    totp_pending_enc: string | null;
    totp_backup_codes_enc: string | null;
  }>('SELECT id, totp_secret_enc, totp_pending_enc, totp_backup_codes_enc FROM users ORDER BY id');
  const userFields = [
    ['totp_secret_enc', 'totp:', 'totp_secrets', validateTotpSecret],
    ['totp_pending_enc', 'totp_pending:', 'totp_pending', validateTotpPending],
    ['totp_backup_codes_enc', 'totp_backup:', 'totp_backup_codes', validateBackupCodes],
  ] as const;
  for (const user of users.rows) {
    for (const [field, domainPrefix, countKey, validate] of userFields) {
      const current = user[field];
      if (!current) continue;
      const next = rotate(current, `${domainPrefix}${user.id}`, oldKey, newKey, validate);
      counts[countKey] += 1;
      if (execute) await assertUpdated(await client.query(
        `UPDATE users SET ${field} = $1 WHERE id = $2 AND ${field} = $3`,
        [next, user.id, current]
      ), `${field} ${user.id}`);
    }
  }

  const apiKeys = await client.query<{ id: string; token_hash: string; token_enc: string }>(
    'SELECT id, token_hash, token_enc FROM api_keys ORDER BY id'
  );
  for (const apiKey of apiKeys.rows) {
    const next = rotate(apiKey.token_enc, `api-key:${apiKey.id}`, oldKey, newKey, (plaintext) => {
      if (hashToken(plaintext) !== apiKey.token_hash) throw new Error(`API key hash mismatch for ${apiKey.id}`);
    });
    counts.api_keys += 1;
    if (execute) await assertUpdated(await client.query(
      'UPDATE api_keys SET token_enc = $1 WHERE id = $2 AND token_enc = $3',
      [next, apiKey.id, apiKey.token_enc]
    ), `API key ${apiKey.id}`);
  }

  const billingRows = await client.query<{
    workspace_id: string;
    stripe_secret_key_enc: string | null;
    stripe_webhook_secret_enc: string | null;
  }>('SELECT workspace_id, stripe_secret_key_enc, stripe_webhook_secret_enc FROM workspace_billing_settings ORDER BY workspace_id');
  const billingFields = [
    ['stripe_secret_key_enc', 'stripe_secret_key', 'stripe_secret_keys'],
    ['stripe_webhook_secret_enc', 'stripe_webhook_secret', 'stripe_webhook_secrets'],
  ] as const;
  for (const row of billingRows.rows) {
    for (const [field, domainSuffix, countKey] of billingFields) {
      const current = row[field];
      if (!current) continue;
      const next = rotate(
        current,
        `workspace-billing:${row.workspace_id}:${domainSuffix}`,
        oldKey,
        newKey,
        requireNonEmpty(`Workspace billing ${domainSuffix}`)
      );
      counts[countKey] += 1;
      if (execute) await assertUpdated(await client.query(
        `UPDATE workspace_billing_settings SET ${field} = $1 WHERE workspace_id = $2 AND ${field} = $3`,
        [next, row.workspace_id, current]
      ), `${field} ${row.workspace_id}`);
    }
  }

  const links = await client.query<{ id: string; email: string }>(
    "SELECT id, email FROM magic_links WHERE email LIKE 'password_reset_mfa_pending_v2:%' ORDER BY id"
  );
  for (const link of links.rows) {
    const next = rekeyPendingPasswordResetEmail(link.email, oldKey, newKey);
    if (!next.changed) continue;
    counts.password_reset_mfa_links += 1;
    if (execute) await assertUpdated(await client.query(
      'UPDATE magic_links SET email = $1 WHERE id = $2 AND email = $3',
      [next.value, link.id, link.email]
    ), `password-reset MFA link ${link.id}`);
  }

  return counts;
}
