import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FilterBar, { type FilterDef } from '../FilterBar';

describe('FilterBar', () => {
  it('renders search input with default placeholder', () => {
    render(<FilterBar searchValue="" onSearchChange={() => {}} />);
    expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument();
  });

  it('renders search input with custom placeholder', () => {
    render(
      <FilterBar searchValue="" onSearchChange={() => {}} searchPlaceholder="Search devices..." />,
    );
    expect(screen.getByPlaceholderText('Search devices...')).toBeInTheDocument();
  });

  it('displays the current search value', () => {
    render(<FilterBar searchValue="hello" onSearchChange={() => {}} />);
    expect(screen.getByDisplayValue('hello')).toBeInTheDocument();
  });

  it('calls onSearchChange when typing in search input', async () => {
    const onSearchChange = vi.fn();
    const user = userEvent.setup();
    render(<FilterBar searchValue="" onSearchChange={onSearchChange} />);

    await user.type(screen.getByPlaceholderText('Search...'), 'test');
    expect(onSearchChange).toHaveBeenCalled();
    // Each character triggers onChange
    expect(onSearchChange.mock.calls.length).toBe(4);
  });

  it('renders filter dropdowns', () => {
    const filters: FilterDef[] = [
      {
        key: 'status',
        label: 'Status',
        options: [
          { value: 'active', label: 'Active' },
          { value: 'disabled', label: 'Disabled' },
        ],
        value: '',
        onChange: vi.fn(),
      },
    ];
    render(<FilterBar searchValue="" onSearchChange={() => {}} filters={filters} />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Disabled')).toBeInTheDocument();
  });

  it('calls filter onChange when selection changes', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const filters: FilterDef[] = [
      {
        key: 'status',
        label: 'All Statuses',
        options: [
          { value: 'active', label: 'Active' },
          { value: 'disabled', label: 'Disabled' },
        ],
        value: '',
        onChange,
      },
    ];
    render(<FilterBar searchValue="" onSearchChange={() => {}} filters={filters} />);

    await user.selectOptions(screen.getByRole('combobox'), 'active');
    expect(onChange).toHaveBeenCalledWith('active');
  });

  it('renders multiple filter dropdowns', () => {
    const filters: FilterDef[] = [
      {
        key: 'status',
        label: 'Status',
        options: [{ value: 'active', label: 'Active' }],
        value: '',
        onChange: vi.fn(),
      },
      {
        key: 'type',
        label: 'Type',
        options: [{ value: 'phone', label: 'Phone' }],
        value: '',
        onChange: vi.fn(),
      },
    ];
    render(<FilterBar searchValue="" onSearchChange={() => {}} filters={filters} />);
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBe(2);
  });

  it('does not render filter section when no filters provided', () => {
    const { container } = render(<FilterBar searchValue="" onSearchChange={() => {}} />);
    expect(container.querySelectorAll('select').length).toBe(0);
  });
});
