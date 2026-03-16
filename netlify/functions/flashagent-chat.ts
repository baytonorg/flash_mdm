import type { Context } from "@netlify/functions";
import { requireAuth } from "./_lib/auth.js";
import {
  requireEnvironmentAccessScopeForResourcePermission,
  getEffectivePermissionMatrixForWorkspace,
} from "./_lib/rbac.js";
import {
  jsonResponse,
  errorResponse,
  parseJsonBody,
  isValidUuid,
  assertSameOriginRequest,
  getClientIp,
  retryAfterHeader,
} from "./_lib/helpers.js";
import { queryOne } from "./_lib/db.js";
import {
  getEffectiveAssistantSettings,
  getEnvironmentAssistantApiKey,
  getWorkspaceOpenAiOverrides,
} from "./_lib/flashagent-settings.js";
import { checkAssistantEntitlement } from "./_lib/flashagent-billing.js";
import { buildSystemPrompt } from "./_lib/flashagent-prompt.js";
import { runFlashi, type RuntimeContext } from "./_lib/flashagent-runtime.js";
import { logAudit } from "./_lib/audit.js";
import { consumeToken } from "./_lib/rate-limiter.js";
import { resolveAccessTokenAndProject } from "./_lib/workspace-credentials.js";
import { sanitizeErrorForLog } from "./_lib/log-safety.js";

interface ChatRequestBody {
  message: string;
  environment_id: string;
  contextMessages?: Array<{ role: string; text: string }>;
}

function chatRateLimitedResponse(retryAfterMs?: number): Response {
  return jsonResponse(
    { error: "Too many assistant requests. Please wait and try again." },
    429,
    retryAfterHeader(retryAfterMs),
  );
}

