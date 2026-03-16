export interface WorkspaceLicenseSettingsResponse {
  workspace_id: string;
  settings: {
    platform_licensing_enabled: boolean;
    workspace_licensing_enabled: boolean;
    effective_licensing_enabled: boolean;
    inherit_platform_free_tier: boolean;
    free_enabled: boolean;
    free_seat_limit: number;
    workspace_free_enabled: boolean;
    workspace_free_seat_limit: number;
    platform_default_free_enabled: boolean;
    platform_default_free_seat_limit: number;
    billing_method: 'stripe' | 'invoice' | 'disabled';
    customer_owner_enabled: boolean;
    grace_day_block: number;
    grace_day_disable: number;
    grace_day_wipe: number;
  };
}
