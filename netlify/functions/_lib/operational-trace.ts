import { writeSync } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { TraceWriter, traceWindow } from "./trace-writer.js";
import {
  normaliseTracePath,
  responseOutcome,
  traceFeature,
  traceHttpMethod,
  UUID_PATTERN,
} from "../../../shared/trace-contract.js";
import { runWithoutAuditAuthContext } from "./request-auth-context.js";

export type TraceActor = {
  type:
    | "human"
    | "api_key"
    | "system"
    | "scheduled"
    | "webhook"
    | "support"
    | "anonymous";
  id?: string;
  email?: string;
  role?: string;
  operator_id?: string;
};
type PollGate = {
  records: Record<string, unknown>[];
  open: boolean;
  queries: number;
};
type TraceContext = {
  requestId: string;
  spanId: string;
  parentSpanId?: string;
  actor: TraceActor;
  scope: Record<string, string>;
  route?: string;
  feature?: string;
  gate?: PollGate;
};
const storage = new AsyncLocalStorage<TraceContext>();
let writer: TraceWriter | undefined;
let sequence = 0;
let idlePolls = 0,
  idleQueries = 0,
  idleReportedAt = 0;

const component = () =>
  process.env.FLASH_TRACE_COMPONENT === "worker"
    ? "worker"
    : process.env.FLASH_TRACE_COMPONENT === "operator"
      ? "operator"
      : "web";

function sink(): TraceWriter | undefined {
  if (!process.env.FLASH_TRACE_DIR) return undefined;
  if (!writer)
    writer = new TraceWriter({
      directory: process.env.FLASH_TRACE_DIR,
      component: component(),
    });
  return writer;
}
export function traceHealth() {
  return (
    writer?.health() ?? {
      enabled: !!process.env.FLASH_TRACE_DIR,
      accepting: !!process.env.FLASH_TRACE_DIR,
      queued_bytes: 0,
      accepted: 0,
      written: 0,
      dropped: 0,
      write_errors: 0,
    }
  );
}
export async function flushOperationalTrace() {
  await writer?.flush();
}
export async function closeOperationalTrace() {
  await writer?.close();
  writer = undefined;
}
export function traceContext() {
  return storage.getStore();
}
export function setTraceActor(
  actor: TraceActor,
  scope: Record<string, string | null | undefined> = {},
) {
  const ctx = storage.getStore();
  if (!ctx) return;
  ctx.actor = actor;
  for (const [key, value] of Object.entries(scope))
    if (value && UUID_PATTERN.test(value)) ctx.scope[key] = value;
}

