import { useState, useCallback } from 'react';
import { Lock, Unlock, Shield, AlertTriangle } from 'lucide-react';
import { useSetPolicyLocks } from '@/api/queries/policies';

/**
 * AMAPI sections that can be individually locked.
 * Same list as PolicyOverrideEditor — kept in sync.
 */
const LOCKABLE_SECTIONS: Record<string, string> = {
  applications: 'Applications',
  passwordPolicies: 'Password Policies',
  permissionGrants: 'Permission Grants',
  statusReportingSettings: 'Status Reporting',
  keyguardDisabledFeatures: 'Keyguard Features',
  persistentPreferredActivities: 'Default Activities',
  setupActions: 'Setup Actions',
  policyEnforcementRules: 'Enforcement Rules',
  kioskCustomization: 'Kiosk Customisation',
  advancedSecurityOverrides: 'Advanced Security',
  personalUsagePolicies: 'Personal Usage',
  crossProfilePolicies: 'Cross Profile',
  openNetworkConfiguration: 'Network Config',
  deviceConnectivityManagement: 'Connectivity',
  privateDnsSettings: 'Private DNS',
  wifiConfigsLockdownEnabled: 'WiFi Lockdown',
  bluetoothConfigDisabled: 'Bluetooth',
  screenCaptureDisabled: 'Screen Capture',
  cameraDisabled: 'Camera',
  microphoneAccess: 'Microphone',
  locationMode: 'Location',
  shareLocationDisabled: 'Share Location',
  outgoingCallsDisabled: 'Outgoing Calls',
  smsDisabled: 'SMS',
  factoryResetDisabled: 'Factory Reset',
  addUserDisabled: 'Add User',
  mountPhysicalMediaDisabled: 'Physical Media',
  usbDataAccess: 'USB Data Access',
  vpnConfigDisabled: 'VPN Config',
  systemUpdate: 'System Update',
  displaySettings: 'Display Settings',
  printingPolicy: 'Printing',
  minimumApiLevel: 'Minimum API Level',
};

interface LockControlsProps {
  policyId: string;
  scopeType: 'environment' | 'group' | 'device';
  scopeId: string;
  currentLocked: boolean;
  currentLockedSections: string[];
  /** Read-only inherited locks from ancestor scopes */
  inheritedLockState?: {
    fully_locked: boolean;
    locked_sections: string[];
    locked_by_scope_name?: string | null;
  };
}

export default function LockControls({
  policyId,
  scopeType,
  scopeId,
  currentLocked,
  currentLockedSections,
  inheritedLockState,
}: LockControlsProps) {
  const lockMutation = useSetPolicyLocks();
  const [localLocked, setLocalLocked] = useState<boolean>(currentLocked);
  const [localLockedSections, setLocalLockedSections] = useState<string[]>(currentLockedSections);
  const [error, setError] = useState<string | null>(null);

  const hasChanges =
    localLocked !== currentLocked ||
    JSON.stringify([...localLockedSections].sort()) !== JSON.stringify([...currentLockedSections].sort());

  const toggleFullLock = useCallback(() => {
    setLocalLocked((prev) => !prev);
  }, []);

  const toggleSectionLock = useCallback((sectionKey: string) => {
    setLocalLockedSections((prev) => {
      if (prev.includes(sectionKey)) {
        return prev.filter((s) => s !== sectionKey);
      }
      return [...prev, sectionKey];
    });
  }, []);

  const handleSave = useCallback(async () => {
    setError(null);
    try {
      await lockMutation.mutateAsync({
        policy_id: policyId,
        scope_type: scopeType,
        scope_id: scopeId,
        locked: localLocked,
        locked_sections: localLockedSections,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update locks');
    }
  }, [policyId, scopeType, scopeId, localLocked, localLockedSections, lockMutation]);

  // Sections that are locked by inheritance (can't be unlocked at this scope)
  const inheritedLockedSections = new Set(inheritedLockState?.locked_sections ?? []);
  const isInheritedFullLock = inheritedLockState?.fully_locked ?? false;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-gray-500" />
          <h4 className="text-sm font-semibold text-gray-900">Lock Settings</h4>
        </div>
        {hasChanges && (
          <button
            onClick={handleSave}
            disabled={lockMutation.isPending}
            className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium text-white bg-accent hover:bg-accent/90 rounded transition-colors"
          >
            {lockMutation.isPending ? 'Saving...' : 'Save locks'}
          </button>
        )}
      </div>

      <p className="text-xs text-gray-500">
        Lock sections to prevent child scopes (groups, devices) from overriding them.
      </p>

      {/* Inherited lock notice */}
      {isInheritedFullLock && (
        <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <Lock className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-amber-800">Fully locked by ancestor</p>
            <p className="text-xs text-amber-600">
              Locked by {inheritedLockState?.locked_by_scope_name ?? 'an ancestor scope'}. Lock settings cannot be changed.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
          <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {!isInheritedFullLock && (
        <>
          {/* Full lock toggle */}
          <label className="flex items-center gap-3 py-2 cursor-pointer">
            <button
              type="button"
              role="switch"
              aria-checked={localLocked}
              onClick={toggleFullLock}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-accent/30 focus:ring-offset-2 ${
                localLocked ? 'bg-red-500' : 'bg-gray-200'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  localLocked ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
            <div className="flex-1">
              <span className="text-sm font-medium text-gray-900">Lock entire policy</span>
              <p className="text-xs text-gray-500">
                Prevents all overrides at child scopes. No sections can be customised below this scope.
              </p>
            </div>
          </label>

          {/* Per-section locks (only when not fully locked) */}
          {!localLocked && (
            <div className="border border-gray-200 rounded-lg divide-y divide-gray-200 max-h-64 overflow-y-auto">
              {Object.entries(LOCKABLE_SECTIONS).map(([key, label]) => {
                const isInherited = inheritedLockedSections.has(key);
                const isChecked = localLockedSections.includes(key) || isInherited;

                return (
                  <label
                    key={key}
                    className={`flex items-center gap-3 px-3 py-2 text-sm ${
                      isInherited ? 'opacity-60 cursor-not-allowed bg-gray-50' : 'cursor-pointer hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      disabled={isInherited}
                      onChange={() => !isInherited && toggleSectionLock(key)}
                      className="h-4 w-4 rounded border-gray-300 text-accent focus:ring-accent/30"
                    />
                    <span className="flex-1 text-gray-700">{label}</span>
                    {isChecked && !isInherited && (
                      <Lock className="h-3 w-3 text-red-400" />
                    )}
                    {isInherited && (
                      <span className="text-[10px] text-gray-400">inherited</span>
                    )}
                  </label>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
