import { createHash, randomUUID } from "node:crypto";
import { traceWindow } from "./trace-writer.js";
import { constants } from "node:fs";
import { mkdir, open, readdir, lstat, link, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { buildTraceReport } from "./trace-reader.js";

export function traceWindowBounds(window: string): { from: Date; to: Date } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(window)) throw new Error("Invalid window");
  const date = new Date(window + "T09:00:00Z");
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== window
  )
    throw new Error("Invalid window");
  const londonHour = (value: Date) =>
    Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/London",
        hour: "2-digit",
        hourCycle: "h23",
      }).format(value),
    );
  const from = new Date(date.getTime() - (londonHour(date) - 9) * 3600000);
  date.setUTCDate(date.getUTCDate() + 1);
  const to = new Date(date.getTime() - (londonHour(date) - 9) * 3600000);
  return { from, to };
}
type Report = Awaited<ReturnType<typeof buildTraceReport>>;
type Checkpoint = {
  schema: number;
  window: string;
  from: string;
  to: string;
  totals: Report["totals"];
  coverage: Report["coverage"];
  event_counts: Record<string, number>;
  humans: Array<{
    id: string;
    first: string;
    last: string;
    meaningful_events: number;
    problems: number;
    features: Record<string, number>;
  }>;
};
async function checkpointDirectory(directory: string) {
  const path = join(directory, "reports");
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077)
    throw new Error("Checkpoint storage is unavailable");
  return path;
}
// Publish immutable candidates with an atomic hard link. Concurrent CLI runs
// cannot replace a stronger checkpoint. Legacy YYYY-MM-DD.json is a candidate too.
const CHECKPOINT_FILE =
  /^(\d{4}-\d{2}-\d{2})(?:\.(\d{12})(?:\.([0-9a-f]{64})(?:\.[0-9a-f]{32})?)?\.v2)?\.json$/;
