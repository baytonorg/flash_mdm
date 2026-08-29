import { type MouseEvent, type ReactNode, useCallback, useMemo } from 'react';
import { ArrowUp, ArrowDown, ArrowUpDown, ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import TableLoadingState from '@/components/common/TableLoadingState';

export interface ColumnDef<T = Record<string, unknown>> {
  key: string;
  label: string;
  sortable?: boolean;
  render?: (value: unknown, row: T) => ReactNode;
  className?: string;
}

export interface DataTableProps<T = Record<string, unknown>> {
  columns: ColumnDef<T>[];
  data: T[];
  loading?: boolean;
  emptyMessage?: string;
  selectable?: boolean;
  onSelectionChange?: (selectedRows: T[]) => void;
  sortColumn?: string;
  sortDirection?: 'asc' | 'desc';
  onSort?: (column: string, direction: 'asc' | 'desc') => void;
  onRowClick?: (row: T) => void;
  rowActionLabel?: (row: T, index: number) => string;
  selectedRows?: T[];
  rowKey?: (row: T) => string;
}

export default function DataTable<T extends object>({
  columns,
  data,
  loading = false,
  emptyMessage = 'No data found',
  selectable = false,
  onSelectionChange,
  sortColumn,
  sortDirection,
  onSort,
  onRowClick,
  rowActionLabel,
  selectedRows = [],
  rowKey,
}: DataTableProps<T>) {
  const getRowKey = useCallback(
    (row: T, index: number): string => {
      if (rowKey) return rowKey(row);
      if ('id' in row) return String(row.id);
      return String(index);
    },
    [rowKey],
  );

  const selectedKeySet = useMemo(() => {
    return new Set(selectedRows.map((r, i) => getRowKey(r, i)));
  }, [selectedRows, getRowKey]);

  const allSelected = data.length > 0 && data.every((row, i) => selectedKeySet.has(getRowKey(row, i)));

  const handleSelectAll = () => {
    if (!onSelectionChange) return;
    onSelectionChange(allSelected ? [] : [...data]);
  };

  const handleSelectRow = (row: T, index: number) => {
    if (!onSelectionChange) return;
    const key = getRowKey(row, index);
    if (selectedKeySet.has(key)) {
      onSelectionChange(selectedRows.filter((r, i) => getRowKey(r, i) !== key));
    } else {
      onSelectionChange([...selectedRows, row]);
    }
  };

  const handleSort = (column: ColumnDef<T>) => {
    if (!column.sortable || !onSort) return;
    const newDirection =
      sortColumn === column.key && sortDirection === 'asc' ? 'desc' : 'asc';
    onSort(column.key, newDirection);
  };

  const renderSortIcon = (column: ColumnDef<T>) => {
    if (!column.sortable) return null;
    if (sortColumn !== column.key) {
      return <ArrowUpDown className="ml-1 inline h-3.5 w-3.5 text-muted" />;
    }
    return sortDirection === 'asc' ? (
      <ArrowUp className="ml-1 inline h-3.5 w-3.5 text-accent" />
    ) : (
      <ArrowDown className="ml-1 inline h-3.5 w-3.5 text-accent" />
    );
  };

  const getValue = (row: T, key: string): unknown => {
    return (row as Record<string, unknown>)[key];
  };

  const isInteractiveTarget = (target: EventTarget | null) => {
    return target instanceof Element && Boolean(target.closest(
      'a, button, input, select, textarea, label, summary, audio[controls], video[controls], [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="slider"], [role="spinbutton"], [role="combobox"], [role="textbox"], [role="searchbox"], [role="listbox"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [role="tab"], [role="treeitem"], [contenteditable]:not([contenteditable="false"]), [data-row-click-ignore]',
    ));
  };

  const handleRowPointerClick = (event: MouseEvent<HTMLTableRowElement>, row: T) => {
    if (!onRowClick || isInteractiveTarget(event.target)) return;
    onRowClick(row);
  };

  // Loading skeleton
  if (loading) {
    return (
      <TableLoadingState
        columnCount={columns.length + (onRowClick ? 1 : 0)}
        selectable={selectable}
      />
    );
  }

  // Empty state
  if (data.length === 0) {
    return (
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-secondary">
              {selectable && (
                <th scope="col" className="w-10 px-3 py-3">
                  <span className="sr-only">Selection</span>
                </th>
              )}
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted"
                >
                  {col.label}
                </th>
              ))}
              {onRowClick && (
                <th scope="col" className="w-12 px-3 py-3">
                  <span className="sr-only">Open</span>
                </th>
              )}
            </tr>
          </thead>
        </table>
        <div className="px-4 py-12 text-center text-sm text-muted">{emptyMessage}</div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-secondary">
            {selectable && (
              <th scope="col" className="w-10 px-3 py-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={handleSelectAll}
                  aria-label="Select all rows"
                  className="h-4 w-4 rounded border-gray-300 text-accent focus:ring-accent/20"
                />
              </th>
            )}
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={clsx(
                  'px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted',
                  col.className,
                )}
                aria-sort={
                  col.sortable && sortColumn === col.key
                    ? (sortDirection === 'asc' ? 'ascending' : 'descending')
                  : col.sortable ? 'none' : undefined
                }
              >
                {col.sortable && onSort ? (
                  <button
                    type="button"
                    className="inline-flex w-full items-center text-left hover:text-gray-900 focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                    onClick={() => handleSort(col)}
                  >
                    {col.label}
                    {renderSortIcon(col)}
                  </button>
                ) : (
                  <span className="inline-flex items-center">{col.label}</span>
                )}
              </th>
            ))}
            {onRowClick && (
              <th scope="col" className="w-12 px-3 py-3">
                <span className="sr-only">Open</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {data.map((row, rowIndex) => {
            const key = getRowKey(row, rowIndex);
            const isSelected = selectedKeySet.has(key);
            return (
              <tr
                key={key}
                className={clsx(
                  'border-b border-border last:border-b-0 transition-colors',
                  isSelected ? 'bg-accent/5' : 'hover:bg-surface-secondary',
                  onRowClick && 'cursor-pointer',
                )}
                onClick={(event) => handleRowPointerClick(event, row)}
              >
                {selectable && (
                  <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => handleSelectRow(row, rowIndex)}
                      aria-label={`Select row ${rowIndex + 1}`}
                      className="h-4 w-4 rounded border-gray-300 text-accent focus:ring-accent/20"
                    />
                  </td>
                )}
                {columns.map((col) => (
                  <td key={col.key} className={clsx('px-4 py-3', col.className)}>
                    {col.render
                      ? col.render(getValue(row, col.key), row)
                      : (String(getValue(row, col.key) ?? ''))}
                  </td>
                ))}
                {onRowClick && (
                  <td className="w-12 px-3 py-3 text-right">
                    <button
                      type="button"
                      aria-label={rowActionLabel?.(row, rowIndex) ?? `Open row ${rowIndex + 1}`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded text-muted transition-colors hover:bg-surface-secondary hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                      onClick={() => onRowClick(row)}
                    >
                      <ChevronRight className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
