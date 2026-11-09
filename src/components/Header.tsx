'use client';

import React from 'react';
import { Bell, Moon, BellOff } from 'lucide-react';

interface HeaderProps {
  viewerTimezone: string;
  isPushEnabled?: boolean;
  onTogglePush?: () => void;
}

export function Header({ viewerTimezone, isPushEnabled, onTogglePush }: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-night-border bg-night-bg/95 px-4 backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <Moon className="h-5 w-5 text-status-amber" />
        <span className="text-lg font-semibold tracking-tight text-cream-primary">
          Z Catchers
        </span>
      </div>

      <div className="flex items-center gap-2">
        {/* Detected viewer timezone pill */}
        <div className="rounded-full bg-night-elevated px-2.5 py-1 text-xs font-medium text-cream-secondary">
          <span className="text-cream-muted">Viewing: </span>
          <span className="text-cream-primary">{viewerTimezone.split('/').pop()?.replace('_', ' ') || viewerTimezone}</span>
        </div>

        {/* Push Notification indicator/button */}
        <button
          onClick={onTogglePush}
          title={isPushEnabled ? 'Push notifications active' : 'Turn on push alerts'}
          className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
            isPushEnabled
              ? 'bg-status-sage/15 text-status-sage'
              : 'bg-night-elevated text-cream-muted hover:text-cream-secondary'
          }`}
        >
          {isPushEnabled ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
        </button>
      </div>
    </header>
  );
}
