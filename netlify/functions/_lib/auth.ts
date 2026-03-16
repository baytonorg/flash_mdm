import { query, queryOne, execute } from './db.js';
import { hashToken } from './crypto.js';
import { assertSameOriginRequest, attachAuditAuthContextToRequest, markApiKeyAuthenticatedRequest } from './helpers.js';
import { setCurrentAuditAuthContext } from './request-auth-context.js';
import type { Context } from '@netlify/functions';

export interface SessionUser {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  is_superadmin: boolean;
  totp_enabled: boolean;
  workspace_id: string | null;
  environment_id: string | null;
  active_group_id: string | null;
  impersonation?: {
    active: boolean;
    mode: 'full' | 'read_only';
    by_user_id: string;
    by_email: string | null;
    parent_session_id: string | null;
    support_reason: string | null;
    support_ticket_ref: string | null;
    customer_notice_acknowledged_at: string | null;
  };
}

export interface AuthContext {
  user: SessionUser;
  sessionId: string | null;
  authType: 'session' | 'api_key';
  apiKey?: ApiKeyAuthContext;
}

export interface ApiKeyAuthContext {
  id: string;
  name: string;
  scope_type: 'workspace' | 'environment';
  scope_id: string;
  workspace_id: string;
  environment_id: string | null;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  created_by_user_id: string;
  created_by_email?: string | null;
  created_by_name?: string | null;
}

const SESSION_COOKIE_NAME = 'flash_session';
const SESSION_MAX_AGE = 14 * 24 * 60 * 60; // 14 days
const SESSION_MAX_AGE_MS = SESSION_MAX_AGE * 1000;
const SESSION_RENEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // renew when <= 7 days remain

function isMissingColumnError(err: unknown): boolean {
  return (
    typeof err === 'object'
    && err !== null
    && 'code' in err
    && (err as { code?: unknown }).code === '42703'
  );
}

export function getSessionTokenFromCookie(request: Request): string | null {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
  return match ? match[1] : null;
}

/** @deprecated Use getSessionTokenFromCookie instead */
export const getSessionIdFromCookie = getSessionTokenFromCookie;

