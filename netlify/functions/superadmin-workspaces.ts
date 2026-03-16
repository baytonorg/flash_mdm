import type { Context } from '@netlify/functions';
import { requireSuperadmin } from './_lib/auth.js';
import { query, queryOne } from './_lib/db.js';
import { jsonResponse, errorResponse, getSearchParams } from './_lib/helpers.js';

interface WorkspaceRow {
  id: string;
  name: string;
  created_at: string;
  stripe_customer_id: string | null;
  device_count: string;
  user_count: string;
  plan_name: string | null;
  license_status: string | null;
}

export default async function handler(request: Request, _context: Context) {
  if (request.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    await requireSuperadmin(request);
    const params = getSearchParams(request);
    const url = new URL(request.url);

    // Check if this is a detail request: /api/superadmin/workspaces/:id
    const pathParts = url.pathname.split('/').filter(Boolean);
    const workspaceId = pathParts.length >= 4 ? pathParts[3] : null;

    if (workspaceId && workspaceId !== 'workspaces') {
      return await getWorkspaceDetail(workspaceId);
    }

    // List workspaces
    const page = parseInt(params.get('page') ?? '1', 10);
    const perPage = Math.min(parseInt(params.get('per_page') ?? '20', 10), 100);
    const search = params.get('search') ?? '';
    const offset = (page - 1) * perPage;

    let whereClause = '';
    const queryParams: unknown[] = [];

    if (search) {
      queryParams.push(`%${search}%`);
      whereClause = `WHERE w.name ILIKE $${queryParams.length}`;
    }

    const countRow = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM workspaces w ${whereClause}`,
      queryParams
    );
    const total = parseInt(countRow?.count ?? '0', 10);

    queryParams.push(perPage, offset);
    const workspaces = await query<WorkspaceRow>(
      `SELECT w.id, w.name, w.created_at, w.stripe_customer_id,
              COALESCE(dc.device_count, 0) as device_count,
              COALESCE(uc.user_count, 0) as user_count,
              lp.name as plan_name,
              l.status as license_status
       FROM workspaces w
       LEFT JOIN (
         SELECT e.workspace_id, COUNT(d.id) as device_count
         FROM environments e
         LEFT JOIN devices d ON d.environment_id = e.id
         GROUP BY e.workspace_id
       ) dc ON dc.workspace_id = w.id
       LEFT JOIN (
         SELECT workspace_id, COUNT(*) as user_count
         FROM workspace_memberships
         GROUP BY workspace_id
       ) uc ON uc.workspace_id = w.id
       LEFT JOIN LATERAL (
         SELECT plan_id, status FROM licenses WHERE workspace_id = w.id ORDER BY created_at DESC LIMIT 1
       ) l ON true
       LEFT JOIN license_plans lp ON lp.id = l.plan_id
       ${whereClause}
       ORDER BY w.created_at DESC
       LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}`,
      queryParams
    );

    return jsonResponse({
      workspaces: workspaces.map((w) => ({
        ...w,
        device_count: parseInt(String(w.device_count), 10),
        user_count: parseInt(String(w.user_count), 10),
      })),
      total,
      page,
      per_page: perPage,
    });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('Superadmin workspaces error:', err);
    return errorResponse('Internal server error', 500);
  }
}

async function getWorkspaceDetail(workspaceId: string): Promise<Response> {
  let workspace: {
    id: string; name: string; created_at: string;
    stripe_customer_id: string | null; disabled: boolean;
  } | null = null;

  try {
    workspace = await queryOne<{
      id: string; name: string; created_at: string;
      stripe_customer_id: string | null; disabled: boolean;
    }>(
      `SELECT id, name, created_at, stripe_customer_id, COALESCE(disabled, false) as disabled
       FROM workspaces WHERE id = $1`,
      [workspaceId]
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('column "disabled" does not exist')) {
      const legacyWorkspace = await queryOne<{
        id: string; name: string; created_at: string; stripe_customer_id: string | null;
      }>(
        `SELECT id, name, created_at, stripe_customer_id
         FROM workspaces WHERE id = $1`,
        [workspaceId]
      );
      workspace = legacyWorkspace ? { ...legacyWorkspace, disabled: false } : null;
    } else {
      throw err;
    }
  }

  if (!workspace) {
    return errorResponse('Workspace not found', 404);
  }

  const environments = await query<{
    id: string; name: string; enterprise_name: string | null; created_at: string;
  }>(
    `SELECT id, name, enterprise_name, created_at FROM environments WHERE workspace_id = $1 ORDER BY created_at`,
    [workspaceId]
  );

  const users = await query<{
    id: string; email: string; first_name: string | null; last_name: string | null; role: string; is_superadmin: boolean;
  }>(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.is_superadmin, wm.role
     FROM workspace_memberships wm
     JOIN users u ON u.id = wm.user_id
     WHERE wm.workspace_id = $1
     ORDER BY u.email`,
    [workspaceId]
  );

  const license = await queryOne<{
    id: string; plan_id: string; status: string; plan_name: string;
    max_devices: number; current_period_end: string | null; stripe_subscription_id: string | null;
  }>(
    `SELECT l.id, l.plan_id, l.status, lp.name as plan_name, lp.max_devices, l.current_period_end,
            l.stripe_subscription_id
     FROM licenses l
     JOIN license_plans lp ON lp.id = l.plan_id
     WHERE l.workspace_id = $1
     ORDER BY l.created_at DESC LIMIT 1`,
    [workspaceId]
  );

  const supportSessions = await query<{
    id: string;
    user_id: string;
    target_email: string | null;
    impersonated_by: string | null;
    by_email: string | null;
    impersonation_mode: string | null;
    support_reason: string | null;
    support_ticket_ref: string | null;
    customer_notice_acknowledged_at: string | null;
    created_at: string;
    expires_at: string;
  }>(
    `SELECT s.id, s.user_id, tu.email as target_email,
            s.impersonated_by, iu.email as by_email,
            s.impersonation_mode, s.support_reason, s.support_ticket_ref, s.customer_notice_acknowledged_at,
            s.created_at, s.expires_at
     FROM sessions s
     LEFT JOIN users tu ON tu.id = s.user_id
     LEFT JOIN users iu ON iu.id = s.impersonated_by
     WHERE s.workspace_id = $1 AND s.impersonated_by IS NOT NULL
     ORDER BY s.created_at DESC
     LIMIT 20`,
    [workspaceId]
  );

  const supportAudit = await query<{
    id: string;
    action: string;
    created_at: string;
    ip_address: string | null;
    details: Record<string, unknown>;
    actor_email: string | null;
  }>(
    `SELECT a.id, a.action, a.created_at, a.ip_address, a.details,
            u.email as actor_email
     FROM audit_log a
     LEFT JOIN users u ON u.id = a.user_id
     WHERE a.workspace_id = $1
       AND a.action LIKE 'superadmin.impersonate%'
     ORDER BY a.created_at DESC
     LIMIT 20`,
    [workspaceId]
  );

  return jsonResponse({
    workspace,
    environments,
    users,
    license,
    support_sessions: supportSessions.map((s) => ({
      ...s,
      active: new Date(s.expires_at).getTime() > Date.now(),
    })),
    support_audit: supportAudit,
  });
}
