type JsonObject = Record<string, unknown>;

export class AmapiPolicyValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`AMAPI policy preflight validation failed: ${issues[0] ?? 'Unknown error'}`);
    this.name = 'AmapiPolicyValidationError';
    this.issues = issues;
  }
}

export type AmapiPolicyValidationResult = {
  errors: string[];
  warnings: string[];
};

const SHA256_HEX = /^[a-fA-F0-9]{64}$/;
const ANDROID_PACKAGE_NAME = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;

function asObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as JsonObject;
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function hasDuplicates(values: string[]): boolean {
  return new Set(values).size !== values.length;
}

function enumerateAnnualRange(startDay: number, endDay: number, totalDays = 366): number[] {
  const days: number[] = [];
  let cur = startDay;
  while (true) {
    days.push(cur);
    if (cur === endDay) break;
    cur = cur === totalDays ? 1 : cur + 1;
  }
  return days;
}

function toOrdinalDate(value: unknown): { ordinal: number; label: string } | null {
  const date = asObject(value);
  if (!date) return null;
  const month = asNumber(date.month);
  const day = asNumber(date.day);
  if (month === null || day === null) return null;
  if (!Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(2000, month - 1, day));
  if (d.getUTCFullYear() !== 2000 || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  const yearStart = Date.UTC(2000, 0, 1);
  const ordinal = Math.floor((d.getTime() - yearStart) / 86400000) + 1;
  return { ordinal, label: `${month}-${day}` };
}

function collectOverlongStrings(
  value: unknown,
  maxLen: number,
  path: string,
  out: string[],
  limit = 25
): void {
  if (out.length >= limit) return;
  if (typeof value === 'string') {
    if (value.length > maxLen) {
      out.push(`${path} string length ${value.length} exceeds AMAPI max ${maxLen}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, idx) => collectOverlongStrings(item, maxLen, `${path}[${idx}]`, out, limit));
    return;
  }
  const obj = asObject(value);
  if (!obj) return;
  for (const [k, v] of Object.entries(obj)) {
    collectOverlongStrings(v, maxLen, `${path}.${k}`, out, limit);
    if (out.length >= limit) return;
  }
}

export function validateAmapiPolicyPayload(payload: unknown): AmapiPolicyValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const policy = asObject(payload);
  if (!policy) {
    return { errors: ['Policy payload must be a JSON object'], warnings };
  }

  const applications = asArray<JsonObject>(policy.applications);
  if (applications.length > 3000) {
    errors.push(`applications has ${applications.length} items; AMAPI maximum is 3000`);
  }

  const setupActions = asArray<JsonObject>(policy.setupActions);
  if (setupActions.length > 1) {
    errors.push(`setupActions has ${setupActions.length} items; AMAPI allows at most 1`);
  }

  const complianceRules = asArray<JsonObject>(policy.complianceRules);
  if (complianceRules.length > 100) {
    errors.push(`complianceRules has ${complianceRules.length} items; AMAPI maximum is 100`);
  }

  const wipeDataFlags = asArray<string>(policy.wipeDataFlags).filter((v): v is string => typeof v === 'string');
  if (hasDuplicates(wipeDataFlags)) {
    errors.push('wipeDataFlags contains duplicates (AMAPI requires unique values)');
  }

  const shortSupportMessage = asObject(policy.shortSupportMessage);
  if (shortSupportMessage) {
    const defaultMessage = asString(shortSupportMessage.defaultMessage);
    const localized = asObject(shortSupportMessage.localizedMessages);
    if (localized && Object.keys(localized).length > 0 && !defaultMessage) {
      errors.push('shortSupportMessage.defaultMessage is required when localized messages are provided');
    }
    if (defaultMessage && defaultMessage.length > 200) {
      warnings.push(`shortSupportMessage.defaultMessage length ${defaultMessage.length} exceeds 200 (AMAPI may truncate)`);
    }
  }

  const defaultAppSettings = asArray<JsonObject>(policy.defaultApplicationSettings);
  if (defaultAppSettings.length > 0) {
    const seenTypes = new Set<string>();
    defaultAppSettings.forEach((setting, idx) => {
      const t = asString(setting.defaultApplicationType);
      if (!t) {
        errors.push(`defaultApplicationSettings[${idx}].defaultApplicationType is required`);
      }
      if (t) {
        if (seenTypes.has(t)) errors.push(`defaultApplicationSettings[${idx}] duplicates defaultApplicationType ${t}`);
        seenTypes.add(t);
      }
      const defaultApps = asArray<JsonObject>(setting.defaultApplications);
      if (defaultApps.length === 0) {
        errors.push(`defaultApplicationSettings[${idx}].defaultApplications must not be empty`);
      } else {
        const pkgNames = defaultApps
          .map((a) => asString(a.packageName))
          .filter((v): v is string => !!v && v.trim().length > 0)
          .map((v) => v.trim());
        if (pkgNames.length !== defaultApps.length) {
          errors.push(`defaultApplicationSettings[${idx}].defaultApplications requires packageName for each item`);
        }
        if (hasDuplicates(pkgNames)) {
          errors.push(`defaultApplicationSettings[${idx}].defaultApplications contains duplicate packageName values`);
        }
        for (const pkg of pkgNames) {
          if (!ANDROID_PACKAGE_NAME.test(pkg)) {
            errors.push(`defaultApplicationSettings[${idx}].defaultApplications contains invalid packageName: ${pkg}`);
          }
        }
      }

      const scopes = asArray<string>(setting.defaultApplicationScopes)
        .filter((v): v is string => typeof v === 'string' && v.length > 0);
      if (scopes.length === 0) {
        errors.push(`defaultApplicationSettings[${idx}].defaultApplicationScopes must not be empty`);
      } else if (hasDuplicates(scopes)) {
        errors.push(`defaultApplicationSettings[${idx}].defaultApplicationScopes contains duplicates`);
      }

      const requiresApplicationsEntries = scopes.includes('SCOPE_FULLY_MANAGED') || scopes.includes('SCOPE_WORK_PROFILE');
      if (requiresApplicationsEntries && defaultApps.length > 0) {
        const appInstallTypeByPackage = new Map(
          applications
            .map((a) => [asString(a.packageName)?.trim() ?? '', asString(a.installType) ?? 'INSTALL_TYPE_UNSPECIFIED'] as const)
            .filter(([pkg]) => pkg.length > 0)
        );
        for (const appEntry of defaultApps) {
          const pkg = asString(appEntry.packageName)?.trim();
          if (!pkg) continue;
          const installType = appInstallTypeByPackage.get(pkg);
          if (!installType) {
            errors.push(`defaultApplicationSettings[${idx}] package ${pkg} must also exist in applications[] for SCOPE_FULLY_MANAGED/SCOPE_WORK_PROFILE`);
            continue;
          }
          if (installType === 'BLOCKED') {
            errors.push(`defaultApplicationSettings[${idx}] package ${pkg} cannot be BLOCKED in applications[] for SCOPE_FULLY_MANAGED/SCOPE_WORK_PROFILE`);
          }
        }
      }
    });
  }

  let minimumVersionCodeCount = 0;
  let extensionConfigCount = 0;
  let requiredForSetupCount = 0;
  let kioskInstallTypeCount = 0;
  const roleOwnerByType = new Map<string, number>();
  const appsByPackage = new Map<string, JsonObject>();
  let hasKioskRole = false;
  let hasCompanionAppRole = false;
  let hasCertSelectionDelegation = false;

  applications.forEach((app, idx) => {
    const packageName = asString(app.packageName)?.trim();
    if (packageName) appsByPackage.set(packageName, app);

    if (app.minimumVersionCode !== undefined && app.minimumVersionCode !== null) {
      minimumVersionCodeCount += 1;
    }
    if (asObject(app.extensionConfig)) extensionConfigCount += 1;
    if (asString(app.installType) === 'REQUIRED_FOR_SETUP') requiredForSetupCount += 1;
    if (asString(app.installType) === 'KIOSK') kioskInstallTypeCount += 1;

    const installType = asString(app.installType);
    if (installType === 'CUSTOM') {
      if (!Array.isArray(app.signingKeyCerts) || asArray(app.signingKeyCerts).length === 0) {
        errors.push(`applications[${idx}] with installType=CUSTOM requires signingKeyCerts`);
      }
      const customDisallowedFields = [
        'minimumVersionCode',
        'accessibleTrackIds',
        'autoUpdateMode',
        'installConstraint',
        'installPriority',
      ] as const;
      for (const key of customDisallowedFields) {
        if (app[key] !== undefined) {
          errors.push(`applications[${idx}] with installType=CUSTOM must not set ${key}`);
        }
      }
    }

    if (app.customAppConfig !== undefined && installType !== 'CUSTOM') {
      errors.push(`applications[${idx}].customAppConfig requires installType=CUSTOM`);
    }

    const installConstraint = asArray(app.installConstraint);
    if (installConstraint.length > 1) {
      errors.push(`applications[${idx}].installConstraint has ${installConstraint.length} items; AMAPI allows at most 1`);
    }

    const installPriority = asNumber(app.installPriority);
    if (installPriority !== null && (installPriority < 0 || installPriority > 10000)) {
      errors.push(`applications[${idx}].installPriority=${installPriority} is outside AMAPI range 0..10000`);
    }

    const certs = asArray<JsonObject>(app.signingKeyCerts);
    certs.forEach((cert, certIdx) => {
      const fp = asString(cert.signingKeyCertFingerprintSha256)?.trim();
      if (fp && !SHA256_HEX.test(fp)) {
        errors.push(`applications[${idx}].signingKeyCerts[${certIdx}].signingKeyCertFingerprintSha256 must be 64 hex chars`);
      }
    });

    const roleTypes: string[] = [];
    const roles = asArray<JsonObject>(app.roles);
    roles.forEach((role, roleIdx) => {
      const roleType = asString(role.roleType);
      if (!roleType) {
        errors.push(`applications[${idx}].roles[${roleIdx}].roleType is required`);
        return;
      }
      if (roleType === 'ROLE_TYPE_UNSPECIFIED') {
        errors.push(`applications[${idx}].roles[${roleIdx}].roleType cannot be ROLE_TYPE_UNSPECIFIED`);
      }
      if (roleType === 'KIOSK') hasKioskRole = true;
      if (roleType === 'COMPANION_APP') hasCompanionAppRole = true;
      roleTypes.push(roleType);
      const existingOwner = roleOwnerByType.get(roleType);
      if (existingOwner !== undefined && existingOwner !== idx) {
        errors.push(`applications[${idx}].roles[${roleIdx}].roleType ${roleType} is already assigned to applications[${existingOwner}]`);
      } else {
        roleOwnerByType.set(roleType, idx);
      }
    });
    if (roleTypes.length > 0 && hasDuplicates(roleTypes)) {
      errors.push(`applications[${idx}].roles contains duplicate roleType values`);
    }

    const delegatedScopes = asArray<string>(app.delegatedScopes)
      .filter((v): v is string => typeof v === 'string' && v.length > 0);
    if (hasDuplicates(delegatedScopes)) {
      errors.push(`applications[${idx}].delegatedScopes contains duplicates`);
    }
    if (delegatedScopes.includes('CERT_SELECTION')) hasCertSelectionDelegation = true;

    const managedConfigTooLong: string[] = [];
    if (app.managedConfiguration !== undefined) {
      collectOverlongStrings(app.managedConfiguration, 65535, `applications[${idx}].managedConfiguration`, managedConfigTooLong);
      errors.push(...managedConfigTooLong);
    }
    if (app.managedConfiguration !== undefined && app.managedConfigurationTemplate !== undefined) {
      warnings.push(`applications[${idx}].managedConfigurationTemplate is ignored when managedConfiguration is set`);
    }
  });

  if (minimumVersionCodeCount > 20) {
    errors.push(`${minimumVersionCodeCount} applications specify minimumVersionCode; AMAPI allows at most 20`);
  }
  if (extensionConfigCount > 1) {
    errors.push(`${extensionConfigCount} applications specify extensionConfig; AMAPI allows at most 1`);
  }
  if (extensionConfigCount > 0 && hasCompanionAppRole) {
    errors.push('extensionConfig cannot be set when any application has COMPANION_APP role');
  }
  if (requiredForSetupCount > 7) {
    warnings.push(
      `${requiredForSetupCount} applications use REQUIRED_FOR_SETUP; field docs do not currently expose a limit, but 7 has been observed historically`
    );
  }
  if (kioskInstallTypeCount > 1) {
    errors.push(`${kioskInstallTypeCount} applications use installType=KIOSK; AMAPI allows at most 1`);
  }
  if (kioskInstallTypeCount > 0 && hasKioskRole) {
    errors.push('installType=KIOSK cannot be set when any application has KIOSK role');
  }

  const choosePrivateKeyRules = asArray(policy.choosePrivateKeyRules);
  if (hasCertSelectionDelegation && choosePrivateKeyRules.length > 0) {
    errors.push('choosePrivateKeyRules must be empty when any application has delegatedScopes including CERT_SELECTION');
  }

  setupActions.forEach((action, idx) => {
    const launchApp = asObject(action.launchApp);
    const pkg = asString(launchApp?.packageName)?.trim();
    if (!pkg) return;
    const appPolicy = appsByPackage.get(pkg);
    if (!appPolicy) {
      errors.push(`setupActions[${idx}].launchApp.packageName=${pkg} must exist in applications[]`);
      return;
    }
    if (asString(appPolicy.installType) !== 'REQUIRED_FOR_SETUP') {
      errors.push(`setupActions[${idx}].launchApp.packageName=${pkg} requires applications[].installType=REQUIRED_FOR_SETUP`);
    }
  });

  if (policy.autoDateAndTimeZone !== undefined && policy.autoTimeRequired !== undefined) {
    warnings.push('autoTimeRequired is ignored when autoDateAndTimeZone is set');
  }
  if (policy.tetheringSettings !== undefined && policy.tetheringConfigDisabled !== undefined) {
    const tetheringSettings = asString(policy.tetheringSettings);
    if (tetheringSettings && tetheringSettings !== 'TETHERING_SETTINGS_UNSPECIFIED') {
      warnings.push('tetheringConfigDisabled is ignored when tetheringSettings is set to a non-default value');
    }
  }
  if (policy.configureWifi !== undefined && policy.wifiConfigDisabled !== undefined) {
    const configureWifi = asString(policy.configureWifi);
    if (configureWifi && configureWifi !== 'CONFIGURE_WIFI_UNSPECIFIED') {
      warnings.push('wifiConfigDisabled is ignored when configureWifi is set to a non-default value');
    }
  }
  if (policy.networkEscapeHatchEnabled !== undefined) {
    if (policy.wifiConfigDisabled === true) {
      warnings.push('networkEscapeHatchEnabled may be overridden under some conditions when wifiConfigDisabled=true');
    }
    const configureWifi = asString(policy.configureWifi);
    if (configureWifi === 'DISALLOW_CONFIGURING_WIFI') {
      warnings.push('networkEscapeHatchEnabled may be overridden under some conditions when configureWifi=DISALLOW_CONFIGURING_WIFI');
    }
  }

  const passwordRequirements = asObject(policy.passwordRequirements);
  if (passwordRequirements) {
    if (passwordRequirements.requirePasswordUnlock !== undefined) {
      errors.push('passwordRequirements.requirePasswordUnlock must not be set (deprecated PasswordRequirements restriction)');
    }
    if (passwordRequirements.unifiedLockSettings !== undefined) {
      errors.push('passwordRequirements.unifiedLockSettings must not be set (deprecated PasswordRequirements restriction)');
    }
    const quality = asString(passwordRequirements.passwordQuality);
    if (quality && ['COMPLEXITY_LOW', 'COMPLEXITY_MEDIUM', 'COMPLEXITY_HIGH'].includes(quality)) {
      errors.push(`passwordRequirements.passwordQuality=${quality} is not allowed in deprecated passwordRequirements; use passwordPolicies`);
    }
  }

  const personalUsagePolicies = asObject(policy.personalUsagePolicies);
  if (personalUsagePolicies) {
    const maxDaysWithWorkOff = asNumber(personalUsagePolicies.maxDaysWithWorkOff);
    if (maxDaysWithWorkOff !== null && maxDaysWithWorkOff !== 0 && maxDaysWithWorkOff < 3) {
      errors.push(`personalUsagePolicies.maxDaysWithWorkOff=${maxDaysWithWorkOff} must be 0 or >= 3`);
    }

    const personalAccountTypesDisabled = asArray<string>(personalUsagePolicies.accountTypesWithManagementDisabled)
      .filter((v): v is string => typeof v === 'string' && v.length > 0);
    if (hasDuplicates(personalAccountTypesDisabled)) {
      errors.push('personalUsagePolicies.accountTypesWithManagementDisabled contains duplicates');
    }
  }

  const rootAccountTypesDisabled = asArray<string>(policy.accountTypesWithManagementDisabled)
    .filter((v): v is string => typeof v === 'string' && v.length > 0);
  if (hasDuplicates(rootAccountTypesDisabled)) {
    errors.push('accountTypesWithManagementDisabled contains duplicates');
  }

  const advancedSecurityOverrides = asObject(policy.advancedSecurityOverrides);
  if (advancedSecurityOverrides) {
    const packages = asArray<string>(advancedSecurityOverrides.personalAppsThatCanReadWorkNotifications)
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .map((v) => v.trim());
    if (hasDuplicates(packages)) {
      errors.push('advancedSecurityOverrides.personalAppsThatCanReadWorkNotifications contains duplicates');
    }
    for (const pkg of packages) {
      if (!ANDROID_PACKAGE_NAME.test(pkg)) {
        errors.push(`advancedSecurityOverrides.personalAppsThatCanReadWorkNotifications contains invalid package name: ${pkg}`);
      }
    }
    if (advancedSecurityOverrides.commonCriteriaMode === 'COMMON_CRITERIA_MODE_ENABLED') {
      warnings.push('advancedSecurityOverrides.commonCriteriaMode is a strict security mode and should only be enabled when explicitly required');
    }
  }

  const crossProfilePolicies = asObject(policy.crossProfilePolicies);
  if (crossProfilePolicies) {
    const exemptions = asArray<string>(crossProfilePolicies.exemptionsToShowWorkContactsInPersonalProfile)
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .map((v) => v.trim());
    if (exemptions.length > 0) {
      const showMode = asString(crossProfilePolicies.showWorkContactsInPersonalProfile);
      const allowedModes = new Set([
        'SHOW_WORK_CONTACTS_IN_PERSONAL_PROFILE_ALLOWED',
        'SHOW_WORK_CONTACTS_IN_PERSONAL_PROFILE_DISALLOWED',
        'SHOW_WORK_CONTACTS_IN_PERSONAL_PROFILE_DISALLOWED_EXCEPT_SYSTEM',
      ]);
      if (!showMode || !allowedModes.has(showMode)) {
        errors.push('crossProfilePolicies.exemptionsToShowWorkContactsInPersonalProfile requires a supported showWorkContactsInPersonalProfile mode');
      }
      if (hasDuplicates(exemptions)) {
        errors.push('crossProfilePolicies.exemptionsToShowWorkContactsInPersonalProfile contains duplicates');
      }
      for (const pkg of exemptions) {
        if (!ANDROID_PACKAGE_NAME.test(pkg)) {
          errors.push(`crossProfilePolicies.exemptionsToShowWorkContactsInPersonalProfile contains invalid package name: ${pkg}`);
        }
      }
    }

    const crossProfileAppFunctions = asString(crossProfilePolicies.crossProfileAppFunctions);
    if (crossProfileAppFunctions === 'CROSS_PROFILE_APP_FUNCTIONS_ALLOWED' && policy.appFunctions === 'APP_FUNCTIONS_DISALLOWED') {
      errors.push('crossProfilePolicies.crossProfileAppFunctions=ALLOWED cannot be used when appFunctions=APP_FUNCTIONS_DISALLOWED');
    }
  }

  const workAccountSetupConfig = asObject(policy.workAccountSetupConfig);
  if (workAccountSetupConfig) {
    if (Object.keys(workAccountSetupConfig).length === 0) {
      warnings.push('workAccountSetupConfig is present but empty');
    }
    const authType = asString(workAccountSetupConfig.authenticationType);
    const requiredEmail = asString(workAccountSetupConfig.requiredAccountEmail)?.trim();
    if (requiredEmail && authType !== 'GOOGLE_AUTHENTICATED') {
      warnings.push('workAccountSetupConfig.requiredAccountEmail is only relevant when authenticationType=GOOGLE_AUTHENTICATED');
    }
  }

  const complianceRulesDetailed = asArray<JsonObject>(policy.complianceRules);
  complianceRulesDetailed.forEach((rule, idx) => {
    const apiLevelCondition = asObject(rule.apiLevelCondition);
    if (rule.apiLevelCondition !== undefined && !apiLevelCondition) {
      errors.push(`complianceRules[${idx}].apiLevelCondition must be an object`);
    }
    const minApiLevel = asNumber(apiLevelCondition?.minApiLevel);
    if (apiLevelCondition && apiLevelCondition.minApiLevel === undefined) {
      warnings.push(`complianceRules[${idx}].apiLevelCondition is present without minApiLevel`);
    }
    if (minApiLevel !== null && minApiLevel <= 0) {
      errors.push(`complianceRules[${idx}].apiLevelCondition.minApiLevel must be > 0`);
    }
  });

  const persistentPreferredActivities = asArray<JsonObject>(policy.persistentPreferredActivities);
  persistentPreferredActivities.forEach((activity, idx) => {
    const actions = asArray<string>(activity.actions).filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean);
    if (hasDuplicates(actions)) {
      warnings.push(`persistentPreferredActivities[${idx}].actions contains duplicates`);
    }
    const categories = asArray<string>(activity.categories).filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean);
    if (hasDuplicates(categories)) {
      warnings.push(`persistentPreferredActivities[${idx}].categories contains duplicates`);
    }
  });

  const permittedInputMethods = asArray<string>(policy.permittedInputMethods)
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim());
  if (hasDuplicates(permittedInputMethods)) {
    errors.push('permittedInputMethods contains duplicates');
  }
  for (const pkg of permittedInputMethods) {
    if (!ANDROID_PACKAGE_NAME.test(pkg)) {
      errors.push(`permittedInputMethods contains invalid package name: ${pkg}`);
    }
  }

  const permittedAccessibilityServices = asArray<string>(policy.permittedAccessibilityServices)
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim());
  if (hasDuplicates(permittedAccessibilityServices)) {
    errors.push('permittedAccessibilityServices contains duplicates');
  }
  for (const pkg of permittedAccessibilityServices) {
    if (!ANDROID_PACKAGE_NAME.test(pkg)) {
      errors.push(`permittedAccessibilityServices contains invalid package name: ${pkg}`);
    }
  }

  const choosePrivateKeyRulesDetailed = asArray<JsonObject>(policy.choosePrivateKeyRules);
  choosePrivateKeyRulesDetailed.forEach((rule, idx) => {
    const urlPattern = asString(rule.urlPattern);
    if (urlPattern && urlPattern.length > 0) {
      try {
        // Java and JS regex syntax differ, but this catches obvious malformed patterns early.
        new RegExp(urlPattern);
      } catch {
        errors.push(`choosePrivateKeyRules[${idx}].urlPattern is not a valid regex pattern`);
      }
    }
    const packageNames = asArray<string>(rule.packageNames)
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .map((v) => v.trim());
    if (hasDuplicates(packageNames)) {
      errors.push(`choosePrivateKeyRules[${idx}].packageNames contains duplicates`);
    }
    for (const pkg of packageNames) {
      if (!ANDROID_PACKAGE_NAME.test(pkg)) {
        errors.push(`choosePrivateKeyRules[${idx}].packageNames contains invalid package name: ${pkg}`);
      }
    }
  });

  const perRules = asArray<JsonObject>(policy.policyEnforcementRules);
  perRules.forEach((rule, idx) => {
    const blockAction = asObject(rule.blockAction);
    const wipeAction = asObject(rule.wipeAction);
    if (!!blockAction !== !!wipeAction) {
      errors.push(`policyEnforcementRules[${idx}] must include both blockAction and wipeAction together`);
    }
    const blockAfter = asNumber(blockAction?.blockAfterDays);
    const wipeAfter = asNumber(wipeAction?.wipeAfterDays);
    if (blockAfter !== null && wipeAfter !== null) {
      if (!(blockAfter < wipeAfter)) {
        errors.push(`policyEnforcementRules[${idx}] requires blockAfterDays (${blockAfter}) < wipeAfterDays (${wipeAfter})`);
      }
    }
  });

  const dcm = asObject(policy.deviceConnectivityManagement);
  if (dcm) {
    const privateDns = asObject(dcm.privateDnsSettings);
    if (privateDns) {
      const mode = asString(privateDns.privateDnsMode);
      const host = asString(privateDns.privateDnsHost)?.trim() ?? '';
      if (mode === 'PRIVATE_DNS_SPECIFIED_HOST' && !host) {
        errors.push('deviceConnectivityManagement.privateDnsSettings.privateDnsHost is required when privateDnsMode=PRIVATE_DNS_SPECIFIED_HOST');
      }
      if (host && mode !== 'PRIVATE_DNS_SPECIFIED_HOST') {
        errors.push('deviceConnectivityManagement.privateDnsSettings.privateDnsHost must only be set when privateDnsMode=PRIVATE_DNS_SPECIFIED_HOST');
      }
    }

    const wifiRoaming = asObject(dcm.wifiRoamingPolicy);
    const wifiRoamingSettings = asArray<JsonObject>(wifiRoaming?.wifiRoamingSettings);
    if (wifiRoamingSettings.length > 0) {
      const ssids = wifiRoamingSettings
        .map((r) => asString(r.wifiSsid))
        .filter((v): v is string => !!v);
      if (hasDuplicates(ssids)) {
        errors.push('deviceConnectivityManagement.wifiRoamingPolicy.wifiRoamingSettings contains duplicate wifiSsid values');
      }
      wifiRoamingSettings.forEach((r, idx) => {
        const ssid = asString(r.wifiSsid)?.trim() ?? '';
        if (!ssid) errors.push(`wifiRoamingSettings[${idx}].wifiSsid is required`);
        const mode = asString(r.wifiRoamingMode);
        if (!mode) errors.push(`wifiRoamingSettings[${idx}].wifiRoamingMode is required`);
      });
    }

    const wifiSsidPolicy = asObject(dcm.wifiSsidPolicy);
    if (wifiSsidPolicy) {
      const type = asString(wifiSsidPolicy.wifiSsidPolicyType);
      const ssids = asArray<JsonObject>(wifiSsidPolicy.wifiSsids);
      if (type === 'WIFI_SSID_ALLOWLIST' && ssids.length === 0) {
        errors.push('deviceConnectivityManagement.wifiSsidPolicy.wifiSsids must be non-empty when wifiSsidPolicyType=WIFI_SSID_ALLOWLIST');
      }
      ssids.forEach((s, idx) => {
        const ssid = asString(s.wifiSsid)?.trim() ?? '';
        if (!ssid) errors.push(`wifiSsidPolicy.wifiSsids[${idx}].wifiSsid is required`);
      });
    }

    const pns = asObject(dcm.preferentialNetworkServiceSettings);
    if (pns) {
      const configs = asArray<JsonObject>(pns.preferentialNetworkServiceConfigs);
      const configIds: number[] = [];
      configs.forEach((cfg, cfgIdx) => {
        const id = asNumber(cfg.preferentialNetworkId);
        if (id !== null) configIds.push(id);
        const fallback = asString(cfg.fallbackToDefaultConnection);
        const nonMatching = asString(cfg.nonMatchingNetworks);
        if (
          fallback === 'FALLBACK_TO_DEFAULT_CONNECTION_ALLOWED' &&
          nonMatching === 'NON_MATCHING_NETWORKS_DISALLOWED'
        ) {
          errors.push(`preferentialNetworkServiceConfigs[${cfgIdx}] invalid combination: fallbackToDefaultConnection=ALLOWED requires nonMatchingNetworks != DISALLOWED`);
        }
        if (
          nonMatching === 'NON_MATCHING_NETWORKS_DISALLOWED' &&
          fallback && fallback !== 'FALLBACK_TO_DEFAULT_CONNECTION_DISALLOWED'
        ) {
          errors.push(`preferentialNetworkServiceConfigs[${cfgIdx}] invalid combination: nonMatchingNetworks=DISALLOWED requires fallbackToDefaultConnection=DISALLOWED`);
        }
        if (id === 0) {
          errors.push(`preferentialNetworkServiceConfigs[${cfgIdx}].preferentialNetworkId must not be NO_PREFERENTIAL_NETWORK (0)`);
        }
      });
      if (hasDuplicates(configIds.map(String))) {
        errors.push('preferentialNetworkServiceConfigs contains duplicate preferentialNetworkId values');
      }

      const defaultNetId = asNumber(pns.defaultPreferentialNetworkId);
      if (
        defaultNetId !== null &&
        defaultNetId !== 0 && // NO_PREFERENTIAL_NETWORK
        !configIds.includes(defaultNetId)
      ) {
        errors.push(`defaultPreferentialNetworkId=${defaultNetId} must reference a configured preferentialNetworkServiceConfig`);
      }

      applications.forEach((app, idx) => {
        const prefId = asNumber(app.preferentialNetworkId);
        if (prefId !== null && prefId !== 0 && !configIds.includes(prefId)) {
          errors.push(`applications[${idx}].preferentialNetworkId=${prefId} must reference a configured preferentialNetworkServiceConfig`);
        }
      });
    }

    const apnPolicy = asObject(dcm.apnPolicy);
    const apnSettings = asArray<JsonObject>(apnPolicy?.apnSettings);
    if (apnSettings.length > 0) {
      const apnConflictKeys = new Map<string, number>();
      apnSettings.forEach((apn, apnIdx) => {
        const apnName = asString(apn.apn)?.trim() ?? '';
        const displayName = asString(apn.displayName)?.trim() ?? '';
        if (!apnName) errors.push(`apnSettings[${apnIdx}].apn is required and must be non-empty`);
        if (!displayName) errors.push(`apnSettings[${apnIdx}].displayName is required and must be non-empty`);

        const apnTypes = asArray<string>(apn.apnTypes).filter((v): v is string => typeof v === 'string');
        if (apnTypes.length === 0) {
          errors.push(`apnSettings[${apnIdx}].apnTypes is required and must be non-empty`);
        } else {
          if (apnTypes.includes('APN_TYPE_UNSPECIFIED')) {
            errors.push(`apnSettings[${apnIdx}].apnTypes must not include APN_TYPE_UNSPECIFIED`);
          }
          if (hasDuplicates(apnTypes)) {
            errors.push(`apnSettings[${apnIdx}].apnTypes contains duplicates`);
          }
        }

        const networkTypes = asArray<string>(apn.networkTypes).filter((v): v is string => typeof v === 'string');
        if (networkTypes.includes('NETWORK_TYPE_UNSPECIFIED')) {
          errors.push(`apnSettings[${apnIdx}].networkTypes must not include NETWORK_TYPE_UNSPECIFIED`);
        }
        if (hasDuplicates(networkTypes)) {
          errors.push(`apnSettings[${apnIdx}].networkTypes contains duplicates`);
        }

        const nonNegativeFields = ['carrierId', 'mmsProxyPort', 'mtuV4', 'mtuV6', 'proxyPort'] as const;
        for (const field of nonNegativeFields) {
          const num = asNumber(apn[field]);
          if (num !== null && num < 0) {
            errors.push(`apnSettings[${apnIdx}].${field} must be >= 0`);
          }
        }

        const conflictTuple = [
          apn.numericOperatorId ?? null,
          apn.apn ?? null,
          apn.proxyAddress ?? null,
          apn.proxyPort ?? null,
          apn.mmsProxyAddress ?? null,
          apn.mmsProxyPort ?? null,
          apn.mmsc ?? null,
          apn.mvnoType ?? null,
          apn.protocol ?? null,
          apn.roamingProtocol ?? null,
        ];
        const conflictKey = JSON.stringify(conflictTuple);
        const existing = apnConflictKeys.get(conflictKey);
        if (existing !== undefined) {
          errors.push(`apnSettings[${apnIdx}] conflicts with apnSettings[${existing}] (AMAPI rejects conflicting APN entries)`);
        } else {
          apnConflictKeys.set(conflictKey, apnIdx);
        }
      });
    }
  }

  const displaySettings = asObject(policy.displaySettings);
  if (displaySettings) {
    const sb = asObject(displaySettings.screenBrightnessSettings);
    if (sb) {
      const brightness = asNumber(sb.screenBrightness);
      if (brightness !== null && brightness !== 0 && (brightness < 1 || brightness > 255)) {
        errors.push(`displaySettings.screenBrightnessSettings.screenBrightness=${brightness} must be 0 or between 1 and 255`);
      }
      const mode = asString(sb.screenBrightnessMode);
      if (sb.screenBrightness !== undefined && mode && !['BRIGHTNESS_AUTOMATIC', 'BRIGHTNESS_FIXED'].includes(mode)) {
        errors.push('displaySettings.screenBrightnessSettings.screenBrightness requires screenBrightnessMode=BRIGHTNESS_AUTOMATIC or BRIGHTNESS_FIXED');
      }
      if (mode === 'BRIGHTNESS_USER_CHOICE' && sb.screenBrightness !== undefined) {
        errors.push('displaySettings.screenBrightnessSettings.screenBrightness must not be set when screenBrightnessMode=BRIGHTNESS_USER_CHOICE');
      }
      if (mode === 'BRIGHTNESS_FIXED' && sb.screenBrightness === undefined) {
        errors.push('displaySettings.screenBrightnessSettings.screenBrightness must be set when screenBrightnessMode=BRIGHTNESS_FIXED');
      }
    }
    const st = asObject(displaySettings.screenTimeoutSettings);
    if (st) {
      const timeout = asString(st.screenTimeout) ?? asNumber(st.screenTimeout);
      if (timeout !== null) {
        const ms = typeof timeout === 'string' ? Number(timeout) : timeout;
        if (Number.isFinite(ms) && ms <= 0) {
          errors.push(`displaySettings.screenTimeoutSettings.screenTimeout must be > 0 when set`);
        }
      }
      const mode = asString(st.screenTimeoutMode);
      if (st.screenTimeout !== undefined && mode && mode !== 'SCREEN_TIMEOUT_ENFORCED') {
        errors.push('displaySettings.screenTimeoutSettings.screenTimeout requires screenTimeoutMode=SCREEN_TIMEOUT_ENFORCED');
      }
      if (mode === 'SCREEN_TIMEOUT_USER_CHOICE' && st.screenTimeout !== undefined) {
        errors.push('displaySettings.screenTimeoutSettings.screenTimeout must not be set when screenTimeoutMode=SCREEN_TIMEOUT_USER_CHOICE');
      }
      if (mode === 'SCREEN_TIMEOUT_ENFORCED' && st.screenTimeout === undefined) {
        errors.push('displaySettings.screenTimeoutSettings.screenTimeout must be set when screenTimeoutMode=SCREEN_TIMEOUT_ENFORCED');
      }
    }
  }

  const systemUpdate = asObject(policy.systemUpdate);
  if (systemUpdate) {
    const startMinutes = asNumber(systemUpdate.startMinutes);
    if (startMinutes !== null && (startMinutes < 0 || startMinutes > 1439)) {
      errors.push(`systemUpdate.startMinutes=${startMinutes} is outside AMAPI range 0..1439`);
    }
    const endMinutes = asNumber(systemUpdate.endMinutes);
    if (endMinutes !== null && (endMinutes < 0 || endMinutes > 1439)) {
      errors.push(`systemUpdate.endMinutes=${endMinutes} is outside AMAPI range 0..1439`);
    }
    const allowedDaysWithoutUpdate = asNumber(systemUpdate.allowedDaysWithoutUpdate);
    if (allowedDaysWithoutUpdate !== null && allowedDaysWithoutUpdate < 0) {
      warnings.push(`systemUpdate.allowedDaysWithoutUpdate=${allowedDaysWithoutUpdate} is negative and likely ineffective/invalid`);
    }

    const freezePeriods = asArray<JsonObject>(systemUpdate.freezePeriods);
    if (freezePeriods.length > 0) {
      const occupied = new Map<number, number>();
      const normalized: Array<{ index: number; start: number; end: number }> = [];
      freezePeriods.forEach((period, idx) => {
        const start = toOrdinalDate(period.startDate);
        const end = toOrdinalDate(period.endDate);
        const startYear = asNumber(asObject(period.startDate)?.year);
        const endYear = asNumber(asObject(period.endDate)?.year);
        if (!start) {
          errors.push(`systemUpdate.freezePeriods[${idx}].startDate must include a valid month/day`);
          return;
        }
        if (!end) {
          errors.push(`systemUpdate.freezePeriods[${idx}].endDate must include a valid month/day`);
          return;
        }
        if ((startYear ?? 0) !== 0) {
          warnings.push(`systemUpdate.freezePeriods[${idx}].startDate.year is ignored by AMAPI and should typically be omitted/0`);
        }
        if ((endYear ?? 0) !== 0) {
          warnings.push(`systemUpdate.freezePeriods[${idx}].endDate.year is ignored by AMAPI and should typically be omitted/0`);
        }
        const days = enumerateAnnualRange(start.ordinal, end.ordinal);
        if (days.length > 90) {
          errors.push(`systemUpdate.freezePeriods[${idx}] spans ${days.length} days; AMAPI maximum is 90`);
        }
        for (const d of days) {
          const existing = occupied.get(d);
          if (existing !== undefined && existing !== idx) {
            errors.push(`systemUpdate.freezePeriods[${idx}] overlaps systemUpdate.freezePeriods[${existing}]`);
            break;
          }
          occupied.set(d, idx);
        }
        normalized.push({ index: idx, start: start.ordinal, end: end.ordinal });
      });

      const sorted = [...normalized].sort((a, b) => a.start - b.start);
      if (sorted.length > 1) {
        for (let i = 0; i < sorted.length; i += 1) {
          const cur = sorted[i];
          const next = sorted[(i + 1) % sorted.length];
          const gap = ((next.start - cur.end - 1) % 366 + 366) % 366;
          if (gap < 60) {
            errors.push(`systemUpdate.freezePeriods[${cur.index}] and [${next.index}] must be separated by at least 60 days (found ${gap})`);
          }
        }
      }
    }
  }

  const maximumTimeToLock = asNumber(policy.maximumTimeToLock);
  if (maximumTimeToLock !== null && maximumTimeToLock < 0) {
    errors.push(`maximumTimeToLock=${maximumTimeToLock} must be >= 0`);
  }

  const stayOnPluggedModes = asArray<string>(policy.stayOnPluggedModes)
    .filter((v): v is string => typeof v === 'string' && v.length > 0);
  if (hasDuplicates(stayOnPluggedModes)) {
    warnings.push('stayOnPluggedModes contains duplicates');
  }
  if (stayOnPluggedModes.length > 0 && maximumTimeToLock !== null && maximumTimeToLock > 0) {
    warnings.push('stayOnPluggedModes is set while maximumTimeToLock > 0; AMAPI docs recommend clearing maximumTimeToLock');
  }

  const minimumApiLevel = asNumber(policy.minimumApiLevel);
  if (minimumApiLevel !== null && minimumApiLevel <= 0) {
    warnings.push(`minimumApiLevel=${minimumApiLevel} is <= 0 and likely ineffective`);
  }

  const oncProviders = asArray<JsonObject>(policy.oncCertificateProviders);
  oncProviders.forEach((provider, idx) => {
    const endpoint = asObject(provider.contentProviderEndpoint);
    if (!endpoint) return;
    const packageName = asString(endpoint.packageName)?.trim();
    if (packageName && !ANDROID_PACKAGE_NAME.test(packageName)) {
      errors.push(`oncCertificateProviders[${idx}].contentProviderEndpoint.packageName is not a valid package name`);
    }
    const signingCertsSha256 = asArray<string>(endpoint.signingCertsSha256)
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.trim())
      .filter(Boolean);
    if (signingCertsSha256.length === 0) {
      errors.push(`oncCertificateProviders[${idx}].contentProviderEndpoint.signingCertsSha256 is required`);
      return;
    }
    if (hasDuplicates(signingCertsSha256)) {
      errors.push(`oncCertificateProviders[${idx}].contentProviderEndpoint.signingCertsSha256 contains duplicates`);
    }
    signingCertsSha256.forEach((fp, fpIdx) => {
      if (!SHA256_HEX.test(fp)) {
        errors.push(`oncCertificateProviders[${idx}].contentProviderEndpoint.signingCertsSha256[${fpIdx}] must be 64 hex chars`);
      }
    });
  });

  return { errors, warnings };
}

export function assertValidAmapiPolicyPayload(payload: unknown): void {
  const result = validateAmapiPolicyPayload(payload);
  if (result.errors.length > 0) {
    throw new AmapiPolicyValidationError(result.errors);
  }
}
