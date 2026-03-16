/**
 * Shared helpers for merging ONC (Wi-Fi) and APN network deployments, and
 * application deployments, into a policy config object.
 *
 * Used by both `network-deploy.ts` (direct deploy) and `policy-generation.ts`
 * (generated payload). Keeping a single implementation prevents drift.
 */

// ── ONC (Wi-Fi) ─────────────────────────────────────────────────────────────

export function upsertOncDeploymentInPolicyConfig(
  config: Record<string, unknown>,
  deploymentDocument: Record<string, unknown>
): boolean {
  const previousValue = config.openNetworkConfiguration;
  const existingDoc = parseOncDocument(previousValue);
  const incomingDoc = parseOncDocument(deploymentDocument);

  const nextNetworks = Array.isArray(existingDoc.NetworkConfigurations)
    ? [...existingDoc.NetworkConfigurations]
    : [];
  const incomingNetworks = Array.isArray(incomingDoc.NetworkConfigurations)
    ? [...incomingDoc.NetworkConfigurations]
    : [];

  for (const profile of incomingNetworks) {
    const nextProfileKey = String((profile as any)?.GUID ?? '');
    const nextWifi = (profile as any)?.WiFi ?? {};
    const nextSsid = typeof nextWifi.SSID === 'string' ? nextWifi.SSID : null;
    const existingIndex = nextNetworks.findIndex((entry: any) => {
      if (nextProfileKey && entry?.GUID === nextProfileKey) return true;
      const entrySsid = entry?.WiFi?.SSID;
      return !!nextSsid && typeof entrySsid === 'string' && entrySsid === nextSsid;
    });
    if (existingIndex >= 0) nextNetworks[existingIndex] = profile as Record<string, unknown>;
    else nextNetworks.push(profile as Record<string, unknown>);
  }

  const nextDoc: Record<string, unknown> = {
    Type: 'UnencryptedConfiguration',
    ...existingDoc,
    ...incomingDoc,
    NetworkConfigurations: nextNetworks,
  };

  // AMAPI openNetworkConfiguration is a Struct (JSON object), not a string.
  // Compare serialized forms for change-detection, but store as an object.
  const previousNormalized = parseOncDocument(previousValue);
  if (JSON.stringify(nextDoc) === JSON.stringify(previousNormalized)) return false;

  config.openNetworkConfiguration = nextDoc;
  return true;
}

// ── APN ──────────────────────────────────────────────────────────────────────

export function upsertApnDeploymentInPolicyConfig(
  config: Record<string, unknown>,
  incomingApnPolicy: Record<string, unknown>
): boolean {
  const previousValue = ((config.deviceConnectivityManagement as any)?.apnPolicy) ?? null;
  const existingPolicy = parseApnPolicy(previousValue);
  const nextSettings = Array.isArray(existingPolicy.apnSettings) ? [...existingPolicy.apnSettings] : [];
  const incomingSettings = Array.isArray(incomingApnPolicy.apnSettings) ? incomingApnPolicy.apnSettings : [];

  for (const setting of incomingSettings) {
    const key = getApnSettingKey(setting);
    const existingIndex = nextSettings.findIndex((entry: any) => getApnSettingKey(entry) === key);
    if (existingIndex >= 0) nextSettings[existingIndex] = setting as Record<string, unknown>;
    else nextSettings.push(setting as Record<string, unknown>);
  }

  const nextPolicy: Record<string, unknown> = {
    ...existingPolicy,
    ...incomingApnPolicy,
    apnSettings: nextSettings,
  };
  if (!('overrideApns' in incomingApnPolicy) && 'overrideApns' in existingPolicy) {
    nextPolicy.overrideApns = existingPolicy.overrideApns;
  }

  const previousSerialized = JSON.stringify(previousValue ?? null);
  const nextSerialized = JSON.stringify(nextPolicy);
  if (nextSerialized === previousSerialized) return false;

  const dcm = (config.deviceConnectivityManagement && typeof config.deviceConnectivityManagement === 'object' && !Array.isArray(config.deviceConnectivityManagement))
    ? { ...(config.deviceConnectivityManagement as Record<string, unknown>) }
    : {};
  dcm.apnPolicy = nextPolicy;
  config.deviceConnectivityManagement = dcm;
  return true;
}

