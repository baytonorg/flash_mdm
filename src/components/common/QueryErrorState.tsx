import { AlertTriangle, RefreshCw } from 'lucide-react';

interface QueryErrorStateProps {
  title: string;
  error?: unknown;
  onRetry: () => void;
  retrying?: boolean;
  compact?: boolean;
}

export default function QueryErrorState({
  title,
  error,
  onRetry,
  retrying = false,
  compact = false,
}: QueryErrorStateProps) {
  const message = error instanceof Error && error.message
    ? error.message
    : 'The request could not be completed. Please try again.';

  return (
    <div
      role="alert"
      className={`flex items-start justify-between gap-4 rounded-lg border border-amber-200 bg-amber-50 ${compact ? 'px-3 py-2' : 'px-4 py-4'}`}
    >
      <div className="flex min-w-0 items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-amber-900">{title}</p>
          <p className="mt-0.5 break-words text-sm text-amber-800">{message}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
      >
        <RefreshCw className={`h-4 w-4 ${retrying ? 'animate-spin' : ''}`} />
        Retry
      </button>
    </div>
  );
}
