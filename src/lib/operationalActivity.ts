import { normaliseTracePath } from "../../shared/trace-contract";

type Activity = { kind: string; route: string; [key: string]: unknown };
const queue: Activity[] = [];
const headers = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
};
const boundaryKey = "flash-activity-identity-change";
let installed = false,
  enabled = false,
  sending = false,
  bindingPending = false;
let epoch = 0,
  transitions = 0,
  dropped = 0;
let binding: string | null = null;
let interaction: string | undefined,
  interactionExpiresAt = 0;
let clientId: string | undefined;

// A document may disappear before an upload settles. Persist only a bounded
// count in this tab, and report it as unconfirmed if a subsequent page takes over.
const receiptKey = "flash-activity-unconfirmed";
let receiptOwner = "",
  unconfirmed = 0,
  outstanding = 0;
function persistReceipt(takeOver = false) {
  try {
    const [owner, raw, lost] = (sessionStorage.getItem(receiptKey) ?? "").split(
      ":",
    );
    if (takeOver) {
      const previous = Number(raw);
      unconfirmed =
        Number.isSafeInteger(previous) && previous > 0
          ? Math.min(previous, 999_999)
          : 0;
      outstanding = unconfirmed;
      const previousLoss = Number(lost);
      if (Number.isSafeInteger(previousLoss) && previousLoss > 0)
        dropped += Math.min(previousLoss, 999_999);
    } else if (owner !== receiptOwner) return; // A newer document owns the slot.
    sessionStorage.setItem(
      receiptKey,
      receiptOwner +
        ":" +
        Math.min(outstanding, 999_999) +
        ":" +
        Math.min(dropped, 999_999),
    );
  } catch {
    /* The collector also works when storage is unavailable. */
  }
}

function randomId() {
  try {
    return globalThis.crypto?.randomUUID?.();
  } catch {
    return undefined;
  }
}

function currentInteraction() {
  return Date.now() < interactionExpiresAt ? interaction : undefined;
}

export function activityRequestContext() {
  return {
    epoch,
    interactionId: currentInteraction(),
    collecting: enabled && !!binding && !transitions,
  };
}
type ActivityRequest = ReturnType<typeof activityRequestContext>;

export function recordActivity(
  kind: string,
  details: Record<string, unknown> = {},
) {
  if (!installed || !enabled) return;
  if (!binding || transitions || queue.length >= 200) {
    dropped++;
    return;
  }
  queue.push({
    kind,
    route: normaliseTracePath(location.pathname),
    client_time: new Date().toISOString(),
    interaction_id: currentInteraction(),
    ...details,
  });
}

// The browser supplies these numeric coordinates separately from the error message.
function sourcePosition(line: unknown, column: unknown) {
  return typeof line === "number" &&
    Number.isInteger(line) &&
    line > 0 &&
    line <= 100_000_000 &&
    typeof column === "number" &&
    Number.isInteger(column) &&
    column >= 0 &&
    column <= 100_000_000
    ? { source_line: line, source_column: column }
    : {};
}
function errorClass(error: unknown) {
  return error instanceof TypeError
    ? "TypeError"
    : error instanceof ReferenceError
      ? "ReferenceError"
      : "Error";
}
export function reportReactError(error?: unknown) {
  recordActivity("react_error", { error_class: errorClass(error) });
}

function recordRequest(
  kind: string,
  context: ActivityRequest,
  path: string,
  duration: number,
  details: Record<string, unknown>,
) {
  if (!context.collecting || context.epoch !== epoch) {
    if (enabled) dropped++;
    return;
  }
  recordActivity(kind, {
    ...details,
    duration_ms: Math.round(duration),
    api_route: normaliseTracePath(path),
    interaction_id: context.interactionId,
  });
}
export function recordApiResult(
  response: Response,
  duration: number,
  context: ActivityRequest,
  path: string,
) {
  recordRequest("api_result", context, path, duration, {
    status: response.status,
    server_request_id: response.headers.get("X-Flash-Request-ID"),
  });
}
export function recordApiFailure(
  error: unknown,
  duration: number,
  context: ActivityRequest,
  path: string,
  response?: Response,
) {
  const aborted = error instanceof Error && error.name === "AbortError";
  recordRequest(
    aborted ? "api_result" : "api_failure",
    context,
    path,
    duration,
    {
      status: response?.status ?? 0,
      server_request_id: response?.headers.get("X-Flash-Request-ID"),
      error_class: errorClass(error),
      ...(aborted ? { cancelled: true } : {}),
    },
  );
}

