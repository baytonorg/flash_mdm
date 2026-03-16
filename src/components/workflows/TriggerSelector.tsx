import {
  Smartphone,
  RefreshCw,
  ShieldCheck,
  Package,
  PackageMinus,
  MapPin,
  MapPinOff,
  Clock,
} from 'lucide-react';
import clsx from 'clsx';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TriggerValue {
  trigger_type: string;
  trigger_config: Record<string, unknown>;
}

interface TriggerSelectorProps {
  value: TriggerValue;
  onChange: (value: TriggerValue) => void;
}

// ─── Trigger Definitions ────────────────────────────────────────────────────

export const TRIGGER_OPTIONS = [
  {
    value: 'device.enrolled',
    label: 'Device Enrolled',
    description: 'Fires when a new device completes enrolment.',
    icon: Smartphone,
    color: 'text-green-600',
    bg: 'bg-green-50',
  },
  {
    value: 'device.state_changed',
    label: 'Device State Changed',
    description: 'Fires when a device state changes (e.g., ACTIVE to DISABLED).',
    icon: RefreshCw,
    color: 'text-blue-600',
    bg: 'bg-blue-50',
  },
  {
    value: 'compliance.changed',
    label: 'Compliance Changed',
    description: 'Fires when a device compliance status changes.',
    icon: ShieldCheck,
    color: 'text-amber-600',
    bg: 'bg-amber-50',
  },
  {
    value: 'app.installed',
    label: 'App Installed',
    description: 'Fires when an application is installed on a device.',
    icon: Package,
    color: 'text-purple-600',
    bg: 'bg-purple-50',
  },
  {
    value: 'app.removed',
    label: 'App Removed',
    description: 'Fires when an application is removed from a device.',
    icon: PackageMinus,
    color: 'text-red-600',
    bg: 'bg-red-50',
  },
  {
    value: 'location.fence_entered',
    label: 'Geofence Entered',
    description: 'Fires when a device enters a defined geofence.',
    icon: MapPin,
    color: 'text-teal-600',
    bg: 'bg-teal-50',
  },
  {
    value: 'location.fence_exited',
    label: 'Geofence Exited',
    description: 'Fires when a device exits a defined geofence.',
    icon: MapPinOff,
    color: 'text-orange-600',
    bg: 'bg-orange-50',
  },
  {
    value: 'scheduled',
    label: 'Scheduled',
    description: 'Fires on a recurring schedule (checked every 5 minutes).',
    icon: Clock,
    color: 'text-gray-600',
    bg: 'bg-gray-50',
  },
] as const;

const INTERVAL_PRESETS = [
  { value: 15, label: 'Every 15 minutes' },
  { value: 30, label: 'Every 30 minutes' },
  { value: 60, label: 'Every hour' },
  { value: 360, label: 'Every 6 hours' },
  { value: 720, label: 'Every 12 hours' },
  { value: 1440, label: 'Every 24 hours' },
];

const STATE_OPTIONS = ['ACTIVE', 'DISABLED', 'DELETED', 'PROVISIONING'];

// ─── Component ──────────────────────────────────────────────────────────────

export default function TriggerSelector({ value, onChange }: TriggerSelectorProps) {
  const selectedTrigger = TRIGGER_OPTIONS.find((t) => t.value === value.trigger_type);

  const handleTypeChange = (triggerType: string) => {
    const newConfig: Record<string, unknown> = {};
    if (triggerType === 'scheduled') {
      newConfig.interval_minutes = 60;
    }
    onChange({ trigger_type: triggerType, trigger_config: newConfig });
  };

  const handleConfigChange = (key: string, configValue: unknown) => {
    onChange({
      ...value,
      trigger_config: { ...value.trigger_config, [key]: configValue },
    });
  };

  return (
    <div className="space-y-4">
      {/* Trigger type grid */}
      <div className="grid grid-cols-2 gap-2">
        {TRIGGER_OPTIONS.map((option) => {
          const Icon = option.icon;
          const isSelected = value.trigger_type === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => handleTypeChange(option.value)}
              className={clsx(
                'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                isSelected
                  ? 'border-accent bg-accent/5 ring-1 ring-accent/20'
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              )}
            >
              <div className={clsx('rounded-lg p-2 flex-shrink-0', option.bg)}>
                <Icon className={clsx('h-4 w-4', option.color)} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">{option.label}</p>
                <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{option.description}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Trigger-specific config */}
      {value.trigger_type === 'scheduled' && (
        <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4 space-y-3">
          <h4 className="text-sm font-medium text-gray-900">Schedule Configuration</h4>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Interval</label>
            <select
              value={Number(value.trigger_config.interval_minutes ?? 60)}
              onChange={(e) => handleConfigChange('interval_minutes', Number(e.target.value))}
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            >
              {INTERVAL_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {value.trigger_type === 'device.state_changed' && (
        <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4 space-y-3">
          <h4 className="text-sm font-medium text-gray-900">State Change Configuration</h4>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">From State (optional)</label>
              <select
                value={String(value.trigger_config.from_state ?? '')}
                onChange={(e) => handleConfigChange('from_state', e.target.value || undefined)}
                className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              >
                <option value="">Any state</option>
                {STATE_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">To State (optional)</label>
              <select
                value={String(value.trigger_config.to_state ?? '')}
                onChange={(e) => handleConfigChange('to_state', e.target.value || undefined)}
                className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              >
                <option value="">Any state</option>
                {STATE_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {(value.trigger_type === 'app.installed' || value.trigger_type === 'app.removed') && (
        <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4 space-y-3">
          <h4 className="text-sm font-medium text-gray-900">App Configuration</h4>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Package Name (optional)</label>
            <input
              type="text"
              value={String(value.trigger_config.package_name ?? '')}
              onChange={(e) => handleConfigChange('package_name', e.target.value || undefined)}
              placeholder="e.g. com.example.app (leave empty for any app)"
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
        </div>
      )}

      {(value.trigger_type === 'location.fence_entered' || value.trigger_type === 'location.fence_exited') && (
        <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4 space-y-3">
          <h4 className="text-sm font-medium text-gray-900">Geofence Configuration</h4>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Geofence ID</label>
            <input
              type="text"
              value={String(value.trigger_config.geofence_id ?? '')}
              onChange={(e) => handleConfigChange('geofence_id', e.target.value)}
              placeholder="Select or enter a geofence ID"
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
        </div>
      )}

      {/* Selected trigger summary */}
      {selectedTrigger && (
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <selectedTrigger.icon className={clsx('h-3.5 w-3.5', selectedTrigger.color)} />
          <span>
            Trigger: <span className="font-medium text-gray-700">{selectedTrigger.label}</span>
          </span>
        </div>
      )}
    </div>
  );
}
