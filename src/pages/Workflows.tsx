import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { Plus, Trash2, Zap, Filter } from 'lucide-react';
import clsx from 'clsx';
import { useContextStore } from '@/stores/context';
import { useWorkflows, useDeleteWorkflow, useToggleWorkflow, useBulkWorkflowAction } from '@/api/queries/workflows';
import type { Workflow } from '@/api/queries/workflows';
import DataTable, { type ColumnDef } from '@/components/common/DataTable';
import { TRIGGER_OPTIONS } from '@/components/workflows/TriggerSelector';
import { ACTION_OPTIONS } from '@/components/workflows/ActionSelector';
import BulkActionBar, { type BulkAction } from '@/components/common/BulkActionBar';
import SelectAllMatchingNotice from '@/components/common/SelectAllMatchingNotice';
import { useBulkSelection } from '@/hooks/useBulkSelection';

// ─── Helpers ────────────────────────────────────────────────────────────────

function getTriggerLabel(triggerType: string) {
  return TRIGGER_OPTIONS.find((t) => t.value === triggerType);
}

function getActionLabel(actionType: string) {
  return ACTION_OPTIONS.find((a) => a.value === actionType);
}

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'enabled', label: 'Enabled' },
  { value: 'disabled', label: 'Disabled' },
];

// ─── Component ──────────────────────────────────────────────────────────────

export default function Workflows() {
  const navigate = useNavigate();
  const activeEnvironment = useContextStore((s) => s.activeEnvironment);
  const environmentId = activeEnvironment?.id ?? '';

  const [statusFilter, setStatusFilter] = useState('all');
  const [deleteTarget, setDeleteTarget] = useState<Workflow | null>(null);

  // Reset local state on environment switch
  useEffect(() => { setStatusFilter('all'); setDeleteTarget(null); }, [environmentId]);

  const { data: workflows = [], isLoading, isError, error } = useWorkflows(environmentId);
  const deleteMutation = useDeleteWorkflow();
  const toggleMutation = useToggleWorkflow();
  const bulkMutation = useBulkWorkflowAction();

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return workflows;
    if (statusFilter === 'enabled') return workflows.filter((w) => w.enabled);
    return workflows.filter((w) => !w.enabled);
  }, [workflows, statusFilter]);

  const bulkSelection = useBulkSelection<Workflow>({
    rows: filtered,
    rowKey: (row) => row.id,
    totalMatching: filtered.length,
  });

  const columns: ColumnDef<Workflow>[] = useMemo(
    () => [
      {
        key: 'name',
        label: 'Name',
        sortable: true,
        render: (_val, row) => (
          <div>
            <span className="font-medium text-gray-900">{row.name}</span>
          </div>
        ),
      },
      {
        key: 'trigger_type',
        label: 'Trigger',
        render: (_val, row) => {
          const trigger = getTriggerLabel(row.trigger_type);
          if (!trigger) return <span className="text-xs text-gray-500">{row.trigger_type}</span>;
          const Icon = trigger.icon;
          return (
            <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium', trigger.bg, trigger.color)}>
              <Icon className="h-3 w-3" />
              {trigger.label}
            </span>
          );
        },
      },
      {
        key: 'action_type',
        label: 'Action',
        render: (_val, row) => {
          const action = getActionLabel(row.action_type);
          if (!action) return <span className="text-xs text-gray-500">{row.action_type}</span>;
          const Icon = action.icon;
          return (
            <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium', action.bg, action.color)}>
              <Icon className="h-3 w-3" />
              {action.label}
            </span>
          );
        },
      },
      {
        key: 'enabled',
        label: 'Enabled',
        render: (_val, row) => (
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleMutation.mutate(row.id);
            }}
            className={clsx(
              'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
              row.enabled ? 'bg-accent' : 'bg-gray-300'
            )}
            title={row.enabled ? 'Click to disable' : 'Click to enable'}
          >
            <span
              className={clsx(
                'inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform',
                row.enabled ? 'translate-x-4.5' : 'translate-x-1'
              )}
            />
          </button>
        ),
      },
      {
        key: 'last_triggered_at',
        label: 'Last Run',
        sortable: true,
        render: (_val, row) =>
          row.last_triggered_at ? (
            <span className="text-sm text-gray-500">
              {new Date(row.last_triggered_at).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          ) : (
            <span className="text-xs text-gray-400">Never</span>
          ),
      },
      {
        key: 'execution_count',
        label: 'Executions',
        render: (_val, row) => (
          <span className="text-sm text-gray-600">
            {Number(row.execution_count ?? 0).toLocaleString()}
          </span>
        ),
      },
      {
        key: '_actions' as keyof Workflow & string,
        label: '',
        className: 'w-10',
        render: (_val, row) => (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setDeleteTarget(row);
            }}
            className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
            title="Delete workflow"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        ),
      },
    ],
    [toggleMutation],
  );

  const bulkActions: BulkAction[] = [
    { key: 'enable', label: 'Enable' },
    { key: 'disable', label: 'Disable' },
    { key: 'delete', label: 'Delete', variant: 'danger' },
  ];

  // No environment selected
  if (!environmentId) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Workflows</h1>
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Zap className="mx-auto h-12 w-12 text-gray-300 mb-4" />
          <p className="text-gray-500">Select an environment to view workflows.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Workflows</h1>
        <button
          onClick={() => navigate('/workflows/new')}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Create Workflow
        </button>
      </div>

      {/* Status filter */}
      <div className="flex items-center gap-2 mb-4">
        <Filter className="h-4 w-4 text-gray-400" />
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
                ({workflows.filter((w) => (f.value === 'enabled' ? w.enabled : !w.enabled)).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Error banner */}
      {isError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error instanceof Error ? error.message : 'Failed to load workflows.'}
        </div>
      )}

      {/* Table */}
      <DataTable<Workflow>
        columns={columns}
        data={filtered}
        loading={isLoading}
        emptyMessage="No workflows found. Create your first workflow to automate device management."
        selectable
        selectedRows={bulkSelection.selectedRows}
        onSelectionChange={bulkSelection.onSelectionChange}
        rowKey={(row) => row.id}
        onRowClick={(row) => navigate(`/workflows/${row.id}`)}
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
          const op = key as 'enable' | 'disable' | 'delete';
          const confirmed = window.confirm(`Apply "${op}" to ${bulkSelection.selectedCount} workflow(s)?`);
          if (!confirmed || !environmentId) return;
          bulkMutation.mutate({
            environment_id: environmentId,
            operation: op,
            selection: bulkSelection.selectionPayload,
          }, {
            onSuccess: (data) => {
              if (data.failed > 0) {
                window.alert(`Bulk action finished with ${data.failed} failure(s).`);
              }
              bulkSelection.clearSelection();
            },
          });
        }}
        onClear={bulkSelection.clearSelection}
      />

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Delete Workflow</h2>
            <p className="text-sm text-gray-600 mb-6">
              Are you sure you want to delete <strong>{deleteTarget.name}</strong>? All execution
              history will also be removed. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  deleteMutation.mutate(deleteTarget.id, {
                    onSuccess: () => setDeleteTarget(null),
                  });
                }}
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
