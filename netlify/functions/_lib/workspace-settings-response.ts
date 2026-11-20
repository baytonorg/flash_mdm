import { DEFAULT_PERMISSION_MATRIX, RBAC_ROLE_VALUES } from './rbac.js';
import { MAX_DEVICE_REPORT_STALE_AFTER_DAYS, MIN_DEVICE_REPORT_STALE_AFTER_DAYS } from './device-health.js';

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** Generic workspace reads expose only settings consumed by the workspace UI.
 * Provider configuration belongs to its dedicated, redacted settings endpoint.
 * Never spread stored settings into this response: they can contain credentials.
 */
export function workspaceSettingsResponse(value: unknown): Record<string, unknown> {
  const settings = record(value);
  const result: Record<string, unknown> = {};
  const days = record(settings?.device_health)?.stale_after_days;
  if (typeof days === 'number' && Number.isInteger(days)
    && days >= MIN_DEVICE_REPORT_STALE_AFTER_DAYS && days <= MAX_DEVICE_REPORT_STALE_AFTER_DAYS) {
    result.device_health = { stale_after_days: days };
  }
  const matrix = record(record(settings?.rbac)?.permission_matrix);
  if (matrix) {
    const projected: Record<string, Record<string, string>> = {};
    for (const [resource, actions] of Object.entries(DEFAULT_PERMISSION_MATRIX)) {
      const input = record(matrix[resource]);
      if (!input) continue;
      for (const action of Object.keys(actions)) {
        const role = input[action];
        if (typeof role === 'string' && RBAC_ROLE_VALUES.includes(role as typeof RBAC_ROLE_VALUES[number])) {
          (projected[resource] ??= {})[action] = role;
        }
      }
    }
    result.rbac = { permission_matrix: projected };
  }
  return result;
}

export function workspaceResponse<T extends Record<string, unknown>>(workspace: T): T {
  return { ...workspace, settings: workspaceSettingsResponse(workspace.settings) };
}
