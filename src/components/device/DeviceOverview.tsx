import { Monitor, Shield, Clock, Calendar, Package } from 'lucide-react';
import StatusBadge from '@/components/common/StatusBadge';

interface Device {
  id: string;
  serial_number: string | null;
  manufacturer: string | null;
  model: string | null;
  os_version: string | null;
  security_patch_level: string | null;
  state: string;
  ownership: string | null;
  management_mode: string | null;
  policy_compliant: boolean | null;
  enrollment_time: string | null;
  last_status_report_at: string | null;
  imei: string | null;
  group_id: string | null;
  group_name: string | null;
}

interface AppSummary {
  package_name: string;
  display_name: string;
  icon_url?: string | null;
}

export interface DeviceOverviewProps {
  device: Device;
  applications?: AppSummary[];
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'Unknown';
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function InfoItem({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-muted uppercase tracking-wider">{label}</span>
      <span className="text-sm text-gray-900">{value || 'N/A'}</span>
    </div>
  );
}

export default function DeviceOverview({ device, applications = [] }: DeviceOverviewProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Device Identity */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="flex items-center gap-2 mb-4">
          <Monitor className="h-4 w-4 text-muted" />
          <h3 className="text-sm font-semibold text-gray-900">Device Identity</h3>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <InfoItem label="Serial Number" value={device.serial_number} />
          <InfoItem label="IMEI" value={device.imei} />
          <InfoItem label="Manufacturer" value={device.manufacturer} />
          <InfoItem label="Model" value={device.model} />
          <InfoItem label="OS Version" value={device.os_version} />
          <InfoItem label="Security Patch" value={device.security_patch_level} />
        </div>
      </div>

      {/* Management Status */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="flex items-center gap-2 mb-4">
          <Shield className="h-4 w-4 text-muted" />
          <h3 className="text-sm font-semibold text-gray-900">Management Status</h3>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-medium text-muted uppercase tracking-wider">State</span>
            <StatusBadge status={device.state} />
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-medium text-muted uppercase tracking-wider">Ownership</span>
            {device.ownership ? (
              <StatusBadge status={device.ownership} />
            ) : (
              <span className="text-sm text-gray-900">N/A</span>
            )}
          </div>
          <InfoItem label="Group" value={device.group_name ?? 'None'} />
          <InfoItem label="Management Mode" value={device.management_mode} />
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-medium text-muted uppercase tracking-wider">Compliance</span>
            {device.policy_compliant === null ? (
              <span className="text-sm text-gray-900">Unknown</span>
            ) : device.policy_compliant ? (
              <StatusBadge status="COMPLIANT" />
            ) : (
              <StatusBadge status="NON_COMPLIANT" />
            )}
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="flex items-center gap-2 mb-4">
          <Clock className="h-4 w-4 text-muted" />
          <h3 className="text-sm font-semibold text-gray-900">Activity</h3>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-medium text-muted uppercase tracking-wider">Last Seen</span>
            <span className="text-sm text-gray-900">{formatRelativeTime(device.last_status_report_at)}</span>
            {device.last_status_report_at && (
              <span className="text-xs text-muted">{formatDate(device.last_status_report_at)}</span>
            )}
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-medium text-muted uppercase tracking-wider">Enrolled</span>
            <span className="text-sm text-gray-900">{formatRelativeTime(device.enrollment_time)}</span>
            {device.enrollment_time && (
              <span className="text-xs text-muted">{formatDate(device.enrollment_time)}</span>
            )}
          </div>
        </div>
      </div>

      {/* Enrollment Info */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="flex items-center gap-2 mb-4">
          <Calendar className="h-4 w-4 text-muted" />
          <h3 className="text-sm font-semibold text-gray-900">Enrolment Details</h3>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <InfoItem label="Enrolment Date" value={formatDate(device.enrollment_time)} />
          <InfoItem label="Management Mode" value={device.management_mode} />
        </div>
      </div>

      {/* Installed Apps Summary */}
      {applications.length > 0 && (
        <div className="rounded-xl border border-border bg-surface p-5 lg:col-span-2">
          <div className="flex items-center gap-2 mb-4">
            <Package className="h-4 w-4 text-muted" />
            <h3 className="text-sm font-semibold text-gray-900">
              Installed Apps
              <span className="ml-1.5 text-xs font-normal text-muted">({applications.length})</span>
            </h3>
          </div>
          <div className="flex flex-wrap gap-3">
            {applications.slice(0, 20).map((app) => (
              <div
                key={app.package_name}
                className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-1.5"
                title={app.package_name}
              >
                {app.icon_url ? (
                  <img
                    src={app.icon_url}
                    alt=""
                    className="h-5 w-5 rounded object-contain"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                ) : (
                  <Package className="h-4 w-4 text-gray-400" />
                )}
                <span className="text-xs text-gray-700">{app.display_name || app.package_name}</span>
              </div>
            ))}
            {applications.length > 20 && (
              <span className="flex items-center text-xs text-muted px-2">
                +{applications.length - 20} more
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
