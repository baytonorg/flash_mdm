import { MapPin } from 'lucide-react';

interface LocationRecord {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  recorded_at: string;
}

export interface DeviceLocationHistoryProps {
  locations: LocationRecord[];
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatRelativeTime(dateStr: string): string {
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

function coordinateValue(value: number): string {
  return value.toFixed(6);
}

function buildGoogleMapsUrl(latitude: number, longitude: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${coordinateValue(latitude)},${coordinateValue(longitude)}`)}`;
}

function buildStaticMapUrl(latitude: number, longitude: number, scale: 1 | 2 = 1): string {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const params = new URLSearchParams({
    center: `${coordinateValue(latitude)},${coordinateValue(longitude)}`,
    zoom: '15',
    size: '640x320',
    maptype: 'roadmap',
    scale: String(scale),
    markers: `color:red|${coordinateValue(latitude)},${coordinateValue(longitude)}`,
  });
  if (apiKey) params.set('key', apiKey);
  return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
}

export default function DeviceLocationHistory({ locations }: DeviceLocationHistoryProps) {
  if (locations.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface px-4 py-12 text-center">
        <MapPin className="mx-auto h-8 w-8 text-gray-300 mb-2" />
        <p className="text-sm text-muted">No location data available for this device.</p>
        <p className="text-xs text-muted mt-1">Location history will appear here once reported.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">
        Each location includes a map preview. Open in your preferred map provider for full context.
      </p>

      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-secondary">
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted">
                Latitude
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted">
                Longitude
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted">
                Accuracy (m)
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted">
                Recorded
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted">
                Map
              </th>
            </tr>
          </thead>
          <tbody>
            {locations.map((loc, index) => (
              <tr
                key={index}
                className="border-b border-border last:border-b-0 hover:bg-surface-secondary transition-colors"
              >
                <td className="px-4 py-3 font-mono text-xs text-gray-900">
                  {coordinateValue(loc.latitude)}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-gray-900">
                  {coordinateValue(loc.longitude)}
                </td>
                <td className="px-4 py-3 text-gray-700">
                  {typeof loc.accuracy === 'number' ? loc.accuracy.toFixed(1) : 'N/A'}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-col">
                    <span className="text-gray-900">{formatRelativeTime(loc.recorded_at)}</span>
                    <span className="text-xs text-muted">{formatDate(loc.recorded_at)}</span>
                  </div>
                </td>
                <td className="px-4 py-3 min-w-[420px]">
                  <div className="space-y-2">
                    <a
                      href={buildGoogleMapsUrl(loc.latitude, loc.longitude)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block w-[360px] max-w-full overflow-hidden rounded-md border border-border bg-surface-secondary"
                    >
                      <img
                        src={buildStaticMapUrl(loc.latitude, loc.longitude, 1)}
                        srcSet={`${buildStaticMapUrl(loc.latitude, loc.longitude, 1)} 1x, ${buildStaticMapUrl(loc.latitude, loc.longitude, 2)} 2x`}
                        alt={`Map preview for ${coordinateValue(loc.latitude)}, ${coordinateValue(loc.longitude)}`}
                        loading="lazy"
                        className="h-24 w-full object-cover"
                      />
                    </a>
                    <div className="flex items-center gap-3 text-xs">
                      <a
                        href={buildGoogleMapsUrl(loc.latitude, loc.longitude)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-accent hover:underline"
                      >
                        Open in Google Maps
                      </a>
                    </div>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted">
        {locations.length} location record{locations.length !== 1 ? 's' : ''}
      </p>
    </div>
  );
}
