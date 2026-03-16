import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import NotFound from '../NotFound';

describe('NotFound', () => {
  it('renders the "Page not found" heading', () => {
    render(<NotFound />);
    expect(screen.getByText('Page not found')).toBeInTheDocument();
  });

  it('renders a descriptive message', () => {
    render(<NotFound />);
    expect(
      screen.getByText('The page you are looking for does not exist or has been moved.'),
    ).toBeInTheDocument();
  });

  it('renders a "Go to Dashboard" link pointing to /', () => {
    render(<NotFound />);
    const link = screen.getByRole('link', { name: 'Go to Dashboard' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/');
  });
});
