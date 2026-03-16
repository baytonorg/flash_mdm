import type { Context } from '@netlify/functions';
import { queryOne } from './_lib/db.js';
import { hashToken } from './_lib/crypto.js';
import { consumeToken } from './_lib/rate-limiter.js';
import { jsonResponse, errorResponse, getClientIp } from './_lib/helpers.js';

export default async (request: Request, _context: Context) => {
  if (request.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  // Rate limit: 30 req/min per IP
  const ip = getClientIp(request);
  const limit = await consumeToken(`signup-link:resolve:ip:${ip}`, 1, 30, 0.5);
  if (!limit.allowed) {
    return errorResponse('Too many requests. Please try again later.', 429);
  }

  const url = new URL(request.url);
  const slugOrToken = url.pathname.replace('/api/signup-links/resolve/', '').split('/').filter(Boolean)[0];

  if (!slugOrToken) {
    return errorResponse('Slug or token is required');
  }

  // Try slug lookup first
  let link = await queryOne<{
    id: string;
    scope_type: string;
    scope_id: string;
    display_name: string | null;
    display_description: string | null;
    default_role: string;
    allow_environment_creation: boolean;
    allowed_domains: string[];
  }>(
    `SELECT id, scope_type, scope_id, display_name, display_description, default_role,
            allow_environment_creation, allowed_domains
     FROM signup_links
     WHERE slug = $1 AND enabled = true
     ORDER BY updated_at DESC NULLS LAST, created_at DESC
     LIMIT 1`,
    [slugOrToken.toLowerCase()]
  );

  // Try token hash lookup
  if (!link) {
    const tokenHash = hashToken(slugOrToken);
    link = await queryOne(
      `SELECT id, scope_type, scope_id, display_name, display_description, default_role,
              allow_environment_creation, allowed_domains
       FROM signup_links
       WHERE token_hash = $1 AND enabled = true`,
      [tokenHash]
    );
  }

  if (!link) {
    return errorResponse('Signup link not found or has been disabled', 404);
  }

  // Look up scope names
  let workspaceName: string | null = null;
  let environmentName: string | null = null;

  if (link.scope_type === 'workspace') {
    const ws = await queryOne<{ name: string }>(
      'SELECT name FROM workspaces WHERE id = $1',
      [link.scope_id]
    );
    workspaceName = ws?.name ?? null;
  } else {
    const env = await queryOne<{ name: string; workspace_id: string }>(
      'SELECT name, workspace_id FROM environments WHERE id = $1',
      [link.scope_id]
    );
    environmentName = env?.name ?? null;
    if (env) {
      const ws = await queryOne<{ name: string }>(
        'SELECT name FROM workspaces WHERE id = $1',
        [env.workspace_id]
      );
      workspaceName = ws?.name ?? null;
    }
  }

  return jsonResponse({
    scope_type: link.scope_type,
    display_name: link.display_name,
    display_description: link.display_description,
    workspace_name: workspaceName,
    environment_name: environmentName,
    default_role: link.default_role,
    allow_environment_creation: link.allow_environment_creation,
    allowed_domains: link.allowed_domains ?? [],
  });
};
