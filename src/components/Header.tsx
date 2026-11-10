'use client';

import React, { useState, useEffect } from 'react';
import { Bell, BellOff, Clock, Shield, Moon, KeyRound } from 'lucide-react';
import type { Member } from '@/lib/db';
import { FoxMascot } from '@/components/FoxMascot';
import { DateTime } from 'luxon';
import { toValidLuxonZone, formatGmtOffset } from '@/lib/timezone';

interface HeaderProps {
  viewerTimezone: string;
  isPushEnabled?: boolean;
  onTogglePush?: () => void;
  isSleepShieldActive?: boolean;
  onToggleSleepShield?: () => void;
  onOpenSchedule?: () => void;
  onOpenMod?: () => void;
  currentUser?: Member | null;
  onOpenLogin?: (initialTab?: 'login' | 'register') => void;
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
        const zone = toValidLuxonZone(viewerTimezone);
        const formatted = DateTime.now().setZone(zone).toFormat('h:mm:ss a');
        setCurrentTimeStr(formatted);
      } catch {
        setCurrentTimeStr('');
      }
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [viewerTimezone]);

  const timezoneDisplayName = formatGmtOffset(viewerTimezone);

  return (
    <header className="sticky top-0 z-40 border-b border-night-border bg-night-bg/95 backdrop-blur-md pt-[env(safe-area-inset-top,0px)]">
      <div className="mx-auto flex items-center justify-between px-4 py-3 sm:px-6 lg:px-8 max-w-7xl">
        {/* Left side: Fox icon + "Z Catchers" with detected timezone as tiny muted subtitle directly underneath */}
        <div className="flex items-center gap-2.5 shrink-0">
          <FoxMascot state="logo" size={32} className="shrink-0 transition-transform hover:scale-105" />
          <div className="flex flex-col">
            <span className="whitespace-nowrap font-bold text-lg tracking-tight text-cream-primary">
              Z Catchers
            </span>
            <span className="text-xs text-[#A89F91] leading-tight">
              {timezoneDisplayName}
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

        {/* Right side: Compact profile pill on mobile; desktop command buttons on md:flex */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* Desktop Quick-Action Buttons */}
          <button
            type="button"
            onClick={onOpenSchedule}
            className="hidden items-center gap-1.5 rounded-xl border border-night-border bg-night-surface px-3 py-2 text-xs font-medium text-cream-secondary transition-colors hover:bg-night-elevated hover:text-cream-primary min-h-[44px] md:inline-flex"
          >
            <Clock className="h-3.5 w-3.5 text-status-amber" />
            <span>My Schedule</span>
          </button>

          <button
            type="button"
            onClick={onOpenMod}
            className="hidden items-center gap-1.5 rounded-xl border border-night-border bg-night-surface px-3 py-2 text-xs font-medium text-cream-secondary transition-colors hover:bg-night-elevated hover:text-cream-primary min-h-[44px] md:inline-flex"
          >
            <Shield className="h-3.5 w-3.5 text-cream-muted" />
            <span>Mod Panel</span>
          </button>

          {/* Push Notification Toggle (Desktop only; on mobile accessed via Alerts bottom tab) */}
          <button
            type="button"
            onClick={onTogglePush}
            title={isPushEnabled ? 'Push notifications active' : 'Turn on bedtime & nag alerts'}
            className={`hidden md:flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium transition-all min-h-[44px] ${
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
            <span>
              {isPushEnabled ? 'Alerts On' : 'Alerts Off'}
            </span>
          </button>

          {/* Member Profile / Log In */}
          {currentUser ? (
            <button
              type="button"
              onClick={onOpenSchedule}
              title={`Logged in as @${currentUser.discord_username}. Tap to view your schedule.`}
              className="flex items-center gap-2 rounded-xl border border-status-amber/40 bg-status-amber/10 px-2.5 sm:px-3 text-xs font-semibold text-status-amber hover:bg-status-amber/20 transition-all shrink-0 min-h-[44px]"
            >
              <span className="h-2 w-2 rounded-full bg-status-sage shrink-0" />
              <span className="max-w-[100px] truncate sm:max-w-[140px]">
                @{currentUser.discord_username}
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onOpenLogin?.('login')}
              title="Log in with your 4-digit PIN"
              className="hidden md:flex items-center gap-1.5 rounded-xl border border-night-border bg-night-surface px-3 text-xs font-medium text-cream-secondary hover:bg-night-elevated hover:text-cream-primary transition-all min-h-[44px]"
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