async function readCheckpoint(
  path: string,
  name: string,
): Promise<Checkpoint | null> {
  const match = CHECKPOINT_FILE.exec(name);
  if (!match) return null;
  const file = await open(
    join(path, name),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  ).catch(() => null);
  if (!file) return null;
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) return null;
    const bytes = await file.readFile();
    if (
      match[3] &&
      createHash("sha256").update(bytes).digest("hex") !== match[3]
    )
      return null;
    const c = JSON.parse(bytes.toString("utf8"));
    const bounds = traceWindowBounds(match[1]);
    if (
      c.schema !== 1 ||
      c.window !== match[1] ||
      c.from !== bounds.from.toISOString() ||
      c.to !== bounds.to.toISOString() ||
      !c.totals ||
      !Number.isSafeInteger(c.totals.events) ||
      c.totals.events < 0 ||
      !Number.isSafeInteger(c.totals.http_requests) ||
      c.totals.http_requests < 0 ||
      (match[2] && Number(match[2]) !== c.totals.events) ||
      !c.coverage ||
      !Array.isArray(c.humans) ||
      !c.humans.every(
        (h: Checkpoint["humans"][number]) =>
          h &&
          typeof h.id === "string" &&
          Number.isSafeInteger(h.meaningful_events) &&
          h.meaningful_events >= 0,
      )
    )
      return null;
    return c;
  } catch {
    return null;
  } finally {
    await file.close();
  }
}
export async function writeTraceCheckpoint(
  directory: string,
  window: string,
  report: Report,
) {
  const bounds = traceWindowBounds(window);
  if (
    bounds.from.toISOString() !== report.from ||
    bounds.to.toISOString() !== report.to ||
    bounds.to > new Date()
  )
    throw new Error("Checkpoint requires an exact completed rotation window");
  if (!report.storage.writers.some((writer) => writer.window === window))
    return {
      written: false,
      reason: "No collection evidence exists for this window",
    };
  const path = await checkpointDirectory(directory);
  const checkpoint: Checkpoint = {
    schema: 1,
    window,
    from: report.from,
    to: report.to,
    totals: report.totals,
    coverage: report.coverage,
    event_counts: report.event_counts,
    humans: report.actors
      .filter(
        (a) =>
          a.actor?.type === "human" && a.actor.id && a.meaningful_events > 0,
      )
      .map((a) => ({
        id: a.actor!.id!,
        first: a.first,
        last: a.last,
        meaningful_events: a.meaningful_events,
        problems: a.problems,
        features: a.features,
      })),
  };
  const content = JSON.stringify(checkpoint);
  if (Buffer.byteLength(content) > 2 * 1024 * 1024)
    throw new Error("Checkpoint exceeds its 2 MiB budget");
  const count = report.totals.events;
  if (!Number.isSafeInteger(count) || count < 0 || count > 999999999999)
    throw new Error("Invalid checkpoint count");
  const digest = createHash("sha256").update(content).digest("hex");
  const name =
    window +
    "." +
    String(count).padStart(12, "0") +
    "." +
    digest +
    "." +
    randomUUID().replaceAll("-", "") +
    ".v2.json";
  const legacy = await readCheckpoint(path, window + ".json");
  if (legacy && legacy.totals.events > count)
    return {
      written: false,
      reason: "An existing checkpoint contains more evidence",
    };
  const temporary = join(path, "." + randomUUID() + ".tmp");
  const file = await open(
    temporary,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    try {
      await file.writeFile(content);
    } finally {
      await file.close();
    }
    await link(temporary, join(path, name)).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      },
    );
  } finally {
    await unlink(temporary);
  }

  const names = (await readdir(path))
    .filter((n) => CHECKPOINT_FILE.test(n))
    .sort()
    .reverse();
  const windows = [...new Set(names.map((n) => n.slice(0, 10)))];
  // Read candidate contents before pruning. A truncated file can still have a
  // plausible higher-count filename. Tied snapshots prefer verified coverage.
  let strongestCount = -1,
    strongestComplete = false,
    newest = "";
  const valid = new Set<string>();
  for (const candidate of names.filter(
    (n) => n.startsWith(window + ".") && n.endsWith(".v2.json"),
  )) {
    const c = await readCheckpoint(path, candidate);
    if (!c) continue;
    valid.add(candidate);
    const complete = c.coverage.component_coverage_incomplete === false;
    if (
      c.totals.events > strongestCount ||
      (c.totals.events === strongestCount && complete && !strongestComplete)
    ) {
      strongestCount = c.totals.events;
      strongestComplete = complete;
      newest = candidate;
    }
  }
  if (!newest) throw new Error("Checkpoint publication could not be verified");
  for (const candidate of names) {
    // Only weaker immutable candidates and expired checkpoints can be removed.
    if (
      !windows.slice(0, 35).includes(candidate.slice(0, 10)) ||
      (valid.has(candidate) && candidate !== newest)
    ) {
      await unlink(join(path, candidate)).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        },
      );
    }
  }
  if (newest !== name)
    return {
      written: false,
      reason: "An existing checkpoint contains more evidence",
    };
  return { written: true };
}
export async function traceComparisons(directory: string, to: Date) {
  let path: string;
  try {
    path = join(directory, "reports");
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink() || info.mode & 0o077)
      throw new Error("Checkpoint storage is unavailable");
  } catch {
    return { available: false, note: "No checkpoints are available" };
  }
  const names = (await readdir(path))
    .filter((n) => CHECKPOINT_FILE.test(n))
    .sort()
    .reverse();
  const windows = new Set(
    [...new Set(names.map((n) => n.slice(0, 10)))].slice(0, 35),
  );
  const checkpoints = new Map<string, Checkpoint>();
  for (const name of names) {
    if (!windows.has(name.slice(0, 10))) continue;
    const c = await readCheckpoint(path, name);
    if (!c || Date.parse(c.to) > to.getTime()) continue;
    const previous = checkpoints.get(c.window);
    if (
      !previous ||
      c.totals.events > previous.totals.events ||
      (c.totals.events === previous.totals.events && name.endsWith(".v2.json"))
    )
      checkpoints.set(c.window, c);
  }
  const rolling = (days: number) => {
    const currentWindow = traceWindow(to);
    const earliest = new Date(currentWindow + "T12:00:00Z");
    earliest.setUTCDate(earliest.getUTCDate() - days);
    const firstWindow = earliest.toISOString().slice(0, 10);
    const selected = [...checkpoints.values()].filter(
      (c) => c.window >= firstWindow && c.window < currentWindow,
    );
    const humans = new Set(selected.flatMap((c) => c.humans.map((h) => h.id)));
    return {
      requested_days: days,
      windows_available: selected.length,
      active_humans: humans.size,
      meaningful_human_events: selected.reduce(
        (n, c) => n + c.humans.reduce((m, h) => m + h.meaningful_events, 0),
        0,
      ),
      http_requests: selected.reduce((n, c) => n + c.totals.http_requests, 0),
      partial_history:
        selected.length < days ||
        selected.some(
          (c) =>
            c.coverage.component_coverage_incomplete !== false ||
            c.coverage.actor_limit_reached ||
            c.coverage.actor_correlation_limited ||
            c.coverage.transaction_correlation_limited ||
            c.coverage.unavailable_files ||
            c.coverage.invalid_health_records ||
            c.coverage.collection_started_after_from ||
            c.coverage.dropped_events ||
            c.coverage.write_errors ||
            c.coverage.invalid_lines ||
            c.coverage.client_reported_drops ||
            c.coverage.client_unconfirmed_events ||
            c.coverage.budget_evictions ||
            c.coverage.unclosed_stale_writers,
        ),
    };
  };
  return {
    available: checkpoints.size > 0,
    seven_days: rolling(7),
    thirty_days: rolling(30),
    note: "Daily checkpoints contain aggregates and human identifiers, not raw event history. New collection has no speculative backfill.",
  };
}
