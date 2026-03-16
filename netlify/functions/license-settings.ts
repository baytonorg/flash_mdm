import type { Context } from '@netlify/functions';
import { execute, queryOne } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { requireEnvironmentPermission, requireWorkspaceResourcePermission, requireWorkspaceRole } from './_lib/rbac.js';
import { getSearchParams, jsonResponse, errorResponse, parseJsonBody, isValidUuid, getClientIp } from './_lib/helpers.js';
import { getWorkspaceLicensingSettings } from './_lib/licensing.js';
import { logAudit } from './_lib/audit.js';

interface UpdateWorkspaceLicensingBody {
  workspace_id: string;
  licensing_enabled?: boolean;
  inherit_platform_free_tier?: boolean;
  free_enabled?: boolean;
  free_seat_limit?: number;
  billing_method?: 'stripe' | 'invoice' | 'disabled';
  grace_day_block?: number;
  grace_day_disable?: number;
  grace_day_wipe?: number;
}

const DEFAULT_BILLING_METHOD: 'stripe' | 'invoice' | 'disabled' = 'stripe';
const DEFAULT_GRACE_BLOCK = 10;
const DEFAULT_GRACE_DISABLE = 30;
const DEFAULT_GRACE_WIPE = 45;

export default async function handler(request: Request, _context: Context) {
  try {
    const auth = await requireAuth(request);

    if (request.method === 'GET') {
      const params = getSearchParams(request);
      const workspaceId = params.get('workspace_id')
        ?? (auth.authType === 'api_key' ? auth.apiKey?.workspace_id ?? null : auth.user.workspace_id);
      if (!workspaceId) return errorResponse('workspace_id is required');
      if (!isValidUuid(workspaceId)) return errorResponse('workspace_id must be a valid UUID');

      try {
        await requireWorkspaceResourcePermission(auth, workspaceId, 'workspace', 'read');
      } catch (err) {
        if (!(err instanceof Response) || err.status !== 403 || auth.authType !== 'session') throw err;
        // Scoped users: accept environment_id from query params or session context
        const activeEnvironmentId = params.get('environment_id') ?? auth.user.environment_id;
        if (!activeEnvironmentId) throw err;
        if (!isValidUuid(activeEnvironmentId)) throw err;
        const matchingEnvironment = await queryOne<{ id: string }>(
          'SELECT id FROM environments WHERE id = $1 AND workspace_id = $2',
          [activeEnvironmentId, workspaceId]
        );
        if (!matchingEnvironment) throw err;
        await requireEnvironmentPermission(auth, activeEnvironmentId, 'read');
      }
      const settings = await getWorkspaceLicensingSettings(workspaceId);
      return jsonResponse({ workspace_id: workspaceId, settings });
    }

    if (request.method === 'PUT') {
      if (auth.authType === 'api_key') {
        return errorResponse('API keys cannot update license settings', 403);
      }

      const body = await parseJsonBody<UpdateWorkspaceLicensingBody>(request);
      if (!body.workspace_id || !isValidUuid(body.workspace_id)) {
        return errorResponse('workspace_id must be a valid UUID');
      }

      await requireWorkspaceRole(auth, body.workspace_id, 'admin');

      let existing: {
        licensing_enabled?: boolean;
        inherit_platform_free_tier?: boolean;
        free_enabled?: boolean;
        free_seat_limit?: number;
        billing_method?: 'stripe' | 'invoice' | 'disabled';
        customer_owner_enabled?: boolean;
        grace_day_block?: number;
        grace_day_disable?: number;
        grace_day_wipe?: number;
      } | null = null;
      try {
        existing = await queryOne<{
          licensing_enabled: boolean;
          inherit_platform_free_tier: boolean;
          free_enabled: boolean;
          free_seat_limit: number;
          billing_method: 'stripe' | 'invoice' | 'disabled';
          customer_owner_enabled: boolean;
          grace_day_block: number;
          grace_day_disable: number;
          grace_day_wipe: number;
        }>(
          `SELECT licensing_enabled, inherit_platform_free_tier, free_enabled, free_seat_limit, billing_method,
                  customer_owner_enabled, grace_day_block, grace_day_disable, grace_day_wipe
           FROM workspace_licensing_settings
           WHERE workspace_id = $1`,
          [body.workspace_id]
        );
      } catch (err) {
        const code = typeof err === 'object' && err !== null && 'code' in err ? (err as { code?: string }).code : undefined;
        if (code !== '42703') throw err;
        try {
          existing = await queryOne<{
            inherit_platform_free_tier: boolean;
            free_enabled: boolean;
            free_seat_limit: number;
            billing_method: 'stripe' | 'invoice' | 'disabled';
            customer_owner_enabled: boolean;
            grace_day_block: number;
            grace_day_disable: number;
            grace_day_wipe: number;
          }>(
            `SELECT inherit_platform_free_tier, free_enabled, free_seat_limit, billing_method,
                    customer_owner_enabled, grace_day_block, grace_day_disable, grace_day_wipe
             FROM workspace_licensing_settings
             WHERE workspace_id = $1`,
            [body.workspace_id]
          );
        } catch (legacyErr) {
          const legacyCode = typeof legacyErr === 'object' && legacyErr !== null && 'code' in legacyErr
            ? (legacyErr as { code?: string }).code
            : undefined;
          if (legacyCode !== '42703') throw legacyErr;
          existing = await queryOne<{
            free_enabled: boolean;
            free_seat_limit: number;
            billing_method: 'stripe' | 'invoice' | 'disabled';
            customer_owner_enabled: boolean;
            grace_day_block: number;
            grace_day_disable: number;
            grace_day_wipe: number;
          }>(
            `SELECT free_enabled, free_seat_limit, billing_method,
                    customer_owner_enabled, grace_day_block, grace_day_disable, grace_day_wipe
             FROM workspace_licensing_settings
             WHERE workspace_id = $1`,
            [body.workspace_id]
          );
        }
      }

      const resolved = await getWorkspaceLicensingSettings(body.workspace_id);

      const licensingEnabled = body.licensing_enabled ?? existing?.licensing_enabled ?? resolved.workspace_licensing_enabled;
      const inheritPlatform = body.inherit_platform_free_tier ?? existing?.inherit_platform_free_tier ?? true;
      const freeEnabled = body.free_enabled ?? existing?.free_enabled ?? resolved.workspace_free_enabled;
      const freeSeatLimit = body.free_seat_limit ?? existing?.free_seat_limit ?? resolved.workspace_free_seat_limit;
      const billingMethod = body.billing_method ?? existing?.billing_method ?? DEFAULT_BILLING_METHOD;
      const customerOwnerEnabled = existing?.customer_owner_enabled ?? false;
      const graceDayBlock = body.grace_day_block ?? existing?.grace_day_block ?? DEFAULT_GRACE_BLOCK;
      const graceDayDisable = body.grace_day_disable ?? existing?.grace_day_disable ?? DEFAULT_GRACE_DISABLE;
      const graceDayWipe = body.grace_day_wipe ?? existing?.grace_day_wipe ?? DEFAULT_GRACE_WIPE;

      if (!Number.isInteger(freeSeatLimit) || freeSeatLimit < 0 || freeSeatLimit > 1_000_000) {
        return errorResponse('free_seat_limit must be an integer between 0 and 1000000');
      }
      if (![graceDayBlock, graceDayDisable, graceDayWipe].every(Number.isInteger)) {
        return errorResponse('grace days must be integers');
      }
      if (!(graceDayBlock >= 0 && graceDayBlock < graceDayDisable && graceDayDisable < graceDayWipe)) {
        return errorResponse('Grace day order must satisfy block < disable < wipe');
      }

      await execute(
        `INSERT INTO workspace_licensing_settings
           (workspace_id, licensing_enabled, inherit_platform_free_tier, free_enabled, free_seat_limit, billing_method,
            customer_owner_enabled, grace_day_block, grace_day_disable, grace_day_wipe, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), now())
         ON CONFLICT (workspace_id) DO UPDATE SET
           licensing_enabled = EXCLUDED.licensing_enabled,
           inherit_platform_free_tier = EXCLUDED.inherit_platform_free_tier,
           free_enabled = EXCLUDED.free_enabled,
           free_seat_limit = EXCLUDED.free_seat_limit,
           billing_method = EXCLUDED.billing_method,
           customer_owner_enabled = EXCLUDED.customer_owner_enabled,
           grace_day_block = EXCLUDED.grace_day_block,
           grace_day_disable = EXCLUDED.grace_day_disable,
           grace_day_wipe = EXCLUDED.grace_day_wipe,
           updated_at = now()`,
        [
          body.workspace_id,
          licensingEnabled,
          inheritPlatform,
          freeEnabled,
          freeSeatLimit,
          billingMethod,
          customerOwnerEnabled,
          graceDayBlock,
          graceDayDisable,
          graceDayWipe,
        ]
      );

      const settings = await getWorkspaceLicensingSettings(body.workspace_id);
      await logAudit({
        workspace_id: body.workspace_id,
        user_id: auth.user.id,
        action: 'workspace_licensing.settings.updated',
        resource_type: 'workspace_licensing_settings',
        resource_id: body.workspace_id,
        details: {
          platform_licensing_enabled: settings.platform_licensing_enabled,
          workspace_licensing_enabled: settings.workspace_licensing_enabled,
          effective_licensing_enabled: settings.effective_licensing_enabled,
          inherit_platform_free_tier: settings.inherit_platform_free_tier,
          workspace_free_enabled: settings.workspace_free_enabled,
          workspace_free_seat_limit: settings.workspace_free_seat_limit,
          effective_free_enabled: settings.free_enabled,
          effective_free_seat_limit: settings.free_seat_limit,
          grace_day_block: settings.grace_day_block,
          grace_day_disable: settings.grace_day_disable,
          grace_day_wipe: settings.grace_day_wipe,
        },
        ip_address: getClientIp(request),
      });

      return jsonResponse({ workspace_id: body.workspace_id, settings });
    }

    return errorResponse('Method not allowed', 405);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('license-settings error:', err);
    return errorResponse('Internal server error', 500);
  }
}
