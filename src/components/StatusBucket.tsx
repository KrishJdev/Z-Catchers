'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { FoxMascot } from '@/components/FoxMascot';

interface StatusBucketProps {
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
 * Collapsible section bucket component grouping members by sleep status (Asleep, Winding Down, Nag Now, etc.).
 * Includes count pills, Warm Dark theme accents, and Sleepy Fox empty state illustrations.
 *
 * @param props - Status bucket configuration properties and children cards
 * @returns React JSX collapsible bucket element
 */
export function StatusBucket({
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

  if (count === 0 && !showEmptyState) return null;

  return (
    <section className="mb-6">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full min-h-[44px] items-center justify-between rounded-xl border border-night-border bg-night-surface px-4 py-3 text-left transition-colors hover:border-night-border/80 hover:bg-night-elevated"
      >
        <div className="flex items-center gap-2.5">
          {icon}
          <span className={`text-xs font-bold tracking-wider uppercase ${accentColor}`}>
            {title}
          </span>
          <span className="rounded-full bg-night-elevated border border-night-border px-2.5 py-0.5 text-xs font-semibold tabular-nums text-cream-secondary">
            {count}
          </span>
        </div>

        {isExpanded ? (
          <ChevronDown className="h-4 w-4 text-cream-secondary" />
        ) : (
          <ChevronRight className="h-4 w-4 text-cream-secondary" />
        )}
      </button>

      {isExpanded && (
        <div className="mt-3">
          {count === 0 ? (
            <div className="flex items-center justify-center gap-3 rounded-2xl border border-night-border/60 bg-night-surface/60 px-6 py-8 text-center text-cream-secondary">
              <FoxMascot state="sleeping" size={44} />
              <div className="text-left">
                <p className="text-sm font-medium text-cream-primary">{emptyMessage}</p>
                <p className="text-xs text-cream-secondary">Quiet hours are in effect for this group.</p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 md:gap-4">
              {children}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
