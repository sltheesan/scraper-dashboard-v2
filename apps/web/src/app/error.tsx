'use client';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen grid place-items-center p-4 bg-bg">
      <div className="bg-surface border border-border rounded-lg p-8 max-w-md w-full text-center">
        <div className="text-4xl mb-3 opacity-30">!</div>
        <h2 className="text-lg font-semibold mb-2">Something went wrong</h2>
        <p className="text-muted text-sm mb-5">
          {error.message || 'An unexpected error occurred.'}
        </p>
        <button className="btn btn-primary" onClick={reset}>
          Try again
        </button>
      </div>
    </div>
  );
}
