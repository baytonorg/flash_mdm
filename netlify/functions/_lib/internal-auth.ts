import { timingSafeEqual } from 'node:crypto';

function unauthorized(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Internal caller verification for background and scheduled functions.
 *
 * Prevents external/unauthorized invocation of functions that should only
 * be triggered by Netlify's scheduler or by other internal functions.
 *
 * Set the INTERNAL_FUNCTION_SECRET environment variable to a strong random value.
 */
export function requireInternalCaller(request: Request): void {
  const configuredSecret = process.env.INTERNAL_FUNCTION_SECRET;
  const internalSecret = request.headers.get('x-internal-secret');

  if (!configuredSecret) {
    const requestHost = (() => {
      try {
        return new URL(request.url).hostname.toLowerCase();
      } catch {
        return '';
      }
    })();
    const isLocalRequest =
      requestHost === 'localhost' ||
      requestHost === '127.0.0.1' ||
      requestHost === '::1' ||
      requestHost === '[::1]';
    const isDevRuntime = process.env.NODE_ENV === 'test' || process.env.NETLIFY_DEV === 'true';

    if (isLocalRequest || isDevRuntime) {
      console.warn('INTERNAL_FUNCTION_SECRET is not configured; allowing internal function call in local/dev runtime');
      return;
    }

    throw unauthorized('Unauthorized: INTERNAL_FUNCTION_SECRET is not configured');
  }

  if (internalSecret) {
    const provided = Buffer.from(internalSecret, 'utf8');
    const expected = Buffer.from(configuredSecret, 'utf8');
    if (provided.length === expected.length && timingSafeEqual(provided, expected)) return;
  }

  throw unauthorized('Unauthorized: not an internal caller');
}
