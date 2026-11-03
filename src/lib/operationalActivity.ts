import { normaliseTracePath } from "../../shared/trace-contract";
type Activity = {
  kind: string;
  route: string;
  client_time: string;
  interaction_id?: string;
  [key: string]: unknown;
};
const queue: Activity[] = [];
let installed = false;
let enabled = false;
let sending = false;
let dropped = 0;
let interaction: string | undefined;
let interactionExpiresAt = 0;
export function activityInteraction() { return Date.now() < interactionExpiresAt ? interaction : undefined; }
export function recordActivity(
  kind: string,
  details: Record<string, unknown> = {},
) {
  if (!installed || !enabled) return;
  if (queue.length >= 200) {
    dropped++;
    return;
  }
  queue.push({
    ...details,
    kind,
    route: normaliseTracePath(location.pathname),
    client_time: new Date().toISOString(),
    interaction_id: typeof details.interaction_id === 'string' ? details.interaction_id : Object.prototype.hasOwnProperty.call(details, 'interaction_id') ? undefined : activityInteraction(),
  });
}
function errorDetails(error: unknown) {
  try {
  const stack = error instanceof Error ? error.stack?.split('\n').slice(1).join('\n').slice(0, 16000) ?? '' : '';
  return { error_class: error instanceof TypeError ? 'TypeError' : error instanceof ReferenceError ? 'ReferenceError' : 'Error', frames: [...stack.matchAll(/\/assets\/[A-Za-z0-9_.-]{1,128}\.js:\d{1,8}:\d{1,8}/g)].slice(0, 8).map(match => match[0]) };
  } catch { return { error_class: 'Error', frames: [] }; }
}
export function reportReactError(error?: unknown) { recordActivity('react_error', errorDetails(error)); }
export function recordApiResult(response: Response, duration: number, interactionId?: string) {
  recordActivity("api_result", {
    server_request_id: response.headers.get("X-Flash-Request-ID"),
    status: response.status,
    duration_ms: Math.round(duration),
    interaction_id: interactionId,
  });
}
async function flushActivity() {
  if (sending || !queue.length) return;
  sending = true;
  const events = queue.splice(0, 25),
    sentDropped = dropped;
  try {
    const response = await fetch("/api/activity", {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({ events, dropped: sentDropped }),
    });
    if (response.ok) dropped = Math.max(0, dropped - sentDropped);
    else dropped += events.length;
  } catch {
    dropped += events.length;
  } finally {
    sending = false;
  }
}
export function installOperationalActivity() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  void fetch("/api/auth/config", { credentials: "same-origin" })
    .then((r) => r.json())
    .then((config) => {
      enabled = config.operational_trace_enabled === true;
      if (enabled) recordNavigation();
    })
    .catch(() => {});
  const handle = (event: Event) => {
    if (!event.isTrusted) return;
    const target =
      event.target instanceof Element
        ? event.target.closest("button,a,input,select,textarea,form")
        : null;
    if (!target) return;
    interaction = crypto.randomUUID();
    interactionExpiresAt = Date.now() + 1000;
    const control = target.tagName.toLowerCase();
    const element = target as HTMLInputElement;
    recordActivity(event.type, {
      control,
      control_type: element.type,
      position: target.parentElement
        ? Array.from(target.parentElement.children).indexOf(target)
        : 0,
      ...(element.type === "checkbox" || element.type === "radio"
        ? { checked: element.checked }
        : {}),
    });
  };
  for (const event of ["click", "change", "submit", "invalid"])
    document.addEventListener(event, handle, true);
  window.addEventListener("error", event => recordActivity("javascript_error", errorDetails(event.error)));
  window.addEventListener("unhandledrejection", event =>
    recordActivity("unhandled_rejection", errorDetails(event.reason)),
  );
  window.addEventListener("pagehide", () => {
    void flushActivity();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushActivity();
  });
  setInterval(() => {
    void flushActivity();
  }, 5000);
}
export function recordNavigation() {
  interaction = crypto.randomUUID();
  interactionExpiresAt = Date.now() + 1000;
  recordActivity("navigation", {
    viewport_width: window.innerWidth,
    viewport_height: window.innerHeight,
  });
}
