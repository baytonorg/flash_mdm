import type { ReactNode } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Tooltip,
  Legend,
} from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';
import {
  Cpu,
  Smartphone,
  Wifi,
  HardDrive,
  Shield,
  Monitor,
  Activity,
  Database,
  KeyRound,
} from 'lucide-react';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Tooltip,
  Legend,
);

type Snapshot = Record<string, unknown>;

interface Device {
  serial_number: string | null;
  imei: string | null;
  manufacturer: string | null;
  model: string | null;
  os_version: string | null;
  security_patch_level: string | null;
  state: string;
  ownership: string | null;
  management_mode: string | null;
  amapi_name: string;
  snapshot: Snapshot | null;
}

export interface DeviceInfoProps {
  device: Device;
}

interface TelephonyInfo {
  iccId?: string;
  configMode?: string;
  carrierName?: string;
  activationState?: string;
  imei?: string;
}

interface DisplayInfo {
  name?: string;
  state?: string;
  width?: number;
  height?: number;
  density?: number;
  refreshRate?: number;
}

interface MemoryEvent {
  byteCount?: string | number;
  eventType?: string;
  createTime?: string;
}

interface PowerEvent {
  eventType?: string;
  createTime?: string;
  batteryLevel?: number;
}

interface ApplicationReportSummary {
  state?: string;
  applicationSource?: string;
  userFacingType?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getPathValue(source: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = source;

  for (const part of parts) {
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
      continue;
    }
    if (!isRecord(current)) return undefined;
    current = current[part];
  }

  return current;
}

function extractSnapshotValue(snapshot: Snapshot | null, ...paths: string[]): string | null {
  if (!snapshot) return null;
  for (const path of paths) {
    const value = getPathValue(snapshot, path);
    const formatted = formatScalar(value);
    if (formatted != null) return formatted;
  }
  return null;
}

