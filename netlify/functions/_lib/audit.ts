import { execute } from './db.js';
import { getCurrentAuditAuthContext } from './request-auth-context.js';

interface AuditEntry {
  workspace_id?: string;
  environment_id?: string;
  user_id?: string;
  api_key_id?: string;
  device_id?: string;
  actor_type?: 'user' | 'system' | 'api_key';
  visibility_scope?: 'standard' | 'privileged';
  action: string;
  resource_type?: string;
  resource_id?: string;
  details?: Record<string, unknown>;
  ip_address?: string;
}

const SENSITIVE_KEY_PATTERN = /(pass(word)?|secret|token|authorization|api[_-]?key|private[_-]?key|totp|otp|activationcode)/i;
const REDACTED = '[REDACTED]';

type PgLikeError = {
  code?: string;
  message?: string;
  table?: string;
};

function sanitizeAuditValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeAuditValue);
  }

  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        output[key] = REDACTED;
      } else {
        output[key] = sanitizeAuditValue(val);
      }
    }
    return output;
  }

  return value;
}

function applyRequestAuthAttribution(entry: AuditEntry): AuditEntry {
  const currentAuth = getCurrentAuditAuthContext();
  if (!currentAuth) return entry;

  if (currentAuth.authType !== 'api_key' || !currentAuth.apiKey) {
    return entry;
  }

  // Preserve explicit actor overrides (e.g. true system events emitted during a request).
  if (entry.actor_type && entry.actor_type !== 'api_key') {
    return entry;
  }

  const authContextDetails = {
    method: 'api_key',
    principal_type: 'api_key',
    principal_id: currentAuth.apiKey.id,
    principal_name: currentAuth.apiKey.name,
    role: currentAuth.apiKey.role,
    scope_type: currentAuth.apiKey.scope_type,
    scope_id: currentAuth.apiKey.scope_id,
    created_by_user_id: currentAuth.apiKey.created_by_user_id,
    created_by_name: currentAuth.apiKey.created_by_name ?? null,
    created_by_email: currentAuth.apiKey.created_by_email ?? null,
  };

  return {
    ...entry,
    actor_type: 'api_key',
    user_id: undefined,
    api_key_id: entry.api_key_id ?? currentAuth.apiKey.id,
    details: {
      ...(entry.details ?? {}),
      auth_context: {
        ...(entry.details?.auth_context && typeof entry.details.auth_context === 'object'
          ? (entry.details.auth_context as Record<string, unknown>)
          : {}),
        ...authContextDetails,
      },
    },
  };
}

export async function logAudit(entry: AuditEntry): Promise<void> {
  const attributedEntry = applyRequestAuthAttribution(entry);
  const safeDetails = sanitizeAuditValue(attributedEntry.details ?? {}) as Record<string, unknown>;
  const detailsJson = JSON.stringify(safeDetails);

  try {
    await execute(
      `INSERT INTO audit_log (
         workspace_id, environment_id, user_id, api_key_id, device_id,
         actor_type, visibility_scope,
         action, resource_type, resource_id, details, ip_address
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        attributedEntry.workspace_id ?? null,
        attributedEntry.environment_id ?? null,
        attributedEntry.user_id ?? null,
        attributedEntry.api_key_id ?? null,
        attributedEntry.device_id ?? null,
        attributedEntry.actor_type ?? 'user',
        attributedEntry.visibility_scope ?? 'standard',
        attributedEntry.action,
        attributedEntry.resource_type ?? null,
        attributedEntry.resource_id ?? null,
        detailsJson,
        attributedEntry.ip_address ?? null,
      ]
    );
  } catch (err) {
    if (isMissingAuditLogColumnError(err)) {
      try {
        // Compatibility path for databases that have not yet run newer audit_log migrations.
        await execute(
          `INSERT INTO audit_log (
             workspace_id, environment_id, user_id, device_id,
             action, resource_type, resource_id, details, ip_address
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            attributedEntry.workspace_id ?? null,
            attributedEntry.environment_id ?? null,
            attributedEntry.user_id ?? null,
            attributedEntry.device_id ?? null,
            attributedEntry.action,
            attributedEntry.resource_type ?? null,
            attributedEntry.resource_id ?? null,
            detailsJson,
            attributedEntry.ip_address ?? null,
          ]
        );
        return;
      } catch (fallbackErr) {
        console.error('Failed to write audit log:', fallbackErr);
        return;
      }
    }
    // Audit logging should never break the main flow
    console.error('Failed to write audit log:', err);
  }
}

export { sanitizeAuditValue as _sanitizeAuditValue };

function isMissingAuditLogColumnError(err: unknown): boolean {
  const pgErr = err as PgLikeError | null | undefined;
  if (!pgErr || pgErr.code !== '42703') return false;
  if (pgErr.table && pgErr.table !== 'audit_log') return false;
  const message = pgErr.message ?? '';
  return /column "(api_key_id|actor_type|visibility_scope)" of relation "audit_log" does not exist/.test(message);
}
