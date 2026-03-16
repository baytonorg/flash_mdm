import { useState, useMemo } from 'react';
import { Search, Package } from 'lucide-react';
import StatusBadge from '@/components/common/StatusBadge';

interface Application {
  package_name: string;
  display_name: string;
  version_name: string;
  version_code: string | number;
  state: string;
  icon_url?: string | null;
}

export interface DeviceAppInventoryProps {
  applications: Application[];
}

function AppIcon({ iconUrl, displayName }: { iconUrl?: string | null; displayName: string }) {
  if (iconUrl) {
    return (
      <img
        src={iconUrl}
        alt=""
        className="h-8 w-8 rounded-lg object-contain bg-gray-50 flex-shrink-0"
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
    );
  }
  return (
    <div className="h-8 w-8 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
      <Package className="h-4 w-4 text-gray-400" />
    </div>
  );
}

export default function DeviceAppInventory({ applications }: DeviceAppInventoryProps) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return applications;
    const q = search.toLowerCase();
    return applications.filter(
      (app) =>
        app.display_name?.toLowerCase().includes(q) ||
        app.package_name?.toLowerCase().includes(q),
    );
  }, [applications, search]);

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative w-full sm:w-64">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search applications..."
          className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-secondary">
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted">
                App
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted">
                Package
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted">
                Version
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted">
                State
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center text-sm text-muted">
                  <div className="flex flex-col items-center gap-2">
                    <Package className="h-8 w-8 text-gray-300" />
                    <span>{applications.length === 0 ? 'No applications reported' : 'No matching applications'}</span>
                  </div>
                </td>
              </tr>
            ) : (
              filtered.map((app) => (
                <tr
                  key={app.package_name}
                  className="border-b border-border last:border-b-0 hover:bg-surface-secondary transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <AppIcon iconUrl={app.icon_url} displayName={app.display_name || app.package_name} />
                      <span className="font-medium text-gray-900">
                        {app.display_name || app.package_name}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted font-mono text-xs">
                    {app.package_name}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {app.version_name || String(app.version_code)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={app.state} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted">
        {filtered.length} of {applications.length} application{applications.length !== 1 ? 's' : ''}
      </p>
    </div>
  );
}
