import { ChevronLeft, ChevronRight } from 'lucide-react';
import clsx from 'clsx';

export interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  perPage: number;
  onPerPageChange?: (perPage: number) => void;
  total: number;
}

const PER_PAGE_OPTIONS = [10, 25, 50, 100];

export default function Pagination({
  page,
  totalPages,
  onPageChange,
  perPage,
  onPerPageChange,
  total,
}: PaginationProps) {
  const start = total === 0 ? 0 : (page - 1) * perPage + 1;
  const end = Math.min(page * perPage, total);

  // Compute visible page numbers (current +/- 1, plus first/last)
  const getPages = (): (number | 'ellipsis')[] => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const pages: (number | 'ellipsis')[] = [];
    pages.push(1);
    if (page > 3) pages.push('ellipsis');
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
      pages.push(i);
    }
    if (page < totalPages - 2) pages.push('ellipsis');
    pages.push(totalPages);
    return pages;
  };

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-sm">
      {/* Showing X-Y of Z */}
      <div className="text-muted">
        Showing <span className="font-medium text-gray-900">{start}</span>
        {' '}-{' '}
        <span className="font-medium text-gray-900">{end}</span>
        {' '}of{' '}
        <span className="font-medium text-gray-900">{total}</span>
      </div>

      <div className="flex items-center gap-4">
        {/* Per-page selector */}
        {onPerPageChange && (
          <div className="flex items-center gap-2">
            <span className="text-muted">Per page</span>
            <select
              value={perPage}
              onChange={(e) => onPerPageChange(Number(e.target.value))}
              className="rounded-lg border border-border bg-surface px-2 py-1 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            >
              {PER_PAGE_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Page buttons */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            className="inline-flex items-center justify-center rounded-lg border border-border bg-surface p-1.5 text-muted hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          {getPages().map((p, i) =>
            p === 'ellipsis' ? (
              <span key={`e${i}`} className="px-1.5 text-muted">
                ...
              </span>
            ) : (
              <button
                key={p}
                type="button"
                onClick={() => onPageChange(p)}
                className={clsx(
                  'inline-flex h-8 w-8 items-center justify-center rounded-lg text-sm font-medium transition-colors',
                  p === page
                    ? 'bg-accent text-white'
                    : 'text-gray-700 hover:bg-gray-100',
                )}
              >
                {p}
              </button>
            ),
          )}

          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            className="inline-flex items-center justify-center rounded-lg border border-border bg-surface p-1.5 text-muted hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
