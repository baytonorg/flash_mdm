import type { Context } from "@netlify/functions";
import { requireAuth } from "./_lib/auth.js";
import { requireEnvironmentAccessScopeForResourcePermission } from "./_lib/rbac.js";
import {
  jsonResponse,
  errorResponse,
  parseJsonBody,
  isValidUuid,
  getSearchParams,
  getClientIp,
  assertSameOriginRequest,
  retryAfterHeader,
} from "./_lib/helpers.js";
import { execute, query, queryOne } from "./_lib/db.js";
import { logAudit } from "./_lib/audit.js";
import { consumeToken } from "./_lib/rate-limiter.js";
import { sanitizeErrorForLog } from "./_lib/log-safety.js";

const RETENTION_DAYS_RAW = Number(
  process.env.FLASHAGENT_CHAT_RETENTION_DAYS || 30,
);
const RETENTION_DAYS =
  Number.isFinite(RETENTION_DAYS_RAW) && RETENTION_DAYS_RAW > 0
    ? Math.floor(RETENTION_DAYS_RAW)
    : 30;
const MAX_MESSAGES = 5000;

interface AppendBody {
  environment_id: string;
  messages: Array<{ role: string; text: string }>;
}

function historyRateLimitedResponse(retryAfterMs?: number): Response {
  return jsonResponse(
    { error: "Too many chat history requests. Please wait and try again." },
    429,
    retryAfterHeader(retryAfterMs),
  );
}

async function pruneOldMessages(
  environmentId: string,
  userId: string,
): Promise<void> {
  await execute(
    `DELETE FROM flashagent_chat_messages
     WHERE environment_id = $1 AND user_id = $2
       AND created_at < now() - make_interval(days => $3)`,
    [environmentId, userId, RETENTION_DAYS],
  );
}

function formatChatHistoryMarkdown(
  messages: Array<{ role: string; text: string; created_at: string }>,
  environmentName: string,
  userEmail: string,
): string {
  const lines = [
    `# Flashi Chat History`,
    ``,
    `- Environment: ${environmentName}`,
    `- User: ${userEmail}`,
    `- Exported: ${new Date().toISOString()}`,
    ``,
    `---`,
    ``,
  ];

  let currentDate = "";
  for (const msg of messages) {
    const ts = new Date(msg.created_at);
    const dateStr = ts.toISOString().split("T")[0];
    if (dateStr !== currentDate) {
      currentDate = dateStr;
      lines.push(`## ${dateStr}`, ``);
    }
    const timeStr = ts.toISOString().split("T")[1]?.replace("Z", " UTC") || "";
    const roleLabel = msg.role === "user" ? "👤 You" : "🤖 Flashi";
    lines.push(`### ${timeStr} — ${roleLabel}`, ``, msg.text, ``);
  }

  return lines.join("\n");
}

