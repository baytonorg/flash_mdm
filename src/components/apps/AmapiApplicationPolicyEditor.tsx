import { useState } from 'react';
import clsx from 'clsx';
import EnumField from '@/components/policy/fields/EnumField';
import BooleanField from '@/components/policy/fields/BooleanField';
import NumberField from '@/components/policy/fields/NumberField';
import TextField from '@/components/policy/fields/TextField';
import RepeaterField from '@/components/policy/fields/RepeaterField';
import JsonField from '@/components/policy/fields/JsonField';

type JsonObject = Record<string, unknown>;

interface Props {
  value: JsonObject;
  onChange: (value: JsonObject) => void;
  packageName?: string;
  installType?: string;
  autoUpdateMode?: string;
}

function obj(v: unknown): JsonObject {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as JsonObject) : {};
}

function arr<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function boolOr(v: unknown, fallback = false): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function numOr(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function stringArray(v: unknown): string[] {
  return arr<string>(v).filter((x): x is string => typeof x === 'string');
}

function setKey(value: JsonObject, key: string, next: unknown): JsonObject {
  if (next === undefined) {
    const copy = { ...value };
    delete copy[key];
    return copy;
  }
  return { ...value, [key]: next };
}

function setNestedKey(value: JsonObject, key: string, child: JsonObject | undefined): JsonObject {
  if (!child || Object.keys(child).length === 0) {
    return setKey(value, key, undefined);
  }
  return setKey(value, key, child);
}

function chipClass(active: boolean) {
  return clsx(
    'rounded-md px-2 py-1 text-xs font-medium border transition-colors',
    active ? 'border-accent bg-accent/10 text-accent' : 'border-gray-200 text-gray-500 hover:text-gray-700 hover:border-gray-300'
  );
}

const INSTALL_TYPE_OPTIONS = [
  'INSTALL_TYPE_UNSPECIFIED',
  'PREINSTALLED',
  'FORCE_INSTALLED',
  'BLOCKED',
  'AVAILABLE',
  'REQUIRED_FOR_SETUP',
  'KIOSK',
  'CUSTOM',
].map((v) => ({ value: v, label: v }));

const AUTO_UPDATE_OPTIONS = [
  'AUTO_UPDATE_MODE_UNSPECIFIED',
  'AUTO_UPDATE_DEFAULT',
  'AUTO_UPDATE_POSTPONED',
  'AUTO_UPDATE_HIGH_PRIORITY',
].map((v) => ({ value: v, label: v }));

const DEFAULT_PERMISSION_OPTIONS = [
  'PERMISSION_POLICY_UNSPECIFIED',
  'PROMPT',
  'GRANT',
  'DENY',
].map((v) => ({ value: v, label: v }));

const CONNECTED_WORK_PERSONAL_OPTIONS = [
  'CONNECTED_WORK_AND_PERSONAL_APP_UNSPECIFIED',
  'CONNECTED_WORK_AND_PERSONAL_APP_DISALLOWED',
  'CONNECTED_WORK_AND_PERSONAL_APP_ALLOWED',
].map((v) => ({ value: v, label: v }));

const VPN_LOCKDOWN_EXEMPTION_OPTIONS = [
  'ALWAYS_ON_VPN_LOCKDOWN_EXEMPTION_UNSPECIFIED',
  'VPN_LOCKDOWN_ENFORCED',
  'VPN_LOCKDOWN_EXEMPTION',
].map((v) => ({ value: v, label: v }));

const WORK_PROFILE_WIDGETS_OPTIONS = [
  'WORK_PROFILE_WIDGETS_UNSPECIFIED',
  'WORK_PROFILE_WIDGETS_ALLOWED',
  'WORK_PROFILE_WIDGETS_DISALLOWED',
].map((v) => ({ value: v, label: v }));

const CREDENTIAL_PROVIDER_POLICY_OPTIONS = [
  'CREDENTIAL_PROVIDER_POLICY_UNSPECIFIED',
  'CREDENTIAL_PROVIDER_ALLOWED',
].map((v) => ({ value: v, label: v }));

const USER_CONTROL_SETTINGS_OPTIONS = [
  'USER_CONTROL_SETTINGS_UNSPECIFIED',
  'USER_CONTROL_ALLOWED',
  'USER_CONTROL_DISALLOWED',
].map((v) => ({ value: v, label: v }));

const PREFERENTIAL_NETWORK_ID_OPTIONS = [
  'PREFERENTIAL_NETWORK_ID_UNSPECIFIED',
  'NO_PREFERENTIAL_NETWORK',
  'PREFERENTIAL_NETWORK_ID_ONE',
  'PREFERENTIAL_NETWORK_ID_TWO',
  'PREFERENTIAL_NETWORK_ID_THREE',
  'PREFERENTIAL_NETWORK_ID_FOUR',
  'PREFERENTIAL_NETWORK_ID_FIVE',
].map((v) => ({ value: v, label: v }));

const ROLE_TYPE_OPTIONS = [
  'ROLE_TYPE_UNSPECIFIED',
  'COMPANION_APP',
  'KIOSK',
  'MOBILE_THREAT_DEFENSE_ENDPOINT_DETECTION_RESPONSE',
  'SYSTEM_HEALTH_MONITORING',
].map((v) => ({ value: v, label: v }));
const ROLE_TYPE_MULTISELECT_OPTIONS = ROLE_TYPE_OPTIONS.filter((o) => o.value !== 'ROLE_TYPE_UNSPECIFIED');

const PERMISSION_GRANT_POLICY_OPTIONS = DEFAULT_PERMISSION_OPTIONS;

const INSTALL_CONSTRAINT_NETWORK_OPTIONS = [
  'NETWORK_TYPE_CONSTRAINT_UNSPECIFIED',
  'INSTALL_ON_ANY_NETWORK',
  'INSTALL_ONLY_ON_UNMETERED_NETWORK',
].map((v) => ({ value: v, label: v }));

const INSTALL_CONSTRAINT_CHARGING_OPTIONS = [
  'CHARGING_CONSTRAINT_UNSPECIFIED',
  'CHARGING_NOT_REQUIRED',
  'INSTALL_ONLY_WHEN_CHARGING',
].map((v) => ({ value: v, label: v }));

const INSTALL_CONSTRAINT_IDLE_OPTIONS = [
  'DEVICE_IDLE_CONSTRAINT_UNSPECIFIED',
  'DEVICE_IDLE_NOT_REQUIRED',
  'INSTALL_ONLY_WHEN_DEVICE_IDLE',
].map((v) => ({ value: v, label: v }));

const CUSTOM_APP_UNINSTALL_OPTIONS = [
  'USER_UNINSTALL_SETTINGS_UNSPECIFIED',
  'DISALLOW_UNINSTALL_BY_USER',
  'ALLOW_UNINSTALL_BY_USER',
].map((v) => ({ value: v, label: v }));

const DELEGATED_SCOPE_OPTIONS = [
  'DELEGATED_SCOPE_UNSPECIFIED',
  'CERT_INSTALL',
  'MANAGED_CONFIGURATIONS',
  'BLOCK_UNINSTALL',
  'PERMISSION_GRANT',
  'PACKAGE_ACCESS',
  'ENABLE_SYSTEM_APP',
  'NETWORK_ACTIVITY_LOGS',
  'SECURITY_LOGS',
  'CERT_SELECTION',
].map((v) => ({ value: v, label: v }));

export default function AmapiApplicationPolicyEditor({
  value,
  onChange,
  packageName,
  installType,
  autoUpdateMode,
}: Props) {
  const [mode, setMode] = useState<'form' | 'json'>('form');

  const permissionGrants = arr<JsonObject>(value.permissionGrants);
  const roleValues = arr<JsonObject>(value.roles)
    .map((r) => str(r.roleType))
    .filter(Boolean);
  const signingKeyCerts = arr<JsonObject>(value.signingKeyCerts);
  const installConstraint = arr<JsonObject>(value.installConstraint);
  const customAppConfig = obj(value.customAppConfig);
  const effectiveInstallType = (installType ?? str(value.installType)) || '';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 rounded-lg border border-gray-200 bg-gray-50 p-1">
        {(['form', 'json'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setMode(tab)}
            className={clsx(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              mode === tab ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
            )}
          >
            {tab === 'form' ? 'Form' : 'JSON'}
          </button>
        ))}
      </div>

      {mode === 'json' ? (
        <JsonField
          label="AMAPI Application Policy (JSON)"
          description="This maps to an AMAPI `applications[]` entry fragment for the selected app/scope. `packageName`, `installType`, `autoUpdateMode`, and `managedConfiguration` are set in the other controls."
          value={value}
          onChange={(next) => onChange((next ?? {}) as JsonObject)}
          kind="object"
          rows={18}
        />
      ) : (
        <div className="space-y-5">
          <div className="rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-gray-900">Application Policy Fields</h4>
              <button type="button" onClick={() => onChange({})} className="text-xs text-gray-500 hover:text-red-600">
                Clear all AMAPI app policy fields
              </button>
            </div>

            <EnumField
              label="Default Permission Policy"
              value={str(value.defaultPermissionPolicy) || 'PERMISSION_POLICY_UNSPECIFIED'}
              onChange={(v) => onChange(setKey(value, 'defaultPermissionPolicy', v))}
              options={DEFAULT_PERMISSION_OPTIONS}
            />

            <EnumField
              label="Connected Work and Personal App"
              value={str(value.connectedWorkAndPersonalApp) || 'CONNECTED_WORK_AND_PERSONAL_APP_UNSPECIFIED'}
              onChange={(v) => onChange(setKey(value, 'connectedWorkAndPersonalApp', v))}
              options={CONNECTED_WORK_PERSONAL_OPTIONS}
            />

            <EnumField
              label="Always-on VPN Lockdown Exemption"
              value={str(value.alwaysOnVpnLockdownExemption) || 'ALWAYS_ON_VPN_LOCKDOWN_EXEMPTION_UNSPECIFIED'}
              onChange={(v) => onChange(setKey(value, 'alwaysOnVpnLockdownExemption', v))}
              options={VPN_LOCKDOWN_EXEMPTION_OPTIONS}
            />

            <EnumField
              label="Work Profile Widgets"
              value={str(value.workProfileWidgets) || 'WORK_PROFILE_WIDGETS_UNSPECIFIED'}
              onChange={(v) => onChange(setKey(value, 'workProfileWidgets', v))}
              options={WORK_PROFILE_WIDGETS_OPTIONS}
            />

            <EnumField
              label="Credential Provider Policy"
              value={str(value.credentialProviderPolicy) || 'CREDENTIAL_PROVIDER_POLICY_UNSPECIFIED'}
              onChange={(v) => onChange(setKey(value, 'credentialProviderPolicy', v))}
              options={CREDENTIAL_PROVIDER_POLICY_OPTIONS}
            />

            <EnumField
              label="User Control Settings"
              value={str(value.userControlSettings) || 'USER_CONTROL_SETTINGS_UNSPECIFIED'}
              onChange={(v) => onChange(setKey(value, 'userControlSettings', v))}
              options={USER_CONTROL_SETTINGS_OPTIONS}
            />

            <EnumField
              label="Preferential Network ID"
              value={str(value.preferentialNetworkId) || 'PREFERENTIAL_NETWORK_ID_UNSPECIFIED'}
              onChange={(v) => onChange(setKey(value, 'preferentialNetworkId', v))}
              options={PREFERENTIAL_NETWORK_ID_OPTIONS}
            />

            <BooleanField
              label="Disabled"
              description="Set AMAPI `applications[].disabled`."
              value={boolOr(value.disabled, false)}
              onChange={(v) => onChange(setKey(value, 'disabled', v))}
            />

            <BooleanField
              label="Lock Task Allowed"
              value={boolOr(value.lockTaskAllowed, false)}
              onChange={(v) => onChange(setKey(value, 'lockTaskAllowed', v))}
            />

            <NumberField
              label="Minimum Version Code"
              value={numOr(value.minimumVersionCode, 0)}
              onChange={(v) => onChange(setKey(value, 'minimumVersionCode', v))}
              min={0}
            />

            <NumberField
              label="Install Priority"
              value={numOr(value.installPriority, 0)}
              onChange={(v) => onChange(setKey(value, 'installPriority', v))}
              min={0}
              max={10000}
            />
          </div>

          <div className="rounded-lg border border-gray-200 p-4">
            <h4 className="text-sm font-semibold text-gray-900 mb-2">Tracks & Delegation</h4>

            <RepeaterField
              label="Accessible Track IDs"
              description="AMAPI `accessibleTrackIds`."
              value={stringArray(value.accessibleTrackIds)}
              onChange={(next) => onChange(setKey(value, 'accessibleTrackIds', next))}
              defaultItem=""
              renderItem={(item, _idx, onItemChange) => (
                <TextField label="Track ID" value={typeof item === 'string' ? item : ''} onChange={onItemChange} placeholder="production" />
              )}
            />

            <RepeaterField
              label="Delegated Scopes"
              description="AMAPI delegated scopes."
              value={stringArray(value.delegatedScopes)}
              onChange={(next) => onChange(setKey(value, 'delegatedScopes', next))}
              defaultItem="DELEGATED_SCOPE_UNSPECIFIED"
              renderItem={(item, _idx, onItemChange) => (
                <EnumField
                  label="Delegated Scope"
                  value={str(item) || 'DELEGATED_SCOPE_UNSPECIFIED'}
                  onChange={onItemChange}
                  options={DELEGATED_SCOPE_OPTIONS}
                />
              )}
            />
          </div>

          <div className="rounded-lg border border-gray-200 p-4">
            <h4 className="text-sm font-semibold text-gray-900 mb-2">Permission Grants</h4>
            <RepeaterField
              label="permissionGrants"
              value={permissionGrants}
              onChange={(next) => onChange(setKey(value, 'permissionGrants', next))}
              defaultItem={{ permission: '', policy: 'PERMISSION_POLICY_UNSPECIFIED' }}
              renderItem={(item, _idx, onItemChange) => (
                <div className="space-y-2">
                  <TextField
                    label="Permission"
                    value={str(item.permission)}
                    onChange={(v) => onItemChange({ ...item, permission: v })}
                    placeholder="android.permission.CAMERA"
                  />
                  <EnumField
                    label="Policy"
                    value={str(item.policy) || 'PERMISSION_POLICY_UNSPECIFIED'}
                    onChange={(v) => onItemChange({ ...item, policy: v })}
                    options={PERMISSION_GRANT_POLICY_OPTIONS}
                  />
                </div>
              )}
            />
          </div>

          <div className="rounded-lg border border-gray-200 p-4">
            <h4 className="text-sm font-semibold text-gray-900 mb-2">Install Constraint (max 1)</h4>
            <RepeaterField
              label="installConstraint"
              value={installConstraint}
              onChange={(next) => onChange(setKey(value, 'installConstraint', next))}
              defaultItem={{
                networkTypeConstraint: 'NETWORK_TYPE_CONSTRAINT_UNSPECIFIED',
                chargingConstraint: 'CHARGING_CONSTRAINT_UNSPECIFIED',
                deviceIdleConstraint: 'DEVICE_IDLE_CONSTRAINT_UNSPECIFIED',
              }}
              maxItems={1}
              renderItem={(item, _idx, onItemChange) => (
                <div className="space-y-2">
                  <EnumField
                    label="Network Type Constraint"
                    value={str(item.networkTypeConstraint) || 'NETWORK_TYPE_CONSTRAINT_UNSPECIFIED'}
                    onChange={(v) => onItemChange({ ...item, networkTypeConstraint: v })}
                    options={INSTALL_CONSTRAINT_NETWORK_OPTIONS}
                  />
                  <EnumField
                    label="Charging Constraint"
                    value={str(item.chargingConstraint) || 'CHARGING_CONSTRAINT_UNSPECIFIED'}
                    onChange={(v) => onItemChange({ ...item, chargingConstraint: v })}
                    options={INSTALL_CONSTRAINT_CHARGING_OPTIONS}
                  />
                  <EnumField
                    label="Device Idle Constraint"
                    value={str(item.deviceIdleConstraint) || 'DEVICE_IDLE_CONSTRAINT_UNSPECIFIED'}
                    onChange={(v) => onItemChange({ ...item, deviceIdleConstraint: v })}
                    options={INSTALL_CONSTRAINT_IDLE_OPTIONS}
                  />
                </div>
              )}
            />
          </div>

          <div className="rounded-lg border border-gray-200 p-4">
            <h4 className="text-sm font-semibold text-gray-900 mb-2">Roles</h4>
            <p className="text-xs text-gray-500 mb-3">Select one or more AMAPI app roles.</p>
            <div className="grid grid-cols-1 gap-2">
              {ROLE_TYPE_MULTISELECT_OPTIONS.map((opt) => {
                const checked = roleValues.includes(opt.value);
                return (
                  <label
                    key={opt.value}
                    className={clsx(
                      'flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors',
                      checked ? 'border-accent bg-accent/5' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...new Set([...roleValues, opt.value])]
                          : roleValues.filter((v) => v !== opt.value);
                        onChange(setKey(value, 'roles', next.map((roleType) => ({ roleType }))));
                      }}
                      className="h-4 w-4 rounded border-gray-300 text-accent focus:ring-accent/30"
                    />
                    <span className="text-sm font-medium text-gray-900">{opt.label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 p-4">
            <h4 className="text-sm font-semibold text-gray-900 mb-2">Signing Keys</h4>
            <RepeaterField
              label="signingKeyCerts"
              value={signingKeyCerts}
              onChange={(next) => onChange(setKey(value, 'signingKeyCerts', next))}
              defaultItem={{ signingKeyCertFingerprintSha256: '' }}
              renderItem={(item, _idx, onItemChange) => (
                <TextField
                  label="SHA-256 Fingerprint"
                  value={str(item.signingKeyCertFingerprintSha256)}
                  onChange={(v) => onItemChange({ ...item, signingKeyCertFingerprintSha256: v })}
                  placeholder="64-char hex fingerprint"
                />
              )}
            />
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4">
            <h4 className="text-sm font-semibold text-amber-900 mb-1">Deprecated field note</h4>
            <p className="text-xs text-amber-800">
              `extensionConfig` is deprecated and intentionally hidden in Form mode. Use the JSON tab only when maintaining legacy policies.
            </p>
          </div>

          {effectiveInstallType === 'CUSTOM' && (
            <div className="rounded-lg border border-gray-200 p-4">
              <h4 className="text-sm font-semibold text-gray-900 mb-2">Custom App Configuration</h4>
              <p className="text-xs text-gray-500 mb-3">
                Shown only for `installType=CUSTOM`.
              </p>
              <div className="mb-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={chipClass(!!value.customAppConfig)}
                  onClick={() => onChange(setKey(value, 'customAppConfig', value.customAppConfig ? undefined : {}))}
                >
                  {value.customAppConfig ? 'Disable customAppConfig' : 'Enable customAppConfig'}
                </button>
              </div>
              {!!value.customAppConfig && (
                <EnumField
                  label="User Uninstall Settings"
                  value={str(customAppConfig.userUninstallSettings) || 'USER_UNINSTALL_SETTINGS_UNSPECIFIED'}
                  onChange={(v) => onChange(setNestedKey(value, 'customAppConfig', { ...customAppConfig, userUninstallSettings: v }))}
                  options={CUSTOM_APP_UNINSTALL_OPTIONS}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
