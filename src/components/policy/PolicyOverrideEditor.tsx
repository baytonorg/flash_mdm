import { useState, useMemo, useCallback } from 'react';
import { Lock, RotateCcw, ChevronDown, ChevronRight, AlertTriangle, Shield } from 'lucide-react';
import {
  usePolicyOverride,
  useSavePolicyOverride,
  useResetPolicyOverride,
} from '@/api/queries/policy-overrides';
import { usePolicy, usePolicyAssignments } from '@/api/queries/policies';
import LockControls from '@/components/policy/LockControls';
import PolicyFormSection from '@/components/policy/PolicyFormSection';

/**
 * AMAPI top-level config sections with human-readable labels.
 * These are the keys that can be individually overridden or locked.
 */
const AMAPI_SECTIONS: Record<string, string> = {
  applications: 'Applications',
  passwordPolicies: 'Password Policies',
  passwordRequirements: 'Password Requirements (Legacy)',
  permissionGrants: 'Permission Grants',
  statusReportingSettings: 'Status Reporting',
  usageLog: 'Usage Log',
  keyguardDisabledFeatures: 'Keyguard Features',
  persistentPreferredActivities: 'Default Activities',
  setupActions: 'Setup Actions',
  policyEnforcementRules: 'Enforcement Rules',
  kioskCustomization: 'Kiosk Customisation',
  kioskCustomLauncherEnabled: 'Kiosk Launcher',
  advancedSecurityOverrides: 'Advanced Security',
  personalUsagePolicies: 'Personal Usage',
  crossProfilePolicies: 'Cross Profile',
  openNetworkConfiguration: 'Network Config',
  deviceConnectivityManagement: 'Connectivity',
  deviceRadioState: 'Radio State',
  privateDnsSettings: 'Private DNS',
  recommendedGlobalProxy: 'Global Proxy',
  wifiConfigsLockdownEnabled: 'WiFi Lockdown',
  bluetoothConfigDisabled: 'Bluetooth',
  cellBroadcastsConfigAccess: 'Cell Broadcast',
  credentialProviderPolicyDefault: 'Credential Provider',
  printingPolicy: 'Printing',
  displaySettings: 'Display Settings',
  screenCaptureDisabled: 'Screen Capture',
  cameraDisabled: 'Camera',
  cameraAccess: 'Camera Access',
  microphoneAccess: 'Microphone',
  locationMode: 'Location',
  shareLocationDisabled: 'Share Location',
  outgoingCallsDisabled: 'Outgoing Calls',
  smsDisabled: 'SMS',
  factoryResetDisabled: 'Factory Reset',
  addUserDisabled: 'Add User',
  mountPhysicalMediaDisabled: 'Physical Media',
  usbFileTransferDisabled: 'USB Transfer',
  usbDataAccess: 'USB Data Access',
  vpnConfigDisabled: 'VPN Config',
  systemUpdate: 'System Update',
  minimumApiLevel: 'Minimum API Level',
  deviceOwnerLockScreenInfo: 'Lock Screen Info',
  shortSupportMessage: 'Short Support Message',
  longSupportMessage: 'Long Support Message',
  defaultApplicationSettings: 'Default App Settings',
  privateKeySelectionEnabled: 'Private Key Selection',
  choosePrivateKeyRules: 'Private Key Rules',
  frpAdminEmails: 'FRP Admin Emails',
  wipeDataFlags: 'Wipe Data Flags',
  encryptionPolicy: 'Encryption',
  funDisabled: 'Fun Disabled',
  workAccountSetupConfig: 'Work Account Setup',
};

/**
 * Complete mapping of AMAPI top-level keys to PolicyFormSection category IDs.
 * Every key handled by PolicyFormSection is listed here so category-based
 * rendering covers all fields via form components (no JSON fallback).
 */
