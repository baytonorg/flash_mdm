import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Pagination from '../Pagination';

const defaultProps = {
  page: 1,
  totalPages: 5,
  onPageChange: vi.fn(),
  perPage: 10,
  total: 50,
};

describe('Pagination', () => {
  it('shows correct "Showing X-Y of Z" text', () => {
    render(<Pagination {...defaultProps} />);
    const showingDiv = screen.getByText(/^Showing/).closest('div')!;
    const spans = showingDiv.querySelectorAll('span.font-medium');
    expect(spans[0].textContent).toBe('1');
    expect(spans[1].textContent).toBe('10');
    expect(spans[2].textContent).toBe('50');
  });

  it('shows correct range for middle page', () => {
    render(<Pagination {...defaultProps} page={3} />);
    expect(screen.getByText('21')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
  });

  it('shows correct range for last page with partial results', () => {
    render(<Pagination {...defaultProps} page={5} total={47} totalPages={5} />);
    const showingDiv = screen.getByText(/^Showing/).closest('div')!;
    const spans = showingDiv.querySelectorAll('span.font-medium');
    expect(spans[0].textContent).toBe('41');
    expect(spans[1].textContent).toBe('47');
    expect(spans[2].textContent).toBe('47');
  });

  it('shows 0 for start when total is 0', () => {
    render(<Pagination {...defaultProps} page={1} total={0} totalPages={0} />);
    const showingDiv = screen.getByText(/^Showing/).closest('div')!;
    const spans = showingDiv.querySelectorAll('span.font-medium');
    expect(spans[0].textContent).toBe('0');
    expect(spans[1].textContent).toBe('0');
    expect(spans[2].textContent).toBe('0');
  });

  it('previous button is disabled on first page', () => {
    render(<Pagination {...defaultProps} page={1} />);
    const buttons = screen.getAllByRole('button');
    // First button is previous
    expect(buttons[0]).toBeDisabled();
  });

  it('next button is disabled on last page', () => {
    render(<Pagination {...defaultProps} page={5} />);
    const buttons = screen.getAllByRole('button');
    // Last button is next
    expect(buttons[buttons.length - 1]).toBeDisabled();
  });

  it('previous button is enabled when not on first page', () => {
    render(<Pagination {...defaultProps} page={3} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons[0]).not.toBeDisabled();
  });

  it('calls onPageChange with previous page when previous is clicked', async () => {
    const onPageChange = vi.fn();
    const user = userEvent.setup();
    render(<Pagination {...defaultProps} page={3} onPageChange={onPageChange} />);

    const buttons = screen.getAllByRole('button');
    await user.click(buttons[0]);
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('calls onPageChange with next page when next is clicked', async () => {
    const onPageChange = vi.fn();
    const user = userEvent.setup();
    render(<Pagination {...defaultProps} page={3} onPageChange={onPageChange} />);

    const buttons = screen.getAllByRole('button');
    await user.click(buttons[buttons.length - 1]);
    expect(onPageChange).toHaveBeenCalledWith(4);
  });

  it('calls onPageChange when a page number is clicked', async () => {
    const onPageChange = vi.fn();
    const user = userEvent.setup();
    render(<Pagination {...defaultProps} page={1} onPageChange={onPageChange} />);

    // Click page 3
    await user.click(screen.getByRole('button', { name: '3' }));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it('renders per-page selector when onPerPageChange is provided', () => {
    const onPerPageChange = vi.fn();
    render(<Pagination {...defaultProps} onPerPageChange={onPerPageChange} />);
    expect(screen.getByText('Per page')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('does not render per-page selector when onPerPageChange is not provided', () => {
    render(<Pagination {...defaultProps} />);
    expect(screen.queryByText('Per page')).not.toBeInTheDocument();
  });

  it('calls onPerPageChange when selection changes', async () => {
    const onPerPageChange = vi.fn();
    const user = userEvent.setup();
    render(<Pagination {...defaultProps} onPerPageChange={onPerPageChange} />);

    await user.selectOptions(screen.getByRole('combobox'), '25');
    expect(onPerPageChange).toHaveBeenCalledWith(25);
  });
});
