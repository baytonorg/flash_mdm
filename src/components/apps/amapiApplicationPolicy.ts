export function normalizeAppPolicyForInstallType(
  value: Record<string, unknown>,
  installType: string,
): Record<string, unknown> {
  const next = { ...value };
  const customAppConfig = next.customAppConfig;
  const hasCustomAppConfigObject = !!customAppConfig && typeof customAppConfig === 'object' && !Array.isArray(customAppConfig);

  if (installType === 'CUSTOM') {
    if (!hasCustomAppConfigObject) next.customAppConfig = {};
  } else {
    delete next.customAppConfig;
  }

  return next;
}