const AMAPI_KEY_TO_FORM_CATEGORY: Record<string, string> = {
  // password
  passwordPolicies: 'password',
  passwordRequirements: 'password',

  // screenLock
  maximumTimeToLock: 'screenLock',
  keyguardDisabled: 'screenLock',
  stayOnPluggedModes: 'screenLock',
  deviceOwnerLockScreenInfo: 'screenLock',
  displaySettings: 'screenLock',
  keyguardDisabledFeatures: 'screenLock',

  // deviceSettings
  screenCaptureDisabled: 'deviceSettings',
  factoryResetDisabled: 'deviceSettings',
  addUserDisabled: 'deviceSettings',
  removeUserDisabled: 'deviceSettings',
  modifyAccountsDisabled: 'deviceSettings',
  bluetoothDisabled: 'deviceSettings',
  bluetoothConfigDisabled: 'deviceSettings',
  bluetoothContactSharingDisabled: 'deviceSettings',
  mountPhysicalMediaDisabled: 'deviceSettings',
  credentialsConfigDisabled: 'deviceSettings',
  createWindowsDisabled: 'deviceSettings',
  setUserIconDisabled: 'deviceSettings',
  outgoingBeamDisabled: 'deviceSettings',

  // network
  openNetworkConfiguration: 'network',
  deviceConnectivityManagement: 'network',
  cellBroadcastsConfigDisabled: 'network',
  mobileNetworksConfigDisabled: 'network',
  vpnConfigDisabled: 'network',
  alwaysOnVpnPackage: 'network',
  preferentialNetworkService: 'network',
  networkEscapeHatchEnabled: 'network',
  autoDateAndTimeZone: 'network',
  wifiConfigsLockdownEnabled: 'network',
  cellBroadcastsConfigAccess: 'network',
  deviceRadioState: 'network',
  privateDnsSettings: 'network',
  recommendedGlobalProxy: 'network',

  // applications
  installAppsDisabled: 'applications',
  uninstallAppsDisabled: 'applications',
  playStoreMode: 'applications',
  appAutoUpdatePolicy: 'applications',
  appFunctions: 'applications',
  applications: 'applications',
  defaultApplicationSettings: 'applications',

  // security
  encryptionPolicy: 'security',
  cameraAccess: 'deviceSettings',
  cameraDisabled: 'security',
  microphoneAccess: 'deviceSettings',
  funDisabled: 'deviceSettings',
  advancedSecurityOverrides: 'security',
  usbDataAccess: 'security',
  usbFileTransferDisabled: 'security',
  privateKeySelectionEnabled: 'security',
  choosePrivateKeyRules: 'security',
  credentialProviderPolicyDefault: 'security',
  minimumApiLevel: 'security',
  frpAdminEmails: 'security',
  wipeDataFlags: 'security',

  // systemUpdates
  systemUpdate: 'systemUpdates',

  // permissions
  defaultPermissionPolicy: 'permissions',
  permissionGrants: 'permissions',
  permittedAccessibilityServices: 'permissions',
  permittedInputMethods: 'permissions',

  // statusReporting
  statusReportingSettings: 'statusReporting',
  usageLog: 'statusReporting',

  // personalUsage
  personalUsagePolicies: 'personalUsage',

  // kioskMode
  kioskCustomLauncherEnabled: 'kioskMode',
  kioskCustomization: 'kioskMode',

  // complianceRules
  policyEnforcementRules: 'complianceRules',

  // crossProfile
  crossProfilePolicies: 'crossProfile',

  // location
  locationMode: 'location',
  shareLocationDisabled: 'location',

  // advanced
  skipFirstUseHintsEnabled: 'deviceSettings',
  adjustVolumeDisabled: 'deviceSettings',
  setWallpaperDisabled: 'deviceSettings',
  outgoingCallsDisabled: 'deviceSettings',
  smsDisabled: 'deviceSettings',
  networkResetDisabled: 'network',
  dataRoamingDisabled: 'network',
  enterpriseDisplayNameVisibility: 'advanced',
  printingPolicy: 'deviceSettings',
  assistContentPolicy: 'deviceSettings',
  accountTypesWithManagementDisabled: 'security',
  persistentPreferredActivities: 'advanced',
  setupActions: 'advanced',
  workAccountSetupConfig: 'advanced',
  shortSupportMessage: 'complianceRules',
  longSupportMessage: 'complianceRules',
};

/**
 * Category definitions in canonical display order (mirrors PolicyCategoryNav).
 */
