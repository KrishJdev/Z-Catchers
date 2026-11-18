'use client';

import React, { useState, useMemo } from 'react';
import { Sun, BedDouble, Shield, RotateCcw, RefreshCw, Clock } from 'lucide-react';
import { DateTime } from 'luxon';
import { Member } from '@/lib/db';
import { computeMemberState } from '@/lib/sleepEngine';
import { FoxMascot } from '@/components/FoxMascot';

export interface PinnedSelfActionBarProps {
  currentUser: Member;
  isSleepShieldActive?: boolean;
  onCheckIn: (memberId: string) => Promise<boolean | void>;
  onWakeUp: (
    memberId: string,
    mode?: 'button' | 'manual',
    wokeUpTime?: string,
    cycleDate?: string
  ) => Promise<boolean | void>;
  onCancelPending: (memberId: string) => Promise<boolean | void>;
  onCancelInBed?: (memberId: string) => Promise<boolean | void | void>;
  isCheckingIn?: boolean;
  tick?: number;
}

/**
 * Pinned persistent self-action bar for one-tap sleep and wake check-ins.
 * Decouples self-service accountability actions from the scrolling member list.
 * Adheres to Warm Dark design tokens and enforces 44x44px mobile touch targets.
 * Features a mobile single-column vertical stack and desktop wide layout.
 */
