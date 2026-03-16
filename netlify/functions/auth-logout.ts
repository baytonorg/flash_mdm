import type { Context } from '@netlify/functions';
import { execute } from './_lib/db.js';
import { getSessionTokenFromCookie, clearSessionCookie } from './_lib/auth.js';
import { hashToken } from './_lib/crypto.js';
import { assertSameOriginRequest, jsonResponse, errorResponse } from './_lib/helpers.js';

export default async (request: Request, context: Context) => {
  void context;
  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  const origin = request.headers.get('origin');
  if (!origin) {
    return errorResponse('Missing required Origin header', 403);
  }

  try {
    assertSameOriginRequest(request);
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }

  const xrw = request.headers.get('x-requested-with');
  if (xrw !== 'XMLHttpRequest') {
    return errorResponse('Missing required X-Requested-With header', 403);
  }

  const sessionToken = getSessionTokenFromCookie(request);
  if (sessionToken) {
    const sessionTokenHash = hashToken(sessionToken);
    await execute('DELETE FROM sessions WHERE token_hash = $1', [sessionTokenHash]);
  }

  return jsonResponse(
    { message: 'Logged out' },
    200,
    { 'Set-Cookie': clearSessionCookie() }
  );
};
