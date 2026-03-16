import type { Context } from '@netlify/functions';
import { queryOne, execute } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { requireWorkspaceResourcePermission, requireEnvironmentResourcePermission } from './_lib/rbac.js';
import { generateToken, hashToken } from './_lib/crypto.js';
import { logAudit } from './_lib/audit.js';
import { jsonResponse, errorResponse, parseJsonBody, getClientIp, getSearchParams, isValidUuid } from './_lib/helpers.js';

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{2,99}$/;
const DOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const SIGNUP_LINK_PURPOSES = ['standard', 'customer'] as const;
type SignupLinkPurpose = typeof SIGNUP_LINK_PURPOSES[number];

function validateDomainList(domains: string[]): string | null {
  for (const domain of domains) {
    if (!DOMAIN_REGEX.test(domain)) {
      return domain;
    }
  }
  return null;
}

function normalizePurpose(value: string | null | undefined): SignupLinkPurpose | null {
  if (!value) return 'standard';
  const normalized = value.trim().toLowerCase();
  return SIGNUP_LINK_PURPOSES.includes(normalized as SignupLinkPurpose)
    ? (normalized as SignupLinkPurpose)
    : null;
}

function parseSignupLinkPathSegments(pathname: string): string[] {
  const basePath = '/api/signup-links';
  if (pathname === basePath || pathname === `${basePath}/`) return [];
  if (pathname.startsWith(`${basePath}/`)) {
    return pathname.slice(basePath.length + 1).split('/').filter(Boolean);
  }
  return [];
}

function validateUuidArray(values: string[]): boolean {
  return values.every(isValidUuid);
}

