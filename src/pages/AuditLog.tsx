import { auditActionLabel } from '@/lib/audit-label';
import { useState } from 'react';
import { AUDIT_ACTION_FAMILIES, AUDIT_EXACT_ACTIONS, isProductAuditAction } from '../../shared/audit-actions';
import { useContextStore } from '@/stores/context';
import { useAuditLog, isAuditAccessDenied, type AuditEntry } from '@/api/queries/audit';
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

// ---- Main AuditLog page ----

export default function AuditLog() {
  const { activeEnvironment } = useContextStore();
  const [perPage, setPerPage] = useState(25);
  return <AuditLogContent key={activeEnvironment?.id ?? ''} activeEnvironment={activeEnvironment} perPage={perPage} setPerPage={setPerPage} />;
}

function AuditLogContent({ activeEnvironment, perPage, setPerPage }: { activeEnvironment: ReturnType<typeof useContextStore.getState>['activeEnvironment']; perPage: number; setPerPage: (value: number) => void }) {
  const LIVE_REFRESH_MS = 30000;
  const environmentId = activeEnvironment?.id ?? '';

  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState('');
  const [exactDraft, setExactDraft] = useState('');
  const [exactAction, setExactAction] = useState('');
  const [exactError, setExactError] = useState(false);

  const { data, isPending, isPaused, isError, error, failureCount, failureReason, isFetching, refetch, dataUpdatedAt } = useAuditLog({
    environment_id: environmentId,
    page,
    per_page: perPage,
    action: actionFilter === 'exact' ? exactAction || undefined : actionFilter.startsWith('family:') ? undefined : actionFilter || undefined,
    action_family: actionFilter.startsWith('family:') ? actionFilter.slice('family:'.length) : undefined,
  });

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const hasFailure = isError || failureCount > 0;
  const failure = error ?? failureReason;
  const errorMessage = isAuditAccessDenied(failure)
    ? failure.status === 401
      ? 'Sign in again to view audit logs.'
      : 'You do not have permission to view audit logs in this environment.'
    : data !== undefined
      ? 'Audit logs could not be refreshed. Retry to load current entries.'
      : 'Unable to load audit logs. Please try again.';

  const columns: ColumnDef<AuditEntry>[] = [
    {
      key: 'action',
      label: 'Action',
      render: (_val, row) => (
        <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700 font-mono">
          {auditActionLabel(row.action)}
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
          {!hasFailure && !isPaused && dataUpdatedAt > 0 && (
            <LivePageIndicator intervalMs={LIVE_REFRESH_MS} lastUpdatedAt={dataUpdatedAt} />
          )}
        </div>

        {/* Action filter */}
        <div className="flex min-w-0 w-full flex-wrap items-center gap-2 sm:w-auto">
          <Filter className="h-4 w-4 text-gray-400" />
          <select
            aria-label="Filter audit action"
            value={actionFilter}
            onChange={(e) => {
              setActionFilter(e.target.value);
              setExactDraft(''); setExactAction(''); setExactError(false);
              setPage(1);
            }}
            className="min-w-0 max-w-full flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 sm:flex-none"
          >
            <option value="">All Actions</option>
            <optgroup label="Action families">
              {AUDIT_ACTION_FAMILIES.map(family => <option key={family.id} value={`family:${family.id}`}>{family.label}</option>)}
            </optgroup>
            <optgroup label="Specific actions">
              {AUDIT_EXACT_ACTIONS.map(item => <option key={item.action} value={item.action}>{item.label}</option>)}
            </optgroup>
            <option value="exact">Exact action...</option>
          </select>
          {actionFilter === 'exact' && (
            <form className="flex w-full min-w-0 basis-full flex-wrap items-center gap-2 sm:w-auto sm:basis-auto" onSubmit={event => {
              event.preventDefault(); const value = exactDraft.trim();
              if (value && !isProductAuditAction(value)) { setExactError(true); return; }
              setExactError(false); setExactAction(value); setPage(1);
            }}>
              <input aria-label="Exact audit action" value={exactDraft} maxLength={128} onChange={event => setExactDraft(event.target.value)} placeholder="policy.updated" className="w-0 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 sm:w-auto" />
              <button type="submit" className="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-accent/20">Apply</button>
              <p className="w-full break-all text-xs text-muted">{exactAction ? `Applied action: ${exactAction}` : 'Enter a dotted product action and select Apply.'}</p>
              {exactError && <p role="alert" className="w-full text-sm text-red-600">Enter a product action such as policy.updated.</p>}
            </form>
          )}
        </div>
      </div>

      {isPaused ? (
        <div role="status" className="rounded-lg border border-blue-100 bg-blue-50/50 px-4 py-3 text-sm text-blue-900">
          Audit logs are waiting for a network connection.
        </div>
      ) : hasFailure ? (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p>{errorMessage}</p>
          <button
            type="button"
            onClick={() => { void refetch(); }}
            disabled={isFetching}
            aria-label="Retry audit log"
            className="mt-3 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-50"
          >
            {isFetching ? 'Retrying...' : 'Retry'}
          </button>
        </div>
      ) : (
        <DataTable<AuditEntry>
          columns={columns}
          data={entries}
          loading={isPending}
          emptyMessage="No audit entries found."
        />
      )}

      {/* Pagination */}
      {!hasFailure && !isPaused && total > 0 && (
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
            total={total}
          />
        </div>
      )}
    </div>
  );
}
