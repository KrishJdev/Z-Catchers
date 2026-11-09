import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Z Catchers — Bedtime Accountability',
  description: 'Community Bedtime Accountability Progressive Web App across timezones.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Z Catchers',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#120F0D',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-night-bg text-cream-primary antialiased">
        <div className="mx-auto min-h-screen max-w-[480px] bg-night-bg pb-24 shadow-2xl">
          {children}
        </div>
      </body>
    </html>
  );
}
