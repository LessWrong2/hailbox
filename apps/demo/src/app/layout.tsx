import { Hailbox } from 'hailbox';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import './styles.css';

export const metadata: Metadata = { title: 'Acme Widgets' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav>
          <Link href="/" className="brand">
            Acme Widgets
          </Link>
          <Link href="/pricing">Pricing</Link>
        </nav>
        <main>{children}</main>
        <Hailbox
          apiUrl={process.env.NEXT_PUBLIC_HAILBOX_URL ?? 'http://localhost:3000'}
          title="Talk to Acme"
          subtitle="We usually reply within a few hours."
          greeting="Hi! Ask us anything about Acme Widgets."
        />
      </body>
    </html>
  );
}
