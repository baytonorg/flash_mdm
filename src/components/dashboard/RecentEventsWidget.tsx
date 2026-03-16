import { Activity } from 'lucide-react';

interface RecentEvent {
  id: string;
  action: string;
  resource_type: string;
  created_at: string;
}

interface RecentEventsWidgetProps {
  events: RecentEvent[];
}

function relativeTime(dateString: string): string {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin} min ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(dateString).toLocaleDateString();
}

function formatAction(action: string): string {
  return action
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
}

function formatResourceType(type: string): string {
  return type
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
}

export default function RecentEventsWidget({ events }: RecentEventsWidgetProps) {
  const displayed = events.slice(0, 10);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 xl:col-span-2">
      <h3 className="text-sm font-semibold text-gray-900 mb-4">Recent Events</h3>
      {displayed.length === 0 ? (
        <p className="text-sm text-gray-500">No recent events.</p>
      ) : (
        <div className="max-h-80 overflow-y-auto -mx-2 px-2 space-y-3">
          {displayed.map((event) => (
            <div
              key={event.id}
              className="flex items-start gap-3 text-sm"
            >
              <div className="flex-shrink-0 mt-0.5 w-7 h-7 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center">
                <Activity className="w-3.5 h-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-gray-900 font-medium truncate">
                  {formatAction(event.action)}
                </p>
                <p className="text-gray-500 text-xs">
                  {formatResourceType(event.resource_type)} &middot; {relativeTime(event.created_at)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
