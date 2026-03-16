import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, ShieldCheck, FileText, Archive, Filter, Search } from 'lucide-react';
import clsx from 'clsx';
import { apiClient } from '@/api/client';
import { useContextStore } from '@/stores/context';
import DataTable, { type ColumnDef } from '@/components/common/DataTable';
import BulkActionBar, { type BulkAction } from '@/components/common/BulkActionBar';
import SelectAllMatchingNotice from '@/components/common/SelectAllMatchingNotice';
import { useBulkSelection } from '@/hooks/useBulkSelection';
import { useBulkPolicyAction } from '@/api/queries/policies';

interface Policy {
  id: string;
  environment_id: string;
  name: string;
  description: string | null;
  deployment_scenario: string;
  config: Record<string, any>;
  amapi_name: string | null;
  version: number;
  status: string;
  device_count: number;
  created_at: string;
  updated_at: string;
}

const STATUS_STYLES: Record<string, { bg: string; text: string; icon?: typeof ShieldCheck }> = {
  draft: { bg: 'bg-gray-100', text: 'text-gray-700', icon: FileText },
  production: { bg: 'bg-green-100', text: 'text-green-700', icon: ShieldCheck },
  archived: { bg: 'bg-amber-100', text: 'text-amber-700', icon: Archive },
};

const SCENARIO_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  fm: { bg: 'bg-purple-100', text: 'text-purple-700', label: 'Fully Managed' },
  wp: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Work Profile' },
  dedicated: { bg: 'bg-orange-100', text: 'text-orange-700', label: 'Dedicated' },
};

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'production', label: 'Production' },
  { value: 'archived', label: 'Archived' },
];

