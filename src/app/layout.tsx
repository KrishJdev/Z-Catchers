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
    apple: '/icons/icon-192x192.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: '#120F0D',
};

/**
 * Root layout component wrapping all application pages.
 * Enforces warm dark theme background and mobile-first container layout.
 *
 * @param props - Component properties containing child nodes
 * @returns The root HTML layout structure
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className="min-h-[100dvh] bg-night-bg text-cream-primary antialiased flex flex-col"
        suppressHydrationWarning
      >
        <div className="w-full flex-1 flex flex-col bg-night-bg">
          {children}
        </div>
      </body>
    </html>
  );
}
