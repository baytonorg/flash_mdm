import { useState, useMemo, useEffect, useRef } from 'react';
import { useContextStore } from '@/stores/context';
import { useGroups, useCreateGroup, useUpdateGroup, useDeleteGroup, useBulkGroupAction, type Group } from '@/api/queries/groups';
import { usePolicyAssignments } from '@/api/queries/policies';
import DataTable, { type ColumnDef } from '@/components/common/DataTable';
import BulkActionBar, { type BulkAction } from '@/components/common/BulkActionBar';
import SelectAllMatchingNotice from '@/components/common/SelectAllMatchingNotice';
import ConfirmModal from '@/components/common/ConfirmModal';
import PolicyAssignmentSelect from '@/components/policy/PolicyAssignmentSelect';
import PolicyOverrideEditor from '@/components/policy/PolicyOverrideEditor';
import { Plus, Pencil, Trash2, X, FolderTree, Shield, Lock } from 'lucide-react';
import { useBulkSelection } from '@/hooks/useBulkSelection';

function getApiErrorStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  if (!('status' in error)) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : null;
}

function getApiErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return 'Bulk action failed. Please try again.';
}

function getBulkWarningMessage(error: unknown): string {
  const status = getApiErrorStatus(error);
  if (status === 403) {
    const message = getApiErrorMessage(error);
    if (message && message !== 'Forbidden' && message !== 'Forbidden.') {
      return message;
    }
    return 'Permission denied: you do not have access to modify one or more selected groups.';
  }
  return getApiErrorMessage(error);
}

// ---- Modal component for Create / Edit ----

interface GroupModalProps {
  open: boolean;
  onClose: () => void;
  groups: Group[];
  editingGroup?: Group | null;
  environmentId: string;
}

