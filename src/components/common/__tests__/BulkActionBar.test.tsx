import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BulkActionBar, { type BulkAction } from '../BulkActionBar';

const actions: BulkAction[] = [
  { key: 'move', label: 'Move' },
  { key: 'delete', label: 'Delete', variant: 'danger' },
];

describe('BulkActionBar', () => {
  it('returns null when selectedCount is 0', () => {
    const { container } = render(
      <BulkActionBar selectedCount={0} actions={actions} onAction={vi.fn()} onClear={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders when selectedCount > 0', () => {
    render(
      <BulkActionBar selectedCount={3} actions={actions} onAction={vi.fn()} onClear={vi.fn()} />,
    );
    expect(screen.getByText('3 selected')).toBeInTheDocument();
  });

  it('shows action buttons', () => {
    render(
      <BulkActionBar selectedCount={2} actions={actions} onAction={vi.fn()} onClear={vi.fn()} />,
    );
    expect(screen.getByText('Move')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('calls onAction with the correct key when an action button is clicked', async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    render(
      <BulkActionBar selectedCount={2} actions={actions} onAction={onAction} onClear={vi.fn()} />,
    );

    await user.click(screen.getByText('Move'));
    expect(onAction).toHaveBeenCalledWith('move');

    await user.click(screen.getByText('Delete'));
    expect(onAction).toHaveBeenCalledWith('delete');
  });

  it('calls onClear when clear button is clicked', async () => {
    const onClear = vi.fn();
    const user = userEvent.setup();
    render(
      <BulkActionBar selectedCount={2} actions={actions} onAction={vi.fn()} onClear={onClear} />,
    );

    await user.click(screen.getByTitle('Clear selection'));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('danger variant action has correct styling', () => {
    render(
      <BulkActionBar selectedCount={1} actions={actions} onAction={vi.fn()} onClear={vi.fn()} />,
    );
    const deleteBtn = screen.getByText('Delete');
    expect(deleteBtn).toHaveClass('text-danger');
  });

  it('default variant action has correct styling', () => {
    render(
      <BulkActionBar selectedCount={1} actions={actions} onAction={vi.fn()} onClear={vi.fn()} />,
    );
    const moveBtn = screen.getByText('Move');
    expect(moveBtn).toHaveClass('text-gray-700');
  });

  it('displays correct selected count for various numbers', () => {
    const { rerender } = render(
      <BulkActionBar selectedCount={1} actions={actions} onAction={vi.fn()} onClear={vi.fn()} />,
    );
    expect(screen.getByText('1 selected')).toBeInTheDocument();

    rerender(
      <BulkActionBar selectedCount={99} actions={actions} onAction={vi.fn()} onClear={vi.fn()} />,
    );
    expect(screen.getByText('99 selected')).toBeInTheDocument();
  });
});
