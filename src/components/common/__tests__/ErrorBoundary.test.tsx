import type { ReactElement } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ErrorBoundary from '../ErrorBoundary';

// A component that throws on demand
function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('Test explosion');
  }
  return <div>Child rendered OK</div>;
}

function ChunkErrorChild(): ReactElement {
  throw new Error('Failed to fetch dynamically imported module');
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    // Suppress React error boundary console noise during tests
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Child rendered OK')).toBeInTheDocument();
  });

  it('renders error UI when a child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('Test explosion')).toBeInTheDocument();
  });

  it('renders a "Try again" button', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('renders a "Go to Dashboard" link', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>,
    );
    const link = screen.getByRole('link', { name: 'Go to Dashboard' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/');
  });

  it('resets error state when "Try again" is clicked', async () => {
    const user = userEvent.setup();

    // First render with a throwing child to trigger the error boundary
    const { rerender } = render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    // Re-render with a non-throwing child, then click "Try again"
    // This updates the children prop so that when the boundary resets,
    // it will render the non-throwing version
    rerender(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={false} />
      </ErrorBoundary>,
    );

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('Child rendered OK')).toBeInTheDocument();
  });

  it('logs the error via console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>,
    );

    // Our componentDidCatch logs with this prefix
    expect(spy).toHaveBeenCalledWith(
      'ErrorBoundary caught an error:',
      expect.any(Error),
      expect.objectContaining({ componentStack: expect.any(String) }),
    );
  });

  it('shows reload-specific messaging for dynamic import errors', () => {
    render(
      <ErrorBoundary>
        <ChunkErrorChild />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Update available')).toBeInTheDocument();
    expect(screen.getByText(/Reload the app to continue/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload app' })).toBeInTheDocument();
  });

  it('reloads the page instead of local reset for dynamic import errors', async () => {
    const user = userEvent.setup();
    const reloadSpy = vi.spyOn(ErrorBoundary, 'reloadAppWindow').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ChunkErrorChild />
      </ErrorBoundary>,
    );

    await user.click(screen.getByRole('button', { name: 'Reload app' }));
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });
});
