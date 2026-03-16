import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  enrollmentKeys,
  useBulkEnrollmentAction,
  useDeleteEnrollmentToken,
  useEnrollmentTokens,
  useSyncEnrollmentTokens,
  type EnrollmentToken,
} from '@/api/queries/enrollment';
import { useContextStore } from '@/stores/context';
import BulkActionBar, { type BulkAction } from '@/components/common/BulkActionBar';
import ConfirmModal from '@/components/common/ConfirmModal';
import SelectAllMatchingNotice from '@/components/common/SelectAllMatchingNotice';
import TableLoadingState from '@/components/common/TableLoadingState';
import TokenCreator from '@/components/enrollment/TokenCreator';
import EnrollmentQrPreview from '@/components/enrollment/EnrollmentQrPreview';
import { Plus, Trash2, Key, Clock, Loader2, X, Copy, Check, RefreshCw } from 'lucide-react';
import { useBulkSelection } from '@/hooks/useBulkSelection';

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'N/A';
  return new Date(dateStr).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isExpired(dateStr: string | null): boolean {
  if (!dateStr) return false;
  return new Date(dateStr) < new Date();
}

export default function EnrollmentTokens() {
  const { activeEnvironment } = useContextStore();
  const queryClient = useQueryClient();
  const environmentId = activeEnvironment?.id;

  const [creatorOpen, setCreatorOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<EnrollmentToken | null>(null);
  const [selectedToken, setSelectedToken] = useState<EnrollmentToken | null>(null);
  const [copiedField, setCopiedField] = useState<'token' | 'qr' | null>(null);
  const detailOverlayRef = useRef<HTMLDivElement>(null);
  const syncResultTimeoutRef = useRef<number | null>(null);
  const copiedFieldTimeoutRef = useRef<number | null>(null);

  // Reset local state on environment switch
  useEffect(() => {
    setSelectedToken(null);
    setDeleteTarget(null);
    setCreatorOpen(false);
  }, [environmentId]);

  useEffect(() => {
    return () => {
      if (syncResultTimeoutRef.current !== null) {
        window.clearTimeout(syncResultTimeoutRef.current);
      }
      if (copiedFieldTimeoutRef.current !== null) {
        window.clearTimeout(copiedFieldTimeoutRef.current);
      }
    };
  }, []);

  const { data: tokens = [], isLoading } = useEnrollmentTokens(environmentId ?? '');
  const deleteMutation = useDeleteEnrollmentToken();
  const bulkEnrollmentAction = useBulkEnrollmentAction();
  const bulkSelection = useBulkSelection<EnrollmentToken>({
    rows: tokens,
    rowKey: (row) => row.id,
    totalMatching: tokens.length,
  });
  const selectedTokenIdSet = new Set(bulkSelection.selectedRows.map((row) => row.id));
  const allLoadedSelected = tokens.length > 0 && tokens.every((row) => selectedTokenIdSet.has(row.id));

  const [syncResult, setSyncResult] = useState<string | null>(null);

  const syncMutation = useSyncEnrollmentTokens();
  const bulkActions: BulkAction[] = [
    { key: 'delete', label: 'Delete', variant: 'danger' },
  ];

  const handleTokenCreated = () => {
    queryClient.invalidateQueries({ queryKey: enrollmentKeys.all });
  };

  const handleCopy = async (value: string, field: 'token' | 'qr') => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      if (copiedFieldTimeoutRef.current !== null) {
        window.clearTimeout(copiedFieldTimeoutRef.current);
      }
      copiedFieldTimeoutRef.current = window.setTimeout(() => {
        setCopiedField((current) => (current === field ? null : current));
        copiedFieldTimeoutRef.current = null;
      }, 1500);
    } catch {
      // Ignore clipboard failures in unsupported contexts
    }
  };

  const handleSync = () => {
    if (!environmentId) return;
    syncMutation.mutate(environmentId, {
      onSuccess: (data) => {
        setSyncResult(`Imported ${data.imported} token${data.imported !== 1 ? 's' : ''}, invalidated ${data.invalidated} stale token${data.invalidated !== 1 ? 's' : ''}.`);
        if (syncResultTimeoutRef.current !== null) {
          window.clearTimeout(syncResultTimeoutRef.current);
        }
        syncResultTimeoutRef.current = window.setTimeout(() => {
          setSyncResult(null);
          syncResultTimeoutRef.current = null;
        }, 5000);
      },
    });
  };

  useEffect(() => {
    if (!selectedToken) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedToken(null);
        setCopiedField(null);
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [selectedToken]);

  if (!environmentId) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Enrolment Tokens</h1>
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex flex-col items-center gap-2 py-8">
            <Key className="h-10 w-10 text-gray-300" />
            <p className="text-gray-500">Select an environment to manage enrolment tokens.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Enrolment Tokens</h1>
          <p className="text-sm text-muted mt-1">
            {tokens.length} token{tokens.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={handleSync}
            disabled={syncMutation.isPending}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50 sm:w-auto"
          >
            <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
            {syncMutation.isPending ? 'Syncing...' : 'Sync from AMAPI'}
          </button>
          <button
            type="button"
            onClick={() => setCreatorOpen(true)}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-light transition-colors sm:w-auto"
          >
            <Plus className="h-4 w-4" />
            Create Token
          </button>
        </div>
      </div>

      {/* Sync result toast */}
      {syncResult && (
        <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3">
          <p className="text-sm font-medium text-green-800">{syncResult}</p>
        </div>
      )}
      {syncMutation.isError && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
          <p className="text-sm text-red-800">
            {(syncMutation.error as Error)?.message || 'Failed to sync tokens.'}
          </p>
        </div>
      )}

      {/* Token table */}
      {isLoading ? (
        <TableLoadingState columnCount={6} />
      ) : tokens.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface px-4 py-12 text-center">
          <Key className="mx-auto h-10 w-10 text-gray-300 mb-3" />
          <p className="text-sm font-medium text-gray-900">No enrolment tokens</p>
          <p className="text-sm text-muted mt-1">
            Create an enrolment token to start enrolling devices.
          </p>
          <button
            type="button"
            onClick={() => setCreatorOpen(true)}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-light transition-colors"
          >
            <Plus className="h-4 w-4" />
            Create Token
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-secondary">
                <th className="w-10 px-3 py-3">
                  <input
                    type="checkbox"
                    checked={allLoadedSelected}
                    onChange={(e) => bulkSelection.onSelectionChange(e.target.checked ? tokens : [])}
                    aria-label="Select all tokens"
                    className="h-4 w-4 rounded border-gray-300 text-accent focus:ring-accent/20"
                  />
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted">
                  Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted">
                  Group
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted">
                  One-Time Use
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted">
                  Expires
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted">
                  Created
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((token) => {
                const expired = isExpired(token.expiry ?? null);
                return (
                  <tr
                    key={token.id}
                    className="cursor-pointer border-b border-border last:border-b-0 hover:bg-surface-secondary transition-colors"
                    onClick={() => {
                      setSelectedToken(token);
                      setCopiedField(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedToken(token);
                        setCopiedField(null);
                      }
                    }}
                    tabIndex={0}
                    role="button"
                    aria-label={`Open enrolment token ${token.name || 'Unnamed Token'}`}
                  >
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedTokenIdSet.has(token.id)}
                        onChange={() => {
                          if (selectedTokenIdSet.has(token.id)) {
                            bulkSelection.onSelectionChange(bulkSelection.selectedRows.filter((row) => row.id !== token.id));
                          } else {
                            bulkSelection.onSelectionChange([...bulkSelection.selectedRows, token]);
                          }
                        }}
                        aria-label={`Select token ${token.name || token.id}`}
                        className="h-4 w-4 rounded border-gray-300 text-accent focus:ring-accent/20"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div>
                        <span className="font-medium text-gray-900">
                          {token.name || 'Unnamed Token'}
                        </span>
                        {token.qr_data && (
                          <span className="ml-2 inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                            QR
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {token.group_name || <span className="text-muted">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {token.one_time_use ? (
                        <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                          Yes
                        </span>
                      ) : (
                        <span className="text-muted">No</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {expired && <Clock className="h-3.5 w-3.5 text-red-500" />}
                        <span className={expired ? 'text-red-600 font-medium' : 'text-gray-700'}>
                          {token.expiry ? formatDate(token.expiry) : 'Never'}
                        </span>
                        {expired && (
                          <span className="text-xs text-red-500 font-medium">Expired</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {formatDate(token.created_at)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTarget(token);
                        }}
                        className="inline-flex items-center gap-1 rounded-lg p-1.5 text-muted hover:bg-red-50 hover:text-red-600 transition-colors"
                        title="Delete token"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div>
        <SelectAllMatchingNotice
          loadedCount={tokens.length}
          totalCount={tokens.length}
          allMatching={bulkSelection.allMatching}
          canSelectAllMatching={bulkSelection.canSelectAllMatching}
          onSelectAllMatching={bulkSelection.selectAllMatching}
        />
      </div>

      <BulkActionBar
        selectedCount={bulkSelection.selectedCount}
        actions={bulkActions}
        onAction={() => {
          if (!environmentId) return;
          if (!window.confirm(`Delete ${bulkSelection.selectedCount} selected token(s)?`)) return;
          bulkEnrollmentAction.mutate({
            environment_id: environmentId,
            operation: 'delete',
            selection: bulkSelection.selectionPayload,
          }, {
            onSuccess: (data) => {
              if (data.failed > 0) {
                window.alert(`Bulk delete completed with ${data.failed} failure(s).`);
              }
              bulkSelection.clearSelection();
            },
          });
        }}
        onClear={bulkSelection.clearSelection}
      />

      {/* Token creator modal */}
      <TokenCreator
        open={creatorOpen}
        onClose={() => setCreatorOpen(false)}
        onCreated={handleTokenCreated}
      />

      {/* Token detail / QR viewer */}
      {selectedToken && (
        <div
          ref={detailOverlayRef}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => {
            if (e.target === detailOverlayRef.current) {
              setSelectedToken(null);
              setCopiedField(null);
            }
          }}
        >
          <div className="w-full max-w-2xl rounded-xl border border-border bg-surface shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <div>
                <h2 className="text-base font-semibold text-gray-900">
                  {selectedToken.name || 'Unnamed Token'}
                </h2>
                <p className="mt-1 text-xs text-muted">
                  Created {formatDate(selectedToken.created_at)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedToken(null);
                  setCopiedField(null);
                }}
                className="rounded-lg p-2 text-muted hover:bg-surface-secondary hover:text-gray-700"
                aria-label="Close token viewer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-6 px-6 py-5 md:grid-cols-[280px,1fr]">
              <div className="space-y-3">
                <div className="rounded-lg border border-border bg-surface-secondary p-3 flex justify-center">
                  {selectedToken.qr_data ? (
                    <EnrollmentQrPreview value={selectedToken.qr_data} size={256} />
                  ) : (
                    <div className="flex h-64 w-64 items-center justify-center rounded-lg border border-dashed border-border bg-white text-sm text-muted text-center px-4">
                      This token has no QR payload.
                    </div>
                  )}
                </div>
                <div className="text-xs text-muted">
                  Scan in Android device setup, or copy the token/QR payload below.
                </div>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-lg border border-border bg-surface-secondary px-3 py-2">
                    <div className="text-xs text-muted">One-time use</div>
                    <div className="font-medium text-gray-900">{selectedToken.one_time_use ? 'Yes' : 'No'}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-surface-secondary px-3 py-2">
                    <div className="text-xs text-muted">Expires</div>
                    <div className={isExpired(selectedToken.expiry ?? null) ? 'font-medium text-red-600' : 'font-medium text-gray-900'}>
                      {selectedToken.expiry ? formatDate(selectedToken.expiry) : 'Never'}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border bg-surface-secondary px-3 py-2">
                    <div className="text-xs text-muted">Group</div>
                    <div className="font-medium text-gray-900">{selectedToken.group_name || 'None'}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-surface-secondary px-3 py-2">
                    <div className="text-xs text-muted">Policy</div>
                    <div className="font-medium text-gray-900">{selectedToken.policy_name || 'None'}</div>
                  </div>
                </div>

                {selectedToken.token_value && (
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <label className="text-sm font-medium text-gray-700">Token Value</label>
                      <button
                        type="button"
                        onClick={() => void handleCopy(selectedToken.token_value!, 'token')}
                        className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      >
                        {copiedField === 'token' ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                        {copiedField === 'token' ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <div className="rounded-lg border border-border bg-surface-secondary px-3 py-2 font-mono text-xs break-all max-h-32 overflow-y-auto">
                      {selectedToken.token_value}
                    </div>
                  </div>
                )}

                {selectedToken.qr_data && (
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <label className="text-sm font-medium text-gray-700">QR Payload</label>
                      <button
                        type="button"
                        onClick={() => void handleCopy(selectedToken.qr_data!, 'qr')}
                        className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      >
                        {copiedField === 'qr' ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                        {copiedField === 'qr' ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <div className="rounded-lg border border-border bg-surface-secondary px-3 py-2 font-mono text-xs break-all max-h-40 overflow-y-auto">
                      {selectedToken.qr_data}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) {
            deleteMutation.mutate(deleteTarget.id, {
              onSuccess: () => setDeleteTarget(null),
            });
          }
        }}
        title="Delete Enrolment Token"
        message={`Are you sure you want to delete the token "${deleteTarget?.name || 'Unnamed Token'}"? Devices enrolled with this token will not be affected, but no new enrolments will be possible.`}
        confirmLabel="Delete"
        variant="danger"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
