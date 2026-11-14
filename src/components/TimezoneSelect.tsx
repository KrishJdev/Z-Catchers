'use client';

import React, { useState, useMemo } from 'react';
import {
  getTimezoneGroups,
  filterTimezoneGroups,
  formatGmtOffset,
  formatTimezoneDisplay,
} from '@/lib/timezone';

export interface TimezoneSelectProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  selectClassName?: string;
  id?: string;
  name?: string;
  disabled?: boolean;
  showSearch?: boolean;
  searchPlaceholder?: string;
  ariaLabel?: string;
  compact?: boolean;
  onOverrideToggle?: (isOverriding: boolean) => void;
}

export function TimezoneSelect({
  value,
  onChange,
  className = '',
  selectClassName = '',
  id,
  name,
  disabled = false,
  showSearch = true,
  searchPlaceholder = 'Filter by city, country or ±GMT (e.g. Karachi, London, +5:30)...',
  ariaLabel = 'Timezone',
  compact = false,
  onOverrideToggle,
}: TimezoneSelectProps) {
  const [search, setSearch] = useState('');
  const [isOverriding, setIsOverriding] = useState(false);

  // Base timezone groups (Popular, GMT Offsets, Americas, Europe, Asia, Africa, Oceania, Other)
  const baseGroups = useMemo(() => getTimezoneGroups(), []);

  // Filtered groups based on search query
  const filteredGroups = useMemo(
    () => filterTimezoneGroups(baseGroups, search),
    [baseGroups, search]
  );

  // Check if current value exists anywhere in the filtered groups
  const isValueInFiltered = useMemo(() => {
    if (!value) return false;
    for (const group of filteredGroups) {
      for (const opt of group.options) {
        if (opt.value === value) return true;
      }
    }
    return false;
  }, [filteredGroups, value]);

  // If value is not in filtered groups (or is a custom/legacy timezone), preserve it so it's never dropped or changed
  const fallbackOption = useMemo(() => {
    if (!value) return null;
    if (isValueInFiltered) return null;
    const label = value.startsWith('GMT')
      ? value
      : `${value} (${formatGmtOffset(value)})${search ? ' [Current Selection]' : ''}`;
    return { value, label };
  }, [value, isValueInFiltered, search]);

  const defaultSelectStyles =
    'w-full rounded-xl border border-night-border bg-night-elevated px-3 py-2 text-cream-primary text-sm focus:border-status-amber focus:outline-none';

  // In compact mode, show compact pill by default until user clicks "Change"
  if (compact && !isOverriding) {
    return (
      <div className={`space-y-1.5 ${className}`}>
        <div
          data-testid="timezone-compact-pill"
          className="flex items-center justify-between gap-3 rounded-xl border border-night-border bg-night-elevated px-3 py-2"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm shrink-0" aria-hidden="true">
              📍
            </span>
            <span className="text-xs font-medium text-cream-primary truncate">
              {formatTimezoneDisplay(value)}
            </span>
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setIsOverriding(true);
              onOverrideToggle?.(true);
            }}
            className="shrink-0 min-h-[44px] px-3 py-2 text-xs font-semibold text-status-amber hover:text-status-amber/80 underline decoration-status-amber/40 underline-offset-2 hover:bg-status-amber/10 rounded-lg transition-colors flex items-center justify-center disabled:opacity-50 disabled:pointer-events-none"
            aria-label="Change timezone"
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-1.5 ${className}`} data-testid={compact ? 'timezone-override-picker' : undefined}>
      {compact && (
        <div className="flex items-center justify-between px-0.5">
          <span className="text-[11px] text-cream-muted">Manual Timezone Override</span>
          <button
            type="button"
            onClick={() => {
              setIsOverriding(false);
              onOverrideToggle?.(false);
            }}
            className="text-[11px] text-status-amber hover:underline hover:text-status-amber/90 transition-colors min-h-[32px] px-2 flex items-center"
            aria-label="Keep current timezone"
          >
            Done
          </button>
        </div>
      )}

      {showSearch && (
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
            disabled={disabled}
            className="w-full rounded-lg border border-night-border bg-night-bg/70 px-2.5 py-1.5 text-xs text-cream-primary placeholder-cream-muted focus:border-status-amber focus:outline-none pr-11 transition-colors"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-0 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] w-11 h-11 flex items-center justify-center text-xs text-cream-muted hover:text-cream-primary transition-colors"
              aria-label="Clear timezone filter"
            >
              ✕
            </button>
          )}
        </div>
      )}

      <select
        id={id}
        name={name}
        aria-label={ariaLabel}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={selectClassName || defaultSelectStyles}
      >
        {fallbackOption && (
          <option key={`fallback-${fallbackOption.value}`} value={fallbackOption.value}>
            {fallbackOption.label}
          </option>
        )}

        {filteredGroups.length === 0 ? (
          <option value="" disabled>
            No timezones match &quot;{search}&quot;
          </option>
        ) : (
          filteredGroups.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.options.map((tz) => (
                <option key={`${group.label}-${tz.value}`} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </optgroup>
          ))
        )}
      </select>
    </div>
  );
}
