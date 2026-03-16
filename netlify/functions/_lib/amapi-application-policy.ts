const SHA256_HEX = /^[a-fA-F0-9]{64}$/;

export const AMAPI_APPLICATION_INSTALL_TYPES = [
  'INSTALL_TYPE_UNSPECIFIED',
  'PREINSTALLED',
  'FORCE_INSTALLED',
  'BLOCKED',
  'AVAILABLE',
  'REQUIRED_FOR_SETUP',
  'KIOSK',
  'CUSTOM',
] as const;

export type AmapiApplicationInstallType = (typeof AMAPI_APPLICATION_INSTALL_TYPES)[number];

export function isAmapiApplicationInstallType(value: unknown): value is AmapiApplicationInstallType {
  return typeof value === 'string' && (AMAPI_APPLICATION_INSTALL_TYPES as readonly string[]).includes(value);
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function hasDuplicates(values: string[]): boolean {
  return new Set(values).size !== values.length;
}

export function validateAmapiApplicationPolicyFragment(value: unknown): string[] {
  const errors: string[] = [];
  const appPolicy = asObject(value);
  if (!appPolicy) return errors;

  const installConstraint = asArray(appPolicy.installConstraint);
  if (installConstraint.length > 1) {
    errors.push('app_policy.installConstraint allows at most 1 item (AMAPI rejects multiple constraints)');
  }

  if (typeof appPolicy.installPriority === 'number' && Number.isFinite(appPolicy.installPriority)) {
    if (appPolicy.installPriority < 0 || appPolicy.installPriority > 10000) {
      errors.push('app_policy.installPriority must be between 0 and 10000 inclusive');
    }
  }

  const roles = asArray<Record<string, unknown>>(appPolicy.roles);
  const roleTypes: string[] = [];
  roles.forEach((role, idx) => {
    const roleType = asString(role?.roleType);
    if (!roleType) {
      errors.push(`app_policy.roles[${idx}].roleType is required`);
      return;
    }
    if (roleType === 'ROLE_TYPE_UNSPECIFIED') {
      errors.push(`app_policy.roles[${idx}].roleType cannot be ROLE_TYPE_UNSPECIFIED`);
    }
    roleTypes.push(roleType);
  });
  if (roleTypes.length > 0 && hasDuplicates(roleTypes)) {
    errors.push('app_policy.roles contains duplicate roleType values');
  }

  const signingKeyCerts = asArray(appPolicy.signingKeyCerts);
  signingKeyCerts.forEach((cert, idx) => {
    if (typeof cert === 'string') {
      const fp = cert.trim();
      if (fp && !SHA256_HEX.test(fp)) {
        errors.push(`app_policy.signingKeyCerts[${idx}] must be a 64-char SHA-256 hex fingerprint`);
      }
      return;
    }

    const certObj = asObject(cert);
    if (!certObj) return;
    const fp = asString(certObj.signingKeyCertFingerprintSha256)?.trim();
    if (fp && !SHA256_HEX.test(fp)) {
      errors.push(`app_policy.signingKeyCerts[${idx}].signingKeyCertFingerprintSha256 must be 64 hex chars`);
    }
  });

  const ext = asObject(appPolicy.extensionConfig);
  const extFingerprints = asArray<string>(ext?.signingKeyFingerprintsSha256)
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter(Boolean);
  extFingerprints.forEach((fp, idx) => {
    if (!SHA256_HEX.test(fp)) {
      errors.push(`app_policy.extensionConfig.signingKeyFingerprintsSha256[${idx}] must be 64 hex chars`);
    }
  });

  return errors;
}
