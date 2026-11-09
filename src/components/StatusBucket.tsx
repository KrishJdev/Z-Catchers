'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface StatusBucketProps {
  title: string;
  count: number;
  icon?: React.ReactNode;
  defaultExpanded?: boolean;
  accentColor?: string;
  children: React.ReactNode;
}

export function StatusBucket({
  title,
  count,
  icon,
  defaultExpanded = true,
  accentColor = 'text-cream-primary',
  children,
}: StatusBucketProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  if (count === 0) return null;

  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full min-h-[44px] items-center justify-between rounded-xl bg-night-elevated/80 px-3 py-2 text-left transition-colors hover:bg-night-elevated"
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className={`text-xs font-bold tracking-wide uppercase ${accentColor}`}>
            {title}
          </span>
          <span className="rounded-full bg-night-surface px-2 py-0.5 text-xs font-semibold text-cream-secondary">
            {count}
          </span>
        </div>

        {isExpanded ? (
          <ChevronDown className="h-4 w-4 text-cream-muted" />
        ) : (
          <ChevronRight className="h-4 w-4 text-cream-muted" />
        )}
      </button>

      {isExpanded && <div className="mt-2.5 space-y-2.5">{children}</div>}
    </div>
  );
}
