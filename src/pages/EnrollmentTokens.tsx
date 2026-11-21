import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
import { useAuthStore } from '@/stores/auth';
import BulkActionBar, { type BulkAction } from '@/components/common/BulkActionBar';
import ConfirmModal from '@/components/common/ConfirmModal';
import SelectAllMatchingNotice from '@/components/common/SelectAllMatchingNotice';
import TableLoadingState from '@/components/common/TableLoadingState';
import QueryErrorState from '@/components/common/QueryErrorState';
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

function getTokenExpiry(token: EnrollmentToken): string | null {
  return token.expires_at ?? token.expiry ?? null;
}

export default function EnrollmentTokens() {
  const { user } = useAuthStore();
  const { activeWorkspace, activeEnvironment } = useContextStore();
  const readContext = JSON.stringify([
    user?.id, user?.is_superadmin, user?.impersonation?.active,
    user?.impersonation?.mode, user?.impersonation?.by_user_id,
    activeWorkspace?.id, activeWorkspace?.user_role, activeWorkspace?.access_scope,
    (activeWorkspace?.settings as { rbac?: unknown } | undefined)?.rbac,
    activeEnvironment?.id, activeEnvironment?.user_role,
  ]);
  return <EnrollmentTokensContent key={readContext} readContext={readContext} />;
}

