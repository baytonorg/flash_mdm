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
}

export function getAmapiErrorHttpStatus(err: unknown): number | null {
  if (!(err instanceof Error)) return null;
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

  let response = await fetch(url, fetchOptions);

  // Retry once on 503 (AMAPI rate limit)
  if (response.status === 503) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    response = await fetch(url, fetchOptions);
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
