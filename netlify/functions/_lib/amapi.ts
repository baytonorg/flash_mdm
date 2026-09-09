import { checkAmapiRateLimit } from './rate-limiter.js';
import { decrypt } from './crypto.js';
import { queryOne } from './db.js';

interface AmapiCallOptions {
  method?: string;
  body?: unknown;
  projectId: string;
  enterpriseName?: string;
  resourceType?: string;
  resourceId?: string;
  retryMode?: 'safe' | 'never';
}

const TRANSIENT_AMAPI_STATUSES = new Set([502, 503, 504]);
const SAFE_RETRY_ATTEMPTS = 3;
const SAFE_RETRY_MAX_DELAY_MS = 5_000;

export class AmapiDeliveryUncertainError extends Error {
  readonly code = 'AMAPI_DELIVERY_UNCERTAIN';

  constructor(message: string, readonly status: number | null = null) {
    super(message);
    this.name = 'AmapiDeliveryUncertainError';
  }
}

export function isAmapiDeliveryUncertainError(err: unknown): err is AmapiDeliveryUncertainError {
  return err instanceof AmapiDeliveryUncertainError
    || (
      err instanceof Error
      && (err as Error & { code?: string }).code === 'AMAPI_DELIVERY_UNCERTAIN'
    );
}

export function getAmapiErrorHttpStatus(err: unknown): number | null {
  if (!(err instanceof Error)) return null;
  if (isAmapiDeliveryUncertainError(err)) return err.status;
  const status = /^AMAPI error \((\d{3})\):/.exec(err.message)?.[1];
  if (!status) return null;
  const parsed = Number(status);
  return Number.isFinite(parsed) ? parsed : null;
}

// Per-workspace token cache (not a single global slot)
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function getAccessToken(workspaceId: string): Promise<string> {
  // Check cache for this workspace
  const cached = tokenCache.get(workspaceId);
  if (cached && cached.expiresAt > Date.now() + 60000) {
    return cached.token;
  }

  const workspace = await queryOne<{ google_credentials_enc: string; google_auth_mode: string }>(
    'SELECT google_credentials_enc, google_auth_mode FROM workspaces WHERE id = $1',
    [workspaceId]
  );

  if (!workspace?.google_credentials_enc) {
    throw new Error('No Google credentials configured for this workspace. Upload a service account JSON in Settings.');
  }

  let credentialsJson: string;
  try {
    credentialsJson = decrypt(workspace.google_credentials_enc, `workspace:${workspaceId}`);
  } catch (err) {
    throw new Error(`Failed to decrypt workspace credentials: ${err instanceof Error ? err.message : String(err)}`);
  }

  let credentials: Record<string, unknown>;
  try {
    credentials = JSON.parse(credentialsJson);
  } catch {
    throw new Error('Stored credentials are not valid JSON. Re-upload the service account key.');
  }

  // Use google-auth-library to mint token from service account
  const { GoogleAuth } = await import('google-auth-library');
  const auth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/androidmanagement'],
  });

  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();

  if (!tokenResponse.token) throw new Error('Failed to obtain access token from Google. Check your service account permissions.');

  tokenCache.set(workspaceId, {
    token: tokenResponse.token,
    expiresAt: Date.now() + 55 * 60 * 1000, // ~55 minutes
  });

  return tokenResponse.token;
}

export async function amapiCall<T = unknown>(
  path: string,
  workspaceId: string,
  options: AmapiCallOptions
): Promise<T> {
  const { method = 'GET', body, projectId, enterpriseName, resourceType = 'general', resourceId } = options;
  const normalizedMethod = method.toUpperCase();
  const retrySafe = options.retryMode === 'safe'
    || (options.retryMode === undefined && (normalizedMethod === 'GET' || normalizedMethod === 'HEAD'));
  const maxAttempts = retrySafe ? SAFE_RETRY_ATTEMPTS : 1;

  // Rate limit check (only when we have an enterprise context)
  if (enterpriseName) {
    const rlResult = await checkAmapiRateLimit(projectId, enterpriseName, resourceType, resourceId);
    if (!rlResult.allowed) {
      const waitMs = rlResult.retryAfterMs ?? 1000;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      const retry = await checkAmapiRateLimit(projectId, enterpriseName, resourceType, resourceId);
      if (!retry.allowed) {
        throw new Error(`AMAPI rate limit exceeded. Retry after ${retry.retryAfterMs}ms`);
      }
    }
  }

  const token = await getAccessToken(workspaceId);
  const url = `https://androidmanagement.googleapis.com/v1/${path}`;

  const fetchOptions: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  };

  let response: Response | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      response = await fetch(url, fetchOptions);
    } catch (err) {
      if (retrySafe && attempt + 1 < maxAttempts) {
        await sleepBeforeSafeRetry(attempt);
        continue;
      }
      if (!retrySafe && normalizedMethod !== 'GET' && normalizedMethod !== 'HEAD') {
        throw new AmapiDeliveryUncertainError(
          'AMAPI request delivery is uncertain after a transport failure'
        );
      }
      throw new Error(`AMAPI transport error: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (
      TRANSIENT_AMAPI_STATUSES.has(response.status)
      && retrySafe
      && attempt + 1 < maxAttempts
    ) {
      await sleepBeforeSafeRetry(attempt);
      continue;
    }

    break;
  }

  if (!response) throw new Error('AMAPI request failed without a response');

  if (
    TRANSIENT_AMAPI_STATUSES.has(response.status)
    && !retrySafe
    && normalizedMethod !== 'GET'
    && normalizedMethod !== 'HEAD'
  ) {
    throw new AmapiDeliveryUncertainError(
      `AMAPI request delivery is uncertain after transient HTTP ${response.status}`,
      response.status
    );
  }

  if (!response.ok) {
    const errorText = await response.text();
    // Try to extract a useful message from the Google API error
    let message = `AMAPI ${response.status}`;
    try {
      const parsed = JSON.parse(errorText);
      message = parsed.error?.message ?? parsed.error?.status ?? message;
    } catch {
      message = errorText || message;
    }
    throw new Error(`AMAPI error (${response.status}): ${message}`);
  }

  if (response.status === 204) return {} as T;
  return response.json() as Promise<T>;
}

async function sleepBeforeSafeRetry(attempt: number): Promise<void> {
  const exponentialDelay = Math.min(
    SAFE_RETRY_MAX_DELAY_MS,
    500 * Math.pow(2, attempt)
  );
  const jitter = Math.floor(Math.random() * 250);
  await new Promise((resolve) => setTimeout(resolve, exponentialDelay + jitter));
}
