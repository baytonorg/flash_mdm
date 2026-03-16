import { execute, queryOne, transaction } from "./db.js";
import { decrypt, encrypt, generateToken, hashToken } from "./crypto.js";
import { getPlatformSettings } from "./platform-settings.js";
import type { WorkspaceRole } from "./rbac.js";

export interface EffectiveAssistantSettings {
  platform_assistant_enabled: boolean;
  workspace_assistant_enabled: boolean;
  workspace_assistant_max_role: WorkspaceRole;
  workspace_assistant_default_role: WorkspaceRole;
  environment_assistant_role: WorkspaceRole;
  effective_assistant_role: WorkspaceRole;
  environment_assistant_enabled: boolean;
  effective_enabled: boolean;
}

export interface WorkspaceAssistantSettings {
  platform_assistant_enabled: boolean;
  workspace_assistant_enabled: boolean;
  workspace_assistant_max_role: WorkspaceRole;
  workspace_assistant_default_role: WorkspaceRole;
  workspace_openai_override_configured: boolean;
  workspace_openai_model: string | null;
}

interface WorkspaceAssistantSettingsRow {
  settings: Record<string, unknown> | null;
}

interface EnvironmentAssistantConfig {
  enabled: boolean;
  role: WorkspaceRole;
  api_key_id?: string;
}

function extractFlashiConfig(
  settings: Record<string, unknown> | null,
): Record<string, unknown> {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return {};
  }
  const flashagent = settings.flashagent;
  if (
    !flashagent ||
    typeof flashagent !== "object" ||
    Array.isArray(flashagent)
  ) {
    return {};
  }
  return { ...(flashagent as Record<string, unknown>) };
}

function extractEnvironmentAssistantConfig(
  enterpriseFeatures: Record<string, unknown> | null,
): EnvironmentAssistantConfig | null {
  if (
    !enterpriseFeatures ||
    typeof enterpriseFeatures !== "object" ||
    Array.isArray(enterpriseFeatures)
  ) {
    return null;
  }
  const assistant = enterpriseFeatures.assistant;
  if (!assistant || typeof assistant !== "object" || Array.isArray(assistant)) {
    return null;
  }
  const rec = assistant as Record<string, unknown>;
  return {
    enabled: rec.enabled === true,
    role: normalizeFlashiRole(rec.role, "viewer"),
    api_key_id:
      typeof rec.api_key_id === "string" && rec.api_key_id.trim()
        ? rec.api_key_id.trim()
        : undefined,
  };
}

const ASSISTANT_ROLE_ORDER: WorkspaceRole[] = [
  "viewer",
  "member",
  "admin",
  "owner",
];

function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return (
    typeof value === "string" &&
    (value === "viewer" ||
      value === "member" ||
      value === "admin" ||
      value === "owner")
  );
}

function normalizeFlashiRole(
  value: unknown,
  fallback: WorkspaceRole,
): WorkspaceRole {
  if (!isWorkspaceRole(value)) return fallback;
  if (value === "owner") return "admin";
  return value;
}

