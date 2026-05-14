import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'IDL History Explorer',
  description: 'Explore Solana IDL versions for any program with historical IDL reconstruction support.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-zinc-950 text-zinc-100 antialiased">
        {children}
      </body>
    </html>
  );
}