export async function validateSession(request: Request): Promise<AuthContext | null> {
  const sessionToken = getSessionTokenFromCookie(request);
  if (!sessionToken) return null;

  // Session tokens are stored as hashes in the database
  const sessionId = hashToken(sessionToken);

  let row: {
    session_id: string;
    id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    is_superadmin: boolean;
    totp_enabled: boolean;
    workspace_id: string | null;
    environment_id: string | null;
    active_group_id: string | null;
    impersonated_by: string | null;
    impersonator_session_id: string | null;
    impersonated_by_email: string | null;
    impersonation_mode: 'full' | 'read_only' | null;
    support_reason: string | null;
    support_ticket_ref: string | null;
    customer_notice_acknowledged_at: string | null;
    expires_at: string;
  } | null = null;
  try {
    row = await queryOne<{
      session_id: string;
      id: string;
      email: string;
      first_name: string | null;
      last_name: string | null;
      is_superadmin: boolean;
      totp_enabled: boolean;
      workspace_id: string | null;
      environment_id: string | null;
      active_group_id: string | null;
      impersonated_by: string | null;
      impersonator_session_id: string | null;
      impersonated_by_email: string | null;
      impersonation_mode: 'full' | 'read_only' | null;
      support_reason: string | null;
      support_ticket_ref: string | null;
      customer_notice_acknowledged_at: string | null;
      expires_at: string;
    }>(
      `SELECT s.id as session_id, u.id, u.email, u.first_name, u.last_name, u.is_superadmin,
              COALESCE(u.totp_enabled, false) as totp_enabled,
              s.workspace_id, s.environment_id, s.active_group_id,
              s.impersonated_by, s.impersonator_session_id,
              s.impersonation_mode, s.support_reason, s.support_ticket_ref, s.customer_notice_acknowledged_at,
              s.expires_at,
              iu.email as impersonated_by_email
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN users iu ON iu.id = s.impersonated_by
       WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [sessionId]
    );
  } catch (err) {
    if (!isMissingColumnError(err)) throw err;
    row = await queryOne<{
      session_id: string;
      id: string;
      email: string;
      first_name: string | null;
      last_name: string | null;
      is_superadmin: boolean;
      totp_enabled: boolean;
      workspace_id: string | null;
      environment_id: string | null;
      active_group_id: string | null;
      impersonated_by: string | null;
      impersonator_session_id: string | null;
      impersonated_by_email: string | null;
      impersonation_mode: 'full' | 'read_only' | null;
      support_reason: string | null;
      support_ticket_ref: string | null;
      customer_notice_acknowledged_at: string | null;
      expires_at: string;
    }>(
      `SELECT s.id as session_id, u.id, u.email, u.first_name, u.last_name, u.is_superadmin,
              COALESCE(u.totp_enabled, false) as totp_enabled,
              s.workspace_id, NULL::uuid as environment_id, NULL::uuid as active_group_id,
              NULL::uuid as impersonated_by, NULL::uuid as impersonator_session_id,
              NULL::text as impersonation_mode, NULL::text as support_reason, NULL::text as support_ticket_ref,
              NULL::timestamptz as customer_notice_acknowledged_at, s.expires_at, NULL::text as impersonated_by_email
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [sessionId]
    );
  }

  if (!row) return null;

  // Sliding expiration: renew active sessions as they approach expiry.
  const expiresAtMs = new Date(row.expires_at).getTime();
  if (Number.isFinite(expiresAtMs) && expiresAtMs - Date.now() <= SESSION_RENEW_WINDOW_MS) {
    const renewedExpiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS);
    try {
      await execute('UPDATE sessions SET expires_at = $1 WHERE id = $2', [renewedExpiresAt, row.session_id]);
    } catch (err) {
      // Session renewal should not block request processing.
      console.error('Failed to renew session expiry:', err);
    }
  }

  return {
    user: {
      id: row.id,
      email: row.email,
      first_name: row.first_name,
      last_name: row.last_name,
      is_superadmin: row.is_superadmin,
      totp_enabled: row.totp_enabled,
      workspace_id: row.workspace_id,
      environment_id: row.environment_id,
      active_group_id: row.active_group_id,
      ...(row.impersonated_by
        ? {
            impersonation: {
              active: true,
              mode: (row.impersonation_mode ?? 'full') as 'full' | 'read_only',
              by_user_id: row.impersonated_by,
              by_email: row.impersonated_by_email,
              parent_session_id: row.impersonator_session_id,
              support_reason: row.support_reason,
              support_ticket_ref: row.support_ticket_ref,
              customer_notice_acknowledged_at: row.customer_notice_acknowledged_at,
            },
          }
        : {}),
    },
    sessionId: row.session_id,
    authType: 'session',
  };
}

function getApiKeyFromRequest(request: Request): string | null {
  const authHeader = request.headers.get('authorization');
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }
  const xApiKey = request.headers.get('x-api-key')?.trim();
  return xApiKey || null;
}

