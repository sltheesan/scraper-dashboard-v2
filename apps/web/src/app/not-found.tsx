import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen grid place-items-center p-4 bg-bg text-text">
      <div className="text-center">
        <div className="text-6xl font-bold text-muted opacity-30 mb-4">404</div>
        <h2 className="text-lg font-semibold mb-2">Page not found</h2>
        <p className="text-muted text-sm mb-6">
          The page you're looking for doesn't exist.
        </p>
        <Link
          href="/"
          className="inline-block bg-accent text-white rounded-sm px-5 py-2.5 text-sm font-medium hover:bg-accent-hover transition-colors no-underline"
        >
          Go to Dashboard
        </Link>
      </div>
    </div>
  );
}
