export default function Home() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: 24, marginBottom: 8 }}>Scraper Dashboard v2</h1>
        <p style={{ color: 'var(--muted)' }}>NestJS + Next.js + PostgreSQL</p>
      </div>
    </main>
  );
}
