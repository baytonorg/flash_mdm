import { useState, useMemo, useEffect } from 'react';
import { Plus, Trash2, Puzzle, Filter, Pencil, X } from 'lucide-react';
import clsx from 'clsx';
import { useContextStore } from '@/stores/context';
import DataTable, { type ColumnDef } from '@/components/common/DataTable';
import {
  useComponents,
  useCreateComponent,
  useUpdateComponent,
  useDeleteComponent,
  type PolicyComponent,
} from '@/api/queries/components';

// ─── Constants ──────────────────────────────────────────────────────────────

const CATEGORIES = [
  { value: 'all', label: 'All' },
  { value: 'password', label: 'Password' },
  { value: 'security', label: 'Security' },
  { value: 'network', label: 'Network' },
  { value: 'applications', label: 'Applications' },
  { value: 'deviceSettings', label: 'Device Settings' },
  { value: 'systemUpdates', label: 'System Updates' },
  { value: 'permissions', label: 'Permissions' },
  { value: 'kioskMode', label: 'Kiosk Mode' },
  { value: 'complianceRules', label: 'Compliance' },
  { value: 'crossProfile', label: 'Cross-Profile' },
  { value: 'personalUsage', label: 'Personal Usage' },
  { value: 'statusReporting', label: 'Reporting' },
  { value: 'advanced', label: 'Advanced' },
];

const CATEGORY_STYLES: Record<string, { bg: string; text: string }> = {
  password: { bg: 'bg-red-100', text: 'text-red-700' },
  security: { bg: 'bg-orange-100', text: 'text-orange-700' },
  network: { bg: 'bg-blue-100', text: 'text-blue-700' },
  applications: { bg: 'bg-green-100', text: 'text-green-700' },
  deviceSettings: { bg: 'bg-purple-100', text: 'text-purple-700' },
  systemUpdates: { bg: 'bg-teal-100', text: 'text-teal-700' },
  permissions: { bg: 'bg-yellow-100', text: 'text-yellow-700' },
  kioskMode: { bg: 'bg-pink-100', text: 'text-pink-700' },
  complianceRules: { bg: 'bg-indigo-100', text: 'text-indigo-700' },
  crossProfile: { bg: 'bg-cyan-100', text: 'text-cyan-700' },
  personalUsage: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  statusReporting: { bg: 'bg-slate-100', text: 'text-slate-700' },
  advanced: { bg: 'bg-gray-100', text: 'text-gray-700' },
};

// ─── Modal Component ────────────────────────────────────────────────────────

interface ComponentModalProps {
  component: PolicyComponent | null;
  environmentId: string;
  onClose: () => void;
}

