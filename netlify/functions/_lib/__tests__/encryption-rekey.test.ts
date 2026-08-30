import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { decryptWithKey, encryptWithKey, hashToken } from '../crypto.js';
import { rekeyEncryptedState, rekeyPendingPasswordResetEmail, rekeyWorkspaceSettings } from '../encryption-rekey.js';

describe('encryption rekey transforms', () => {
  const oldKey = randomBytes(32);
  const newKey = randomBytes(32);

  it('rotates the workspace OpenAI override without changing sibling settings', () => {
    const workspaceId = '123e4567-e89b-12d3-a456-426614174000';
    const settings = {
      theme: 'dark',
      flashagent: {
        enabled: true,
        openai_api_key_enc: encryptWithKey('secret-api-key', `workspace-flashagent:${workspaceId}`, oldKey),
      },
    };
    const result = rekeyWorkspaceSettings(settings, workspaceId, oldKey, newKey);
    expect(result.changed).toBe(true);
    expect(result.settings.theme).toBe('dark');
    const flashagent = result.settings.flashagent as Record<string, unknown>;
    expect(flashagent.enabled).toBe(true);
    expect(decryptWithKey(String(flashagent.openai_api_key_enc), `workspace-flashagent:${workspaceId}`, newKey)).toBe('secret-api-key');
    expect(() => decryptWithKey(String(flashagent.openai_api_key_enc), `workspace-flashagent:${workspaceId}`, oldKey)).toThrow();
  });

  it('rotates the encrypted password-reset MFA carrier', () => {
    const userId = '123e4567-e89b-12d3-a456-426614174000';
    const envelope = encryptWithKey('$flash2$password-hash', `password_reset_pending:${userId}`, oldKey);
    const result = rekeyPendingPasswordResetEmail(
      `password_reset_mfa_pending_v2:${userId}:${envelope}`,
      oldKey,
      newKey
    );
    const rotatedEnvelope = result.value.slice(`password_reset_mfa_pending_v2:${userId}:`.length);
    expect(result.changed).toBe(true);
    expect(decryptWithKey(rotatedEnvelope, `password_reset_pending:${userId}`, newKey)).toBe('$flash2$password-hash');
  });

  it('leaves ordinary magic-link carriers unchanged', () => {
    expect(rekeyPendingPasswordResetEmail('mfa_pending:user-id', oldKey, newKey)).toEqual({
      value: 'mfa_pending:user-id',
      changed: false,
    });
  });

  it('preflights and rotates all nine encrypted locations without exposing plaintext', async () => {
    const workspaceId = '123e4567-e89b-12d3-a456-426614174000';
    const userId = '223e4567-e89b-12d3-a456-426614174000';
    const apiKeyId = '323e4567-e89b-12d3-a456-426614174000';
    const token = 'flash_workspace_test-token';
    const rows = {
      workspaces: [{
        id: workspaceId,
        google_credentials_enc: encryptWithKey(
          JSON.stringify({ type: 'service_account', client_email: 'flash@example.test', private_key: 'private-key' }),
          `workspace:${workspaceId}`,
          oldKey
        ),
        settings: {
          sibling: true,
          flashagent: { openai_api_key_enc: encryptWithKey('openai-key', `workspace-flashagent:${workspaceId}`, oldKey) },
        },
      }],
      users: [{
        id: userId,
        totp_secret_enc: encryptWithKey('JBSWY3DPEHPK3PXP', `totp:${userId}`, oldKey),
        totp_pending_enc: encryptWithKey(
          JSON.stringify({ secret: 'JBSWY3DPEHPK3PXP', backup_codes: ['one'], created_at: new Date().toISOString() }),
          `totp_pending:${userId}`,
          oldKey
        ),
        totp_backup_codes_enc: encryptWithKey(JSON.stringify(['one']), `totp_backup:${userId}`, oldKey),
      }],
      api_keys: [{ id: apiKeyId, token_hash: hashToken(token), token_enc: encryptWithKey(token, `api-key:${apiKeyId}`, oldKey) }],
      workspace_billing_settings: [{
        workspace_id: workspaceId,
        stripe_secret_key_enc: encryptWithKey('sk_test_value', `workspace-billing:${workspaceId}:stripe_secret_key`, oldKey),
        stripe_webhook_secret_enc: encryptWithKey('whsec_value', `workspace-billing:${workspaceId}:stripe_webhook_secret`, oldKey),
      }],
      magic_links: [{
        id: '423e4567-e89b-12d3-a456-426614174000',
        email: `password_reset_mfa_pending_v2:${userId}:${encryptWithKey('$flash2$hash', `password_reset_pending:${userId}`, oldKey)}`,
      }],
    };
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const client = {
      query: async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        if (sql.startsWith('SELECT id, google_credentials_enc')) return { rows: rows.workspaces, rowCount: 1 };
        if (sql.startsWith('SELECT id, totp_secret_enc')) return { rows: rows.users, rowCount: 1 };
        if (sql.startsWith('SELECT id, token_hash')) return { rows: rows.api_keys, rowCount: 1 };
        if (sql.startsWith('SELECT workspace_id, stripe_secret')) return { rows: rows.workspace_billing_settings, rowCount: 1 };
        if (sql.includes("FROM magic_links WHERE email LIKE")) return { rows: rows.magic_links, rowCount: 1 };
        if (sql.startsWith('UPDATE ')) return { rows: [], rowCount: 1 };
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    };

    const dryRunCounts = await rekeyEncryptedState(client as never, oldKey, newKey, false);
    expect(dryRunCounts).toEqual({
      workspace_credentials: 1,
      totp_secrets: 1,
      totp_pending: 1,
      totp_backup_codes: 1,
      api_keys: 1,
      stripe_secret_keys: 1,
      stripe_webhook_secrets: 1,
      workspace_openai_keys: 1,
      password_reset_mfa_links: 1,
    });
    expect(calls.some(({ sql }) => sql.startsWith('UPDATE '))).toBe(false);

    calls.length = 0;
    await rekeyEncryptedState(client as never, oldKey, newKey, true);
    expect(calls.filter(({ sql }) => sql.startsWith('UPDATE '))).toHaveLength(9);
    const apiUpdate = calls.find(({ sql }) => sql.startsWith('UPDATE api_keys'));
    expect(decryptWithKey(String(apiUpdate?.params[0]), `api-key:${apiKeyId}`, newKey)).toBe(token);
    expect(JSON.stringify(calls)).not.toContain(token);
  });
});
