import { useState, useEffect, useRef, useEffectEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/api/client';
import { useContextStore } from '@/stores/context';
import { Loader2, Copy, Check, Plus } from 'lucide-react';
import EnrollmentQrPreview from './EnrollmentQrPreview';

export interface TokenCreatorProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

interface CreatedToken {
  token?: string;
  qr_data?: string;
  enrollment_token?: {
    value?: string;
    qrCode?: string;
    name?: string;
  };
}

type WifiSecurityType = 'WPA' | 'WEP' | 'NONE';

interface ProvisioningExtrasForm {
  locale: string;
  timeZone: string;
  wifiSsid: string;
  wifiPassword: string;
  wifiSecurityType: WifiSecurityType;
  wifiHidden: boolean;
  skipEncryption: boolean;
  skipEducationScreens: boolean;
  leaveAllSystemAppsEnabled: boolean;
}

const DEFAULT_PROVISIONING_EXTRAS: ProvisioningExtrasForm = {
  locale: '',
  timeZone: '',
  wifiSsid: '',
  wifiPassword: '',
  wifiSecurityType: 'WPA',
  wifiHidden: false,
  skipEncryption: false,
  skipEducationScreens: false,
  leaveAllSystemAppsEnabled: false,
};

const NO_GROUP_VALUE = '__NO_GROUP__';

function applyProvisioningExtrasToQrPayload(
  rawQrData: string,
  extras: ProvisioningExtrasForm
): string {
  if (!rawQrData) return rawQrData;

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawQrData);
  } catch {
    return rawQrData;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return rawQrData;

  const payload = { ...(parsed as Record<string, unknown>) };
  const locale = extras.locale.trim();
  const timeZone = extras.timeZone.trim();
  const wifiSsid = extras.wifiSsid.trim();
  const wifiPassword = extras.wifiPassword.trim();

  if (locale) payload['android.app.extra.PROVISIONING_LOCALE'] = locale;
  if (timeZone) payload['android.app.extra.PROVISIONING_TIME_ZONE'] = timeZone;

  if (wifiSsid) {
    payload['android.app.extra.PROVISIONING_WIFI_SSID'] = wifiSsid;
    payload['android.app.extra.PROVISIONING_WIFI_SECURITY_TYPE'] = extras.wifiSecurityType;
    payload['android.app.extra.PROVISIONING_WIFI_HIDDEN'] = extras.wifiHidden;
    if (extras.wifiSecurityType !== 'NONE' && wifiPassword) {
      payload['android.app.extra.PROVISIONING_WIFI_PASSWORD'] = wifiPassword;
    } else {
      delete payload['android.app.extra.PROVISIONING_WIFI_PASSWORD'];
    }
  }

  if (extras.skipEncryption) {
    payload['android.app.extra.PROVISIONING_SKIP_ENCRYPTION'] = true;
  }
  if (extras.skipEducationScreens) {
    payload['android.app.extra.PROVISIONING_SKIP_EDUCATION_SCREENS'] = true;
  }
  if (extras.leaveAllSystemAppsEnabled) {
    payload['android.app.extra.PROVISIONING_LEAVE_ALL_SYSTEM_APPS_ENABLED'] = true;
  }

  return JSON.stringify(payload);
}

