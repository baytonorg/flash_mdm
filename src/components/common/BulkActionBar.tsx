import { type ReactNode } from 'react';
import { X } from 'lucide-react';
import clsx from 'clsx';

export interface BulkAction {
  key: string;
  label: string;
  variant?: 'danger' | 'warning' | 'default';
  icon?: ReactNode;
}

export interface BulkActionBarProps {
  selectedCount: number;
  actions: BulkAction[];
  onAction: (key: string) => void;
  onClear: () => void;
}

export default function BulkActionBar({
  selectedCount,
  actions,
  onAction,
  onClear,
}: BulkActionBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 animate-[slideUp_0.2s_ease-out]">
      <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-2.5 shadow-lg">
        <span className="text-sm font-medium text-gray-900 whitespace-nowrap">
          {selectedCount} selected
        </span>

        <div className="h-5 w-px bg-border" />

        <div className="flex items-center gap-2">
          {actions.map((action) => (
            <button
              key={action.key}
              type="button"
              onClick={() => onAction(action.key)}
              className={clsx(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                action.variant === 'danger'
                  ? 'bg-danger/10 text-danger hover:bg-danger/20'
                  : action.variant === 'warning'
                    ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200',
              )}
            >
              {action.icon}
              {action.label}
            </button>
          ))}
        </div>

        <div className="h-5 w-px bg-border" />

        <button
          type="button"
          onClick={onClear}
          className="inline-flex items-center gap-1 rounded-lg p-1.5 text-muted hover:bg-gray-100 hover:text-gray-700 transition-colors"
          title="Clear selection"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
