import type { Context } from '@netlify/functions';
import { validateSession, requireSessionAuth } from './_lib/auth.js';
import { queryOne, execute } from './_lib/db.js';
import { isDatabaseInfrastructureError } from './_lib/db-errors.js';
import { jsonResponse, errorResponse, parseJsonBody } from './_lib/helpers.js';

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
      if (isDatabaseInfrastructureError(err)) {
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
    if (isDatabaseInfrastructureError(err)) {
      console.error('Auth session GET unavailable due to database infrastructure error', err);
      return authServiceUnavailableResponse();
    }
    console.error('Auth session GET failed', err);
    return errorResponse('Internal server error', 500);
  }
};
