import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import FenceScopeSelector from './FenceScopeSelector';
import GeofenceMap from './GeofenceMap';
import type { Geofence, CreateGeofenceParams, UpdateGeofenceParams } from '@/api/queries/geofences';

type ActionType = 'none' | 'lock' | 'notification' | 'move_group' | 'webhook';

interface ActionConfig {
  type: ActionType;
  title?: string;
  message?: string;
  target_group_id?: string;
  url?: string;
  method?: string;
}

interface GeofenceEditorProps {
  geofence?: Geofence | null;
  environmentId: string;
  onSave: (data: CreateGeofenceParams | UpdateGeofenceParams) => void;
  onClose: () => void;
  isSaving?: boolean;
}

const ACTION_OPTIONS: Array<{ value: ActionType; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'lock', label: 'Lock device' },
  { value: 'notification', label: 'Send notification' },
  { value: 'move_group', label: 'Move to group' },
  { value: 'webhook', label: 'Custom webhook' },
];

function parseAction(action: Record<string, unknown>): ActionConfig {
  if (!action || Object.keys(action).length === 0) {
    return { type: 'none' };
  }
  return {
    type: (action.type as ActionType) ?? 'none',
    title: action.title as string | undefined,
    message: action.message as string | undefined,
    target_group_id: action.target_group_id as string | undefined,
    url: action.url as string | undefined,
    method: action.method as string | undefined,
  };
}

function serializeAction(config: ActionConfig): Record<string, unknown> {
  if (config.type === 'none') return {};
  const result: Record<string, unknown> = { type: config.type };
  if (config.type === 'notification') {
    result.title = config.title ?? '';
    result.message = config.message ?? '';
  } else if (config.type === 'move_group') {
    result.target_group_id = config.target_group_id ?? '';
  } else if (config.type === 'webhook') {
    result.url = config.url ?? '';
    result.method = config.method ?? 'POST';
  }
  return result;
}

