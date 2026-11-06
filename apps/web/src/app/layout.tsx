import type { Metadata } from 'next';
import { AuthProvider } from '@/contexts/auth-context';
import './globals.css';

export const metadata: Metadata = {
  title: 'Scraper Dashboard',
  description: 'Multi-profile browser scraper dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
