import type { Context } from "@netlify/functions";
import { requireAuth } from "./_lib/auth.js";
import {
  requireWorkspaceResourcePermission,
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
import {
  getWorkspaceAssistantSettings,
  setWorkspaceAssistantSettings,
} from "./_lib/flashagent-settings.js";
import type { WorkspaceRole } from "./_lib/rbac.js";
import { logAudit } from "./_lib/audit.js";
import { sanitizeErrorForLog } from "./_lib/log-safety.js";

interface UpdateBody {
  workspace_id: string;
  assistant_enabled?: boolean;
  max_role?: WorkspaceRole;
  default_role?: WorkspaceRole;
  openai_api_key?: string;
  clear_openai_api_key?: boolean;
  openai_model?: string | null;
}

function isAllowedFlashiRole(value: unknown): value is WorkspaceRole {
  return value === "viewer" || value === "member" || value === "admin";
}

export default async function handler(request: Request, _context: Context) {
  try {
    assertSameOriginRequest(request);
    const auth = await requireAuth(request);

    if (request.method === "GET") {
      const params = getSearchParams(request);
      const workspaceId = params.get("workspace_id");
      if (!workspaceId || !isValidUuid(workspaceId)) {
        return errorResponse("workspace_id is required");
      }

      await requireWorkspaceResourcePermission(auth, workspaceId, "workspace", "read");

      const settings = await getWorkspaceAssistantSettings(workspaceId);
      return jsonResponse({ workspace_id: workspaceId, ...settings });
    }

    if (request.method === "PUT") {
      if (auth.authType === "api_key") {
        return errorResponse("API keys cannot update workspace assistant settings", 403);
      }

      const body = await parseJsonBody<UpdateBody>(request);
      if (!body.workspace_id || !isValidUuid(body.workspace_id)) {
        return errorResponse("workspace_id must be a valid UUID");
      }

      const hasAssistantEnabled = typeof body.assistant_enabled === "boolean";
      const hasMaxRole = typeof body.max_role === "string";
      const hasDefaultRole = typeof body.default_role === "string";
      const hasOpenAiKey = typeof body.openai_api_key === "string";
      const hasClearOpenAiKey = body.clear_openai_api_key === true;
      const hasOpenAiModel =
        body.openai_model === null || typeof body.openai_model === "string";
      if (!hasAssistantEnabled && !hasMaxRole && !hasDefaultRole && !hasOpenAiKey && !hasClearOpenAiKey && !hasOpenAiModel) {
        return errorResponse("At least one workspace assistant setting is required");
      }
      if (hasOpenAiKey && hasClearOpenAiKey) {
        return errorResponse("Cannot set and clear openai_api_key in the same request");
      }
      if (hasMaxRole && !isAllowedFlashiRole(body.max_role)) {
        return errorResponse("max_role must be one of viewer, member, admin");
      }
      if (hasDefaultRole && !isAllowedFlashiRole(body.default_role)) {
        return errorResponse("default_role must be one of viewer, member, admin");
      }
      if (hasOpenAiKey && (body.openai_api_key || "").trim().length > 400) {
        return errorResponse("openai_api_key is too long");
      }
      if (typeof body.openai_model === "string" && body.openai_model.trim().length > 120) {
        return errorResponse("openai_model must be 120 characters or fewer");
      }

      await requireWorkspaceResourcePermission(
        auth,
        body.workspace_id,
        "workspace",
        "manage_settings",
      );

      await setWorkspaceAssistantSettings(body.workspace_id, {
        assistant_enabled: hasAssistantEnabled ? body.assistant_enabled : undefined,
        max_role: hasMaxRole ? body.max_role : undefined,
        default_role: hasDefaultRole ? body.default_role : undefined,
        openai_api_key: hasOpenAiKey ? body.openai_api_key : undefined,
        clear_openai_api_key: hasClearOpenAiKey,
        openai_model: hasOpenAiModel ? body.openai_model : undefined,
      });

      const settings = await getWorkspaceAssistantSettings(body.workspace_id);

      await logAudit({
        workspace_id: body.workspace_id,
        user_id: auth.user.id,
        action: "flashagent.workspace_settings.updated",
        resource_type: "flashagent",
        resource_id: body.workspace_id,
        details: {
          workspace_assistant_enabled: settings.workspace_assistant_enabled,
          workspace_assistant_max_role: settings.workspace_assistant_max_role,
          workspace_assistant_default_role: settings.workspace_assistant_default_role,
          workspace_openai_override_configured: settings.workspace_openai_override_configured,
          workspace_openai_model: settings.workspace_openai_model,
        },
        ip_address: getClientIp(request),
      });

      return jsonResponse({ workspace_id: body.workspace_id, ...settings });
    }

    return errorResponse("Method not allowed", 405);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("Flashi workspace settings error:", sanitizeErrorForLog(err));
    return errorResponse("Internal server error", 500);
  }
}
