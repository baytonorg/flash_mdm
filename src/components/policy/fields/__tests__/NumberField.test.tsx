import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NumberField from '../NumberField';

describe('NumberField', () => {
  it('renders the label', () => {
    render(<NumberField label="Timeout" value={30} onChange={() => {}} />);
    expect(screen.getByText('Timeout')).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    render(
      <NumberField
        label="Timeout"
        description="Timeout in seconds"
        value={30}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText('Timeout in seconds')).toBeInTheDocument();
  });

  it('renders input with min and max attributes', () => {
    render(<NumberField label="Count" value={5} onChange={() => {}} min={0} max={100} />);
    const input = screen.getByRole('spinbutton');
    expect(input).toHaveAttribute('min', '0');
    expect(input).toHaveAttribute('max', '100');
  });

  it('shows range hint when both min and max are set', () => {
    render(<NumberField label="Count" value={5} onChange={() => {}} min={0} max={100} />);
    expect(screen.getByText('Range: 0 - 100')).toBeInTheDocument();
  });

  it('shows minimum hint when only min is set', () => {
    render(<NumberField label="Count" value={5} onChange={() => {}} min={0} />);
    expect(screen.getByText('Minimum: 0')).toBeInTheDocument();
  });

  it('shows maximum hint when only max is set', () => {
    render(<NumberField label="Count" value={5} onChange={() => {}} max={100} />);
    expect(screen.getByText('Maximum: 100')).toBeInTheDocument();
  });

  it('displays the current value', () => {
    render(<NumberField label="Count" value={42} onChange={() => {}} />);
    expect(screen.getByDisplayValue('42')).toBeInTheDocument();
  });

  it('calls onChange with number value on input', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<NumberField label="Count" value={0} onChange={onChange} />);

    const input = screen.getByRole('spinbutton');
    await user.clear(input);
    await user.type(input, '5');
    expect(onChange).toHaveBeenCalledWith(5);
  });
});
