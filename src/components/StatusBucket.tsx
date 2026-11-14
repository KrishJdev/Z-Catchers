'use client';

import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { ChevronRight } from 'lucide-react';
import { FoxMascot } from '@/components/FoxMascot';

interface StatusBucketProps {
  id?: string;
  title: string;
  count: number;
  icon?: React.ReactNode;
  defaultExpanded?: boolean;
  accentColor?: string;
  showEmptyState?: boolean;
  emptyMessage?: string;
  children: React.ReactNode;
}

/**
 * Safely retrieves saved expansion override from sessionStorage.
 * Falls back to default expanded state if running in SSR, in private mode, or if no key exists.
 */
export function getSavedBucketExpansion(bucketKey: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback;
  try {
    const saved = sessionStorage.getItem(`zc_bucket_${bucketKey}_expanded`);
    if (saved !== null) {
      return saved === 'true';
    }
  } catch {
    // Ignore sessionStorage access errors (e.g. strict private browsing mode)
  }
  return fallback;
}

/**
 * Safely persists bucket expansion override to sessionStorage.
 */
export function saveBucketExpansion(bucketKey: string, isExpanded: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(`zc_bucket_${bucketKey}_expanded`, String(isExpanded));
  } catch {
    // Ignore sessionStorage write errors
  }
}

// SSR-safe layout effect: runs synchronously before browser paint on client,
// falls back to useEffect during server-side pre-rendering to avoid warnings.
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Collapsible section bucket component grouping members by sleep status (Asleep, Winding Down, Nag Now, etc.).
 * Includes count pills, Warm Dark theme accents, smooth chevron transitions, and Sleepy Fox empty state illustrations.
 *
 * @param props - Status bucket configuration properties and children cards
 * @returns React JSX collapsible bucket element
 */
export function StatusBucket({
  id,
  title,
  count,
  icon,
  defaultExpanded = true,
  accentColor = 'text-cream-primary',
  showEmptyState = false,
  emptyMessage = 'Every fox in this den is fast asleep.',
  children,
}: StatusBucketProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const bucketKey = id || title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const contentId = `bucket-content-${bucketKey}`;
  const isRestoredRef = useRef(false);

  // Restore saved session override before paint to prevent visual flash / layout shift
  useIsomorphicLayoutEffect(() => {
    if (typeof window === 'undefined') return;
    isRestoredRef.current = false;
    const saved = getSavedBucketExpansion(bucketKey, defaultExpanded);
    setIsExpanded(saved);
    isRestoredRef.current = true;
  }, [bucketKey, defaultExpanded]);

  // Persist committed expansion state separately after restoration guard verifies initial state has settled
  useEffect(() => {
    if (!isRestoredRef.current || typeof window === 'undefined') return;
    saveBucketExpansion(bucketKey, isExpanded);
  }, [isExpanded, bucketKey]);

  if (count === 0 && !showEmptyState) return null;

  const handleToggle = () => {
    setIsExpanded((prev) => !prev);
  };

  return (
    <section className="mb-6" aria-labelledby={`bucket-heading-${bucketKey}`}>
      <button
        type="button"
        id={`bucket-heading-${bucketKey}`}
        onClick={handleToggle}
        aria-expanded={isExpanded}
        aria-controls={contentId}
        className="flex w-full min-h-[44px] items-center justify-between rounded-xl border border-night-border bg-night-surface px-4 py-3 text-left transition-colors hover:border-night-border/80 hover:bg-night-elevated focus:outline-none focus-visible:ring-2 focus-visible:ring-status-amber/50"
      >
        <div className="flex items-center gap-2.5">
          {icon}
          <span className={`text-xs font-bold tracking-wider uppercase ${accentColor}`}>
            {title}
          </span>
          <span className="rounded-full bg-night-elevated border border-night-border px-2.5 py-0.5 text-xs font-semibold tabular-nums text-cream-secondary">
            {count} {count === 1 ? 'fox' : 'foxes'}
          </span>
        </div>

        <ChevronRight
          className={`h-4 w-4 text-cream-secondary transition-transform duration-200 ease-in-out ${
            isExpanded ? 'rotate-90' : 'rotate-0'
          }`}
          aria-hidden="true"
        />
      </button>

      {isExpanded && (
        <div id={contentId} className="mt-3">
          {count === 0 ? (
            <div className="flex items-center justify-center gap-3 rounded-2xl border border-night-border/60 bg-night-surface/60 px-6 py-8 text-center text-cream-secondary">
              <FoxMascot state="sleeping" size={44} />
              <div className="text-left">
                <p className="text-sm font-medium text-cream-primary">{emptyMessage}</p>
                <p className="text-xs text-cream-secondary">Quiet hours are in effect for this group.</p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3 md:gap-4 items-stretch">
              {children}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
