import { decrypt } from './crypto.js';
import { queryOne } from './db.js';

interface TokenInfo {
  token: string;
  expiresAt: number;
}

const tokenCacheMap = new Map<string, TokenInfo>();

export async function getAmapiToken(workspaceId: string): Promise<string> {
  const cached = tokenCacheMap.get(workspaceId);
  if (cached && cached.expiresAt > Date.now() + 60000) {
    return cached.token;
  }

  const workspace = await queryOne<{ google_credentials_enc: string }>(
    'SELECT google_credentials_enc FROM workspaces WHERE id = $1',
    [workspaceId]
  );

  if (!workspace?.google_credentials_enc) {
    throw new Error('No Google credentials configured for this workspace');
  }

  const credentialsJson = decrypt(workspace.google_credentials_enc, `workspace:${workspaceId}`);
  const credentials = JSON.parse(credentialsJson);

  const { GoogleAuth } = await import('google-auth-library');
  const auth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/androidmanagement'],
  });

  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();

  if (!tokenResponse.token) throw new Error('Failed to obtain AMAPI access token');

  tokenCacheMap.set(workspaceId, {
    token: tokenResponse.token,
    expiresAt: Date.now() + 55 * 60 * 1000,
  });

  return tokenResponse.token;
}

export function generateOAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/androidmanagement',
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}
