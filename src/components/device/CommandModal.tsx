import { useState, useEffect, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/api/client';
import { Terminal, AlertTriangle, Loader2 } from 'lucide-react';
import clsx from 'clsx';

export interface CommandModalProps {
  open: boolean;
  onClose: () => void;
  deviceId?: string;
  deviceIds?: string[];
  deviceName?: string;
  initialCommand?: string;
  onSuccess?: () => void;
}

interface CommandOption {
  value: string;
  label: string;
  description: string;
  danger: boolean;
  fields?: CommandField[];
  bulkOnly?: boolean;
}

interface CommandField {
  key: string;
  label: string;
  type: 'text' | 'textarea';
  placeholder?: string;
  required?: boolean;
}

const WIPE_DATA_FLAG_OPTIONS: Array<{ value: string; label: string; description: string }> = [
  {
    value: 'PRESERVE_RESET_PROTECTION_DATA',
    label: 'Preserve Reset Protection Data',
    description: 'Preserves FRP data on company-owned devices where supported.',
  },
  {
    value: 'WIPE_EXTERNAL_STORAGE',
    label: 'Wipe External Storage',
    description: 'Also wipes external storage (for example SD card contents) where supported.',
  },
  {
    value: 'WIPE_ESIMS',
    label: 'Remove Managed eSIMs',
    description: 'Removes managed eSIMs during wipe. On personally-owned devices this removes managed eSIMs only.',
  },
  {
    value: 'WIPE_DATA_FLAG_UNSPECIFIED',
    label: 'Unspecified',
    description: 'Sends the enum placeholder. Usually leave this unchecked.',
  },
];

const COMMANDS: CommandOption[] = [
  {
    value: 'LOCK',
    label: 'Lock Device',
    description: 'Immediately lock the device screen.',
    danger: false,
  },
  {
    value: 'REBOOT',
    label: 'Reboot Device',
    description: 'Restart the device. Only supported on fully managed devices.',
    danger: false,
  },
  {
    value: 'RESET_PASSWORD',
    label: 'Reset Password',
    description: 'Set a new device password or clear the existing one.',
    danger: false,
    fields: [
      {
        key: 'newPassword',
        label: 'New Password',
        type: 'text',
        placeholder: 'Leave blank to clear password',
      },
    ],
  },
  {
    value: 'START_LOST_MODE',
    label: 'Start Lost Mode',
    description: 'Enable lost mode to display a message and contact info on the lock screen.',
    danger: false,
    fields: [
      {
        key: 'lostMessage',
        label: 'Lock Screen Message',
        type: 'textarea',
        placeholder: 'This device has been lost. Please contact...',
      },
      {
        key: 'lostPhoneNumber',
        label: 'Contact Phone Number',
        type: 'text',
        placeholder: '+1234567890',
      },
      {
        key: 'lostEmailAddress',
        label: 'Contact Email',
        type: 'text',
        placeholder: 'admin@company.com',
      },
    ],
  },
  {
    value: 'STOP_LOST_MODE',
    label: 'Stop Lost Mode',
    description: 'Disable lost mode on the device.',
    danger: false,
  },
  {
    value: 'RELINQUISH_OWNERSHIP',
    label: 'Relinquish Ownership',
    description: 'Transfer device ownership from company-owned to personally-owned.',
    danger: true,
  },
  {
    value: 'CLEAR_APP_DATA',
    label: 'Clear App Data',
    description: 'Clear all data for specified applications on the device.',
    danger: false,
    fields: [
      {
        key: 'packageName',
        label: 'Package Name',
        type: 'text',
        placeholder: 'com.example.app',
        required: true,
      },
    ],
  },
  {
    value: 'REQUEST_DEVICE_INFO',
    label: 'Request Device Info',
    description: 'Request additional device information such as the eSIM EID.',
    danger: false,
  },
  {
    value: 'ADD_ESIM',
    label: 'Add eSIM',
    description: 'Add an eSIM profile to the device. Requires Android 15+.',
    danger: false,
    fields: [
      {
        key: 'activationCode',
        label: 'Activation Code',
        type: 'text',
        placeholder: 'LPA:1$smdp.example.com$...',
        required: true,
      },
    ],
  },
  {
    value: 'REMOVE_ESIM',
    label: 'Remove eSIM',
    description: 'Remove an eSIM profile from the device. Requires Android 15+.',
    danger: true,
    fields: [
      {
        key: 'iccId',
        label: 'ICC ID',
        type: 'text',
        placeholder: 'The ICC ID of the eSIM to remove',
        required: true,
      },
    ],
  },
  {
    value: 'DISABLE',
    label: 'Disable Device',
    description: 'Disable the device. The device will become unusable until re-enabled. Apps and data are preserved.',
    danger: true,
  },
  {
    value: 'ENABLE',
    label: 'Enable Device',
    description: 'Re-enable a previously disabled device, restoring it to active state.',
    danger: false,
  },
  {
    value: 'WIPE',
    label: 'Wipe Device',
    description: 'Factory reset the device. All data will be permanently erased.',
    danger: true,
    fields: [
      {
        key: 'wipeReason',
        label: 'Wipe Reason',
        type: 'text',
        placeholder: 'Optional reason shown to user before wipe',
      },
    ],
  },
  {
    value: 'DELETE',
    label: 'Delete Device',
    description: 'Remove the device from AMAPI (triggering a remote wipe attempt) and soft-delete it from Flash.',
    danger: true,
    bulkOnly: true,
  },
];

export default function CommandModal({
  open,
  onClose,
  deviceId,
  deviceIds,
  deviceName,
  initialCommand,
  onSuccess,
}: CommandModalProps) {
  const [selectedCommand, setSelectedCommand] = useState<string>(initialCommand ?? '');
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [wipeDataFlags, setWipeDataFlags] = useState<string[]>([]);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Pre-select command when opened via a quick-action button
  const isQuickAction = !!initialCommand;
  const command = COMMANDS.find((c) => c.value === selectedCommand);
  const isBulk = Array.isArray(deviceIds) && deviceIds.length > 0;
  const availableCommands = COMMANDS.filter((c) => isBulk || !c.bulkOnly);
  const targetLabel = isBulk
    ? `${deviceIds.length} selected device${deviceIds.length !== 1 ? 's' : ''}`
    : (deviceName ?? 'Device');

  const mutation = useMutation({
    mutationFn: async () => {
      const commandParams: Record<string, any> = {};
      if (command?.fields) {
        for (const field of command.fields) {
          if (fieldValues[field.key]) {
            commandParams[field.key] = fieldValues[field.key];
          }
        }
      }
      if (selectedCommand === 'WIPE' && wipeDataFlags.length > 0) {
        commandParams.wipeDataFlags = wipeDataFlags;
      }
      if (isBulk) {
        return apiClient.post<{ message: string; job_count?: number }>('/api/devices/bulk', {
          device_ids: deviceIds,
          action: selectedCommand,
          ...(Object.keys(commandParams).length > 0 ? { params: commandParams } : {}),
        });
      }
      if (!deviceId) throw new Error('Device ID is required');
      if (selectedCommand === 'DELETE') throw new Error('DELETE is only supported in bulk mode');
      return apiClient.post<{ message: string }>('/api/devices/command', {
        device_id: deviceId,
        command_type: selectedCommand,
        ...(Object.keys(commandParams).length > 0 ? { params: commandParams } : {}),
      });
    },
    onSuccess: (data) => {
      setSuccessMessage(data.message || (isBulk ? 'Bulk command queued successfully.' : 'Command sent successfully.'));
      onSuccess?.();
      setTimeout(() => {
        handleClose();
      }, 2000);
    },
  });

  const handleClose = () => {
    setSelectedCommand('');
    setFieldValues({});
    setWipeDataFlags([]);
    setSuccessMessage(null);
    mutation.reset();
    onClose();
  };

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  useEffect(() => {
    setFieldValues({});
    setWipeDataFlags([]);
    setSuccessMessage(null);
    mutation.reset();
  }, [selectedCommand]);

  const toggleWipeFlag = (flag: string, checked: boolean) => {
    setWipeDataFlags((prev) => {
      const next = new Set(prev);
      if (checked) next.add(flag);
      else next.delete(flag);
      return Array.from(next);
    });
  };

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 sm:items-center"
      onClick={(e) => {
        if (e.target === overlayRef.current) handleClose();
      }}
    >
      <div className="w-full max-w-lg rounded-xl border border-border bg-surface shadow-xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="border-b border-border px-6 py-4">
          <div className="flex items-center gap-2">
            {isQuickAction && command?.danger ? (
              <AlertTriangle className="h-5 w-5 text-danger" />
            ) : (
              <Terminal className="h-5 w-5 text-muted" />
            )}
            <h2 className="text-base font-semibold text-gray-900">
              {isQuickAction && command ? command.label : 'Send Command'}
            </h2>
          </div>
          <p className="mt-1 text-sm text-muted">
            Target: <span className="font-medium text-gray-700">{targetLabel}</span>
          </p>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-4 overflow-y-auto min-h-[20rem]">
          {successMessage ? (
            <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3">
              <p className="text-sm font-medium text-green-800">{successMessage}</p>
            </div>
          ) : (
            <>
              {/* Command selector (hidden when opened via quick-action button) */}
              {!isQuickAction && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Command Type
                  </label>
                  <select
                    value={selectedCommand}
                    onChange={(e) => setSelectedCommand(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                  >
                    <option value="">Select a command...</option>
                    {availableCommands.map((cmd) => (
                      <option key={cmd.value} value={cmd.value}>
                        {cmd.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Command description */}
              {command && (
                <div
                  className={clsx(
                    'rounded-lg border px-4 py-3',
                    command.danger
                      ? 'bg-red-50 border-red-200'
                      : 'bg-blue-50 border-blue-200',
                  )}
                >
                  <div className="flex items-start gap-2">
                    {command.danger && (
                      <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                    )}
                    <p
                      className={clsx(
                        'text-sm',
                        command.danger ? 'text-red-800' : 'text-blue-800',
                      )}
                    >
                      {command.description}
                    </p>
                  </div>
                </div>
              )}

              {/* Command-specific fields */}
              {command?.fields?.map((field) => (
                <div key={field.key}>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    {field.label}
                    {field.required && <span className="text-danger ml-0.5">*</span>}
                  </label>
                  {field.type === 'textarea' ? (
                    <textarea
                      value={fieldValues[field.key] || ''}
                      onChange={(e) =>
                        setFieldValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                      }
                      placeholder={field.placeholder}
                      rows={3}
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                    />
                  ) : (
                    <input
                      type="text"
                      value={fieldValues[field.key] || ''}
                      onChange={(e) =>
                        setFieldValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                      }
                      placeholder={field.placeholder}
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                    />
                  )}
                </div>
              ))}

              {selectedCommand === 'WIPE' && (
                <div className="rounded-lg border border-border bg-surface px-3 py-2">
                  <p className="text-sm font-medium text-gray-700">Wipe Options</p>
                  <p className="mt-1 text-xs text-muted">
                    Optional AMAPI `wipeParams.wipeDataFlags` values.
                  </p>
                  <div className="mt-2 space-y-2">
                    {WIPE_DATA_FLAG_OPTIONS.map((opt) => (
                      <label key={opt.value} className="flex items-start gap-3 rounded-md border border-gray-200 bg-white px-3 py-2">
                        <input
                          type="checkbox"
                          checked={wipeDataFlags.includes(opt.value)}
                          onChange={(e) => toggleWipeFlag(opt.value, e.target.checked)}
                          className="mt-0.5 rounded border-gray-300"
                        />
                        <span>
                          <span className="block text-sm font-medium text-gray-700">{opt.label}</span>
                          <span className="block text-xs text-muted">{opt.description}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Error */}
              {mutation.isError && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
                  <p className="text-sm text-red-800">
                    {(mutation.error as Error)?.message || 'Failed to send command.'}
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!successMessage && (
          <div className="border-t border-border px-6 py-4 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={handleClose}
              disabled={mutation.isPending}
              className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => mutation.mutate()}
              disabled={!selectedCommand || mutation.isPending}
              className={clsx(
                'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50',
                command?.danger
                  ? 'bg-danger hover:bg-danger/90'
                  : 'bg-accent hover:bg-accent-light',
              )}
            >
              {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {mutation.isPending
                ? (isBulk ? 'Queueing...' : 'Sending...')
                : isQuickAction && command
                  ? `${isBulk ? 'Queue' : 'Send'} ${command.label}`
                  : (isBulk ? 'Queue Command' : 'Send Command')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