export default async function handler(request: Request, _context: Context) {
  try {
    assertSameOriginRequest(request);
    const auth = await requireAuth(request);

    // GET: Load chat history
    if (request.method === "GET") {
      const params = getSearchParams(request);
      const environmentId = params.get("environment_id");
      if (!environmentId || !isValidUuid(environmentId)) {
        return errorResponse("environment_id is required");
      }

      const env = await queryOne<{ workspace_id: string; name: string }>(
        "SELECT workspace_id, name FROM environments WHERE id = $1",
        [environmentId],
      );
      if (!env) return errorResponse("Access denied", 403);

      await requireEnvironmentAccessScopeForResourcePermission(
        auth,
        environmentId,
        "flashagent",
        "read",
      );

      const userId = auth.user.id;
      if (!userId) return errorResponse("Unable to resolve user", 400);
      const ip = getClientIp(request);
      const principalId =
        auth.authType === "session"
          ? auth.user.id
          : (auth.apiKey?.id ?? auth.user.id);
      const ipLimit = await consumeToken(
        `flashagent:chat-history:get:ip:${ip}`,
        1,
        300,
        300 / 60,
      );
      if (!ipLimit.allowed) {
        return historyRateLimitedResponse(ipLimit.retryAfterMs);
      }
      const principalLimit = await consumeToken(
        `flashagent:chat-history:get:principal:${principalId}:env:${environmentId}`,
        1,
        180,
        180 / 60,
      );
      if (!principalLimit.allowed) {
        return historyRateLimitedResponse(principalLimit.retryAfterMs);
      }

      const HISTORY_QUERY_LIMIT = 500;
      const messages = await query<{
        id: string;
        role: string;
        text: string;
        created_at: string;
      }>(
        `SELECT id, role, text, created_at
         FROM (
           SELECT id, role, text, created_at
           FROM flashagent_chat_messages
           WHERE environment_id = $1 AND user_id = $2
           ORDER BY created_at DESC
           LIMIT $3
         ) recent
         ORDER BY created_at ASC`,
        [environmentId, userId, HISTORY_QUERY_LIMIT],
      );

      const format = params.get("format");
      if (format === "markdown") {
        const userEmail =
          auth.authType === "session" ? auth.user.email : "api-key";
        const markdown = formatChatHistoryMarkdown(
          messages,
          env.name,
          userEmail,
        );
        return jsonResponse({
          markdown,
          filename: `flashi-chat-${env.name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64)}-${new Date().toISOString().split("T")[0]}.md`,
        });
      }

      return jsonResponse({ messages });
    }

    // POST: Append messages
    if (request.method === "POST") {
      const body = await parseJsonBody<AppendBody>(request);

      if (!body.environment_id || !isValidUuid(body.environment_id)) {
        return errorResponse("environment_id is required");
      }
      if (!Array.isArray(body.messages) || body.messages.length === 0) {
        return errorResponse("messages array is required");
      }

      const env = await queryOne<{ workspace_id: string }>(
        "SELECT workspace_id FROM environments WHERE id = $1",
        [body.environment_id],
      );
      if (!env) return errorResponse("Access denied", 403);

      // Intentionally uses 'read' — every user who can chat should persist their own messages.
      // Messages are scoped to auth.user.id so users cannot write to others' history.
      await requireEnvironmentAccessScopeForResourcePermission(
        auth,
        body.environment_id,
        "flashagent",
        "read",
      );

      const userId = auth.user.id;
      if (!userId) return errorResponse("Unable to resolve user", 400);

      const ip = getClientIp(request);
      const principalId =
        auth.authType === "session"
          ? auth.user.id
          : (auth.apiKey?.id ?? auth.user.id);
      const ipLimit = await consumeToken(
        `flashagent:chat-history:post:ip:${ip}`,
        1,
        180,
        180 / 60,
      );
      if (!ipLimit.allowed) {
        return historyRateLimitedResponse(ipLimit.retryAfterMs);
      }
      const principalLimit = await consumeToken(
        `flashagent:chat-history:post:principal:${principalId}:env:${body.environment_id}`,
        1,
        90,
        90 / 60,
      );
      if (!principalLimit.allowed) {
        return historyRateLimitedResponse(principalLimit.retryAfterMs);
      }

      await pruneOldMessages(body.environment_id, userId);

      // Cap total messages
      const countResult = await queryOne<{ count: string }>(
        "SELECT COUNT(*)::text as count FROM flashagent_chat_messages WHERE environment_id = $1 AND user_id = $2",
        [body.environment_id, userId],
      );
      const currentCount = Number(countResult?.count || 0);
      const remainingCapacity = Math.max(0, MAX_MESSAGES - currentCount);
      const newMessages = body.messages.slice(0, remainingCapacity);

      if (newMessages.length === 0) {
        return jsonResponse({ appended: 0, message: "Message limit reached" });
      }

      // Bulk insert
      const valuesClauses: string[] = [];
      const params: unknown[] = [];
      let paramIdx = 1;

      for (const msg of newMessages) {
        const role = msg.role === "user" ? "user" : "assistant";
        const text = String(msg.text || "").slice(0, 8000);
        if (!text) continue;

        valuesClauses.push(
          `($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4})`,
        );
        params.push(env.workspace_id, body.environment_id, userId, role, text);
        paramIdx += 5;
      }

      if (valuesClauses.length > 0) {
        await execute(
          `INSERT INTO flashagent_chat_messages (workspace_id, environment_id, user_id, role, text)
           VALUES ${valuesClauses.join(", ")}`,
          params,
        );
      }

      return jsonResponse({ appended: valuesClauses.length });
    }

    // DELETE: Clear chat history
    if (request.method === "DELETE") {
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
        "write",
      );

      const userId = auth.user.id;
      if (!userId) return errorResponse("Unable to resolve user", 400);

      const ip = getClientIp(request);
      const principalId =
        auth.authType === "session"
          ? auth.user.id
          : (auth.apiKey?.id ?? auth.user.id);
      const ipLimit = await consumeToken(
        `flashagent:chat-history:delete:ip:${ip}`,
        1,
        20,
        20 / 600,
      );
      if (!ipLimit.allowed) {
        return historyRateLimitedResponse(ipLimit.retryAfterMs);
      }
      const principalLimit = await consumeToken(
        `flashagent:chat-history:delete:principal:${principalId}:env:${environmentId}`,
        1,
        10,
        10 / 600,
      );
      if (!principalLimit.allowed) {
        return historyRateLimitedResponse(principalLimit.retryAfterMs);
      }

      await execute(
        "DELETE FROM flashagent_chat_messages WHERE environment_id = $1 AND user_id = $2",
        [environmentId, userId],
      );

      await logAudit({
        workspace_id: env.workspace_id,
        user_id: userId,
        action: "flashagent.chat_history.cleared",
        resource_type: "flashagent",
        resource_id: environmentId,
        details: {},
        ip_address: getClientIp(request),
      });

      return jsonResponse({ message: "Chat history cleared" });
    }

    return errorResponse("Method not allowed", 405);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("Flashi chat history error:", sanitizeErrorForLog(err));
    return errorResponse("Internal server error", 500);
  }
}
