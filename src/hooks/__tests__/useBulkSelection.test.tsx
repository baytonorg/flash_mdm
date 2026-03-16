import { describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBulkSelection } from '../useBulkSelection';

type Row = { id: string; name: string };

const rows: Row[] = [
  { id: 'a', name: 'A' },
  { id: 'b', name: 'B' },
];

describe('useBulkSelection', () => {
  it('tracks explicit selected ids by default', () => {
    const { result } = renderHook(() =>
      useBulkSelection<Row>({
        rows,
        rowKey: (row) => row.id,
        totalMatching: 10,
      }),
    );

    act(() => {
      result.current.onSelectionChange([rows[0]]);
    });

    expect(result.current.selectedCount).toBe(1);
    expect(result.current.selectionPayload).toEqual({ ids: ['a'] });
  });

  it('supports all matching mode and exclusion updates', () => {
    const { result } = renderHook(() =>
      useBulkSelection<Row>({
        rows,
        rowKey: (row) => row.id,
        totalMatching: 10,
      }),
    );

    act(() => {
      result.current.selectAllMatching();
    });

    expect(result.current.allMatching).toBe(true);
    expect(result.current.selectedCount).toBe(10);
    expect(result.current.selectionPayload).toEqual({
      all_matching: true,
      excluded_ids: [],
    });

    // Deselect one loaded row while in all-matching mode -> becomes excluded id
    act(() => {
      result.current.onSelectionChange([rows[0]]);
    });

    expect(result.current.selectedCount).toBe(9);
    expect(result.current.selectionPayload).toEqual({
      all_matching: true,
      excluded_ids: ['b'],
    });
  });

  it('clears all bulk state', () => {
    const { result } = renderHook(() =>
      useBulkSelection<Row>({
        rows,
        rowKey: (row) => row.id,
        totalMatching: 2,
      }),
    );

    act(() => {
      result.current.onSelectionChange(rows);
      result.current.selectAllMatching();
      result.current.clearSelection();
    });

    expect(result.current.selectedCount).toBe(0);
    expect(result.current.allMatching).toBe(false);
    expect(result.current.selectionPayload).toEqual({ ids: [] });
  });
});
