import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

function isLikelyDynamicImportError(error: Error | null): boolean {
  if (!error) return false;
  const message = (error.message ?? '').toLowerCase();
  return (
    message.includes('dynamically imported module') ||
    message.includes('failed to fetch dynamically imported module') ||
    message.includes('importing a module script failed') ||
    message.includes('chunkloaderror') ||
    message.includes('loading chunk')
  );
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  static reloadAppWindow(): void {
    window.location.reload();
  }

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  handleReset = (): void => {
    if (isLikelyDynamicImportError(this.state.error)) {
      ErrorBoundary.reloadAppWindow();
      return;
    }
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      const shouldReload = isLikelyDynamicImportError(this.state.error);
      return (
        <div className="flex min-h-screen items-center justify-center bg-surface-secondary px-4">
          <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-sm text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-red-500">
              <AlertTriangle className="h-7 w-7" />
            </div>
            <h1 className="text-lg font-semibold text-gray-900">
              {shouldReload ? 'Update available' : 'Something went wrong'}
            </h1>
            <p className="mt-2 text-sm text-muted">
              {shouldReload
                ? 'This page was updated while you were using it. Reload the app to continue.'
                : this.state.error?.message ?? 'An unexpected error occurred.'}
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
              <button
                type="button"
                onClick={this.handleReset}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-light transition-colors"
              >
                {shouldReload ? 'Reload app' : 'Try again'}
              </button>
              <a
                href="/"
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Go to Dashboard
              </a>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
