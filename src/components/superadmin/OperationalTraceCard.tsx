import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/api/client";
interface TraceEvent {
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
  }>;
  events?: TraceEvent[];
  scan_limited?: boolean;
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
        (w.budget_evictions ?? 0),
      0,
    );
  return (
    <details
      className="mb-3 rounded-lg border border-gray-200"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="cursor-pointer px-4 py-3 font-medium text-gray-900">
        Operational trace{" "}
        <span className="ml-2 text-xs font-normal text-gray-500">
          Activity, outcomes and execution details
        </span>
      </summary>
      {open && (
        <div className="border-t border-gray-100 p-4 space-y-4">
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
              <div className="grid gap-3 sm:grid-cols-3 text-sm">
                <div>
                  <span className="block text-xs text-gray-500">
                    Collection
                  </span>
                  <strong
                    className={
                      data.collection?.accepting &&
                      !gaps &&
                      !missingComponents.length
                        ? "text-green-700"
                        : "text-amber-800"
                    }
                  >
                    {data.collection?.accepting
                      ? gaps || missingComponents.length
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
                  evictions. A quiet log does not prove a clean platform.
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
              <div className="flex flex-wrap gap-2 items-end">
                <label className="text-xs text-gray-600">
                  Window
                  <select
                    aria-label="Trace window"
                    className="mt-1 block rounded border p-2 text-sm"
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
                <label className="text-xs text-gray-600">
                  Actor
                  <input
                    className="mt-1 block rounded border p-2 text-sm"
                    value={actor}
                    onChange={(e) => setActor(e.target.value)}
                    placeholder="Email, ID or actor type"
                  />
                </label>
                <label className="text-xs text-gray-600">
                  Request ID
                  <input
                    className="mt-1 block rounded border p-2 text-sm"
                    value={requestId}
                    onChange={(e) => setRequestId(e.target.value)}
                  />
                </label>
                <button
                  className="rounded border px-3 py-2 text-sm"
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
                      className="rounded bg-accent px-3 py-2 text-sm text-white"
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
              <div className="max-h-96 overflow-auto rounded border border-gray-200">
                {(events.data?.events ?? []).map((event, index) => (
                  <details
                    key={`${event.time}:${index}`}
                    className="border-b border-gray-100 p-2 text-xs"
                  >
                    <summary className="cursor-pointer flex flex-wrap gap-2">
                      <span className="text-gray-500">
                        {new Date(event.time).toLocaleString()}
                      </span>
                      <strong>{event.event}</strong>
                      <span>
                        {event.actor?.email ?? event.actor?.type ?? "unknown"}
                      </span>
                      <span>{event.route}</span>
                      <span>
                        {String(event.data.status ?? event.data.outcome ?? "")}
                      </span>
                    </summary>
                    <pre className="mt-2 whitespace-pre-wrap break-all text-gray-600">
                      {JSON.stringify(
                        {
                          request_id: event.request_id,
                          actor: event.actor,
                          ...event.data,
                        },
                        null,
                        2,
                      )}
                    </pre>
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
    </details>
  );
}
