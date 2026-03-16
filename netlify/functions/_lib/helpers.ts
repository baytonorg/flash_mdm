import { setCurrentAuditAuthContext, type AuditRequestAuthContext } from './request-auth-context.js';

export function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

const API_KEY_AUTHENTICATED_REQUEST_MARKER = Symbol('flash.api_key_authenticated_request');
const AUDIT_AUTH_CONTEXT_MARKER = Symbol('flash.audit_auth_context');

export function markApiKeyAuthenticatedRequest(request: Request): void {
  (request as Request & { [API_KEY_AUTHENTICATED_REQUEST_MARKER]?: boolean })[API_KEY_AUTHENTICATED_REQUEST_MARKER] = true;
}

export function isApiKeyAuthenticatedRequest(request: Request): boolean {
  return Boolean(
    (request as Request & { [API_KEY_AUTHENTICATED_REQUEST_MARKER]?: boolean })[API_KEY_AUTHENTICATED_REQUEST_MARKER]
  );
}

export function attachAuditAuthContextToRequest(request: Request, ctx: AuditRequestAuthContext): void {
  (request as Request & { [AUDIT_AUTH_CONTEXT_MARKER]?: AuditRequestAuthContext })[AUDIT_AUTH_CONTEXT_MARKER] = ctx;
}

export function getAuditAuthContextFromRequest(request: Request): AuditRequestAuthContext | undefined {
  return (request as Request & { [AUDIT_AUTH_CONTEXT_MARKER]?: AuditRequestAuthContext })[AUDIT_AUTH_CONTEXT_MARKER];
}

export function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_REGEX.test(value.trim());
}

export function assertSameOriginRequest(request: Request): void {
  if (isApiKeyAuthenticatedRequest(request)) return;

  const origin = request.headers.get('origin');
  if (!origin) return; // Non-browser clients and same-origin GETs may omit Origin

  let requestOrigin: string;
  try {
    requestOrigin = new URL(request.url).origin;
  } catch {
    throw new Response(JSON.stringify({ error: 'Invalid request URL' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (origin === 'null' || origin !== requestOrigin) {
    throw new Response(JSON.stringify({ error: 'Cross-origin requests are not allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export function getClientIp(request: Request): string {
  const auditCtx = getAuditAuthContextFromRequest(request);
  if (auditCtx) {
    // Netlify runtime appears to lose AsyncLocalStorage context across some handler awaits.
    // Refresh it at audit-call sites that derive IP from the current request.
    setCurrentAuditAuthContext(auditCtx);
  }
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'
  );
}

export async function parseJsonBody<T = unknown>(request: Request): Promise<T> {
  const method = request.method.toUpperCase();
  if ((method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') && !isApiKeyAuthenticatedRequest(request)) {
    assertSameOriginRequest(request);
  }

  try {
    return await request.json() as T;
  } catch {
    throw new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export function getSearchParams(request: Request): URLSearchParams {
  return new URL(request.url).searchParams;
}

/** Async sleep utility. */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Build a Retry-After header from a millisecond value. */
export function retryAfterHeader(
  retryAfterMs?: number,
): Record<string, string> {
  if (!retryAfterMs) return {};
  return {
    "Retry-After": String(Math.max(1, Math.ceil(retryAfterMs / 1000))),
  };
}
