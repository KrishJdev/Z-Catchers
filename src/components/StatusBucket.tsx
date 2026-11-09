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
        className="flex w-full min-h-[44px] items-center justify-between rounded-xl border border-night-border/70 bg-night-surface/80 px-4 py-2.5 text-left transition-colors hover:border-night-elevated hover:bg-night-surface"
      >
        <div className="flex items-center gap-2.5">
          {icon}
          <span className={`text-xs font-bold tracking-wider uppercase ${accentColor}`}>
            {title}
          </span>
          <span className="rounded-full bg-night-elevated px-2 py-0.5 text-xs font-semibold tabular-nums text-cream-secondary">
            {count}
          </span>
        </div>

        {isExpanded ? (
          <ChevronDown className="h-4 w-4 text-cream-muted" />
        ) : (
          <ChevronRight className="h-4 w-4 text-cream-muted" />
        )}
      </button>

      {isExpanded && (
        <div className="mt-3">
          {count === 0 ? (
            <div className="flex items-center justify-center gap-3 rounded-2xl border border-night-border/40 bg-night-surface/40 px-6 py-8 text-center text-cream-muted">
              <FoxMascot state="sleeping" size={44} />
              <div className="text-left">
                <p className="text-sm font-medium text-cream-secondary">{emptyMessage}</p>
                <p className="text-xs text-cream-muted">Quiet hours are in effect for this group.</p>
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
