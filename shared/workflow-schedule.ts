// Keep the server contract aligned with the schedule presets in TriggerSelector.
const INTERVAL_MINUTES = [15, 30, 60, 360, 720, 1440];

export const WORKFLOW_SCHEDULE_ERROR =
  'Scheduled interval_minutes must be one of: 15, 30, 60, 360, 720, 1440';

export function scheduledWorkflowInterval(config: unknown): number | null {
  // An omitted interval keeps the documented hourly default for older clients.
  if (config === undefined) return 60;
  if (config === null || typeof config !== 'object' || Array.isArray(config)) return null;
  const interval = (config as Record<string, unknown>).interval_minutes;
  if (interval === undefined) return 60;
  return typeof interval === 'number' && INTERVAL_MINUTES.includes(interval) ? interval : null;
}
