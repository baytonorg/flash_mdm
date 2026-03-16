import type { Context } from '@netlify/functions';
import { requireAuth } from './_lib/auth.js';
import { queryOne } from './_lib/db.js';
import { requireWorkspaceResourcePermission } from './_lib/rbac.js';
import { createPortalSession } from './_lib/stripe.js';
import { jsonResponse, errorResponse, parseJsonBody, isValidUuid } from './_lib/helpers.js';
import { logAudit } from './_lib/audit.js';
import { getWorkspaceLicensingSettings } from './_lib/licensing.js';

interface PortalBody {
  workspace_id: string;
}

export default async function handler(request: Request, _context: Context) {
  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return errorResponse('Stripe is not configured.', 503);
    }

    const auth = await requireAuth(request);
    if (auth.authType === 'api_key') {
      return errorResponse('API keys cannot create Stripe portal sessions', 403);
    }

    const body = await parseJsonBody<PortalBody>(request);
    if (!body.workspace_id) return errorResponse('workspace_id is required');
    if (!isValidUuid(body.workspace_id)) return errorResponse('workspace_id must be a valid UUID');

    await requireWorkspaceResourcePermission(auth, body.workspace_id, 'workspace', 'read');
    const settings = await getWorkspaceLicensingSettings(body.workspace_id);
    if (!settings.effective_licensing_enabled) {
      return errorResponse('Licensing is disabled for this workspace', 409);
    }

    await requireWorkspaceResourcePermission(auth, body.workspace_id, 'billing', 'billing_manage');

    const workspace = await queryOne<{ id: string; stripe_customer_id: string | null }>(
      `SELECT id, stripe_customer_id
       FROM workspaces
       WHERE id = $1`,
      [body.workspace_id]
    );
    if (!workspace) return errorResponse('Workspace not found', 404);
    if (!workspace.stripe_customer_id) return errorResponse('No Stripe customer found for workspace', 404);

    const origin = new URL(request.url).origin;
    const portalUrl = await createPortalSession(workspace.stripe_customer_id, `${origin}/licenses`);

    await logAudit({
      workspace_id: body.workspace_id,
      user_id: auth.user.id,
      action: 'stripe.portal.created',
      resource_type: 'license',
      details: {},
    });

    return jsonResponse({ portal_url: portalUrl });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('stripe-portal error:', err);
    return errorResponse('Internal server error', 500);
  }
}