function formatScalar(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function formatDateTime(value: unknown): string | null {
  const text = formatScalar(value);
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function parseNumeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatBytes(value: unknown): string | null {
  const num = parseNumeric(value);
  if (num == null) return null;
  if (num < 1024) return `${num} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let scaled = num;
  let unitIndex = -1;
  while (scaled >= 1024 && unitIndex < units.length - 1) {
    scaled /= 1024;
    unitIndex += 1;
  }
  return `${scaled.toFixed(scaled >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatBoolean(value: unknown): string | null {
  if (typeof value !== 'boolean') return null;
  return value ? 'Yes' : 'No';
}

function prettyKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function safeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function parseJsonString(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function countBy(items: string[]): Array<{ label: string; count: number }> {
  const map = new Map<string, number>();
  for (const item of items) {
    map.set(item, (map.get(item) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5 border-b border-border last:border-b-0">
      <span className="text-sm text-muted">{label}</span>
      <div className="text-sm font-medium text-gray-900 text-right max-w-[65%] break-words">
        {value ?? <span className="text-muted font-normal">N/A</span>}
      </div>
    </div>
  );
}

function Section({
  icon,
  title,
  children,
  className,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-border bg-surface p-5 ${className ?? ''}`.trim()}>
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      </div>
      <div>{children}</div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <h3 className="text-sm font-semibold text-gray-900 mb-3">{title}</h3>
      <div className="h-56">{children}</div>
    </div>
  );
}

function CodeBlock({ value }: { value: string }) {
  return (
    <pre className="rounded-lg border border-border bg-surface-secondary p-3 text-xs leading-relaxed whitespace-pre-wrap break-words text-left font-normal">
      {value}
    </pre>
  );
}

export default function DeviceInfo({ device }: DeviceInfoProps) {
  const snap = device.snapshot;

  const displays = safeArray<DisplayInfo>(snap?.displays);
  const telephonyInfos = safeArray<TelephonyInfo>(getPathValue(snap, 'networkInfo.telephonyInfos'));
  const memoryEvents = safeArray<MemoryEvent>(snap?.memoryEvents)
    .filter((event) => event && (event.createTime || event.eventType))
    .sort((a, b) => {
      const aTime = a.createTime ? new Date(a.createTime).getTime() : 0;
      const bTime = b.createTime ? new Date(b.createTime).getTime() : 0;
      return aTime - bTime;
    });
  const powerEvents = safeArray<PowerEvent>(snap?.powerManagementEvents)
    .filter((event) => event && (event.createTime || event.eventType))
    .sort((a, b) => {
      const aTime = a.createTime ? new Date(a.createTime).getTime() : 0;
      const bTime = b.createTime ? new Date(b.createTime).getTime() : 0;
      return bTime - aTime;
    });
  const appReports = safeArray<ApplicationReportSummary>(snap?.applicationReports);
  const systemProperties = isRecord(snap?.systemProperties) ? snap.systemProperties : null;
  const enrollmentTokenDataParsed = parseJsonString(snap?.enrollmentTokenData);

  const appSourceCounts = countBy(
    appReports
      .map((a) => a.applicationSource)
      .filter((v): v is string => typeof v === 'string' && v.length > 0),
  ).slice(0, 8);

  const appFacingCounts = countBy(
    appReports
      .map((a) => a.userFacingType)
      .filter((v): v is string => typeof v === 'string' && v.length > 0),
  );

  const storageMeasuredTypes = ['INTERNAL_STORAGE_MEASURED', 'EXTERNAL_STORAGE_MEASURED'];
  const memoryMeasuredTypes = ['RAM_MEASURED'];
  const measuredEvents = memoryEvents.filter(
    (e) => e.eventType && [...storageMeasuredTypes, ...memoryMeasuredTypes].includes(e.eventType),
  );

  const memoryEventPoints = measuredEvents
    .map((event) => ({
      label: event.createTime
        ? new Date(event.createTime).toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            month: 'short',
            day: 'numeric',
          })
        : 'Unknown',
      bytes: parseNumeric(event.byteCount),
      type: event.eventType ?? 'Unknown',
      isStorage: storageMeasuredTypes.includes(event.eventType ?? ''),
    }))
    .filter((point) => point.bytes != null) as Array<{ label: string; bytes: number; type: string; isStorage: boolean }>;

  const memoryLineData = {
    labels: memoryEventPoints.map((p) => p.label),
    datasets: [
      {
        label: 'Storage',
        data: memoryEventPoints.map((p) => (p.isStorage ? p.bytes : null)),
        borderColor: '#2563eb',
        backgroundColor: '#2563eb22',
        fill: false,
        spanGaps: false,
        tension: 0.25,
        pointRadius: 3,
        pointHoverRadius: 5,
        borderWidth: 2,
      },
      {
        label: 'Memory (RAM)',
        data: memoryEventPoints.map((p) => (!p.isStorage ? p.bytes : null)),
        borderColor: '#16a34a',
        backgroundColor: '#16a34a22',
        fill: false,
        spanGaps: false,
        tension: 0.25,
        pointRadius: 3,
        pointHoverRadius: 5,
        borderWidth: 2,
      },
    ],
  };

  const batteryPoints = powerEvents
    .filter((e) => e.batteryLevel != null && e.createTime)
    .sort((a, b) => new Date(a.createTime!).getTime() - new Date(b.createTime!).getTime())
    .map((e) => ({
      label: new Date(e.createTime!).toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        month: 'short',
        day: 'numeric',
      }),
      level: e.batteryLevel!,
    }));

  const powerLineData = {
    labels: batteryPoints.map((p) => p.label),
    datasets: [
      {
        label: 'Battery %',
        data: batteryPoints.map((p) => p.level),
        borderColor: '#f59e0b',
        backgroundColor: '#f59e0b22',
        fill: true,
        tension: 0.3,
        pointRadius: 3,
        pointHoverRadius: 5,
        borderWidth: 2,
      },
    ],
  };

  const appSourceBarData = {
    labels: appSourceCounts.map((item) => item.label.replace(/_/g, ' ')),
    datasets: [
      {
        label: 'Apps',
        data: appSourceCounts.map((item) => item.count),
        backgroundColor: '#0ea5e9',
        borderRadius: 6,
      },
    ],
  };

  const baseChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: { color: '#374151', boxWidth: 12 },
      },
      tooltip: {
        backgroundColor: '#111827',
        titleFont: { size: 12 },
        bodyFont: { size: 12 },
        padding: 10,
        cornerRadius: 8,
      },
    },
  } as const;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section icon={<Smartphone className="h-4 w-4 text-muted" />} title="Hardware">
          <InfoRow label="Manufacturer" value={device.manufacturer ?? 'N/A'} />
          <InfoRow label="Model" value={device.model ?? 'N/A'} />
          <InfoRow label="Brand" value={extractSnapshotValue(snap, 'hardwareInfo.brand') ?? 'N/A'} />
          <InfoRow label="Hardware Codename" value={extractSnapshotValue(snap, 'hardwareInfo.hardware') ?? 'N/A'} />
          <InfoRow label="Serial Number" value={device.serial_number ?? 'N/A'} />
          <InfoRow label="IMEI" value={device.imei ?? extractSnapshotValue(snap, 'networkInfo.imei') ?? 'N/A'} />
          <InfoRow label="Baseband" value={extractSnapshotValue(snap, 'hardwareInfo.deviceBasebandVersion') ?? 'N/A'} />
          <InfoRow
            label="eUICC EIDs"
            value={
              safeArray<Record<string, unknown>>(getPathValue(snap, 'hardwareInfo.euiccChipInfo'))
                .map((chip) => formatScalar(chip.eid))
                .filter((v): v is string => Boolean(v))
                .join(', ') || 'N/A'
            }
          />
        </Section>

        <Section icon={<Cpu className="h-4 w-4 text-muted" />} title="Software">
          <InfoRow label="Android Version" value={device.os_version ?? extractSnapshotValue(snap, 'softwareInfo.androidVersion') ?? 'N/A'} />
          <InfoRow label="API Level" value={extractSnapshotValue(snap, 'apiLevel') ?? 'N/A'} />
          <InfoRow label="Security Patch Level" value={device.security_patch_level ?? extractSnapshotValue(snap, 'softwareInfo.securityPatchLevel') ?? 'N/A'} />
          <InfoRow label="Build Number" value={extractSnapshotValue(snap, 'softwareInfo.androidBuildNumber') ?? 'N/A'} />
          <InfoRow label="Build Time" value={formatDateTime(getPathValue(snap, 'softwareInfo.androidBuildTime')) ?? 'N/A'} />
          <InfoRow label="Bootloader Version" value={extractSnapshotValue(snap, 'softwareInfo.bootloaderVersion') ?? 'N/A'} />
          <InfoRow label="Kernel Version" value={extractSnapshotValue(snap, 'softwareInfo.deviceKernelVersion') ?? 'N/A'} />
          <InfoRow label="Primary Language" value={extractSnapshotValue(snap, 'softwareInfo.primaryLanguageCode') ?? 'N/A'} />
          <InfoRow label="System Update Status" value={extractSnapshotValue(snap, 'softwareInfo.systemUpdateInfo.updateStatus') ?? 'N/A'} />
          <InfoRow label="ADP Version" value={extractSnapshotValue(snap, 'softwareInfo.androidDevicePolicyVersionName') ?? 'N/A'} />
          <InfoRow label="ADP Version Code" value={extractSnapshotValue(snap, 'softwareInfo.androidDevicePolicyVersionCode') ?? 'N/A'} />
        </Section>

        <Section icon={<Wifi className="h-4 w-4 text-muted" />} title="Network">
          <InfoRow label="Network Operator" value={extractSnapshotValue(snap, 'networkInfo.networkOperatorName') ?? 'N/A'} />
          <InfoRow label="Wi-Fi MAC" value={extractSnapshotValue(snap, 'networkInfo.wifiMacAddress') ?? 'N/A'} />
          <InfoRow label="MEID" value={extractSnapshotValue(snap, 'networkInfo.meid') ?? 'N/A'} />
          <InfoRow label="Top-Level IMEI" value={extractSnapshotValue(snap, 'networkInfo.imei') ?? 'N/A'} />
          <InfoRow label="SIM Entries" value={String(telephonyInfos.length)} />
          {telephonyInfos.map((info, idx) => (
            <InfoRow
              key={`tel-${idx}`}
              label={`SIM ${idx + 1}`}
              value={
                [info.carrierName, info.activationState, info.configMode, info.iccId]
                  .filter((v): v is string => typeof v === 'string' && v.length > 0)
                  .join(' | ') || 'N/A'
              }
            />
          ))}
        </Section>

        <Section icon={<Shield className="h-4 w-4 text-muted" />} title="Security & Storage">
          <InfoRow label="Encrypted" value={formatBoolean(getPathValue(snap, 'deviceSettings.isEncrypted')) ?? 'N/A'} />
          <InfoRow label="Encryption Status" value={extractSnapshotValue(snap, 'deviceSettings.encryptionStatus') ?? 'N/A'} />
          <InfoRow label="Verify Apps Enabled" value={formatBoolean(getPathValue(snap, 'deviceSettings.verifyAppsEnabled')) ?? 'N/A'} />
          <InfoRow label="Security Posture" value={extractSnapshotValue(snap, 'securityPosture.devicePosture') ?? 'N/A'} />
          <InfoRow
            label="Total RAM"
            value={
              (() => {
                const raw = getPathValue(snap, 'memoryInfo.totalRam');
                const pretty = formatBytes(raw);
                const rawText = formatScalar(raw);
                return pretty && rawText ? `${pretty} (${rawText} bytes)` : pretty ?? rawText ?? 'N/A';
              })()
            }
          />
          <InfoRow
            label="Storage Capacity"
            value={
              (() => {
                // Prefer EXTERNAL_STORAGE_DETECTED from memoryEvents (actual usable storage),
                // fall back to memoryInfo.totalInternalStorage (often just the system partition)
                const events = getPathValue(snap, 'memoryEvents');
                let raw: unknown = null;
                if (Array.isArray(events)) {
                  const ext = events.find(
                    (e: Record<string, unknown>) => e.eventType === 'EXTERNAL_STORAGE_DETECTED'
                  );
                  if (ext?.byteCount) raw = ext.byteCount;
                }
                if (raw == null) raw = getPathValue(snap, 'memoryInfo.totalInternalStorage');
                const pretty = formatBytes(raw);
                const rawText = formatScalar(raw);
                return pretty && rawText ? `${pretty} (${rawText} bytes)` : pretty ?? rawText ?? 'N/A';
              })()
            }
          />
          <InfoRow label="First API Level" value={extractSnapshotValue(snap, 'systemProperties.ro.product.first_api_level') ?? 'N/A'} />
        </Section>

        <Section icon={<HardDrive className="h-4 w-4 text-muted" />} title="Management">
          <InfoRow label="AMAPI Name" value={device.amapi_name} />
          <InfoRow label="AMAPI User" value={extractSnapshotValue(snap, 'userName') ?? 'N/A'} />
          <InfoRow label="State" value={device.state} />
          <InfoRow label="Applied State" value={extractSnapshotValue(snap, 'appliedState') ?? 'N/A'} />
          <InfoRow label="Ownership" value={device.ownership ?? 'N/A'} />
          <InfoRow label="Management Mode" value={device.management_mode ?? 'N/A'} />
          <InfoRow label="Policy Name" value={extractSnapshotValue(snap, 'policyName') ?? 'N/A'} />
          <InfoRow label="Applied Policy" value={extractSnapshotValue(snap, 'appliedPolicyName') ?? 'N/A'} />
          <InfoRow label="Applied Policy Version" value={extractSnapshotValue(snap, 'appliedPolicyVersion') ?? 'N/A'} />
          <InfoRow label="Policy Compliant" value={formatBoolean(getPathValue(snap, 'policyCompliant')) ?? 'N/A'} />
          <InfoRow label="Last Policy Sync" value={formatDateTime(getPathValue(snap, 'lastPolicySyncTime')) ?? 'N/A'} />
          <InfoRow label="Last Status Report" value={formatDateTime(getPathValue(snap, 'lastStatusReportTime')) ?? 'N/A'} />
        </Section>

        <Section icon={<KeyRound className="h-4 w-4 text-muted" />} title="Enrolment">
          <InfoRow label="Enrolment Time" value={formatDateTime(getPathValue(snap, 'enrollmentTime')) ?? 'N/A'} />
          <InfoRow label="Enrolment Token Name" value={extractSnapshotValue(snap, 'enrollmentTokenName') ?? 'N/A'} />
          <InfoRow label="Enrolment Token Group" value={(enrollmentTokenDataParsed?.group_id as string | undefined) ?? 'N/A'} />
          <InfoRow label="Enrolment Token Data" value={extractSnapshotValue(snap, 'enrollmentTokenData') ?? 'N/A'} />
        </Section>
      </div>

      {displays.length > 0 && (
        <Section icon={<Monitor className="h-4 w-4 text-muted" />} title="Displays">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {displays.map((display, index) => (
              <div key={`${display.name ?? 'display'}-${index}`} className="rounded-lg border border-border bg-surface-secondary p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className="text-sm font-medium text-gray-900 truncate">{display.name ?? `Display ${index + 1}`}</p>
                  <span className="text-xs rounded-full border border-border px-2 py-0.5 text-gray-700">
                    {display.state ?? 'Unknown'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-gray-700">
                  <div>Resolution: {display.width && display.height ? `${display.width} x ${display.height}` : 'N/A'}</div>
                  <div>Density: {display.density ?? 'N/A'}</div>
                  <div>Refresh: {display.refreshRate ? `${display.refreshRate} Hz` : 'N/A'}</div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {(memoryEventPoints.length > 0 || batteryPoints.length > 0 || appSourceCounts.length > 0) && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {memoryEventPoints.length > 0 && (
            <ChartCard title="Memory & Storage (Measured)">
              <Line
                data={memoryLineData}
                options={{
                  ...baseChartOptions,
                  plugins: {
                    ...baseChartOptions.plugins,
                    legend: { position: 'bottom' },
                  },
                  scales: {
                    x: {
                      grid: { display: false },
                      ticks: { color: '#6b7280', maxTicksLimit: 6 },
                    },
                    y: {
                      beginAtZero: true,
                      grid: { color: '#f3f4f6' },
                      ticks: {
                        color: '#6b7280',
                        callback: (value) => formatBytes(Number(value)) ?? String(value),
                      },
                    },
                  },
                }}
              />
            </ChartCard>
          )}

          {batteryPoints.length > 0 && (
            <ChartCard title="Battery Level Over Time">
              <Line
                data={powerLineData}
                options={{
                  ...baseChartOptions,
                  plugins: {
                    ...baseChartOptions.plugins,
                    legend: { display: false },
                  },
                  scales: {
                    x: {
                      grid: { display: false },
                      ticks: { color: '#6b7280', maxTicksLimit: 6 },
                    },
                    y: {
                      beginAtZero: true,
                      max: 100,
                      grid: { color: '#f3f4f6' },
                      ticks: {
                        color: '#6b7280',
                        callback: (value) => `${value}%`,
                      },
                    },
                  },
                }}
              />
            </ChartCard>
          )}

          {appSourceCounts.length > 0 && (
            <ChartCard title={`Application Sources (${appReports.length})`}>
              <Bar
                data={appSourceBarData}
                options={{
                  ...baseChartOptions,
                  plugins: { ...baseChartOptions.plugins, legend: { display: false } },
                  scales: {
                    x: {
                      grid: { display: false },
                      ticks: { color: '#6b7280', maxRotation: 45, minRotation: 0 },
                    },
                    y: {
                      beginAtZero: true,
                      grid: { color: '#f3f4f6' },
                      ticks: { color: '#6b7280', precision: 0 },
                    },
                  },
                }}
              />
            </ChartCard>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section icon={<Activity className="h-4 w-4 text-muted" />} title="Power Management Events">
          {powerEvents.length === 0 ? (
            <p className="text-sm text-muted">No power management events reported.</p>
          ) : (
            <div className="space-y-2">
              {powerEvents.slice(0, 12).map((event, idx) => (
                <div key={`${event.eventType ?? 'event'}-${event.createTime ?? idx}`} className="rounded-lg border border-border bg-surface-secondary p-3">
                  <div className="text-sm font-medium text-gray-900">{event.eventType ?? 'Unknown event'}</div>
                  <div className="text-xs text-muted mt-1">{formatDateTime(event.createTime) ?? 'Unknown time'}</div>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section icon={<Database className="h-4 w-4 text-muted" />} title="Memory Events">
          {memoryEvents.length === 0 ? (
            <p className="text-sm text-muted">No memory events reported.</p>
          ) : (
            <div className="space-y-2">
              {memoryEvents
                .slice()
                .reverse()
                .slice(0, 12)
                .map((event, idx) => {
                  const rawByteCount = formatScalar(event.byteCount);
                  const prettyByteCount = formatBytes(event.byteCount);
                  return (
                    <div key={`${event.eventType ?? 'memory'}-${event.createTime ?? idx}`} className="rounded-lg border border-border bg-surface-secondary p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-gray-900">{event.eventType ?? 'Unknown event'}</div>
                          <div className="text-xs text-muted mt-1">{formatDateTime(event.createTime) ?? 'Unknown time'}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-medium text-gray-900">{prettyByteCount ?? 'N/A'}</div>
                          {rawByteCount && <div className="text-xs text-muted">{rawByteCount} bytes</div>}
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </Section>
      </div>

      {(appReports.length > 0 || appFacingCounts.length > 0) && (
        <Section icon={<Smartphone className="h-4 w-4 text-muted" />} title="Application Report Summary">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="rounded-lg border border-border bg-surface-secondary p-3">
              <p className="text-xs uppercase tracking-wider text-muted">Total App Reports</p>
              <p className="text-xl font-semibold text-gray-900 mt-1">{appReports.length}</p>
            </div>
            {appFacingCounts.slice(0, 2).map((item) => (
              <div key={item.label} className="rounded-lg border border-border bg-surface-secondary p-3">
                <p className="text-xs uppercase tracking-wider text-muted">{prettyKey(item.label)}</p>
                <p className="text-xl font-semibold text-gray-900 mt-1">{item.count}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted">
            Full installed app list is available in the Applications tab. This section summarizes `applicationReports` from the AMAPI snapshot.
          </p>
        </Section>
      )}

      {systemProperties && Object.keys(systemProperties).length > 0 && (
        <Section icon={<Cpu className="h-4 w-4 text-muted" />} title="System Properties">
          <div className="grid grid-cols-1 gap-0">
            {Object.entries(systemProperties)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, value]) => (
                <InfoRow key={key} label={key} value={formatScalar(value) ?? JSON.stringify(value)} />
              ))}
          </div>
        </Section>
      )}

      {(enrollmentTokenDataParsed || typeof snap?.enrollmentTokenData === 'string') && (
        <Section icon={<KeyRound className="h-4 w-4 text-muted" />} title="Enrolment Token Data (Parsed)">
          {enrollmentTokenDataParsed ? (
            <CodeBlock value={JSON.stringify(enrollmentTokenDataParsed, null, 2)} />
          ) : typeof snap?.enrollmentTokenData === 'string' ? (
            <CodeBlock value={snap.enrollmentTokenData} />
          ) : (
            <p className="text-sm text-muted">No enrollment token data available.</p>
          )}
        </Section>
      )}
    </div>
  );
}
