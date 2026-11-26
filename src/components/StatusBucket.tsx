'use client';

import React, { useState, useEffect, useLayoutEffect } from 'react';
import { ChevronRight } from 'lucide-react';
import { FoxMascot } from '@/components/FoxMascot';

export const BUCKET_TITLES = {
  OVERDUE: 'Overdue',
  WINDING_DOWN: 'Winding Down',
  AWAKE: 'Awake',
  SLEEPING: 'Sleeping',
} as const;

export interface StatusBucketProps {
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
 * Collapsible section grouping members by sleep status with a count and other cues.
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
  // Restore the disclosure before paint. Only a member's toggle writes the preference.
  useIsomorphicLayoutEffect(() => {
    setIsExpanded(getSavedBucketExpansion(bucketKey, defaultExpanded));
  }, [bucketKey, defaultExpanded]);

  if (count === 0 && !showEmptyState) return null;

  const handleToggle = () => {
    const nextExpanded = !isExpanded;
    setIsExpanded(nextExpanded);
    saveBucketExpansion(bucketKey, nextExpanded);
  };

  return (
    <section className="mb-4 last:mb-0 md:mb-6" aria-labelledby={`bucket-heading-${bucketKey}`}>
      <button
        type="button"
        id={`bucket-heading-${bucketKey}`}
        onClick={handleToggle}
        aria-expanded={isExpanded}
        aria-controls={contentId}
        className="flex min-h-[44px] w-full items-center justify-between rounded-xl bg-night-surface px-3 py-2 text-left transition-colors hover:bg-night-elevated focus:outline-none focus-visible:ring-2 focus-visible:ring-status-amber/50"
      >
        <div className="flex items-center gap-2.5">
          {icon}
          <span className={`text-sm font-bold ${accentColor}`}>
            {title}
          </span>
          <span className="text-sm font-semibold tabular-nums text-cream-secondary">{count}<span className="sr-only"> {count === 1 ? 'fox' : 'foxes'}</span></span>
        </div>

        <ChevronRight
          className={`h-4 w-4 shrink-0 text-cream-secondary transition-transform duration-200 ease-in-out motion-reduce:transition-none ${
            isExpanded ? 'rotate-90' : 'rotate-0'
          }`}
          aria-hidden="true"
        />
      </button>

      {isExpanded && (
        <div id={contentId} className="mt-2 md:mt-3">
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

export interface OverdueStatusBucketProps extends Omit<StatusBucketProps, 'title' | 'id'> {
  id?: string;
  title?: string;
}

/**
 * Renders the active Overdue bucket using the stored disclosure key.
 * Placed as an active, expanded-by-default category positioned above passive buckets.
 */
export function OverdueStatusBucket({
  id = 'overdue-past-bedtime',
  title = BUCKET_TITLES.OVERDUE,
  accentColor = 'text-status-coral',
  defaultExpanded = true,
  ...props
}: OverdueStatusBucketProps) {
  return (
    <StatusBucket
      id={id}
      title={title}
      accentColor={accentColor}
      defaultExpanded={defaultExpanded}
      {...props}
    />
  );
}
