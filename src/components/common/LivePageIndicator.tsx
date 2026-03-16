import { Radio } from 'lucide-react';

interface LivePageIndicatorProps {
  intervalMs: number;
  lastUpdatedAt?: number;
  className?: string;
}

function formatInterval(intervalMs: number): string {
  if (intervalMs % 60_000 === 0) {
    const minutes = intervalMs / 60_000;
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  const seconds = Math.round(intervalMs / 1000);
  return `${seconds} second${seconds === 1 ? '' : 's'}`;
}

export default function LivePageIndicator({
  intervalMs,
  lastUpdatedAt,
  className = '',
}: LivePageIndicatorProps) {
  const lastUpdated = lastUpdatedAt ? new Date(lastUpdatedAt).toLocaleTimeString() : 'Waiting for first refresh';
  const title = `Live page. Refreshes every ${formatInterval(intervalMs)}. Last updated: ${lastUpdated}`;

  return (
    <span
      title={title}
      aria-label={title}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-green-600 ${className}`}
    >
      <Radio className="h-4 w-4 animate-pulse" />
    </span>
  );
}
