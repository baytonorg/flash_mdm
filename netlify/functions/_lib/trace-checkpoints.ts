import { constants } from "node:fs";
import { mkdir, open, readdir, lstat, rename, unlink } from "node:fs/promises";
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
  if (!report.storage.writers.some(writer => writer.window === window)) return { written: false, reason: 'No collection evidence exists for this window' };
  const path = await checkpointDirectory(directory);
  const previous = await open(join(path, window + '.json'), constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => null);
  if (previous) {
    try {
      const stat = await previous.stat();
      if (stat.size > 2 * 1024 * 1024) throw new Error('Invalid checkpoint');
      const existing = JSON.parse(await previous.readFile('utf8'));
      if (existing.schema !== 1) throw new Error('Invalid checkpoint');
      if (existing.totals?.events > report.totals.events) return { written: false, reason: 'An existing checkpoint contains more evidence' };
    } finally { await previous.close(); }
  }
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
  const temporary = join(path, window + "." + process.pid + ".tmp");
  const file = await open(
    temporary,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_TRUNC |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await file.writeFile(content);
  } finally {
    await file.close();
  }
  await rename(temporary, join(path, window + ".json"));
  const retained = (await readdir(path))
    .filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n))
    .sort()
    .reverse();
  for (const name of retained.slice(35)) {
    const stat = await lstat(join(path, name));
    if (stat.isFile() && !stat.isSymbolicLink()) await unlink(join(path, name));
  }
  return { written: true };
}
export async function traceComparisons(directory: string, to: Date) {
  let path: string;
  try {
    path = join(directory, 'reports');
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink() || info.mode & 0o077) throw new Error('Checkpoint storage is unavailable');
  } catch {
    return { available: false, note: "No checkpoints are available" };
  }
  const checkpoints: Checkpoint[] = [];
  for (const name of (await readdir(path))
    .filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n))
    .sort()
    .slice(-35)) {
    const stat = await lstat(join(path, name));
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024)
      continue;
    const file = await open(
      join(path, name),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const value = JSON.parse(await file.readFile("utf8"));
      if (value.schema === 1 && Date.parse(value.to) <= to.getTime())
        checkpoints.push(value);
    } catch {
      /* A corrupt checkpoint is a visible missing day below. */
    } finally {
      await file.close();
    }
  }
  const rolling = (days: number) => {
    const selected = checkpoints.filter(
      (c) => Date.parse(c.from) >= to.getTime() - days * 86400000,
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
      partial_history: selected.length < days || selected.some(c => c.coverage.collection_started_after_from || c.coverage.dropped_events || c.coverage.write_errors || c.coverage.invalid_lines || c.coverage.client_reported_drops || c.coverage.budget_evictions || c.coverage.unclosed_stale_writers),
    };
  };
  return {
    available: checkpoints.length > 0,
    seven_days: rolling(7),
    thirty_days: rolling(30),
    note: "Daily checkpoints contain aggregates and human identifiers, not raw event history. New collection has no speculative backfill.",
  };
}
