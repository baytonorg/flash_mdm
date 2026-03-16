import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RepeaterField from '../RepeaterField';

const defaultProps = {
  label: 'Allowed URLs',
  description: 'Add URLs that are allowed',
  value: ['https://example.com', 'https://test.com'],
  onChange: vi.fn(),
  renderItem: (item: string, _index: number, onChange: (item: string) => void) => (
    <input
      type="text"
      value={item}
      onChange={(e) => onChange(e.target.value)}
      data-testid="repeater-input"
    />
  ),
  defaultItem: '',
};

describe('RepeaterField', () => {
  it('renders the label', () => {
    render(<RepeaterField {...defaultProps} />);
    expect(screen.getByText('Allowed URLs')).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    render(<RepeaterField {...defaultProps} />);
    expect(screen.getByText('Add URLs that are allowed')).toBeInTheDocument();
  });

  it('renders existing items', () => {
    render(<RepeaterField {...defaultProps} />);
    const inputs = screen.getAllByTestId('repeater-input');
    expect(inputs.length).toBe(2);
  });

  it('shows empty state when no items', () => {
    render(<RepeaterField {...defaultProps} value={[]} />);
    expect(screen.getByText('No items added yet')).toBeInTheDocument();
  });

  it('calls onChange with appended item when Add button is clicked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<RepeaterField {...defaultProps} onChange={onChange} />);

    await user.click(screen.getByText('Add item'));
    expect(onChange).toHaveBeenCalledWith([
      'https://example.com',
      'https://test.com',
      '',
    ]);
  });

  it('calls onChange with item removed when Remove button is clicked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<RepeaterField {...defaultProps} onChange={onChange} />);

    const removeButtons = screen.getAllByTitle('Remove item');
    await user.click(removeButtons[0]);
    expect(onChange).toHaveBeenCalledWith(['https://test.com']);
  });

  it('calls onChange when an item input changes', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<RepeaterField {...defaultProps} onChange={onChange} />);

    const inputs = screen.getAllByTestId('repeater-input');
    // Type a single character — controlled input appends to current value
    await user.type(inputs[0], 'x');
    expect(onChange).toHaveBeenCalled();
    const firstCall = onChange.mock.calls[0][0];
    expect(firstCall[0]).toBe('https://example.comx');
    expect(firstCall[1]).toBe('https://test.com');
  });

  it('copies object defaultItem by value (not reference)', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const objectProps = {
      ...defaultProps,
      value: [] as Array<{ url: string }>,
      defaultItem: { url: '' },
      onChange,
      renderItem: (item: { url: string }, _index: number, onChange: (item: { url: string }) => void) => (
        <input
          type="text"
          value={item.url}
          onChange={(e) => onChange({ url: e.target.value })}
          data-testid="repeater-input"
        />
      ),
    };
    render(<RepeaterField {...objectProps} />);

    await user.click(screen.getByText('Add item'));
    expect(onChange).toHaveBeenCalledWith([{ url: '' }]);
  });
});
