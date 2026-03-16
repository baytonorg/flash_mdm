import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EmptyState from '../EmptyState';

describe('EmptyState', () => {
  it('renders the title', () => {
    render(<EmptyState title="No devices" />);
    expect(screen.getByText('No devices')).toBeInTheDocument();
  });

  it('renders the description when provided', () => {
    render(<EmptyState title="No devices" description="Get started by enrolling a device." />);
    expect(screen.getByText('Get started by enrolling a device.')).toBeInTheDocument();
  });

  it('does not render description when not provided', () => {
    const { container } = render(<EmptyState title="No devices" />);
    expect(container.querySelectorAll('p').length).toBe(0);
  });

  it('renders action button when provided', () => {
    render(
      <EmptyState
        title="No devices"
        action={{ label: 'Add Device', onClick: vi.fn() }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Add Device' })).toBeInTheDocument();
  });

  it('calls onClick when action button is clicked', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <EmptyState
        title="No devices"
        action={{ label: 'Add Device', onClick }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Add Device' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not render action button when not provided', () => {
    render(<EmptyState title="No devices" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders default icon when none provided', () => {
    const { container } = render(<EmptyState title="No devices" />);
    // The Inbox icon from lucide-react renders as an SVG
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('renders custom icon when provided', () => {
    render(
      <EmptyState
        title="No devices"
        icon={<span data-testid="custom-icon">Custom</span>}
      />,
    );
    expect(screen.getByTestId('custom-icon')).toBeInTheDocument();
  });
});
