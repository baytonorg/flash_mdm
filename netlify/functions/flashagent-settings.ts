import type { Context } from "@netlify/functions";
import { requireAuth } from "./_lib/auth.js";
import {
  requireEnvironmentAccessScopeForResourcePermission,
  requireEnvironmentResourcePermission,
} from "./_lib/rbac.js";
import {
  jsonResponse,
  errorResponse,
  parseJsonBody,
  isValidUuid,
  getSearchParams,
  getClientIp,
  assertSameOriginRequest,
} from "./_lib/helpers.js";
import { queryOne } from "./_lib/db.js";
import {
  getEffectiveAssistantSettings,
  getWorkspaceAssistantSettings,
  setEnvironmentAssistantEnabled,
} from "./_lib/flashagent-settings.js";
import { logAudit } from "./_lib/audit.js";
import { sanitizeErrorForLog } from "./_lib/log-safety.js";
import type { WorkspaceRole } from "./_lib/rbac.js";

interface UpdateBody {
  environment_id: string;
  enabled: boolean;
  role?: WorkspaceRole;
}

function isAllowedFlashiRole(value: unknown): value is WorkspaceRole {
  return value === "viewer" || value === "member" || value === "admin";
}

export default async function handler(request: Request, _context: Context) {
  try {
    assertSameOriginRequest(request);
    const auth = await requireAuth(request);

    // GET: Return effective assistant settings for an environment
    if (request.method === "GET") {
      const params = getSearchParams(request);
      const environmentId = params.get("environment_id");
      if (!environmentId || !isValidUuid(environmentId)) {
        return errorResponse("environment_id is required");
      }

      const env = await queryOne<{ workspace_id: string }>(
        "SELECT workspace_id FROM environments WHERE id = $1",
        [environmentId],
      );
      if (!env) return errorResponse("Access denied", 403);

      await requireEnvironmentAccessScopeForResourcePermission(
        auth,
        environmentId,
        "flashagent",
        "read",
      );

      const settings = await getEffectiveAssistantSettings(
        env.workspace_id,
        environmentId,
      );
      return jsonResponse({ environment_id: environmentId, ...settings });
    }

    // PUT: Toggle environment-level assistant enabled
    if (request.method === "PUT") {
      if (auth.authType === "api_key") {
        return errorResponse("API keys cannot update assistant settings", 403);
      }

      const body = await parseJsonBody<UpdateBody>(request);
      if (!body.environment_id || !isValidUuid(body.environment_id)) {
        return errorResponse("environment_id must be a valid UUID");
      }
      if (typeof body.enabled !== "boolean") {
        return errorResponse("enabled must be a boolean");
      }
      if (body.role !== undefined && !isAllowedFlashiRole(body.role)) {
        return errorResponse("role must be one of viewer, member, admin");
      }

      const env = await queryOne<{ workspace_id: string }>(
        "SELECT workspace_id FROM environments WHERE id = $1",
        [body.environment_id],
      );
      if (!env) return errorResponse("Access denied", 403);

      await requireEnvironmentResourcePermission(
        auth,
        body.environment_id,
        "flashagent",
        "manage_settings",
      );

      const workspaceSettings = await getWorkspaceAssistantSettings(env.workspace_id);
      const requestedRole = body.role ?? workspaceSettings.workspace_assistant_default_role;
      const roleRank: Record<WorkspaceRole, number> = {
        viewer: 1,
        member: 2,
        admin: 3,
        owner: 4,
      };
      const ceiling = workspaceSettings.workspace_assistant_max_role;
      const effectiveRole =
        roleRank[requestedRole] <= roleRank[ceiling] ? requestedRole : ceiling;

      await setEnvironmentAssistantEnabled(
        body.environment_id,
        body.enabled,
        effectiveRole,
        auth.user.id,
      );

      const settings = await getEffectiveAssistantSettings(
        env.workspace_id,
        body.environment_id,
      );

      await logAudit({
        workspace_id: env.workspace_id,
        user_id: auth.user.id,
        action: "flashagent.settings.updated",
        resource_type: "flashagent",
        resource_id: body.environment_id,
        details: {
          environment_assistant_enabled: body.enabled,
          environment_assistant_role: settings.environment_assistant_role,
          effective_assistant_role: settings.effective_assistant_role,
          effective_enabled: settings.effective_enabled,
        },
        ip_address: getClientIp(request),
      });

      return jsonResponse({ environment_id: body.environment_id, ...settings });
    }

    return errorResponse("Method not allowed", 405);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("Flashi settings error:", sanitizeErrorForLog(err));
    return errorResponse("Internal server error", 500);
  }
}