// Only instrumentation-owned metadata is accepted here. Never pass body/params,
// SQL text, headers, provider payloads or arbitrary Error objects to this sink.
export function traceEvent(
  event: string,
  data: Record<string, unknown> = {},
  actor?: TraceActor,
): void {
  try {
    const target = sink();
    if (!target) return;
    const ctx = storage.getStore();
    const time = new Date().toISOString();
    const page =
      event.startsWith("ui.") && typeof data.page === "string"
        ? normaliseTracePath(data.page)
        : undefined;
    const record = {
      schema: 1,
      time,
      window: traceWindow(new Date(time)),
      event,
      component: component(),
      pid: process.pid,
      sequence: ++sequence,
      request_id: ctx?.requestId,
      span_id: ctx?.spanId,
      parent_span_id: ctx?.parentSpanId,
      actor: actor ?? ctx?.actor ?? { type: "system" },
      scope: ctx?.scope ?? {},
      route: page ?? ctx?.route,
      feature: page ? traceFeature(page) : ctx?.feature,
      // Provider and job IDs can originate in request data. Only resource
      // identifiers in the UUID contract are diagnostic fields.
      data: Object.fromEntries(Object.entries(data).filter(([key, value]) =>
        !key.endsWith("_id") || (typeof value === "string" && UUID_PATTERN.test(value)))),
    };
    if (ctx?.gate && !ctx.gate.open) {
      if (event === "db.query.start") ctx.gate.queries++;
      const active =
        event.startsWith("job.") ||
        event.startsWith("provider.") ||
        event.startsWith("audit.") ||
        (event === "db.rows" &&
          ["job_queue", "deployment_jobs"].includes(String(data.table)) &&
          Number(data.rows) > 0);
      const problem =
        [
          "failure",
          "partial_failure",
          "protocol_failure",
          "rejected",
          "transport_failure",
          "dead",
          "delivery_uncertain",
        ].includes(String(data.outcome)) ||
        Number(data.status) >= 400 ||
        /exception|console\.(warn|error)/.test(event);
      if (!active && !problem && ctx.gate.records.length < 2048) {
        ctx.gate.records.push(record);
        return;
      }
      ctx.gate.open = true;
      for (const buffered of ctx.gate.records) target.write(buffered);
      ctx.gate.records = [];
    }
    target.write(record);
  } catch {
    /* Diagnostic failure must not change the product result. */
  }
}
const TRACE_ERROR_NAMES = new Set(["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "AbortError", "AggregateError", "AmapiDeliveryUncertainError"]);
const TRACE_ERROR_CODES = new Set("23502 23503 23505 23514 22P02 25P02 40001 40P01 42501 42601 42703 42P01 53300 53400 57014 57P01 57P02 57P03 08000 08001 08003 08004 08006 08007 08P01 ECONNREFUSED ECONNRESET EAI_AGAIN EHOSTUNREACH ENETDOWN ENETUNREACH ENOTFOUND EPIPE ETIMEDOUT AMAPI_DELIVERY_UNCERTAIN".split(" "));
const TRACE_SOURCE_NAMES = new Set("server worker auth audit helpers db operational-trace trace-reader trace-writer trace-checkpoints amapi stripe resend outbound-webhook flashagent-runtime sync-process-background deployment-jobs deployment-jobs-background workflow-evaluate-background pubsub-webhook stripe-webhook workspace-billing-webhook".split(" "));
export function traceError(error: unknown): Record<string, unknown> {
  try {
    if (!(error instanceof Error)) return { error_class: "Error", frames: [] };
    const name = TRACE_ERROR_NAMES.has(error.name) ? error.name : "Error";
    const code = (error as Error & { code?: unknown }).code;
    const prefix = error.toString();
    // V8 includes the entire (possibly multiline) message before its frames.
    // Never scan continuation lines of a provider response as source locations.
    const stack = error.stack;
    const frames = typeof stack === "string" && stack.startsWith(prefix + "\n")
      ? stack.slice(prefix.length + 1, prefix.length + 8193).split("\n", 8).flatMap(line => {
          const match = /^\s+at .*[\/\\]([a-zA-Z0-9_.-]+)\.[cm]?[jt]sx?:(\d{1,8}):(\d{1,8})\)?$/.exec(line);
          if (!match) return [];
          const [, file, row, column] = match;
          const module = TRACE_SOURCE_NAMES.has(file) ? file : "source-" + createHash("sha256").update(file).digest("hex").slice(0, 12);
          return [module + ":" + row + ":" + column];
        })
      : [];
    return { error_class: name, error_code: typeof code === "string" && TRACE_ERROR_CODES.has(code) ? code : undefined, frames };
  } catch {
    return { error_class: "Error", frames: [] };
  }
}
export async function traceSpan<T>(
  event: string,
  data: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  const parent = storage.getStore();
  if (!parent || !process.env.FLASH_TRACE_DIR) return fn();
  const child = {
    ...parent,
    spanId: randomUUID(),
    parentSpanId: parent.spanId,
  };
  const started = performance.now();
  return storage.run(child, async () => {
    traceEvent(event + ".start", data);
    try {
      const result = await fn();
      traceEvent(event + ".end", {
        ...data,
        outcome: "success",
        duration_ms: Math.round((performance.now() - started) * 100) / 100,
      });
      return result;
    } catch (error) {
      traceEvent(event + ".end", {
        ...data,
        outcome: "failure",
        duration_ms: Math.round((performance.now() - started) * 100) / 100,
        ...traceError(error),
      });
      throw error;
    }
  });
}

export async function traceResponseOutcome(
  response: Response,
): Promise<Record<string, unknown>> {
  if (
    !response.headers.get("content-type")?.includes("application/json") ||
    !response.body
  )
    return {};
  if (Number(response.headers.get("content-length")) > 32768)
    return { detail: "size_limit" };
  const reader = response.clone().body!.getReader();
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  const inspect = async (): Promise<Record<string, unknown>> => {
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > 32768) {
          void reader.cancel().catch(() => {});
          return { detail: "size_limit" };
        }
        chunks.push(next.value);
      }
      return responseOutcome(
        JSON.parse(Buffer.concat(chunks).toString("utf8")),
      );
    } catch {
      return { detail: "unavailable" };
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      inspect(),
      new Promise<Record<string, unknown>>((resolve) => {
        timer = setTimeout(() => {
          resolve({ detail: "time_limit" });
          void reader.cancel().catch(() => {});
        }, 20);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function traceHttp(
  request: Request,
  fn: () => Promise<Response>,
): Promise<Response> {
  if (storage.getStore()) return fn();
  if (!process.env.FLASH_TRACE_DIR) return fn();
  const url = new URL(request.url);
  const ctx: TraceContext = {
    requestId: randomUUID(),
    spanId: randomUUID(),
    actor: { type: "anonymous" },
    scope: {},
    route: normaliseTracePath(url.pathname),
    feature: traceFeature(url.pathname),
  };
  if (component() === "worker")
    ctx.gate = { records: [], open: false, queries: 0 };
  const resourceScopes: Record<string, string> = {
    workspaces: "workspace_id",
    environments: "environment_id",
    groups: "group_id",
    devices: "device_id",
    policies: "policy_id",
    apps: "app_id",
    networks: "network_id",
    workflows: "workflow_id",
    geofences: "geofence_id",
  };
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[0] === "api")
    for (let index = 1; index < segments.length - 1; index++) {
      const scope = resourceScopes[segments[index]];
      if (scope && UUID_PATTERN.test(segments[index + 1]))
        ctx.scope[scope] = segments[index + 1];
    }
  for (const key of [
    "workspace_id",
    "environment_id",
    "group_id",
    "device_id",
    "policy_id",
  ]) {
    const value = url.searchParams.get(key);
    if (value && UUID_PATTERN.test(value)) ctx.scope[key] = value;
  }
  return runWithoutAuditAuthContext(() =>
    storage.run(ctx, async () => {
      const started = performance.now();
      traceEvent("http.start", { method: traceHttpMethod(request.method) });
      let response: Response;
      try {
        response = await fn();
      } catch (error) {
        if (error instanceof Response) response = error;
        else {
          traceEvent("http.exception", traceError(error));
          traceEvent("http.end", {
            method: traceHttpMethod(request.method),
            status: 500,
            outcome: "failure",
            duration_ms: Math.round(performance.now() - started),
          });
          throw error;
        }
      } finally {
        // The completion event below is authoritative for identity. Auth can be
        // established after the request-start event and its first DB spans.
      }
      const status = response.status;
      let outcome =
        status >= 500 ? "failure" : status >= 400 ? "rejected" : "success";
      const detail = await traceResponseOutcome(response).catch(
        () => ({ detail: "unavailable" }) as Record<string, unknown>,
      );
      if (
        status === 401 &&
        (detail.needs_totp === true || detail.needs_mfa === true)
      )
        outcome = "challenge";
      const logicalFailure =
        ["failed", "errors", "results_failed", "errors_count"].some(
          (key) => Number(detail[key]) > 0,
        ) ||
        detail.success === false ||
        detail.result_status === "failed" ||
        detail.result_status === "error" ||
        detail.result_status === "partial" || detail.result_status === "degraded";
      const responseKind = response.headers
        .get("content-type")
        ?.includes("application/json")
        ? "json"
        : response.headers.get("content-type")?.includes("text/html")
          ? "html"
          : "other";
      if (
        url.pathname.startsWith("/api/") &&
        status >= 200 &&
        status < 300 &&
        responseKind === "html"
      )
        outcome = "protocol_failure";
      traceEvent("http.end", {
        method: traceHttpMethod(request.method),
        status,
        response_kind: responseKind,
        outcome: status < 400 && detail.result_status === "delivery_uncertain" ? "delivery_uncertain" : logicalFailure && status < 400 ? "partial_failure" : outcome,
        duration_ms: Math.round((performance.now() - started) * 100) / 100,
        ...detail,
      });
      if (ctx.gate && !ctx.gate.open) {
        idlePolls++;
        idleQueries += ctx.gate.queries;
        if (Date.now() - idleReportedAt >= 60_000) {
          ctx.gate.open = true;
          traceEvent("worker.idle_summary", {
            polls: idlePolls,
            database_queries: idleQueries,
            outcome: "success",
          });
          idlePolls = 0;
          idleQueries = 0;
          idleReportedAt = Date.now();
        }
      }
      const headers = new Headers(response.headers);
      headers.set("X-Flash-Request-ID", ctx.requestId);
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }),
  );
}

export async function tracedFetch(
  provider: "mail" | "webhook" | "flash" | "openai",
  operation: "send" | "workflow_send" | "assistant_read" | "chat_completion",
  input: string,
  init?: RequestInit,
): Promise<Response> {
  const started = performance.now();
  try {
    const response = await fetch(input, init);
    traceEvent("provider." + provider, {
      operation,
      method: traceHttpMethod(init?.method ?? "GET"),
      status: response.status,
      outcome: response.ok ? "success" : "failure",
      duration_ms: Math.round(performance.now() - started),
    });
    return response;
  } catch (error) {
    traceEvent("provider." + provider, {
      operation,
      outcome: "transport_failure",
      duration_ms: Math.round(performance.now() - started),
      ...traceError(error),
    });
    throw error;
  }
}

let consoleInstalled = false;
export function installOperationalConsoleCapture() {
  if (consoleInstalled || !process.env.FLASH_TRACE_DIR) return;
  consoleInstalled = true;
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      try {
        const first = typeof args[0] === "string" ? args[0] : "";
        traceEvent("console." + level, {
          message_fingerprint: createHash("sha256").update(first).digest("hex"),
          ...traceError(args.find((a) => a instanceof Error) ?? new Error()),
        });
      } catch {
        /* Keep the original console behaviour. */
      }
      original(...args);
    };
  }
  process.on("uncaughtExceptionMonitor", (error) => {
    // The process exits before the async writer can drain. Emit one bounded
    // event to the service journal without changing Node's fatal exit behaviour.
    try { writeSync(2, JSON.stringify({ event: "process.crash", component: component(), pid: process.pid, ...traceError(error) }) + "\n"); }
    catch { /* The journal can also be unavailable during termination. */ }
  });
  traceEvent("process.start", {
    version: /^[a-f0-9]{40}$/.test(process.env.FLASH_RELEASE_COMMIT ?? "") ? process.env.FLASH_RELEASE_COMMIT : "unknown",
  });
}