export default function TokenCreator({ open, onClose, onCreated }: TokenCreatorProps) {
  const { activeEnvironment, groups } = useContextStore();
  const overlayRef = useRef<HTMLDivElement>(null);

  // Default to the highest (shallowest) group the user has access to
  const defaultGroupId = groups.length > 0
    ? [...groups].sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0))[0].id
    : '';

  const [name, setName] = useState('');
  const [groupId, setGroupId] = useState<string | null>(null);
  const [oneTimeUse, setOneTimeUse] = useState(false);
  const [personalUsage, setPersonalUsage] = useState('PERSONAL_USAGE_UNSPECIFIED');
  const [expiryDays, setExpiryDays] = useState('30');
  const [provisioningExtras, setProvisioningExtras] = useState<ProvisioningExtrasForm>(
    DEFAULT_PROVISIONING_EXTRAS
  );
  const [createdToken, setCreatedToken] = useState<CreatedToken | null>(null);
  const [copied, setCopied] = useState(false);

  const effectiveGroupId = groupId === null ? defaultGroupId : groupId;

  const mutation = useMutation({
    mutationFn: async () => {
      return apiClient.post<CreatedToken>('/api/enrolment/create', {
        environment_id: activeEnvironment?.id,
        name: name.trim() || undefined,
        group_id: effectiveGroupId || undefined,
        one_time_use: oneTimeUse,
        allow_personal_usage: personalUsage,
        expiry_days: Number(expiryDays) || 30,
        provisioning_extras: provisioningExtras,
      });
    },
    onSuccess: (data) => {
      setCreatedToken(data);
      onCreated();
    },
  });

  const handleClose = () => {
    setName('');
    setGroupId(null);
    setOneTimeUse(false);
    setPersonalUsage('PERSONAL_USAGE_UNSPECIFIED');
    setExpiryDays('30');
    setProvisioningExtras(DEFAULT_PROVISIONING_EXTRAS);
    setCreatedToken(null);
    setCopied(false);
    mutation.reset();
    onClose();
  };

  const handleCopyToken = () => {
    const tokenValue =
      createdToken?.token ||
      createdToken?.enrollment_token?.value ||
      createdToken?.qr_data ||
      '';
    navigator.clipboard.writeText(tokenValue).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleEscapeClose = useEffectEvent(() => {
    handleClose();
  });

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleEscapeClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  if (!open) return null;

  const tokenValue =
    createdToken?.token ||
    createdToken?.enrollment_token?.value ||
    '';
  const qrData =
    createdToken?.qr_data ||
    createdToken?.enrollment_token?.qrCode ||
    '';
  const effectiveQrData = applyProvisioningExtrasToQrPayload(qrData, provisioningExtras);

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === overlayRef.current) handleClose();
      }}
    >
      <div className="w-full max-w-lg rounded-xl border border-border bg-surface shadow-xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="border-b border-border px-6 py-4">
          <div className="flex items-center gap-2">
            <Plus className="h-5 w-5 text-muted" />
            <h2 className="text-base font-semibold text-gray-900">
              {createdToken ? 'Token Created' : 'Create Enrolment Token'}
            </h2>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-4">
          {createdToken ? (
            <>
              <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3">
                <p className="text-sm font-medium text-green-800">
                  Enrolment token created successfully.
                </p>
              </div>

              {tokenValue && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Token Value
                  </label>
                  <div className="flex items-start gap-2">
                    <div className="flex-1 rounded-lg border border-border bg-surface-secondary px-3 py-2 font-mono text-xs break-all max-h-32 overflow-y-auto">
                      {tokenValue}
                    </div>
                    <button
                      type="button"
                      onClick={handleCopyToken}
                      className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      {copied ? (
                        <Check className="h-3.5 w-3.5 text-green-600" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              )}

              {qrData && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    QR Code
                  </label>
                  <div className="flex justify-center rounded-lg border border-border bg-surface-secondary p-3">
                    <EnrollmentQrPreview value={effectiveQrData} size={240} />
                  </div>
                  <details className="mt-2 rounded-lg border border-border bg-surface-secondary px-3 py-2">
                    <summary className="cursor-pointer text-xs font-medium text-gray-700">
                      Show QR payload
                    </summary>
                    <div className="mt-2 font-mono text-xs break-all max-h-48 overflow-y-auto">
                      {effectiveQrData}
                    </div>
                  </details>
                </div>
              )}
            </>
          ) : (
            <>
              {/* Token name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Token Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Warehouse tablets"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                />
              </div>

              {/* Group */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Group
                </label>
                <select
                  value={effectiveGroupId || NO_GROUP_VALUE}
                  onChange={(e) =>
                    setGroupId(e.target.value === NO_GROUP_VALUE ? '' : e.target.value)
                  }
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                >
                  <option value={NO_GROUP_VALUE}>No group (environment default)</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-muted">
                  The effective policy for this group will be applied on enrolment.
                </p>
              </div>

              {/* One-time use toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-700">One-Time Use</p>
                  <p className="text-xs text-muted">Token can only be used for a single enrolment.</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={oneTimeUse}
                  onClick={() => setOneTimeUse(!oneTimeUse)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                    oneTimeUse ? 'bg-accent' : 'bg-gray-200'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform ${
                      oneTimeUse ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Personal usage */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Personal Usage
                </label>
                <select
                  value={personalUsage}
                  onChange={(e) => setPersonalUsage(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                >
                  <option value="PERSONAL_USAGE_UNSPECIFIED">Unspecified</option>
                  <option value="PERSONAL_USAGE_ALLOWED">Allowed</option>
                  <option value="PERSONAL_USAGE_DISALLOWED">Disallowed</option>
                  <option value="PERSONAL_USAGE_DISALLOWED_USERLESS">Dedicated Device (Userless)</option>
                </select>
              </div>

              {/* Expiry */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Expiry (days)
                </label>
                <input
                  type="number"
                  min="1"
                  max="365"
                  value={expiryDays}
                  onChange={(e) => setExpiryDays(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                />
              </div>

              {/* Provisioning extras (QR provisioning payload customisation) */}
              <div className="rounded-lg border border-border bg-surface-secondary/40 p-4 space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">Provisioning Extras</h3>
                  <p className="mt-1 text-xs text-muted">
                    Optional Android provisioning extras injected into the QR payload.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Locale
                    </label>
                    <input
                      type="text"
                      value={provisioningExtras.locale}
                      onChange={(e) =>
                        setProvisioningExtras((prev) => ({ ...prev, locale: e.target.value }))
                      }
                      placeholder="en_GB"
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Time Zone
                    </label>
                    <input
                      type="text"
                      value={provisioningExtras.timeZone}
                      onChange={(e) =>
                        setProvisioningExtras((prev) => ({ ...prev, timeZone: e.target.value }))
                      }
                      placeholder="Europe/London"
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Wi-Fi SSID
                    </label>
                    <input
                      type="text"
                      value={provisioningExtras.wifiSsid}
                      onChange={(e) =>
                        setProvisioningExtras((prev) => ({ ...prev, wifiSsid: e.target.value }))
                      }
                      placeholder="Corp-Setup"
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Wi-Fi Security
                    </label>
                    <select
                      value={provisioningExtras.wifiSecurityType}
                      onChange={(e) =>
                        setProvisioningExtras((prev) => ({
                          ...prev,
                          wifiSecurityType: e.target.value as WifiSecurityType,
                        }))
                      }
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                    >
                      <option value="WPA">WPA / WPA2 / WPA3</option>
                      <option value="WEP">WEP</option>
                      <option value="NONE">Open</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Wi-Fi Password
                    </label>
                    <input
                      type="text"
                      value={provisioningExtras.wifiPassword}
                      onChange={(e) =>
                        setProvisioningExtras((prev) => ({ ...prev, wifiPassword: e.target.value }))
                      }
                      disabled={provisioningExtras.wifiSecurityType === 'NONE'}
                      placeholder={
                        provisioningExtras.wifiSecurityType === 'NONE'
                          ? 'Not required for open network'
                          : 'Network password'
                      }
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-50"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={provisioningExtras.wifiHidden}
                      onChange={(e) =>
                        setProvisioningExtras((prev) => ({ ...prev, wifiHidden: e.target.checked }))
                      }
                      className="rounded border-border text-accent focus:ring-accent/20"
                    />
                    Hidden Wi-Fi network
                  </label>

                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={provisioningExtras.skipEncryption}
                      onChange={(e) =>
                        setProvisioningExtras((prev) => ({
                          ...prev,
                          skipEncryption: e.target.checked,
                        }))
                      }
                      className="rounded border-border text-accent focus:ring-accent/20"
                    />
                    Skip encryption
                  </label>

                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={provisioningExtras.skipEducationScreens}
                      onChange={(e) =>
                        setProvisioningExtras((prev) => ({
                          ...prev,
                          skipEducationScreens: e.target.checked,
                        }))
                      }
                      className="rounded border-border text-accent focus:ring-accent/20"
                    />
                    Skip education screens
                  </label>

                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={provisioningExtras.leaveAllSystemAppsEnabled}
                      onChange={(e) =>
                        setProvisioningExtras((prev) => ({
                          ...prev,
                          leaveAllSystemAppsEnabled: e.target.checked,
                        }))
                      }
                      className="rounded border-border text-accent focus:ring-accent/20"
                    />
                    Leave all system apps enabled
                  </label>
                </div>
              </div>

              {/* Error */}
              {mutation.isError && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
                  <p className="text-sm text-red-800">
                    {(mutation.error as Error)?.message || 'Failed to create token.'}
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border px-6 py-4 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            {createdToken ? 'Close' : 'Cancel'}
          </button>
          {!createdToken && (
            <button
              type="button"
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-light transition-colors disabled:opacity-50"
            >
              {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {mutation.isPending ? 'Creating...' : 'Create Token'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