export function PinnedSelfActionBar({
  currentUser,
  isSleepShieldActive = false,
  onCheckIn,
  onWakeUp,
  onCancelPending,
  onCancelInBed,
  isCheckingIn = false,
  tick,
}: PinnedSelfActionBarProps) {
  // Transient optimistic UI override while an action is in-flight
  const [optimisticInBed, setOptimisticInBed] = useState<boolean | null>(null);
  const [isCancellingPending, setIsCancellingPending] = useState<boolean>(false);
  const [isCancellingInBed, setIsCancellingInBed] = useState<boolean>(false);

  // Authoritative state computation via sleepEngine
  const userState = useMemo(() => {
    return computeMemberState(
      currentUser,
      currentUser.timezone,
      DateTime.utc(),
      optimisticInBed !== null ? optimisticInBed : undefined
    );
  }, [currentUser, optimisticInBed, tick]);

  const isInBed =
    optimisticInBed !== null
      ? optimisticInBed
      : (userState.bucket === 'SLEEPING' || Boolean((currentUser.is_in_bed || isSleepShieldActive) && !currentUser.is_woke_up));

  const isWindingDown = !isInBed && userState.bucket === 'WINDING_DOWN';
  const isOverdue = !isInBed && (userState.bucket === 'BEDTIME_NOW' || userState.isOverdue || userState.status === 'OVERDUE_NAG_NOW' || userState.status === 'BEDTIME_GRACE');
  const isAwake = !isInBed && !isWindingDown && !isOverdue;
  const isEarlyCheckInAllowed = isAwake && userState.diffMinutes >= -180 && userState.diffMinutes < -60;

  // Check if a 48h schedule change cooldown is active (reads authoritative props)
  const hasPendingCooldown = useMemo(() => {
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
  }, [currentUser.pending_effective_at, currentUser.pending_bedtime_local, tick]);

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
    setOptimisticInBed(true);

    try {
      const res = await onCheckIn(currentUser.id);
      if (res === false) {
        // Explicitly reported failure
      }
    } finally {
      // Clear optimistic override once settled so authoritative props govern state
      setOptimisticInBed(null);
    }
  };

  // Primary Wake-Up ("I'm Awake") handler
  const handleWakeUpClick = async () => {
    triggerHaptic(20);
    setOptimisticInBed(false);

    try {
      const res = await onWakeUp(currentUser.id, 'button');
      if (res === false) {
        // Explicitly reported failure
      }
    } finally {
      // Clear optimistic override once settled so authoritative props govern state
      setOptimisticInBed(null);
    }
  };

  // Cancel in-bed / undo check-in handler
  const handleCancelInBedClick = async () => {
    triggerHaptic(15);
    setIsCancellingInBed(true);
    setOptimisticInBed(false);

    try {
      if (onCancelInBed) {
        await onCancelInBed(currentUser.id);
      } else {
        await onCancelPending(currentUser.id);
      }
    } finally {
      setIsCancellingInBed(false);
      setOptimisticInBed(null);
    }
  };

  // Cancel Pending Cooldown handler
  const handleCancelPendingClick = async () => {
    triggerHaptic(15);
    setIsCancellingPending(true);

    try {
      const res = await onCancelPending(currentUser.id);
      if (res === false) {
        // Explicitly reported failure: authoritative props retain pending state
      }
    } finally {
      // Cancellation suppression applies only while active request is in progress
      setIsCancellingPending(false);
    }
  };

  return (
    <div
      role="region"
      aria-label="Quick Check-In Bar"
      className="fixed bottom-16 md:bottom-0 left-0 right-0 z-30 border-t border-amber-900/20 bg-night-surface/95 backdrop-blur-md px-3 sm:px-6 py-2.5 shadow-2xl transition-all"
    >
      {/* Mobile single-column vertical stack, desktop wide flex layout */}
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 sm:gap-4">
        {/* Identity & Status: Top row on mobile, left on desktop */}
        <div className="flex items-center justify-between sm:justify-start gap-2.5 min-w-0 flex-1">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="relative shrink-0 flex items-center justify-center">
              {currentUser.avatar_url ? (
                <img
                  src={currentUser.avatar_url}
                  alt={currentUser.discord_username}
                  className="w-8 h-8 sm:w-9 sm:h-9 rounded-full object-cover border border-night-border bg-night-elevated"
                  onError={(e) => {
                    (e.currentTarget as HTMLElement).style.display = 'none';
                  }}
                />
              ) : (
                <FoxMascot state={isInBed ? 'sleeping' : 'lantern'} size={32} />
              )}
              <span
                className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 sm:h-3 sm:w-3 rounded-full border-2 border-night-surface ${
                  isInBed ? 'bg-status-amber' : 'bg-status-sage'
                }`}
                title={isInBed ? (isSleepShieldActive || userState.isSleepShieldActive ? 'Sleep Shield Active' : 'In Bed • Past Wake Time') : 'Awake'}
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
                    <span className="truncate">
                      {isSleepShieldActive || userState.isSleepShieldActive ? 'Sleep Shield Active • Nags Muted' : 'In Bed • Past Wake Time'}
                    </span>
                  </span>
                ) : isWindingDown ? (
                  <span className="text-status-amber font-medium truncate">
                    Winding Down • Bedtime: <span className="font-mono text-cream-primary">{userState.activeBedtimeLocal || currentUser.bedtime_local}</span>
                  </span>
                ) : isOverdue ? (
                  <span className="text-status-coral font-medium truncate">
                    Past Bedtime • Bedtime was <span className="font-mono">{userState.activeBedtimeLocal || currentUser.bedtime_local}</span>
                  </span>
                ) : (
                  <span className="text-cream-secondary truncate">
                    Awake • Bedtime: <span className="font-mono text-cream-primary">{userState.activeBedtimeLocal || currentUser.bedtime_local}</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Mobile status indicator pill when pending change is active */}
          {hasPendingCooldown && (
            <span className="sm:hidden text-[10px] font-medium text-cream-muted bg-night-elevated px-2 py-0.5 rounded-full border border-night-border truncate">
              Cooldown
            </span>
          )}
        </div>

        {/* Action Controls: Bottom row on mobile (full-width), right row on desktop */}
        <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
          {/* Secondary Action: Cancel Pending Schedule Cooldown */}
          {hasPendingCooldown && (
            <button
              type="button"
              onClick={handleCancelPendingClick}
              disabled={isCheckingIn || isCancellingPending}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl border border-night-border bg-night-elevated text-xs font-semibold text-cream-secondary hover:text-cream-primary hover:border-status-coral/40 active:scale-95 transition-all shadow-sm"
              title="Cancel 48-hour schedule cooldown and revert pending change"
              aria-label="Cancel pending schedule change"
            >
              {isCancellingPending ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin text-status-coral" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5 text-status-coral" />
              )}
              <span className="truncate">Cancel Pending</span>
            </button>
          )}

          {/* Context-Aware Primary Controls */}
          {isInBed ? (
            /* Sleeping: Primary "I'm Awake" + Secondary "Undo / Cancel" */
            <>
              <button
                type="button"
                onClick={handleCancelInBedClick}
                disabled={isCheckingIn || isCancellingInBed}
                className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl border border-night-border bg-night-elevated text-xs font-semibold text-cream-secondary hover:text-cream-primary hover:border-status-amber/40 active:scale-95 transition-all shadow-sm"
                title="Undo in-bed check-in and restore active status"
                aria-label="Cancel in-bed check-in"
              >
                {isCancellingInBed ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin text-status-amber" />
                ) : (
                  <RotateCcw className="h-3.5 w-3.5 text-status-amber" />
                )}
                <span className="truncate">Undo / Cancel</span>
              </button>
              <button
                type="button"
                onClick={handleWakeUpClick}
                disabled={isCheckingIn}
                className="flex-1 sm:flex-initial flex items-center justify-center gap-2 min-h-[44px] min-w-[44px] px-4 py-2 rounded-xl border border-status-amber bg-status-amber text-night-bg text-xs sm:text-sm font-bold shadow-md hover:bg-status-amber/90 active:scale-95 transition-all whitespace-nowrap"
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
            </>
          ) : isWindingDown || isOverdue || isEarlyCheckInAllowed ? (
            /* Winding down, overdue, or allowed early window: Primary "I'm in Bed" CTA */
            <button
              type="button"
              onClick={handleCheckInClick}
              disabled={isCheckingIn}
              className={`flex-1 sm:flex-initial flex items-center justify-center gap-2 min-h-[44px] min-w-[44px] px-4 py-2 rounded-xl text-night-bg text-xs sm:text-sm font-bold shadow-md active:scale-95 transition-all whitespace-nowrap ${
                isOverdue
                  ? 'border border-status-coral/50 bg-status-coral hover:bg-status-coral/90'
                  : 'border border-status-amber/50 bg-status-amber hover:bg-status-amber/90'
              }`}
              title={isOverdue ? 'Late check-in into bed' : 'Check into bed and activate Sleep Shield'}
              aria-label="I'm in Bed check-in"
            >
              {isCheckingIn ? (
                <RefreshCw className="h-4 w-4 animate-spin text-night-bg" />
              ) : (
                <BedDouble className="h-4 w-4" />
              )}
              <span>
                {isOverdue
                  ? "🛏️ I'm in Bed (Late)"
                  : isEarlyCheckInAllowed
                  ? "🛏️ Early Check-In"
                  : "🛏️ I'm in Bed"}
              </span>
            </button>
          ) : (
            /* Awake outside wind-down/sleep window: Schedule / status info display */
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-night-border/70 bg-night-elevated text-xs font-medium text-cream-secondary min-h-[44px]">
                <Clock className="h-3.5 w-3.5 text-status-amber" />
                <span className="truncate">Bedtime at {userState.activeBedtimeLocal || currentUser.bedtime_local}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
