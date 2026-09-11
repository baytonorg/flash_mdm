import { useDeviceOperations, useCancelOperation } from '@/api/queries/device-operations';
import { Loader2, XCircle, CheckCircle2, Clock, AlertTriangle } from 'lucide-react';
import clsx from 'clsx';

interface DeviceOperationsProps {
  deviceId: string;
}

function formatOperationName(name?: string): string {
  if (!name) return 'Unknown';
  // Extract the operation ID from the full resource name
  const parts = name.split('/');
  return parts[parts.length - 1] ?? name;
}

function isCancelledOperation(op: { error?: { code: number; message: string } }): boolean {
  const code = op.error?.code;
  const message = (op.error?.message ?? '').toLowerCase();
  return code === 1 || message.includes('cancelled') || message.includes('canceled');
}

function getOperationStatus(op: {
  done?: boolean;
  error?: { code: number; message: string };
  ledgerStatus?: string;
}) {
  if (op.ledgerStatus === 'delivery_uncertain') return 'uncertain';
  if (op.ledgerStatus === 'reconciling') return 'reconciling';
  if (op.ledgerStatus === 'unresolved') return 'unresolved';
  if (isCancelledOperation(op)) return 'cancelled';
  if (op.error) return 'error';
  if (op.done) return 'done';
  return 'running';
}

export default function DeviceOperations({ deviceId }: DeviceOperationsProps) {
  const {
    data,
    isLoading,
    isError,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useDeviceOperations(deviceId);
  const cancelMutation = useCancelOperation();
  const operations = data?.operations ?? [];
  const cancellingOperation = cancelMutation.isPending ? cancelMutation.variables : null;

  const handleCancel = (operationName: string) => {
    if (!window.confirm('Cancel this device operation? It may already be completing.')) return;
    cancelMutation.reset();
    cancelMutation.mutate(operationName);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
        <p className="text-sm font-medium text-amber-800">Unable to load device operations</p>
        <p className="mt-1 text-xs text-amber-700">This does not affect device management. Try again shortly.</p>
      </div>
    );
  }

  if (data?.unavailable && operations.length === 0) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
        <p className="text-sm font-medium text-amber-800">Device operations temporarily unavailable</p>
        <p className="mt-1 text-xs text-amber-700">{data.message ?? 'Please try again shortly.'}</p>
      </div>
    );
  }

  if (!operations || operations.length === 0) {
    return (
      <div className="text-center py-12">
        <Clock className="h-8 w-8 text-gray-300 mx-auto mb-2" />
        <p className="text-sm text-muted">No operations found for this device.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-gray-900">Device Operations</h3>
        {hasNextPage && (
          <button
            type="button"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            {isFetchingNextPage && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isFetchingNextPage ? 'Loading...' : 'Load older operations'}
          </button>
        )}
      </div>
      {data?.unavailable && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-medium text-amber-800">Live AMAPI history is temporarily unavailable</p>
          <p className="mt-1 text-xs text-amber-700">Showing the persistent command ledger.</p>
        </div>
      )}
      <div className="divide-y divide-border rounded-lg border border-border bg-surface">
        {operations.map((op, idx) => {
          const status = getOperationStatus(op);
          const opId = formatOperationName(op.name);
          return (
            <div key={op.name ?? idx} className="px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  {status === 'done' && <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />}
                  {status === 'running' && <Loader2 className="h-4 w-4 animate-spin text-blue-500 shrink-0" />}
                  {status === 'cancelled' && <XCircle className="h-4 w-4 text-gray-500 shrink-0" />}
                  {status === 'error' && <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />}
                  {(status === 'uncertain' || status === 'reconciling' || status === 'unresolved') && (
                    <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                  )}
                  <span className="text-sm font-medium text-gray-900 truncate">{opId}</span>
                  <span
                    className={clsx(
                      'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                      status === 'done' && 'bg-green-100 text-green-700',
                      status === 'running' && 'bg-blue-100 text-blue-700',
                      status === 'cancelled' && 'bg-gray-100 text-gray-700',
                      status === 'error' && 'bg-red-100 text-red-700',
                      (status === 'uncertain' || status === 'reconciling' || status === 'unresolved') && 'bg-amber-100 text-amber-800',
                    )}
                  >
                    {status === 'done' && 'Completed'}
                    {status === 'running' && 'In Progress'}
                    {status === 'cancelled' && 'Cancelled'}
                    {status === 'error' && 'Error'}
                    {status === 'uncertain' && 'Delivery uncertain'}
                    {status === 'reconciling' && 'Reconciling'}
                    {status === 'unresolved' && 'Unresolved'}
                  </span>
                </div>
                {status === 'running' && op.name && !op.name.startsWith('ledger/') && (
                  <button
                    type="button"
                    onClick={() => handleCancel(op.name!)}
                    disabled={cancelMutation.isPending}
                    className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    {cancellingOperation === op.name ? 'Cancelling...' : 'Cancel'}
                  </button>
                )}
              </div>
              {op.error && (
                status === 'cancelled' ? (
                  <p className="mt-1 text-xs text-gray-600">
                    {op.error.message?.trim() || 'Operation was cancelled before completion.'}
                  </p>
                ) : status === 'uncertain' || status === 'reconciling' || status === 'unresolved' ? (
                  <p className="mt-1 text-xs text-amber-700">{op.error.message}</p>
                ) : (
                  <p className="mt-1 text-xs text-red-600">
                    {op.error.message?.trim()
                      ? `Error ${op.error.code}: ${op.error.message}`
                      : `Operation failed (code ${op.error.code}).`}
                  </p>
                )
              )}
              {op.reconciliation && op.reconciliation.pagesScanned > 0 && (
                <p className="mt-1 text-xs text-amber-700">
                  Read-only reconciliation scanned {op.reconciliation.pagesScanned.toLocaleString()} AMAPI page{op.reconciliation.pagesScanned === 1 ? '' : 's'}; the command was never replayed.
                </p>
              )}
              {cancelMutation.isError && cancelMutation.variables === op.name && (
                <p role="alert" className="mt-1 text-xs text-red-600">
                  {cancelMutation.error instanceof Error
                    ? cancelMutation.error.message
                    : 'Failed to cancel operation.'}
                </p>
              )}
              {op.metadata && Object.keys(op.metadata).length > 0 && (
                <div className="mt-1.5 text-xs text-muted">
                  {typeof op.metadata.type === 'string' && <span>Type: {op.metadata.type}</span>}
                  {typeof op.metadata.createTime === 'string' && (
                    <span className="ml-3">
                      Created: {new Date(op.metadata.createTime).toLocaleString()}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