function resetIdentity() {
  epoch++;
  dropped += queue.length;
  queue.length = 0;
  binding = null;
  interaction = undefined;
  interactionExpiresAt = 0;
}
function notifyOtherTabs() {
  try {
    localStorage.setItem(
      boundaryKey,
      String(Date.now()) + ":" + String(Math.random()),
    );
  } catch {
    /* Storage is optional. */
  }
}
async function postBatch(
  events: Activity[],
  loss: number,
  expected: string | null,
  terminal: boolean,
  uncertain = 0,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    return await fetch("/api/activity", {
      method: "POST",
      credentials: "same-origin",
      keepalive: terminal,
      signal: controller.signal,
      headers: {
        ...headers,
        ...(expected ? { "X-Flash-Activity-Binding": expected } : {}),
        ...(clientId ? { "X-Flash-Activity-Client": clientId } : {}),
      },
      body: JSON.stringify({
        events,
        dropped: Math.min(loss, 999_999),
        ...(uncertain ? { unconfirmed: uncertain } : {}),
      }),
    });
  } finally {
    clearTimeout(timeout);
  }
}
async function establishBinding() {
  if (!enabled || transitions || bindingPending || binding) return;
  const started = epoch;
  bindingPending = true;
  try {
    const result = await postBatch([], 0, null, false);
    if (result.ok && started === epoch)
      binding = result.headers.get("X-Flash-Activity-Binding");
  } catch {
    /* Retry on the next collection tick. */
  } finally {
    bindingPending = false;
  }
  if (started !== epoch && !transitions) void establishBinding();
}
async function flushActivity(terminal = false) {
  if (!enabled) return;
  if (!binding || transitions) {
    if (terminal) {
      dropped += queue.length;
      queue.length = 0;
      persistReceipt();
    } else await establishBinding();
    return;
  }
  if ((!terminal && sending) || (!queue.length && !dropped && !unconfirmed))
    return;
  const events: Activity[] = [];
  // Account for JSON punctuation and the loss counter. Keep the request within
  // both the ingestion limit and the browser's shared keepalive allowance.
  let bytes = 96;
  const encoder = new TextEncoder();
  while (queue.length && events.length < 25) {
    const size = encoder.encode(JSON.stringify(queue[0])).length + 1;
    if (size + 96 > 16384) {
      queue.shift();
      dropped++;
      continue;
    }
    if (bytes + size > 16384) break;
    events.push(queue.shift()!);
    bytes += size;
  }
  // A navigation can end this document before a second upload. Report all unsent
  // events in the same bounded keepalive packet, even with another batch in flight.
  if (terminal) {
    dropped += queue.length;
    queue.length = 0;
  }
  const loss = Math.min(dropped, 999_999);
  dropped -= loss;
  const uncertain = Math.min(unconfirmed, 999_999);
  unconfirmed -= uncertain;
  const atRisk = events.length + loss;
  outstanding += atRisk;
  persistReceipt();
  const started = epoch;
  if (!terminal) sending = true;
  try {
    const result = await postBatch(events, loss, binding, terminal, uncertain);
    if (result.ok || result.status === 409) {
      outstanding -= atRisk + uncertain;
      persistReceipt();
    }
    if (!result.ok) {
      if (result.status !== 409) {
        dropped += atRisk;
        outstanding -= atRisk;
        unconfirmed += uncertain;
        persistReceipt();
      }
      if (result.status === 409 && started === epoch) {
        resetIdentity();
        if (!terminal) void establishBinding();
      }
    }
  } catch {
    unconfirmed += atRisk + uncertain;
  } finally {
    if (!terminal) sending = false;
  }
}
export async function withActivityIdentityBoundary<T>(
  work: () => Promise<T>,
): Promise<T> {
  void flushActivity(true);
  resetIdentity();
  transitions++;
  if (enabled) notifyOtherTabs();
  try {
    return await work();
  } finally {
    transitions--;
    resetIdentity();
    if (enabled) {
      notifyOtherTabs();
      void establishBinding();
    }
  }
}

export function installOperationalActivity() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  let configRetryMs = 5000;
  async function configure() {
    try {
      const response = await fetch("/api/auth/config", {
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error();
      const config = await response.json();
      enabled = config.operational_trace_enabled === true;
      if (!enabled) return;
    } catch {
      setTimeout(() => {
        void configure();
      }, configRetryMs);
      configRetryMs = Math.min(300_000, configRetryMs * 2);
      return;
    }
    clientId = randomId();
    receiptOwner = clientId ?? Math.random().toString(36).slice(2);
    persistReceipt(true);
    window.addEventListener("storage", (e) => {
      if (e.key === boundaryKey) {
        resetIdentity();
        void establishBinding();
      }
    });
    await establishBinding();
    recordNavigation();
  }
  void configure();
  const handle = (event: Event) => {
    if (!enabled || !event.isTrusted) return;
    const target =
      event.target instanceof Element
        ? event.target.closest("button,a,input,select,textarea,form")
        : null;
    if (!target) return;
    interaction = randomId();
    interactionExpiresAt = Date.now() + 1000;
    recordActivity(event.type, {
      control: target.tagName.toLowerCase(),
      control_type: (target as HTMLInputElement).type,
      position: target.parentElement
        ? Array.from(target.parentElement.children).indexOf(target)
        : 0,
    });
  };
  for (const event of ["click", "change", "submit", "invalid"])
    document.addEventListener(event, handle, true);
  window.addEventListener("error", (event) =>
    recordActivity("javascript_error", {
      error_class: errorClass(event.error),
      ...sourcePosition(event.lineno, event.colno),
    }),
  );
  window.addEventListener("unhandledrejection", (event) =>
    recordActivity("unhandled_rejection", {
      error_class: errorClass(event.reason),
    }),
  );
  window.addEventListener("pagehide", () => {
    void flushActivity(true);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushActivity(true);
  });
  setInterval(() => {
    void flushActivity();
  }, 5000);
}
export function recordNavigation() {
  if (!enabled) return;
  interaction = randomId();
  interactionExpiresAt = Date.now() + 1000;
  recordActivity("navigation", {
    viewport_width: window.innerWidth,
    viewport_height: window.innerHeight,
  });
}
