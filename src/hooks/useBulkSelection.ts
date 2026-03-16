import { useMemo, useState } from 'react';

export type BulkSelectionPayload = {
  ids?: string[];
  all_matching?: boolean;
  excluded_ids?: string[];
};

interface UseBulkSelectionOptions<T> {
  rows: T[];
  rowKey: (row: T) => string;
  totalMatching: number;
}

export function useBulkSelection<T>({
  rows,
  rowKey,
  totalMatching,
}: UseBulkSelectionOptions<T>) {
  const [selectedRows, setSelectedRows] = useState<T[]>([]);
  const [allMatching, setAllMatching] = useState(false);
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());

  const rowIds = useMemo(() => rows.map((row) => rowKey(row)), [rows, rowKey]);
  const selectedIdSet = useMemo(() => new Set(selectedRows.map((row) => rowKey(row))), [selectedRows, rowKey]);
  const allLoadedSelected = rows.length > 0 && rowIds.every((id) => selectedIdSet.has(id));

  const selectedCount = allMatching
    ? Math.max(0, totalMatching - excludedIds.size)
    : selectedRows.length;

  const canSelectAllMatching = !allMatching && totalMatching > rows.length && allLoadedSelected;

  const onSelectionChange = (nextSelectedRows: T[]) => {
    if (!allMatching) {
      setSelectedRows(nextSelectedRows);
      return;
    }

    const nextSelectedIds = new Set(nextSelectedRows.map((row) => rowKey(row)));
    setExcludedIds((prev) => {
      const next = new Set(prev);
      for (const id of rowIds) {
        if (nextSelectedIds.has(id)) next.delete(id);
        else next.add(id);
      }
      return next;
    });
    setSelectedRows(nextSelectedRows);
  };

  const selectAllMatching = () => {
    setAllMatching(true);
    setExcludedIds(new Set());
    setSelectedRows(rows);
  };

  const clearSelection = () => {
    setAllMatching(false);
    setExcludedIds(new Set());
    setSelectedRows([]);
  };

  const selectionPayload: BulkSelectionPayload = allMatching
    ? {
        all_matching: true,
        excluded_ids: Array.from(excludedIds),
      }
    : {
        ids: Array.from(new Set(selectedRows.map((row) => rowKey(row)))),
      };

  return {
    selectedRows,
    selectedCount,
    allMatching,
    canSelectAllMatching,
    onSelectionChange,
    selectAllMatching,
    clearSelection,
    selectionPayload,
  };
}
