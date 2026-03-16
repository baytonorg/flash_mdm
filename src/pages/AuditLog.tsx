import { useState, useMemo, useEffect } from 'react';
import { useContextStore } from '@/stores/context';
import { useAuditLog, type AuditEntry } from '@/api/queries/audit';
import DataTable, { type ColumnDef } from '@/components/common/DataTable';
import Pagination from '@/components/common/Pagination';
import LivePageIndicator from '@/components/common/LivePageIndicator';
import { Filter } from 'lucide-react';

// ---- Helpers ----

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

const ACTION_TYPES = [
  'All Actions',
  'device.enroll',
  'device.delete',
  'device.wipe',
  'device.lock',
  'device.reboot',
  'policy.create',
  'policy.update',
  'policy.delete',
  'group.create',
  'group.update',
  'group.delete',
  'user.invite',
  'user.remove',
  'environment.bind',
  'environment.update',
  'workspace.update',
  'auth.login',
  'auth.logout',
];

// ---- Main AuditLog page ----

export default function AuditLog() {
  const LIVE_REFRESH_MS = 30000;
  const { activeEnvironment } = useContextStore();
  const environmentId = activeEnvironment?.id ?? '';

  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [actionFilter, setActionFilter] = useState('');

  // Reset pagination on environment switch
  useEffect(() => { setPage(1); setActionFilter(''); }, [environmentId]);

  const { data, isLoading, dataUpdatedAt } = useAuditLog({
    environment_id: environmentId,
    page,
    per_page: perPage,
  });

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  // Client-side filter on action type (API might not support it)
  const filteredEntries = useMemo(() => {
    if (!actionFilter) return entries;
    return entries.filter((entry) => entry.action === actionFilter);
  }, [entries, actionFilter]);

  const columns: ColumnDef<AuditEntry>[] = [
    {
      key: 'action',
      label: 'Action',
      render: (_val, row) => (
        <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700 font-mono">
          {row.action}
        </span>
      ),
    },
    {
      key: 'target',
      label: 'Target',
      render: (_val, row) => (
        <span className="text-sm text-gray-600">
          {row.target ?? '—'}
        </span>
      ),
    },
    {
      key: 'actor',
      label: 'User',
      render: (_val, row) => (
        <span className="text-sm text-gray-600">
          {row.actor ?? '—'}
        </span>
      ),
    },
    {
      key: 'ip_address',
      label: 'IP Address',
      render: (_val, row) => (
        <span className="text-sm text-gray-500 font-mono">
          {(row.ip_address as string) ?? '—'}
        </span>
      ),
    },
    {
      key: 'created_at',
      label: 'Timestamp',
      sortable: true,
      render: (_val, row) => (
        <span
          className="text-sm text-gray-500"
          title={new Date(row.created_at).toLocaleString()}
        >
          {timeAgo(row.created_at)}
        </span>
      ),
    },
  ];

  if (!activeEnvironment) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Audit Log</h1>
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <p className="text-gray-500">Select an environment to view audit logs.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-gray-900">Audit Log</h1>
          <LivePageIndicator intervalMs={LIVE_REFRESH_MS} lastUpdatedAt={dataUpdatedAt} />
        </div>

        {/* Action filter */}
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-gray-400" />
          <select
            value={actionFilter}
            onChange={(e) => {
              setActionFilter(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          >
            <option value="">All Actions</option>
            {ACTION_TYPES.filter((a) => a !== 'All Actions').map((action) => (
              <option key={action} value={action}>
                {action}
              </option>
            ))}
          </select>
        </div>
      </div>

      <DataTable<AuditEntry>
        columns={columns}
        data={filteredEntries}
        loading={isLoading}
        emptyMessage="No audit entries found."
      />

      {/* Pagination */}
      {total > 0 && (
        <div className="mt-4">
          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            perPage={perPage}
            onPerPageChange={(pp) => {
              setPerPage(pp);
              setPage(1);
            }}
            total={actionFilter ? filteredEntries.length : total}
          />
        </div>
      )}
    </div>
  );
}
