type UnknownRecord = Record<string, unknown>;

export interface AmapiTelephonyInfo {
  phoneNumber?: string;
  carrierName?: string;
  iccId?: string;
  activationState?: string;
  configMode?: string;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function resolveAmapiDeviceImei(networkInfo: unknown): string | null {
  if (!isRecord(networkInfo)) return null;

  if (typeof networkInfo.imei === 'string') {
    return networkInfo.imei;
  }

  const legacyTelephonyInfo = networkInfo.telephonyInfo;
  if (!Array.isArray(legacyTelephonyInfo) || !isRecord(legacyTelephonyInfo[0])) {
    return null;
  }

  return typeof legacyTelephonyInfo[0].imei === 'string'
    ? legacyTelephonyInfo[0].imei
    : null;
}
