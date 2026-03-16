import { useState, useMemo, useCallback, useEffect } from 'react';
import { useContextStore } from '@/stores/context';
import {
  useGeofences,
  useGeofence,
  useCreateGeofence,
  useUpdateGeofence,
  useDeleteGeofence,
  useToggleGeofence,
  type Geofence,
  type CreateGeofenceParams,
  type UpdateGeofenceParams,
} from '@/api/queries/geofences';
import DataTable, { type ColumnDef } from '@/components/common/DataTable';
import ConfirmModal from '@/components/common/ConfirmModal';
import GeofenceMap from '@/components/geofencing/GeofenceMap';
import GeofenceEditor from '@/components/geofencing/GeofenceEditor';
import { MapPin, Plus, Pencil, Trash2, Eye } from 'lucide-react';

export default function Geofencing() {
  const { activeEnvironment } = useContextStore();
  const environmentId = activeEnvironment?.id ?? '';

  // Data fetching
  const { data, isLoading } = useGeofences(environmentId);
  const geofences = data?.geofences ?? [];

  // UI state
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingGeofence, setEditingGeofence] = useState<Geofence | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Geofence | null>(null);
  const [detailPanelId, setDetailPanelId] = useState<string | null>(null);

  // Reset local state on environment switch
  useEffect(() => {
    setSelectedId(null);
    setEditorOpen(false);
    setEditingGeofence(null);
    setDeleteTarget(null);
    setDetailPanelId(null);
  }, [environmentId]);

  // Detail data
  const { data: detailData } = useGeofence(detailPanelId ?? '');

  // Mutations
  const createMutation = useCreateGeofence();
  const updateMutation = useUpdateGeofence();
  const deleteMutation = useDeleteGeofence();
  const toggleMutation = useToggleGeofence();

  const handleCreate = () => {
    setEditingGeofence(null);
    setEditorOpen(true);
  };

  const handleEdit = (geofence: Geofence) => {
    setEditingGeofence(geofence);
    setEditorOpen(true);
  };

  const handleSave = useCallback(
    (data: CreateGeofenceParams | UpdateGeofenceParams) => {
      if ('environment_id' in data) {
        createMutation.mutate(data, {
          onSuccess: () => setEditorOpen(false),
        });
      } else {
        updateMutation.mutate(data, {
          onSuccess: () => setEditorOpen(false),
        });
      }
    },
    [createMutation, updateMutation]
  );

  const handleDelete = useCallback(() => {
    if (!deleteTarget) return;
    deleteMutation.mutate(deleteTarget.id, {
      onSuccess: () => {
        setDeleteTarget(null);
        if (selectedId === deleteTarget.id) setSelectedId(null);
        if (detailPanelId === deleteTarget.id) setDetailPanelId(null);
      },
    });
  }, [deleteTarget, deleteMutation, selectedId, detailPanelId]);

  const handleToggle = useCallback(
    (geofence: Geofence) => {
      toggleMutation.mutate(geofence.id);
    },
    [toggleMutation]
  );

  const handleGeofenceClick = useCallback((id: string) => {
    setSelectedId(id);
    setDetailPanelId(id);
  }, []);

  const handleRowClick = useCallback((row: Geofence) => {
    setSelectedId(row.id);
    setDetailPanelId(row.id);
  }, []);

  const columns: ColumnDef<Geofence>[] = useMemo(
    () => [
      {
        key: 'name',
        label: 'Name',
        sortable: true,
        render: (_, row) => (
          <span className="font-medium text-gray-900">{row.name}</span>
        ),
      },
      {
        key: 'radius_meters',
        label: 'Radius',
        render: (_, row) => (
          <span className="text-gray-600">
            {row.radius_meters >= 1000
              ? `${(row.radius_meters / 1000).toFixed(1)} km`
              : `${row.radius_meters} m`}
          </span>
        ),
      },
      {
        key: 'scope_type',
        label: 'Scope',
        render: (_, row) => (
          <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-700 capitalize">
            {row.scope_type}
          </span>
        ),
      },
      {
        key: 'enabled',
        label: 'Enabled',
        render: (_, row) => (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleToggle(row);
            }}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              row.enabled ? 'bg-blue-600' : 'bg-gray-300'
            }`}
            title={row.enabled ? 'Disable' : 'Enable'}
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
                row.enabled ? 'translate-x-4' : 'translate-x-0.5'
              }`}
            />
          </button>
        ),
      },
      {
        key: 'devices_inside',
        label: 'Devices Inside',
        render: (_, row) => (
          <span className="text-gray-600">{row.devices_inside ?? 0}</span>
        ),
      },
      {
        key: 'actions',
        label: '',
        render: (_, row) => (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleEdit(row);
              }}
              className="p-1 text-gray-400 hover:text-gray-600 rounded transition-colors"
              title="Edit"
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setDeleteTarget(row);
              }}
              className="p-1 text-gray-400 hover:text-red-600 rounded transition-colors"
              title="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ),
      },
    ],
    [handleToggle]
  );

  // No environment selected
  if (!environmentId) {
    return (
      <div>
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Geofencing</h1>
          <p className="mt-1 text-sm text-gray-500">
            Create and manage geofences with a companion app
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex flex-col items-center gap-2 py-8">
            <MapPin className="h-10 w-10 text-gray-300" />
            <p className="text-gray-500">Select an environment to view geofences.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Geofencing</h1>
          <p className="mt-1 text-sm text-gray-500">
            Create and manage geofences with a companion app
          </p>
        </div>
        <button
          onClick={handleCreate}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Create Geofence
        </button>
      </div>

      {/* Two-panel layout */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Left panel: list */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <DataTable<Geofence>
            columns={columns}
            data={geofences}
            loading={isLoading}
            emptyMessage="No geofences yet. Create one to get started."
            onRowClick={handleRowClick}
            rowKey={(row) => row.id}
          />
        </div>

        {/* Right panel: map + detail */}
        <div className="space-y-4">
          {/* Map */}
          <GeofenceMap
            geofences={geofences}
            selectedId={selectedId}
            onGeofenceClick={handleGeofenceClick}
            className="h-80 xl:h-96"
          />

          {/* Detail panel */}
          {detailPanelId && detailData && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">
                  {detailData.geofence.name}
                </h3>
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${
                      detailData.geofence.enabled
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {detailData.geofence.enabled ? 'Active' : 'Disabled'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setDetailPanelId(null)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <span className="sr-only">Close</span>
                    &times;
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <p className="text-gray-500">Centre</p>
                  <p className="text-gray-900 font-mono text-xs">
                    {detailData.geofence.latitude.toFixed(4)}, {detailData.geofence.longitude.toFixed(4)}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500">Radius</p>
                  <p className="text-gray-900">
                    {detailData.geofence.radius_meters >= 1000
                      ? `${(detailData.geofence.radius_meters / 1000).toFixed(1)} km`
                      : `${detailData.geofence.radius_meters} m`}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500">Scope</p>
                  <p className="text-gray-900 capitalize">{detailData.geofence.scope_type}</p>
                </div>
              </div>

              {/* Device states */}
              {detailData.device_states.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                    Device States ({detailData.device_states.length})
                  </p>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {detailData.device_states.map((state) => (
                      <div
                        key={state.device_id}
                        className="flex items-center justify-between py-1.5 px-2 rounded bg-gray-50 text-sm"
                      >
                        <span className="text-gray-900">
                          {state.serial_number || state.device_name}
                        </span>
                        <span
                          className={`text-xs font-medium ${
                            state.inside ? 'text-green-600' : 'text-gray-500'
                          }`}
                        >
                          {state.inside ? 'Inside' : 'Outside'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Editor modal */}
      {editorOpen && (
        <GeofenceEditor
          geofence={editingGeofence}
          environmentId={environmentId}
          onSave={handleSave}
          onClose={() => {
            setEditorOpen(false);
            setEditingGeofence(null);
          }}
          isSaving={createMutation.isPending || updateMutation.isPending}
        />
      )}

      {/* Delete confirmation */}
      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title={`Delete "${deleteTarget?.name}"?`}
        message="This will permanently delete this geofence and all associated device state records. This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
