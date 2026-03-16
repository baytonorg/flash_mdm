import { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Wifi, X, Code2, FormInput, Pencil, Trash2 } from 'lucide-react';
import { useContextStore } from '@/stores/context';
import AppScopeSelector from '@/components/apps/AppScopeSelector';
import { useDeployNetwork, useNetworkDeployments, useUpdateNetworkDeployment, useDeleteNetworkDeployment, useBulkNetworkAction } from '@/api/queries/networks';
import type { NetworkDeployment } from '@/api/queries/networks';
import BulkActionBar, { type BulkAction } from '@/components/common/BulkActionBar';
import SelectAllMatchingNotice from '@/components/common/SelectAllMatchingNotice';
import { useBulkSelection } from '@/hooks/useBulkSelection';

type ScopeValue = { scope_type: 'environment' | 'group' | 'device'; scope_id: string };
type EditorMode = 'form' | 'json';
type NetworkKind = 'wifi' | 'apn';
type WifiSecurityMode = 'OPEN' | 'WPA_PSK' | 'WPA_EAP';
type EapOuter = 'PEAP' | 'EAP-TTLS' | 'EAP-TLS';
type EapInner = 'Automatic' | 'MSCHAPv2' | 'PAP' | 'CHAP';
type ApnAuthType = 'AUTH_TYPE_UNSPECIFIED' | 'NONE' | 'PAP' | 'CHAP' | 'PAP_OR_CHAP';
type ApnProtocol = 'PROTOCOL_UNSPECIFIED' | 'IPV4' | 'IPV6' | 'IPV4V6';
type ApnMvnoType = 'MVNO_TYPE_UNSPECIFIED' | 'GID' | 'ICCID' | 'IMSI' | 'SPN';
type ApnAlwaysOn = 'ALWAYS_ON_UNSPECIFIED' | 'ENABLED' | 'DISABLED';

type OncDoc = Record<string, unknown>;
type ApnPolicyDoc = Record<string, unknown>;

const APN_TYPE_OPTIONS = [
  'DEFAULT',
  'MMS',
  'SUPL',
  'DUN',
  'HIPRI',
  'FOTA',
  'IMS',
  'CBS',
  'IA',
  'EMERGENCY',
  'MCX',
  'XCAP',
  'VSIM',
  'BIP',
  'ENTERPRISE',
] as const;

const NETWORK_TYPE_OPTIONS = [
  'NETWORK_TYPE_BITMASK_UNSPECIFIED',
  'BITMASK_2G',
  'BITMASK_3G',
  'BITMASK_4G',
  'BITMASK_5G',
] as const;

