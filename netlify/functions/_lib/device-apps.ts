export interface DeviceAppInventoryRow {
  package_name: string;
  display_name: string | null;
  version_name: string | null;
  version_code: number | null;
  state: string | null;
  source: string | null;
  icon_url: string | null;
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function deriveDeviceApplicationsFromSnapshot(snapshotValue: unknown): DeviceAppInventoryRow[] {
  const snapshot = parseJsonObject(snapshotValue);
  const reports = Array.isArray(snapshot.applicationReports)
    ? snapshot.applicationReports as Array<Record<string, unknown>>
    : [];

  const rows: DeviceAppInventoryRow[] = [];
  for (const report of reports) {
    const packageName = typeof report.packageName === 'string' ? report.packageName : '';
    if (!packageName) continue;
    rows.push({
      package_name: packageName,
      display_name: typeof report.displayName === 'string' ? report.displayName : null,
      version_name: typeof report.versionName === 'string' ? report.versionName : null,
      version_code: typeof report.versionCode === 'number' ? report.versionCode : null,
      state: typeof report.state === 'string' ? report.state : null,
      source: typeof report.applicationSource === 'string' ? report.applicationSource : null,
      icon_url: null,
    });
  }

  rows.sort((a, b) => {
    const aName = (a.display_name ?? a.package_name).toLowerCase();
    const bName = (b.display_name ?? b.package_name).toLowerCase();
    return aName.localeCompare(bName);
  });

  return rows;
}
