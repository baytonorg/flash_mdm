import type { Context } from '@netlify/functions';
import { validateSession, requireSessionAuth } from './_lib/auth.js';
import { queryOne, execute } from './_lib/db.js';
import { jsonResponse, errorResponse, parseJsonBody } from './_lib/helpers.js';

function isDatabaseInfraError(err: unknown): boolean {
  const code = typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code?: unknown }).code ?? '')
    : '';
  if (['53300', '57P03', '08000', '08003', '08006', '08001', '08P01'].includes(code)) {
    return true;
  }

  const message = typeof err === 'object' && err !== null && 'message' in err
    ? String((err as { message?: unknown }).message ?? '').toLowerCase()
    : '';

  return (
    message.includes('exceeded the compute time quota')
    || message.includes('connection terminated unexpectedly')
    || message.includes('too many connections')
    || message.includes('connection refused')
    || message.includes('timeout expired')
  );
}

function authServiceUnavailableResponse(): Response {
  return jsonResponse(
    {
      error: 'Authentication service temporarily unavailable. Please retry shortly.',
      code: 'AUTH_SERVICE_UNAVAILABLE',
    },
    503,
    { 'Retry-After': '60' }
  );
}

async function getUserNeedsSetup(userId: string): Promise<boolean> {
  try {
    const meta = await queryOne<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM users WHERE id = $1`,
      [userId]
    );
    return meta?.metadata?.needs_environment_setup === true;
  } catch {
    return false;
  }
}

export default async (request: Request, context: Context) => {
  // POST /api/auth/session — clear environment setup flag
  if (request.method === 'POST') {
    try {
      const auth = await requireSessionAuth(request);
      const body = await parseJsonBody<{ clear_environment_setup?: boolean }>(request);
      if (body.clear_environment_setup) {
        try {
          await execute(
            `UPDATE users SET metadata = metadata - 'needs_environment_setup' WHERE id = $1`,
            [auth.user.id]
          );
        } catch {
          // metadata column may not exist yet; ignore
        }
      }
      return jsonResponse({ message: 'ok' });
    } catch (err) {
      if (err instanceof Response) return err;
      if (isDatabaseInfraError(err)) {
        console.error('Auth session POST unavailable due to database infrastructure error', err);
        return authServiceUnavailableResponse();
      }
      console.error('Auth session POST failed', err);
      return errorResponse('Internal server error', 500);
    }
  }

  if (request.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    const auth = await validateSession(request);
    if (!auth) {
      return errorResponse('Unauthorized', 401);
    }

    const needsEnvironmentSetup = await getUserNeedsSetup(auth.user.id);

    return jsonResponse({
      user: {
        ...auth.user,
        needs_environment_setup: needsEnvironmentSetup,
      },
    });
  } catch (err) {
    if (err instanceof Response) return err;
    if (isDatabaseInfraError(err)) {
      console.error('Auth session GET unavailable due to database infrastructure error', err);
      return authServiceUnavailableResponse();
    }
    console.error('Auth session GET failed', err);
    return errorResponse('Internal server error', 500);
  }
};