export default function Networks() {
  const activeEnvironment = useContextStore((s) => s.activeEnvironment);
  const environmentId = activeEnvironment?.id;

  const [modalOpen, setModalOpen] = useState(false);
  const [networkKind, setNetworkKind] = useState<NetworkKind>('wifi');
  const [name, setName] = useState('');

  const [ssid, setSsid] = useState('');
  const [hiddenSsid, setHiddenSsid] = useState(false);
  const [autoConnect, setAutoConnect] = useState(true);
  const [securityMode, setSecurityMode] = useState<WifiSecurityMode>('OPEN');
  const [passphrase, setPassphrase] = useState('');
  const [eapOuter, setEapOuter] = useState<EapOuter>('PEAP');
  const [eapInner, setEapInner] = useState<EapInner>('MSCHAPv2');
  const [eapIdentity, setEapIdentity] = useState('');
  const [eapAnonymousIdentity, setEapAnonymousIdentity] = useState('');
  const [eapPassword, setEapPassword] = useState('');
  const [eapServerCaRefs, setEapServerCaRefs] = useState('');

  const [apnOverrideApns, setApnOverrideApns] = useState('OVERRIDE_APNS_UNSPECIFIED');
  const [apnEntryName, setApnEntryName] = useState('');
  const [apnValue, setApnValue] = useState('');
  const [apnTypes, setApnTypes] = useState<string[]>(['DEFAULT']);
  const [apnAuthType, setApnAuthType] = useState<ApnAuthType>('AUTH_TYPE_UNSPECIFIED');
  const [apnUser, setApnUser] = useState('');
  const [apnPassword, setApnPassword] = useState('');
  const [apnServer, setApnServer] = useState('');
  const [apnProxyAddress, setApnProxyAddress] = useState('');
  const [apnProxyPort, setApnProxyPort] = useState('');
  const [apnMmsc, setApnMmsc] = useState('');
  const [apnMmsProxyAddress, setApnMmsProxyAddress] = useState('');
  const [apnMmsProxyPort, setApnMmsProxyPort] = useState('');
  const [apnProtocol, setApnProtocol] = useState<ApnProtocol>('PROTOCOL_UNSPECIFIED');
  const [apnRoamingProtocol, setApnRoamingProtocol] = useState<ApnProtocol>('PROTOCOL_UNSPECIFIED');
  const [apnNumericOperatorId, setApnNumericOperatorId] = useState('');
  const [apnCarrierId, setApnCarrierId] = useState('');
  const [apnMvnoType, setApnMvnoType] = useState<ApnMvnoType>('MVNO_TYPE_UNSPECIFIED');
  const [apnMvnoMatchData, setApnMvnoMatchData] = useState('');
  const [apnNetworkTypes, setApnNetworkTypes] = useState<string[]>([]);
  const [apnMtuV4, setApnMtuV4] = useState('');
  const [apnMtuV6, setApnMtuV6] = useState('');
  const [apnAlwaysOn, setApnAlwaysOn] = useState<ApnAlwaysOn>('ALWAYS_ON_UNSPECIFIED');

  const [editorMode, setEditorMode] = useState<EditorMode>('form');
  const [jsonOverride, setJsonOverride] = useState('');
  const [jsonDirty, setJsonDirty] = useState(false);
  const [scope, setScope] = useState<ScopeValue>({
    scope_type: 'environment',
    scope_id: environmentId ?? '',
  });
  const [lastAmapiSummary, setLastAmapiSummary] = useState<string | null>(null);

  const [editingDeployment, setEditingDeployment] = useState<NetworkDeployment | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Reset local state on environment switch
  useEffect(() => {
    setModalOpen(false);
    setEditingDeployment(null);
    setDeleteConfirmId(null);
  }, [environmentId]);

  const deploymentsQuery = useNetworkDeployments(environmentId);
  const deployMutation = useDeployNetwork();
  const updateMutation = useUpdateNetworkDeployment();
  const deleteMutation = useDeleteNetworkDeployment();
  const bulkNetworkAction = useBulkNetworkAction();
  const deployments = deploymentsQuery.data ?? [];
  const bulkSelection = useBulkSelection<NetworkDeployment>({
    rows: deployments,
    rowKey: (row) => row.id,
    totalMatching: deployments.length,
  });

  const structuredOncDoc = useMemo<OncDoc>(
    () =>
      buildStructuredWifiOncDoc({
        scopeType: scope.scope_type,
        scopeId: scope.scope_id,
        ssid: ssid.trim(),
        name: name.trim() || ssid.trim() || 'Wi-Fi Profile',
        hiddenSsid,
        autoConnect,
        securityMode,
        passphrase,
        eapOuter,
        eapInner,
        eapIdentity,
        eapAnonymousIdentity,
        eapPassword,
        eapServerCaRefs,
      }),
    [
      scope.scope_type,
      scope.scope_id,
      ssid,
      name,
      hiddenSsid,
      autoConnect,
      securityMode,
      passphrase,
      eapOuter,
      eapInner,
      eapIdentity,
      eapAnonymousIdentity,
      eapPassword,
      eapServerCaRefs,
    ]
  );

  const structuredApnPolicy = useMemo<ApnPolicyDoc>(
    () =>
      buildStructuredApnPolicy({
        overrideApns: apnOverrideApns,
        entryName: apnEntryName,
        apnValue,
        apnTypes,
        authenticationType: apnAuthType,
        user: apnUser,
        password: apnPassword,
        server: apnServer,
        proxyAddress: apnProxyAddress,
        proxyPort: apnProxyPort,
        mmsc: apnMmsc,
        mmsProxyAddress: apnMmsProxyAddress,
        mmsProxyPort: apnMmsProxyPort,
        protocol: apnProtocol,
        roamingProtocol: apnRoamingProtocol,
        numericOperatorId: apnNumericOperatorId,
        carrierId: apnCarrierId,
        mvnoType: apnMvnoType,
        mvnoMatchData: apnMvnoMatchData,
        networkTypes: apnNetworkTypes,
        mtuV4: apnMtuV4,
        mtuV6: apnMtuV6,
        alwaysOn: apnAlwaysOn,
      }),
    [
      apnOverrideApns,
      apnEntryName,
      apnValue,
      apnTypes,
      apnAuthType,
      apnUser,
      apnPassword,
      apnServer,
      apnProxyAddress,
      apnProxyPort,
      apnMmsc,
      apnMmsProxyAddress,
      apnMmsProxyPort,
      apnProtocol,
      apnRoamingProtocol,
      apnNumericOperatorId,
      apnCarrierId,
      apnMvnoType,
      apnMvnoMatchData,
      apnNetworkTypes,
      apnMtuV4,
      apnMtuV6,
      apnAlwaysOn,
    ]
  );

  const structuredPreviewText = useMemo(
    () => JSON.stringify(networkKind === 'wifi' ? structuredOncDoc : structuredApnPolicy, null, 2),
    [networkKind, structuredOncDoc, structuredApnPolicy]
  );

  useEffect(() => {
    if (!jsonDirty) setJsonOverride(structuredPreviewText);
  }, [structuredPreviewText, jsonDirty]);

  const wifiJsonValidation = useMemo(() => validateOncJson(jsonOverride), [jsonOverride]);
  const apnJsonValidation = useMemo(() => validateApnPolicyJson(jsonOverride), [jsonOverride]);
  const activeJsonValidation = networkKind === 'wifi' ? wifiJsonValidation : apnJsonValidation;

  const openCreate = () => {
    setNetworkKind('wifi');
    setName('');

    setSsid('');
    setHiddenSsid(false);
    setAutoConnect(true);
    setSecurityMode('OPEN');
    setPassphrase('');
    setEapOuter('PEAP');
    setEapInner('MSCHAPv2');
    setEapIdentity('');
    setEapAnonymousIdentity('');
    setEapPassword('');
    setEapServerCaRefs('');

    setApnOverrideApns('OVERRIDE_APNS_UNSPECIFIED');
    setApnEntryName('');
    setApnValue('');
    setApnTypes(['DEFAULT']);
    setApnAuthType('AUTH_TYPE_UNSPECIFIED');
    setApnUser('');
    setApnPassword('');
    setApnServer('');
    setApnProxyAddress('');
    setApnProxyPort('');
    setApnMmsc('');
    setApnMmsProxyAddress('');
    setApnMmsProxyPort('');
    setApnProtocol('PROTOCOL_UNSPECIFIED');
    setApnRoamingProtocol('PROTOCOL_UNSPECIFIED');
    setApnNumericOperatorId('');
    setApnCarrierId('');
    setApnMvnoType('MVNO_TYPE_UNSPECIFIED');
    setApnMvnoMatchData('');
    setApnNetworkTypes([]);
    setApnMtuV4('');
    setApnMtuV6('');
    setApnAlwaysOn('ALWAYS_ON_UNSPECIFIED');

    setEditorMode('form');
    setJsonDirty(false);
    setJsonOverride('');
    setScope({ scope_type: 'environment', scope_id: environmentId ?? '' });
    setEditingDeployment(null);
    setModalOpen(true);
  };

  const openEdit = (dep: NetworkDeployment) => {
    const kind = inferDeploymentKind(dep.network_type, dep.onc_profile);
    setNetworkKind(kind === 'apn' ? 'apn' : 'wifi');
    setName(dep.name);
    setScope({ scope_type: dep.scope_type, scope_id: dep.scope_id });
    setHiddenSsid(dep.hidden_ssid);
    setAutoConnect(dep.auto_connect);

    if (kind === 'wifi') {
      // Extract WiFi form fields from stored ONC profile
      const wifiMeta = extractWifiFormFields(dep.onc_profile);
      setSsid(wifiMeta.ssid);
      setSecurityMode(wifiMeta.securityMode);
      setPassphrase(wifiMeta.passphrase);
      setEapOuter(wifiMeta.eapOuter);
      setEapInner(wifiMeta.eapInner);
      setEapIdentity(wifiMeta.eapIdentity);
      setEapAnonymousIdentity(wifiMeta.eapAnonymousIdentity);
      setEapPassword(wifiMeta.eapPassword);
      setEapServerCaRefs(wifiMeta.eapServerCaRefs);

      // Pre-fill JSON editor too
      setJsonOverride(JSON.stringify(dep.onc_profile, null, 2));
    } else {
      // Extract APN form fields from stored profile
      const apnProfile = (dep.onc_profile as any)?.kind === 'apnPolicy'
        ? (dep.onc_profile as any).apnPolicy
        : ((dep.onc_profile as any)?.apnPolicy ?? dep.onc_profile);
      const apnMeta = extractApnFormFields(apnProfile);
      setApnOverrideApns(apnMeta.overrideApns);
      setApnEntryName(apnMeta.entryName);
      setApnValue(apnMeta.apnValue);
      setApnTypes(apnMeta.apnTypes);
      setApnAuthType(apnMeta.authType);
      setApnUser(apnMeta.user);
      setApnPassword(apnMeta.password);
      setApnServer(apnMeta.server);
      setApnProxyAddress(apnMeta.proxyAddress);
      setApnProxyPort(apnMeta.proxyPort);
      setApnMmsc(apnMeta.mmsc);
      setApnMmsProxyAddress(apnMeta.mmsProxyAddress);
      setApnMmsProxyPort(apnMeta.mmsProxyPort);
      setApnProtocol(apnMeta.protocol);
      setApnRoamingProtocol(apnMeta.roamingProtocol);
      setApnNumericOperatorId(apnMeta.numericOperatorId);
      setApnCarrierId(apnMeta.carrierId);
      setApnMvnoType(apnMeta.mvnoType);
      setApnMvnoMatchData(apnMeta.mvnoMatchData);
      setApnNetworkTypes(apnMeta.networkTypes);
      setApnMtuV4(apnMeta.mtuV4);
      setApnMtuV6(apnMeta.mtuV6);
      setApnAlwaysOn(apnMeta.alwaysOn);

      // Pre-fill JSON editor too
      setJsonOverride(JSON.stringify(apnProfile, null, 2));
    }

    setEditorMode('form');
    setJsonDirty(false);
    setEditingDeployment(dep);
    setModalOpen(true);
  };

  const handleDelete = (dep: NetworkDeployment) => {
    if (!environmentId) return;
    deleteMutation.mutate(
      { id: dep.id, environment_id: environmentId },
      {
        onSuccess: (data) => {
          const sync = data.amapi_sync;
          setLastAmapiSummary(
            `Deleted: AMAPI sync: ${sync.synced}/${sync.attempted} policies synced${sync.failed ? `, ${sync.failed} failed` : ''}${sync.skipped_reason ? ` (${sync.skipped_reason})` : ''}`
          );
          setDeleteConfirmId(null);
        },
        onError: () => {
          setDeleteConfirmId(null);
        },
      }
    );
  };

  const handleUpdate = () => {
    if (!environmentId || !editingDeployment) return;
    const kind = inferDeploymentKind(editingDeployment.network_type, editingDeployment.onc_profile);

    const onUpdateSuccess = (data: { amapi_sync: { synced: number; attempted: number; failed: number; skipped_reason?: string | null } }) => {
      const sync = data.amapi_sync;
      setLastAmapiSummary(
        `Updated: AMAPI sync: ${sync.synced}/${sync.attempted} policies synced${sync.failed ? `, ${sync.failed} failed` : ''}${sync.skipped_reason ? ` (${sync.skipped_reason})` : ''}`
      );
      setModalOpen(false);
      setEditingDeployment(null);
    };

    if (kind === 'wifi') {
      const chosenDoc = editorMode === 'json' ? (wifiJsonValidation.ok ? wifiJsonValidation.doc : null) : structuredOncDoc;
      if (!chosenDoc) return;
      const primary = extractPrimaryWifiMeta(chosenDoc);
      if (!primary.ok) return;
      updateMutation.mutate(
        {
          id: editingDeployment.id,
          environment_id: environmentId,
          name: name.trim() || primary.name || editingDeployment.name,
          onc_document: chosenDoc,
          hidden_ssid: primary.hiddenSsid,
          auto_connect: primary.autoConnect,
        },
        { onSuccess: onUpdateSuccess }
      );
    } else {
      const chosenApnPolicy = editorMode === 'json' ? (apnJsonValidation.ok ? apnJsonValidation.policy : null) : structuredApnPolicy;
      if (!chosenApnPolicy) return;
      const primaryApn = extractPrimaryApnMeta(chosenApnPolicy);
      if (!primaryApn.ok) return;
      updateMutation.mutate(
        {
          id: editingDeployment.id,
          environment_id: environmentId,
          name: name.trim() || primaryApn.name || editingDeployment.name,
          apn_policy: chosenApnPolicy,
        },
        { onSuccess: onUpdateSuccess }
      );
    }
  };

  const handleCreate = () => {
    if (!environmentId || !scope.scope_id) return;

    if (networkKind === 'wifi') {
      const chosenDoc = editorMode === 'json' ? (wifiJsonValidation.ok ? wifiJsonValidation.doc : null) : structuredOncDoc;
      if (!chosenDoc) return;
      const primary = extractPrimaryWifiMeta(chosenDoc);
      if (!primary.ok) return;

      deployMutation.mutate(
        {
          environment_id: environmentId,
          network_type: 'wifi',
          name: name.trim() || primary.name || primary.ssid,
          ssid: primary.ssid,
          hidden_ssid: primary.hiddenSsid,
          auto_connect: primary.autoConnect,
          onc_document: chosenDoc,
          scope_type: scope.scope_type,
          scope_id: scope.scope_id,
        },
        {
          onSuccess: (data) => {
            const sync = data.amapi_sync;
            setLastAmapiSummary(
              `AMAPI sync: ${sync.synced}/${sync.attempted} policies synced${sync.failed ? `, ${sync.failed} failed` : ''}${sync.skipped_reason ? ` (${sync.skipped_reason})` : ''}`
            );
            setModalOpen(false);
          },
        }
      );
      return;
    }

    const chosenApnPolicy = editorMode === 'json' ? (apnJsonValidation.ok ? apnJsonValidation.policy : null) : structuredApnPolicy;
    if (!chosenApnPolicy) return;
    const primaryApn = extractPrimaryApnMeta(chosenApnPolicy);
    if (!primaryApn.ok) return;

    deployMutation.mutate(
      {
        environment_id: environmentId,
        network_type: 'apn',
        name: name.trim() || primaryApn.name,
        apn_policy: chosenApnPolicy,
        scope_type: scope.scope_type,
        scope_id: scope.scope_id,
      },
      {
        onSuccess: (data) => {
          const sync = data.amapi_sync;
          setLastAmapiSummary(
            `AMAPI sync: ${sync.synced}/${sync.attempted} policies synced${sync.failed ? `, ${sync.failed} failed` : ''}${sync.skipped_reason ? ` (${sync.skipped_reason})` : ''}`
          );
          setModalOpen(false);
        },
      }
    );
  };

  const bulkActions: BulkAction[] = [
    { key: 'delete', label: 'Delete', variant: 'danger' },
  ];
  const selectedNetworkIdSet = new Set(bulkSelection.selectedRows.map((row) => row.id));
  const allLoadedSelected = deployments.length > 0 && deployments.every((row) => selectedNetworkIdSet.has(row.id));

  if (!environmentId) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Networks</h1>
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Wifi className="mx-auto h-12 w-12 text-gray-300 mb-4" />
          <p className="text-gray-500">Select an environment to manage network profiles.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Networks</h1>
          <p className="mt-1 text-sm text-gray-500">
            Deploy reusable Wi-Fi (ONC) and APN profiles to environment, group, or device scopes. Form mode covers common settings and JSON override supports full payloads.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add Network
        </button>
      </div>

      {lastAmapiSummary && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
          {lastAmapiSummary}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">
            Deployed Network Profiles ({deployments.length})
          </h2>
          {deployments.length > 0 && (
            <label className="inline-flex items-center gap-2 text-xs text-gray-600">
              <input
                type="checkbox"
                checked={allLoadedSelected}
                onChange={(e) => {
                  bulkSelection.onSelectionChange(e.target.checked ? deployments : []);
                }}
                className="h-4 w-4 rounded border-gray-300 text-accent focus:ring-accent/20"
              />
              Select all loaded
            </label>
          )}
        </div>

        {deploymentsQuery.isLoading ? (
          <div className="p-8 text-center text-gray-500">
            <Loader2 className="mx-auto h-5 w-5 animate-spin mb-2" />
            Loading network deployments...
          </div>
        ) : deployments.length === 0 ? (
          <div className="p-10 text-center">
            <Wifi className="mx-auto h-10 w-10 text-gray-300 mb-3" />
            <p className="text-sm text-gray-500">No network profiles deployed yet.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {deployments.map((dep) => {
              const networkType = inferDeploymentKind(dep.network_type, dep.onc_profile);
              if (networkType === 'apn') {
                const apnMeta = readApnSummary(dep.onc_profile);
                return (
                  <div key={dep.id} className="px-4 py-3 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={selectedNetworkIdSet.has(dep.id)}
                        onChange={(e) => {
                          e.stopPropagation();
                          if (selectedNetworkIdSet.has(dep.id)) {
                            bulkSelection.onSelectionChange(bulkSelection.selectedRows.filter((row) => row.id !== dep.id));
                          } else {
                            bulkSelection.onSelectionChange([...bulkSelection.selectedRows, dep]);
                          }
                        }}
                        className="h-4 w-4 rounded border-gray-300 text-accent focus:ring-accent/20"
                      />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{dep.name}</p>
                      <p className="text-xs text-gray-500 truncate">APN: {apnMeta.apn || 'Unknown'}</p>
                    </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                        {dep.scope_type}
                      </span>
                      <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                        APN
                      </span>
                      {apnMeta.overrideApns && (
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                          {apnMeta.overrideApns}
                        </span>
                      )}
                      {apnMeta.types.length > 0 && (
                        <span className="inline-flex items-center rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
                          {apnMeta.types.join(', ')}
                        </span>
                      )}
                      <button onClick={() => openEdit(dep)} className="p-1 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors" title="Edit">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      {deleteConfirmId === dep.id ? (
                        <span className="inline-flex items-center gap-1 text-xs">
                          <button onClick={() => handleDelete(dep)} className="rounded bg-red-600 px-2 py-0.5 text-white hover:bg-red-700" disabled={deleteMutation.isPending}>
                            {deleteMutation.isPending ? 'Deleting...' : 'Confirm'}
                          </button>
                          <button onClick={() => setDeleteConfirmId(null)} className="rounded bg-gray-200 px-2 py-0.5 text-gray-700 hover:bg-gray-300">Cancel</button>
                        </span>
                      ) : (
                        <button onClick={() => setDeleteConfirmId(dep.id)} className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors" title="Delete">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              }

              const security = readSecurityLabel(dep.onc_profile);
              return (
                <div key={dep.id} className="px-4 py-3 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={selectedNetworkIdSet.has(dep.id)}
                      onChange={(e) => {
                        e.stopPropagation();
                        if (selectedNetworkIdSet.has(dep.id)) {
                          bulkSelection.onSelectionChange(bulkSelection.selectedRows.filter((row) => row.id !== dep.id));
                        } else {
                          bulkSelection.onSelectionChange([...bulkSelection.selectedRows, dep]);
                        }
                      }}
                      className="h-4 w-4 rounded border-gray-300 text-accent focus:ring-accent/20"
                    />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{dep.name}</p>
                    <p className="text-xs text-gray-500 truncate">SSID: {readWifiSsid(dep.onc_profile) || dep.ssid}</p>
                  </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                      {dep.scope_type}
                    </span>
                    <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                      Wi-Fi
                    </span>
                    {security && (
                      <span className="inline-flex items-center rounded-full bg-cyan-100 px-2 py-0.5 text-xs font-medium text-cyan-700">
                        {security}
                      </span>
                    )}
                    {dep.hidden_ssid && (
                      <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                        Hidden SSID
                      </span>
                    )}
                    {!dep.auto_connect && (
                      <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                        Manual connect
                      </span>
                    )}
                      <button onClick={() => openEdit(dep)} className="p-1 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors" title="Edit">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      {deleteConfirmId === dep.id ? (
                        <span className="inline-flex items-center gap-1 text-xs">
                          <button onClick={() => handleDelete(dep)} className="rounded bg-red-600 px-2 py-0.5 text-white hover:bg-red-700" disabled={deleteMutation.isPending}>
                            {deleteMutation.isPending ? 'Deleting...' : 'Confirm'}
                          </button>
                          <button onClick={() => setDeleteConfirmId(null)} className="rounded bg-gray-200 px-2 py-0.5 text-gray-700 hover:bg-gray-300">Cancel</button>
                        </span>
                      ) : (
                        <button onClick={() => setDeleteConfirmId(dep.id)} className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors" title="Delete">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-3">
        <SelectAllMatchingNotice
          loadedCount={deployments.length}
          totalCount={deployments.length}
          allMatching={bulkSelection.allMatching}
          canSelectAllMatching={bulkSelection.canSelectAllMatching}
          onSelectAllMatching={bulkSelection.selectAllMatching}
        />
      </div>

      <BulkActionBar
        selectedCount={bulkSelection.selectedCount}
        actions={bulkActions}
        onAction={() => {
          if (!window.confirm(`Delete ${bulkSelection.selectedCount} selected network deployment(s)?`)) return;
          if (!environmentId) return;
          bulkNetworkAction.mutate({
            environment_id: environmentId,
            operation: 'delete',
            selection: bulkSelection.selectionPayload,
          }, {
            onSuccess: (data) => {
              if (data.failed > 0) {
                window.alert(`Bulk delete completed with ${data.failed} failure(s).`);
              }
              bulkSelection.clearSelection();
            },
          });
        }}
        onClear={bulkSelection.clearSelection}
      />

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-5xl rounded-xl bg-white p-6 pb-8 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">{editingDeployment ? 'Edit Network' : 'Deploy Network'}</h2>
              <button
                onClick={() => setModalOpen(false)}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mb-4 inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
              <button
                type="button"
                disabled={!!editingDeployment}
                onClick={() => {
                  setNetworkKind('wifi');
                  setJsonDirty(false);
                }}
                className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm ${networkKind === 'wifi' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'} ${editingDeployment ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <Wifi className="h-4 w-4" />
                Wi-Fi
              </button>
              <button
                type="button"
                disabled={!!editingDeployment}
                onClick={() => {
                  setNetworkKind('apn');
                  setJsonDirty(false);
                }}
                className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm ${networkKind === 'apn' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'} ${editingDeployment ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                APN
              </button>
            </div>

            <div className="mb-4 inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
              <button
                type="button"
                onClick={() => setEditorMode('form')}
                className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm ${editorMode === 'form' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
              >
                <FormInput className="h-4 w-4" />
                Form
              </button>
              <button
                type="button"
                onClick={() => setEditorMode('json')}
                className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm ${editorMode === 'json' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
              >
                <Code2 className="h-4 w-4" />
                JSON Override
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-1">Profile Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={networkKind === 'wifi' ? 'Warehouse Guest Wi-Fi' : 'Carrier APN Override'}
                    className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                  />
                </div>

                {editingDeployment ? (
                  <div className="space-y-1">
                    <label className="block text-sm font-medium text-gray-900">Deployment Scope</label>
                    <p className="text-sm text-gray-600 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                      {scope.scope_type === 'environment' ? 'Environment' : scope.scope_type === 'group' ? 'Group' : 'Device'}
                      <span className="ml-1 text-xs text-gray-400 font-mono">({scope.scope_id})</span>
                    </p>
                    <p className="text-xs text-gray-500">Scope cannot be changed after deployment. Delete and re-deploy to change scope.</p>
                  </div>
                ) : (
                  <AppScopeSelector value={scope} onChange={setScope} />
                )}

                {networkKind === 'wifi' ? (
                  <WifiFormFields
                    ssid={ssid}
                    setSsid={setSsid}
                    hiddenSsid={hiddenSsid}
                    setHiddenSsid={setHiddenSsid}
                    autoConnect={autoConnect}
                    setAutoConnect={setAutoConnect}
                    securityMode={securityMode}
                    setSecurityMode={setSecurityMode}
                    passphrase={passphrase}
                    setPassphrase={setPassphrase}
                    eapOuter={eapOuter}
                    setEapOuter={setEapOuter}
                    eapInner={eapInner}
                    setEapInner={setEapInner}
                    eapIdentity={eapIdentity}
                    setEapIdentity={setEapIdentity}
                    eapAnonymousIdentity={eapAnonymousIdentity}
                    setEapAnonymousIdentity={setEapAnonymousIdentity}
                    eapPassword={eapPassword}
                    setEapPassword={setEapPassword}
                    eapServerCaRefs={eapServerCaRefs}
                    setEapServerCaRefs={setEapServerCaRefs}
                  />
                ) : (
                  <ApnFormFields
                    overrideApns={apnOverrideApns}
                    setOverrideApns={setApnOverrideApns}
                    entryName={apnEntryName}
                    setEntryName={setApnEntryName}
                    apnValue={apnValue}
                    setApnValue={setApnValue}
                    apnTypes={apnTypes}
                    setApnTypes={setApnTypes}
                    authType={apnAuthType}
                    setAuthType={setApnAuthType}
                    user={apnUser}
                    setUser={setApnUser}
                    password={apnPassword}
                    setPassword={setApnPassword}
                    server={apnServer}
                    setServer={setApnServer}
                    proxyAddress={apnProxyAddress}
                    setProxyAddress={setApnProxyAddress}
                    proxyPort={apnProxyPort}
                    setProxyPort={setApnProxyPort}
                    mmsc={apnMmsc}
                    setMmsc={setApnMmsc}
                    mmsProxyAddress={apnMmsProxyAddress}
                    setMmsProxyAddress={setApnMmsProxyAddress}
                    mmsProxyPort={apnMmsProxyPort}
                    setMmsProxyPort={setApnMmsProxyPort}
                    protocol={apnProtocol}
                    setProtocol={setApnProtocol}
                    roamingProtocol={apnRoamingProtocol}
                    setRoamingProtocol={setApnRoamingProtocol}
                    numericOperatorId={apnNumericOperatorId}
                    setNumericOperatorId={setApnNumericOperatorId}
                    carrierId={apnCarrierId}
                    setCarrierId={setApnCarrierId}
                    mvnoType={apnMvnoType}
                    setMvnoType={setApnMvnoType}
                    mvnoMatchData={apnMvnoMatchData}
                    setMvnoMatchData={setApnMvnoMatchData}
                    networkTypes={apnNetworkTypes}
                    setNetworkTypes={setApnNetworkTypes}
                    mtuV4={apnMtuV4}
                    setMtuV4={setApnMtuV4}
                    mtuV6={apnMtuV6}
                    setMtuV6={setApnMtuV6}
                    alwaysOn={apnAlwaysOn}
                    setAlwaysOn={setApnAlwaysOn}
                  />
                )}
              </div>

              <div>
                {editorMode === 'form' ? (
                  <>
                    <label className="block text-sm font-medium text-gray-900 mb-1">
                      {networkKind === 'wifi' ? 'ONC Preview' : 'APN Policy Preview'}
                    </label>
                    <pre className="h-full min-h-[420px] rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700 overflow-auto whitespace-pre-wrap break-words">
{structuredPreviewText}
                    </pre>
                  </>
                ) : (
                  <>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <label className="block text-sm font-medium text-gray-900">
                        {networkKind === 'wifi' ? 'ONC JSON Override' : 'APN Policy JSON Override'}
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setJsonOverride(structuredPreviewText);
                          setJsonDirty(false);
                        }}
                        className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Reset from Form
                      </button>
                    </div>
                    <textarea
                      value={jsonOverride}
                      onChange={(e) => {
                        setJsonOverride(e.target.value);
                        setJsonDirty(true);
                      }}
                      spellCheck={false}
                      rows={18}
                      className={`block w-full rounded-lg border bg-gray-50 px-3 py-2 text-xs font-mono text-gray-900 shadow-sm resize-y ${activeJsonValidation.ok ? 'border-gray-300 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20' : 'border-red-300 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-200'}`}
                    />
                    <p className={`mt-1 text-xs ${activeJsonValidation.ok ? 'text-gray-500' : 'text-red-600'}`}>
                      {activeJsonValidation.ok
                        ? networkKind === 'wifi'
                          ? 'JSON override is valid. Must contain exactly one Wi-Fi NetworkConfigurations entry for this deployment model.'
                          : 'JSON override is valid. Must contain exactly one APN apnSettings entry for this deployment model.'
                        : activeJsonValidation.error}
                    </p>
                  </>
                )}
              </div>
            </div>

            {deployMutation.error && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {deployMutation.error.message ?? 'Failed to deploy network profile.'}
              </div>
            )}

            <div className="mt-6 flex justify-end gap-3 border-t border-gray-100 pt-4">
              <button
                onClick={() => setModalOpen(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={editingDeployment ? handleUpdate : handleCreate}
                disabled={
                  (editingDeployment ? updateMutation.isPending : deployMutation.isPending) ||
                  (!editingDeployment && !scope.scope_id) ||
                  (editorMode === 'form'
                    ? networkKind === 'wifi'
                      ? !ssid.trim() || (securityMode === 'WPA_PSK' && passphrase.trim().length === 0)
                      : !apnEntryName.trim() || !apnValue.trim()
                    : !activeJsonValidation.ok)
                }
                className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50 transition-colors"
              >
                {(editingDeployment ? updateMutation.isPending : deployMutation.isPending) ? <Loader2 className="h-4 w-4 animate-spin" /> : editingDeployment ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {(editingDeployment ? updateMutation.isPending : deployMutation.isPending)
                  ? (editingDeployment ? 'Updating...' : 'Deploying...')
                  : editingDeployment
                    ? `Update ${networkKind === 'wifi' ? 'Wi-Fi' : 'APN'}`
                    : `Deploy ${networkKind === 'wifi' ? 'Wi-Fi' : 'APN'}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function WifiFormFields(props: {
  ssid: string;
  setSsid: (v: string) => void;
  hiddenSsid: boolean;
  setHiddenSsid: (v: boolean) => void;
  autoConnect: boolean;
  setAutoConnect: (v: boolean) => void;
  securityMode: WifiSecurityMode;
  setSecurityMode: (v: WifiSecurityMode) => void;
  passphrase: string;
  setPassphrase: (v: string) => void;
  eapOuter: EapOuter;
  setEapOuter: (v: EapOuter) => void;
  eapInner: EapInner;
  setEapInner: (v: EapInner) => void;
  eapIdentity: string;
  setEapIdentity: (v: string) => void;
  eapAnonymousIdentity: string;
  setEapAnonymousIdentity: (v: string) => void;
  eapPassword: string;
  setEapPassword: (v: string) => void;
  eapServerCaRefs: string;
  setEapServerCaRefs: (v: string) => void;
}) {
  const {
    ssid, setSsid, hiddenSsid, setHiddenSsid, autoConnect, setAutoConnect, securityMode, setSecurityMode,
    passphrase, setPassphrase, eapOuter, setEapOuter, eapInner, setEapInner, eapIdentity, setEapIdentity,
    eapAnonymousIdentity, setEapAnonymousIdentity, eapPassword, setEapPassword, eapServerCaRefs, setEapServerCaRefs,
  } = props;

  return (
    <>
      <div>
        <label className="block text-sm font-medium text-gray-900 mb-1">SSID</label>
        <input
          type="text"
          value={ssid}
          onChange={(e) => setSsid(e.target.value)}
          placeholder="Guest-WiFi"
          className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
      </div>

      <div className="rounded-lg border border-gray-200 p-3">
        <label className="block text-sm font-medium text-gray-900 mb-2">Wi-Fi Security</label>
        <select
          value={securityMode}
          onChange={(e) => setSecurityMode(e.target.value as WifiSecurityMode)}
          className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        >
          <option value="OPEN">Open (None)</option>
          <option value="WPA_PSK">WPA-PSK (Personal)</option>
          <option value="WPA_EAP">WPA-EAP (Enterprise)</option>
        </select>

        {securityMode === 'WPA_PSK' && (
          <div className="mt-3">
            <label className="block text-sm font-medium text-gray-900 mb-1">Passphrase</label>
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="Wi-Fi password"
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
        )}

        {securityMode === 'WPA_EAP' && (
          <div className="mt-3 space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">EAP Outer Method</label>
              <select
                value={eapOuter}
                onChange={(e) => setEapOuter(e.target.value as EapOuter)}
                className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              >
                <option value="PEAP">PEAP</option>
                <option value="EAP-TTLS">EAP-TTLS</option>
                <option value="EAP-TLS">EAP-TLS</option>
              </select>
            </div>
            {eapOuter !== 'EAP-TLS' && (
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">EAP Inner Method</label>
                <select
                  value={eapInner}
                  onChange={(e) => setEapInner(e.target.value as EapInner)}
                  className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                >
                  <option value="Automatic">Automatic</option>
                  <option value="MSCHAPv2">MSCHAPv2</option>
                  <option value="PAP">PAP</option>
                  <option value="CHAP">CHAP</option>
                </select>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">Identity</label>
              <input
                type="text"
                value={eapIdentity}
                onChange={(e) => setEapIdentity(e.target.value)}
                placeholder="user@company.com"
                className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">Anonymous Identity (optional)</label>
              <input
                type="text"
                value={eapAnonymousIdentity}
                onChange={(e) => setEapAnonymousIdentity(e.target.value)}
                placeholder="anonymous@company.com"
                className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>
            {eapOuter !== 'EAP-TLS' && (
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">Password</label>
                <input
                  type="password"
                  value={eapPassword}
                  onChange={(e) => setEapPassword(e.target.value)}
                  placeholder="EAP password"
                  className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">Server CA Refs (comma-separated)</label>
              <input
                type="text"
                value={eapServerCaRefs}
                onChange={(e) => setEapServerCaRefs(e.target.value)}
                placeholder="corp-root-ca, corp-int-ca"
                className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>
          </div>
        )}
      </div>

      <label className="flex items-start gap-3 rounded-lg border border-gray-200 px-3 py-2">
        <input
          type="checkbox"
          checked={autoConnect}
          onChange={(e) => setAutoConnect(e.target.checked)}
          className="mt-0.5 rounded border-gray-300"
        />
        <span>
          <span className="block text-sm font-medium text-gray-900">Auto connect</span>
          <span className="block text-xs text-gray-500">Devices connect automatically when this SSID is visible.</span>
        </span>
      </label>

      <label className="flex items-start gap-3 rounded-lg border border-gray-200 px-3 py-2">
        <input
          type="checkbox"
          checked={hiddenSsid}
          onChange={(e) => setHiddenSsid(e.target.checked)}
          className="mt-0.5 rounded border-gray-300"
        />
        <span>
          <span className="block text-sm font-medium text-gray-900">Hidden SSID</span>
          <span className="block text-xs text-gray-500">Marks the network as hidden in the ONC profile.</span>
        </span>
      </label>
    </>
  );
}

function ApnFormFields(props: {
  overrideApns: string;
  setOverrideApns: (v: string) => void;
  entryName: string;
  setEntryName: (v: string) => void;
  apnValue: string;
  setApnValue: (v: string) => void;
  apnTypes: string[];
  setApnTypes: (v: string[]) => void;
  authType: ApnAuthType;
  setAuthType: (v: ApnAuthType) => void;
  user: string;
  setUser: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  server: string;
  setServer: (v: string) => void;
  proxyAddress: string;
  setProxyAddress: (v: string) => void;
  proxyPort: string;
  setProxyPort: (v: string) => void;
  mmsc: string;
  setMmsc: (v: string) => void;
  mmsProxyAddress: string;
  setMmsProxyAddress: (v: string) => void;
  mmsProxyPort: string;
  setMmsProxyPort: (v: string) => void;
  protocol: ApnProtocol;
  setProtocol: (v: ApnProtocol) => void;
  roamingProtocol: ApnProtocol;
  setRoamingProtocol: (v: ApnProtocol) => void;
  numericOperatorId: string;
  setNumericOperatorId: (v: string) => void;
  carrierId: string;
  setCarrierId: (v: string) => void;
  mvnoType: ApnMvnoType;
  setMvnoType: (v: ApnMvnoType) => void;
  mvnoMatchData: string;
  setMvnoMatchData: (v: string) => void;
  networkTypes: string[];
  setNetworkTypes: (v: string[]) => void;
  mtuV4: string;
  setMtuV4: (v: string) => void;
  mtuV6: string;
  setMtuV6: (v: string) => void;
  alwaysOn: ApnAlwaysOn;
  setAlwaysOn: (v: ApnAlwaysOn) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 p-3 space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-900 mb-1">APN Override Mode</label>
          <select
            value={props.overrideApns}
            onChange={(e) => props.setOverrideApns(e.target.value)}
            className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          >
            <option value="OVERRIDE_APNS_UNSPECIFIED">Unspecified</option>
            <option value="OVERRIDE_APNS_DISABLED">Disabled</option>
            <option value="OVERRIDE_APNS_ENABLED">Enabled</option>
          </select>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">APN Entry Name</label>
            <input
              type="text"
              value={props.entryName}
              onChange={(e) => props.setEntryName(e.target.value)}
              placeholder="Carrier Data"
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">APN</label>
            <input
              type="text"
              value={props.apnValue}
              onChange={(e) => props.setApnValue(e.target.value)}
              placeholder="internet"
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
        </div>

        <MultiSelectField
          label="APN Types"
          description="Select one or more APN usage types."
          options={APN_TYPE_OPTIONS.map((v) => ({ value: v, label: v }))}
          value={props.apnTypes}
          onChange={props.setApnTypes}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <SelectField label="Authentication" value={props.authType} onChange={(v) => props.setAuthType(v as ApnAuthType)} options={[
            { value: 'AUTH_TYPE_UNSPECIFIED', label: 'Unspecified' },
            { value: 'NONE', label: 'None' },
            { value: 'PAP', label: 'PAP' },
            { value: 'CHAP', label: 'CHAP' },
            { value: 'PAP_OR_CHAP', label: 'PAP or CHAP' },
          ]} />
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Server (optional)</label>
            <input type="text" value={props.server} onChange={(e) => props.setServer(e.target.value)} className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Username (optional)</label>
            <input type="text" value={props.user} onChange={(e) => props.setUser(e.target.value)} className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Password (optional)</label>
            <input type="password" value={props.password} onChange={(e) => props.setPassword(e.target.value)} className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20" />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Proxy Address</label>
            <input type="text" value={props.proxyAddress} onChange={(e) => props.setProxyAddress(e.target.value)} placeholder="10.0.0.10" className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Proxy Port</label>
            <input type="number" min={0} value={props.proxyPort} onChange={(e) => props.setProxyPort(e.target.value)} placeholder="8080" className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">MMSC</label>
            <input type="text" value={props.mmsc} onChange={(e) => props.setMmsc(e.target.value)} placeholder="http://mmsc.carrier.example" className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">MMS Proxy Address</label>
            <input type="text" value={props.mmsProxyAddress} onChange={(e) => props.setMmsProxyAddress(e.target.value)} className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">MMS Proxy Port</label>
            <input type="number" min={0} value={props.mmsProxyPort} onChange={(e) => props.setMmsProxyPort(e.target.value)} placeholder="80" className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20" />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <SelectField label="Protocol" value={props.protocol} onChange={(v) => props.setProtocol(v as ApnProtocol)} options={[
            { value: 'PROTOCOL_UNSPECIFIED', label: 'Unspecified' },
            { value: 'IPV4', label: 'IPv4' },
            { value: 'IPV6', label: 'IPv6' },
            { value: 'IPV4V6', label: 'IPv4/IPv6' },
          ]} />
          <SelectField label="Roaming Protocol" value={props.roamingProtocol} onChange={(v) => props.setRoamingProtocol(v as ApnProtocol)} options={[
            { value: 'PROTOCOL_UNSPECIFIED', label: 'Unspecified' },
            { value: 'IPV4', label: 'IPv4' },
            { value: 'IPV6', label: 'IPv6' },
            { value: 'IPV4V6', label: 'IPv4/IPv6' },
          ]} />
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Numeric Operator ID (MCCMNC)</label>
            <input type="text" value={props.numericOperatorId} onChange={(e) => props.setNumericOperatorId(e.target.value)} placeholder="310260" className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Carrier ID</label>
            <input type="number" min={0} value={props.carrierId} onChange={(e) => props.setCarrierId(e.target.value)} placeholder="1234" className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20" />
          </div>
          <SelectField label="MVNO Type" value={props.mvnoType} onChange={(v) => props.setMvnoType(v as ApnMvnoType)} options={[
            { value: 'MVNO_TYPE_UNSPECIFIED', label: 'Unspecified' },
            { value: 'GID', label: 'GID' },
            { value: 'ICCID', label: 'ICCID' },
            { value: 'IMSI', label: 'IMSI' },
            { value: 'SPN', label: 'SPN' },
          ]} />
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">MVNO Match Data</label>
            <input type="text" value={props.mvnoMatchData} onChange={(e) => props.setMvnoMatchData(e.target.value)} className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">MTU v4</label>
            <input type="number" min={0} value={props.mtuV4} onChange={(e) => props.setMtuV4(e.target.value)} className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">MTU v6</label>
            <input type="number" min={0} value={props.mtuV6} onChange={(e) => props.setMtuV6(e.target.value)} className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20" />
          </div>
          <SelectField label="Always On" value={props.alwaysOn} onChange={(v) => props.setAlwaysOn(v as ApnAlwaysOn)} options={[
            { value: 'ALWAYS_ON_UNSPECIFIED', label: 'Unspecified' },
            { value: 'ENABLED', label: 'Enabled' },
            { value: 'DISABLED', label: 'Disabled' },
          ]} />
        </div>

        <MultiSelectField
          label="Network Types"
          description="Optional allowed radio generations for this APN."
          options={NETWORK_TYPE_OPTIONS.map((v) => ({ value: v, label: v }))}
          value={props.networkTypes}
          onChange={props.setNetworkTypes}
        />
      </div>
    </div>
  );
}

function MultiSelectField(props: {
  label: string;
  description?: string;
  options: Array<{ value: string; label: string }>;
  value: string[];
  onChange: (value: string[]) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-900 mb-1">{props.label}</label>
      <select
        multiple
        value={props.value}
        onChange={(e) => props.onChange(Array.from(e.target.selectedOptions, (o) => o.value))}
        className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 min-h-[120px]"
      >
        {props.options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      {props.description ? <p className="mt-1 text-xs text-gray-500">{props.description}</p> : null}
    </div>
  );
}

function SelectField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-900 mb-1">{props.label}</label>
      <select
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
      >
        {props.options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}

function buildStructuredWifiOncDoc(params: {
  scopeType: ScopeValue['scope_type'];
  scopeId: string;
  ssid: string;
  name: string;
  hiddenSsid: boolean;
  autoConnect: boolean;
  securityMode: WifiSecurityMode;
  passphrase: string;
  eapOuter: EapOuter;
  eapInner: EapInner;
  eapIdentity: string;
  eapAnonymousIdentity: string;
  eapPassword: string;
  eapServerCaRefs: string;
}): OncDoc {
  const guid = `wifi-${params.scopeType}-${(params.scopeId || 'scope').slice(0, 8)}-${(params.ssid || 'network')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`.slice(0, 128);

  const wifi: Record<string, unknown> = {
    SSID: params.ssid,
    AutoConnect: params.autoConnect,
    HiddenSSID: params.hiddenSsid,
  };

  if (params.securityMode === 'OPEN') {
    wifi.Security = 'None';
  } else if (params.securityMode === 'WPA_PSK') {
    wifi.Security = 'WPA-PSK';
    if (params.passphrase.trim()) wifi.Passphrase = params.passphrase;
  } else {
    wifi.Security = 'WPA-EAP';
    const eap: Record<string, unknown> = { Outer: params.eapOuter };
    if (params.eapOuter !== 'EAP-TLS') eap.Inner = params.eapInner;
    if (params.eapIdentity.trim()) eap.Identity = params.eapIdentity.trim();
    if (params.eapAnonymousIdentity.trim()) eap.AnonymousIdentity = params.eapAnonymousIdentity.trim();
    if (params.eapOuter !== 'EAP-TLS' && params.eapPassword) eap.Password = params.eapPassword;
    const serverCaRefs = params.eapServerCaRefs.split(',').map((s) => s.trim()).filter(Boolean);
    if (serverCaRefs.length > 0) eap.ServerCARefs = serverCaRefs;
    wifi.EAP = eap;
  }

  return {
    Type: 'UnencryptedConfiguration',
    NetworkConfigurations: [
      {
        GUID: guid,
        Name: params.name,
        Type: 'WiFi',
        WiFi: wifi,
      },
    ],
  };
}

function buildStructuredApnPolicy(params: {
  overrideApns: string;
  entryName: string;
  apnValue: string;
  apnTypes: string[];
  authenticationType: string;
  user: string;
  password: string;
  server: string;
  proxyAddress: string;
  proxyPort: string;
  mmsc: string;
  mmsProxyAddress: string;
  mmsProxyPort: string;
  protocol: string;
  roamingProtocol: string;
  numericOperatorId: string;
  carrierId: string;
  mvnoType: string;
  mvnoMatchData: string;
  networkTypes: string[];
  mtuV4: string;
  mtuV6: string;
  alwaysOn: string;
}): ApnPolicyDoc {
  const apnSetting: Record<string, unknown> = {
    displayName: params.entryName.trim(),
    apn: params.apnValue.trim(),
  };

  if (params.proxyAddress.trim()) apnSetting.proxyAddress = params.proxyAddress.trim();
  if (params.proxyPort.trim()) apnSetting.proxyPort = Number(params.proxyPort);
  if (params.mmsc.trim()) apnSetting.mmsc = params.mmsc.trim();
  if (params.mmsProxyAddress.trim()) apnSetting.mmsProxyAddress = params.mmsProxyAddress.trim();
  if (params.mmsProxyPort.trim()) apnSetting.mmsProxyPort = Number(params.mmsProxyPort);
  if (params.user.trim()) apnSetting.username = params.user.trim();
  if (params.password) apnSetting.password = params.password;
  if (params.authenticationType !== 'AUTH_TYPE_UNSPECIFIED') apnSetting.authType = params.authenticationType;
  const cleanedApnTypes = uniqueStringList(params.apnTypes);
  if (cleanedApnTypes.length > 0) apnSetting.apnTypes = cleanedApnTypes;
  if (params.protocol !== 'PROTOCOL_UNSPECIFIED') apnSetting.protocol = params.protocol;
  if (params.roamingProtocol !== 'PROTOCOL_UNSPECIFIED') apnSetting.roamingProtocol = params.roamingProtocol;
  if (params.numericOperatorId.trim()) apnSetting.numericOperatorId = params.numericOperatorId.trim();
  if (params.carrierId.trim()) apnSetting.carrierId = Number(params.carrierId);
  if (params.mvnoType !== 'MVNO_TYPE_UNSPECIFIED') apnSetting.mvnoType = params.mvnoType;
  const cleanedNetworkTypes = uniqueStringList(params.networkTypes);
  if (cleanedNetworkTypes.length > 0) apnSetting.networkTypes = cleanedNetworkTypes;
  if (params.mtuV4.trim()) apnSetting.mtuV4 = Number(params.mtuV4);
  if (params.mtuV6.trim()) apnSetting.mtuV6 = Number(params.mtuV6);
  if (params.alwaysOn !== 'ALWAYS_ON_UNSPECIFIED') apnSetting.alwaysOnSetting = params.alwaysOn;

  const policy: Record<string, unknown> = {
    apnSettings: [apnSetting],
  };
  if (params.overrideApns !== 'OVERRIDE_APNS_UNSPECIFIED') policy.overrideApns = params.overrideApns;
  return policy;
}

function validateOncJson(input: string): { ok: true; doc: OncDoc } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(input);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'ONC JSON must be an object.' };
    }
    const meta = extractPrimaryWifiMeta(parsed as OncDoc);
    if (!meta.ok) return { ok: false, error: meta.error };
    return { ok: true, doc: parsed as OncDoc };
  } catch {
    return { ok: false, error: 'Invalid JSON.' };
  }
}

function validateApnPolicyJson(input: string): { ok: true; policy: ApnPolicyDoc } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(input);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'APN policy JSON must be an object.' };
    }
    const meta = extractPrimaryApnMeta(parsed as ApnPolicyDoc);
    if (!meta.ok) return { ok: false, error: meta.error };
    return { ok: true, policy: meta.policy };
  } catch {
    return { ok: false, error: 'Invalid JSON.' };
  }
}

function extractPrimaryWifiMeta(doc: OncDoc):
  | { ok: true; ssid: string; name: string; hiddenSsid: boolean; autoConnect: boolean }
  | { ok: false; error: string } {
  const list = Array.isArray((doc as any).NetworkConfigurations) ? (doc as any).NetworkConfigurations : null;
  if (!list || list.length !== 1) {
    return { ok: false, error: 'ONC must include exactly one NetworkConfigurations entry for this deploy flow.' };
  }
  const entry = list[0];
  if (!entry || typeof entry !== 'object' || entry.Type !== 'WiFi') {
    return { ok: false, error: 'NetworkConfigurations[0] must be a WiFi ONC profile.' };
  }
  const wifi = (entry as any).WiFi;
  if (!wifi || typeof wifi !== 'object') {
    return { ok: false, error: 'NetworkConfigurations[0].WiFi is required.' };
  }
  const ssid = typeof wifi.SSID === 'string' ? wifi.SSID.trim() : '';
  if (!ssid) return { ok: false, error: 'WiFi.SSID is required.' };
  const name = typeof (entry as any).Name === 'string' ? (entry as any).Name.trim() : '';
  return {
    ok: true,
    ssid,
    name: name || ssid,
    hiddenSsid: !!wifi.HiddenSSID,
    autoConnect: wifi.AutoConnect !== false,
  };
}

function extractPrimaryApnMeta(input: ApnPolicyDoc):
  | { ok: true; name: string; apn: string; overrideApns: string; policy: ApnPolicyDoc }
  | { ok: false; error: string } {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const candidate = ((raw as any).apnPolicy && typeof (raw as any).apnPolicy === 'object') ? (raw as any).apnPolicy : raw;
  const apnSettings = Array.isArray((candidate as any).apnSettings) ? (candidate as any).apnSettings : null;
  if (!apnSettings || apnSettings.length !== 1) {
    return { ok: false, error: 'APN policy must include exactly one apnSettings entry for this deploy flow.' };
  }
  const entry = apnSettings[0] as any;
  if (!entry || typeof entry !== 'object') {
    return { ok: false, error: 'apnSettings[0] must be an object.' };
  }
  const name = typeof entry.name === 'string' ? entry.name.trim() : '';
  const apn = typeof entry.apn === 'string' ? entry.apn.trim() : '';
  if (!name) return { ok: false, error: 'apnSettings[0].name is required.' };
  if (!apn) return { ok: false, error: 'apnSettings[0].apn is required.' };

  const policy = candidate as ApnPolicyDoc;
  return {
    ok: true,
    name,
    apn,
    overrideApns: typeof (policy as any).overrideApns === 'string' ? (policy as any).overrideApns : 'OVERRIDE_APNS_UNSPECIFIED',
    policy,
  };
}

function readSecurityLabel(profile: Record<string, unknown>): string | null {
  const entry = firstWifiNetwork(profile);
  const security = (entry as any)?.WiFi?.Security;
  return typeof security === 'string' && security ? security : null;
}

function readWifiSsid(profile: Record<string, unknown>): string | null {
  const entry = firstWifiNetwork(profile);
  const ssid = (entry as any)?.WiFi?.SSID;
  return typeof ssid === 'string' && ssid ? ssid : null;
}

function firstWifiNetwork(profile: Record<string, unknown>): unknown {
  const doc = profile && typeof profile === 'object' ? profile : {};
  const list = Array.isArray((doc as any).NetworkConfigurations)
    ? (doc as any).NetworkConfigurations
    : Array.isArray(doc) ? doc : null;
  return list?.[0] ?? null;
}

function inferDeploymentKind(explicit: string | undefined, profile: Record<string, unknown>): NetworkKind {
  if (explicit === 'apn' || explicit === 'wifi') return explicit;
  if (!profile || typeof profile !== 'object') return 'wifi';
  const p = profile as any;
  // Check all possible APN profile shapes
  if (p.kind === 'apnPolicy') return 'apn';
  if (p.apnPolicy && typeof p.apnPolicy === 'object') return 'apn';
  if (Array.isArray(p.apnSettings)) return 'apn';
  if (typeof p.overrideApns === 'string') return 'apn';
  return 'wifi';
}

function readApnSummary(profile: Record<string, unknown>): { apn: string; name: string; overrideApns: string; types: string[] } {
  const candidate = (profile as any)?.kind === 'apnPolicy' ? (profile as any).apnPolicy : ((profile as any)?.apnPolicy ?? profile);
  const entry = Array.isArray(candidate?.apnSettings) ? candidate.apnSettings[0] : null;
  return {
    apn: typeof entry?.apn === 'string' ? entry.apn : '',
    name: typeof entry?.name === 'string' ? entry.name : '',
    overrideApns: typeof candidate?.overrideApns === 'string' ? candidate.overrideApns : '',
    types: Array.isArray(entry?.apnTypes) ? entry.apnTypes.filter((v: unknown): v is string => typeof v === 'string') : [],
  };
}

function uniqueStringList(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/**
 * Parse a stored ONC WiFi profile back into form field values.
 */
function extractWifiFormFields(profile: Record<string, unknown>): {
  ssid: string;
  securityMode: WifiSecurityMode;
  passphrase: string;
  eapOuter: EapOuter;
  eapInner: EapInner;
  eapIdentity: string;
  eapAnonymousIdentity: string;
  eapPassword: string;
  eapServerCaRefs: string;
} {
  const defaults = {
    ssid: '',
    securityMode: 'OPEN' as WifiSecurityMode,
    passphrase: '',
    eapOuter: 'PEAP' as EapOuter,
    eapInner: 'MSCHAPv2' as EapInner,
    eapIdentity: '',
    eapAnonymousIdentity: '',
    eapPassword: '',
    eapServerCaRefs: '',
  };

  const entry = firstWifiNetwork(profile);
  if (!entry || typeof entry !== 'object') return defaults;

  const wifi = (entry as any)?.WiFi;
  if (!wifi || typeof wifi !== 'object') return defaults;

  const ssid = typeof wifi.SSID === 'string' ? wifi.SSID : '';
  const security = typeof wifi.Security === 'string' ? wifi.Security : '';

  let securityMode: WifiSecurityMode = 'OPEN';
  if (security === 'WPA-PSK') securityMode = 'WPA_PSK';
  else if (security === 'WPA-EAP') securityMode = 'WPA_EAP';
  else if (security === 'None' || !security) securityMode = 'OPEN';

  const passphrase = typeof wifi.Passphrase === 'string' ? wifi.Passphrase : '';

  const eap = wifi.EAP && typeof wifi.EAP === 'object' ? wifi.EAP : {};
  const eapOuter = (['PEAP', 'EAP-TTLS', 'EAP-TLS'].includes(eap.Outer) ? eap.Outer : 'PEAP') as EapOuter;
  const eapInner = (['Automatic', 'MSCHAPv2', 'PAP', 'CHAP'].includes(eap.Inner) ? eap.Inner : 'MSCHAPv2') as EapInner;
  const eapIdentity = typeof eap.Identity === 'string' ? eap.Identity : '';
  const eapAnonymousIdentity = typeof eap.AnonymousIdentity === 'string' ? eap.AnonymousIdentity : '';
  const eapPassword = typeof eap.Password === 'string' ? eap.Password : '';
  const eapServerCaRefs = Array.isArray(eap.ServerCARefs) ? eap.ServerCARefs.filter((v: unknown): v is string => typeof v === 'string').join(', ') : '';

  return { ssid, securityMode, passphrase, eapOuter, eapInner, eapIdentity, eapAnonymousIdentity, eapPassword, eapServerCaRefs };
}

/**
 * Parse a stored APN policy back into form field values.
 */
function extractApnFormFields(policy: Record<string, unknown>): {
  overrideApns: string;
  entryName: string;
  apnValue: string;
  apnTypes: string[];
  authType: ApnAuthType;
  user: string;
  password: string;
  server: string;
  proxyAddress: string;
  proxyPort: string;
  mmsc: string;
  mmsProxyAddress: string;
  mmsProxyPort: string;
  protocol: ApnProtocol;
  roamingProtocol: ApnProtocol;
  numericOperatorId: string;
  carrierId: string;
  mvnoType: ApnMvnoType;
  mvnoMatchData: string;
  networkTypes: string[];
  mtuV4: string;
  mtuV6: string;
  alwaysOn: ApnAlwaysOn;
} {
  const candidate = policy && typeof policy === 'object' && !Array.isArray(policy) ? policy : {};
  const entry = Array.isArray((candidate as any).apnSettings)
    ? (candidate as any).apnSettings[0]
    : null;
  const s = entry && typeof entry === 'object' ? entry : {} as Record<string, unknown>;

  const str = (key: string) => typeof s[key] === 'string' ? s[key] : '';
  const num = (key: string) => typeof s[key] === 'number' ? String(s[key]) : (typeof s[key] === 'string' ? s[key] : '');

  return {
    overrideApns: typeof (candidate as any).overrideApns === 'string' ? (candidate as any).overrideApns : 'OVERRIDE_APNS_UNSPECIFIED',
    entryName: str('displayName') || str('name'),
    apnValue: str('apn'),
    apnTypes: Array.isArray(s.apnTypes) ? s.apnTypes.filter((v: unknown): v is string => typeof v === 'string') : ['DEFAULT'],
    authType: (['AUTH_TYPE_UNSPECIFIED', 'NONE', 'PAP', 'CHAP', 'PAP_OR_CHAP'].includes(str('authType') || str('authenticationType')) ? (str('authType') || str('authenticationType')) : 'AUTH_TYPE_UNSPECIFIED') as ApnAuthType,
    user: str('username') || str('user'),
    password: str('password'),
    server: str('server'),
    proxyAddress: str('proxyAddress'),
    proxyPort: num('proxyPort'),
    mmsc: str('mmsc'),
    mmsProxyAddress: str('mmsProxyAddress'),
    mmsProxyPort: num('mmsProxyPort'),
    protocol: (['PROTOCOL_UNSPECIFIED', 'IPV4', 'IPV6', 'IPV4V6'].includes(str('protocol')) ? str('protocol') : 'PROTOCOL_UNSPECIFIED') as ApnProtocol,
    roamingProtocol: (['PROTOCOL_UNSPECIFIED', 'IPV4', 'IPV6', 'IPV4V6'].includes(str('roamingProtocol')) ? str('roamingProtocol') : 'PROTOCOL_UNSPECIFIED') as ApnProtocol,
    numericOperatorId: str('numericOperatorId'),
    carrierId: num('carrierId'),
    mvnoType: (['MVNO_TYPE_UNSPECIFIED', 'GID', 'ICCID', 'IMSI', 'SPN'].includes(str('mvnoType')) ? str('mvnoType') : 'MVNO_TYPE_UNSPECIFIED') as ApnMvnoType,
    mvnoMatchData: str('mvnoMatchData'),
    networkTypes: Array.isArray(s.networkTypes) ? s.networkTypes.filter((v: unknown): v is string => typeof v === 'string') : [],
    mtuV4: num('mtuV4'),
    mtuV6: num('mtuV6'),
    alwaysOn: (['ALWAYS_ON_UNSPECIFIED', 'ENABLED', 'DISABLED'].includes(str('alwaysOnSetting') || str('alwaysOn')) ? (str('alwaysOnSetting') || str('alwaysOn')) : 'ALWAYS_ON_UNSPECIFIED') as ApnAlwaysOn,
  };
}
