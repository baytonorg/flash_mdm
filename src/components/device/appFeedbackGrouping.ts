import type { AppFeedbackItem } from '@/api/queries/app-feedback';

export interface GroupedAppFeedback {
  package_name: string;
  items: AppFeedbackItem[];
  latest_reported_at: string | null;
  open_count: number;
  total_count: number;
  severity: string | null;
}

const SEVERITY_RANK: Record<string, number> = {
  ERROR: 3,
  WARNING: 2,
  INFO: 1,
};

function toTimestamp(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function normalizeSeverity(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.toUpperCase();
  return normalized in SEVERITY_RANK ? normalized : value;
}

function severityRank(value: string | null | undefined): number {
  const normalized = normalizeSeverity(value);
  if (!normalized) return 0;
  return SEVERITY_RANK[normalized] ?? 0;
}

function isOpenStatus(status: string | null | undefined): boolean {
  return String(status ?? '').toLowerCase() === 'open';
}

export function groupAppFeedbackItems(items: AppFeedbackItem[]): GroupedAppFeedback[] {
  const grouped = new Map<string, GroupedAppFeedback>();

  for (const item of items) {
    const packageName = item.package_name || '(unknown package)';
    let group = grouped.get(packageName);
    if (!group) {
      group = {
        package_name: packageName,
        items: [],
        latest_reported_at: null,
        open_count: 0,
        total_count: 0,
        severity: null,
      };
      grouped.set(packageName, group);
    }

    group.items.push(item);
    group.total_count += 1;
    if (isOpenStatus(item.status)) group.open_count += 1;

    if (toTimestamp(item.last_reported_at) > toTimestamp(group.latest_reported_at)) {
      group.latest_reported_at = item.last_reported_at;
    }

    if (severityRank(item.severity) > severityRank(group.severity)) {
      group.severity = normalizeSeverity(item.severity);
    }
  }

  const groups = Array.from(grouped.values());

  for (const group of groups) {
    group.items.sort((a, b) => {
      const aOpen = isOpenStatus(a.status) ? 1 : 0;
      const bOpen = isOpenStatus(b.status) ? 1 : 0;
      if (aOpen !== bOpen) return bOpen - aOpen;
      const tsDiff = toTimestamp(b.last_reported_at) - toTimestamp(a.last_reported_at);
      if (tsDiff !== 0) return tsDiff;
      return a.feedback_key.localeCompare(b.feedback_key);
    });
  }

  groups.sort((a, b) => {
    const aOpen = a.open_count > 0 ? 1 : 0;
    const bOpen = b.open_count > 0 ? 1 : 0;
    if (aOpen !== bOpen) return bOpen - aOpen;
    const tsDiff = toTimestamp(b.latest_reported_at) - toTimestamp(a.latest_reported_at);
    if (tsDiff !== 0) return tsDiff;
    return a.package_name.localeCompare(b.package_name);
  });

  return groups;
}
