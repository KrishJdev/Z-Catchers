'use client';

import React, { useState, useMemo } from 'react';
import { Sun, BedDouble, Shield, RotateCcw, RefreshCw } from 'lucide-react';
import { DateTime } from 'luxon';
import { Member } from '@/lib/db';
import { FoxMascot } from '@/components/FoxMascot';

export interface PinnedSelfActionBarProps {
  currentUser: Member;
  isSleepShieldActive?: boolean;
  onCheckIn: (memberId: string) => Promise<void>;
  onWakeUp: (
    memberId: string,
    mode?: 'button' | 'manual',
    wokeUpTime?: string,
    cycleDate?: string
  ) => Promise<boolean | void>;
  onCancelPending: (memberId: string) => Promise<void>;
  isCheckingIn?: boolean;
}

/**
 * Pinned persistent self-action bar for one-tap sleep and wake check-ins.
 * Decouples self-service accountability actions from the scrolling member list.
 * Adheres to Warm Dark design tokens and enforces 44x44px mobile touch targets.
 */
export function PinnedSelfActionBar({
  currentUser,
  isSleepShieldActive = false,
  onCheckIn,
  onWakeUp,
  onCancelPending,
  isCheckingIn = false,
}: PinnedSelfActionBarProps) {
  // Optimistic UI overrides for instant feedback
  const [optimisticInBed, setOptimisticInBed] = useState<boolean | null>(null);
  const [optimisticPendingCancelled, setOptimisticPendingCancelled] = useState(false);
  const [isCancellingPending, setIsCancellingPending] = useState(false);

  // Sync optimistic state if server props change
  const isInBed =
    optimisticInBed !== null
      ? optimisticInBed
      : Boolean(currentUser.is_in_bed || isSleepShieldActive);

  // Check if a 48h schedule change cooldown is active
  const hasPendingCooldown = useMemo(() => {
    if (optimisticPendingCancelled) return false;
    if (!currentUser.pending_effective_at && !currentUser.pending_bedtime_local) return false;

    if (currentUser.pending_effective_at) {
      try {
        const effectiveAt = DateTime.fromISO(currentUser.pending_effective_at, { zone: 'utc' });
        return DateTime.utc() < effectiveAt;
      } catch {
        return true;
      }
    }
    return Boolean(currentUser.pending_bedtime_local);
  }, [
    currentUser.pending_effective_at,
    currentUser.pending_bedtime_local,
    optimisticPendingCancelled,
  ]);

  // Haptic feedback helper
  const triggerHaptic = (duration = 15) => {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(duration);
      } catch {
        // Ignore vibration errors on unsupported platforms
      }
    }
  };

  // Primary Check-In ("I'm in Bed") handler
  const handleCheckInClick = async () => {
    triggerHaptic(20);
    const prevInBed = optimisticInBed;
    setOptimisticInBed(true);

    try {
      await onCheckIn(currentUser.id);
    } catch {
      setOptimisticInBed(prevInBed);
    }
  };

  // Primary Wake-Up ("I'm Awake") handler
  const handleWakeUpClick = async () => {
    triggerHaptic(20);
    const prevInBed = optimisticInBed;
    setOptimisticInBed(false);

    try {
      const res = await onWakeUp(currentUser.id, 'button');
      if (res === false) {
        setOptimisticInBed(prevInBed);
      }
    } catch {
      setOptimisticInBed(prevInBed);
    }
  };

  // Cancel Pending Cooldown handler
  const handleCancelPendingClick = async () => {
    triggerHaptic(15);
    setIsCancellingPending(true);
    setOptimisticPendingCancelled(true);

    try {
      await onCancelPending(currentUser.id);
    } catch {
      setOptimisticPendingCancelled(false);
    } finally {
      setIsCancellingPending(false);
    }
  };

  return (
    <div
      role="region"
      aria-label="Quick Check-In Bar"
      className="fixed bottom-16 md:bottom-0 left-0 right-0 z-30 border-t border-amber-900/20 bg-night-surface/95 backdrop-blur-md px-3 sm:px-6 py-2.5 shadow-2xl transition-all"
    >
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
        {/* Left: User Identity & Active State */}
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className="relative shrink-0 flex items-center justify-center">
            {currentUser.avatar_url ? (
              <img
                src={currentUser.avatar_url}
                alt={currentUser.discord_username}
                className="w-9 h-9 rounded-full object-cover border border-night-border bg-night-elevated"
                onError={(e) => {
                  (e.currentTarget as HTMLElement).style.display = 'none';
                }}
              />
            ) : (
              <FoxMascot state={isInBed ? 'sleeping' : 'lantern'} size={32} />
            )}
            <span
              className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-night-surface ${
                isInBed ? 'bg-status-amber' : 'bg-status-sage'
              }`}
              title={isInBed ? 'Sleep Shield Active' : 'Awake'}
            />
          </div>

          <div className="flex flex-col min-w-0">
            <span className="text-xs font-semibold text-cream-primary truncate leading-tight">
              {currentUser.discord_username}
            </span>
            <div className="flex items-center gap-1.5 text-[11px] truncate">
              {isInBed ? (
                <span className="flex items-center gap-1 font-medium text-status-amber truncate">
                  <Shield className="h-3 w-3 shrink-0 fill-status-amber/20" />
                  <span className="truncate">Sleep Shield Active • Nags Muted</span>
                </span>
              ) : (
                <span className="text-cream-secondary truncate">
                  Awake • Bedtime: <span className="font-mono text-cream-primary">{currentUser.bedtime_local}</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Right: Action Buttons (Touch target >= 44x44px) */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Secondary Action: Cancel Pending Schedule Cooldown */}
          {hasPendingCooldown && (
            <button
              type="button"
              onClick={handleCancelPendingClick}
              disabled={isCheckingIn || isCancellingPending}
              className="flex items-center justify-center gap-1.5 min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl border border-night-border bg-night-elevated text-xs font-semibold text-cream-secondary hover:text-cream-primary hover:border-status-coral/40 active:scale-95 transition-all shadow-sm"
              title="Cancel 48-hour schedule cooldown and revert pending change"
              aria-label="Cancel pending schedule change"
            >
              {isCancellingPending ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin text-status-coral" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5 text-status-coral" />
              )}
              <span className="hidden sm:inline">Cancel Pending</span>
              <span className="sm:hidden">Cancel</span>
            </button>
          )}

          {/* Primary Action: Context-Aware Check-In */}
          {isInBed ? (
            <button
              type="button"
              onClick={handleWakeUpClick}
              disabled={isCheckingIn}
              className="flex items-center justify-center gap-2 min-h-[44px] min-w-[44px] px-4 py-2 rounded-xl border border-status-amber bg-status-amber text-night-bg text-xs sm:text-sm font-bold shadow-md hover:bg-status-amber/90 active:scale-95 transition-all whitespace-nowrap"
              title="Log wake-up right now"
              aria-label="I'm Awake check-in"
            >
              {isCheckingIn ? (
                <RefreshCw className="h-4 w-4 animate-spin text-night-bg" />
              ) : (
                <Sun className="h-4 w-4 fill-night-bg stroke-night-bg" />
              )}
              <span>☀️ I&apos;m Awake</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleCheckInClick}
              disabled={isCheckingIn}
              className="flex items-center justify-center gap-2 min-h-[44px] min-w-[44px] px-4 py-2 rounded-xl border border-status-amber/50 bg-status-amber text-night-bg text-xs sm:text-sm font-bold shadow-md hover:bg-status-amber/90 active:scale-95 transition-all whitespace-nowrap"
              title="Check into bed and activate Sleep Shield"
              aria-label="I'm in Bed check-in"
            >
              {isCheckingIn ? (
                <RefreshCw className="h-4 w-4 animate-spin text-night-bg" />
              ) : (
                <BedDouble className="h-4 w-4" />
              )}
              <span>🛏️ I&apos;m in Bed</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
