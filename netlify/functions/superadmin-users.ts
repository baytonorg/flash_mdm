import type { Context } from '@netlify/functions';
import { requireSuperadmin } from './_lib/auth.js';
import { query, queryOne } from './_lib/db.js';
import { jsonResponse, errorResponse, getSearchParams } from './_lib/helpers.js';

interface UserRow {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  is_superadmin: boolean;
  totp_enabled: boolean;
  created_at: string;
  last_login_at: string | null;
  last_login_method: string | null;
  workspace_count: string | number;
  workspaces: Array<{
    id: string;
    name: string;
    role: string;
    access_scope?: 'workspace' | 'scoped';
    environment_count?: number | string;
    group_count?: number | string;
  }> | null;
}

export default async function handler(request: Request, _context: Context) {
  if (request.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    await requireSuperadmin(request);
    const params = getSearchParams(request);
    const page = Math.max(parseInt(params.get('page') ?? '1', 10), 1);
    const perPage = Math.min(Math.max(parseInt(params.get('per_page') ?? '25', 10), 1), 100);
    const search = (params.get('search') ?? '').trim();
    const offset = (page - 1) * perPage;

    const whereParts: string[] = [];
    const countParams: unknown[] = [];

    if (search) {
      countParams.push(`%${search}%`);
      const p = `$${countParams.length}`;
      whereParts.push(`(u.email ILIKE ${p} OR COALESCE(u.first_name, '') ILIKE ${p} OR COALESCE(u.last_name, '') ILIKE ${p})`);
    }

    const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

    const countRow = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM users u
       ${whereClause}`,
      countParams
    );

    const listParams = [...countParams, perPage, offset];
    let users: UserRow[];
    try {
      users = await query<UserRow>(
        `SELECT u.id, u.email, u.first_name, u.last_name, u.is_superadmin, u.totp_enabled,
                u.created_at, u.last_login_at, u.last_login_method,
                COALESCE((
                  SELECT COUNT(*)
                  FROM workspace_memberships wm
                  WHERE wm.user_id = u.id
                ), 0) as workspace_count,
                COALESCE((
                  SELECT json_agg(ws_row ORDER BY ws_row.name)
                  FROM (
                    SELECT w.id, w.name, wm.role, COALESCE(wm.access_scope, 'workspace') as access_scope,
                           (
                             SELECT COUNT(*)
                             FROM environment_memberships em
                             JOIN environments e ON e.id = em.environment_id
                             WHERE em.user_id = u.id AND e.workspace_id = w.id
                           ) as environment_count,
                           (
                             SELECT COUNT(*)
                             FROM group_memberships gm
                             JOIN groups g ON g.id = gm.group_id
                             JOIN environments e2 ON e2.id = g.environment_id
                             WHERE gm.user_id = u.id AND e2.workspace_id = w.id
                           ) as group_count
                    FROM workspace_memberships wm
                    JOIN workspaces w ON w.id = wm.workspace_id
                    WHERE wm.user_id = u.id
                  ) ws_row
                ), '[]'::json) as workspaces
         FROM users u
         ${whereClause}
         ORDER BY u.is_superadmin DESC, u.email ASC
         LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
        listParams
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes('column wm.access_scope does not exist')) throw err;
      users = await query<UserRow>(
        `SELECT u.id, u.email, u.first_name, u.last_name, u.is_superadmin, u.totp_enabled,
                u.created_at, u.last_login_at, u.last_login_method,
                COALESCE((
                  SELECT COUNT(*)
                  FROM workspace_memberships wm
                  WHERE wm.user_id = u.id
                ), 0) as workspace_count,
                COALESCE((
                  SELECT json_agg(ws_row ORDER BY ws_row.name)
                  FROM (
                    SELECT w.id, w.name, wm.role, 'workspace'::text as access_scope,
                           0::int as environment_count,
                           0::int as group_count
                    FROM workspace_memberships wm
                    JOIN workspaces w ON w.id = wm.workspace_id
                    WHERE wm.user_id = u.id
                  ) ws_row
                ), '[]'::json) as workspaces
         FROM users u
         ${whereClause}
         ORDER BY u.is_superadmin DESC, u.email ASC
         LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
        listParams
      );
    }

    return jsonResponse({
      users: users.map((u) => ({
        ...u,
        workspace_count: parseInt(String(u.workspace_count), 10),
        workspaces: Array.isArray(u.workspaces)
          ? u.workspaces.map((ws) => ({
              ...ws,
              access_scope: (ws.access_scope ?? 'workspace') as 'workspace' | 'scoped',
              environment_count: parseInt(String(ws.environment_count ?? 0), 10),
              group_count: parseInt(String(ws.group_count ?? 0), 10),
            }))
          : [],
      })),
      total: parseInt(countRow?.count ?? '0', 10),
      page,
      per_page: perPage,
    });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('Superadmin users error:', err);
    return errorResponse('Internal server error', 500);
  }
}
