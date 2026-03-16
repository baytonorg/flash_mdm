import { useState, useEffect } from 'react';
import { useContextStore } from '@/stores/context';
import { apiClient } from '@/api/client';
import { Search } from 'lucide-react';

interface FenceScopeValue {
  scope_type: 'environment' | 'group' | 'device';
  scope_id: string | null;
}

interface FenceScopeSelectorProps {
  value: FenceScopeValue;
  onChange: (value: FenceScopeValue) => void;
}

interface Group {
  id: string;
  name: string;
  depth?: number;
}

interface DeviceOption {
  id: string;
  serial_number: string | null;
  model: string | null;
  amapi_name: string;
}

export default function FenceScopeSelector({ value, onChange }: FenceScopeSelectorProps) {
  const { activeEnvironment, groups } = useContextStore();
  const [deviceSearch, setDeviceSearch] = useState('');
  const [deviceResults, setDeviceResults] = useState<DeviceOption[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedDeviceName, setSelectedDeviceName] = useState('');

  // Search devices when the search term changes
  useEffect(() => {
    if (value.scope_type !== 'device' || !deviceSearch || !activeEnvironment?.id) {
      setDeviceResults([]);
      return;
    }

    const timeout = setTimeout(async () => {
      setIsSearching(true);
      try {
        const data = await apiClient.get<{ devices: DeviceOption[] }>(
          `/api/devices/list?environment_id=${activeEnvironment.id}&search=${encodeURIComponent(deviceSearch)}&per_page=10`
        );
        setDeviceResults(data.devices);
      } catch {
        setDeviceResults([]);
      }
      setIsSearching(false);
    }, 300);

    return () => clearTimeout(timeout);
  }, [deviceSearch, value.scope_type, activeEnvironment?.id]);

  const handleScopeTypeChange = (scopeType: 'environment' | 'group' | 'device') => {
    onChange({ scope_type: scopeType, scope_id: scopeType === 'environment' ? null : value.scope_id });
    if (scopeType !== 'device') {
      setDeviceSearch('');
      setDeviceResults([]);
      setSelectedDeviceName('');
    }
  };

  const handleGroupChange = (groupId: string) => {
    onChange({ scope_type: 'group', scope_id: groupId || null });
  };

  const handleDeviceSelect = (device: DeviceOption) => {
    onChange({ scope_type: 'device', scope_id: device.id });
    setSelectedDeviceName(device.serial_number || device.model || device.amapi_name);
    setDeviceSearch('');
    setDeviceResults([]);
  };

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-gray-700">Scope</label>

      {/* Radio buttons */}
      <div className="flex gap-4">
        {(['environment', 'group', 'device'] as const).map((type) => (
          <label key={type} className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="scope_type"
              value={type}
              checked={value.scope_type === type}
              onChange={() => handleScopeTypeChange(type)}
              className="text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-700 capitalize">{type}</span>
          </label>
        ))}
      </div>

      {/* Group selector */}
      {value.scope_type === 'group' && (
        <select
          value={value.scope_id ?? ''}
          onChange={(e) => handleGroupChange(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="">Select a group...</option>
          {groups.map((group: Group) => (
            <option key={group.id} value={group.id}>
              {'  '.repeat(group.depth ?? 0)}{group.name}
            </option>
          ))}
        </select>
      )}

      {/* Device search */}
      {value.scope_type === 'device' && (
        <div className="relative">
          {value.scope_id && selectedDeviceName ? (
            <div className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg bg-gray-50">
              <span className="text-sm text-gray-900 flex-1">{selectedDeviceName}</span>
              <button
                type="button"
                onClick={() => {
                  onChange({ scope_type: 'device', scope_id: null });
                  setSelectedDeviceName('');
                }}
                className="text-xs text-gray-500 hover:text-gray-700"
              >
                Clear
              </button>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  value={deviceSearch}
                  onChange={(e) => setDeviceSearch(e.target.value)}
                  placeholder="Search by serial, model..."
                  className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              {(deviceResults.length > 0 || isSearching) && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {isSearching ? (
                    <div className="px-3 py-2 text-sm text-gray-500">Searching...</div>
                  ) : (
                    deviceResults.map((device) => (
                      <button
                        key={device.id}
                        type="button"
                        onClick={() => handleDeviceSelect(device)}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
                      >
                        <span className="font-medium text-gray-900">
                          {device.serial_number || 'N/A'}
                        </span>
                        <span className="text-gray-500">
                          {device.model || device.amapi_name}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
