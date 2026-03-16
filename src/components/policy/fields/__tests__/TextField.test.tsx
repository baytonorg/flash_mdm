import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TextField from '../TextField';

describe('TextField', () => {
  it('renders the label', () => {
    render(<TextField label="Device Name" value="" onChange={() => {}} />);
    expect(screen.getByText('Device Name')).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    render(
      <TextField label="Name" description="Enter the device name" value="" onChange={() => {}} />,
    );
    expect(screen.getByText('Enter the device name')).toBeInTheDocument();
  });

  it('renders an input by default', () => {
    render(<TextField label="Name" value="" onChange={() => {}} />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.getByRole('textbox').tagName).toBe('INPUT');
  });

  it('renders a textarea when multiline=true', () => {
    render(<TextField label="Description" value="" onChange={() => {}} multiline />);
    expect(screen.getByRole('textbox').tagName).toBe('TEXTAREA');
  });

  it('renders placeholder text', () => {
    render(<TextField label="Name" value="" onChange={() => {}} placeholder="Enter name" />);
    expect(screen.getByPlaceholderText('Enter name')).toBeInTheDocument();
  });

  it('displays the current value', () => {
    render(<TextField label="Name" value="My Device" onChange={() => {}} />);
    expect(screen.getByDisplayValue('My Device')).toBeInTheDocument();
  });

  it('calls onChange with new value on input', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<TextField label="Name" value="" onChange={onChange} />);

    await user.type(screen.getByRole('textbox'), 'hello');
    expect(onChange).toHaveBeenCalledTimes(5);
    expect(onChange).toHaveBeenLastCalledWith('o');
  });

  it('calls onChange for textarea input', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<TextField label="Notes" value="" onChange={onChange} multiline />);

    await user.type(screen.getByRole('textbox'), 'ab');
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
