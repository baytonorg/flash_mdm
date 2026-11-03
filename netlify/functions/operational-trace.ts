import type { Context } from "@netlify/functions";
import { createHmac, randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { validateSession, requireSuperadmin } from "./_lib/auth.js";
import {
  assertSameOriginRequest,
  jsonResponse,
  errorResponse,
} from "./_lib/helpers.js";
import { traceEvent, traceHealth } from "./_lib/operational-trace.js";
import {
  traceStatus,
  traceFiles,
  readTraceTail,
  streamTraceWindow,
} from "./_lib/trace-reader.js";
import {
  CLIENT_EVENTS,
  UUID_PATTERN,
  normaliseTracePath,
} from "../../shared/trace-contract.js";

// Only derived, process-local quota keys live in memory. Anonymous browsers have
// individual allowances and share a separate ceiling against rotating client IDs.
const processKey = randomBytes(32);
function opaque(label: string, value: string) {
  return createHmac("sha256", processKey)
    .update(label)
    .update("\0")
    .update(value)
    .digest("base64url");
}
// Restarting the collector resets these fixed one-minute budgets. Separate
// pre-authentication limits bound database work even for invented cookies.
function minuteQuota(totalLimit: number) {
  let until = 0,
    total = 0;
  const counts = new Map<string, number>();
  return (key: string, limit: number) => {
    const now = Date.now();
    if (now >= until) {
      until = now + 60_000;
      total = 0;
      counts.clear();
    }
    const used = counts.get(key) ?? 0;
    if (total >= totalLimit || used >= limit) return false;
    counts.set(key, used + 1);
    total++;
    return true;
  };
}
const beforeSessionLookup = minuteQuota(3000);
const anonymousUploads = minuteQuota(600);
const authenticatedUploads = minuteQuota(3000);
export default async function handler(request: Request, _context: Context) {
  try {
    const url = new URL(request.url);
    // POST /api/activity
    if (url.pathname === "/api/activity") {
      if (request.method !== "POST")
        return errorResponse("Method not allowed", 405);
      assertSameOriginRequest(request);
      if (
        request.headers.has("authorization") ||
        request.headers.has("x-api-key")
      )
        return errorResponse("API keys cannot submit browser activity", 403);
      if (request.headers.get("x-requested-with") !== "XMLHttpRequest")
        return errorResponse("Browser activity header required", 403);
      if (!process.env.FLASH_TRACE_DIR)
        return new Response(null, { status: 204 });
      if (Number(request.headers.get("content-length")) > 16384)
        return errorResponse("Activity batch too large", 413);
      const client = request.headers.get("X-Flash-Activity-Client");
      const clientKey = opaque(
        "browser",
        client && UUID_PATTERN.test(client) ? client : "unidentified",
      );
      if (!beforeSessionLookup(clientKey, 60))
        return errorResponse("Activity collection rate limit", 429);
      const reader = request.body?.getReader();
      let bytes = 0;
      const chunks: Uint8Array[] = [];
      if (reader)
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          bytes += next.value.byteLength;
          if (bytes > 16384) {
            void reader.cancel();
            return errorResponse("Activity batch too large", 413);
          }
          chunks.push(next.value);
        }
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return errorResponse("Invalid activity batch");
      }
      if (!body || !Array.isArray(body.events) || body.events.length > 50)
        return errorResponse("Invalid activity batch");
      const auth = await validateSession(request, { renew: false });
      const allowed = auth
        ? authenticatedUploads(opaque("user", auth.user.id), 30)
        : anonymousUploads(clientKey, 20);
      if (!allowed) return errorResponse("Activity collection rate limit", 429);
      // This comparison is an attribution check, never an authentication method.
      // Only validateSession establishes the actor. Do not persist either value.
      const binding = opaque(
        "activity-session",
        auth?.sessionId ?? "anonymous",
      );
      const supplied = request.headers.get("X-Flash-Activity-Binding");
      const dropped =
        Number.isInteger(body.dropped) &&
        body.dropped > 0 &&
        body.dropped < 1_000_000
          ? body.dropped
          : 0;
      const unconfirmed =
        Number.isInteger(body.unconfirmed) &&
        body.unconfirmed > 0 &&
        body.unconfirmed < 1_000_000
          ? body.unconfirmed
          : 0;
      if (supplied !== binding) {
        const bootstrap =
          !supplied &&
          body.events.length === 0 &&
          !body.dropped &&
          !body.unconfirmed;
        if (!bootstrap) {
          // Record only the loss, never event details from a different session.
          traceEvent("ui.collection_gap", {
            dropped: body.events.length + dropped,
            unconfirmed,
            reason: "session_changed",
            client_reported: true,
          });
        }
        return new Response(null, {
          status: bootstrap ? 204 : 409,
          headers: {
            "X-Flash-Activity-Binding": binding,
            "Cache-Control": "no-store",
          },
        });
      }
      if (dropped || unconfirmed)
        traceEvent("ui.collection_gap", {
          dropped,
          unconfirmed,
          client_reported: true,
        });
      let rejected = 0;
      for (const event of body.events) {
        if (
          !event ||
          !CLIENT_EVENTS.has(event.kind) ||
          typeof event.route !== "string" ||
          event.route.length > 2048
        ) {
          rejected++;
          continue;
        }
        const details: Record<string, unknown> = {
          client_reported: true,
          page: normaliseTracePath(event.route),
        };
        if (
          typeof event.api_route === "string" &&
          event.api_route.length <= 2048
        )
          details.api_route = normaliseTracePath(event.api_route);
        if (
          ["Error", "TypeError", "ReferenceError"].includes(event.error_class)
        )
          details.error_class = event.error_class;
        if (
          event.kind === "javascript_error" &&
          Number.isInteger(event.source_line) &&
          event.source_line > 0 &&
          event.source_line <= 100_000_000 &&
          Number.isInteger(event.source_column) &&
          event.source_column >= 0 &&
          event.source_column <= 100_000_000
        ) {
          details.source_line = event.source_line;
          details.source_column = event.source_column;
        }
        if (event.kind === "api_result" && event.cancelled === true)
          details.cancelled = true;
        for (const key of ["interaction_id", "server_request_id"])
          if (typeof event[key] === "string" && UUID_PATTERN.test(event[key]))
            details[key] = event[key];
        if (
          ["button", "a", "input", "select", "textarea", "form"].includes(
            event.control,
          )
        )
          details.control = event.control;
        if (
          [
            "button",
            "submit",
            "checkbox",
            "radio",
            "text",
            "email",
            "password",
            "number",
            "search",
            "date",
          ].includes(event.control_type)
        )
          details.control_type = event.control_type;
        for (const key of [
          "position",
          "viewport_width",
          "viewport_height",
          "status",
          "duration_ms",
        ])
          if (
            Number.isInteger(event[key]) &&
            event[key] >= 0 &&
            event[key] <= 1_000_000
          )
            details[key] = event[key];
        if (
          typeof event.client_time === "string" &&
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(
            event.client_time,
          ) &&
          Number.isFinite(Date.parse(event.client_time))
        )
          details.client_time = event.client_time.slice(0, 32);
        traceEvent("ui." + event.kind, details);
      }
      if (rejected)
        traceEvent("ui.collection_gap", {
          dropped: rejected,
          reason: "invalid_events",
          client_reported: true,
        });
      return new Response(null, { status: 204 });
    }
    // GET /api/superadmin/operational-trace
    if (url.pathname !== "/api/superadmin/operational-trace")
      return errorResponse("Not found", 404);
    await requireSuperadmin(request);
    if (request.method !== "GET")
      return errorResponse("Method not allowed", 405);
    const directory = process.env.FLASH_TRACE_DIR;
    if (!directory)
      return jsonResponse({
        enabled: false,
        collection: traceHealth(),
        events: [],
        retained_windows: [],
      });
    const window = url.searchParams.get("window") ?? undefined;
    if (window && !/^\d{4}-\d{2}-\d{2}$/.test(window))
      return errorResponse("Invalid log window");
    if (url.searchParams.get("download") === "ndjson") {
      if (!window) return errorResponse("Log window not found", 404);
      const files = (await traceFiles(directory, window)).filter(
        (file) => !file.health,
      );
      if (!files.length) return errorResponse("Log window not found", 404);
      return new Response(
        Readable.toWeb(
          Readable.from(streamTraceWindow(directory, window, files)),
        ) as ReadableStream,
        {
          headers: {
            "Content-Type": "application/x-ndjson",
            "Content-Disposition": `attachment; filename="flash-trace-${window}.ndjson"`,
            "Cache-Control": "no-store",
          },
        },
      );
    }
    const status = await traceStatus(directory);
    const tail =
      url.searchParams.get("events") === "true"
        ? await readTraceTail(directory, {
            window,
            actor: (url.searchParams.get("actor") ?? "").slice(0, 320),
            requestId: (url.searchParams.get("request_id") ?? "").slice(0, 64),
            outcome: url.searchParams.get("outcome") ?? undefined,
            limit: 100,
          })
        : { events: [] };
    return jsonResponse(
      { ...status, collection: traceHealth(), ...tail },
      200,
      { "Cache-Control": "no-store" },
    );
  } catch (error) {
    if (error instanceof Response) return error;
    return errorResponse("Diagnostic logs are unavailable", 503);
  }
}
