import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Globe, FolderTree, Smartphone } from 'lucide-react';
import clsx from 'clsx';
import { apiClient } from '@/api/client';
import { useContextStore } from '@/stores/context';

interface ScopeValue {
  scope_type: 'environment' | 'group' | 'device';
  scope_id: string;
}

interface AppScopeSelectorProps {
  value: ScopeValue;
  onChange: (value: ScopeValue) => void;
}

interface Group {
  id: string;
  name: string;
  parent_group_id: string | null;
}

interface Device {
  id: string;
  name: string | null;
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
}

const SCOPE_OPTIONS = [
  { value: 'environment' as const, label: 'Environment', icon: Globe, description: 'Deploy to all policies in this environment' },
  { value: 'group' as const, label: 'Group', icon: FolderTree, description: 'Deploy to a specific device group' },
  { value: 'device' as const, label: 'Device', icon: Smartphone, description: 'Deploy to a specific device' },
];

export default function AppScopeSelector({ value, onChange }: AppScopeSelectorProps) {
  const activeEnvironment = useContextStore((s) => s.activeEnvironment);
  const environmentId = activeEnvironment?.id;
  const [deviceSearch, setDeviceSearch] = useState('');

  // Fetch groups for the environment
  const { data: groupsData } = useQuery({
    queryKey: ['groups', environmentId],
    queryFn: () =>
      apiClient.get<{ groups: Group[] }>(`/api/groups/list?environment_id=${environmentId}`),
    enabled: !!environmentId && value.scope_type === 'group',
  });

  // Fetch devices for search
  const { data: devicesData } = useQuery({
    queryKey: ['devices', environmentId, deviceSearch],
    queryFn: () =>
      apiClient.get<{ devices: Device[] }>(
        `/api/devices/list?environment_id=${environmentId}&search=${encodeURIComponent(deviceSearch)}`
      ),
    enabled: !!environmentId && value.scope_type === 'device' && deviceSearch.length >= 2,
  });

  const groups = groupsData?.groups ?? [];
  const devices = devicesData?.devices ?? [];

  const handleScopeTypeChange = (scopeType: ScopeValue['scope_type']) => {
    const scopeId = scopeType === 'environment' ? (environmentId ?? '') : '';
    onChange({ scope_type: scopeType, scope_id: scopeId });
  };

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-gray-900">Deployment Scope</label>

      {/* Scope type radio buttons */}
      <div className="space-y-2">
        {SCOPE_OPTIONS.map((option) => (
          <label
            key={option.value}
            className={clsx(
              'flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors',
              value.scope_type === option.value
                ? 'border-accent bg-accent/5'
                : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
            )}
          >
            <input
              type="radio"
              name="scope_type"
              value={option.value}
              checked={value.scope_type === option.value}
              onChange={() => handleScopeTypeChange(option.value)}
              className="mt-0.5 h-4 w-4 text-accent focus:ring-accent/30"
            />
            <div className="flex items-center gap-2 flex-1">
              <option.icon className="h-4 w-4 text-gray-400 flex-shrink-0" />
              <div>
                <span className="text-sm font-medium text-gray-900">{option.label}</span>
                <p className="text-xs text-gray-500">{option.description}</p>
              </div>
            </div>
          </label>
        ))}
      </div>

      {/* Group dropdown */}
      {value.scope_type === 'group' && (
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Select Group</label>
          <select
            value={value.scope_id}
            onChange={(e) => onChange({ ...value, scope_id: e.target.value })}
            className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          >
            <option value="">-- Select a group --</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Device search */}
      {value.scope_type === 'device' && (
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Search Device</label>
          <input
            type="text"
            value={deviceSearch}
            onChange={(e) => setDeviceSearch(e.target.value)}
            placeholder="Search by name or identifier..."
            className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
          {devices.length > 0 && (
            <div className="mt-2 border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-40 overflow-y-auto">
              {devices.map((device) => {
                const deviceName = device.name || [device.manufacturer, device.model].filter(Boolean).join(' ') || device.serial_number || device.id;
                return (
                  <button
                    key={device.id}
                    onClick={() => {
                      onChange({ ...value, scope_id: device.id });
                      setDeviceSearch(deviceName);
                    }}
                    className={clsx(
                      'block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 transition-colors',
                      value.scope_id === device.id && 'bg-accent/5'
                    )}
                  >
                    <span className="font-medium text-gray-900">
                      {deviceName}
                    </span>
                    {device.serial_number && (
                      <span className="ml-2 text-xs text-gray-400">S/N: {device.serial_number}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          {value.scope_id && (
            <p className="mt-1 text-xs text-gray-500">
              Selected: <span className="font-mono">{value.scope_id}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
