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

    await user.click(screen.getByText('Name'));
    expect(onSort).toHaveBeenCalledWith('name', 'asc');
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

    await user.click(screen.getByText('Name'));
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