function ActionEditor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: ActionConfig;
  onChange: (config: ActionConfig) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      <select
        value={value.type}
        onChange={(e) => onChange({ ...value, type: e.target.value as ActionType })}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
      >
        {ACTION_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>

      {value.type === 'notification' && (
        <div className="space-y-2 pl-4 border-l-2 border-gray-200">
          <input
            type="text"
            value={value.title ?? ''}
            onChange={(e) => onChange({ ...value, title: e.target.value })}
            placeholder="Notification title"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          <input
            type="text"
            value={value.message ?? ''}
            onChange={(e) => onChange({ ...value, message: e.target.value })}
            placeholder="Notification message"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      )}

      {value.type === 'move_group' && (
        <div className="pl-4 border-l-2 border-gray-200">
          <input
            type="text"
            value={value.target_group_id ?? ''}
            onChange={(e) => onChange({ ...value, target_group_id: e.target.value })}
            placeholder="Target group ID"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      )}

      {value.type === 'webhook' && (
        <div className="space-y-2 pl-4 border-l-2 border-gray-200">
          <input
            type="url"
            value={value.url ?? ''}
            onChange={(e) => onChange({ ...value, url: e.target.value })}
            placeholder="https://example.com/webhook"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          <select
            value={value.method ?? 'POST'}
            onChange={(e) => onChange({ ...value, method: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
          </select>
        </div>
      )}
    </div>
  );
}

export default function GeofenceEditor({
  geofence,
  environmentId,
  onSave,
  onClose,
  isSaving = false,
}: GeofenceEditorProps) {
  const isEditing = !!geofence;

  const [name, setName] = useState(geofence?.name ?? '');
  const [latitude, setLatitude] = useState(geofence?.latitude ?? 0);
  const [longitude, setLongitude] = useState(geofence?.longitude ?? 0);
  const [radiusMeters, setRadiusMeters] = useState(geofence?.radius_meters ?? 500);
  const [scopeType, setScopeType] = useState<'environment' | 'group' | 'device'>(
    (geofence?.scope_type as 'environment' | 'group' | 'device') ?? 'environment'
  );
  const [scopeId, setScopeId] = useState<string | null>(geofence?.scope_id ?? null);
  const [actionOnEnter, setActionOnEnter] = useState<ActionConfig>(
    geofence ? parseAction(geofence.action_on_enter) : { type: 'none' }
  );
  const [actionOnExit, setActionOnExit] = useState<ActionConfig>(
    geofence ? parseAction(geofence.action_on_exit) : { type: 'none' }
  );
  const [enabled, setEnabled] = useState(geofence?.enabled ?? true);

  // Update state when geofence prop changes
  useEffect(() => {
    if (geofence) {
      setName(geofence.name);
      setLatitude(geofence.latitude);
      setLongitude(geofence.longitude);
      setRadiusMeters(geofence.radius_meters);
      setScopeType(geofence.scope_type);
      setScopeId(geofence.scope_id);
      setActionOnEnter(parseAction(geofence.action_on_enter));
      setActionOnExit(parseAction(geofence.action_on_exit));
      setEnabled(geofence.enabled);
    }
  }, [geofence]);

  const handleMapClick = (lat: number, lng: number) => {
    setLatitude(parseFloat(lat.toFixed(6)));
    setLongitude(parseFloat(lng.toFixed(6)));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (isEditing && geofence) {
      const data: UpdateGeofenceParams = {
        id: geofence.id,
        name,
        latitude,
        longitude,
        radius_meters: radiusMeters,
        scope_type: scopeType,
        scope_id: scopeId,
        action_on_enter: serializeAction(actionOnEnter),
        action_on_exit: serializeAction(actionOnExit),
        enabled,
      };
      onSave(data);
    } else {
      const data: CreateGeofenceParams = {
        environment_id: environmentId,
        name,
        latitude,
        longitude,
        radius_meters: radiusMeters,
        scope_type: scopeType,
        scope_id: scopeId,
        action_on_enter: serializeAction(actionOnEnter),
        action_on_exit: serializeAction(actionOnExit),
        enabled,
      };
      onSave(data);
    }
  };

  const previewCircle =
    latitude !== 0 || longitude !== 0
      ? { lat: latitude, lng: longitude, radius: radiusMeters }
      : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            {isEditing ? 'Edit Geofence' : 'Create Geofence'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6">
            {/* Left column: form fields */}
            <div className="space-y-4">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="Office building, Warehouse zone..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              {/* Coordinates */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Latitude</label>
                  <input
                    type="number"
                    step="any"
                    value={latitude}
                    onChange={(e) => setLatitude(parseFloat(e.target.value) || 0)}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Longitude</label>
                  <input
                    type="number"
                    step="any"
                    value={longitude}
                    onChange={(e) => setLongitude(parseFloat(e.target.value) || 0)}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>
              <p className="text-xs text-gray-500 -mt-2">Click the map to set coordinates</p>

              {/* Radius */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Radius: {radiusMeters.toLocaleString()} meters
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={50}
                    max={50000}
                    step={50}
                    value={radiusMeters}
                    onChange={(e) => setRadiusMeters(parseInt(e.target.value, 10))}
                    className="flex-1"
                  />
                  <input
                    type="number"
                    min={1}
                    value={radiusMeters}
                    onChange={(e) => setRadiusMeters(parseInt(e.target.value, 10) || 50)}
                    className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Scope */}
              <FenceScopeSelector
                value={{ scope_type: scopeType, scope_id: scopeId }}
                onChange={({ scope_type, scope_id }) => {
                  setScopeType(scope_type);
                  setScopeId(scope_id);
                }}
              />

              {/* Actions */}
              <ActionEditor
                label="Action on enter"
                value={actionOnEnter}
                onChange={setActionOnEnter}
              />
              <ActionEditor
                label="Action on exit"
                value={actionOnExit}
                onChange={setActionOnExit}
              />

              {/* Enabled toggle */}
              <label className="flex items-center gap-3 cursor-pointer">
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-10 h-6 bg-gray-300 peer-checked:bg-blue-600 rounded-full transition-colors" />
                  <div className="absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform peer-checked:translate-x-4" />
                </div>
                <span className="text-sm font-medium text-gray-700">
                  {enabled ? 'Enabled' : 'Disabled'}
                </span>
              </label>
            </div>

            {/* Right column: map preview */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Preview</label>
              <GeofenceMap
                geofences={[]}
                previewCircle={previewCircle}
                onMapClick={handleMapClick}
                className="h-80 lg:h-full min-h-[320px]"
              />
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving || !name}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSaving ? 'Saving...' : isEditing ? 'Update Geofence' : 'Create Geofence'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
