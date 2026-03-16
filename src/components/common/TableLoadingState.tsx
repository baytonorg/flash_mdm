interface TableLoadingStateProps {
  columnCount: number;
  rowCount?: number;
  selectable?: boolean;
}

export default function TableLoadingState({
  columnCount,
  rowCount = 5,
  selectable = false,
}: TableLoadingStateProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-secondary">
            {selectable && (
              <th className="w-10 px-3 py-3">
                <div className="h-4 w-4 rounded bg-gray-200 animate-pulse" />
              </th>
            )}
            {Array.from({ length: columnCount }).map((_, idx) => (
              <th key={idx} className="px-4 py-3 text-left">
                <div className="h-4 w-20 rounded bg-gray-200 animate-pulse" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rowCount }).map((_, rowIdx) => (
            <tr key={rowIdx} className="border-b border-border last:border-b-0">
              {selectable && (
                <td className="px-3 py-3">
                  <div className="h-4 w-4 rounded bg-gray-200 animate-pulse" />
                </td>
              )}
              {Array.from({ length: columnCount }).map((__, colIdx) => (
                <td key={colIdx} className="px-4 py-3">
                  <div className="h-4 w-full max-w-[200px] rounded bg-gray-200 animate-pulse" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
