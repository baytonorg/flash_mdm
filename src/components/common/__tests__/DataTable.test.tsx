import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DataTable, { type ColumnDef } from '../DataTable';

interface TestRow {
  id: string;
  name: string;
  status: string;
}

const columns: ColumnDef<TestRow>[] = [
  { key: 'name', label: 'Name', sortable: true },
  { key: 'status', label: 'Status' },
];

const data: TestRow[] = [
  { id: '1', name: 'Device A', status: 'active' },
  { id: '2', name: 'Device B', status: 'disabled' },
  { id: '3', name: 'Device C', status: 'deleted' },
];

describe('DataTable', () => {
  it('renders column headers', () => {
    render(<DataTable columns={columns} data={data} />);
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
  });

  it('renders data rows', () => {
    render(<DataTable columns={columns} data={data} />);
    expect(screen.getByText('Device A')).toBeInTheDocument();
    expect(screen.getByText('Device B')).toBeInTheDocument();
    expect(screen.getByText('Device C')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
  });

  it('shows loading skeleton when loading=true', () => {
    const { container } = render(<DataTable columns={columns} data={[]} loading={true} />);
    const pulsingElements = container.querySelectorAll('.animate-pulse');
    expect(pulsingElements.length).toBeGreaterThan(0);
  });

  it('shows empty message when data is empty', () => {
    render(<DataTable columns={columns} data={[]} />);
    expect(screen.getByText('No data found')).toBeInTheDocument();
  });

  it('shows custom empty message', () => {
    render(<DataTable columns={columns} data={[]} emptyMessage="No devices" />);
    expect(screen.getByText('No devices')).toBeInTheDocument();
  });

  it('calls onSort when a sortable header is clicked', async () => {
    const onSort = vi.fn();
    const user = userEvent.setup();
    render(<DataTable columns={columns} data={data} onSort={onSort} />);

    await user.click(screen.getByRole('button', { name: 'Name' }));
    expect(onSort).toHaveBeenCalledWith('name', 'asc');
  });

  it('keeps column-header semantics and sorts with Enter and Space', async () => {
    const onSort = vi.fn();
    const user = userEvent.setup();
    render(<DataTable columns={columns} data={data} onSort={onSort} />);

    const header = screen.getByRole('columnheader', { name: 'Name' });
    const sortButton = screen.getByRole('button', { name: 'Name' });
    expect(header).toHaveAttribute('aria-sort', 'none');
    expect(header).toContainElement(sortButton);

    sortButton.focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onSort).toHaveBeenNthCalledWith(1, 'name', 'asc');
    expect(onSort).toHaveBeenNthCalledWith(2, 'name', 'asc');
  });

  it('does not expose an inoperative sort button without onSort', () => {
    render(<DataTable columns={columns} data={data} />);

    expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveAttribute('aria-sort', 'none');
    expect(screen.queryByRole('button', { name: 'Name' })).not.toBeInTheDocument();
  });

  it('toggles sort direction on repeated clicks', async () => {
    const onSort = vi.fn();
    const user = userEvent.setup();
    // Start with asc already set
    render(
      <DataTable
        columns={columns}
        data={data}
        onSort={onSort}
        sortColumn="name"
        sortDirection="asc"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Name' }));
    expect(onSort).toHaveBeenCalledWith('name', 'desc');
  });

  it('does not call onSort for non-sortable columns', async () => {
    const onSort = vi.fn();
    const user = userEvent.setup();
    render(<DataTable columns={columns} data={data} onSort={onSort} />);

    await user.click(screen.getByText('Status'));
    expect(onSort).not.toHaveBeenCalled();
  });

  it('renders checkboxes when selectable=true', () => {
    render(<DataTable columns={columns} data={data} selectable onSelectionChange={() => {}} />);
    const checkboxes = screen.getAllByRole('checkbox');
    // 1 "select all" + 3 row checkboxes
    expect(checkboxes.length).toBe(4);
  });

  it('calls onSelectionChange when individual checkbox is clicked', async () => {
    const onSelectionChange = vi.fn();
    const user = userEvent.setup();
    render(
      <DataTable
        columns={columns}
        data={data}
        selectable
        onSelectionChange={onSelectionChange}
        selectedRows={[]}
      />,
    );

    const checkboxes = screen.getAllByRole('checkbox');
    // Click first row checkbox (index 1, since 0 is "select all")
    await user.click(checkboxes[1]);
    expect(onSelectionChange).toHaveBeenCalledWith([data[0]]);
  });

  it('calls onSelectionChange with all rows when select-all is clicked', async () => {
    const onSelectionChange = vi.fn();
    const user = userEvent.setup();
    render(
      <DataTable
        columns={columns}
        data={data}
        selectable
        onSelectionChange={onSelectionChange}
        selectedRows={[]}
      />,
    );

    const checkboxes = screen.getAllByRole('checkbox');
    await user.click(checkboxes[0]); // select all
    expect(onSelectionChange).toHaveBeenCalledWith([...data]);
  });

  it('deselects all when all are already selected and select-all is clicked', async () => {
    const onSelectionChange = vi.fn();
    const user = userEvent.setup();
    render(
      <DataTable
        columns={columns}
        data={data}
        selectable
        onSelectionChange={onSelectionChange}
        selectedRows={data}
      />,
    );

    const checkboxes = screen.getAllByRole('checkbox');
    await user.click(checkboxes[0]); // deselect all
    expect(onSelectionChange).toHaveBeenCalledWith([]);
  });

  it('calls onRowClick when a row is clicked', async () => {
    const onRowClick = vi.fn();
    const user = userEvent.setup();
    render(<DataTable columns={columns} data={data} onRowClick={onRowClick} />);

    await user.click(screen.getByText('Device A'));
    expect(onRowClick).toHaveBeenCalledWith(data[0]);
  });

  it('exposes a native keyboard-operable row action', async () => {
    const onRowClick = vi.fn();
    const user = userEvent.setup();
    render(
      <DataTable
        columns={columns}
        data={data}
        onRowClick={onRowClick}
        rowActionLabel={(row) => `Open ${row.name}`}
      />,
    );

    const rowAction = screen.getByRole('button', { name: 'Open Device A' });
    rowAction.focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');

    expect(onRowClick).toHaveBeenNthCalledWith(1, data[0]);
    expect(onRowClick).toHaveBeenNthCalledWith(2, data[0]);
    expect(rowAction.closest('tr')).not.toHaveAttribute('tabindex');
  });

  it('does not invoke the row action from nested interactive controls', async () => {
    const onRowClick = vi.fn();
    const nestedAction = vi.fn();
    const user = userEvent.setup();
    const interactiveColumns: ColumnDef<TestRow>[] = [
      columns[0],
      {
        key: 'status',
        label: 'Status',
        render: (_value, row) => (
          <button type="button" onClick={() => nestedAction(row)}>Delete {row.name}</button>
        ),
      },
    ];
    render(<DataTable columns={interactiveColumns} data={data} onRowClick={onRowClick} />);

    const nestedButton = screen.getByRole('button', { name: 'Delete Device A' });
    await user.click(nestedButton);
    nestedButton.focus();
    await user.keyboard('{Enter}');

    expect(nestedAction).toHaveBeenCalledTimes(2);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('preserves first-cell interactive content without nesting or row activation', async () => {
    const onRowClick = vi.fn();
    const nestedAction = vi.fn();
    const user = userEvent.setup();
    const interactiveColumns: ColumnDef<TestRow>[] = [
      {
        key: 'name',
        label: 'Name',
        render: (_value, row) => (
          <button type="button" onClick={() => nestedAction(row)}>Edit {row.name}</button>
        ),
      },
      columns[1],
    ];
    const { container } = render(
      <DataTable columns={interactiveColumns} data={data} onRowClick={onRowClick} />,
    );

    const nestedButton = screen.getByRole('button', { name: 'Edit Device A' });
    expect(nestedButton.parentElement).toBe(container.querySelector('tbody td'));
    await user.click(nestedButton);
    nestedButton.focus();
    await user.keyboard(' ');

    expect(nestedAction).toHaveBeenCalledTimes(2);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('does not invoke the row action from labels or custom ARIA controls', async () => {
    const onRowClick = vi.fn();
    const user = userEvent.setup();
    const interactiveColumns: ColumnDef<TestRow>[] = [
      columns[0],
      {
        key: 'status',
        label: 'Status',
        render: (_value, row) => (
          <div>
            <label>
              <input type="checkbox" /> Select {row.name}
            </label>
            <span
              role="slider"
              aria-label={`Adjust ${row.name}`}
              aria-valuemin={0}
              aria-valuemax={10}
              aria-valuenow={5}
              tabIndex={0}
            >
              Adjust {row.name}
            </span>
          </div>
        ),
      },
    ];
    render(<DataTable columns={interactiveColumns} data={data} onRowClick={onRowClick} />);

    await user.click(screen.getByText('Select Device A'));
    await user.click(screen.getByRole('slider', { name: 'Adjust Device A' }));

    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('retains whole-row pointer activation on non-interactive cells', async () => {
    const onRowClick = vi.fn();
    const user = userEvent.setup();
    render(<DataTable columns={columns} data={data} onRowClick={onRowClick} />);

    await user.click(screen.getByText('active'));
    expect(onRowClick).toHaveBeenCalledWith(data[0]);
  });

  it('renders custom cell content via column render function', () => {
    const columnsWithRender: ColumnDef<TestRow>[] = [
      {
        key: 'name',
        label: 'Name',
        render: (value) => <strong data-testid="custom">{String(value)}</strong>,
      },
    ];
    render(<DataTable columns={columnsWithRender} data={data} />);
    const customElements = screen.getAllByTestId('custom');
    expect(customElements.length).toBe(3);
    expect(customElements[0]).toHaveTextContent('Device A');
  });
});