function ComponentModal({ component, environmentId, onClose }: ComponentModalProps) {
  const isEditing = !!component;
  const [name, setName] = useState(component?.name ?? '');
  const [description, setDescription] = useState(component?.description ?? '');
  const [category, setCategory] = useState(component?.category ?? 'password');
  const [configFragment, setConfigFragment] = useState(
    component?.config_fragment ? JSON.stringify(component.config_fragment, null, 2) : '{\n  \n}'
  );
  const [jsonError, setJsonError] = useState('');
  const [wifiSsid, setWifiSsid] = useState('');
  const [wifiAutoConnect, setWifiAutoConnect] = useState(true);
  const [wifiHiddenSsid, setWifiHiddenSsid] = useState(false);

  const createMutation = useCreateComponent();
  const updateMutation = useUpdateComponent();
  const isPending = createMutation.isPending || updateMutation.isPending;

  const insertOpenWifiTemplate = () => {
    const ssid = wifiSsid.trim() || 'Example WiFi';
    const fragment = {
      openNetworkConfiguration: {
        Type: 'UnencryptedConfiguration',
        NetworkConfigurations: [
          {
            GUID: `wifi-${ssid.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'network'}`,
            Name: ssid,
            Type: 'WiFi',
            WiFi: {
              SSID: ssid,
              Security: 'None',
              AutoConnect: wifiAutoConnect,
              ...(wifiHiddenSsid ? { HiddenSSID: true } : {}),
            },
          },
        ],
      },
    };
    setCategory('network');
    if (!name.trim()) setName(`${ssid} (Open Wi-Fi)`);
    if (!description.trim()) setDescription('Reusable Open Network Configuration (Wi-Fi) fragment');
    setConfigFragment(JSON.stringify(fragment, null, 2));
    setJsonError('');
  };

  const handleSave = () => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(configFragment);
      setJsonError('');
    } catch {
      setJsonError('Invalid JSON');
      return;
    }

    if (!name.trim()) return;

    if (isEditing) {
      updateMutation.mutate(
        { id: component.id, name, description, category, config_fragment: parsed },
        { onSuccess: onClose }
      );
    } else {
      createMutation.mutate(
        { environment_id: environmentId, name, description, category, config_fragment: parsed },
        { onSuccess: onClose }
      );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">
            {isEditing ? 'Edit Component' : 'Create Component'}
          </h2>
          <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Strong Password Requirements"
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description..."
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>

          {/* Category */}
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            >
              {CATEGORIES.filter((c) => c.value !== 'all').map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          {/* Wi-Fi helper */}
          {category === 'network' && (
            <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4">
              <div className="mb-2">
                <p className="text-sm font-medium text-blue-900">Open Wi-Fi Helper (ONC)</p>
                <p className="text-xs text-blue-700">
                  Generate an `openNetworkConfiguration` fragment for an open Wi-Fi network, then assign this component to a policy.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-medium text-blue-900">SSID</label>
                  <input
                    type="text"
                    value={wifiSsid}
                    onChange={(e) => setWifiSsid(e.target.value)}
                    placeholder="GuestWiFi"
                    className="block w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm text-blue-900">
                  <input
                    type="checkbox"
                    checked={wifiAutoConnect}
                    onChange={(e) => setWifiAutoConnect(e.target.checked)}
                  />
                  Auto-connect
                </label>
                <label className="flex items-center gap-2 text-sm text-blue-900">
                  <input
                    type="checkbox"
                    checked={wifiHiddenSsid}
                    onChange={(e) => setWifiHiddenSsid(e.target.checked)}
                  />
                  Hidden SSID
                </label>
              </div>
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={insertOpenWifiTemplate}
                  className="rounded-lg border border-blue-300 bg-white px-3 py-2 text-sm font-medium text-blue-800 hover:bg-blue-100 transition-colors"
                >
                  Insert Open Wi-Fi Fragment
                </button>
              </div>
            </div>
          )}

          {/* Config Fragment */}
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">
              Config Fragment (JSON)
            </label>
            <textarea
              value={configFragment}
              onChange={(e) => {
                setConfigFragment(e.target.value);
                setJsonError('');
              }}
              rows={12}
              spellCheck={false}
              className={clsx(
                'block w-full rounded-lg border bg-gray-50 px-3 py-2 text-sm font-mono text-gray-900 shadow-sm focus:outline-none focus:ring-2 resize-y',
                jsonError
                  ? 'border-red-300 focus:border-red-500 focus:ring-red-200'
                  : 'border-gray-300 focus:border-accent focus:ring-accent/20'
              )}
            />
            {jsonError && <p className="mt-1 text-xs text-red-600">{jsonError}</p>}
          </div>
        </div>

        {/* Error from mutation */}
        {(createMutation.error || updateMutation.error) && (
          <div className="mt-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            {(createMutation.error || updateMutation.error)?.message ?? 'An error occurred.'}
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isPending || !name.trim()}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50 transition-colors"
          >
            {isPending ? 'Saving...' : isEditing ? 'Update' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page Component ─────────────────────────────────────────────────────────

export default function PolicyComponents() {
  const activeEnvironment = useContextStore((s) => s.activeEnvironment);
  const environmentId = activeEnvironment?.id;

  const [categoryFilter, setCategoryFilter] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PolicyComponent | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PolicyComponent | null>(null);

  // Reset local state on environment switch
  useEffect(() => {
    setModalOpen(false);
    setEditTarget(null);
    setDeleteTarget(null);
    setCategoryFilter('all');
  }, [environmentId]);

  const { data: components = [], isLoading } = useComponents(environmentId);
  const deleteMutation = useDeleteComponent();

  const filtered = useMemo(
    () =>
      categoryFilter === 'all'
        ? components
        : components.filter((c) => c.category === categoryFilter),
    [components, categoryFilter]
  );

  const columns: ColumnDef<PolicyComponent>[] = useMemo(
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
        key: 'category',
        label: 'Category',
        render: (_val, row) => {
          const style = CATEGORY_STYLES[row.category] ?? { bg: 'bg-gray-100', text: 'text-gray-700' };
          const label = CATEGORIES.find((c) => c.value === row.category)?.label ?? row.category;
          return (
            <span className={clsx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', style.bg, style.text)}>
              {label}
            </span>
          );
        },
      },
      {
        key: 'created_at',
        label: 'Created',
        sortable: true,
        render: (_val, row) => (
          <span className="text-sm text-gray-500">
            {new Date(row.created_at).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </span>
        ),
      },
      {
        key: '_actions' as keyof PolicyComponent & string,
        label: '',
        className: 'w-20',
        render: (_val, row) => (
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setEditTarget(row);
                setModalOpen(true);
              }}
              className="rounded p-1 text-gray-400 hover:bg-blue-50 hover:text-blue-500 transition-colors"
              title="Edit component"
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setDeleteTarget(row);
              }}
              className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
              title="Delete component"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ),
      },
    ],
    []
  );

  // No environment selected
  if (!environmentId) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Policy Components</h1>
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Puzzle className="mx-auto h-12 w-12 text-gray-300 mb-4" />
          <p className="text-gray-500">Select an environment to view components.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Policy Components</h1>
          <p className="mt-1 text-sm text-gray-500">
            Reusable configuration fragments that can be assigned to multiple policies.
          </p>
        </div>
        <button
          onClick={() => {
            setEditTarget(null);
            setModalOpen(true);
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Create Component
        </button>
      </div>

      {/* Category filter */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Filter className="h-4 w-4 text-gray-400" />
        {CATEGORIES.map((c) => (
          <button
            key={c.value}
            onClick={() => setCategoryFilter(c.value)}
            className={clsx(
              'rounded-full px-3 py-1 text-xs font-medium transition-colors',
              categoryFilter === c.value
                ? 'bg-accent text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            )}
          >
            {c.label}
            {c.value !== 'all' && (
              <span className="ml-1">
                ({components.filter((comp) => comp.category === c.value).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Table */}
      <DataTable<PolicyComponent>
        columns={columns}
        data={filtered}
        loading={isLoading}
        emptyMessage="No components found. Create your first reusable policy component to get started."
      />

      {/* Create/Edit modal */}
      {modalOpen && (
        <ComponentModal
          component={editTarget}
          environmentId={environmentId}
          onClose={() => {
            setModalOpen(false);
            setEditTarget(null);
          }}
        />
      )}

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Delete Component</h2>
            <p className="text-sm text-gray-600 mb-6">
              Are you sure you want to delete <strong>{deleteTarget.name}</strong>? This will also
              remove it from all policies it is assigned to. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() =>
                  deleteMutation.mutate(deleteTarget.id, {
                    onSuccess: () => setDeleteTarget(null),
                  })
                }
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
