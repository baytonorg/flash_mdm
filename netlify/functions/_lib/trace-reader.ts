import { constants } from "node:fs";
import { readdir, lstat, open } from "node:fs/promises";
import { join } from "node:path";
import type { FileHandle } from "node:fs/promises";
import { traceWindow } from "./trace-writer.js";

export type TraceRecord = {
  schema: number;
  time: string;
  event: string;
  request_id?: string;
  span_id?: string;
  actor?: { type: string; id?: string; email?: string; operator_id?: string };
  route?: string;
  feature?: string;
  scope?: Record<string, string>;
  data: Record<string, unknown>;
};
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function timestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
function parseRecord(line: string): TraceRecord {
  const r: unknown = JSON.parse(line);
  if (
    !object(r) ||
    r.schema !== 1 ||
    !timestamp(r.time) ||
    typeof r.event !== "string" ||
    !object(r.data) ||
    !Object.values(r.data).every(
      (v) =>
        v === null ||
        ["string", "boolean", "number"].includes(typeof v) ||
        (Array.isArray(v) && v.every((item) => typeof item === "string")),
    ) ||
    ![r.route, r.feature, r.request_id, r.span_id].every(
      (v) => v === undefined || typeof v === "string",
    ) ||
    (r.actor !== undefined &&
      (!object(r.actor) ||
        typeof r.actor.type !== "string" ||
        ![r.actor.id, r.actor.email, r.actor.operator_id].every(
          (v) => v === undefined || typeof v === "string",
        )))
  )
    throw new Error("Invalid trace record");
  return r as TraceRecord;
}
const TRACE_FILE =
  /^(\d{4}-\d{2}-\d{2})\.(web|worker|operator|test)\.\d+(?:-[a-f0-9]{8})?\.\d{5}\.ndjson$/;
const HEALTH_FILE =
  /^(\d{4}-\d{2}-\d{2})\.(web|worker|operator|test)\.\d+(?:-[a-f0-9]{8})?\.health\.json$/;