async function validateApiKey(request: Request): Promise<AuthContext | null> {
  const token = getApiKeyFromRequest(request);
  if (!token) return null;

  const tokenHash = hashToken(token);
  const row = await queryOne<{
    api_key_id: string;
    key_name: string;
    scope_type: 'workspace' | 'environment';
    workspace_id: string;
    environment_id: string | null;
    role: 'owner' | 'admin' | 'member' | 'viewer';
    created_by_user_id: string;
    user_id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    is_superadmin: boolean;
    totp_enabled: boolean;
    expires_at: string | null;
    created_by_name: string | null;
  }>(
    `SELECT ak.id AS api_key_id,
            ak.name AS key_name,
            ak.scope_type,
            ak.workspace_id,
            ak.environment_id,
            ak.role,
            ak.created_by_user_id,
            ak.expires_at,
            u.id AS user_id,
            u.email,
            u.first_name,
            u.last_name,
            u.is_superadmin,
            COALESCE(u.totp_enabled, false) AS totp_enabled,
            NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') AS created_by_name
     FROM api_keys ak
     JOIN users u ON u.id = ak.created_by_user_id
     WHERE ak.token_hash = $1
       AND ak.revoked_at IS NULL
       AND (ak.expires_at IS NULL OR ak.expires_at > now())`,
    [tokenHash]
  );

  if (!row) return null;

  try {
    await execute(
      'UPDATE api_keys SET last_used_at = now(), last_used_ip = $2 WHERE id = $1',
      [row.api_key_id, request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? request.headers.get('x-real-ip') ?? null]
    );
  } catch (err) {
    console.error('Failed to update api_keys.last_used_at:', err);
  }

  const scopeId = row.scope_type === 'workspace' ? row.workspace_id : (row.environment_id ?? '');
  if (!scopeId) return null;

  return {
    user: {
      id: row.user_id,
      email: row.email,
      first_name: row.first_name,
      last_name: row.last_name,
      // API keys are never platform-superadmin tokens; scope is enforced by apiKey metadata.
      is_superadmin: false,
      totp_enabled: row.totp_enabled,
      workspace_id: row.workspace_id,
      environment_id: row.environment_id,
      active_group_id: null,
    },
    sessionId: null,
    authType: 'api_key',
    apiKey: {
      id: row.api_key_id,
      name: row.key_name,
      scope_type: row.scope_type,
      scope_id: scopeId,
      workspace_id: row.workspace_id,
      environment_id: row.environment_id,
      role: row.role,
      created_by_user_id: row.created_by_user_id,
      created_by_email: row.email,
      created_by_name: row.created_by_name,
    },
  };
}

export async function requireAuth(request: Request): Promise<AuthContext> {
  const auth = await validateSession(request) ?? await validateApiKey(request);
  if (!auth) {
    throw new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Enforce read-only impersonation mode across handlers that call requireAuth.
  const method = request.method.toUpperCase();
  const isMutating = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
  const isApiKey = auth.authType === 'api_key';
  if (isMutating) {
    if (isApiKey) {
      markApiKeyAuthenticatedRequest(request);
    } else {
      assertSameOriginRequest(request);
      const xrw = request.headers.get('x-requested-with');
      if (xrw !== 'XMLHttpRequest') {
        throw new Response(JSON.stringify({
          error: 'Missing required X-Requested-With header',
        }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
  }

  if (!isApiKey && isMutating && auth.user.impersonation?.active && auth.user.impersonation.mode === 'read_only') {
    const path = new URL(request.url).pathname;
    const allowedWhileReadOnly = new Set([
      '/api/auth/logout',
    ]);
    if (!allowedWhileReadOnly.has(path)) {
      throw new Response(JSON.stringify({
        error: 'Read-only support session: mutating actions are blocked during impersonation.',
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  const auditCtx = {
    authType: auth.authType,
    user: {
      id: auth.user.id,
      email: auth.user.email,
    },
    ...(auth.authType === 'api_key' && auth.apiKey ? { apiKey: auth.apiKey } : {}),
  } as const;

  setCurrentAuditAuthContext(auditCtx);
  attachAuditAuthContextToRequest(request, auditCtx);

  return auth;
}

export async function requireSuperadmin(request: Request): Promise<AuthContext> {
  const auth = await requireAuth(request);
  if (auth.authType === 'api_key' || !auth.user.is_superadmin) {
    throw new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return auth;
}

export async function requireSessionAuth(request: Request): Promise<AuthContext> {
  const auth = await requireAuth(request);
  if (auth.authType !== 'session') {
    throw new Response(JSON.stringify({ error: 'Forbidden: session authentication required' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return auth;
}

export function setSessionCookie(sessionId: string): string {
  const secure = process.env.NODE_ENV !== 'development';
  return `${SESSION_COOKIE_NAME}=${sessionId}; Path=/; HttpOnly; ${secure ? 'Secure; ' : ''}SameSite=Lax; Max-Age=${SESSION_MAX_AGE}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export const SESSION_MAX_AGE_SECONDS = SESSION_MAX_AGE;
export const SESSION_MAX_AGE_MILLISECONDS = SESSION_MAX_AGE_MS;
