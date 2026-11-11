'use client';

import React, { useState, useEffect } from 'react';
import { Bell, BellOff, Clock, Shield, Moon, LogOut } from 'lucide-react';
import type { Member } from '@/lib/db';
import { FoxMascot } from '@/components/FoxMascot';
import { DateTime } from 'luxon';
import { toValidLuxonZone, formatGmtOffset } from '@/lib/timezone';

function DiscordIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.893.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

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
  onLogout?: () => void;
}

/**
 * Primary desktop and tablet navigation header.
 * Displays brand logo, live local clock, viewer timezone, push settings, schedule modal trigger, and session controls.
 *
 * @param props - Header configuration and callback properties
 * @returns React JSX header element
 */
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
  onLogout,
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

          {/* Member Profile / Log In / Log Out */}
          {currentUser ? (
            <div className="flex items-center gap-1.5 sm:gap-2">
              <button
                type="button"
                onClick={onOpenSchedule}
                title={`Logged in as @${currentUser.discord_username}. Tap to view your profile & schedule.`}
                className="flex items-center gap-2 rounded-xl border border-status-amber/40 bg-status-amber/10 px-2.5 sm:px-3 text-xs font-semibold text-status-amber hover:bg-status-amber/20 transition-all shrink-0 min-h-[44px]"
              >
                {currentUser.avatar_url ? (
                  <img
                    src={currentUser.avatar_url}
                    alt={currentUser.discord_username}
                    className="h-5 w-5 rounded-full object-cover border border-status-amber/40 shrink-0 bg-night-elevated"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <span className="h-2 w-2 rounded-full bg-status-sage shrink-0" />
                )}
                <span className="max-w-[70px] xs:max-w-[100px] truncate sm:max-w-[140px]">
                  @{currentUser.discord_username}
                </span>
              </button>

              {onLogout && (
                <button
                  type="button"
                  onClick={onLogout}
                  title={`Log out of @${currentUser.discord_username}`}
                  aria-label="Log out"
                  className="flex items-center gap-1.5 rounded-xl border border-night-border bg-night-surface px-2.5 py-2 text-xs font-medium text-cream-muted hover:border-status-coral/40 hover:bg-status-coral/10 hover:text-status-coral transition-all min-h-[44px] shrink-0"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline font-medium">Log Out</span>
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onOpenLogin?.('login')}
              title="Log in with your Discord account"
              className="flex items-center gap-1.5 rounded-xl border border-night-border bg-night-surface px-3 text-xs font-medium text-cream-secondary hover:bg-night-elevated hover:text-cream-primary transition-all min-h-[44px]"
            >
              <DiscordIcon className="h-3.5 w-3.5 text-status-amber" />
              <span>Log In</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
