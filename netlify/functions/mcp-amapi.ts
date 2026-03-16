import type { Context } from "@netlify/functions";
import { requireAuth } from "./_lib/auth.js";
import {
  requireWorkspaceResourcePermission,
  requireEnvironmentAccessScope,
} from "./_lib/rbac.js";
import {
  jsonResponse,
  errorResponse,
  getSearchParams,
  isValidUuid,
  assertSameOriginRequest,
  getClientIp,
  retryAfterHeader,
} from "./_lib/helpers.js";
import { queryOne } from "./_lib/db.js";
import { validateJsonRpcBody, proxyToAmapiMcp } from "./_lib/mcp-proxy.js";
import { consumeToken } from "./_lib/rate-limiter.js";
import { logAudit } from "./_lib/audit.js";
import { resolveAccessTokenAndProject } from "./_lib/workspace-credentials.js";
import { extractEnterprisePrefix } from "./_lib/enterprise-utils.js";

/**
 * AMAPI MCP proxy endpoint.
 * POST /api/mcp/amapi — proxies JSON-RPC to Google's AMAPI MCP endpoint.
 *
 * This is a standalone Flash feature — Flashi uses it, but other features could too.
 * Reserves /api/mcp for future Flash-native MCP.
 */

const MAX_REQUEST_BYTES = 500_000;
const ALLOWED_RPC_METHODS = new Set([
  "initialize",
  "notifications/initialized",
  "tools/list",
  "tools/call",
  "ping",
]);
const ALLOWED_READ_ONLY_TOOLS = new Set([
  "list_devices",
  "get_device",
  "list_policies",
  "get_policy",
  "get_application",
  "list_web_apps",
  "get_web_app",
]);

/**
 * Sanitise an MCP session ID to prevent header injection (CRLF, non-printable chars).
 * Returns undefined if the value is absent or invalid.
 */
function sanitiseSessionId(value: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim().slice(0, 256);
  // Only allow printable ASCII (space 0x20 through tilde 0x7E)
  if (!/^[\x20-\x7E]+$/.test(trimmed)) return undefined;
  return trimmed;
}

function rateLimitedResponse(retryAfterMs?: number): Response {
  return jsonResponse(
    { error: "Too many MCP requests. Please wait and try again." },
    429,
    retryAfterHeader(retryAfterMs),
  );
}

function enforceRpcAllowlistAndEnterpriseBinding(
  rpc: { method: string; params?: Record<string, unknown> },
  expectedEnterpriseName: string | null,
): string | null {
  if (!ALLOWED_RPC_METHODS.has(rpc.method)) {
    return "Unsupported MCP method";
  }

  if (rpc.method !== "tools/call") {
    return null;
  }

  const toolName = typeof rpc.params?.name === "string" ? rpc.params.name : "";
  if (!ALLOWED_READ_ONLY_TOOLS.has(toolName)) {
    return "Unsupported or non-read-only MCP tool";
  }

  if (!expectedEnterpriseName) {
    return "Environment is not bound to an AMAPI enterprise";
  }

  const args =
    rpc.params?.arguments &&
    typeof rpc.params.arguments === "object" &&
    !Array.isArray(rpc.params.arguments)
      ? (rpc.params.arguments as Record<string, unknown>)
      : {};

  if (
    toolName === "list_devices" ||
    toolName === "list_policies" ||
    toolName === "list_web_apps"
  ) {
    if (extractEnterprisePrefix(args.parent) !== expectedEnterpriseName) {
      return "Requested enterprise does not match the active environment";
    }
    return null;
  }

  const enterpriseScopedName = extractEnterprisePrefix(args.name);
  if (enterpriseScopedName !== expectedEnterpriseName) {
    return "Requested resource does not belong to the active environment enterprise";
  }
  return null;
}

export default async function handler(request: Request, _context: Context) {
  try {
    // Only accept POST
    if (request.method !== "POST") {
      return errorResponse(
        "Method not allowed. Use POST for MCP JSON-RPC requests.",
        405,
      );
    }

    assertSameOriginRequest(request);

    // Auth
    const auth = await requireAuth(request);

    // Resolve environment context
    const params = getSearchParams(request);
    const environmentId = params.get("environment_id");
    if (!environmentId || !isValidUuid(environmentId)) {
      return errorResponse("environment_id is required");
    }

    const env = await queryOne<{
      workspace_id: string;
      enterprise_name: string | null;
    }>("SELECT workspace_id, enterprise_name FROM environments WHERE id = $1", [
      environmentId,
    ]);
    if (!env) {
      return errorResponse("Access denied", 403);
    }

    // RBAC: workspace permission + environment scope.
    await requireWorkspaceResourcePermission(
      auth,
      env.workspace_id,
      "device",
      "read",
    );
    const envScope = await requireEnvironmentAccessScope(
      auth,
      environmentId,
      "viewer",
    );
    if (envScope.mode === "group") {
      return errorResponse(
        "Group-scoped access cannot use enterprise-wide MCP tools",
        403,
      );
    }

    // Read and validate body
    const bodyText = await request.text();
    if (bodyText.length > MAX_REQUEST_BYTES) {
      return errorResponse("Request payload too large", 413);
    }

    let rpc: { method: string; params?: Record<string, unknown> };
    try {
      rpc = validateJsonRpcBody(bodyText);
    } catch (err) {
      return errorResponse(
        err instanceof Error ? err.message : "Invalid JSON-RPC body",
      );
    }

    const rpcValidationError = enforceRpcAllowlistAndEnterpriseBinding(
      rpc,
      env.enterprise_name,
    );
    if (rpcValidationError) {
      return errorResponse(rpcValidationError, 403);
    }

    // Rate limit by both IP and principal.
    const principalId =
      auth.authType === "session"
        ? auth.user.id
        : (auth.apiKey?.id ?? auth.user.id);
    const ip = getClientIp(request);

    const ipLimit = await consumeToken(`mcp:amapi:ip:${ip}`, 1, 240, 240 / 60);
    if (!ipLimit.allowed) {
      return rateLimitedResponse(ipLimit.retryAfterMs);
    }
    const principalLimit = await consumeToken(
      `mcp:amapi:principal:${principalId}:env:${environmentId}`,
      1,
      90,
      90 / 60,
    );
    if (!principalLimit.allowed) {
      return rateLimitedResponse(principalLimit.retryAfterMs);
    }

    // Get access token for workspace
    const { accessToken, projectId } = await resolveAccessTokenAndProject(
      env.workspace_id,
    );

    // Extract and sanitise incoming MCP session ID (prevent header injection)
    const incomingSessionId = sanitiseSessionId(
      request.headers.get("mcp-session-id"),
    );

    // Proxy to AMAPI MCP
    const result = await proxyToAmapiMcp({
      body: bodyText,
      accessToken,
      projectId,
      incomingSessionId,
    });

    // Build response headers
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    };
    if (result.sessionId) {
      headers["mcp-session-id"] = result.sessionId;
    }

    await logAudit({
      workspace_id: env.workspace_id,
      environment_id: environmentId,
      user_id: auth.user.id,
      action: "mcp.amapi.call",
      resource_type: "mcp",
      resource_id: environmentId,
      details: {
        method: rpc.method,
        tool: typeof rpc.params?.name === "string" ? rpc.params.name : null,
        upstream_status: result.status,
      },
      ip_address: getClientIp(request),
    });

    return new Response(result.body, {
      status: result.status,
      headers,
    });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("MCP AMAPI proxy error:", err);
    return errorResponse("Internal server error", 500);
  }
}
