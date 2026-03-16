import { describe, expect, it } from 'vitest';
import type { AppFeedbackItem } from '@/api/queries/app-feedback';
import { groupAppFeedbackItems } from '@/components/device/appFeedbackGrouping';

function makeItem(overrides: Partial<AppFeedbackItem>): AppFeedbackItem {
  return {
    id: overrides.id ?? 'id-1',
    environment_id: overrides.environment_id ?? 'env-1',
    device_id: overrides.device_id ?? 'dev-1',
    device_name: overrides.device_name ?? 'Device',
    device_amapi_name: overrides.device_amapi_name ?? 'enterprises/e/devices/d',
    package_name: overrides.package_name ?? 'com.example.app',
    feedback_key: overrides.feedback_key ?? 'key',
    severity: overrides.severity ?? 'INFO',
    message: overrides.message ?? 'message',
    data_json: overrides.data_json ?? null,
    first_reported_at: overrides.first_reported_at ?? '2026-03-03T19:00:00.000Z',
    last_reported_at: overrides.last_reported_at ?? '2026-03-03T19:00:00.000Z',
    last_update_time: overrides.last_update_time ?? null,
    status: overrides.status ?? 'resolved',
  };
}

describe('groupAppFeedbackItems', () => {
  it('groups by package and sorts apps by open status then latest report', () => {
    const groups = groupAppFeedbackItems([
      makeItem({
        id: 'a1',
        package_name: 'com.zeta',
        feedback_key: 'alpha',
        status: 'resolved',
        severity: 'INFO',
        last_reported_at: '2026-03-03T19:01:00.000Z',
      }),
      makeItem({
        id: 'b1',
        package_name: 'com.beta',
        feedback_key: 'first',
        status: 'open',
        severity: 'WARNING',
        last_reported_at: '2026-03-03T19:00:00.000Z',
      }),
      makeItem({
        id: 'b2',
        package_name: 'com.beta',
        feedback_key: 'second',
        status: 'resolved',
        severity: 'ERROR',
        last_reported_at: '2026-03-03T18:59:00.000Z',
      }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.package_name).toBe('com.beta');
    expect(groups[0]?.open_count).toBe(1);
    expect(groups[0]?.total_count).toBe(2);
    expect(groups[0]?.severity).toBe('ERROR');
    expect(groups[0]?.latest_reported_at).toBe('2026-03-03T19:00:00.000Z');
    expect(groups[1]?.package_name).toBe('com.zeta');
  });

  it('sorts messages within each app by open first then latest timestamp', () => {
    const groups = groupAppFeedbackItems([
      makeItem({
        id: 'r-old',
        package_name: 'com.example',
        feedback_key: 'resolved-old',
        status: 'resolved',
        last_reported_at: '2026-03-03T18:58:00.000Z',
      }),
      makeItem({
        id: 'o-new',
        package_name: 'com.example',
        feedback_key: 'open-new',
        status: 'open',
        last_reported_at: '2026-03-03T19:02:00.000Z',
      }),
      makeItem({
        id: 'o-old',
        package_name: 'com.example',
        feedback_key: 'open-old',
        status: 'open',
        last_reported_at: '2026-03-03T19:00:00.000Z',
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.items.map((item) => item.id)).toEqual(['o-new', 'o-old', 'r-old']);
  });
});