// ── Parsers ──────────────────────────────────────────────────────────────────

export function parseOncDocument(
  value: unknown
): Record<string, unknown> & { Type?: string; NetworkConfigurations?: Array<Record<string, unknown>> } {
  if (!value) return { Type: 'UnencryptedConfiguration', NetworkConfigurations: [] };
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown> & { Type?: string; NetworkConfigurations?: Array<Record<string, unknown>> };
    }
  } catch {
    // fall through
  }
  return { Type: 'UnencryptedConfiguration', NetworkConfigurations: [] };
}

export function parseApnPolicy(
  value: unknown
): Record<string, unknown> & { overrideApns?: string; apnSettings?: Array<Record<string, unknown>> } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { apnSettings: [] };
  }
  return value as Record<string, unknown> & { overrideApns?: string; apnSettings?: Array<Record<string, unknown>> };
}

export function getApnSettingKey(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const apn = value as Record<string, unknown>;
  const name = typeof apn.displayName === 'string' ? apn.displayName.trim().toLowerCase()
    : typeof apn.name === 'string' ? apn.name.trim().toLowerCase() : '';
  const apnValue = typeof apn.apn === 'string' ? apn.apn.trim().toLowerCase() : '';
  const operator = typeof apn.numericOperatorId === 'string' ? apn.numericOperatorId.trim() : '';
  return [name, apnValue, operator].join('|');
}

// ── Removal helpers (for delete flow) ───────────────────────────────────────

/**
 * Remove a WiFi network entry from `openNetworkConfiguration` by GUID or SSID.
 * Returns true if the config was modified.
 */
export function removeOncDeploymentFromPolicyConfig(
  config: Record<string, unknown>,
  guid: string,
  ssid: string
): boolean {
  const doc = parseOncDocument(config.openNetworkConfiguration);
  const networks = Array.isArray(doc.NetworkConfigurations) ? [...doc.NetworkConfigurations] : [];
  const idx = networks.findIndex((entry: any) => {
    if (guid && entry?.GUID === guid) return true;
    const entrySsid = entry?.WiFi?.SSID;
    return !!ssid && typeof entrySsid === 'string' && entrySsid === ssid;
  });
  if (idx < 0) return false;

  networks.splice(idx, 1);
  if (networks.length === 0) {
    delete config.openNetworkConfiguration;
  } else {
    config.openNetworkConfiguration = {
      ...doc,
      NetworkConfigurations: networks,
    };
  }
  return true;
}

/**
 * Remove an APN setting entry from `deviceConnectivityManagement.apnPolicy`
 * by its composite key (name|apn|numericOperatorId).
 * Returns true if the config was modified.
 */
export function removeApnDeploymentFromPolicyConfig(
  config: Record<string, unknown>,
  apnSettingKey: string
): boolean {
  const existingPolicy = parseApnPolicy(
    ((config.deviceConnectivityManagement as any)?.apnPolicy) ?? null
  );
  const settings = Array.isArray(existingPolicy.apnSettings) ? [...existingPolicy.apnSettings] : [];
  const idx = settings.findIndex((entry: any) => getApnSettingKey(entry) === apnSettingKey);
  if (idx < 0) return false;

  settings.splice(idx, 1);
  if (settings.length === 0) {
    // Remove the entire apnPolicy / deviceConnectivityManagement if empty
    if (config.deviceConnectivityManagement && typeof config.deviceConnectivityManagement === 'object') {
      const dcm = { ...(config.deviceConnectivityManagement as Record<string, unknown>) };
      delete dcm.apnPolicy;
      if (Object.keys(dcm).length === 0) {
        delete config.deviceConnectivityManagement;
      } else {
        config.deviceConnectivityManagement = dcm;
      }
    }
  } else {
    const dcm = (config.deviceConnectivityManagement && typeof config.deviceConnectivityManagement === 'object')
      ? { ...(config.deviceConnectivityManagement as Record<string, unknown>) }
      : {};
    dcm.apnPolicy = { ...existingPolicy, apnSettings: settings };
    config.deviceConnectivityManagement = dcm;
  }
  return true;
}
