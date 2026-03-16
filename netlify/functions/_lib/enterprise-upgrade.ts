export interface EnterpriseUpgradeDetails {
  enterpriseType?: string;
  managedGooglePlayAccountsEnterpriseType?: string;
  managedGoogleDomainType?: string;
}

export interface EnterpriseUpgradeStatus {
  enterprise_type: string;
  eligible_for_upgrade: boolean;
  managed_google_play_accounts_enterprise_type: string | null;
  managed_google_domain_type: string | null;
  refreshed_at: string;
}

export function buildEnterpriseUpgradeStatus(
  enterprise: EnterpriseUpgradeDetails,
  refreshedAt: string = new Date().toISOString()
): EnterpriseUpgradeStatus {
  const enterpriseType = enterprise.enterpriseType ?? 'ENTERPRISE_TYPE_UNSPECIFIED';
  return {
    enterprise_type: enterpriseType,
    eligible_for_upgrade: enterpriseType === 'MANAGED_GOOGLE_PLAY_ACCOUNTS_ENTERPRISE',
    managed_google_play_accounts_enterprise_type:
      enterprise.managedGooglePlayAccountsEnterpriseType ?? null,
    managed_google_domain_type: enterprise.managedGoogleDomainType ?? null,
    refreshed_at: refreshedAt,
  };
}
