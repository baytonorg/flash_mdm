import {
  Terminal,
  FolderTree,
  Shield,
  Mail,
  Webhook,
  FileText,
} from 'lucide-react';
import clsx from 'clsx';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ActionValue {
  action_type: string;
  action_config: Record<string, unknown>;
}

interface ActionSelectorProps {
  value: ActionValue;
  onChange: (value: ActionValue) => void;
}

// ─── Action Definitions ─────────────────────────────────────────────────────

export const ACTION_OPTIONS = [
  {
    value: 'device.command',
    label: 'Send Device Command',
    description: 'Send an AMAPI command (lock, reboot, wipe, etc.)',
    icon: Terminal,
    color: 'text-blue-600',
    bg: 'bg-blue-50',
  },
  {
    value: 'device.move_group',
    label: 'Move to Group',
    description: 'Move the device to a different group.',
    icon: FolderTree,
    color: 'text-purple-600',
    bg: 'bg-purple-50',
  },
  {
    value: 'device.assign_policy',
    label: 'Assign Policy',
    description: 'Assign a policy to the device.',
    icon: Shield,
    color: 'text-green-600',
    bg: 'bg-green-50',
  },
  {
    value: 'notification.email',
    label: 'Send Email',
    description: 'Send an email notification via Resend.',
    icon: Mail,
    color: 'text-amber-600',
    bg: 'bg-amber-50',
  },
  {
    value: 'notification.webhook',
    label: 'Webhook',
    description: 'POST to an external URL with event data.',
    icon: Webhook,
    color: 'text-teal-600',
    bg: 'bg-teal-50',
  },
  {
    value: 'audit.log',
    label: 'Custom Audit Entry',
    description: 'Create a custom audit log entry.',
    icon: FileText,
    color: 'text-gray-600',
    bg: 'bg-gray-50',
  },
] as const;

const COMMAND_TYPES = [
  { value: 'LOCK', label: 'Lock Device' },
  { value: 'RESET_PASSWORD', label: 'Reset Password' },
  { value: 'REBOOT', label: 'Reboot' },
  { value: 'WIPE', label: 'Factory Reset (Wipe)' },
  { value: 'CLEAR_APP_DATA', label: 'Clear App Data' },
  { value: 'START_LOST_MODE', label: 'Start Lost Mode' },
  { value: 'STOP_LOST_MODE', label: 'Stop Lost Mode' },
];

// ─── Component ──────────────────────────────────────────────────────────────

