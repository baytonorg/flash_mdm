import { useState, useMemo, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/client';
import { useContextStore } from '@/stores/context';
import DataTable, { type ColumnDef } from '@/components/common/DataTable';
import FilterBar from '@/components/common/FilterBar';
import Pagination from '@/components/common/Pagination';
import BulkActionBar, { type BulkAction } from '@/components/common/BulkActionBar';
import StatusBadge from '@/components/common/StatusBadge';
import LivePageIndicator from '@/components/common/LivePageIndicator';
import CommandModal from '@/components/device/CommandModal';
import { getDeviceDisplayState } from '@/lib/device-state';
import { Lock, RotateCcw, Trash2, Smartphone, Terminal } from 'lucide-react';

interface Device {
  id: string;
  environment_id: string;
  group_id: string | null;
  policy_id: string | null;
  amapi_name: string;
  name: string | null;
  serial_number: string | null;
  imei: string | null;
  manufacturer: string | null;
  model: string | null;
  os_version: string | null;
  security_patch_level: string | null;
  state: string;
  ownership: string | null;
  management_mode: string | null;
  policy_compliant: boolean | null;
  enrollment_time: string | null;
  last_status_report_at: string | null;
  snapshot: Record<string, any> | null;
}

interface DevicesResponse {
  devices: Device[];
  pagination: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
  };
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export default function Devices() {
  const LIVE_REFRESH_MS = 30000;
  const navigate = useNavigate();
  const { activeEnvironment, activeGroup } = useContextStore();

  // Filter state
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [ownershipFilter, setOwnershipFilter] = useState('');
  const [manufacturerFilter, setManufacturerFilter] = useState('');
  const [complianceFilter, setComplianceFilter] = useState('');
  const [page, setPage] = useState(1);
  const [perPage] = useState(25);
  const [sortBy, setSortBy] = useState('last_status_report_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Selection state
  const [selectedDevices, setSelectedDevices] = useState<Device[]>([]);

  // Bulk action modal state
  const [bulkAction, setBulkAction] = useState<string | null>(null);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);

  const environmentId = activeEnvironment?.id;
  const groupId = activeGroup?.id;

  // Reset pagination and selection when context changes
  useEffect(() => { setPage(1); setSelectedDevices([]); }, [environmentId, groupId]);

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (environmentId) params.set('environment_id', environmentId);
    if (groupId) params.set('group_id', groupId);
    params.set('page', String(page));
    params.set('per_page', String(perPage));
    if (search) params.set('search', search);
    if (stateFilter) params.set('state', stateFilter);
    if (ownershipFilter) params.set('ownership', ownershipFilter);
    if (manufacturerFilter) params.set('manufacturer', manufacturerFilter);
    if (complianceFilter) params.set('policy_compliant', complianceFilter);
    if (sortBy) params.set('sort_by', sortBy);
    if (sortDir) params.set('sort_dir', sortDir);
    return params.toString();
  }, [environmentId, groupId, page, perPage, search, stateFilter, ownershipFilter, manufacturerFilter, complianceFilter, sortBy, sortDir]);

  const { data, isLoading, dataUpdatedAt } = useQuery({
    queryKey: ['devices', queryParams],
    queryFn: () => apiClient.get<DevicesResponse>(`/api/devices/list?${queryParams}`),
    enabled: !!environmentId,
    refetchInterval: LIVE_REFRESH_MS,
    refetchIntervalInBackground: true,
  });

  const handleSort = useCallback(
    (column: string, direction: 'asc' | 'desc') => {
      setSortBy(column);
      setSortDir(direction);
    },
    [],
  );

  const handleRowClick = useCallback(
    (row: Device) => {
      navigate(`/devices/${row.id}`);
    },
    [navigate],
  );

  const handleBulkAction = useCallback((key: string) => {
    setBulkAction(key === 'MORE_COMMANDS' ? null : key);
    setBulkModalOpen(true);
  }, []);

  // Reset page when filters change
  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const handleStateChange = (value: string) => {
    setStateFilter(value);
    setPage(1);
  };

  const handleOwnershipChange = (value: string) => {
    setOwnershipFilter(value);
    setPage(1);
  };

  const handleManufacturerChange = (value: string) => {
    setManufacturerFilter(value);
    setPage(1);
  };

  const handleComplianceChange = (value: string) => {
    setComplianceFilter(value);
    setPage(1);
  };


  const columns: ColumnDef<Device>[] = useMemo(
    () => [
      {
        key: 'name' as keyof Device,
        label: 'Device',
        sortable: false,
        render: (_, row) => (
          <span className="font-medium text-gray-900">
            {row.name || [row.manufacturer, row.model].filter(Boolean).join(' ') || row.serial_number || 'Unknown'}
          </span>
        ),
      },
      {
        key: 'serial_number',
        label: 'Serial',
        sortable: true,
        render: (_, row) => row.serial_number || 'N/A',
      },
      {
        key: 'manufacturer',
        label: 'Manufacturer',
        sortable: true,
        render: (_, row) => row.manufacturer || 'Unknown',
      },
      {
        key: 'model',
        label: 'Model',
        sortable: true,
        render: (_, row) => row.model || 'Unknown',
      },
      {
        key: 'os_version',
        label: 'OS',
        sortable: true,
        render: (_, row) => (row.os_version ? `Android ${row.os_version}` : 'N/A'),
      },
      {
        key: 'state',
        label: 'State',
        sortable: true,
        render: (_, row) => <StatusBadge status={getDeviceDisplayState(row)} />,
      },
      {
        key: 'ownership',
        label: 'Ownership',
        sortable: true,
        render: (_, row) =>
          row.ownership ? <StatusBadge status={row.ownership} /> : <span className="text-muted">N/A</span>,
      },
      {
        key: 'policy_compliant',
        label: 'Compliant',
        render: (_, row) => {
          if (row.policy_compliant === null) return <span className="text-muted">--</span>;
          return row.policy_compliant ? (
            <span className="text-green-600 font-medium" title="Compliant">&#10003;</span>
          ) : (
            <span className="text-red-600 font-medium" title="Non-compliant">&#10007;</span>
          );
        },
      },
      {
        key: 'last_status_report_at',
        label: 'Last Seen',
        sortable: true,
        render: (_, row) => (
          <span className="text-muted">{formatRelativeTime(row.last_status_report_at)}</span>
        ),
      },
    ],
    [],
  );

  const devices = data?.devices ?? [];
  const total = data?.pagination?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  // Derive unique manufacturer list from loaded devices for the dropdown
  const manufacturerOptions = useMemo(() => {
    const manufacturers = new Set<string>();
    for (const d of devices) {
      if (d.manufacturer) manufacturers.add(d.manufacturer);
    }
    return Array.from(manufacturers)
      .sort()
      .map((m) => ({ value: m, label: m }));
  }, [devices]);

  const bulkActions: BulkAction[] = [
    { key: 'LOCK', label: 'Lock', icon: <Lock className="h-3.5 w-3.5" /> },
    { key: 'REBOOT', label: 'Reboot', icon: <RotateCcw className="h-3.5 w-3.5" /> },
    {
      key: 'WIPE',
      label: 'Wipe',
      variant: 'warning',
      icon: <Trash2 className="h-3.5 w-3.5" />,
    },
    {
      key: 'DELETE',
      label: 'Delete',
      variant: 'danger',
      icon: <Trash2 className="h-3.5 w-3.5" />,
    },
    { key: 'MORE_COMMANDS', label: 'More…', icon: <Terminal className="h-3.5 w-3.5" /> },
  ];

  if (!environmentId) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Devices</h1>
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex flex-col items-center gap-2 py-8">
            <Smartphone className="h-10 w-10 text-gray-300" />
            <p className="text-gray-500">Select an environment to view devices.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-gray-900">Devices</h1>
          <LivePageIndicator intervalMs={LIVE_REFRESH_MS} lastUpdatedAt={dataUpdatedAt} />
        </div>
        <p className="text-sm text-muted">{total} device{total !== 1 ? 's' : ''}</p>
      </div>

      {/* Filters */}
      <FilterBar
        searchValue={search}
        onSearchChange={handleSearchChange}
        searchPlaceholder="Search by serial, model, manufacturer..."
        filters={[
          {
            key: 'state',
            label: 'All States',
            value: stateFilter,
            onChange: handleStateChange,
            options: [
              { value: 'ACTIVE', label: 'Active' },
              { value: 'DISABLED', label: 'Disabled' },
              { value: 'DELETED', label: 'Deleted' },
              { value: 'PROVISIONING', label: 'Provisioning' },
            ],
          },
          {
            key: 'ownership',
            label: 'All Ownership',
            value: ownershipFilter,
            onChange: handleOwnershipChange,
            options: [
              { value: 'COMPANY_OWNED', label: 'Company Owned' },
              { value: 'PERSONALLY_OWNED', label: 'Personally Owned' },
            ],
          },
          {
            key: 'manufacturer',
            label: 'All Manufacturers',
            value: manufacturerFilter,
            onChange: handleManufacturerChange,
            options: manufacturerOptions,
          },
          {
            key: 'compliance',
            label: 'All Compliance',
            value: complianceFilter,
            onChange: handleComplianceChange,
            options: [
              { value: 'true', label: 'Compliant' },
              { value: 'false', label: 'Non-compliant' },
            ],
          },
        ]}
      />

      {/* Data table */}
      <DataTable<Device>
        columns={columns}
        data={devices}
        loading={isLoading}
        emptyMessage="No devices found matching your filters."
        selectable
        selectedRows={selectedDevices}
        onSelectionChange={setSelectedDevices}
        sortColumn={sortBy}
        sortDirection={sortDir}
        onSort={handleSort}
        onRowClick={handleRowClick}
        rowKey={(row) => row.id}
      />

      {/* Pagination */}
      {total > 0 && (
        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          perPage={perPage}
          total={total}
        />
      )}

      {/* Bulk action bar */}
      <BulkActionBar
        selectedCount={selectedDevices.length}
        actions={bulkActions}
        onAction={handleBulkAction}
        onClear={() => setSelectedDevices([])}
      />

      {/* Bulk command modal (reuses single-device command modal UI/params) */}
      <CommandModal
        key={`bulk-command-${bulkModalOpen ? 'open' : 'closed'}-${bulkAction ?? 'none'}`}
        open={bulkModalOpen}
        onClose={() => {
          setBulkModalOpen(false);
          setBulkAction(null);
        }}
        deviceIds={selectedDevices.map((d) => d.id)}
        deviceName={`${selectedDevices.length} selected device${selectedDevices.length !== 1 ? 's' : ''}`}
        initialCommand={bulkAction ?? undefined}
        onSuccess={() => {
          setSelectedDevices([]);
        }}
      />
    </div>
  );
}
