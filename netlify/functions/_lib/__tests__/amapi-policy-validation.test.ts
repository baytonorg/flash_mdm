import { describe, expect, it } from 'vitest';
import {
  AmapiPolicyValidationError,
  assertValidAmapiPolicyPayload,
  validateAmapiPolicyPayload,
} from '../amapi-policy-validation.js';

describe('amapi-policy-validation', () => {
  it('rejects setupAction launch app when app is not REQUIRED_FOR_SETUP', () => {
    const result = validateAmapiPolicyPayload({
      applications: [{ packageName: 'com.example.app', installType: 'FORCE_INSTALLED' }],
      setupActions: [{ launchApp: { packageName: 'com.example.app' } }],
    });

    expect(result.errors).toContain(
      'setupActions[0].launchApp.packageName=com.example.app requires applications[].installType=REQUIRED_FOR_SETUP'
    );
  });

  it('rejects more than one setupAction', () => {
    expect(() => assertValidAmapiPolicyPayload({
      setupActions: [{}, {}],
    })).toThrow(AmapiPolicyValidationError);
  });

  it('rejects more than 20 minimumVersionCode app entries', () => {
    const apps = Array.from({ length: 21 }, (_, i) => ({
      packageName: `com.example.${i}`,
      installType: 'AVAILABLE',
      minimumVersionCode: 1,
    }));

    const result = validateAmapiPolicyPayload({ applications: apps });
    expect(result.errors.some((e) => e.includes('AMAPI allows at most 20'))).toBe(true);
  });

  it('rejects private DNS host without matching specified-host mode', () => {
    const result = validateAmapiPolicyPayload({
      deviceConnectivityManagement: {
        privateDnsSettings: {
          privateDnsMode: 'PRIVATE_DNS_OPPORTUNISTIC',
          privateDnsHost: 'dns.example.com',
        },
      },
    });

    expect(result.errors).toContain(
      'deviceConnectivityManagement.privateDnsSettings.privateDnsHost must only be set when privateDnsMode=PRIVATE_DNS_SPECIFIED_HOST'
    );
  });

  it('accepts setupAction launch app when matching REQUIRED_FOR_SETUP app exists', () => {
    const result = validateAmapiPolicyPayload({
      applications: [{ packageName: 'com.example.setup', installType: 'REQUIRED_FOR_SETUP' }],
      setupActions: [{ launchApp: { packageName: 'com.example.setup' } }],
    });

    expect(result.errors).toHaveLength(0);
  });

  it('rejects CUSTOM installType when Play-managed fields are set and signing certs are missing', () => {
    const result = validateAmapiPolicyPayload({
      applications: [{
        packageName: 'com.example.custom',
        installType: 'CUSTOM',
        minimumVersionCode: 12,
        installPriority: 1,
      }],
    });

    expect(result.errors.some((e) => e.includes('requires signingKeyCerts'))).toBe(true);
    expect(result.errors.some((e) => e.includes('must not set minimumVersionCode'))).toBe(true);
    expect(result.errors.some((e) => e.includes('must not set installPriority'))).toBe(true);
  });

  it('rejects KIOSK installType conflicts with KIOSK role and multiple kiosk install types', () => {
    const result = validateAmapiPolicyPayload({
      applications: [
        { packageName: 'com.example.k1', installType: 'KIOSK' },
        { packageName: 'com.example.k2', installType: 'KIOSK', roles: [{ roleType: 'KIOSK' }] },
      ],
    });

    expect(result.errors.some((e) => e.includes('AMAPI allows at most 1'))).toBe(true);
    expect(result.errors.some((e) => e.includes('cannot be set when any application has KIOSK role'))).toBe(true);
  });

  it('rejects choosePrivateKeyRules when any app delegates CERT_SELECTION', () => {
    const result = validateAmapiPolicyPayload({
      choosePrivateKeyRules: [{ urlPattern: '*' }],
      applications: [{ packageName: 'com.example.app', delegatedScopes: ['CERT_SELECTION'] }],
    });

    expect(result.errors).toContain(
      'choosePrivateKeyRules must be empty when any application has delegatedScopes including CERT_SELECTION'
    );
  });

  it('rejects conflicting APN entries and invalid APN type/network type values', () => {
    const apn = {
      numericOperatorId: '310260',
      apn: 'internet',
      displayName: 'Internet',
      apnTypes: ['DEFAULT', 'DEFAULT'],
      networkTypes: ['NETWORK_TYPE_UNSPECIFIED'],
      protocol: 'IPV4V6',
      roamingProtocol: 'IPV4V6',
    };
    const result = validateAmapiPolicyPayload({
      deviceConnectivityManagement: {
        apnPolicy: {
          apnSettings: [apn, { ...apn, apnTypes: ['DEFAULT'] }],
        },
      },
    });

    expect(result.errors.some((e) => e.includes('apnTypes contains duplicates'))).toBe(true);
    expect(result.errors.some((e) => e.includes('networkTypes must not include NETWORK_TYPE_UNSPECIFIED'))).toBe(true);
    expect(result.errors.some((e) => e.includes('conflicts with apnSettings[0]'))).toBe(true);
  });

  it('rejects invalid/overlapping freeze periods and periods over 90 days', () => {
    const result = validateAmapiPolicyPayload({
      systemUpdate: {
        freezePeriods: [
          { startDate: { month: 1, day: 1 }, endDate: { month: 4, day: 5 } }, // > 90
          { startDate: { month: 4, day: 1 }, endDate: { month: 4, day: 10 } }, // overlaps first
        ],
      },
    });

    expect(result.errors.some((e) => e.includes('maximum is 90'))).toBe(true);
    expect(result.errors.some((e) => e.includes('overlaps'))).toBe(true);
  });

  it('rejects default app settings with invalid package names and missing/noncompliant applications entries', () => {
    const result = validateAmapiPolicyPayload({
      applications: [{ packageName: 'com.example.sms', installType: 'BLOCKED' }],
      defaultApplicationSettings: [{
        defaultApplicationType: 'DEFAULT_SMS',
        defaultApplicationScopes: ['SCOPE_WORK_PROFILE'],
        defaultApplications: [
          { packageName: 'bad package' },
          { packageName: 'com.example.sms' },
          { packageName: 'com.example.missing' },
        ],
      }],
    });

    expect(result.errors.some((e) => e.includes('invalid packageName'))).toBe(true);
    expect(result.errors.some((e) => e.includes('cannot be BLOCKED'))).toBe(true);
    expect(result.errors.some((e) => e.includes('must also exist in applications[]'))).toBe(true);
  });

  it('rejects compliance api level min <= 0, invalid personal work-off days, and deprecated passwordRequirements misuse', () => {
    const result = validateAmapiPolicyPayload({
      complianceRules: [{ apiLevelCondition: { minApiLevel: 0 } }],
      personalUsagePolicies: { maxDaysWithWorkOff: 2 },
      passwordRequirements: {
        requirePasswordUnlock: 'REQUIRE_EVERY_DAY',
        unifiedLockSettings: 'ALLOW_UNIFIED_WORK_AND_PERSONAL_LOCK',
        passwordQuality: 'COMPLEXITY_MEDIUM',
      },
    });

    expect(result.errors.some((e) => e.includes('minApiLevel must be > 0'))).toBe(true);
    expect(result.errors.some((e) => e.includes('maxDaysWithWorkOff=2 must be 0 or >= 3'))).toBe(true);
    expect(result.errors.some((e) => e.includes('requirePasswordUnlock must not be set'))).toBe(true);
    expect(result.errors.some((e) => e.includes('unifiedLockSettings must not be set'))).toBe(true);
    expect(result.errors.some((e) => e.includes('COMPLEXITY_MEDIUM'))).toBe(true);
  });

  it('rejects missing Wi-Fi roaming and SSID required fields', () => {
    const result = validateAmapiPolicyPayload({
      deviceConnectivityManagement: {
        wifiRoamingPolicy: {
          wifiRoamingSettings: [{ wifiSsid: '', wifiRoamingMode: '' }],
        },
        wifiSsidPolicy: {
          wifiSsidPolicyType: 'WIFI_SSID_ALLOWLIST',
          wifiSsids: [{ wifiSsid: '' }],
        },
      },
    });

    expect(result.errors.some((e) => e.includes('wifiRoamingSettings[0].wifiSsid is required'))).toBe(true);
    expect(result.errors.some((e) => e.includes('wifiRoamingSettings[0].wifiRoamingMode is required'))).toBe(true);
    expect(result.errors.some((e) => e.includes('wifiSsidPolicy.wifiSsids[0].wifiSsid is required'))).toBe(true);
  });

  it('rejects display mode/value dependency violations', () => {
    const result = validateAmapiPolicyPayload({
      displaySettings: {
        screenBrightnessSettings: {
          screenBrightnessMode: 'BRIGHTNESS_USER_CHOICE',
          screenBrightness: 100,
        },
        screenTimeoutSettings: {
          screenTimeoutMode: 'SCREEN_TIMEOUT_ENFORCED',
        },
      },
    });

    expect(result.errors.some((e) => e.includes('screenBrightness must not be set when screenBrightnessMode=BRIGHTNESS_USER_CHOICE'))).toBe(true);
    expect(result.errors.some((e) => e.includes('screenTimeout must be set when screenTimeoutMode=SCREEN_TIMEOUT_ENFORCED'))).toBe(true);
  });

  it('emits warnings for ignored-field interactions and irrelevant work account email', () => {
    const result = validateAmapiPolicyPayload({
      autoDateAndTimeZone: 'AUTO_DATE_AND_TIME_ZONE_ENFORCED',
      autoTimeRequired: true,
      configureWifi: 'ALLOW_CONFIGURING_WIFI',
      wifiConfigDisabled: true,
      workAccountSetupConfig: {
        authenticationType: 'AUTHENTICATION_TYPE_NOT_ENFORCED',
        requiredAccountEmail: 'user@example.com',
      },
    });

    expect(result.warnings.some((w) => w.includes('autoTimeRequired is ignored'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('wifiConfigDisabled is ignored'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('requiredAccountEmail is only relevant'))).toBe(true);
  });

  it('rejects invalid package lists and cross-profile contact/app-functions dependency violations', () => {
    const result = validateAmapiPolicyPayload({
      advancedSecurityOverrides: {
        personalAppsThatCanReadWorkNotifications: ['com.example.app', 'com.example.app', 'bad pkg'],
      },
      crossProfilePolicies: {
        crossProfileAppFunctions: 'CROSS_PROFILE_APP_FUNCTIONS_ALLOWED',
        showWorkContactsInPersonalProfile: 'SHOW_WORK_CONTACTS_IN_PERSONAL_PROFILE_UNSPECIFIED',
        exemptionsToShowWorkContactsInPersonalProfile: ['bad pkg', 'com.example.good', 'com.example.good'],
      },
      appFunctions: 'APP_FUNCTIONS_DISALLOWED',
      permittedInputMethods: ['com.example.ime', 'bad pkg'],
      permittedAccessibilityServices: ['com.example.a11y', 'com.example.a11y'],
    });

    expect(result.errors.some((e) => e.includes('personalAppsThatCanReadWorkNotifications contains duplicates'))).toBe(true);
    expect(result.errors.some((e) => e.includes('personalAppsThatCanReadWorkNotifications contains invalid package name'))).toBe(true);
    expect(result.errors.some((e) => e.includes('exemptionsToShowWorkContactsInPersonalProfile requires a supported'))).toBe(true);
    expect(result.errors.some((e) => e.includes('crossProfileAppFunctions=ALLOWED cannot be used'))).toBe(true);
    expect(result.errors.some((e) => e.includes('permittedInputMethods contains invalid package name'))).toBe(true);
    expect(result.errors.some((e) => e.includes('permittedAccessibilityServices contains duplicates'))).toBe(true);
  });

  it('rejects invalid ONC certificate provider signing certs and malformed choosePrivateKey regex', () => {
    const result = validateAmapiPolicyPayload({
      choosePrivateKeyRules: [{ urlPattern: '([a-z', packageNames: ['bad pkg'] }],
      oncCertificateProviders: [{
        contentProviderEndpoint: {
          packageName: 'bad pkg',
          signingCertsSha256: ['abc', 'abc'],
        },
      }],
    });

    expect(result.errors.some((e) => e.includes('urlPattern is not a valid regex'))).toBe(true);
    expect(result.errors.some((e) => e.includes('choosePrivateKeyRules[0].packageNames contains invalid package name'))).toBe(true);
    expect(result.errors.some((e) => e.includes('contentProviderEndpoint.packageName is not a valid package name'))).toBe(true);
    expect(result.errors.some((e) => e.includes('signingCertsSha256 contains duplicates'))).toBe(true);
    expect(result.errors.some((e) => e.includes('must be 64 hex chars'))).toBe(true);
  });

  it('rejects negative maximumTimeToLock and warns on low minimumApiLevel / negative allowedDaysWithoutUpdate', () => {
    const result = validateAmapiPolicyPayload({
      maximumTimeToLock: -1,
      minimumApiLevel: 0,
      systemUpdate: { allowedDaysWithoutUpdate: -5 },
    });

    expect(result.errors).toContain('maximumTimeToLock=-1 must be >= 0');
    expect(result.warnings.some((w) => w.includes('minimumApiLevel=0'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('allowedDaysWithoutUpdate=-5'))).toBe(true);
  });

  it('emits advisory warnings for commonCriteriaMode, stayOnPluggedModes, and duplicate persistent preferred filters', () => {
    const result = validateAmapiPolicyPayload({
      advancedSecurityOverrides: { commonCriteriaMode: 'COMMON_CRITERIA_MODE_ENABLED' },
      maximumTimeToLock: 30000,
      stayOnPluggedModes: ['AC', 'AC'],
      persistentPreferredActivities: [
        { actions: ['android.intent.action.MAIN', 'android.intent.action.MAIN'], categories: ['android.intent.category.DEFAULT', 'android.intent.category.DEFAULT'] },
      ],
      workAccountSetupConfig: {},
      complianceRules: [{ apiLevelCondition: {} }],
    });

    expect(result.warnings.some((w) => w.includes('commonCriteriaMode'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('stayOnPluggedModes contains duplicates'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('recommend clearing maximumTimeToLock'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('persistentPreferredActivities[0].actions contains duplicates'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('persistentPreferredActivities[0].categories contains duplicates'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('workAccountSetupConfig is present but empty'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('apiLevelCondition is present without minApiLevel'))).toBe(true);
  });
});