const CATEGORY_ORDER: Array<{ id: string; label: string }> = [
  { id: 'password', label: 'Password Requirements' },
  { id: 'screenLock', label: 'Screen Lock' },
  { id: 'applications', label: 'Applications' },
  { id: 'network', label: 'Network' },
  { id: 'deviceSettings', label: 'Device Settings' },
  { id: 'security', label: 'Security' },
  { id: 'systemUpdates', label: 'System Updates' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'statusReporting', label: 'Status Reporting' },
  { id: 'personalUsage', label: 'Personal Usage' },
  { id: 'kioskMode', label: 'Kiosk Mode' },
  { id: 'complianceRules', label: 'Compliance Rules' },
  { id: 'crossProfile', label: 'Cross-Profile' },
  { id: 'location', label: 'Location' },
  { id: 'advanced', label: 'Advanced' },
];

/**
 * Adapter: renders the full PolicyFormSection for a category, routing changes
 * back as individual AMAPI key overrides.
 */
function CategoryFormAdapter({
  category,
  baseConfig,
  currentOverrides,
  onKeyChange,
}: {
  category: string;
  baseConfig: Record<string, unknown>;
  currentOverrides: Record<string, unknown>;
  onKeyChange: (amapiKey: string, newValue: unknown) => void;
}) {
  // Merged config: overrides take precedence over base
  const syntheticConfig = useMemo(
    () => ({ ...baseConfig, ...currentOverrides }),
    [baseConfig, currentOverrides],
  );

  // PolicyFormSection calls onChange(path, newFieldValue) where path is like
  // 'passwordPolicies.0.passwordMinimumLength'. We route this back by extracting
  // the top-level AMAPI key, deep-setting the nested value, and calling onKeyChange.
  const handleFormChange = useCallback(
    (path: string, fieldValue: unknown) => {
      const parts = path.split('.');
      const topKey = parts[0];

      if (parts.length === 1) {
        // Direct AMAPI key assignment (e.g. onChange('screenCaptureDisabled', true))
        onKeyChange(topKey, fieldValue);
      } else {
        // Nested path — apply to existing value
        const existingValue = currentOverrides[topKey] ?? baseConfig[topKey] ?? {};
        const updated = JSON.parse(JSON.stringify(existingValue));
        setDeep(updated, parts.slice(1), fieldValue);
        onKeyChange(topKey, updated);
      }
    },
    [currentOverrides, baseConfig, onKeyChange],
  );

  return (
    <PolicyFormSection
      category={category}
      config={syntheticConfig}
      onChange={handleFormChange}
    />
  );
}

/** Deep-set a value at a path within an object. */
function setDeep(obj: any, parts: string[], value: unknown): void {
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    const nextKey = parts[i + 1];
    const isArrayIndex = /^\d+$/.test(nextKey);
    if (current[key] === undefined || current[key] === null) {
      current[key] = isArrayIndex ? [] : {};
    }
    current = current[key];
  }
  const lastKey = parts[parts.length - 1];
  current[lastKey] = value;
}

interface PolicyOverrideEditorProps {
  policyId: string;
  scopeType: 'group' | 'device';
  scopeId: string;
  environmentId: string;
  onClose?: () => void;
}

