import { Clock, FileText } from 'lucide-react';

interface AuditEntry {
  action: string;
  resource_type: string;
  details: Record<string, any> | string | null;
  created_at: string;
}

export interface DeviceAuditLogProps {
  entries: AuditEntry[];
}

function formatRelativeTime(dateStr: string): string {
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

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatAction(action: string): string {
  return action
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function DeviceAuditLog({ entries }: DeviceAuditLogProps) {
  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface px-4 py-12 text-center">
        <FileText className="mx-auto h-8 w-8 text-gray-300 mb-2" />
        <p className="text-sm text-muted">No audit log entries for this device.</p>
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {entries.map((entry, index) => (
        <div key={index} className="relative flex gap-4 pb-6 last:pb-0">
          {/* Timeline line */}
          {index < entries.length - 1 && (
            <div className="absolute left-[15px] top-8 bottom-0 w-px bg-border" />
          )}

          {/* Timeline dot */}
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface-secondary">
            <Clock className="h-3.5 w-3.5 text-muted" />
          </div>

          {/* Content */}
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {formatAction(entry.action)}
                </p>
                <p className="text-xs text-muted mt-0.5">
                  {entry.resource_type}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-xs font-medium text-gray-600">{formatRelativeTime(entry.created_at)}</p>
                <p className="text-xs text-muted">{formatDate(entry.created_at)}</p>
              </div>
            </div>

            {entry.details && (
              <div className="mt-2 rounded-lg bg-surface-secondary border border-border px-3 py-2">
                <pre className="text-xs text-muted whitespace-pre-wrap break-words">
                  {typeof entry.details === 'string'
                    ? entry.details
                    : JSON.stringify(entry.details, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
