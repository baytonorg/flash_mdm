import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { TraceWriter, traceWindow } from "./trace-writer.js";
import {
  normaliseTracePath,
  responseOutcome,
  traceFeature,
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
const nativeWarn = console.warn.bind(console);
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
      data,
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
        ['failure', 'partial_failure', 'rejected', 'transport_failure', 'dead', 'delivery_uncertain'].includes(String(data.outcome)) ||
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
export function traceError(error: unknown): Record<string, unknown> {
  const value =
    error && typeof error === "object"
      ? (error as { name?: unknown; code?: unknown; stack?: unknown })
      : {};
  const name =
    typeof value.name === "string" &&
    /^[A-Za-z][A-Za-z0-9]{0,48}Error$/.test(value.name)
      ? value.name
      : "Error";
  const code =
    typeof value.code === "string" && /^(?:[0-9A-Z_]{2,48})$/.test(value.code)
      ? value.code
      : undefined;
  // Source locations only, never the first stack line (which contains the message).
  const frames =
    typeof value.stack === "string"
      ? value.stack
          .split("\n")
          .slice(1, 9)
          .map(
            (line) =>
              line.match(/([A-Za-z0-9_.-]+\.[cm]?[jt]sx?):(\d+):(\d+)/)?.[0],
          )
          .filter(Boolean)
      : [];
  return { error_class: name, error_code: code, frames };
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
    return responseOutcome(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch {
    return { detail: "unavailable" };
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
      traceEvent("http.start", { method: request.method });
      let response: Response;
      try {
        response = await fn();
      } catch (error) {
        if (error instanceof Response) response = error;
        else {
          traceEvent("http.exception", traceError(error));
          traceEvent("http.end", {
            method: request.method,
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
      const detail = await Promise.race([
        traceResponseOutcome(response),
        new Promise<Record<string, unknown>>((resolve) => {
          const timeout = setTimeout(
            () => resolve({ detail: "time_limit" }),
            20,
          );
          timeout.unref();
        }),
      ]);
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
        detail.result_status === "error";
      const responseKind = response.headers.get('content-type')?.includes('application/json') ? 'json' : response.headers.get('content-type')?.includes('text/html') ? 'html' : 'other';
      if (url.pathname.startsWith('/api/') && status >= 200 && status < 300 && responseKind === 'html') outcome = 'protocol_failure';
      traceEvent("http.end", {
        method: request.method,
        status,
        response_kind: responseKind,
        outcome: logicalFailure && status < 400 ? "partial_failure" : outcome,
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
  provider: string,
  operation: string,
  input: string,
  init?: RequestInit,
): Promise<Response> {
  const started = performance.now();
  try {
    const response = await fetch(input, init);
    traceEvent("provider." + provider, {
      operation,
      method: init?.method ?? "GET",
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
    traceEvent("process.crash", traceError(error));
    nativeWarn("Operational trace observed an uncaught exception");
  });
  traceEvent("process.start", {
    version: process.env.FLASH_RELEASE_COMMIT ?? "unknown",
  });
}