function EnrollmentTokensContent({ readContext }: { readContext: string }) {
  const { activeEnvironment } = useContextStore();
  const queryClient = useQueryClient();
  const environmentId = activeEnvironment?.id;
  const isEnterpriseBound = Boolean(activeEnvironment?.enterprise_name);

  const [creatorOpen, setCreatorOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<EnrollmentToken | null>(null);
  const [selection, setSelection] = useState<{ id: string; epoch: number } | null>(null);
  const selectionEpoch = useRef(0);
  const [copyResult, setCopyResult] = useState<{ key: string; field: 'token' | 'qr'; status: 'pending' | 'copied' | 'failed' } | null>(null);
  const currentSelection = useRef<string | null>(null);
  const copying = useRef<string | null>(null);
  const detailOverlayRef = useRef<HTMLDivElement>(null);
  const detailDialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const syncResultTimeoutRef = useRef<number | null>(null);
  const copiedFieldTimeoutRef = useRef<number | null>(null);

  // Reset local state on environment switch
  useEffect(() => {
    setSelection(null);
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

  const tokensQuery = useEnrollmentTokens(environmentId ?? '', readContext);
  const tokens = tokensQuery.data ?? [];
  const { isLoading, isError, error, refetch, isFetching } = tokensQuery;
  const handoffReady = tokensQuery.isSuccess && tokensQuery.fetchStatus === 'idle';
  const selectedToken = handoffReady && selection
    ? tokens.find(token => token.id === selection.id && token.environment_id === environmentId) ?? null
    : null;
  // The canonical API field is value. Only genuinely older row shapes fall back.
  const tokenValue = selectedToken?.value ?? selectedToken?.token_value ?? '';
  const selectionKey = selectedToken && selection
    ? JSON.stringify([selection.epoch, selectedToken.id, tokenValue, selectedToken.qr_data]) : null;
  useLayoutEffect(() => {
    currentSelection.current = selectionKey;
    return () => { currentSelection.current = null; };
  }, [selectionKey]);
  const currentCopy = copyResult?.key === selectionKey ? copyResult : null;
  const copiedField = currentCopy?.status === 'copied' ? currentCopy.field : null;
  const closeViewer = () => { currentSelection.current = null; setSelection(null); setCopyResult(null); };
  const openViewer = (token: EnrollmentToken) => {
    if (!handoffReady || token.environment_id !== environmentId) return;
    setSelection({ id: token.id, epoch: ++selectionEpoch.current });
    setCopyResult(null);
  };
  useEffect(() => {
    if (selection && !selectedToken) setSelection(null);
  }, [selection, selectedToken]);
  useEffect(() => () => { currentSelection.current = null; }, []);
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
    const key = currentSelection.current;
    if (!key || !value || copying.current === key) return;
    copying.current = key;
    if (copiedFieldTimeoutRef.current !== null) {
      window.clearTimeout(copiedFieldTimeoutRef.current);
      copiedFieldTimeoutRef.current = null;
    }
    setCopyResult({ key, field, status: 'pending' });
    try {
      await navigator.clipboard.writeText(value);
      if (currentSelection.current !== key) return;
      setCopyResult({ key, field, status: 'copied' });
      if (copiedFieldTimeoutRef.current !== null) {
        window.clearTimeout(copiedFieldTimeoutRef.current);
      }
      copiedFieldTimeoutRef.current = window.setTimeout(() => {
        setCopyResult((current) => (current?.key === key ? null : current));
        copiedFieldTimeoutRef.current = null;
      }, 1500);
    } catch {
      if (currentSelection.current === key) setCopyResult({ key, field, status: 'failed' });
    } finally {
      if (copying.current === key) copying.current = null;
    }
  };

  const handleSync = () => {
    if (!environmentId || !isEnterpriseBound) return;
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
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeViewer();
      }
      if (e.key !== 'Tab' || !detailDialogRef.current) return;
      const controls = detailDialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first) { e.preventDefault(); detailDialogRef.current.focus(); }
      else if (!detailDialogRef.current.contains(document.activeElement)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
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

  if (isError && !tokensQuery.data) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">Enrolment Tokens</h1>
        <QueryErrorState
          title="Unable to load enrolment tokens"
          error={error}
          onRetry={() => void refetch()}
          retrying={isFetching}
        />
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
            disabled={!isEnterpriseBound || syncMutation.isPending}
            title={!isEnterpriseBound ? 'Bind this environment to an enterprise before syncing tokens.' : undefined}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50 sm:w-auto"
          >
            <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
            {syncMutation.isPending ? 'Syncing...' : 'Sync from AMAPI'}
          </button>
          <button
            type="button"
            onClick={() => setCreatorOpen(true)}
            disabled={!isEnterpriseBound}
            title={!isEnterpriseBound ? 'Bind this environment to an enterprise before creating tokens.' : undefined}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-light transition-colors disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            <Plus className="h-4 w-4" />
            Create Token
          </button>
        </div>
      </div>

      {!isEnterpriseBound && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3" role="status">
          <p className="text-sm font-medium text-amber-900">Bind this environment before managing enrolment tokens.</p>
          <p className="mt-1 text-sm text-amber-800">
            Complete Android Enterprise binding in Settings, then return here to create or sync tokens.
          </p>
        </div>
      )}

      {isError && (
        <QueryErrorState
          compact
          title="Enrolment token data may be out of date"
          error={error}
          onRetry={() => void refetch()}
          retrying={isFetching}
        />
      )}

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
            disabled={!isEnterpriseBound}
            title={!isEnterpriseBound ? 'Bind this environment to an enterprise before creating tokens.' : undefined}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-light transition-colors disabled:cursor-not-allowed disabled:opacity-50"
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
                const expiry = getTokenExpiry(token);
                const expired = isExpired(expiry);
                return (
                  <tr
                    key={token.id}
                    className="cursor-pointer border-b border-border last:border-b-0 hover:bg-surface-secondary transition-colors"
                    onClick={() => {
                      openViewer(token);
                    }}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openViewer(token);
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
                          {expiry ? formatDate(expiry) : 'Never'}
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
                          deleteMutation.reset();
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
              closeViewer();
            }
          }}
        >
          <div ref={detailDialogRef} role="dialog" tabIndex={-1} aria-modal="true" aria-label="Enrolment token details" className="w-full max-w-2xl rounded-xl border border-border bg-surface shadow-xl max-h-[90vh] overflow-y-auto">
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
                ref={closeButtonRef}
                type="button"
                onClick={() => {
                  closeViewer();
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
                    <div className={isExpired(getTokenExpiry(selectedToken)) ? 'font-medium text-red-600' : 'font-medium text-gray-900'}>
                      {getTokenExpiry(selectedToken) ? formatDate(getTokenExpiry(selectedToken)) : 'Never'}
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

                {tokenValue && (
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <label className="text-sm font-medium text-gray-700">Token Value</label>
                      <button
                        type="button"
                        onClick={() => void handleCopy(tokenValue, 'token')}
                        disabled={currentCopy?.status === 'pending'}
                        aria-label="Copy token value"
                        className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      >
                        {copiedField === 'token' ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                        {copiedField === 'token' ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <div className="rounded-lg border border-border bg-surface-secondary px-3 py-2 font-mono text-xs break-all max-h-32 overflow-y-auto">
                      {tokenValue}
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
                        disabled={currentCopy?.status === 'pending'}
                        aria-label="Copy QR payload"
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
                {currentCopy?.status === 'failed' && (
                  <p role="alert" className="text-sm text-red-600">Unable to copy. Select and copy the value manually.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => {
          deleteMutation.reset();
          setDeleteTarget(null);
        }}
        onConfirm={() => {
          if (deleteTarget) {
            deleteMutation.reset();
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
        error={deleteMutation.isError
          ? (deleteMutation.error instanceof Error ? deleteMutation.error.message : 'Failed to delete enrolment token.')
          : undefined}
      />
    </div>
  );
}
