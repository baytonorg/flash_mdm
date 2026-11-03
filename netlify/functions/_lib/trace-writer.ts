import { constants } from "node:fs";
import {
  mkdir,
  open,
  readdir,
  lstat,
  unlink,
  rename,
  statfs,
} from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
const reportWarning = console.warn.bind(console);
const londonClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

export function traceWindow(now = new Date()): string {
  const parts = londonClock.formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  const date = new Date(
    `${part("year")}-${part("month")}-${part("day")}T12:00:00Z`,
  );
  if (Number(part("hour")) < 9) date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

const OWN_FILE =
  /^\d{4}-\d{2}-\d{2}\.(?:web|worker|operator|test)\.\d+(?:-[a-f0-9]{8})?\.(?:\d{5}\.ndjson|health\.json)$/;
export interface TraceWriterOptions {
  directory: string;
  component: "web" | "worker" | "operator" | "test";
  maxQueueBytes?: number;
  maxDirectoryBytes?: number;
  maxWindowBytes?: number;
  maxFileBytes?: number;
  retainWindows?: number;
  minimumFreeBytes?: number;
  now?: () => Date;
}

/** Bounded, asynchronous diagnostic storage. It never blocks the product on disk. */
export class TraceWriter {
  private queue: Array<{ line: string; bytes: number; window: string }> = [];
  private queuedBytes = 0;
  private running: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval>;
  private maintenanceAt = 0;
  private healthAt = 0;
  private heartbeatGaps = 0;
  private previousDrainAt: number;
  private window = "";
  private segment = 0;
  private segmentBytes = 0;
  private windowBytes = 0;
  private directoryBytes = 0;
  private ready = false;
  private lowDisk = false;
  private stopped = false;
  private inFlight = 0;
  private writerId = `${process.pid}-${randomUUID().slice(0, 8)}`;
  private lastWriteFailed = false;
  private budgetLimited = false;
  private retryAt = 0;
  private errorStreak = 0;
  private warnedAt = 0;
  private counters = {
    accepted: 0,
    written: 0,
    dropped: 0,
    write_errors: 0,
    budget_evictions: 0,
    oversized: 0,
  };
  private windowCounters = { ...this.counters };
  private startedAt: string;
  private windowStartedAt = "";
  private now: () => Date;
  constructor(private options: TraceWriterOptions) {
    this.now = options.now ?? (() => new Date());
    this.startedAt = this.now().toISOString();
    this.previousDrainAt = Date.parse(this.startedAt);
    this.window = traceWindow(this.now());
    this.windowStartedAt = this.startedAt;
    this.timer = setInterval(() => {
      void this.flush();
    }, 250);
    this.timer.unref();
  }
  health() {
    return {
      enabled: true,
      accepting:
        !this.stopped &&
        !this.lastWriteFailed &&
        !this.budgetLimited &&
        !this.lowDisk &&
        this.queuedBytes < (this.options.maxQueueBytes ?? 2 * 1024 * 1024),
      queued_bytes: this.queuedBytes,
      ...this.counters,
    };
  }
  write(record: Record<string, unknown>): boolean {
    if (this.stopped) return false;
    let line: string;
    try {
      line = JSON.stringify(record) + "\n";
    } catch {
      this.drop();
      return false;
    }
    const bytes = Buffer.byteLength(line);
    if (bytes > 8192) {
      this.counters.oversized++;
      this.windowCounters.oversized++;
      this.drop();
      return false;
    }
    if (
      this.queuedBytes + bytes >
      (this.options.maxQueueBytes ?? 2 * 1024 * 1024)
    ) {
      this.drop();
      return false;
    }
    this.queue.push({
      line,
      bytes,
      window: traceWindow(
        new Date(String(record.time ?? this.now().toISOString())),
      ),
    });
    this.queuedBytes += bytes;
    this.counters.accepted++;
    return true;
  }
  private drop(count = 1) {
    this.counters.dropped += count;
    this.windowCounters.dropped += count;
  }
  async flush(): Promise<void> {
    if (this.running) return this.running;
    if (Date.now() < this.retryAt) return;
    this.running = this.drain()
      .catch(() => {
        this.counters.write_errors++;
        this.windowCounters.write_errors++;
        this.lastWriteFailed = true;
        this.ready = false;
        this.retryAt = Date.now() + Math.min(60000, 1000 * 2 ** Math.min(this.errorStreak++, 6));
        this.drop(this.queue.length + this.inFlight);
        this.inFlight = 0;
        this.queue = [];
        this.queuedBytes = 0;
        // No error text or event data: filesystem errors can contain sensitive paths.
        if (Date.now() - this.warnedAt > 60000) reportWarning(
          JSON.stringify({
            event: "operational_trace_write_failed",
            component: this.options.component,
            dropped: this.counters.dropped,
          }),
        );
        this.warnedAt = Date.now();
      })
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }
  private async ensureDirectory() {
    if (this.ready) return;
    await mkdir(this.options.directory, { recursive: true, mode: 0o700 });
    const directory = await lstat(this.options.directory);
    if (
      !directory.isDirectory() ||
      directory.isSymbolicLink() ||
      (directory.mode & 0o077) !== 0
    )
      throw new Error("Trace directory must be private");
    this.ready = true;
  }
  private async drain() {
    await this.ensureDirectory();
    const now = this.now();
    const heartbeatGap = now.getTime() - this.previousDrainAt > 120000;
    this.previousDrainAt = now.getTime();
    if (heartbeatGap) this.heartbeatGaps++;
    if (now.getTime() >= this.maintenanceAt) {
      await this.maintain(now);
      this.maintenanceAt = now.getTime() + 10_000;
    }
    // One bounded batch per tick gives other work a chance to run under load.
    const batch = this.queue.splice(0, 128);
    this.queuedBytes -= batch.reduce((n, e) => n + e.bytes, 0);
    this.inFlight = batch.length;
    let lines: string[] = [],
      pendingBytes = 0;
    const append = async () => {
      if (!lines.length) return;
      const filename = `${this.window}.${this.options.component}.${this.writerId}.${String(this.segment).padStart(5, "0")}.ndjson`;
      const file = await open(
        join(this.options.directory, filename),
        constants.O_APPEND |
          constants.O_CREAT |
          constants.O_WRONLY |
          constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await file.writeFile(lines.join(""));
      } finally {
        await file.close();
      }
      this.windowBytes += pendingBytes;
      this.segmentBytes += pendingBytes;
      this.directoryBytes += pendingBytes;
      this.counters.written += lines.length;
      this.windowCounters.written += lines.length;
      this.inFlight -= lines.length;
      this.lastWriteFailed = false;
      this.budgetLimited = false;
      this.retryAt = 0; this.errorStreak = 0;
      lines = [];
      pendingBytes = 0;
    };
    for (const item of batch) {
      if (item.window !== this.window) {
        await append();
        await this.rotate(item.window);
      }
      this.windowCounters.accepted++;
      const maxWindow = this.options.maxWindowBytes ?? 128 * 1024 * 1024;
      if (
        this.lowDisk ||
        this.windowBytes + pendingBytes + item.bytes > maxWindow ||
        this.directoryBytes + pendingBytes + item.bytes >
          (this.options.maxDirectoryBytes ?? 384 * 1024 * 1024)
      ) {
        this.budgetLimited = true;
        this.drop();
        this.inFlight--;
        continue;
      }
      if (
        this.segmentBytes + pendingBytes + item.bytes >
        (this.options.maxFileBytes ?? 16 * 1024 * 1024)
      ) {
        await append();
        this.segment++;
        this.segmentBytes = 0;
      }
      lines.push(item.line);
      pendingBytes += item.bytes;
      if (pendingBytes >= 65536) await append();
    }
    await append();
    if (!this.queue.length && this.window && this.window !== traceWindow(now))
      await this.rotate(traceWindow(now));
    if (now.getTime() >= this.healthAt) {
      if (!this.window) await this.rotate(traceWindow(now));
      await this.persistHealth(false);
      this.healthAt = now.getTime() + 60_000;
      if (this.windowCounters.dropped || this.windowCounters.write_errors)
        reportWarning(
          JSON.stringify({
            event: "operational_trace_degraded",
            component: this.options.component,
            ...this.windowCounters,
          }),
        );
    }
  }
  private async rotate(window: string) {
    this.budgetLimited = false;
    if (this.window) await this.persistHealth(true);
    this.window = window;
    this.heartbeatGaps = 0;
    this.segment = 0;
    this.segmentBytes = 0;
    this.windowBytes = 0;
    this.windowCounters = {
      ...this.counters,
      accepted: 0,
      written: 0,
      dropped: 0,
      write_errors: 0,
      budget_evictions: 0,
      oversized: 0,
    };
    this.windowStartedAt = this.now().toISOString();
  }
  private async persistHealth(closed: boolean) {
    const filename = `${this.window}.${this.options.component}.${this.writerId}.health.json`;
    const temporary = join(this.options.directory, filename + ".tmp");
    const file = await open(
      temporary,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_TRUNC |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await file.writeFile(
        JSON.stringify({
          schema: 1,
          window: this.window,
          component: this.options.component,
          pid: process.pid,
          started_at: this.startedAt,
          window_started_at: this.windowStartedAt,
          observed_at: this.now().toISOString(),
          closed,
          heartbeat_gaps: this.heartbeatGaps,
          low_disk: this.lowDisk,
          ...this.windowCounters,
          queued_bytes: this.queuedBytes,
        }),
      );
    } finally {
      await file.close();
    }
    await rename(temporary, join(this.options.directory, filename));
  }
  private async maintain(now: Date) {
    const names = (await readdir(this.options.directory))
      .filter((n) => OWN_FILE.test(n))
      .sort();
    const current = traceWindow(now);
    const windows = [...new Set(names.map((n) => n.slice(0, 10)))]
      .filter((w) => w <= current)
      .sort()
      .reverse();
    const keep = new Set([
      current,
      ...windows
        .filter((w) => w !== current)
        .slice(0, (this.options.retainWindows ?? 4) - 1),
    ]);
    const files: Array<{ name: string; size: number }> = [];
    let total = 0;
    for (const name of names) {
      const path = join(this.options.directory, name);
      let info;
      try {
        info = await lstat(path);
      } catch {
        continue;
      }
      if (!info.isFile() || info.isSymbolicLink()) continue;
      if (!keep.has(name.slice(0, 10))) {
        await unlink(path).catch(() => {});
        continue;
      }
      total += info.size;
      files.push({ name, size: info.size });
    }
    const maximum = this.options.maxDirectoryBytes ?? 384 * 1024 * 1024;
    for (const file of files) {
      if (total < maximum * 0.9) break;
      if (file.name.startsWith(current) || file.name.endsWith("health.json"))
        continue;
      const window = file.name.slice(0, 10);
      const marker = join(this.options.directory, `${window}.operator.0.health.json`);
      const temporary = marker + `.${process.pid}.tmp`;
      const evidence = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
      try { await evidence.writeFile(JSON.stringify({ schema: 1, window, component: 'retention', pid: 0, closed: true, observed_at: now.toISOString(), budget_evictions: 1, pruned_bytes_at_least: file.size })); }
      finally { await evidence.close(); }
      await rename(temporary, marker);
      await unlink(join(this.options.directory, file.name))
        .then(() => {
          total -= file.size;
          this.counters.budget_evictions++;
          this.windowCounters.budget_evictions++;
        })
        .catch(() => {});
    }
    this.directoryBytes = total;
    const space = await statfs(this.options.directory);
    this.lowDisk =
      space.bavail * space.bsize <
      (this.options.minimumFreeBytes ?? 256 * 1024 * 1024);
  }
  async close() {
    clearInterval(this.timer);
    while (this.queue.length && !this.lastWriteFailed) await this.flush();
    if (this.queue.length) { this.drop(this.queue.length); this.queue = []; this.queuedBytes = 0; }
    await this.flush();
    if (this.ready && this.window)
      await this.persistHealth(true).catch(() => {});
    this.stopped = true;
  }
}
