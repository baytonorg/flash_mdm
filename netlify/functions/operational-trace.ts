import type { Context } from "@netlify/functions";
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

const buckets = new Map<string, { at: number; count: number }>();
export default async function handler(request: Request, _context: Context) {
  try {
    const url = new URL(request.url);
    if (url.pathname === "/api/activity" && request.method === "POST") {
      assertSameOriginRequest(request);
      if (request.headers.get('authorization')) return errorResponse('API keys cannot submit browser activity', 403);
      if (request.headers.get('x-requested-with') !== 'XMLHttpRequest') return errorResponse('Browser activity header required', 403);
      const auth = await validateSession(request);
      if (!process.env.FLASH_TRACE_DIR)
        return new Response(null, { status: 204 });
      const id = auth?.user.id ?? 'anonymous',
        now = Date.now();
      if (buckets.size >= 10_000)
        for (const [key, bucket] of buckets)
          if (now - bucket.at > 60_000) buckets.delete(key);
      const bucket = buckets.get(id);
      if (!bucket && buckets.size >= 10_000) return errorResponse('Activity collection rate limit', 429);
      const current =
        !bucket || now - bucket.at > 60_000 ? { at: now, count: 0 } : bucket;
      current.count++;
      buckets.set(id, current);
      if (current.count > (auth ? 30 : 60))
        return errorResponse("Activity collection rate limit", 429);
      if (Number(request.headers.get("content-length")) > 16384)
        return errorResponse("Activity batch too large", 413);
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
      if (
        Number.isInteger(body.dropped) &&
        body.dropped > 0 &&
        body.dropped < 1_000_000
      )
        traceEvent("ui.collection_gap", {
          dropped: body.dropped,
          client_reported: true,
        });
      for (const event of body.events) {
        if (
          !event ||
          !CLIENT_EVENTS.has(event.kind) ||
          typeof event.route !== "string" ||
          event.route.length > 2048
        )
          continue;
        const details: Record<string, unknown> = {
          client_reported: true,
          page: normaliseTracePath(event.route),
        };
        if (typeof event.api_route === 'string' && event.api_route.length <= 2048) details.api_route = normaliseTracePath(event.api_route);
        if (['Error', 'TypeError', 'ReferenceError'].includes(event.error_class)) details.error_class = event.error_class;
        if (Array.isArray(event.frames)) details.frames = event.frames.filter((frame: unknown) => typeof frame === 'string' && /^\/assets\/[A-Za-z0-9_.-]{1,128}\.js:\d{1,8}:\d{1,8}$/.test(frame)).slice(0, 8);
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
        if (typeof event.checked === "boolean") details.checked = event.checked;
        if (
          typeof event.client_time === "string" &&
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(event.client_time) &&
          Number.isFinite(Date.parse(event.client_time))
        )
          details.client_time = event.client_time.slice(0, 32);
        traceEvent("ui." + event.kind, details);
      }
      return new Response(null, { status: 204 });
    }
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
      if (
        !window ||
        !(await traceFiles(directory, window)).some((f) => !f.health)
      )
        return errorResponse("Log window not found", 404);
      return new Response(
        Readable.toWeb(
          Readable.from(streamTraceWindow(directory, window)),
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
    return jsonResponse({ ...status, collection: traceHealth(), ...tail }, 200, { 'Cache-Control': 'no-store' });
  } catch (error) {
    if (error instanceof Response) return error;
    return errorResponse("Diagnostic logs are unavailable", 503);
  }
}