function clampRoleToCeiling(
  requested: WorkspaceRole,
  maxRole: WorkspaceRole,
): WorkspaceRole {
  const reqIdx = ASSISTANT_ROLE_ORDER.indexOf(requested);
  const maxIdx = ASSISTANT_ROLE_ORDER.indexOf(maxRole);
  return reqIdx <= maxIdx ? requested : maxRole;
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export async function getWorkspaceAssistantSettings(
  workspaceId: string,
): Promise<WorkspaceAssistantSettings> {
  const platformSettings = await getPlatformSettings();
  const row = await queryOne<WorkspaceAssistantSettingsRow>(
    "SELECT settings FROM workspaces WHERE id = $1",
    [workspaceId],
  );
  const flashagent = extractFlashiConfig(row?.settings ?? null);
  const enabled = flashagent.enabled !== false;
  const maxRole = normalizeFlashiRole(flashagent.max_role, "admin");
  const defaultRole = clampRoleToCeiling(
    normalizeFlashiRole(flashagent.default_role, "viewer"),
    maxRole,
  );
  const openAiKeyEnc = String(flashagent.openai_api_key_enc || "");
  const openAiModel =
    typeof flashagent.openai_model === "string" &&
      flashagent.openai_model.trim()
      ? flashagent.openai_model.trim().slice(0, 120)
      : null;

  return {
    platform_assistant_enabled: platformSettings.assistant_enabled,
    workspace_assistant_enabled: enabled,
    workspace_assistant_max_role: maxRole,
    workspace_assistant_default_role: defaultRole,
    workspace_openai_override_configured: openAiKeyEnc.length > 0,
    workspace_openai_model: openAiModel,
  };
}

export async function getWorkspaceOpenAiOverrides(
  workspaceId: string,
): Promise<{ apiKey: string | null; model: string | null }> {
  const row = await queryOne<WorkspaceAssistantSettingsRow>(
    "SELECT settings FROM workspaces WHERE id = $1",
    [workspaceId],
  );
  const flashagent = extractFlashiConfig(row?.settings ?? null);
  const model =
    typeof flashagent.openai_model === "string" &&
      flashagent.openai_model.trim()
      ? flashagent.openai_model.trim().slice(0, 120)
      : null;
  const encryptedApiKey =
    typeof flashagent.openai_api_key_enc === "string"
      ? flashagent.openai_api_key_enc
      : "";
  if (!encryptedApiKey) {
    return { apiKey: null, model };
  }

  try {
    const apiKey = decrypt(encryptedApiKey, `workspace-flashagent:${workspaceId}`);
    return { apiKey: apiKey.trim() || null, model };
  } catch (err) {
    console.warn(
      "Flashi: failed to decrypt workspace OpenAI override",
      err instanceof Error ? err.message : String(err),
    );
    return { apiKey: null, model };
  }
}

export async function setWorkspaceAssistantSettings(
  workspaceId: string,
  updates: {
    assistant_enabled?: boolean;
    max_role?: WorkspaceRole;
    default_role?: WorkspaceRole;
    openai_api_key?: string;
    clear_openai_api_key?: boolean;
    openai_model?: string | null;
  },
): Promise<void> {
  const row = await queryOne<WorkspaceAssistantSettingsRow>(
    "SELECT settings FROM workspaces WHERE id = $1",
    [workspaceId],
  );
  const currentSettings =
    row?.settings && typeof row.settings === "object" && !Array.isArray(row.settings)
      ? { ...row.settings }
      : {};
  const flashagent = extractFlashiConfig(currentSettings);

  if (typeof updates.assistant_enabled === "boolean") {
    flashagent.enabled = updates.assistant_enabled;
  }
  const nextMaxRole = clampRoleToCeiling(
    normalizeFlashiRole(updates.max_role ?? flashagent.max_role, "admin"),
    "admin",
  );
  const nextDefaultRole = clampRoleToCeiling(
    normalizeFlashiRole(updates.default_role ?? flashagent.default_role, "viewer"),
    nextMaxRole,
  );
  flashagent.max_role = nextMaxRole;
  flashagent.default_role = nextDefaultRole;
  if (updates.openai_model !== undefined) {
    const model = String(updates.openai_model || "").trim();
    if (model) {
      flashagent.openai_model = model.slice(0, 120);
    } else {
      delete flashagent.openai_model;
    }
  }
  if (updates.openai_api_key !== undefined) {
    const plain = String(updates.openai_api_key || "").trim();
    if (plain) {
      flashagent.openai_api_key_enc = encrypt(
        plain,
        `workspace-flashagent:${workspaceId}`,
      );
    }
  }
  if (updates.clear_openai_api_key) {
    delete flashagent.openai_api_key_enc;
  }

  if (Object.keys(flashagent).length === 0) {
    delete (currentSettings as Record<string, unknown>).flashagent;
  } else {
    (currentSettings as Record<string, unknown>).flashagent = flashagent;
  }

  await execute(
    `UPDATE workspaces
     SET settings = $1::jsonb,
         updated_at = now()
     WHERE id = $2`,
    [JSON.stringify(currentSettings), workspaceId],
  );
}

/**
 * Resolve the effective Flashi assistant enabled state for an environment.
 * effective_enabled = platform assistant_enabled AND environment enterprise_features.assistant.enabled
 */
export async function getEffectiveAssistantSettings(
  workspaceId: string,
  environmentId: string,
): Promise<EffectiveAssistantSettings> {
  const platformSettings = await getPlatformSettings();
  const platformEnabled = platformSettings.assistant_enabled;
  const workspaceSettings = await getWorkspaceAssistantSettings(workspaceId);
  const workspaceEnabled = workspaceSettings.workspace_assistant_enabled;
  const workspaceMaxRole = workspaceSettings.workspace_assistant_max_role;
  const workspaceDefaultRole = workspaceSettings.workspace_assistant_default_role;

  let environmentEnabled = false;
  let environmentRole = workspaceDefaultRole;
  try {
    const env = await queryOne<{
      enterprise_features: Record<string, unknown> | null;
    }>(
      "SELECT enterprise_features FROM environments WHERE id = $1 AND workspace_id = $2",
      [environmentId, workspaceId],
    );
    const assistantConfig = extractEnvironmentAssistantConfig(
      env?.enterprise_features ?? null,
    );
    if (assistantConfig) {
      environmentEnabled = assistantConfig.enabled;
      environmentRole = clampRoleToCeiling(
        assistantConfig.role,
        workspaceMaxRole,
      );
    }
  } catch (err) {
    // Log error but default to disabled — don't break the settings resolution
    console.warn(
      "Flashi: Failed to resolve environment assistant settings:",
      err instanceof Error ? err.message : String(err),
    );
  }

  return {
    platform_assistant_enabled: platformEnabled,
    workspace_assistant_enabled: workspaceEnabled,
    workspace_assistant_max_role: workspaceMaxRole,
    workspace_assistant_default_role: workspaceDefaultRole,
    environment_assistant_role: environmentRole,
    effective_assistant_role: environmentRole,
    environment_assistant_enabled: environmentEnabled,
    effective_enabled: platformEnabled && workspaceEnabled && environmentEnabled,
  };
}

/**
 * Set the environment-level assistant enabled flag in enterprise_features JSONB.
 * When enabled, ensure a dedicated environment API key exists for Flashi runtime.
 * When disabled, revoke any existing dedicated key and clear the stored key id.
 */
export async function setEnvironmentAssistantEnabled(
  environmentId: string,
  enabled: boolean,
  role?: WorkspaceRole,
  actorUserId?: string,
): Promise<void> {
  if (enabled && !actorUserId) {
    throw new Error("actorUserId is required when enabling Flashi");
  }

  await transaction(async (client) => {
    const env = await client.query<{
      workspace_id: string;
      enterprise_features: Record<string, unknown> | null;
    }>(
      `SELECT workspace_id, enterprise_features
       FROM environments
       WHERE id = $1
       FOR UPDATE`,
      [environmentId],
    );
    const envRow = env.rows[0];
    if (!envRow) throw new Error("Environment not found");

    const features =
      envRow.enterprise_features &&
      typeof envRow.enterprise_features === "object" &&
      !Array.isArray(envRow.enterprise_features)
        ? { ...envRow.enterprise_features }
        : {};

    const existingAssistant = extractEnvironmentAssistantConfig(
      envRow.enterprise_features,
    );
    const desiredRole = normalizeFlashiRole(role ?? existingAssistant?.role, "viewer");
    const currentApiKeyId = existingAssistant?.api_key_id;

    const revokeKey = async (apiKeyId: string) => {
      if (!isUuidLike(apiKeyId)) return;
      await client.query(
        `UPDATE api_keys
         SET revoked_at = now(), revoked_by_user_id = $2
         WHERE id = $1
           AND scope_type = 'environment'
           AND environment_id = $3
           AND revoked_at IS NULL`,
        [apiKeyId, actorUserId ?? null, environmentId],
      );
    };

    let nextApiKeyId: string | undefined;
    if (enabled) {
      let reuseExisting = false;
      if (currentApiKeyId && isUuidLike(currentApiKeyId)) {
        const existingKey = await client.query<{
          id: string;
          role: WorkspaceRole;
          revoked_at: string | null;
          expires_at: string | null;
        }>(
          `SELECT id, role, revoked_at, expires_at
           FROM api_keys
           WHERE id = $1
             AND scope_type = 'environment'
             AND workspace_id = $2
             AND environment_id = $3`,
          [currentApiKeyId, envRow.workspace_id, environmentId],
        );
        const key = existingKey.rows[0];
        if (
          key &&
          !key.revoked_at &&
          (!key.expires_at || new Date(key.expires_at).getTime() > Date.now()) &&
          key.role === desiredRole
        ) {
          reuseExisting = true;
          nextApiKeyId = key.id;
        } else {
          await revokeKey(currentApiKeyId);
        }
      }

      if (!reuseExisting) {
        const apiKeyId = crypto.randomUUID();
        const token = `flash_environment_${generateToken()}`;
        const tokenHash = hashToken(token);
        const tokenPrefix = token.slice(0, 24);
        const tokenEnc = encrypt(token, `api-key:${apiKeyId}`);
        const keyName = `Flashi (${environmentId.slice(0, 8)})`;
        await client.query(
          `INSERT INTO api_keys (
             id, name, scope_type, workspace_id, environment_id, role,
             token_hash, token_enc, token_prefix, created_by_user_id, expires_at
           ) VALUES ($1, $2, 'environment', $3, $4, $5, $6, $7, $8, $9, NULL)`,
          [
            apiKeyId,
            keyName,
            envRow.workspace_id,
            environmentId,
            desiredRole,
            tokenHash,
            tokenEnc,
            tokenPrefix,
            actorUserId,
          ],
        );
        nextApiKeyId = apiKeyId;
      }
    } else if (currentApiKeyId) {
      await revokeKey(currentApiKeyId);
    }

    const assistantConfig: Record<string, unknown> = {
      enabled,
      role: desiredRole,
    };
    if (enabled && nextApiKeyId) {
      assistantConfig.api_key_id = nextApiKeyId;
    }

    (features as Record<string, unknown>).assistant = assistantConfig;

    await client.query(
      `UPDATE environments
       SET enterprise_features = $1::jsonb,
           updated_at = now()
       WHERE id = $2`,
      [JSON.stringify(features), environmentId],
    );
  });
}

export async function getEnvironmentAssistantApiKey(
  workspaceId: string,
  environmentId: string,
): Promise<string | null> {
  const env = await queryOne<{
    enterprise_features: Record<string, unknown> | null;
  }>(
    "SELECT enterprise_features FROM environments WHERE id = $1 AND workspace_id = $2",
    [environmentId, workspaceId],
  );
  const assistant = extractEnvironmentAssistantConfig(env?.enterprise_features ?? null);
  const apiKeyId = assistant?.api_key_id;
  if (!apiKeyId || !isUuidLike(apiKeyId)) return null;

  const key = await queryOne<{
    id: string;
    token_enc: string;
    revoked_at: string | null;
    expires_at: string | null;
  }>(
    `SELECT id, token_enc, revoked_at, expires_at
     FROM api_keys
     WHERE id = $1
       AND scope_type = 'environment'
       AND workspace_id = $2
       AND environment_id = $3`,
    [apiKeyId, workspaceId, environmentId],
  );
  if (!key || key.revoked_at) return null;
  if (key.expires_at && new Date(key.expires_at).getTime() <= Date.now()) {
    return null;
  }
  try {
    const token = decrypt(key.token_enc, `api-key:${key.id}`);
    return token.trim() || null;
  } catch (err) {
    console.warn(
      "Flashi: failed to decrypt environment API key",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}
