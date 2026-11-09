import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Z Catchers — Community Bedtime Accountability',
  description: 'Community Bedtime Accountability PWA & Dashboard across timezones.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Z Catchers',
  },
  icons: {
    icon: '/icons/icon.svg',
    apple: '/icons/icon.svg',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#120F0D',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-night-bg text-cream-primary antialiased flex flex-col">
        <div className="w-full flex-1 flex flex-col bg-night-bg">
          {children}
        </div>
      </body>
    </html>
  );
}
