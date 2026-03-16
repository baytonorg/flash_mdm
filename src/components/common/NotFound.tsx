import { FileQuestion } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-secondary px-4">
      <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-sm text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-surface-secondary text-muted">
          <FileQuestion className="h-7 w-7" />
        </div>
        <h1 className="text-lg font-semibold text-gray-900">Page not found</h1>
        <p className="mt-2 text-sm text-muted">
          The page you are looking for does not exist or has been moved.
        </p>
        <div className="mt-6">
          <a
            href="/"
            className="inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-light transition-colors"
          >
            Go to Dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
