import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import EnvironmentActivity from './EnvironmentActivity';

describe('EnvironmentActivity', () => {
  it('renders creation and recorded activity as separate absolute timestamps', () => {
    const { container } = render(<EnvironmentActivity created_at="2026-10-01T08:00:00Z" last_user_action_at="2026-11-04T09:00:00Z" />);
    expect(screen.getByText('Created')).toBeInTheDocument();
    expect(screen.getByText('Last recorded user action')).toBeInTheDocument();
    expect([...container.querySelectorAll('time')].map((node) => node.dateTime)).toEqual(['2026-10-01T08:00:00Z', '2026-11-04T09:00:00Z']);
  });

  it('does not describe missing retained audit history as never used', () => {
    render(<EnvironmentActivity />);
    expect(screen.getByText('Not recorded')).toBeInTheDocument();
    expect(screen.getByText('No action recorded')).toBeInTheDocument();
    expect(screen.queryByText(/never/i)).not.toBeInTheDocument();
  });
});