function GroupModal({ open, onClose, groups, editingGroup, environmentId }: GroupModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [parentId, setParentId] = useState<string>('');
  const overlayRef = useRef<HTMLDivElement>(null);

  const createGroup = useCreateGroup();
  const updateGroup = useUpdateGroup();

  const isEditing = !!editingGroup;
  const isPending = createGroup.isPending || updateGroup.isPending;
  const originalParentId = editingGroup
    ? (editingGroup.parent_id ?? editingGroup.parent_group_id ?? '')
    : '';
  const parentChanged = isEditing && parentId !== originalParentId;

  const descendantCount = useMemo(() => {
    if (!editingGroup) return 0;
    const childrenByParent = new Map<string | null, Group[]>();
    for (const group of groups) {
      const key = (group.parent_id ?? group.parent_group_id ?? null) as string | null;
      if (!childrenByParent.has(key)) childrenByParent.set(key, []);
      childrenByParent.get(key)!.push(group);
    }

    let count = 0;
    const stack = [...(childrenByParent.get(editingGroup.id) ?? [])];
    while (stack.length > 0) {
      const next = stack.pop()!;
      count += 1;
      stack.push(...(childrenByParent.get(next.id) ?? []));
    }
    return count;
  }, [editingGroup, groups]);

  useEffect(() => {
    if (open && editingGroup) {
      setName(editingGroup.name ?? '');
      setDescription((editingGroup.description as string) ?? '');
      setParentId(editingGroup.parent_id ?? '');
    } else if (open) {
      setName('');
      setDescription('');
      setParentId('');
    }
  }, [open, editingGroup]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    try {
      if (isEditing && editingGroup) {
        await updateGroup.mutateAsync({
          id: editingGroup.id,
          name: name.trim(),
          description: description.trim() || undefined,
          parent_id: parentId || null,
        });
      } else {
        await createGroup.mutateAsync({
          environment_id: environmentId,
          name: name.trim(),
          description: description.trim() || undefined,
          parent_id: parentId || undefined,
        });
      }
      onClose();
    } catch {
      // error handled by mutation
    }
  };

  // Build indented parent options
  const parentOptions = groups
    .filter((g) => !isEditing || g.id !== editingGroup?.id)
    .map((g) => ({
      id: g.id,
      label: `${'— '.repeat(g.depth ?? 0)}${g.name}`,
    }));

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className="w-full max-w-lg rounded-xl border border-border bg-surface p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">
            {isEditing ? 'Edit Group' : 'Create Group'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              placeholder="Group name"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              placeholder="Optional description"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Parent Group</label>
            <select
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            >
              <option value="">None (top-level)</option>
              {parentOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
            {isEditing && parentChanged && descendantCount > 0 && (
              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                This move will reparent the entire subtree ({descendantCount}{' '}
                {descendantCount === 1 ? 'child group' : 'child groups'}).
              </div>
            )}
          </div>

          {(createGroup.isError || updateGroup.isError) && (
            <p className="text-sm text-danger">
              {(createGroup.error ?? updateGroup.error)?.message ?? 'An error occurred'}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending || !name.trim()}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-light transition-colors disabled:opacity-50"
            >
              {isPending ? 'Saving...' : isEditing ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---- Main Groups page ----

export default function Groups() {
  const { activeEnvironment } = useContextStore();
  const environmentId = activeEnvironment?.id ?? '';

  const { data: groups = [], isLoading } = useGroups(environmentId);
  const deleteGroup = useDeleteGroup();
  const bulkGroupAction = useBulkGroupAction();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Group | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [bulkMoveParentId, setBulkMoveParentId] = useState('');
  const [bulkClearAssignments, setBulkClearAssignments] = useState(false);
  const [bulkWarning, setBulkWarning] = useState<string | null>(null);

  // Reset local state on environment switch
  useEffect(() => {
    setSelectedGroup(null);
    setEditingGroup(null);
    setDeleteTarget(null);
    setModalOpen(false);
  }, [environmentId]);

  // Load assignments to resolve group policy IDs for the detail drawer
  const { data: assignments = [] } = usePolicyAssignments(environmentId);

  // Sort groups by depth for hierarchy display
  const sortedGroups = useMemo(() => {
    // Build tree ordering: parent first, then children sorted by name
    const buildOrder = (parentId: string | null, depth: number): Group[] => {
      const children = groups
        .filter((g) => (g.parent_id ?? null) === parentId)
        .sort((a, b) => a.name.localeCompare(b.name));
      const result: Group[] = [];
      for (const child of children) {
        result.push({ ...child, depth });
        result.push(...buildOrder(child.id, depth + 1));
      }
      return result;
    };
    return buildOrder(null, 0);
  }, [groups]);

  const bulkSelection = useBulkSelection<Group>({
    rows: sortedGroups,
    rowKey: (row) => row.id,
    totalMatching: sortedGroups.length,
  });

  useEffect(() => {
    bulkSelection.clearSelection();
    setBulkMoveOpen(false);
    setBulkMoveParentId('');
    setBulkClearAssignments(false);
    setBulkWarning(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [environmentId]);

  const hasChildren = (groupId: string) => groups.some((g) => g.parent_id === groupId);

  const columns: ColumnDef<Group>[] = [
    {
      key: 'name',
      label: 'Name',
      render: (_val, row) => (
        <div className="flex items-center gap-2">
          <span className="text-muted select-none">{'\u2014 '.repeat(row.depth ?? 0)}</span>
          <FolderTree className="h-4 w-4 text-gray-400 flex-shrink-0" />
          <span className="font-medium text-gray-900">{row.name}</span>
        </div>
      ),
    },
    {
      key: 'description',
      label: 'Description',
      render: (_val, row) => (
        <span className="text-gray-500 text-sm">
          {(row.description as string) || '—'}
        </span>
      ),
    },
    {
      key: 'devices',
      label: 'Devices',
      render: () => (
        <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
          —
        </span>
      ),
    },
    {
      key: 'policy',
      label: 'Policy',
      render: (_val, row) => (
        <div onClick={(e) => e.stopPropagation()} className="min-w-[200px]">
          <PolicyAssignmentSelect
            scopeType="group"
            scopeId={row.id}
            environmentId={environmentId}
            currentPolicyId={row.policy_id ?? null}
          />
        </div>
      ),
    },
    {
      key: 'actions',
      label: '',
      className: 'w-24 text-right',
      render: (_val, row) => (
        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => { setEditingGroup(row); setModalOpen(true); }}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            title="Edit group"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={() => setDeleteTarget(row)}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-danger transition-colors"
            title="Delete group"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteGroup.mutateAsync(deleteTarget.id);
      setDeleteTarget(null);
    } catch {
      // error handled by mutation
    }
  };

  const bulkActions: BulkAction[] = [
    { key: 'move', label: 'Move' },
    { key: 'delete', label: 'Delete', variant: 'danger' },
  ];

  if (!activeEnvironment) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Groups</h1>
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <p className="text-gray-500">Select an environment to manage groups.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Groups</h1>
        <button
          onClick={() => { setEditingGroup(null); setModalOpen(true); }}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-light transition-colors"
        >
          <Plus className="h-4 w-4" />
          Create Group
        </button>
      </div>

      <DataTable<Group>
        columns={columns}
        data={sortedGroups}
        loading={isLoading}
        emptyMessage="No groups yet. Create one to get started."
        selectable
        selectedRows={bulkSelection.selectedRows}
        onSelectionChange={bulkSelection.onSelectionChange}
        rowKey={(row) => row.id}
        onRowClick={(row) => setSelectedGroup(row)}
      />
      <div className="mt-3">
        <SelectAllMatchingNotice
          loadedCount={sortedGroups.length}
          totalCount={sortedGroups.length}
          allMatching={bulkSelection.allMatching}
          canSelectAllMatching={bulkSelection.canSelectAllMatching}
          onSelectAllMatching={bulkSelection.selectAllMatching}
        />
      </div>

      <BulkActionBar
        selectedCount={bulkSelection.selectedCount}
        actions={bulkActions}
        onAction={(key) => {
          if (key === 'delete') {
            if (!window.confirm(`Delete ${bulkSelection.selectedCount} selected group(s)?`)) return;
            setBulkWarning(null);
            bulkGroupAction.mutate(
              {
                environment_id: environmentId,
                operation: 'delete',
                selection: bulkSelection.selectionPayload,
              },
              {
                onSuccess: (data) => {
                  setBulkWarning(null);
                  if (data.failed > 0) {
                    window.alert(`Bulk delete completed with ${data.failed} failure(s).`);
                  }
                  bulkSelection.clearSelection();
                },
                onError: (error) => {
                  setBulkWarning(getBulkWarningMessage(error));
                },
              }
            );
            return;
          }
          setBulkWarning(null);
          setBulkMoveParentId('');
          setBulkClearAssignments(false);
          setBulkMoveOpen(true);
        }}
        onClear={bulkSelection.clearSelection}
      />
      {bulkWarning && !bulkMoveOpen && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {bulkWarning}
        </div>
      )}

      {/* Create / Edit Modal */}
      <GroupModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditingGroup(null); }}
        groups={groups}
        editingGroup={editingGroup}
        environmentId={environmentId}
      />

      {/* Delete Confirmation */}
      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Group"
        message={
          deleteTarget && hasChildren(deleteTarget.id)
            ? `"${deleteTarget.name}" has child groups. Deleting it will affect all nested groups. Are you sure?`
            : `Are you sure you want to delete "${deleteTarget?.name ?? ''}"? This action cannot be undone.`
        }
        confirmLabel="Delete"
        variant="danger"
        loading={deleteGroup.isPending}
      />

      {/* Group Detail Drawer */}
      {selectedGroup && (
        <GroupDetailDrawer
          group={selectedGroup}
          environmentId={environmentId}
          assignments={assignments}
          groups={groups}
          onClose={() => setSelectedGroup(null)}
        />
      )}

      {bulkMoveOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl border border-border bg-surface p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Move Selected Groups</h3>
              <button
                onClick={() => setBulkMoveOpen(false)}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-3 text-sm text-gray-600">
              Move {bulkSelection.selectedCount} selected group(s) to a new parent.
            </p>
            <label className="mb-1 block text-sm font-medium text-gray-700">Target Parent Group</label>
            <select
              value={bulkMoveParentId}
              onChange={(e) => setBulkMoveParentId(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            >
              <option value="">None (top-level)</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{`${'— '.repeat(g.depth ?? 0)}${g.name}`}</option>
              ))}
            </select>
            <label className="mt-3 flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={bulkClearAssignments}
                onChange={(e) => setBulkClearAssignments(e.target.checked)}
              />
              Clear direct assignments/deployments after move
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setBulkMoveOpen(false)}
                className="rounded-lg border border-border px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setBulkWarning(null);
                  bulkGroupAction.mutate(
                    {
                      environment_id: environmentId,
                      operation: 'move',
                      selection: bulkSelection.selectionPayload,
                      options: {
                        target_parent_id: bulkMoveParentId || null,
                        clear_direct_assignments: bulkClearAssignments,
                      },
                    },
                    {
                      onSuccess: (data) => {
                        setBulkWarning(null);
                        if (data.failed > 0) {
                          window.alert(`Bulk move completed with ${data.failed} failure(s).`);
                        }
                        setBulkMoveOpen(false);
                        bulkSelection.clearSelection();
                      },
                      onError: (error) => {
                        setBulkWarning(getBulkWarningMessage(error));
                      },
                    }
                  );
                }}
                disabled={bulkGroupAction.isPending}
                className="rounded-lg bg-accent px-3 py-2 text-sm text-white hover:bg-accent-light disabled:opacity-50"
              >
                {bulkGroupAction.isPending ? 'Moving...' : 'Move Groups'}
              </button>
            </div>
            {bulkWarning && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {bulkWarning}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Group Detail Drawer ----

interface GroupDetailDrawerProps {
  group: Group;
  environmentId: string;
  assignments: Array<{ policy_id: string; policy_name: string; scope_type: string; scope_id: string; locked?: boolean; locked_sections?: string[] | null }>;
  groups: Group[];
  onClose: () => void;
}

function GroupDetailDrawer({ group, environmentId, assignments, groups, onClose }: GroupDetailDrawerProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Find the effective policy for this group — direct assignment or inherited
  const directAssignment = assignments.find(
    (a) => a.scope_type === 'group' && a.scope_id === group.id
  );

  // Walk up parent chain to find inherited policy
  const findInheritedPolicy = () => {
    let currentId = group.parent_id ?? null;
    while (currentId) {
      const parentAssignment = assignments.find(
        (a) => a.scope_type === 'group' && a.scope_id === currentId
      );
      if (parentAssignment) {
        const parentGroup = groups.find((g) => g.id === currentId);
        return { ...parentAssignment, inherited_from: parentGroup?.name ?? 'Parent group' };
      }
      const parentGroup = groups.find((g) => g.id === currentId);
      currentId = parentGroup?.parent_id ?? null;
    }
    // Check environment-level assignment
    const envAssignment = assignments.find(
      (a) => a.scope_type === 'environment' && a.scope_id === environmentId
    );
    if (envAssignment) {
      return { ...envAssignment, inherited_from: 'Environment' };
    }
    return null;
  };

  const inheritedPolicy = !directAssignment ? findInheritedPolicy() : null;
  const effectivePolicyId = directAssignment?.policy_id ?? inheritedPolicy?.policy_id ?? null;
  const effectivePolicyName = directAssignment?.policy_name ?? inheritedPolicy?.policy_name ?? null;
  const isInherited = !directAssignment && !!inheritedPolicy;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-40 flex justify-end bg-black/20"
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className="w-full max-w-lg bg-white shadow-xl border-l border-gray-200 overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <FolderTree className="h-5 w-5 text-gray-400" />
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{group.name}</h2>
              {typeof group.description === 'string' && group.description && (
                <p className="text-sm text-gray-500">{group.description}</p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Policy section */}
          <div>
            <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-3">
              <Shield className="h-4 w-4 text-gray-400" />
              Policy
            </h3>

            {effectivePolicyId ? (
              <div className="rounded-lg border border-gray-200 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{effectivePolicyName}</p>
                    {isInherited && inheritedPolicy && (
                      <p className="text-xs text-gray-500 mt-0.5">
                        Inherited from{' '}
                        <span className="font-medium">
                          {(inheritedPolicy as typeof inheritedPolicy & { inherited_from: string }).inherited_from}
                        </span>
                      </p>
                    )}
                    {!isInherited && (
                      <p className="text-xs text-gray-500 mt-0.5">Directly assigned</p>
                    )}
                  </div>
                  {directAssignment?.locked && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                      <Lock className="h-3 w-3" />
                      Locked
                    </span>
                  )}
                </div>

                {/* Policy assignment selector */}
                <div className="border-t border-gray-100 pt-3">
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    Change policy assignment
                  </label>
                  <PolicyAssignmentSelect
                    scopeType="group"
                    scopeId={group.id}
                    environmentId={environmentId}
                    currentPolicyId={directAssignment?.policy_id ?? null}
                  />
                </div>

                {/* Override editor */}
                <div className="border-t border-gray-100 pt-3">
                  <PolicyOverrideEditor
                    policyId={effectivePolicyId}
                    scopeType="group"
                    scopeId={group.id}
                    environmentId={environmentId}
                  />
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-gray-200 p-4">
                <p className="text-sm text-gray-500 mb-3">No policy assigned to this group or inherited from parents.</p>
                <PolicyAssignmentSelect
                  scopeType="group"
                  scopeId={group.id}
                  environmentId={environmentId}
                  currentPolicyId={null}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
