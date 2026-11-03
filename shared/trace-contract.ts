// Raw URLs, form values and payloads never enter the diagnostic event contract.
const STATIC_SEGMENTS = new Set(
  `api auth config login logout register session profile magic-link-start magic-link-verify magic-link-complete password-change password-reset-start password-reset-complete totp-setup totp-verify verify disable workspaces users bulk access leave transfer-ownership invite invites environments list create update delete bind unbind renew zero-touch groups descendants devices policies assign unassign overrides locks derivatives external components apps search deploy web-token catalog import deployments configs networks enrollment tokens signin enroll callback workflows execute geofences reports export dashboard data audit superadmin stats settings actions operational-trace activity flashagent chat chat-history download workspace-settings billing plans licenses subscriptions webhook pubsub health mcp amapi join w e setup environment-setup reset-password sign-in signup links signup-links certificates feedback operations`.split(
    /\s+/,
  ),
);
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
for (const segment of [
  ".netlify",
  ":id",
  ":value",
  "functions",
  "sync-process-background",
  "deployment-jobs-background",
  "cleanup-scheduled",
  "geofence-check-scheduled",
  "workflow-cron-scheduled",
  "sync-reconcile-scheduled",
  "licensing-reconcile-scheduled",
])
  STATIC_SEGMENTS.add(segment);
export function normaliseTracePath(value: string): string {
  const pathname = value.split(/[?#]/, 1)[0].slice(0, 2048);
  return (
    "/" +
    pathname
      .split("/")
      .filter(Boolean)
      .slice(0, 12)
      .map((segment) =>
        STATIC_SEGMENTS.has(segment)
          ? segment
          : UUID_PATTERN.test(segment)
            ? ":id"
            : ":value",
      )
      .join("/")
  );
}
export function traceFeature(path: string): string {
  const segments = normaliseTracePath(path).split("/").filter(Boolean);
  return (segments[0] === "api" ? segments[1] : segments[0]) ?? "dashboard";
}
export const CLIENT_EVENTS = new Set([
  "navigation",
  "click",
  "change",
  "submit",
  "invalid",
  "javascript_error",
  "unhandled_rejection",
  "react_error",
  "api_result",
  "api_failure",
]);
export const OUTCOME_FIELDS = [
  "success",
  "failed",
  "succeeded",
  "errors",
  "total",
  "processed",
  "skipped",
  "jobs",
  "jobs_processed",
  "batches",
  "imported",
  "updated",
  "deleted",
  "created",
  "queued",
  "count",
  "total_targeted",
  "needs_totp",
  "needs_mfa",
] as const;
export function responseOutcome(
  value: unknown,
): Record<string, number | boolean | string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const object = value as Record<string, unknown>;
  const output: Record<string, number | boolean | string> = {};
  for (const key of OUTCOME_FIELDS) {
    const item = object[key];
    if (
      typeof item === "boolean" ||
      (typeof item === "number" && Number.isFinite(item))
    )
      output[key] = item;
    else if (Array.isArray(item)) output[key + "_count"] = item.length;
  }
  if (
    typeof object.status === "string" &&
    /^(ok|error|success|failed|partial|pending|processed|skipped|completed|queued|degraded|delivery_uncertain)$/.test(
      object.status,
    )
  )
    output.result_status = object.status;
  if (Array.isArray(object.results)) {
    output.results_count = object.results.length;
    output.results_failed = object.results.filter(
      (r) =>
        r &&
        typeof r === "object" &&
        (r.ok === false || r.success === false || ['failed', 'error', 'delivery_uncertain'].includes(r.status)),
    ).length;
  }
  return output;
}