async function validateAutoAssignmentScope(
  scopeType: 'workspace' | 'environment',
  scopeId: string,
  autoAssignEnvironmentIds: string[],
  autoAssignGroupIds: string[]
): Promise<string | null> {
  if (!validateUuidArray(autoAssignEnvironmentIds)) {
    return 'auto_assign_environment_ids must contain valid UUIDs';
  }
  if (!validateUuidArray(autoAssignGroupIds)) {
    return 'auto_assign_group_ids must contain valid UUIDs';
  }

  if (scopeType === 'environment' && autoAssignEnvironmentIds.length > 0) {
    return 'auto_assign_environment_ids are only supported for workspace signup links';
  }

  if (scopeType === 'workspace' && autoAssignEnvironmentIds.length > 0) {
    const envCount = await queryOne<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM environments
       WHERE workspace_id = $1
         AND id = ANY($2::uuid[])`,
      [scopeId, autoAssignEnvironmentIds]
    );
    if (Number.parseInt(envCount?.count ?? '0', 10) !== autoAssignEnvironmentIds.length) {
      return 'One or more auto_assign_environment_ids are outside this workspace';
    }
  }

  if (scopeType === 'workspace' && autoAssignGroupIds.length > 0) {
    const groupCount = await queryOne<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM groups g
       JOIN environments e ON e.id = g.environment_id
       WHERE e.workspace_id = $1
         AND g.id = ANY($2::uuid[])`,
      [scopeId, autoAssignGroupIds]
    );
    if (Number.parseInt(groupCount?.count ?? '0', 10) !== autoAssignGroupIds.length) {
      return 'One or more auto_assign_group_ids are outside this workspace';
    }
  }

  if (scopeType === 'environment' && autoAssignGroupIds.length > 0) {
    const groupCount = await queryOne<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM groups
       WHERE environment_id = $1
         AND id = ANY($2::uuid[])`,
      [scopeId, autoAssignGroupIds]
    );
    if (Number.parseInt(groupCount?.count ?? '0', 10) !== autoAssignGroupIds.length) {
      return 'One or more auto_assign_group_ids are outside this environment';
    }
  }

  return null;
}

export default async (request: Request, _context: Context) => {
  try {
    const auth = await requireAuth(request);
    const url = new URL(request.url);
    const segments = parseSignupLinkPathSegments(url.pathname);

  // GET /api/signup-links?scope_type=...&scope_id=...
  if (request.method === 'GET') {
    const params = getSearchParams(request);
    const scopeType = params.get('scope_type');
    const scopeId = params.get('scope_id');
    const purpose = normalizePurpose(params.get('purpose'));
    if (!scopeType || !scopeId) {
      return errorResponse('scope_type and scope_id are required');
    }
    if (scopeType !== 'workspace' && scopeType !== 'environment') {
      return errorResponse('scope_type must be workspace or environment');
    }
    if (!purpose) {
      return errorResponse('purpose must be standard or customer');
    }

    // Auth check
    if (scopeType === 'workspace') {
      await requireWorkspaceResourcePermission(auth, scopeId, 'invite', 'read');
    } else {
      await requireEnvironmentResourcePermission(auth, scopeId, 'environment', 'manage_users');
    }

    const link = await queryOne(
      `SELECT id, scope_type, scope_id, purpose, slug, enabled, default_role, default_access_scope,
              auto_assign_environment_ids, auto_assign_group_ids,
              allow_environment_creation, allowed_domains, display_name, display_description,
              created_by, created_at, updated_at
       FROM signup_links
       WHERE scope_type = $1 AND scope_id = $2 AND purpose = $3`,
      [scopeType, scopeId, purpose]
    );

    return jsonResponse({ signup_link: link ?? null });
  }

  // POST /api/signup-links — create or regenerate
  if (request.method === 'POST') {
    const body = await parseJsonBody<{
      scope_type: string;
      scope_id: string;
      purpose?: string;
      slug?: string;
      default_role?: string;
      default_access_scope?: string;
      auto_assign_environment_ids?: string[];
      auto_assign_group_ids?: string[];
      allow_environment_creation?: boolean;
      allowed_domains?: string[];
      display_name?: string;
      display_description?: string;
    }>(request);

    const { scope_type, scope_id } = body;
    const purpose = normalizePurpose(body.purpose);
    if (!scope_type || !scope_id) {
      return errorResponse('scope_type and scope_id are required');
    }
    if (scope_type !== 'workspace' && scope_type !== 'environment') {
      return errorResponse('scope_type must be workspace or environment');
    }
    if (!purpose) {
      return errorResponse('purpose must be standard or customer');
    }
    if (purpose === 'customer' && scope_type !== 'workspace') {
      return errorResponse('customer purpose is only supported for workspace signup links');
    }

    // Auth check
    if (scope_type === 'workspace') {
      await requireWorkspaceResourcePermission(auth, scope_id, 'invite', 'write');
    } else {
      await requireEnvironmentResourcePermission(auth, scope_id, 'environment', 'manage_users');
    }

    // Validate slug
    const slug = body.slug?.trim().toLowerCase() || null;
    if (slug && !SLUG_REGEX.test(slug)) {
      return errorResponse('Slug must be 3-100 characters, lowercase alphanumeric and hyphens, starting with a letter or number');
    }
    if (slug) {
      const existing = await queryOne(
        `SELECT id FROM signup_links
         WHERE slug = $1
           AND NOT (scope_type = $2 AND scope_id = $3 AND purpose = $4)`,
        [slug, scope_type, scope_id, purpose]
      );
      if (existing) {
        return errorResponse('This slug is already in use');
      }
    }

    // Validate role
    const defaultRole = purpose === 'customer' ? 'viewer' : (body.default_role ?? 'viewer');
    if (defaultRole !== 'viewer' && defaultRole !== 'member' && defaultRole !== 'admin') {
      return errorResponse('default_role must be viewer, member, or admin');
    }

    // Validate access scope
    const defaultAccessScope = purpose === 'customer'
      ? 'scoped'
      : scope_type === 'environment'
        ? 'scoped'
        : (body.default_access_scope ?? 'workspace');
    if (defaultAccessScope !== 'workspace' && defaultAccessScope !== 'scoped') {
      return errorResponse('default_access_scope must be workspace or scoped');
    }

    const autoAssignEnvIds = purpose === 'customer'
      ? []
      : (Array.isArray(body.auto_assign_environment_ids) ? body.auto_assign_environment_ids : []);
    const autoAssignGroupIds = purpose === 'customer'
      ? []
      : (Array.isArray(body.auto_assign_group_ids) ? body.auto_assign_group_ids : []);
    const allowEnvCreation = purpose === 'customer'
      ? true
      : scope_type === 'workspace'
        ? (body.allow_environment_creation ?? false)
        : false;
    const allowedDomains = (body.allowed_domains ?? []).map((d) => d.trim().toLowerCase()).filter(Boolean);

    // Validate domain formats
    const invalidDomain = validateDomainList(allowedDomains);
    if (invalidDomain) {
      return errorResponse(`Invalid domain format: ${invalidDomain}`);
    }

    const assignmentScopeError = await validateAutoAssignmentScope(
      scope_type,
      scope_id,
      autoAssignEnvIds,
      autoAssignGroupIds
    );
    if (assignmentScopeError) {
      return errorResponse(assignmentScopeError);
    }

    // Validation: scoped workspace links without env creation need at least one env
    if (purpose === 'standard' && scope_type === 'workspace' && defaultAccessScope === 'scoped' && !allowEnvCreation && autoAssignEnvIds.length === 0) {
      return errorResponse('Scoped workspace links require at least one auto-assign environment when environment creation is disabled');
    }

    // Generate token
    const rawToken = generateToken();
    const tokenHash = hashToken(rawToken);

    // UPSERT
    await execute(
      `INSERT INTO signup_links (
        scope_type, scope_id, purpose, token_hash, slug, enabled,
        default_role, default_access_scope,
        auto_assign_environment_ids, auto_assign_group_ids,
        allow_environment_creation, allowed_domains, display_name, display_description,
        created_by
      ) VALUES ($1, $2, $3, $4, $5, true, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (scope_type, scope_id, purpose) DO UPDATE SET
        token_hash = EXCLUDED.token_hash,
        slug = EXCLUDED.slug,
        enabled = true,
        default_role = EXCLUDED.default_role,
        default_access_scope = EXCLUDED.default_access_scope,
        auto_assign_environment_ids = EXCLUDED.auto_assign_environment_ids,
        auto_assign_group_ids = EXCLUDED.auto_assign_group_ids,
        allow_environment_creation = EXCLUDED.allow_environment_creation,
        allowed_domains = EXCLUDED.allowed_domains,
        display_name = EXCLUDED.display_name,
        display_description = EXCLUDED.display_description,
        updated_at = now()`,
      [
        scope_type, scope_id, purpose, tokenHash, slug,
        defaultRole, defaultAccessScope,
        JSON.stringify(autoAssignEnvIds), JSON.stringify(autoAssignGroupIds),
        allowEnvCreation, allowedDomains, body.display_name?.trim() || null, body.display_description?.trim() || null,
        auth.user.id,
      ]
    );

    const created = await queryOne(
      `SELECT id, scope_type, scope_id, purpose, slug, enabled, default_role, default_access_scope,
              auto_assign_environment_ids, auto_assign_group_ids,
              allow_environment_creation, allowed_domains, display_name, display_description,
              created_by, created_at, updated_at
       FROM signup_links WHERE scope_type = $1 AND scope_id = $2 AND purpose = $3`,
      [scope_type, scope_id, purpose]
    );

    await logAudit({
      workspace_id: scope_type === 'workspace' ? scope_id : undefined,
      environment_id: scope_type === 'environment' ? scope_id : undefined,
      user_id: auth.user.id,
      action: 'signup_link.create',
      resource_type: 'signup_link',
      resource_id: (created as Record<string, unknown>)?.id as string,
      details: { scope_type, scope_id, purpose, slug },
      ip_address: getClientIp(request),
    });

    return jsonResponse({ signup_link: created, token: rawToken }, 201);
  }

  // PATCH /api/signup-links/:id
  if (request.method === 'PATCH') {
    const linkId = segments[0];
    if (!linkId) return errorResponse('Link ID is required');
    if (!isValidUuid(linkId)) return errorResponse('Link ID must be a valid UUID');

    const link = await queryOne<{
      id: string; scope_type: string; scope_id: string; purpose: SignupLinkPurpose;
    }>('SELECT id, scope_type, scope_id, purpose FROM signup_links WHERE id = $1', [linkId]);
    if (!link) return errorResponse('Signup link not found', 404);

    // Auth check
    if (link.scope_type === 'workspace') {
      await requireWorkspaceResourcePermission(auth, link.scope_id, 'invite', 'write');
    } else {
      await requireEnvironmentResourcePermission(auth, link.scope_id, 'environment', 'manage_users');
    }

    const body = await parseJsonBody<{
      slug?: string | null;
      enabled?: boolean;
      default_role?: string;
      default_access_scope?: string;
      auto_assign_environment_ids?: string[];
      auto_assign_group_ids?: string[];
      allow_environment_creation?: boolean;
      allowed_domains?: string[];
      display_name?: string | null;
      display_description?: string | null;
    }>(request);

    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    if (body.slug !== undefined) {
      const slug = body.slug?.trim().toLowerCase() || null;
      if (slug && !SLUG_REGEX.test(slug)) {
        return errorResponse('Slug must be 3-100 characters, lowercase alphanumeric and hyphens, starting with a letter or number');
      }
      if (slug) {
        const existing = await queryOne(
          'SELECT id FROM signup_links WHERE slug = $1 AND id != $2',
          [slug, linkId]
        );
        if (existing) return errorResponse('This slug is already in use');
      }
      updates.push(`slug = $${paramIdx++}`);
      values.push(slug);
    }

    if (body.enabled !== undefined) {
      updates.push(`enabled = $${paramIdx++}`);
      values.push(body.enabled);
    }

    if (body.default_role !== undefined) {
      if (link.purpose === 'customer') {
        return errorResponse('default_role cannot be changed for customer signup links');
      }
      if (body.default_role !== 'viewer' && body.default_role !== 'member' && body.default_role !== 'admin') {
        return errorResponse('default_role must be viewer, member, or admin');
      }
      updates.push(`default_role = $${paramIdx++}`);
      values.push(body.default_role);
    }

    if (body.default_access_scope !== undefined && link.scope_type === 'workspace') {
      if (link.purpose === 'customer') {
        return errorResponse('default_access_scope cannot be changed for customer signup links');
      }
      if (body.default_access_scope !== 'workspace' && body.default_access_scope !== 'scoped') {
        return errorResponse('default_access_scope must be workspace or scoped');
      }
      updates.push(`default_access_scope = $${paramIdx++}`);
      values.push(body.default_access_scope);
    }

    if (body.auto_assign_environment_ids !== undefined) {
      if (link.purpose === 'customer') {
        return errorResponse('auto_assign_environment_ids cannot be changed for customer signup links');
      }
      if (!Array.isArray(body.auto_assign_environment_ids)) {
        return errorResponse('auto_assign_environment_ids must be an array');
      }
      const assignmentScopeError = await validateAutoAssignmentScope(
        link.scope_type as 'workspace' | 'environment',
        link.scope_id,
        body.auto_assign_environment_ids,
        []
      );
      if (assignmentScopeError) {
        return errorResponse(assignmentScopeError);
      }
      updates.push(`auto_assign_environment_ids = $${paramIdx++}`);
      values.push(JSON.stringify(body.auto_assign_environment_ids));
    }

    if (body.auto_assign_group_ids !== undefined) {
      if (link.purpose === 'customer') {
        return errorResponse('auto_assign_group_ids cannot be changed for customer signup links');
      }
      if (!Array.isArray(body.auto_assign_group_ids)) {
        return errorResponse('auto_assign_group_ids must be an array');
      }
      const assignmentScopeError = await validateAutoAssignmentScope(
        link.scope_type as 'workspace' | 'environment',
        link.scope_id,
        [],
        body.auto_assign_group_ids
      );
      if (assignmentScopeError) {
        return errorResponse(assignmentScopeError);
      }
      updates.push(`auto_assign_group_ids = $${paramIdx++}`);
      values.push(JSON.stringify(body.auto_assign_group_ids));
    }

    if (body.allowed_domains !== undefined) {
      const cleaned = body.allowed_domains.map((d) => d.trim().toLowerCase()).filter(Boolean);
      const invalidDomain = validateDomainList(cleaned);
      if (invalidDomain) {
        return errorResponse(`Invalid domain format: ${invalidDomain}`);
      }
      updates.push(`allowed_domains = $${paramIdx++}`);
      values.push(cleaned);
    }

    if (body.allow_environment_creation !== undefined && link.scope_type === 'workspace') {
      if (link.purpose === 'customer') {
        return errorResponse('allow_environment_creation cannot be changed for customer signup links');
      }
      updates.push(`allow_environment_creation = $${paramIdx++}`);
      values.push(body.allow_environment_creation);
    }

    if (body.display_name !== undefined) {
      updates.push(`display_name = $${paramIdx++}`);
      values.push(body.display_name?.trim() || null);
    }

    if (body.display_description !== undefined) {
      updates.push(`display_description = $${paramIdx++}`);
      values.push(body.display_description?.trim() || null);
    }

    if (updates.length === 0) {
      return errorResponse('No fields to update');
    }

    updates.push(`updated_at = now()`);
    values.push(linkId);

    await execute(
      `UPDATE signup_links SET ${updates.join(', ')} WHERE id = $${paramIdx}`,
      values
    );

    const updated = await queryOne(
      `SELECT id, scope_type, scope_id, purpose, slug, enabled, default_role, default_access_scope,
              auto_assign_environment_ids, auto_assign_group_ids,
              allow_environment_creation, allowed_domains, display_name, display_description,
              created_by, created_at, updated_at
       FROM signup_links WHERE id = $1`,
      [linkId]
    );

    await logAudit({
      workspace_id: link.scope_type === 'workspace' ? link.scope_id : undefined,
      environment_id: link.scope_type === 'environment' ? link.scope_id : undefined,
      user_id: auth.user.id,
      action: 'signup_link.update',
      resource_type: 'signup_link',
      resource_id: linkId,
      details: { purpose: link.purpose, changes: Object.keys(body) },
      ip_address: getClientIp(request),
    });

    return jsonResponse({ signup_link: updated });
  }

  // DELETE /api/signup-links/:id
  if (request.method === 'DELETE') {
    const linkId = segments[0];
    if (!linkId) return errorResponse('Link ID is required');
    if (!isValidUuid(linkId)) return errorResponse('Link ID must be a valid UUID');

    const link = await queryOne<{
      id: string; scope_type: string; scope_id: string;
    }>('SELECT id, scope_type, scope_id FROM signup_links WHERE id = $1', [linkId]);
    if (!link) return errorResponse('Signup link not found', 404);

    // Auth check
    if (link.scope_type === 'workspace') {
      await requireWorkspaceResourcePermission(auth, link.scope_id, 'invite', 'delete');
    } else {
      await requireEnvironmentResourcePermission(auth, link.scope_id, 'environment', 'manage_users');
    }

    await execute('DELETE FROM signup_links WHERE id = $1', [linkId]);

    await logAudit({
      workspace_id: link.scope_type === 'workspace' ? link.scope_id : undefined,
      environment_id: link.scope_type === 'environment' ? link.scope_id : undefined,
      user_id: auth.user.id,
      action: 'signup_link.delete',
      resource_type: 'signup_link',
      resource_id: linkId,
      details: { scope_type: link.scope_type, scope_id: link.scope_id },
      ip_address: getClientIp(request),
    });

    return jsonResponse({ message: 'Signup link deleted' });
  }

    return errorResponse('Method not allowed', 405);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('signup-link-crud error:', err);
    return errorResponse('Internal server error', 500);
  }
};
