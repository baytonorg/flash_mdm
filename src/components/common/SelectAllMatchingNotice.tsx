interface SelectAllMatchingNoticeProps {
  loadedCount: number;
  totalCount: number;
  allMatching: boolean;
  canSelectAllMatching: boolean;
  onSelectAllMatching: () => void;
}

export default function SelectAllMatchingNotice({
  loadedCount,
  totalCount,
  allMatching,
  canSelectAllMatching,
  onSelectAllMatching,
}: SelectAllMatchingNoticeProps) {
  if (allMatching) {
    return (
      <div className="rounded-lg border border-accent/20 bg-accent/5 px-3 py-2 text-sm text-gray-700">
        All {totalCount.toLocaleString()} matching rows are selected.
      </div>
    );
  }

  if (!canSelectAllMatching) return null;

  return (
    <div className="rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm text-gray-700">
      All {loadedCount.toLocaleString()} loaded rows are selected.
      <button
        type="button"
        onClick={onSelectAllMatching}
        className="ml-2 font-medium text-accent hover:underline"
      >
        Select all {totalCount.toLocaleString()} matching
      </button>
    </div>
  );
}
