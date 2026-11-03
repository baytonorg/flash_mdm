import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/api/client";
import LogCard from './LogCard';
interface TraceEvent {
  [key: string]: unknown;
  time: string;
  event: string;
  request_id?: string;
  actor?: { type: string; email?: string; id?: string };
  route?: string;
  data: Record<string, unknown>;
}
interface TraceStatus {
  enabled: boolean;
  rotation?: string;
  current_window?: string;
  retained_windows: string[];
  raw_windows?: string[];
  bytes?: number;
  collection?: { accepting: boolean };
  components?: Array<{ component: string; fresh: boolean }>;
  writers?: Array<{
    window: string;
    dropped: number;
    write_errors: number;
    budget_evictions: number;
    heartbeat_gaps?: number;
  }>;
  events?: TraceEvent[];
  scan_limited?: boolean;
  invalid_health_records?: number;
  invalid_lines?: number;
}
export default function OperationalTraceCard() {
  const [open, setOpen] = useState(false);
  const [window, setWindow] = useState("");
  const [actor, setActor] = useState("");
  const [requestId, setRequestId] = useState("");
  const [problems, setProblems] = useState(false);
  const [filters, setFilters] = useState({ actor: "", requestId: "" });
  const status = useQuery({
    queryKey: ["operational-trace", "status"],
    queryFn: () =>
      apiClient.get<TraceStatus>("/api/superadmin/operational-trace"),
    enabled: open,
    refetchInterval: open ? 30000 : false,
  });
  const selectedWindow = window || status.data?.current_window || "";
  const events = useQuery({
    queryKey: ["operational-trace", selectedWindow, filters, problems],
    queryFn: () =>
      apiClient.get<TraceStatus>(
        `/api/superadmin/operational-trace?events=true&window=${selectedWindow}&actor=${encodeURIComponent(filters.actor)}&request_id=${encodeURIComponent(filters.requestId)}${problems ? "&outcome=problems" : ""}`,
      ),
    enabled: open && !!selectedWindow && status.data?.enabled === true,
  });
  const data = status.data;
  const missingComponents =
    data?.components?.filter((component) => !component.fresh) ?? [];
  const gaps = (data?.writers ?? [])
    .filter((w) => w.window === selectedWindow)
    .reduce(
      (n, w) =>
        n +
        (w.dropped ?? 0) +
        (w.write_errors ?? 0) +
        (w.budget_evictions ?? 0) +
        (w.heartbeat_gaps ?? 0),
      0,
    );
  const invalidHealth = data?.invalid_health_records ?? 0;
  const invalidLines = events.data?.invalid_lines ?? 0;
  const viewUnavailable = status.isError || events.isError;
  const degraded = gaps > 0 || missingComponents.length > 0 || invalidHealth > 0 || invalidLines > 0 || viewUnavailable;
  const inputClass = 'mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500';
  return (
    <LogCard
      className="mb-3"
      title="Operational trace"
      description="Activity, outcomes and execution details"
      onOpenChange={setOpen}
    >
      {open && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Correlated requests, browser interactions, database work, provider
            calls, audit writes and job outcomes. Passwords, credentials, form
            values and raw payloads are excluded. Collection gaps are shown
            explicitly.
          </p>
          {status.isPending && (
            <p className="text-sm text-gray-500">
              Loading collection status...
            </p>
          )}
          {(status.error || events.error) && (
            <p role="alert" className="text-sm text-red-700">
              Diagnostic logs are unavailable.{" "}
              {String((status.error ?? events.error)?.message ?? "")}
            </p>
          )}
          {data && !data.enabled && (
            <p className="text-sm text-amber-800">
              Collection is disabled on this runtime. Configure private
              operational trace storage before relying on this view.
            </p>
          )}
          {data?.enabled && (
            <>
              <div className="grid grid-cols-1 gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm sm:grid-cols-3">
                <div>
                  <span className="block text-xs text-gray-500">
                    Collection
                  </span>
                  <strong
                    className={
                      data.collection?.accepting &&
                      !degraded
                        ? "text-green-700"
                        : "text-amber-800"
                    }
                  >
                    {data.collection?.accepting
                      ? viewUnavailable
                        ? "Collecting, view unavailable"
                        : degraded
                        ? "Collecting with gaps"
                        : "Collecting"
                      : "Degraded"}
                  </strong>
                </div>
                <div>
                  <span className="block text-xs text-gray-500">Rotation</span>
                  {data.rotation}
                </div>
                <div>
                  <span className="block text-xs text-gray-500">
                    Retained storage
                  </span>
                  {((data.bytes ?? 0) / 1048576).toFixed(1)} MiB across{" "}
                  {data.retained_windows.length} window(s)
                </div>
              </div>
              {!!gaps && (
                <p role="alert" className="text-sm text-amber-800">
                  This window has dropped events, write errors or budget
                  evictions, or heartbeat gaps. A quiet log does not prove a clean platform.
                </p>
              )}
              {(invalidHealth > 0 || invalidLines > 0) && (
                <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Invalid collection records: {invalidHealth} health record(s), {invalidLines} event line(s). Some evidence could not be read. Download retained data for investigation.
                </p>
              )}
              {!!missingComponents.length && (
                <p role="alert" className="text-sm text-amber-800">
                  No fresh collection heartbeat from{" "}
                  {missingComponents
                    .map((component) => component.component)
                    .join(", ")}
                  . Check service health before relying on this window.
                </p>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <label className="block text-xs font-medium text-gray-600">
                  Window
                  <select
                    aria-label="Trace window"
                    className={inputClass}
                    value={selectedWindow}
                    onChange={(e) => setWindow(e.target.value)}
                  >
                    {data.retained_windows.map((w) => (
                      <option key={w} value={w}>
                        {w}
                        {w === data.current_window ? " (current)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-medium text-gray-600">
                  Actor
                  <input
                    className={inputClass}
                    value={actor}
                    onChange={(e) => setActor(e.target.value)}
                    placeholder="Email, ID or actor type"
                  />
                </label>
                <label className="block text-xs font-medium text-gray-600">
                  Request ID
                  <input
                    className={inputClass}
                    value={requestId}
                    onChange={(e) => setRequestId(e.target.value)}
                  />
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  onClick={() => {
                    if (
                      filters.actor === actor &&
                      filters.requestId === requestId
                    )
                      void events.refetch();
                    else setFilters({ actor, requestId });
                    void status.refetch();
                  }}
                >
                  Apply / refresh
                </button>
                <label className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    checked={problems}
                    onChange={(e) => setProblems(e.target.checked)}
                  />
                  Problems only
                </label>
                {selectedWindow &&
                  (!data.raw_windows ||
                    data.raw_windows.includes(selectedWindow)) && (
                    <a
                      className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      href={`/api/superadmin/operational-trace?window=${selectedWindow}&download=ndjson`}
                    >
                      Download window
                    </a>
                  )}
              </div>
              <p className="text-xs text-gray-500">
                Latest 100 matching events from a bounded tail scan.{" "}
                {events.data?.scan_limited
                  ? "The scan is limited; download the window for full coverage."
                  : "The download contains the retained window."}{" "}
                Browser interactions are client-reported; background requests
                are not proof of human engagement.
              </p>
              <div className="max-h-[34rem] space-y-2 overflow-y-auto">
                {events.isPending && <p className="text-sm text-gray-400">Loading events...</p>}
                {(events.data?.events ?? []).map((event, index) => (
                  <details
                    key={`${event.time}:${index}`}
                    className="rounded-md border border-gray-200 bg-gray-50"
                  >
                    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-3 py-2 text-xs [&::-webkit-details-marker]:hidden">
                      <span className="text-gray-500">
                        {new Date(event.time).toLocaleString()}
                      </span>
                      <span className="font-mono text-gray-700">{event.event}</span>
                      <span>
                        {event.actor?.email ?? event.actor?.type ?? "unknown"}
                      </span>
                      <span className="break-all font-mono text-gray-600">{event.route}</span>
                      <span>
                        {String(event.data.status ?? event.data.outcome ?? "")}
                      </span>
                    </summary>
                    <div className="border-t border-gray-200 bg-white px-3 py-2">
                      <pre className="max-h-80 overflow-auto rounded bg-gray-900 p-3 text-xs text-gray-100">{JSON.stringify(event, null, 2)}</pre>
                    </div>
                  </details>
                ))}
                {events.data?.events?.length === 0 && (
                  <p className="p-4 text-sm text-gray-500">
                    No matching events in the scanned data.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </LogCard>
  );
}
