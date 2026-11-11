import Link from 'next/link';
import { FoxMascot } from '@/components/FoxMascot';

/**
 * 404 Not Found Page for Z Catchers.
 * Adheres strictly to the Warm Dark design system.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-night-bg text-cream-primary p-4 text-center">
      <FoxMascot state="sleeping" size={64} className="mb-4 animate-pulse" />
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Page Not Found</h1>
      <p className="mt-2 text-xs text-cream-secondary sm:text-sm max-w-sm">
        This sleepy fox couldn&apos;t find what you were looking for. Let&apos;s get you back to the den.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex items-center justify-center rounded-xl bg-status-amber px-5 py-2.5 text-xs font-bold text-night-bg shadow transition-transform hover:bg-status-amber/90 active:scale-95"
      >
        Return to Fox Den
      </Link>
    </main>
  );
}
