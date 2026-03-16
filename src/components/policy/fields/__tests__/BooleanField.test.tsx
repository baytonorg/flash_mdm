import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BooleanField from '../BooleanField';

describe('BooleanField', () => {
  it('renders the label', () => {
    render(<BooleanField label="Enable feature" value={false} onChange={() => {}} />);
    expect(screen.getByText('Enable feature')).toBeInTheDocument();
  });

  it('renders the description when provided', () => {
    render(
      <BooleanField
        label="Enable feature"
        description="Turns on the feature for all users"
        value={false}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText('Turns on the feature for all users')).toBeInTheDocument();
  });

  it('does not render description when not provided', () => {
    const { container } = render(
      <BooleanField label="Enable" value={false} onChange={() => {}} />,
    );
    expect(container.querySelectorAll('p').length).toBe(0);
  });

  it('renders a switch with correct aria-checked for false', () => {
    render(<BooleanField label="Toggle" value={false} onChange={() => {}} />);
    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('renders a switch with correct aria-checked for true', () => {
    render(<BooleanField label="Toggle" value={true} onChange={() => {}} />);
    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  it('calls onChange with toggled value when clicked (false -> true)', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<BooleanField label="Toggle" value={false} onChange={onChange} />);

    await user.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('calls onChange with toggled value when clicked (true -> false)', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<BooleanField label="Toggle" value={true} onChange={onChange} />);

    await user.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(false);
  });
});