export async function traceFiles(directory: string, window?: string) {
  const root = await lstat(directory);
  if (!root.isDirectory() || root.isSymbolicLink() || root.mode & 0o077)
    throw new Error("Diagnostic storage is unavailable");
  const entries = [];
  for (const name of await readdir(directory)) {
    if (
      (!TRACE_FILE.test(name) && !HEALTH_FILE.test(name)) ||
      (window && !name.startsWith(window + "."))
    )
      continue;
    const stat = await lstat(join(directory, name)).catch(() => null);
    if (stat?.isFile() && !stat.isSymbolicLink())
      entries.push({
        name,
        bytes: stat.size,
        modified_at: stat.mtime.toISOString(),
        health: HEALTH_FILE.test(name),
        window: name.slice(0, 10),
      });
  }
  return entries.sort(
    (a, b) =>
      b.modified_at.localeCompare(a.modified_at) ||
      b.name.localeCompare(a.name),
  );
}
export async function traceStatus(directory: string) {
  const files = await traceFiles(directory);
  const windows = [...new Set(files.map((f) => f.window))].sort().reverse();
  const health = [];
  let invalidHealth = 0;
  for (const file of files.filter((f) => f.health)) {
    try {
      const handle = await open(
        join(directory, file.name),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > 16384)
          throw new Error("Invalid health record");
        const writer = JSON.parse(await handle.readFile("utf8"));
        if (
          !object(writer) ||
          writer.schema !== 1 ||
          writer.window !== file.window ||
          !["web", "worker", "test", "operator", "retention"].includes(
            String(writer.component),
          ) ||
          !timestamp(writer.observed_at) ||
          typeof writer.closed !== "boolean" ||
          (writer.component !== "retention" &&
            (!timestamp(writer.started_at) ||
              !timestamp(writer.window_started_at))) ||
          ![
            writer.dropped,
            writer.write_errors,
            writer.budget_evictions,
            writer.heartbeat_gaps,
          ].every(
            (n) =>
              n === undefined ||
              (typeof n === "number" && Number.isSafeInteger(n) && n >= 0),
          )
        )
          throw new Error("Invalid writer health");
        health.push(
          writer as {
            window: string;
            component: string;
            observed_at: string;
            closed: boolean;
            started_at?: string;
            window_started_at?: string;
            dropped?: number;
            write_errors?: number;
            budget_evictions?: number;
            heartbeat_gaps?: number;
          },
        );
      } finally {
        await handle.close();
      }
    } catch {
      invalidHealth++;
    }
  }
  return {
    enabled: true,
    rotation: "09:00 Europe/London",
    current_window: traceWindow(),
    retained_windows: windows,
    raw_windows: [
      ...new Set(files.filter((f) => !f.health).map((f) => f.window)),
    ]
      .sort()
      .reverse(),
    bytes: files.reduce((n, f) => n + f.bytes, 0),
    files: files.length,
    invalid_health_records: invalidHealth,
    components: ["web", "worker"].map((component) => ({
      component,
      fresh: health.some(
        (writer) =>
          writer.component === component &&
          writer.window === traceWindow() &&
          !writer.closed &&
          Date.now() - Date.parse(writer.observed_at) < 120_000,
      ),
    })),
    writers: health,
  };
}
export async function readTraceTail(
  directory: string,
  options: {
    window?: string;
    actor?: string;
    requestId?: string;
    outcome?: string;
    limit?: number;
  } = {},
) {
  const files = (await traceFiles(directory, options.window)).filter(
    (f) => !f.health,
  );
  const rows: TraceRecord[] = [];
  let scanned = 0,
    invalid = 0;
  const budget = 4 * 1024 * 1024;
  for (const file of files) {
    if (scanned >= budget) break;
    const length = Math.min(file.bytes, 512 * 1024, budget - scanned);
    const start = Math.max(0, file.bytes - length);
    const handle = await open(
      join(directory, file.name),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    ).catch(() => null);
    if (!handle) continue;
    let buffer: Buffer;
    try {
      buffer = Buffer.alloc(length);
      const result = await handle.read(buffer, 0, length, start);
      buffer = buffer.subarray(0, result.bytesRead);
    } finally {
      await handle.close();
    }
    scanned += buffer.length;
    const lines = buffer.toString("utf8").split("\n");
    if (start) lines.shift();
    for (const line of lines) {
      if (!line) continue;
      let record: TraceRecord;
      try {
        record = parseRecord(line);
      } catch {
        invalid++;
        continue;
      }
      rows.push(record);
    }
  }
  const identities = new Map(
    rows
      .filter((r) => r.event === "http.end" && r.request_id)
      .map((r) => [r.request_id!, r.actor]),
  );
  const matching = rows
    .map((record) => {
      const established = record.request_id
        ? identities.get(record.request_id)
        : undefined;
      return record.actor?.type === "anonymous" &&
        established &&
        established.type !== "anonymous"
        ? { ...record, actor: established }
        : record;
    })
    .filter(
      (record) =>
        (!options.actor ||
          [record.actor?.id, record.actor?.email, record.actor?.type].some(
            (value) =>
              value?.toLowerCase().includes(options.actor!.toLowerCase()),
          )) &&
        (!options.requestId ||
          record.request_id === options.requestId ||
          (record.event.startsWith("ui.") &&
            record.data.server_request_id === options.requestId)) &&
        (options.outcome !== "problems" || isTraceProblem(record)),
    );
  matching.sort((a, b) => b.time.localeCompare(a.time));
  const limit = Math.max(1, Math.min(options.limit ?? 100, 200));
  return {
    events: matching.slice(0, limit),
    scanned_bytes: scanned,
    scan_limited: files.reduce((n, f) => n + f.bytes, 0) > scanned,
    invalid_lines: invalid,
    matched_in_scan: matching.length,
  };
}
export function isTraceProblem(record: TraceRecord): boolean {
  if (record.data.outcome === "challenge") return false;
  return (
    /failure|exception|crash|rejection|invalid|collection_gap|ui\.(javascript_error|react_error)|console\.(warn|error)/.test(
      record.event,
    ) ||
    [
      "failure",
      "partial_failure",
      "protocol_failure",
      "rejected",
      "transport_failure",
      "dead",
      "delivery_uncertain",
    ].includes(String(record.data.outcome)) ||
    ["delivery_uncertain", "failed", "error", "partial", "degraded"].includes(
      String(record.data.result_status),
    ) ||
    Number(record.data.status) >= 400 ||
    ["failed", "errors", "results_failed", "errors_count"].some(
      (key) => Number(record.data[key]) > 0,
    )
  );
}
export async function* streamTraceWindow(
  directory: string,
  window: string,
  snapshot?: Awaited<ReturnType<typeof traceFiles>>,
) {
  const files = (snapshot ?? (await traceFiles(directory, window)))
    .filter(
      (f) =>
        !f.health &&
        TRACE_FILE.exec(f.name)?.[1] === window &&
        Number.isSafeInteger(f.bytes) &&
        f.bytes >= 0,
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!files.length) throw new Error("Trace window unavailable");
  for (const file of files) {
    const handle = await open(
      join(directory, file.name),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    let endsWithNewline = true;
    try {
      if (!(await handle.stat()).isFile())
        throw new Error("Trace segment unavailable");
      if (!file.bytes) continue;
      let read = 0;
      for await (const chunk of handle.createReadStream({
        autoClose: false,
        end: file.bytes - 1,
      })) {
        read += chunk.length;
        endsWithNewline = chunk[chunk.length - 1] === 10;
        yield chunk as Buffer;
      }
      if (read !== file.bytes) throw new Error("Trace changed during download");
    } finally {
      await handle.close();
    }
    if (!endsWithNewline) yield Buffer.from("\n");
  }
}
// Bound memory even if a damaged segment has no line breaks. readline would
// allocate the entire malformed line before the caller can check its length.
async function* traceLines(file: FileHandle, bytes: number) {
  let fragments: Buffer[] = [],
    length = 0,
    read = 0;
  for await (const chunk of file.createReadStream({
    autoClose: false,
    end: bytes - 1,
  })) {
    const buffer = chunk as Buffer;
    read += buffer.length;
    let start = 0;
    while (start < buffer.length) {
      const lf = buffer.indexOf(10, start);
      const end = lf === -1 ? buffer.length : lf;
      length += end - start;
      if (length <= 8192 && end > start)
        fragments.push(buffer.subarray(start, end));
      if (lf === -1) break;
      yield length > 8192
        ? null
        : Buffer.concat(fragments, length).toString("utf8");
      fragments = [];
      length = 0;
      start = lf + 1;
    }
  }
  if (read !== bytes) throw new Error("Trace changed during scan");
  if (length)
    yield length > 8192
      ? null
      : Buffer.concat(fragments, length).toString("utf8");
}
export async function buildTraceReport(
  directory: string,
  from: Date,
  to: Date,
) {
  const status = await traceStatus(directory);
  const firstWindow = traceWindow(from),
    lastWindow = traceWindow(new Date(to.getTime() - 1));
  const files = (await traceFiles(directory)).filter(
    (f) =>
      !f.health &&
      f.bytes > 0 &&
      f.window >= firstWindow &&
      f.window <= lastWindow,
  );
  const unavailable = new Set<string>();
  const actors = new Map<
    string,
    {
      actor: TraceRecord["actor"];
      first: string;
      last: string;
      events: number;
      http_requests: number;
      meaningful_events: number;
      problems: number;
      features: Record<string, number>;
      actions: Record<string, number>;
    }
  >();
  const eventCounts: Record<string, number> = Object.create(null),
    routes: Record<string, number> = {},
    statuses: Record<string, number> = {};
  const problems: TraceRecord[] = [];
  const requests = new Map<string, TraceRecord["actor"]>();
  const committedTransactions = new Set<string>();
  let clientDrops = 0,
    clientUnconfirmed = 0;
  let invalid = 0,
    total = 0,
    first: string | null = null,
    last: string | null = null,
    duration = 0,
    httpCount = 0;
  // Streaming bounded records. Two passes resolve actor identity established
  // after initial auth/database spans, without treating anonymous attempts as login.
  async function* records() {
    for (const file of files) {
      const handle = await open(
        join(directory, file.name),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      ).catch(() => null);
      if (!handle) {
        unavailable.add(file.name);
        continue;
      }
      try {
        if (!(await handle.stat()).isFile()) {
          unavailable.add(file.name);
          continue;
        }
        for await (const line of traceLines(handle, file.bytes)) {
          if (line === null) {
            invalid++;
            continue;
          }
          if (!line) continue;
          try {
            const record = parseRecord(line);
            const time = Date.parse(record.time);
            if (
              record.schema === 1 &&
              time >= from.getTime() &&
              time < to.getTime() &&
              record.data
            )
              yield record;
          } catch {
            invalid++;
          }
        }
      } catch {
        unavailable.add(file.name);
      } finally {
        await handle.close();
      }
    }
  }
  for await (const record of records()) {
    if (
      record.request_id &&
      record.event === "http.end" &&
      requests.size < 250_000
    )
      requests.set(record.request_id, record.actor);
    if (
      record.event === "db.transaction.committed" &&
      record.span_id &&
      committedTransactions.size < 250_000
    )
      committedTransactions.add(record.span_id);
  }
  const actorCorrelationLimited = requests.size >= 250_000;
  invalid = 0;
  for await (const record of records()) {
    total++;
    first = !first || record.time < String(first) ? record.time : first;
    last = !last || record.time > String(last) ? record.time : last;
    eventCounts[record.event] = (eventCounts[record.event] ?? 0) + 1;
    if (record.event === "ui.collection_gap") {
      clientDrops += Number(record.data.dropped) || 0;
      clientUnconfirmed += Number(record.data.unconfirmed) || 0;
    }
    if (record.event === "http.end") {
      httpCount++;
      duration += Number(record.data.duration_ms) || 0;
      if (record.route) routes[record.route] = (routes[record.route] ?? 0) + 1;
      const key = String(record.data.status);
      statuses[key] = (statuses[key] ?? 0) + 1;
    }
    const established = record.request_id
      ? requests.get(record.request_id)
      : undefined;
    const actor =
      record.actor?.type === "anonymous" && established?.type !== "anonymous"
        ? (established ?? record.actor)
        : record.actor;
    const key = `${actor?.type ?? "unknown"}:${actor?.id ?? actor?.email ?? "unattributed"}`;
    let summary = actors.get(key);
    if (!summary && actors.size < 20_000) {
      summary = {
        actor,
        first: record.time,
        last: record.time,
        events: 0,
        http_requests: 0,
        meaningful_events: 0,
        problems: 0,
        features: Object.create(null),
        actions: Object.create(null),
      };
      actors.set(key, summary);
    }
    const problem = isTraceProblem(record);
    if (summary) {
      if (actor?.email && !summary.actor?.email) summary.actor = actor;
      summary.events++;
      summary.first = record.time < summary.first ? record.time : summary.first;
      summary.last = record.time > summary.last ? record.time : summary.last;
      if (record.event === "http.end") summary.http_requests++;
      const meaningful =
        [
          "ui.navigation",
          "ui.click",
          "ui.change",
          "ui.submit",
          "ui.invalid",
        ].includes(record.event) ||
        (record.event === "audit.write" &&
          (record.data.durability === "committed" ||
            (!!record.span_id && committedTransactions.has(record.span_id))));
      if (meaningful) {
        summary.meaningful_events++;
        const feature = record.feature ?? "other";
        summary.features[feature] = (summary.features[feature] ?? 0) + 1;
      }
      if (typeof record.data.action === "string")
        summary.actions[record.data.action] =
          (summary.actions[record.data.action] ?? 0) + 1;
      if (problem) summary.problems++;
    }
    if (problem && problems.length < 2000) problems.push({ ...record, actor });
  }
  const writers = status.writers.filter(
    (w) => w.window >= firstWindow && w.window <= lastWindow,
  );
  const end = Math.min(to.getTime(), Date.now());
  const components = ["web", "worker"].map((component) => {
    const intervals = writers
      .filter((w) => w.component === component && w.window_started_at)
      .map((w) => ({
        start: Date.parse(w.window_started_at!),
        end: Date.parse(w.observed_at),
        gaps: w.heartbeat_gaps,
        closed: w.closed,
      }))
      .filter((i) => i.end >= from.getTime() && i.start <= end)
      .sort((a, b) => a.start - b.start);
    let coveredTo = from.getTime();
    // Rotation and the heartbeat timer are asynchronous. Two heartbeat periods
    // allow ordinary handoffs while revealing stopped components and outages.
    let incomplete = intervals.length === 0 || end <= coveredTo;
    for (const interval of intervals) {
      if (interval.start > coveredTo + 120000 || interval.gaps !== 0)
        incomplete = true;
      coveredTo = Math.max(coveredTo, interval.end);
    }
    return { component, incomplete: incomplete || coveredTo + 120000 < end };
  });
  const firstCollection =
    writers
      .map((w) => w.started_at)
      .filter((value): value is string => !!value)
      .sort()[0] ?? null;
  return {
    schema: 1,
    from: from.toISOString(),
    to: to.toISOString(),
    coverage: {
      collection_started_at: firstCollection,
      components,
      component_coverage_incomplete: components.some((c) => c.incomplete),
      unavailable_files: unavailable.size,
      invalid_health_records: status.invalid_health_records,
      collection_started_after_from:
        !firstCollection || Date.parse(firstCollection) > from.getTime(),
      first_event: first,
      client_reported_drops: clientDrops,
      client_unconfirmed_events: clientUnconfirmed,
      last_event: last,
      invalid_lines: invalid,
      unclosed_stale_writers: writers.filter(
        (writer) =>
          !writer.closed &&
          !!writer.observed_at &&
          Date.parse(writer.observed_at) <
            Math.min(Date.now(), to.getTime()) - 120_000,
      ).length,
      actor_correlation_limited: actorCorrelationLimited,
      transaction_correlation_limited: committedTransactions.size >= 250_000,
      actor_limit_reached: actors.size >= 20_000,
      problem_examples_limited: problems.length >= 2000,
      dropped_events: writers.reduce((n, w) => n + (w.dropped ?? 0), 0),
      write_errors: writers.reduce((n, w) => n + (w.write_errors ?? 0), 0),
      budget_evictions: writers.reduce(
        (n, w) => n + (w.budget_evictions ?? 0),
        0,
      ),
      note: "UI events are client-reported interaction evidence. Human-attributed HTTP includes background reads and is not proof of active use. Pending transactional audit writes require a matching transaction commit. Absence of logged problems does not establish complete coverage.",
    },
    totals: {
      events: total,
      http_requests: httpCount,
      mean_http_duration_ms: httpCount ? Math.round(duration / httpCount) : 0,
      active_humans: [...actors.values()].filter(
        (a) => a.actor?.type === "human" && a.meaningful_events > 0,
      ).length,
    },
    event_counts: eventCounts,
    routes,
    statuses,
    actors: [...actors.values()],
    problems,
    storage: status,
  };
}