export default function PolicyOverrideEditor({
  policyId,
  scopeType,
  scopeId,
  environmentId,
  onClose: _onClose,
}: PolicyOverrideEditorProps) {
  const { data: overrideData, isLoading } = usePolicyOverride(policyId, scopeType, scopeId);
  const { data: policyData } = usePolicy(policyId);
  const { data: assignments } = usePolicyAssignments(environmentId);
  const saveMutation = useSavePolicyOverride();
  const resetMutation = useResetPolicyOverride();

  const [localOverrides, setLocalOverrides] = useState<Record<string, unknown> | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [showLockPanel, setShowLockPanel] = useState(false);

  // Use local state if user has made changes, otherwise use server state
  const currentOverrides = localOverrides ?? overrideData?.override_config ?? {};
  const lockState = overrideData?.lock_state;
  const lockedSections = lockState?.locked_sections ?? [];
  const baseConfig = (
    overrideData?.effective_base_config
    ?? policyData?.policy?.config
    ?? {}
  ) as Record<string, unknown>;

  // Find assignment record for this scope to get current lock state
  const currentAssignment = useMemo(() => {
    return assignments?.find(
      (a) => a.policy_id === policyId && a.scope_type === scopeType && a.scope_id === scopeId
    );
  }, [assignments, policyId, scopeType, scopeId]);

  // Build per-category data: which keys are overridden, configured, locked
  const availableCategories = useMemo(() => {
    // Collect every AMAPI key across base config, overrides, and known sections
    const allKeys = new Set([
      ...Object.keys(AMAPI_SECTIONS),
      ...Object.keys(baseConfig),
      ...Object.keys(currentOverrides),
    ]);

    // Group keys by category
    const byCategory = new Map<string, string[]>();
    for (const key of allKeys) {
      if (key.startsWith('_') || key === 'name' || key === 'version') continue;
      const cat = AMAPI_KEY_TO_FORM_CATEGORY[key];
      if (!cat) continue; // skip unmapped keys
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(key);
    }

    return CATEGORY_ORDER
      .filter(({ id }) => byCategory.has(id))
      .map(({ id, label }) => {
        const keys = byCategory.get(id)!;
        const overriddenKeys = keys.filter((k) => k in currentOverrides);
        const lockedKeys = keys.filter(
          (k) => lockState?.fully_locked || lockedSections.includes(k)
        );
        const configuredKeys = keys.filter((k) => k in baseConfig);
        return {
          id,
          label,
          keys,
          overriddenKeys,
          lockedKeys,
          configuredKeys,
          isOverridden: overriddenKeys.length > 0,
          isLocked: lockedKeys.length === keys.length,
          isConfigured: configuredKeys.length > 0,
        };
      });
  }, [baseConfig, currentOverrides, lockState, lockedSections]);

  const overrideCount = Object.keys(currentOverrides).length;

  const toggleSection = useCallback((key: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  /** Update override value directly (used by CategoryFormAdapter) */
  const updateOverrideDirect = useCallback((key: string, newValue: unknown) => {
    setLocalOverrides((prev) => ({ ...(prev ?? currentOverrides), [key]: newValue }));
  }, [currentOverrides]);

  /** Remove all overrides for a category's keys */
  const resetCategory = useCallback((categoryId: string) => {
    const keysInCategory = Object.entries(AMAPI_KEY_TO_FORM_CATEGORY)
      .filter(([, cat]) => cat === categoryId)
      .map(([key]) => key);
    setLocalOverrides((prev) => {
      const next = { ...(prev ?? currentOverrides) };
      for (const k of keysInCategory) delete next[k];
      return next;
    });
  }, [currentOverrides]);

  const handleSave = useCallback(async () => {
    setError(null);
    try {
      await saveMutation.mutateAsync({
        policy_id: policyId,
        scope_type: scopeType,
        scope_id: scopeId,
        override_config: currentOverrides,
      });
      setLocalOverrides(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save overrides');
    }
  }, [policyId, scopeType, scopeId, currentOverrides, saveMutation]);

  const handleResetAll = useCallback(async () => {
    setError(null);
    try {
      await resetMutation.mutateAsync({
        policy_id: policyId,
        scope_type: scopeType,
        scope_id: scopeId,
      });
      setLocalOverrides(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset overrides');
    }
  }, [policyId, scopeType, scopeId, resetMutation]);

  const hasUnsavedChanges = localOverrides !== null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin h-5 w-5 border-2 border-accent border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">
            Policy Settings & Overrides
            {overrideCount > 0 && (
              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                {overrideCount} override{overrideCount !== 1 ? 's' : ''}
              </span>
            )}
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Override specific sections of the inherited policy configuration.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {overrideCount > 0 && (
            <button
              onClick={handleResetAll}
              disabled={resetMutation.isPending}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
            >
              <RotateCcw className="h-3 w-3" />
              Reset all
            </button>
          )}
          {hasUnsavedChanges && (
            <button
              onClick={handleSave}
              disabled={saveMutation.isPending}
              className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium text-white bg-accent hover:bg-accent/90 rounded transition-colors"
            >
              {saveMutation.isPending ? 'Saving...' : 'Save overrides'}
            </button>
          )}
        </div>
      </div>

      {/* Lock notice */}
      {lockState?.fully_locked && (
        <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <Lock className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-amber-800">Policy fully locked</p>
            <p className="text-xs text-amber-600">
              Locked by {lockState.locked_by_scope_name ?? 'an ancestor scope'}. No overrides are allowed.
            </p>
          </div>
        </div>
      )}

      {lockState && !lockState.fully_locked && lockedSections.length > 0 && (
        <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <Lock className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-blue-800">
              {lockedSections.length} section{lockedSections.length !== 1 ? 's' : ''} locked
            </p>
            <p className="text-xs text-blue-600">
              Locked by {lockState.locked_by_scope_name ?? 'an ancestor scope'}:{' '}
              {lockedSections.map((s) => AMAPI_SECTIONS[s] ?? s).join(', ')}
            </p>
          </div>
        </div>
      )}

      {/* Lock controls panel */}
      <div className="border border-gray-200 rounded-lg">
        <button
          type="button"
          onClick={() => setShowLockPanel((prev) => !prev)}
          className="flex w-full items-center justify-between px-3 py-2.5 bg-white hover:bg-gray-50 rounded-lg transition-colors"
        >
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-gray-500" />
            <span className="text-sm font-medium text-gray-700">Lock Settings</span>
            {(currentAssignment?.locked || (currentAssignment?.locked_sections?.length ?? 0) > 0) && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-700">
                {currentAssignment?.locked ? 'fully locked' : `${currentAssignment?.locked_sections?.length} locked`}
              </span>
            )}
          </div>
          {showLockPanel ? (
            <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
          )}
        </button>
        {showLockPanel && (
          <div className="px-3 py-3 border-t border-gray-100 bg-gray-50">
            <LockControls
              policyId={policyId}
              scopeType={scopeType}
              scopeId={scopeId}
              currentLocked={currentAssignment?.locked ?? false}
              currentLockedSections={currentAssignment?.locked_sections ?? []}
              inheritedLockState={lockState}
            />
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
          <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {/* Category list */}
      {!lockState?.fully_locked && (
        <div className="border border-gray-200 rounded-lg divide-y divide-gray-200">
          {availableCategories.map(({ id, label, overriddenKeys, isOverridden, isLocked, isConfigured }) => {
            const isExpanded = expandedSections.has(id);

            return (
              <div key={id} className="group">
                {/* Category header row */}
                <div
                  className={`flex items-center justify-between px-3 py-2.5 ${
                    isOverridden ? 'bg-amber-50/50' : 'bg-white'
                  } ${isLocked ? 'opacity-60' : 'cursor-pointer hover:bg-gray-50'}`}
                  onClick={() => !isLocked && toggleSection(id)}
                >
                  <div className="flex items-center gap-2">
                    {!isLocked && (
                      isExpanded
                        ? <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
                        : <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
                    )}
                    {isLocked && <Lock className="h-3.5 w-3.5 text-gray-400" />}
                    <span className={`text-sm ${isOverridden ? 'font-medium text-amber-900' : 'text-gray-700'}`}>
                      {label}
                    </span>
                    {isOverridden && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700">
                        {overriddenKeys.length} override{overriddenKeys.length !== 1 ? 's' : ''}
                      </span>
                    )}
                    {isConfigured && !isOverridden && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700">
                        configured
                      </span>
                    )}
                    {isLocked && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500">
                        locked
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {!isLocked && isOverridden && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          resetCategory(id);
                        }}
                        className="inline-flex items-center gap-1 px-2 py-0.5 text-xs text-gray-500 hover:text-red-600 rounded transition-colors"
                      >
                        <RotateCcw className="h-3 w-3" />
                        Reset
                      </button>
                    )}
                  </div>
                </div>

                {/* Expanded: render the full category form */}
                {isExpanded && !isLocked && (
                  <div className="px-4 py-4 bg-gray-50 border-t border-gray-100">
                    <div className="bg-white rounded-lg border border-gray-200 p-4">
                      <CategoryFormAdapter
                        category={id}
                        baseConfig={baseConfig}
                        currentOverrides={currentOverrides}
                        onKeyChange={updateOverrideDirect}
                      />
                    </div>

                    {/* Show inherited values summary */}
                    {isConfigured && (
                      <details className="mt-2 text-xs">
                        <summary className="text-gray-500 cursor-pointer hover:text-gray-700">
                          View inherited values for this category
                        </summary>
                        <pre className="mt-1 p-2 bg-gray-100 rounded text-gray-600 overflow-x-auto text-[11px]">
                          {JSON.stringify(
                            Object.fromEntries(
                              Object.keys(baseConfig)
                                .filter((k) => AMAPI_KEY_TO_FORM_CATEGORY[k] === id)
                                .map((k) => [k, baseConfig[k]])
                            ),
                            null,
                            2,
                          )}
                        </pre>
                      </details>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {availableCategories.length === 0 && (
            <div className="px-3 py-4 text-sm text-gray-500 text-center">
              No configurable sections found in the base policy.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