export default function Policies() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const activeEnvironment = useContextStore((s) => s.activeEnvironment);
  const environmentId = activeEnvironment?.id;

  const [statusFilter, setStatusFilter] = useState('all');
  const [scenarioFilter, setScenarioFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Policy | null>(null);

  // Reset local state on environment switch
  useEffect(() => {
    setStatusFilter('all');
    setScenarioFilter('all');
    setSearchQuery('');
    setDeleteTarget(null);
  }, [environmentId]);

  const { data, isLoading } = useQuery({
    queryKey: ['policies', environmentId],
    queryFn: () =>
      apiClient.get<{ policies: Policy[] }>(`/api/policies/list?environment_id=${environmentId}`),
    enabled: !!environmentId,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete<{ message: string }>(`/api/policies/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policies', environmentId] });
      setDeleteTarget(null);
    },
  });
  const bulkMutation = useBulkPolicyAction();

  const policies = data?.policies ?? [];
  const filtered = useMemo(() => {
    let result = policies;
    if (statusFilter !== 'all') {
      result = result.filter((p) => p.status === statusFilter);
    }
    if (scenarioFilter !== 'all') {
      result = result.filter((p) => p.deployment_scenario === scenarioFilter);
    }
    if (searchQuery.trim()) {
      const lowerQ = searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(lowerQ) ||
          (p.description && p.description.toLowerCase().includes(lowerQ)),
      );
    }
    return result;
  }, [policies, statusFilter, scenarioFilter, searchQuery]);

  const bulkSelection = useBulkSelection<Policy>({
    rows: filtered,
    rowKey: (row) => row.id,
    totalMatching: filtered.length,
  });

  const columns: ColumnDef<Policy>[] = useMemo(
    () => [
      {
        key: 'name',
        label: 'Name',
        sortable: true,
        render: (_val, row) => (
          <div>
            <span className="font-medium text-gray-900">{row.name}</span>
            {row.description && (
              <p className="mt-0.5 text-xs text-gray-500 truncate max-w-xs">{row.description}</p>
            )}
          </div>
        ),
      },
      {
        key: 'deployment_scenario',
        label: 'Scenario',
        render: (_val, row) => {
          const style = SCENARIO_STYLES[row.deployment_scenario] ?? {
            bg: 'bg-gray-100',
            text: 'text-gray-700',
            label: row.deployment_scenario,
          };
          return (
            <span className={clsx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', style.bg, style.text)}>
              {style.label}
            </span>
          );
        },
      },
      {
        key: 'status',
        label: 'Status',
        render: (_val, row) => {
          const style = STATUS_STYLES[row.status] ?? { bg: 'bg-gray-100', text: 'text-gray-700' };
          const Icon = style.icon;
          return (
            <span className={clsx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium', style.bg, style.text)}>
              {Icon && <Icon className="h-3 w-3" />}
              {row.status.charAt(0).toUpperCase() + row.status.slice(1)}
            </span>
          );
        },
      },
      {
        key: 'version',
        label: 'Version',
        render: (_val, row) => (
          <span className="text-sm text-gray-600">v{row.version}</span>
        ),
      },
      {
        key: 'device_count',
        label: 'Devices',
        sortable: true,
        render: (_val, row) => (
          <span className="text-sm text-gray-600">{row.device_count ?? 0}</span>
        ),
      },
      {
        key: 'updated_at',
        label: 'Updated',
        sortable: true,
        render: (_val, row) => (
          <span className="text-sm text-gray-500">
            {new Date(row.updated_at).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </span>
        ),
      },
      {
        key: '_actions' as any,
        label: '',
        className: 'w-10',
        render: (_val, row) =>
          row.name === 'Default' ? null : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setDeleteTarget(row);
              }}
              className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
              title="Delete policy"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          ),
      },
    ],
    [],
  );

  const bulkActions: BulkAction[] = [
    { key: 'copy', label: 'Make Copy' },
    { key: 'delete', label: 'Delete', variant: 'danger' },
    { key: 'set_draft', label: 'Set Draft' },
    { key: 'set_production', label: 'Set Production' },
    { key: 'push_to_amapi', label: 'Push to AMAPI' },
  ];

  const runBulkAction = (action: 'copy' | 'delete' | 'set_draft' | 'set_production' | 'push_to_amapi') => {
    if (!environmentId) return;
    const destructive = action === 'delete';
    const confirmed = window.confirm(
      destructive
        ? `Delete ${bulkSelection.selectedCount} selected policies?`
        : `Apply "${action}" to ${bulkSelection.selectedCount} selected policies?`
    );
    if (!confirmed) return;
    bulkMutation.mutate({
      environment_id: environmentId,
      operation: action,
      selection: {
        ...bulkSelection.selectionPayload,
        filters: {
          status: statusFilter,
          scenario: scenarioFilter,
          search: searchQuery,
        },
      },
      options: action === 'copy' ? { copy_name_prefix: 'Copy of' } : undefined,
    }, {
      onSuccess: (data) => {
        const failures = data.results.filter((r) => !r.ok);
        if (failures.length > 0) {
          window.alert(`Bulk action completed with ${failures.length} failure(s).`);
        }
        bulkSelection.clearSelection();
      },
    });
  };

  // No environment selected
  if (!environmentId) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Policies</h1>
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <ShieldCheck className="mx-auto h-12 w-12 text-gray-300 mb-4" />
          <p className="text-gray-500">Select an environment to view policies.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Policies</h1>
        <button
          onClick={() => navigate('/policies/new')}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Create Policy
        </button>
      </div>

      {/* Search and filters */}
      <div className="space-y-3 mb-4">
        {/* Search input */}
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search policies by name..."
            className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
        </div>

        {/* Status filter pills */}
        <div className="flex flex-wrap items-center gap-2">
          <Filter className="h-4 w-4 text-gray-400 shrink-0" />
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className={clsx(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                statusFilter === f.value
                  ? 'bg-accent text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
              )}
            >
              {f.label}
              {f.value !== 'all' && (
                <span className="ml-1">
                  ({policies.filter((p) => p.status === f.value).length})
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Scenario filter */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500 font-medium shrink-0">Scenario:</span>
          {[{ value: 'all', label: 'All' }, ...Object.entries(SCENARIO_STYLES).map(([k, v]) => ({ value: k, label: v.label }))].map((f) => (
            <button
              key={f.value}
              onClick={() => setScenarioFilter(f.value)}
              className={clsx(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                scenarioFilter === f.value
                  ? 'bg-accent text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <DataTable<Policy>
        columns={columns}
        data={filtered}
        loading={isLoading}
        emptyMessage="No policies found. Create your first policy to get started."
        selectable
        selectedRows={bulkSelection.selectedRows}
        onSelectionChange={bulkSelection.onSelectionChange}
        rowKey={(row) => row.id}
        onRowClick={(row) => navigate(`/policies/${row.id}`)}
      />
      <div className="mt-3">
        <SelectAllMatchingNotice
          loadedCount={filtered.length}
          totalCount={filtered.length}
          allMatching={bulkSelection.allMatching}
          canSelectAllMatching={bulkSelection.canSelectAllMatching}
          onSelectAllMatching={bulkSelection.selectAllMatching}
        />
      </div>

      <BulkActionBar
        selectedCount={bulkSelection.selectedCount}
        actions={bulkActions}
        onAction={(key) => {
          const action = key as 'copy' | 'delete' | 'set_draft' | 'set_production' | 'push_to_amapi';
          runBulkAction(action);
        }}
        onClear={bulkSelection.clearSelection}
      />

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Delete Policy</h2>
            <p className="text-sm text-gray-600 mb-6">
              Are you sure you want to delete <strong>{deleteTarget.name}</strong>? This action cannot
              be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate(deleteTarget.id)}
                disabled={deleteMutation.isPending}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
