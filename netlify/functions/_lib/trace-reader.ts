import { constants } from "node:fs";
import { readdir, lstat, open } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
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
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        if (file.bytes > 16384) throw new Error("Invalid health record");
        health.push(JSON.parse(await handle.readFile("utf8")));
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
      constants.O_RDONLY | constants.O_NOFOLLOW,
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
        record = JSON.parse(line);
      } catch {
        invalid++;
        continue;
      }
      if (record.schema !== 1 || !record.time || !record.data) continue;
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
        (!options.requestId || record.request_id === options.requestId) &&
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
    /failure|exception|crash|rejection|invalid|collection_gap|console\.(warn|error)/.test(
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
    Number(record.data.status) >= 400 ||
    ["failed", "errors", "results_failed", "errors_count"].some(
      (key) => Number(record.data[key]) > 0,
    )
  );
}
export async function* streamTraceWindow(directory: string, window: string) {
  const files = (await traceFiles(directory, window))
    .filter((f) => !f.health)
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const file of files) {
    const handle = await open(
      join(directory, file.name),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    ).catch(() => null);
    if (!handle) continue;
    try {
      for await (const chunk of handle.createReadStream({ autoClose: false }))
        yield chunk as Buffer;
    } finally {
      await handle.close();
    }
    yield Buffer.from("\n");
  }
}
export async function buildTraceReport(
  directory: string,
  from: Date,
  to: Date,
) {
  const status = await traceStatus(directory);
  const files = (await traceFiles(directory)).filter((f) => !f.health);
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
  const eventCounts: Record<string, number> = {},
    routes: Record<string, number> = {},
    statuses: Record<string, number> = {};
  const problems: TraceRecord[] = [];
  const requests = new Map<string, TraceRecord["actor"]>();
  const committedTransactions = new Set<string>();
  let clientDrops = 0;
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
        constants.O_RDONLY | constants.O_NOFOLLOW,
      ).catch(() => null);
      if (!handle) continue;
      try {
        const lines = createInterface({
          input: handle.createReadStream({ autoClose: false }),
          crlfDelay: Infinity,
        });
        for await (const line of lines) {
          if (!line) continue;
          if (line.length > 8192) {
            invalid++;
            continue;
          }
          try {
            const record = JSON.parse(line) as TraceRecord;
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
    if (record.event === "ui.collection_gap")
      clientDrops += Number(record.data.dropped) || 0;
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
        features: {},
        actions: {},
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
  const writers = (
    status.writers as Array<{
      window: string;
      dropped?: number;
      write_errors?: number;
      budget_evictions?: number;
      started_at?: string;
      observed_at?: string;
      closed?: boolean;
    }>
  ).filter(
    (w) =>
      w.window >= traceWindow(from) &&
      w.window <= traceWindow(new Date(to.getTime() - 1)),
  );
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
      collection_started_after_from:
        !firstCollection || Date.parse(firstCollection) > from.getTime(),
      first_event: first,
      client_reported_drops: clientDrops,
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
