import { LayoutGrid, List } from 'lucide-react';
import clsx from 'clsx';

export interface ViewToggleProps {
  value: 'table' | 'card';
  onChange: (value: 'table' | 'card') => void;
}

export default function ViewToggle({ value, onChange }: ViewToggleProps) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-surface-secondary p-0.5">
      <button
        type="button"
        onClick={() => onChange('table')}
        className={clsx(
          'inline-flex items-center justify-center rounded-md p-1.5 transition-colors',
          value === 'table'
            ? 'bg-surface text-gray-900 shadow-sm'
            : 'text-muted hover:text-gray-700',
        )}
        title="Table view"
      >
        <List className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => onChange('card')}
        className={clsx(
          'inline-flex items-center justify-center rounded-md p-1.5 transition-colors',
          value === 'card'
            ? 'bg-surface text-gray-900 shadow-sm'
            : 'text-muted hover:text-gray-700',
        )}
        title="Card view"
      >
        <LayoutGrid className="h-4 w-4" />
      </button>
    </div>
  );
}
