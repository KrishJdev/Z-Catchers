'use client';

import React, { useState, useMemo } from 'react';
import {
  getTimezoneGroups,
  filterTimezoneGroups,
  formatGmtOffset,
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
}: TimezoneSelectProps) {
  const [search, setSearch] = useState('');

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

  return (
    <div className={`space-y-1.5 ${className}`}>
      {showSearch && (
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
            disabled={disabled}
            className="w-full rounded-lg border border-night-border bg-night-bg/70 px-2.5 py-1.5 text-xs text-cream-primary placeholder-cream-muted focus:border-status-amber focus:outline-none pr-7 transition-colors"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-cream-muted hover:text-cream-primary transition-colors px-1"
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
