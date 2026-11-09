'use client';

import React, { useState, useEffect } from 'react';
import { Bell, BellOff, Clock, Shield, Moon, KeyRound, UserCheck } from 'lucide-react';
import type { Member } from '@/lib/db';
import { FoxMascot } from '@/components/FoxMascot';

interface HeaderProps {
  viewerTimezone: string;
  isPushEnabled?: boolean;
  onTogglePush?: () => void;
  isSleepShieldActive?: boolean;
  onToggleSleepShield?: () => void;
  onOpenSchedule?: () => void;
  onOpenMod?: () => void;
  currentUser?: Member | null;
  onOpenLogin?: () => void;
}

export function Header({
  viewerTimezone,
  isPushEnabled,
  onTogglePush,
  isSleepShieldActive = false,
  onToggleSleepShield,
  onOpenSchedule,
  onOpenMod,
  currentUser,
  onOpenLogin,
}: HeaderProps) {
  const [currentTimeStr, setCurrentTimeStr] = useState<string>('');

  useEffect(() => {
    const updateTime = () => {
      try {
        const now = new Date();
        const formatted = new Intl.DateTimeFormat('en-US', {
          timeZone: viewerTimezone,
          hour: 'numeric',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        }).format(now);
        setCurrentTimeStr(formatted);
      } catch {
        setCurrentTimeStr('');
      }
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [viewerTimezone]);

  const timezoneDisplayName =
    viewerTimezone.split('/').pop()?.replace(/_/g, ' ') || viewerTimezone;

  return (
    <header className="sticky top-0 z-40 border-b border-night-border bg-night-bg/95 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Brand Logo & Wordmark with Sleepy Fox Mascot */}
        <div className="flex items-center gap-2.5">
          <FoxMascot state="logo" size={32} className="transition-transform hover:scale-105" />
          <div className="flex flex-col">
            <span className="text-lg font-bold tracking-tight text-cream-primary">
              Z Catchers
            </span>
            <span className="hidden text-[10px] font-medium text-cream-muted sm:inline-block">
              Bedtime Accountability Den
            </span>
          </div>
        </div>

        {/* Desktop Command Bar Center: Live Clock & Sleep Shield Toggle */}
        <div className="hidden items-center gap-3 md:flex">
          {/* Live Clock & Timezone Pill */}
          <div className="flex items-center gap-2 rounded-full border border-night-border bg-night-surface px-3 py-1.5 text-xs text-cream-secondary">
            <Clock className="h-3.5 w-3.5 text-status-amber" />
            <span className="font-semibold tabular-nums text-cream-primary">
              {currentTimeStr || '—'}
            </span>
            <span className="text-cream-muted">•</span>
            <span className="text-cream-secondary">{timezoneDisplayName}</span>
          </div>

          {/* Viewer's Personal Sleep Shield Status Toggle */}
          <button
            type="button"
            onClick={onToggleSleepShield}
            title="Toggle personal quiet hours (Sleep Shield suppresses incoming nag notifications)"
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
              isSleepShieldActive
                ? 'border-status-slumber/50 bg-status-slumber/20 text-cream-primary shadow-sm shadow-status-slumber/20'
                : 'border-night-border bg-night-surface text-cream-muted hover:border-night-elevated hover:text-cream-secondary'
            }`}
          >
            <Moon className={`h-3.5 w-3.5 ${isSleepShieldActive ? 'text-status-slumber' : 'text-cream-muted'}`} />
            <span>Shield:</span>
            <span className={`font-semibold ${isSleepShieldActive ? 'text-status-slumber' : 'text-cream-muted'}`}>
              {isSleepShieldActive ? 'Active (Quiet)' : 'Off'}
            </span>
          </button>
        </div>

        {/* Right Actions: Mobile Compact Controls & Desktop Command Buttons */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Mobile Timezone Pill (hidden on desktop) */}
          <div className="rounded-full bg-night-elevated px-2.5 py-1 text-xs font-medium text-cream-secondary md:hidden">
            <span className="text-cream-muted">Viewing: </span>
            <span className="text-cream-primary">{timezoneDisplayName}</span>
          </div>

          {/* Desktop Quick-Action Buttons */}
          <button
            type="button"
            onClick={onOpenSchedule}
            className="hidden items-center gap-1.5 rounded-xl border border-night-border bg-night-surface px-3 py-1.5 text-xs font-medium text-cream-secondary transition-colors hover:bg-night-elevated hover:text-cream-primary md:inline-flex"
          >
            <Clock className="h-3.5 w-3.5 text-status-amber" />
            <span>My Schedule</span>
          </button>

          <button
            type="button"
            onClick={onOpenMod}
            className="hidden items-center gap-1.5 rounded-xl border border-night-border bg-night-surface px-3 py-1.5 text-xs font-medium text-cream-secondary transition-colors hover:bg-night-elevated hover:text-cream-primary md:inline-flex"
          >
            <Shield className="h-3.5 w-3.5 text-cream-muted" />
            <span>Mod Panel</span>
          </button>

          {/* Push Notification Toggle (Visible everywhere) */}
          <button
            type="button"
            onClick={onTogglePush}
            title={isPushEnabled ? 'Push notifications active' : 'Turn on bedtime & nag alerts'}
            className={`flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium transition-all ${
              isPushEnabled
                ? 'border border-status-sage/40 bg-status-sage/15 text-status-sage'
                : 'border border-night-border bg-night-surface text-cream-muted hover:border-night-elevated hover:text-cream-secondary'
            }`}
          >
            {isPushEnabled ? (
              <Bell className="h-4 w-4 text-status-sage" />
            ) : (
              <BellOff className="h-4 w-4 text-cream-muted" />
            )}
            <span className="hidden sm:inline">
              {isPushEnabled ? 'Alerts On' : 'Alerts Off'}
            </span>
          </button>

          {/* Member Login / Account Button */}
          {currentUser ? (
            <button
              type="button"
              onClick={onOpenLogin}
              title={`Logged in as ${currentUser.discord_username}. Tap to view account or log out.`}
              className="flex h-9 items-center gap-1.5 rounded-xl border border-status-amber/40 bg-status-amber/10 px-2.5 sm:px-3 text-xs font-semibold text-status-amber hover:bg-status-amber/20 transition-all"
            >
              <span className="h-2 w-2 rounded-full bg-status-sage" />
              <span className="max-w-[100px] truncate sm:max-w-[140px]">
                @{currentUser.discord_username}
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onOpenLogin}
              title="Log in with your 4-digit PIN to link bedtime alerts"
              className="flex h-9 items-center gap-1.5 rounded-xl border border-night-border bg-night-surface px-2.5 sm:px-3 text-xs font-medium text-cream-secondary hover:bg-night-elevated hover:text-cream-primary transition-all"
            >
              <KeyRound className="h-3.5 w-3.5 text-status-amber" />
              <span>Log In</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
