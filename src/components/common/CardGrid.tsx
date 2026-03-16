import { type ReactNode } from 'react';
import clsx from 'clsx';

export interface CardGridProps<T> {
  items: T[];
  renderCard: (item: T, index: number) => ReactNode;
  loading?: boolean;
  emptyMessage?: string;
  columns?: 2 | 3 | 4;
}

const gridColsClass: Record<number, string> = {
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
};

export default function CardGrid<T>({
  items,
  renderCard,
  loading = false,
  emptyMessage = 'No items found',
  columns = 3,
}: CardGridProps<T>) {
  if (loading) {
    return (
      <div className={clsx('grid gap-4', gridColsClass[columns])}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="rounded-lg border border-border bg-surface p-5 animate-pulse"
          >
            <div className="h-4 w-3/4 rounded bg-gray-200 mb-3" />
            <div className="h-3 w-1/2 rounded bg-gray-200 mb-2" />
            <div className="h-3 w-2/3 rounded bg-gray-200 mb-4" />
            <div className="h-8 w-20 rounded bg-gray-200" />
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface px-4 py-12 text-center text-sm text-muted">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className={clsx('grid gap-4', gridColsClass[columns])}>
      {items.map((item, index) => (
        <div key={index}>{renderCard(item, index)}</div>
      ))}
    </div>
  );
}
