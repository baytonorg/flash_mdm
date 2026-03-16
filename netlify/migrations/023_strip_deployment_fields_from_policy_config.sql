-- Remove deployment-managed fields (openNetworkConfiguration, deviceConnectivityManagement)
-- from policies.config. These are always regenerated from network_deployments at derivative
-- build time, and stale entries were left behind when network deployments were deleted.
UPDATE policies
SET config = config - 'openNetworkConfiguration' - 'deviceConnectivityManagement',
    updated_at = now()
WHERE config ? 'openNetworkConfiguration'
   OR config ? 'deviceConnectivityManagement';
