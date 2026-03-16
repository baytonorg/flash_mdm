import { Loader2 } from 'lucide-react';

interface PageLoadingStateProps {
  label?: string;
  compact?: boolean;
}

export default function PageLoadingState({
  label = 'Loading…',
  compact = false,
}: PageLoadingStateProps) {
  return (
    <div className={`flex items-center justify-center ${compact ? 'py-16' : 'py-24'}`}>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin text-accent" />
        <span>{label}</span>
      </div>
    </div>
  );
}