export default function ActionSelector({ value, onChange }: ActionSelectorProps) {
  const selectedAction = ACTION_OPTIONS.find((a) => a.value === value.action_type);

  const handleTypeChange = (actionType: string) => {
    onChange({ action_type: actionType, action_config: {} });
  };

  const handleConfigChange = (key: string, configValue: unknown) => {
    onChange({
      ...value,
      action_config: { ...value.action_config, [key]: configValue },
    });
  };

  return (
    <div className="space-y-4">
      {/* Action type grid */}
      <div className="grid grid-cols-2 gap-2">
        {ACTION_OPTIONS.map((option) => {
          const Icon = option.icon;
          const isSelected = value.action_type === option.value;
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

      {/* Action-specific config */}
      {value.action_type === 'device.command' && (
        <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4 space-y-3">
          <h4 className="text-sm font-medium text-gray-900">Command Configuration</h4>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Command Type</label>
            <select
              value={String(value.action_config.command_type ?? '')}
              onChange={(e) => handleConfigChange('command_type', e.target.value)}
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            >
              <option value="">Select a command...</option>
              {COMMAND_TYPES.map((cmd) => (
                <option key={cmd.value} value={cmd.value}>{cmd.label}</option>
              ))}
            </select>
          </div>
          {value.action_config.command_type === 'RESET_PASSWORD' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">New Password (optional)</label>
              <input
                type="text"
                value={String((value.action_config.command_data as Record<string, unknown>)?.newPassword ?? '')}
                onChange={(e) =>
                  handleConfigChange('command_data', { newPassword: e.target.value || undefined })
                }
                placeholder="Leave empty for auto-generated"
                className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>
          )}
          {value.action_config.command_type === 'WIPE' && (
            <label className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2">
              <input
                type="checkbox"
                checked={Array.isArray((value.action_config.command_data as Record<string, unknown> | undefined)?.wipeDataFlags)
                  && ((value.action_config.command_data as Record<string, unknown>).wipeDataFlags as unknown[])
                    .includes('WIPE_ESIMS')}
                onChange={(e) => {
                  const current = (value.action_config.command_data as Record<string, unknown> | undefined) ?? {};
                  handleConfigChange('command_data', {
                    ...current,
                    wipeDataFlags: e.target.checked ? ['WIPE_ESIMS'] : undefined,
                  });
                }}
                className="mt-0.5 rounded border-gray-300"
              />
              <span>
                <span className="block text-xs font-medium text-gray-700">Remove managed eSIMs during wipe</span>
                <span className="block text-xs text-gray-500">
                  Adds `wipeParams.wipeDataFlags=[WIPE_ESIMS]` to the AMAPI WIPE command.
                </span>
              </span>
            </label>
          )}
        </div>
      )}

      {value.action_type === 'device.move_group' && (
        <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4 space-y-3">
          <h4 className="text-sm font-medium text-gray-900">Group Configuration</h4>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Target Group ID</label>
            <input
              type="text"
              value={String(value.action_config.group_id ?? '')}
              onChange={(e) => handleConfigChange('group_id', e.target.value)}
              placeholder="Enter the target group UUID"
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
        </div>
      )}

      {value.action_type === 'device.assign_policy' && (
        <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4 space-y-3">
          <h4 className="text-sm font-medium text-gray-900">Policy Configuration</h4>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Policy ID</label>
            <input
              type="text"
              value={String(value.action_config.policy_id ?? '')}
              onChange={(e) => handleConfigChange('policy_id', e.target.value)}
              placeholder="Enter the target policy UUID"
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
        </div>
      )}

      {value.action_type === 'notification.email' && (
        <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4 space-y-3">
          <h4 className="text-sm font-medium text-gray-900">Email Configuration</h4>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Recipient Email</label>
            <input
              type="email"
              value={String(value.action_config.to ?? '')}
              onChange={(e) => handleConfigChange('to', e.target.value)}
              placeholder="admin@example.com"
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Subject (optional)</label>
            <input
              type="text"
              value={String(value.action_config.subject ?? '')}
              onChange={(e) => handleConfigChange('subject', e.target.value)}
              placeholder="Leave empty for default subject"
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Custom Message (optional)</label>
            <textarea
              value={String(value.action_config.template ?? '')}
              onChange={(e) => handleConfigChange('template', e.target.value)}
              placeholder="Leave empty for default email template with device details"
              rows={3}
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 resize-y"
            />
          </div>
        </div>
      )}

      {value.action_type === 'notification.webhook' && (
        <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4 space-y-3">
          <h4 className="text-sm font-medium text-gray-900">Webhook Configuration</h4>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Webhook URL</label>
            <input
              type="url"
              value={String(value.action_config.url ?? '')}
              onChange={(e) => handleConfigChange('url', e.target.value)}
              placeholder="https://example.com/webhook"
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Secret Header (optional)</label>
            <input
              type="text"
              value={String(value.action_config.secret ?? '')}
              onChange={(e) => handleConfigChange('secret', e.target.value)}
              placeholder="Sent as X-Webhook-Secret header"
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
        </div>
      )}

      {value.action_type === 'audit.log' && (
        <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4 space-y-3">
          <h4 className="text-sm font-medium text-gray-900">Audit Log Configuration</h4>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Action Name</label>
            <input
              type="text"
              value={String(value.action_config.action ?? '')}
              onChange={(e) => handleConfigChange('action', e.target.value)}
              placeholder="e.g. workflow.custom_alert"
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
        </div>
      )}

      {/* Selected action summary */}
      {selectedAction && (
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <selectedAction.icon className={clsx('h-3.5 w-3.5', selectedAction.color)} />
          <span>
            Action: <span className="font-medium text-gray-700">{selectedAction.label}</span>
          </span>
        </div>
      )}
    </div>
  );
}
