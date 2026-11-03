import { buildTraceReport } from "../netlify/functions/_lib/trace-reader.js";
import { traceWindow } from "../netlify/functions/_lib/trace-writer.js";
import {
  traceWindowBounds,
  traceComparisons,
  writeTraceCheckpoint,
} from "../netlify/functions/_lib/trace-checkpoints.js";

const args = process.argv.slice(2);
function argument(name: string) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}
const directory = argument("--dir") ?? process.env.FLASH_TRACE_DIR;
if (!directory) throw new Error("Set FLASH_TRACE_DIR or provide --dir");
let window = argument("--window");
if (args.includes("--completed")) {
  const day = new Date(traceWindow() + "T12:00:00Z");
  day.setUTCDate(day.getUTCDate() - 1);
  window = day.toISOString().slice(0, 10);
}
const bounds = window ? traceWindowBounds(window) : undefined;
const to = bounds?.to ?? new Date(argument("--to") ?? Date.now());
const from =
  bounds?.from ??
  new Date(argument("--from") ?? to.getTime() - 24 * 60 * 60 * 1000);
if (
  !Number.isFinite(from.getTime()) ||
  !Number.isFinite(to.getTime()) ||
  from >= to ||
  to.getTime() - from.getTime() > 4 * 86400000
)
  throw new Error("Use a valid window of at most four days");
const report = await buildTraceReport(directory, from, to);
let checkpoint;
if (args.includes("--checkpoint")) {
  if (!window) throw new Error("Use --window or --completed with --checkpoint");
  checkpoint = await writeTraceCheckpoint(directory, window, report);
}
process.stdout.write(
  JSON.stringify(
    { ...report, checkpoint, comparisons: await traceComparisons(directory, to) },
    null,
    2,
  ) + "\n",
);
