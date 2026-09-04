export function isMissingRelationError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === '42P01'
  );
}

const DATABASE_INFRASTRUCTURE_CODES = new Set([
  // PostgreSQL connection exception class and startup/shutdown states.
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '08007',
  '08P01',
  '53300',
  '53400',
  '57P01',
  '57P02',
  '57P03',
  // Common Node/network errors surfaced by pg before a SQLSTATE is available.
  'ECONNREFUSED',
  'ECONNRESET',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'ETIMEDOUT',
]);

const DATABASE_INFRASTRUCTURE_MESSAGES = [
  'database system is starting up',
  'database system is shutting down',
  'exceeded the compute time quota',
  'terminating connection due to administrator command',
];

const TAGGED_DATABASE_NETWORK_MESSAGES = [
  'connection refused',
  'connection terminated',
  'connection timeout',
  'connect etimedout',
  'server closed the connection unexpectedly',
  'timeout expired',
  'too many clients',
  'too many connections',
];

const DATABASE_ERROR_SOURCE = Symbol('flash-database-error-source');

type ErrorLike = {
  code?: unknown;
  message?: unknown;
  cause?: unknown;
  [DATABASE_ERROR_SOURCE]?: true;
};

/** Tags an error at the database boundary so generic network codes stay scoped. */
export function markDatabaseError(err: unknown): ErrorLike {
  const error: ErrorLike = err && typeof err === 'object'
    ? err as ErrorLike
    : new Error(String(err));
  try {
    Object.defineProperty(error, DATABASE_ERROR_SOURCE, {
      value: true,
      configurable: true,
    });
    return error;
  } catch {
    const wrapped = new Error(String(error.message ?? err), { cause: error }) as ErrorLike;
    Object.defineProperty(wrapped, DATABASE_ERROR_SOURCE, { value: true });
    return wrapped;
  }
}

/**
 * Identifies PostgreSQL availability failures without treating ordinary query,
 * constraint, or application errors as safely retryable infrastructure faults.
 */
export function isDatabaseInfrastructureError(err: unknown): boolean {
  let current = err;
  const visited = new Set<unknown>();

  for (let depth = 0; depth < 4; depth += 1) {
    if (!current || typeof current !== 'object' || visited.has(current)) return false;
    visited.add(current);

    const error = current as ErrorLike;
    const code = String(error.code ?? '').toUpperCase();
    const taggedDatabaseError = error[DATABASE_ERROR_SOURCE] === true;
    if (code.startsWith('08')) return true;
    if (DATABASE_INFRASTRUCTURE_CODES.has(code) && (
      !code.startsWith('E') || taggedDatabaseError
    )) return true;

    const message = String(error.message ?? '').toLowerCase();
    if (DATABASE_INFRASTRUCTURE_MESSAGES.some((candidate) => message.includes(candidate))) {
      return true;
    }
    if (taggedDatabaseError && TAGGED_DATABASE_NETWORK_MESSAGES.some(
      (candidate) => message.includes(candidate)
    )) return true;

    current = error.cause;
  }

  return false;
}

export const DATABASE_RETRY_AFTER_SECONDS = 5;

export function databaseUnavailableResponse(
  retryAfterSeconds = DATABASE_RETRY_AFTER_SECONDS
): Response {
  const boundedRetryAfter = Math.max(1, Math.min(300, Math.ceil(retryAfterSeconds)));
  return Response.json(
    {
      error: 'Database temporarily unavailable. Please retry shortly.',
      code: 'DATABASE_UNAVAILABLE',
    },
    {
      status: 503,
      headers: {
        'Retry-After': String(boundedRetryAfter),
        'X-Flash-Degraded': 'database',
      },
    }
  );
}