export default async function handler(request: Request, _context: Context) {
  try {
    if (request.method !== "POST") {
      return errorResponse("Method not allowed", 405);
    }

    assertSameOriginRequest(request);

    // Auth
    const auth = await requireAuth(request);
    const body = await parseJsonBody<ChatRequestBody>(request);

    if (!body.environment_id || !isValidUuid(body.environment_id)) {
      return errorResponse("environment_id must be a valid UUID");
    }
    if (
      !body.message ||
      typeof body.message !== "string" ||
      body.message.length > 12_000
    ) {
      return errorResponse(
        "message is required and must be under 12000 characters",
      );
    }

    // Resolve workspace + environment in a single query
    const env = await queryOne<{
      workspace_id: string;
      name: string;
      enterprise_name: string | null;
      enterprise_display_name: string | null;
      workspace_name: string;
    }>(
      `SELECT e.workspace_id, e.name, e.enterprise_name, e.enterprise_display_name, w.name AS workspace_name
       FROM environments e
       JOIN workspaces w ON w.id = e.workspace_id
       WHERE e.id = $1`,
      [body.environment_id],
    );
    // Return 403 (not 404) to avoid revealing whether arbitrary environment UUIDs exist
    if (!env) return errorResponse("Access denied", 403);

    const workspaceId = env.workspace_id;

    // Rate limit expensive LLM calls (IP + principal + environment).
    const principalId =
      auth.authType === "session"
        ? auth.user.id
        : (auth.apiKey?.id ?? auth.user.id);
    const ip = getClientIp(request);
    const requestCost = Math.max(1, Math.ceil(body.message.length / 4000));

    const ipLimit = await consumeToken(
      `flashagent:chat:ip:${ip}`,
      requestCost,
      45,
      45 / 60,
    );
    if (!ipLimit.allowed) {
      return chatRateLimitedResponse(ipLimit.retryAfterMs);
    }

    const principalLimit = await consumeToken(
      `flashagent:chat:principal:${principalId}:env:${body.environment_id}`,
      requestCost,
      20,
      20 / 60,
    );
    if (!principalLimit.allowed) {
      return chatRateLimitedResponse(principalLimit.retryAfterMs);
    }

    // Feature gate: check effective enabled
    const settings = await getEffectiveAssistantSettings(
      workspaceId,
      body.environment_id,
    );
    if (!settings.effective_enabled) {
      return errorResponse(
        "Flashi assistant is not enabled for this environment",
        403,
      );
    }

    // Billing entitlement check (soft hook, permissive for now)
    const entitlement = await checkAssistantEntitlement(
      workspaceId,
      body.environment_id,
    );
    if (!entitlement.entitled) {
      return errorResponse(
        entitlement.reason || "Assistant entitlement check failed",
        403,
      );
    }

    // Resolve user's access scope and role
    const accessScope = await requireEnvironmentAccessScopeForResourcePermission(
      auth,
      body.environment_id,
      "flashagent",
      "read",
    );
    const assistantRole = settings.effective_assistant_role;
    const permissionMatrix =
      await getEffectivePermissionMatrixForWorkspace(workspaceId);

    // Resolve access token for AMAPI MCP
    let accessToken = "";
    let projectId = "";
    try {
      const creds = await resolveAccessTokenAndProject(workspaceId);
      accessToken = creds.accessToken;
      projectId = creds.projectId;
    } catch {
      // No AMAPI credentials — AMAPI tools will fail gracefully
    }

    // Build context messages (last 10, capped at 1000 chars each)
    const contextMessages = (
      Array.isArray(body.contextMessages) ? body.contextMessages : []
    )
      .slice(-10)
      .map((entry) => ({
        role: String(entry?.role || "").slice(0, 24),
        text: String(entry?.text || "").slice(0, 1000),
      }))
      .filter((entry) => entry.role && entry.text);

    // Build system prompt — workspace name already fetched in the initial JOIN query
    const systemPrompt = buildSystemPrompt({
      workspaceId,
      workspaceName: env.workspace_name || "Unknown",
      environmentId: body.environment_id,
      environmentName: env.name,
      enterpriseName: env.enterprise_name,
      assistantRole,
      accessScope: accessScope.mode === "group" ? "scoped" : "workspace",
      accessibleGroupIds: accessScope.accessible_group_ids,
    });

    // Build runtime context
    const runtimeCtx: RuntimeContext = {
      auth,
      workspaceId,
      environmentId: body.environment_id,
      environmentName: env.name,
      enterpriseName: env.enterprise_name,
      accessToken,
      projectId,
      permissionMatrix,
      userRole: assistantRole,
      accessibleGroupIds: accessScope.accessible_group_ids,
      apiBaseUrl: new URL(request.url).origin,
      flashiApiKey: "",
    };

    const environmentApiKey = await getEnvironmentAssistantApiKey(
      workspaceId,
      body.environment_id,
    );
    if (!environmentApiKey) {
      return errorResponse(
        "Flashi API key is unavailable for this environment. Disable and re-enable Flashi in environment settings.",
        500,
      );
    }
    runtimeCtx.flashiApiKey = environmentApiKey;

    // Run Flashi
    const workspaceOpenAi = await getWorkspaceOpenAiOverrides(workspaceId);
    const result = await runFlashi({
      systemPrompt,
      userMessage: body.message,
      contextMessages,
      runtimeCtx,
      apiKeyOverride: workspaceOpenAi.apiKey,
      modelOverride: workspaceOpenAi.model,
    });

    // Audit log
    await logAudit({
      workspace_id: workspaceId,
      user_id: auth.user.id,
      action: "flashagent.chat",
      resource_type: "flashagent",
      resource_id: body.environment_id,
      details: {
        tool_calls: result.toolCallCount,
        message_length: body.message.length,
        reply_length: result.reply.length,
      },
      ip_address: getClientIp(request),
    });

    return jsonResponse({
      reply: result.reply,
      role: "assistant",
      source: result.dataSource,
    });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("Flashi chat error:", sanitizeErrorForLog(err));
    return errorResponse("Internal server error", 500);
  }
}
