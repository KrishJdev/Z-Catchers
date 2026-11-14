'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  ExternalLink,
  ShieldAlert,
  Sparkles,
  Moon,
  Sun,
  Star,
  CheckCircle2,
  Users,
  Zap,
  Shield,
  Flame,
  BedDouble,
  Clock,
  RefreshCw,
  Check,
  Bell,
  Calendar,
  ChevronDown,
  X,
} from 'lucide-react';
import type { Member } from '@/lib/db';
import { formatTime12h, type MemberState } from '@/lib/sleepEngine';
import { formatGmtOffset } from '@/lib/timezone';
import { FoxMascot } from './FoxMascot';

interface MemberCardProps {
  member: Member;
  state: MemberState;
  currentMemberId?: string | null;
  isStarred?: boolean;
  onToggleStar?: (memberId: string) => void;
  onCheckIn?: (memberId: string) => Promise<boolean | void> | void;
  onCancelInBed?: (memberId: string) => Promise<void>;
  isCheckingIn?: boolean;
  onVoteStrike?: (targetMemberId: string) => Promise<void>;
  onOpenMetastrike?: (member: Member, mode: 'proactive' | 'convert_retroactive') => void;
  isVotingStrike?: boolean;
  isModerator?: boolean;
  onOpenSleepCalendar?: (memberId: string) => void;
  onOpenProfile?: (memberId: string, initialTab?: 'calendar' | 'timetable') => void;
  onWakeUp?: (memberId: string, mode?: 'button' | 'manual', wokeUpTime?: string) => Promise<boolean | void>;
}

/**
 * Visual card displaying an individual community member's bedtime status.
 * Employs a compact primary card layout with progressive disclosure bottom sheet
 * to minimize vertical scrolling and declutter the dashboard.
 *
 * @param props - Component properties for member state and interaction handlers
 * @returns Rendered compact member card with progressive disclosure
 */
let activeScrollLocks = 0;
let originalBodyOverflow = '';

function acquireScrollLock() {
  if (typeof document === 'undefined') return;
  if (activeScrollLocks === 0) {
    originalBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  activeScrollLocks++;
}

function releaseScrollLock() {
  if (typeof document === 'undefined') return;
  activeScrollLocks = Math.max(0, activeScrollLocks - 1);
  if (activeScrollLocks === 0) {
    document.body.style.overflow = originalBodyOverflow;
  }
}

export function MemberCard({
  member,
  state,
  currentMemberId,
  isStarred = false,
  onToggleStar,
  onCheckIn,
  onCancelInBed,
  isCheckingIn = false,
  onVoteStrike,
  onOpenMetastrike,
  isVotingStrike = false,
  isModerator = false,
  onOpenSleepCalendar,
  onOpenProfile,
  onWakeUp,
}: MemberCardProps) {
  const { bucket, formattedViewerTime, formattedSleeperTime, pendingNotice, streakMilestone } = state;
  const isViewer = Boolean(currentMemberId && member.id === currentMemberId);

  // Progressive Disclosure Bottom Sheet state & focus management refs
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const sheetDialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Optimistic UI state for "I'm In Bed" check-in & "Wake Up" undo
  const [optimisticInBed, setOptimisticInBed] = useState<boolean | null>(null);
  const [optimisticWokeUp, setOptimisticWokeUp] = useState<boolean | null>(null);
  const [showManualWakeInput, setShowManualWakeInput] = useState(false);
  const [manualWakeTimeInput, setManualWakeTimeInput] = useState('07:30');

  const isWokeUp = optimisticWokeUp !== null ? optimisticWokeUp : Boolean(member.is_woke_up);
  const isInBed = optimisticInBed !== null
    ? optimisticInBed
    : (!isWokeUp && Boolean(member.is_in_bed || state.checkedInEarly));

  // Local Nag Assist State with optimistic increment & rollback
  const [localNagCount, setLocalNagCount] = useState<number>(member.nag_assists_count || 0);
  const [hasNagged, setHasNagged] = useState(false);

  // Open member profile & schedule timetable modal
  const handleProfileClick = () => {
    triggerHaptic(10);
    if (onOpenProfile) {
      onOpenProfile(member.id);
    } else if (onOpenSleepCalendar) {
      onOpenSleepCalendar(member.id);
    }
  };

  // Subtle alert message for rollbacks and action feedback
  const [cardError, setCardError] = useState<string | null>(null);
  const [cardFeedback, setCardFeedback] = useState<{ text: string; type: 'error' | 'shield' | 'success' } | null>(null);

  // Haptic feedback helper (15ms light pulse)
  const triggerHaptic = (duration = 15) => {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(duration);
      } catch {
        // Ignore vibration errors
      }
    }
  };

  // Focus management, focus containment (trap), and Escape handling for bottom sheet modal
  useEffect(() => {
    if (!isDetailsOpen) return;

    previousFocusRef.current = document.activeElement as HTMLElement | null;

    // Focus first interactive element inside sheet dialog (or sheet itself as fallback)
    const focusTimer = setTimeout(() => {
      const firstFocusable = sheetDialogRef.current?.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (firstFocusable) {
        firstFocusable.focus();
      } else {
        sheetDialogRef.current?.focus();
      }
    }, 50);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsDetailsOpen(false);
        return;
      }

      if (e.key === 'Tab') {
        if (!sheetDialogRef.current) return;
        const focusables = sheetDialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (!sheetDialogRef.current.contains(document.activeElement)) {
          e.preventDefault();
          first.focus();
          return;
        }

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [isDetailsOpen]);

  // Lock body scroll only when bottom sheet is open, preserving pre-lock overflow with shared lock count
  useEffect(() => {
    if (!isDetailsOpen) return;
    acquireScrollLock();
    return () => {
      releaseScrollLock();
    };
  }, [isDetailsOpen]);

  // Sync server values when member updates
  useEffect(() => {
    if (typeof member.nag_assists_count === 'number') {
      setLocalNagCount(member.nag_assists_count);
    }
    setOptimisticInBed(null);
    setOptimisticWokeUp(null);
  }, [member.nag_assists_count, member.is_in_bed, member.is_woke_up, state.checkedInEarly]);

  // Optimistic Nag Assist Action
  const handleNagJournalClick = async () => {
    triggerHaptic(15);
    if (!hasNagged) {
      setHasNagged(true);
      setLocalNagCount((prev) => prev + 1);
      setCardError(null);
      try {
        const res = await fetch('/api/members/nag-assist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sleeper_id: member.id }),
        });
        if (!res.ok) {
          // Rollback on server failure
          setHasNagged(false);
          setLocalNagCount((prev) => Math.max(0, prev - 1));
          setCardError('Could not record nag assist.');
          setTimeout(() => setCardError(null), 3000);
        }
      } catch {
        // Rollback on network failure
        setHasNagged(false);
        setLocalNagCount((prev) => Math.max(0, prev - 1));
        setCardError('Network error recording nag.');
        setTimeout(() => setCardError(null), 3000);
      }
    }
  };

  // Optimistic "I'm in Bed" check-in action
  const handleCheckInClick = async () => {
    triggerHaptic(15);
    if (!onCheckIn) return;
    setOptimisticInBed(true);
    setOptimisticWokeUp(false);
    setCardError(null);
    try {
      await onCheckIn(member.id);
    } catch {
      setOptimisticInBed(false);
      setOptimisticWokeUp(null);
      setCardError('Check-in failed. Reverting status.');
      setTimeout(() => setCardError(null), 3000);
    }
  };

  // Optimistic Cancel "I'm in Bed" / Wake Up action
  const handleCancelInBedClick = async () => {
    triggerHaptic(15);
    if (!onCancelInBed) return;
    setOptimisticInBed(false);
    setOptimisticWokeUp(true);
    setCardError(null);
    try {
      await onCancelInBed(member.id);
    } catch {
      setOptimisticInBed(true);
      setOptimisticWokeUp(false);
      setCardError('Failed to cancel check-in.');
      setTimeout(() => setCardError(null), 3000);
    }
  };

  // Safe fallback avatar with error resilience
  const fallbackAvatarUrl =
    `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(member.discord_username)}`;
  const [avatarSrc, setAvatarSrc] = useState<string>(member.avatar_url || fallbackAvatarUrl);

  useEffect(() => {
    setAvatarSrc(member.avatar_url || fallbackAvatarUrl);
  }, [member.avatar_url, fallbackAvatarUrl]);

  // Strikes & Metastrikes data (reconciled across aliases)
  const strikesUsed = Math.max(
    typeof member.strikes_used === 'number' ? member.strikes_used : 0,
    typeof member.strikes_count === 'number' ? member.strikes_count : 0
  );
  const metastrikesUsed = Math.max(
    typeof member.metastrikes_used === 'number' ? member.metastrikes_used : 0,
    typeof member.metastrikes_count === 'number' ? member.metastrikes_count : 0
  );
  const isMetastrikeActive = Boolean(
    member.is_metastrike_active || member.tonight_strike_log?.record_type === 'metastrike'
  );
  const isStrikeIssuedTonight = Boolean(member.tonight_strike_log?.record_type === 'strike');
  const isStrikeConvertible = Boolean(
    isStrikeIssuedTonight || member.convertible_strike_log
  );
  const strikeVotesCount =
    member.tonight_strike_log?.record_type === 'pending_vote'
      ? member.tonight_strike_log.voter_ids?.length || 0
      : isStrikeIssuedTonight
      ? 2
      : 0;

  const isNagNow = bucket === 'BEDTIME_NOW' || bucket === 'BEDTIME_GRACE' || bucket === 'OVERDUE_NAG_NOW';

  // Real-time bedtime nag notification eligibility:
  // 1. Viewer cannot nag themselves (!isViewer)
  // 2. Target member is within 30m before bedtime (-30 <= diffMinutes < 0) OR past bedtime (0 <= diffMinutes <= 480)
  const isEligibleForNagNotif = !isViewer && state.diffMinutes >= -30 && state.diffMinutes <= 480;

  // Secondary contextual status/action exists alongside the Nag Notif button
  const hasSecondaryNagAction = Boolean(
    isMetastrikeActive ||
    isStrikeIssuedTonight ||
    state.status === 'BEDTIME_GRACE' ||
    (onVoteStrike && !isViewer)
  );

  // Sleep Shield protection state:
  // True if member is checked in early (Safe Button), in the 8-hour sleep window, or has an active Metastrike excuse pass.
  const isTargetShieldOn = Boolean(
    isInBed ||
    state.isSleepShieldActive ||
    bucket === 'SLEEPING' ||
    isMetastrikeActive
  );

  // Check if there is an active left action button in the sleeping state (Strike vote, Wake up nag, or Shield On)
  const hasSleepingActionButton = Boolean(
    (!isInBed && !isMetastrikeActive && !isViewer && onVoteStrike) ||
    state.isPastWakeTime ||
    (isTargetShieldOn && !isViewer)
  );

  // Nag Notif dispatch states
  const [isSendingNagNotif, setIsSendingNagNotif] = useState(false);
  const [nagNotifSent, setNagNotifSent] = useState(false);
  const [isSendingWakeNag, setIsSendingWakeNag] = useState(false);
  const [wakeNagSent, setWakeNagSent] = useState(false);
  const [bedtimeCooldownSeconds, setBedtimeCooldownSeconds] = useState<number>(0);
  const [wakeCooldownSeconds, setWakeCooldownSeconds] = useState<number>(0);
  const inMemoryExpiriesRef = useRef<{ bedtime: number; wake: number }>({ bedtime: 0, wake: 0 });

  const senderId = currentMemberId ? `sender_${currentMemberId}` : 'anon';
  const bedtimeStorageKey = `nag_cooldown_${senderId}_bedtime_${member.id}`;
  const wakeStorageKey = `nag_cooldown_${senderId}_wake_${member.id}`;
  const nagCooldownSeconds = bedtimeCooldownSeconds;

  // Sync and tick down 15-minute nag cooldown from localStorage (with in-memory fallback)
  useEffect(() => {
    const checkCooldown = () => {
      // 1. Bedtime reminder cooldown
      let bedDiffMs = inMemoryExpiriesRef.current.bedtime - Date.now();
      try {
        const stored = localStorage.getItem(bedtimeStorageKey);
        if (stored) {
          const storedDiff = Number(stored) - Date.now();
          bedDiffMs = Math.max(bedDiffMs, storedDiff);
          if (storedDiff <= 0) {
            localStorage.removeItem(bedtimeStorageKey);
          }
        }
      } catch {
        // in-memory expiry already applied
      }
      setBedtimeCooldownSeconds(bedDiffMs > 0 ? Math.ceil(bedDiffMs / 1000) : 0);

      // 2. Wake-up reminder cooldown
      let wakeDiffMs = inMemoryExpiriesRef.current.wake - Date.now();
      try {
        const stored = localStorage.getItem(wakeStorageKey);
        if (stored) {
          const storedDiff = Number(stored) - Date.now();
          wakeDiffMs = Math.max(wakeDiffMs, storedDiff);
          if (storedDiff <= 0) {
            localStorage.removeItem(wakeStorageKey);
          }
        }
      } catch {
        // in-memory expiry already applied
      }
      setWakeCooldownSeconds(wakeDiffMs > 0 ? Math.ceil(wakeDiffMs / 1000) : 0);
    };

    checkCooldown();
    const interval = setInterval(checkCooldown, 1000);
    return () => clearInterval(interval);
  }, [bedtimeStorageKey, wakeStorageKey]);

  const startNagCooldown = (seconds = 15 * 60, type: 'bedtime' | 'wake' = 'bedtime') => {
    const expiry = Date.now() + seconds * 1000;
    inMemoryExpiriesRef.current[type] = expiry;
    const key = type === 'bedtime' ? bedtimeStorageKey : wakeStorageKey;
    try {
      localStorage.setItem(key, String(expiry));
    } catch {
      // In-memory fallback
    }
    if (type === 'bedtime') {
      setBedtimeCooldownSeconds(seconds);
    } else {
      setWakeCooldownSeconds(seconds);
    }
  };

  const formatNagCooldown = (totalSecs: number) => {
    const mm = Math.floor(totalSecs / 60);
    const ss = totalSecs % 60;
    return `${mm}:${ss < 10 ? '0' : ''}${ss}`;
  };

  // Handle Wake-Up Nag Notification Click
  const handleSendWakeUpNagNotif = async () => {
    triggerHaptic(15);
    setIsSendingWakeNag(true);
    setCardFeedback(null);

    try {
      const res = await fetch('/api/members/nag-notif', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_member_id: member.id,
          type: 'wake_up',
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (data.shieldActive) {
        setCardFeedback({
          type: 'shield',
          text: data.message || `🛡️ Sleep Shield is active for ${member.discord_username}.`,
        });
        setTimeout(() => setCardFeedback(null), 4000);
      } else if (res.ok && data.success) {
        setWakeNagSent(true);
        startNagCooldown(data.cooldownSeconds || 15 * 60, 'wake');
        if (typeof data.totalAssists === 'number') {
          setLocalNagCount(data.totalAssists);
        } else {
          setLocalNagCount((prev) => prev + 1);
        }
        setCardFeedback({
          type: 'success',
          text: data.message || `☀️ Wake-up reminder sent to ${member.discord_username}!`,
        });
        setTimeout(() => setCardFeedback(null), 4000);
      } else if (data.rateLimited) {
        setWakeNagSent(true);
        startNagCooldown(data.cooldownSeconds || 15 * 60, 'wake');
        setCardFeedback({
          type: 'success',
          text: data.message || `You can send another reminder to ${member.discord_username} in ${Math.ceil((data.cooldownSeconds || 900) / 60)}m.`,
        });
        setTimeout(() => setCardFeedback(null), 4000);
      } else {
        setCardFeedback({
          type: 'error',
          text: data.error || data.message || 'Could not send wake-up reminder.',
        });
        setTimeout(() => setCardFeedback(null), 4000);
      }
    } catch {
      setCardFeedback({
        type: 'error',
        text: 'Network error sending wake-up reminder.',
      });
      setTimeout(() => setCardFeedback(null), 4000);
    } finally {
      setIsSendingWakeNag(false);
    }
  };

  // Handle Nag Notification Click
  const handleSendNagNotif = async () => {
    triggerHaptic(15);
    if (isTargetShieldOn) {
      setCardFeedback({
        type: 'shield',
        text: `🛡️ ${member.discord_username} has turned on their Sleep Shield. Nag notifications are muted.`,
      });
      setTimeout(() => setCardFeedback(null), 4000);
      return;
    }

    setIsSendingNagNotif(true);
    setCardFeedback(null);

    try {
      const res = await fetch('/api/members/nag-notif', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_member_id: member.id }),
      });

      const data = await res.json().catch(() => ({}));

      if (data.shieldActive) {
        setCardFeedback({
          type: 'shield',
          text: `🛡️ ${member.discord_username} has turned on their Sleep Shield. Nag notifications are muted.`,
        });
        setTimeout(() => setCardFeedback(null), 4000);
      } else if (res.ok && data.success) {
        setNagNotifSent(true);
        startNagCooldown(data.cooldownSeconds || 15 * 60, 'bedtime');
        if (typeof data.totalAssists === 'number') {
          setLocalNagCount(data.totalAssists);
        } else {
          setLocalNagCount((prev) => prev + 1);
        }
        setCardFeedback({
          type: 'success',
          text: data.message || `Bedtime reminder sent to ${member.discord_username}!`,
        });
        setTimeout(() => setCardFeedback(null), 4000);
      } else if (data.rateLimited) {
        startNagCooldown(data.cooldownSeconds || 15 * 60, 'bedtime');
        setCardFeedback({
          type: 'error',
          text: data.message || `You can send another reminder to ${member.discord_username} in ${Math.ceil((data.cooldownSeconds || 900) / 60)}m.`,
        });
        setTimeout(() => setCardFeedback(null), 4000);
      } else {
        setCardFeedback({
          type: 'error',
          text: data.error || data.message || 'Could not send bedtime reminder.',
        });
        setTimeout(() => setCardFeedback(null), 4000);
      }
    } catch {
      setCardFeedback({
        type: 'error',
        text: 'Network error sending bedtime reminder.',
      });
      setTimeout(() => setCardFeedback(null), 4000);
    } finally {
      setIsSendingNagNotif(false);
    }
  };

  // Single-line, non-wrapping status pill configuration
  const getStatusPillConfig = () => {
    if (isNagNow) {
      const isGrace = state.status === 'BEDTIME_GRACE' || bucket === 'BEDTIME_GRACE';
      const label = isGrace
        ? `${state.graceMinutesLeft || 5}m grace`
        : `${Math.max(1, Math.floor(state.diffMinutes))}m overdue`;
      return {
        className: 'bg-status-coral/15 text-status-coral',
        icon: isGrace ? (
          <Clock className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <ShieldAlert className="h-3.5 w-3.5 shrink-0 animate-pulse" />
        ),
        label,
      };
    }
    if (bucket === 'WINDING_DOWN') {
      const minsLeft = Math.abs(Math.floor(state.diffMinutes));
      return {
        className: 'bg-status-amber/15 text-status-amber',
        icon: <Sparkles className="h-3.5 w-3.5 shrink-0" />,
        label: `in ${minsLeft}m`,
      };
    }
    if (bucket === 'SLEEPING') {
      return {
        className: 'bg-night-elevated text-cream-muted',
        icon: <Moon className="h-3.5 w-3.5 shrink-0 text-cream-muted" />,
        label: isInBed ? 'In Bed' : 'Sleeping',
      };
    }
    // AWAKE
    if (isWokeUp) {
      return {
        className: 'bg-status-amber/15 text-status-amber border border-status-amber/30',
        icon: <Sun className="h-3.5 w-3.5 shrink-0 text-status-amber" />,
        label: 'Awake',
      };
    }
    const totalMins = Math.max(0, Math.round(-state.diffMinutes));
    const hours = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    const label = hours > 0 ? `in ${hours}h ${mins}m` : `in ${mins}m`;
    return {
      className: 'bg-night-elevated text-cream-muted',
      icon: <Sun className="h-3.5 w-3.5 shrink-0 text-cream-muted" />,
      label,
    };
  };

  const statusPillConfig = getStatusPillConfig();

  // Subtle border and resting opacity variations anchored to night-surface
  let cardBorderAndResting = 'border-night-border';
  if (isNagNow) {
    cardBorderAndResting = 'border-status-coral/40 shadow-sm shadow-status-coral/5';
  } else if (bucket === 'WINDING_DOWN') {
    cardBorderAndResting = 'border-status-amber/30';
  } else if (bucket === 'SLEEPING') {
    cardBorderAndResting = 'border-night-border opacity-85 hover:opacity-100';
  } else {
    cardBorderAndResting = 'border-night-border hover:border-night-border/80';
  }

  return (
    <>
      {/* 1. Compact Primary Card View: Primary Identifiers + Direct Action & Disclosure Trigger */}
      <div
        role="region"
        aria-label={`${member.discord_username} member card`}
        onClick={() => {
          triggerHaptic(10);
          setIsDetailsOpen(true);
        }}
        className={`w-full max-w-full overflow-hidden flex flex-col justify-between p-2.5 sm:p-3.5 gap-2 sm:gap-2.5 rounded-2xl bg-night-surface border transition-all cursor-pointer hover:border-night-border/90 active:scale-[0.99] select-none ${cardBorderAndResting}`}
      >
        {/* Top Zone: Fixed avatar wrapper, strict single-line Name+Star, Sub-header badges, and right clock + pill */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            {/* Avatar Wrapper anchored to the top-left */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleProfileClick();
              }}
              className="relative shrink-0 w-11 h-11 rounded-full flex items-center justify-center cursor-pointer hover:ring-2 hover:ring-status-amber/50 transition-all focus:outline-none"
              title={`View ${member.discord_username}'s profile, sleep calendar history & weekly timetable`}
              aria-label={`View ${member.discord_username}'s profile`}
            >
              <img
                src={avatarSrc}
                alt={member.discord_username}
                onError={() => setAvatarSrc(fallbackAvatarUrl)}
                className="w-11 h-11 rounded-full object-cover border border-night-border bg-night-elevated"
              />
              {isInBed && (
                <span
                  className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-status-amber text-night-bg shadow font-bold"
                  title="Checked into bed"
                >
                  <Check className="h-2.5 w-2.5 stroke-[3]" />
                </span>
              )}
            </button>

            {/* Identity Stack */}
            <div className="flex flex-col min-w-0 flex-1 gap-1">
              {/* Name + Star Row: Strict single-line flex container */}
              <div className="flex items-center gap-1.5 min-w-0">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleProfileClick();
                  }}
                  className="truncate min-h-[44px] min-w-[44px] inline-flex items-center font-semibold text-base leading-tight text-cream-primary hover:text-status-amber hover:underline transition-colors text-left cursor-pointer focus:outline-none focus:ring-1 focus:ring-status-amber/40 rounded px-0.5 -mx-0.5"
                  title={`View ${member.discord_username}'s profile, sleep calendar history & weekly timetable`}
                  aria-label={`View ${member.discord_username}'s profile`}
                >
                  <span className="truncate">{member.discord_username}</span>
                </button>

                {/* Watchlist star button: Never wraps to new line */}
                {onToggleStar && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      triggerHaptic(10);
                      onToggleStar(member.id);
                    }}
                    className={`shrink-0 p-1 -m-1 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg transition-colors ${
                      isStarred
                        ? 'text-status-amber hover:text-status-amber/80'
                        : 'text-cream-secondary/40 hover:text-cream-secondary'
                    }`}
                    title={isStarred ? 'Remove from Starred Buddies' : 'Star as Accountability Buddy'}
                    aria-label={isStarred ? 'Remove from Starred Buddies' : 'Star as Accountability Buddy'}
                  >
                    <Star className={`h-4 w-4 ${isStarred ? 'fill-status-amber' : ''}`} />
                  </button>
                )}
              </div>

              {/* Sub-header Badges Row: Clean inline row directly under username */}
              <div className="flex flex-wrap items-center gap-1.5 min-h-[22px]">
                {isViewer && (
                  <span className="rounded bg-status-amber/20 border border-status-amber/40 px-1.5 py-0.5 text-[9px] font-bold text-status-amber shrink-0">
                    YOU
                  </span>
                )}

                {(member.role === 'moderator' || member.is_moderator) && (
                  <span className="rounded bg-night-elevated border border-night-border px-1.5 py-0.5 text-[9px] font-medium text-cream-secondary shrink-0">
                    MOD
                  </span>
                )}

                {/* Streak milestone badge */}
                {member.streak_days && member.streak_days > 0 ? (
                  <span
                    className="inline-flex items-center gap-1 rounded-full border border-status-amber/30 bg-status-amber/10 px-2 py-0.5 text-[10px] font-semibold text-status-amber shrink-0"
                    title={streakMilestone?.description || `${member.streak_days} days on track`}
                  >
                    <Flame className="h-3 w-3 fill-status-amber text-status-amber" />
                    <span>{streakMilestone?.badgeLabel || `${member.streak_days}d`}</span>
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          {/* Right Header: Local time & status badge */}
          <div className="flex flex-col items-end shrink-0 text-right">
            <span className="text-lg font-bold leading-tight whitespace-nowrap tabular-nums text-cream-primary">
              {formattedViewerTime}
            </span>
            <span
              className={`whitespace-nowrap mt-1 px-2.5 py-1 text-xs rounded-full inline-flex items-center gap-1.5 ${statusPillConfig.className}`}
            >
              {statusPillConfig.icon}
              <span>{statusPillConfig.label}</span>
            </span>
          </div>
        </div>

        {/* Action & Disclosure Zone: Quick Journal Link + Details Trigger */}
        <div className="flex items-center gap-2 w-full min-w-0 mt-auto pt-1">
          {/* Direct Discord Journal Deep Link */}
          {isNagNow ? (
            <a
              href={member.journal_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => {
                e.stopPropagation();
                handleNagJournalClick();
              }}
              className="flex-1 min-w-0 h-11 min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl bg-status-coral font-semibold text-night-bg transition-all hover:bg-status-coral/90 active:scale-[0.98] text-xs px-3 whitespace-nowrap shadow-sm"
              title={`Open ${member.discord_username}'s Discord journal to nag`}
            >
              <span className="truncate">{hasNagged ? 'Nagged! Reopen Journal' : 'Nag in Journal'}</span>
              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            </a>
          ) : bucket === 'WINDING_DOWN' ? (
            <a
              href={member.journal_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => {
                e.stopPropagation();
                handleNagJournalClick();
              }}
              className="flex-1 min-w-0 h-11 min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl border border-status-amber/40 bg-night-elevated font-medium text-status-amber transition-colors hover:bg-status-amber/15 active:scale-[0.98] text-xs px-3 whitespace-nowrap shadow-sm"
              title={`Open ${member.discord_username}'s Discord journal to say goodnight`}
            >
              <span className="truncate">{hasNagged ? 'Noted! Reopen Journal' : 'Say Goodnight'}</span>
              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            </a>
          ) : bucket === 'SLEEPING' ? (
            <a
              href={member.journal_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => {
                e.stopPropagation();
              }}
              className="flex-1 min-w-0 h-11 min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl border border-night-border bg-night-elevated text-xs font-medium text-cream-secondary hover:text-cream-primary hover:border-night-border/80 transition-colors px-3 whitespace-nowrap shadow-sm"
              title="Open Discord journal to leave a quiet note"
            >
              <span className="truncate">
                Quiet Note
                <span className="sr-only"> (Leave quiet note)</span>
              </span>
              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            </a>
          ) : (
            <a
              href={member.journal_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => {
                e.stopPropagation();
              }}
              className="flex-1 min-w-0 h-11 min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl border border-night-border bg-night-elevated text-xs font-medium text-cream-secondary hover:text-cream-primary hover:border-night-border/80 transition-colors px-3 whitespace-nowrap shadow-sm"
              title="Open Discord Journal"
            >
              <span className="truncate">Journal</span>
              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            </a>
          )}

          {/* Compact Disclosure Trigger */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              triggerHaptic(10);
              setIsDetailsOpen(true);
            }}
            aria-expanded={isDetailsOpen}
            aria-controls={`member-details-${member.id}`}
            aria-haspopup="dialog"
            aria-label={`View details and actions for ${member.discord_username}`}
            className="shrink-0 h-11 min-h-[44px] px-3 flex items-center justify-center gap-1.5 rounded-xl border border-night-border bg-night-elevated text-xs font-semibold text-cream-secondary hover:text-cream-primary hover:border-night-border/80 active:scale-95 transition-all shadow-sm"
            title="View schedule details, accountability metrics & actions"
          >
            <span>Details</span>
            <ChevronDown className="h-4 w-4 shrink-0 text-cream-muted" />
          </button>
        </div>
      </div>

      {/* 2. Progressive Disclosure Bottom Sheet Modal */}
      {isDetailsOpen && (
        <div
          role="dialog"
          id={`member-details-${member.id}`}
          aria-modal="true"
          aria-labelledby={`member-sheet-title-${member.id}`}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-night-bg/80 backdrop-blur-sm p-0 sm:p-4 animate-fade-in"
          onClick={(e) => {
            e.stopPropagation();
            setIsDetailsOpen(false);
          }}
        >
          <div
            ref={sheetDialogRef}
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg max-h-[90vh] sm:max-h-[85vh] bg-night-surface border-t sm:border border-night-border rounded-t-3xl sm:rounded-2xl flex flex-col shadow-2xl overflow-hidden animate-slide-up outline-none"
          >
            {/* Sheet Handle (Mobile) */}
            <div className="w-12 h-1 bg-night-border rounded-full mx-auto my-2.5 shrink-0 sm:hidden" />

            {/* Sheet Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-night-border bg-night-elevated/40">
              <div className="flex items-center gap-3 min-w-0">
                <img
                  src={avatarSrc}
                  alt={member.discord_username}
                  onError={() => setAvatarSrc(fallbackAvatarUrl)}
                  className="w-9 h-9 rounded-full object-cover border border-night-border bg-night-elevated shrink-0"
                />
                <div className="flex flex-col min-w-0">
                  <h3
                    id={`member-sheet-title-${member.id}`}
                    className="font-bold text-base text-cream-primary truncate"
                  >
                    {member.discord_username}
                  </h3>
                  <span className="text-xs text-cream-muted truncate tabular-nums">
                    {formattedViewerTime} local • {statusPillConfig.label}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsDetailsOpen(false)}
                className="min-h-[44px] min-w-[44px] -mr-2 p-2 flex items-center justify-center rounded-xl text-cream-secondary hover:text-cream-primary hover:bg-night-elevated transition-colors"
                aria-label="Close details"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Sheet Scrollable Body */}
            <div className="overflow-y-auto p-5 flex flex-col gap-4">
              {/* Full Schedule & Timezone Details Row */}
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs text-cream-secondary bg-night-elevated/40 px-3 py-2 rounded-xl border border-night-border/50">
                <div className="flex flex-wrap items-center gap-1.5 font-medium text-cream-secondary">
                  <span className="whitespace-nowrap">
                    {formattedSleeperTime} → {state.formattedWakeTime || formatTime12h(state.activeWakeTimeLocal || member.wake_time_local || '07:00')}
                  </span>
                  {state.isWeekendSchedule ? (
                    <span
                      className="inline-flex items-center gap-1 rounded bg-status-amber/15 px-1.5 py-0.5 text-[10px] font-semibold text-status-amber border border-status-amber/30 shrink-0"
                      title="Weekend bedtime schedule active (Friday/Saturday nights)"
                    >
                      <Moon className="h-2.5 w-2.5 text-status-amber" />
                      <span>Weekend</span>
                    </span>
                  ) : state.isCustomScheduleToday ? (
                    <span
                      className="inline-flex items-center gap-1 rounded bg-status-amber/15 px-1.5 py-0.5 text-[10px] font-semibold text-status-amber border border-status-amber/30 shrink-0"
                      title={`Custom daily schedule active for ${state.dayKey ? state.dayKey.toUpperCase() : 'today'}`}
                    >
                      <Sparkles className="h-2.5 w-2.5 text-status-amber" />
                      <span>Custom</span>
                    </span>
                  ) : null}
                </div>
                <span className="whitespace-nowrap text-cream-muted">
                  ({formatGmtOffset(member.timezone)})
                </span>
              </div>

              {/* Notice Zone */}
              {/* Out of Strikes Alert */}
              {strikesUsed >= 3 && (
                <div className="flex items-center justify-between rounded-xl border border-fox-rust/50 bg-fox-rust/15 px-3 py-2 text-[11px] font-semibold text-fox-rust">
                  <div className="flex items-center gap-1.5">
                    <FoxMascot state="alert" size={16} />
                    <span>Out of Strikes • 0 Margin Left</span>
                  </div>
                  <span className="text-[10px] text-cream-secondary">Resets on 1st</span>
                </div>
              )}

              {/* Pending 48-Hour Cooldown Notice */}
              {pendingNotice && (
                <div
                  className="text-xs py-2 px-3 rounded-xl whitespace-nowrap overflow-hidden text-ellipsis border border-dashed border-status-amber/40 bg-status-amber/10 text-status-amber tabular-nums flex items-center justify-between"
                  title={pendingNotice}
                >
                  <span className="flex items-center gap-1.5 truncate">
                    <Clock className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{pendingNotice}</span>
                  </span>
                </div>
              )}

              {/* Metastrike Active Notice */}
              {isMetastrikeActive && !isNagNow && (
                <div
                  className="flex items-center gap-1.5 rounded-xl border border-status-amber/40 bg-status-amber/15 px-3 py-2 text-xs font-semibold text-status-amber min-h-[44px] min-w-0"
                  title={`Protected tonight: ${
                    member.metastrike_reason || member.tonight_strike_log?.reason || 'Excused'
                  }`}
                >
                  <Shield className="h-4 w-4 fill-status-amber/20 shrink-0" />
            <span className="truncate">
              Metastrike Active: {member.metastrike_reason || member.tonight_strike_log?.reason || 'Excused'}
            </span>
                </div>
              )}

              {/* Viewer Checked-in Confirmation Banner */}
              {isViewer && isInBed && (isNagNow || bucket === 'WINDING_DOWN') && (
                <div className="flex h-11 min-h-[44px] items-center justify-between rounded-xl border border-status-amber/30 bg-status-amber/10 px-3 text-xs font-medium text-status-amber whitespace-nowrap">
                  <span className="flex items-center gap-1.5 truncate">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    <span>You&apos;re checked in! Nags muted</span>
                  </span>
                  {onCancelInBed && (
                    <button
                      onClick={handleCancelInBedClick}
                      disabled={isCheckingIn}
                      className="text-xs underline opacity-80 hover:opacity-100 min-h-[44px] min-w-[44px] flex items-center justify-end shrink-0 ml-2"
                    >
                      Undo
                    </button>
                  )}
                </div>
              )}

              {/* Viewer Checked-in Confirmation Banner for Sleeping State */}
              {isViewer && isInBed && bucket === 'SLEEPING' && (
                <div className="flex h-11 min-h-[44px] items-center justify-between rounded-xl border border-status-amber/30 bg-status-amber/10 px-3 text-xs font-medium text-status-amber">
                  <span className="flex items-center gap-1.5 truncate">
                    <Shield className="h-4 w-4 shrink-0" />
                    <span className="truncate">Sleep Shield Active • Nags Muted</span>
                  </span>
                  {onCancelInBed && (
                    <button
                      type="button"
                      onClick={handleCancelInBedClick}
                      disabled={isCheckingIn}
                      className="inline-flex items-center gap-1 font-bold underline hover:opacity-100 min-h-[44px] px-2 shrink-0 ml-2"
                      title="Undo check-in and return to awake status"
                    >
                      <Sun className="h-3.5 w-3.5" />
                      <span>Undo</span>
                    </button>
                  )}
                </div>
              )}

              {/* Error Toast for Rollbacks */}
              {cardError && (
                <div className="rounded-xl border border-status-coral/40 bg-status-coral/10 p-2.5 text-center text-xs text-status-coral animate-fade-in break-words text-balance leading-snug">
                  {cardError}
                </div>
              )}

              {/* Action Feedback Toast */}
              {cardFeedback && (
                <div
                  className={`rounded-xl border p-2.5 text-center text-xs font-semibold animate-fade-in break-words text-balance leading-snug ${
                    cardFeedback.type === 'shield'
                      ? 'border-status-slumber/40 bg-status-slumber/15 text-status-slumber'
                      : cardFeedback.type === 'success'
                      ? 'border-status-sage/40 bg-status-sage/15 text-status-sage'
                      : 'border-status-coral/40 bg-status-coral/10 text-status-coral'
                  }`}
                >
                  {cardFeedback.text}
                </div>
              )}

              {/* Accountability Section: Strikes & Metastrikes Bar */}
              <div className="flex flex-col gap-2 p-3 rounded-2xl border border-night-border bg-night-elevated/40">
                <span className="text-xs font-semibold text-cream-secondary uppercase tracking-wider">
                  Accountability & Passes
                </span>
                <div className="flex items-center justify-between px-3 py-2 rounded-xl text-xs whitespace-nowrap border border-night-border bg-night-elevated">
                  {/* Strikes Indicator */}
                  <div className="flex items-center gap-1.5" title={`${strikesUsed} of 3 monthly strikes used`}>
                    <span className="font-semibold text-fox-rust flex items-center gap-1">
                      <Zap className="h-3 w-3 fill-fox-rust text-fox-rust" />
                      <span>Strikes:</span>
                      <span className="tabular-nums font-bold">{strikesUsed}/3</span>
                    </span>
                    <div className="flex items-center gap-1 ml-0.5">
                      {[1, 2, 3].map((pip) => (
                        <span
                          key={`sheet-strike-${member.id}-${pip}`}
                          className={`h-1.5 w-1.5 rounded-full transition-colors ${
                            pip <= strikesUsed
                              ? 'bg-fox-rust ring-1 ring-fox-rust/40 shadow-sm shadow-fox-rust/50'
                              : 'bg-night-border border border-night-border/80'
                          }`}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Metastrikes Indicator */}
                  <div
                    className="flex items-center gap-1.5"
                    title={`${metastrikesUsed} of 3 monthly excused metastrikes used`}
                  >
                    <span className="font-semibold text-fox-amber flex items-center gap-1">
                      <Shield className="h-3 w-3 fill-fox-amber/20 text-fox-amber" />
                      <span>Meta:</span>
                      <span className="tabular-nums font-bold">{metastrikesUsed}/3</span>
                    </span>
                    <div className="flex items-center gap-1 ml-0.5">
                      {[1, 2, 3].map((pip) => (
                        <span
                          key={`sheet-meta-${member.id}-${pip}`}
                          className={`h-1.5 w-1.5 rounded-full transition-colors ${
                            pip <= metastrikesUsed
                              ? 'bg-fox-amber ring-1 ring-fox-amber/40 shadow-sm shadow-fox-amber/50'
                              : 'bg-night-border border border-night-border/80'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                {/* Modal Triggers: Sleep Calendar & Metastrike */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
                  {/* Trigger for SleepCalendarModal.tsx */}
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic(10);
                      setIsDetailsOpen(false);
                      if (onOpenSleepCalendar) {
                        onOpenSleepCalendar(member.id);
                      } else if (onOpenProfile) {
                        onOpenProfile(member.id, 'calendar');
                      }
                    }}
                    className="w-full min-h-[44px] flex items-center justify-between px-3 py-2 rounded-xl border border-night-border bg-night-surface text-xs font-semibold text-cream-primary hover:border-status-amber/40 hover:text-status-amber transition-colors"
                    title="View sleep calendar history & weekly timetable"
                  >
                    <span className="flex items-center gap-1.5 truncate">
                      <Calendar className="h-3.5 w-3.5 text-status-amber shrink-0" />
                      <span className="truncate">Sleep Calendar</span>
                    </span>
                    <ExternalLink className="h-3.5 w-3.5 text-cream-muted shrink-0 ml-1" />
                  </button>

                  {/* Trigger for MetastrikeModal.tsx */}
                  {onOpenMetastrike && isViewer && metastrikesUsed < 3 && (isStrikeConvertible || !isMetastrikeActive) && (
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic(10);
                        setIsDetailsOpen(false);
                        onOpenMetastrike(
                          member,
                          isViewer && isStrikeConvertible ? 'convert_retroactive' : 'proactive'
                        );
                      }}
                      className="w-full min-h-[44px] flex items-center justify-between px-3 py-2 rounded-xl border border-night-border bg-night-surface text-xs font-semibold text-cream-primary hover:border-status-amber/40 hover:text-status-amber transition-colors"
                      title={
                        isViewer
                          ? isStrikeConvertible
                            ? 'Convert Strike to Metastrike (24h Swap)'
                            : 'Use Metastrike Tonight (Excused Pass)'
                          : 'View Metastrike status & excused passes'
                      }
                    >
                      <span className="flex items-center gap-1.5 truncate">
                        <Shield className="h-3.5 w-3.5 text-status-amber shrink-0" />
                        <span className="truncate">
                          {isViewer && isStrikeConvertible
                            ? 'Convert Strike'
                            : isViewer
                            ? 'Use Metastrike'
                            : 'Metastrike Passes'}
                        </span>
                      </span>
                      <ExternalLink className="h-3.5 w-3.5 text-cream-muted shrink-0 ml-1" />
                    </button>
                  )}
                </div>
              </div>

              {/* Nag Assist Counter ("👥 Nagged!") */}
              {isNagNow && localNagCount > 0 && (
                <div className="flex h-10 min-h-[40px] items-center gap-1.5 rounded-xl border border-status-coral/30 bg-status-coral/10 px-3 text-xs font-semibold text-status-coral min-w-0">
                  <Users className="h-4 w-4 shrink-0" />
                  <span className="truncate">
                    {hasNagged
                      ? localNagCount === 1
                        ? 'You nagged tonight!'
                        : `You & ${localNagCount - 1} friend${localNagCount - 1 === 1 ? '' : 's'} nagged tonight`
                      : `${localNagCount} friend${localNagCount === 1 ? '' : 's'} checked in tonight`}
                  </span>
                </div>
              )}

              {/* Viewer Self-Service Actions */}
              {isViewer && !isInBed && onCheckIn && (isNagNow || bucket === 'WINDING_DOWN') && (
                <button
                  onClick={handleCheckInClick}
                  disabled={isCheckingIn}
                  className="flex h-11 min-h-[44px] min-w-[44px] w-full items-center justify-center gap-2 rounded-xl bg-status-amber px-3 font-bold text-night-bg shadow transition-transform hover:bg-status-amber/90 active:scale-[0.98] whitespace-nowrap"
                >
                  <BedDouble className="h-4 w-4 shrink-0" />
                  <span className="truncate">{isNagNow ? "I'm in Bed Now (Mute Nags)" : "I'm in Bed (Goodnight)"}</span>
                </button>
              )}

              {/* Early Bedtime Check-In for Viewer approaching bedtime while Awake */}
              {isViewer &&
                !isInBed &&
                bucket === 'AWAKE' &&
                state.diffMinutes >= -180 &&
                state.diffMinutes < -60 &&
                onCheckIn && (
                  <button
                    onClick={handleCheckInClick}
                    disabled={isCheckingIn}
                    className="flex h-11 min-h-[44px] min-w-0 w-full items-center justify-center gap-2 rounded-xl border border-status-amber/40 bg-status-amber/15 text-xs font-semibold text-status-amber transition-colors hover:bg-status-amber/25"
                  >
                    <BedDouble className="h-4 w-4 shrink-0" />
                    <span className="truncate">Early Bedtime Check-In</span>
                  </button>
                )}

              {/* Actions & Buttons Section */}
              <div className="flex flex-col gap-2.5 pt-1 w-full">
                <span className="text-xs font-semibold text-cream-secondary uppercase tracking-wider">
                  Actions
                </span>

                {/* Primary Discord Journal Link inside Sheet */}
                <a
                  href={member.journal_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={isNagNow || bucket === 'WINDING_DOWN' ? handleNagJournalClick : undefined}
                  className={`w-full h-11 min-h-[44px] flex items-center justify-center gap-2 rounded-xl font-semibold transition-all text-xs sm:text-sm px-3 whitespace-nowrap shadow-sm ${
                    isNagNow
                      ? 'bg-status-coral text-night-bg hover:bg-status-coral/90 active:scale-[0.98]'
                      : bucket === 'WINDING_DOWN'
                      ? 'border border-status-amber/40 bg-night-elevated text-status-amber hover:bg-status-amber/15 active:scale-[0.98]'
                      : 'border border-night-border bg-night-elevated text-cream-secondary hover:text-cream-primary hover:border-night-border/80'
                  }`}
                >
                  <span className="truncate">
                    {isNagNow
                      ? hasNagged
                        ? 'Nagged! Reopen Journal'
                        : 'Nag in Discord Journal'
                      : bucket === 'WINDING_DOWN'
                      ? hasNagged
                        ? 'Noted! Reopen Journal'
                        : 'Say Goodnight in Journal'
                      : bucket === 'SLEEPING'
                      ? 'Quiet Note'
                      : 'Open Discord Journal'}
                  </span>
                  <ExternalLink className="h-4 w-4 shrink-0" />
                </a>

                {/* Bucket-Specific Secondary Actions */}
                {isNagNow && (
                  <div className="flex items-center gap-2 w-full min-w-0">
                    {/* Nag Notif Button */}
                    {isEligibleForNagNotif && (
                      <button
                        type="button"
                        onClick={handleSendNagNotif}
                        disabled={isSendingNagNotif || nagCooldownSeconds > 0}
                        className={`${
                          hasSecondaryNagAction ? 'flex-1' : 'w-full'
                        } min-w-0 h-11 min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl px-2.5 text-xs font-semibold transition-all shadow-sm ${
                          isTargetShieldOn
                            ? 'border border-status-slumber/40 bg-status-slumber/15 text-status-slumber hover:bg-status-slumber/25 active:scale-95'
                            : nagCooldownSeconds > 0
                            ? 'border border-night-border/70 bg-night-elevated/70 text-cream-muted cursor-not-allowed'
                            : 'border border-status-coral/50 bg-status-coral/15 text-status-coral hover:bg-status-coral/25 active:scale-95'
                        }`}
                        title={
                          isTargetShieldOn
                            ? `Sleep Shield is ON for ${member.discord_username}. Tap to see shield status.`
                            : nagCooldownSeconds > 0
                            ? `Nag reminder sent! You can send another reminder in ${formatNagCooldown(nagCooldownSeconds)}.`
                            : `Send bedtime reminder notification to ${member.discord_username}`
                        }
                      >
                        {isTargetShieldOn ? (
                          <>
                            <Shield className="h-3.5 w-3.5 fill-status-slumber/20 shrink-0" />
                            <span className="truncate">Shield On</span>
                          </>
                        ) : isSendingNagNotif ? (
                          <>
                            <RefreshCw className="h-3.5 w-3.5 animate-spin shrink-0" />
                            <span className="truncate">Sending...</span>
                          </>
                        ) : nagCooldownSeconds > 0 ? (
                          <>
                            <Clock className="h-3.5 w-3.5 text-cream-muted shrink-0" />
                            <span className="truncate">Nag in {formatNagCooldown(nagCooldownSeconds)}</span>
                          </>
                        ) : (
                          <>
                            <Bell className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">Nag Notif</span>
                          </>
                        )}
                      </button>
                    )}

                    {/* Contextual Secondary Status / Action Pill: Grace / Vote Strike / Strike Issued / Metastrike */}
                    {isMetastrikeActive ? (
                      <div
                        className={`${isEligibleForNagNotif ? 'flex-1' : 'w-full'} min-w-0 h-9 min-h-[36px] flex items-center justify-center gap-1.5 rounded-xl border border-status-amber/40 bg-status-amber/15 px-2.5 text-xs font-semibold text-status-amber shadow-sm`}
                        title={`Protected tonight: ${
                          member.metastrike_reason || member.tonight_strike_log?.reason || 'Excused'
                        }`}
                      >
                        <Shield className="h-3.5 w-3.5 fill-status-amber/20 shrink-0" />
                  <span className="truncate">
                    Metastrike: {member.metastrike_reason || member.tonight_strike_log?.reason || 'Excused'}
                  </span>
                      </div>
                    ) : isStrikeIssuedTonight ? (
                      <div
                        className={`${isEligibleForNagNotif ? 'flex-1' : 'w-full'} min-w-0 h-9 min-h-[36px] flex items-center justify-center gap-1.5 rounded-xl border border-status-coral/40 bg-status-coral/15 px-2.5 text-xs font-semibold text-status-coral shadow-sm`}
                        title="2/2 community verification votes reached. Strike issued for tonight."
                      >
                        <Zap className="h-3.5 w-3.5 fill-status-coral shrink-0" />
                        <span className="truncate">Strike Issued</span>
                      </div>
                    ) : state.status === 'BEDTIME_GRACE' ? (
                      <div
                        className={`${isEligibleForNagNotif ? 'flex-1' : 'w-full'} min-w-0 h-9 min-h-[36px] flex items-center justify-center gap-1.5 rounded-xl border border-night-border bg-night-elevated px-2.5 text-xs text-cream-secondary shadow-sm`}
                        title="5-minute grace period active. Strike voting is locked."
                      >
                        <Clock className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">Grace: {state.graceMinutesLeft || 5}m left</span>
                      </div>
                    ) : onVoteStrike && !isViewer ? (
                      <button
                        type="button"
                        onClick={() => {
                          triggerHaptic(15);
                          onVoteStrike(member.id);
                        }}
                        disabled={isVotingStrike || member.has_voted_strike}
                        className={`${isEligibleForNagNotif ? 'flex-1' : 'w-full'} min-w-0 h-11 min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl px-2.5 text-xs font-semibold transition-all shadow-sm ${
                          member.has_voted_strike
                            ? 'border border-status-coral/30 bg-night-elevated text-status-coral/60 cursor-not-allowed'
                            : 'border border-status-coral/50 bg-status-coral/15 text-status-coral hover:bg-status-coral/25 active:scale-95'
                        }`}
                        title={
                          member.has_voted_strike
                            ? 'You have already voted to strike this member tonight'
                            : 'Vote to verify bedtime missed (2 community votes needed)'
                        }
                      >
                        <Zap className="h-3.5 w-3.5 fill-status-coral shrink-0" />
                  <span className="truncate">
                    {member.has_voted_strike
                      ? `Voted (${strikeVotesCount}/2)`
                      : `Vote Strike (${strikeVotesCount}/2)`}
                  </span>
                      </button>
                    ) : null}
                  </div>
                )}

                {bucket === 'WINDING_DOWN' && (
                  <div className="flex flex-col gap-2 w-full">
                    {isEligibleForNagNotif && (
                      <button
                        type="button"
                        onClick={handleSendNagNotif}
                        disabled={isSendingNagNotif || nagCooldownSeconds > 0}
                        className={`w-full min-w-0 h-11 min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition-all shadow-sm ${
                          isTargetShieldOn
                            ? 'border border-status-slumber/40 bg-status-slumber/15 text-status-slumber hover:bg-status-slumber/25 active:scale-95'
                            : nagCooldownSeconds > 0
                            ? 'border border-night-border/70 bg-night-elevated/70 text-cream-muted cursor-not-allowed'
                            : 'border border-status-amber/50 bg-status-amber/15 text-status-amber hover:bg-status-amber/25 active:scale-95'
                        }`}
                        title={
                          isTargetShieldOn
                            ? `Sleep Shield is ON for ${member.discord_username}. Nags muted.`
                            : nagCooldownSeconds > 0
                            ? `Nag reminder sent! You can send another reminder in ${formatNagCooldown(nagCooldownSeconds)}.`
                            : `Send bedtime reminder notification to ${member.discord_username}`
                        }
                      >
                        {isTargetShieldOn ? (
                          <>
                            <Shield className="h-3.5 w-3.5 fill-status-slumber/20 shrink-0" />
                            <span className="truncate">Shield On (Muted)</span>
                          </>
                        ) : isSendingNagNotif ? (
                          <>
                            <RefreshCw className="h-3.5 w-3.5 animate-spin shrink-0" />
                            <span className="truncate">Sending...</span>
                          </>
                        ) : nagCooldownSeconds > 0 ? (
                          <>
                            <Clock className="h-3.5 w-3.5 text-cream-muted shrink-0" />
                            <span className="truncate">Nag in {formatNagCooldown(nagCooldownSeconds)}</span>
                          </>
                        ) : (
                          <>
                            <Bell className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">Nag Notif</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                )}

                {bucket === 'SLEEPING' && (
                  <div className="flex flex-col gap-2 w-full">
                    {isViewer ? (
                      <div className="flex flex-col gap-2 w-full">
                        <div className="flex items-center gap-2 w-full flex-wrap sm:flex-nowrap">
                          {/* Primary ☀️ I Woke Up Button */}
                          <button
                            type="button"
                            onClick={async () => {
                              triggerHaptic(20);
                              const prevWokeUp = optimisticWokeUp;
                              const prevInBed = optimisticInBed;
                              setOptimisticWokeUp(true);
                              setOptimisticInBed(false);
                              try {
                                if (onWakeUp) {
                                  const res = await onWakeUp(member.id, 'button');
                                  if (res === false) {
                                    setOptimisticWokeUp(prevWokeUp);
                                    setOptimisticInBed(prevInBed);
                                  }
                                } else if (onCancelInBed) {
                                  await onCancelInBed(member.id);
                                }
                              } catch {
                                setOptimisticWokeUp(prevWokeUp);
                                setOptimisticInBed(prevInBed);
                              }
                            }}
                            disabled={isCheckingIn}
                            className="flex-1 min-w-[130px] h-11 min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl border border-status-amber bg-status-amber text-night-bg px-3 text-xs font-bold hover:bg-status-amber/90 active:scale-95 transition-all shadow-sm"
                            title="Log wake-up right now"
                          >
                            <Sun className="h-4 w-4 shrink-0" />
                            <span className="truncate">☀️ I Woke Up</span>
                          </button>

                          {/* Secondary Enter Time Manually Button */}
                          <button
                            type="button"
                            onClick={() => {
                              triggerHaptic(10);
                              setShowManualWakeInput((prev) => !prev);
                            }}
                            className="h-11 min-h-[44px] px-3 flex items-center justify-center gap-1 rounded-xl border border-night-border bg-night-elevated text-xs font-semibold text-cream-secondary hover:text-cream-primary hover:border-night-border/80 active:scale-95 transition-all"
                            title="Enter exact wake-up time manually"
                          >
                            <Clock className="h-3.5 w-3.5 text-status-amber shrink-0" />
                            <span className="truncate">Enter Time</span>
                          </button>

                          {/* Undo Button */}
                          {onCancelInBed && (
                            <button
                              type="button"
                              onClick={handleCancelInBedClick}
                              disabled={isCheckingIn}
                              className="h-11 min-h-[44px] px-2.5 flex items-center justify-center gap-1 rounded-xl border border-night-border/60 bg-transparent text-xs font-medium text-cream-muted hover:text-cream-secondary active:scale-95 transition-all"
                              title="Wake up and undo sleep status (returns from sleeping state to awake)"
                            >
                              <span className="truncate">Wake Up (Undo)</span>
                            </button>
                          )}
                        </div>

                        {/* Inline manual wake time picker */}
                        {showManualWakeInput && (
                          <form
                            onSubmit={async (e) => {
                              e.preventDefault();
                              if (!manualWakeTimeInput) return;
                              triggerHaptic(20);
                              const prevWokeUp = optimisticWokeUp;
                              const prevInBed = optimisticInBed;
                              setOptimisticWokeUp(true);
                              setOptimisticInBed(false);
                              setShowManualWakeInput(false);
                              try {
                                if (onWakeUp) {
                                  const res = await onWakeUp(member.id, 'manual', manualWakeTimeInput);
                                  if (res === false) {
                                    setOptimisticWokeUp(prevWokeUp);
                                    setOptimisticInBed(prevInBed);
                                  }
                                }
                              } catch {
                                setOptimisticWokeUp(prevWokeUp);
                                setOptimisticInBed(prevInBed);
                              }
                            }}
                            className="flex items-center gap-2 p-2 rounded-xl bg-night-elevated/70 border border-night-border/60 flex-wrap"
                          >
                            <input
                              type="time"
                              value={manualWakeTimeInput}
                              onChange={(e) => setManualWakeTimeInput(e.target.value)}
                              required
                              className="rounded-lg border border-night-border bg-night-surface px-2.5 py-1.5 text-xs text-cream-primary font-mono focus:border-status-amber focus:outline-none min-h-[44px]"
                            />
                            <button
                              type="submit"
                              className="h-11 min-h-[44px] px-3.5 rounded-lg bg-status-amber text-xs font-bold text-night-bg hover:bg-status-amber/90 active:scale-95 transition-all whitespace-nowrap"
                            >
                              Save Wake Time
                            </button>
                            <button
                              type="button"
                              onClick={() => setShowManualWakeInput(false)}
                              className="h-11 min-h-[44px] px-3 rounded-lg border border-night-border text-xs font-medium text-cream-secondary hover:text-cream-primary"
                            >
                              Cancel
                            </button>
                          </form>
                        )}
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2 w-full">
                        {/* 1. Strike voting if member missed bedtime and not in bed / not metastrike */}
                        {!isInBed && !isMetastrikeActive && !isViewer && onVoteStrike ? (
                          isStrikeIssuedTonight ? (
                            <span className="flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 px-2.5 py-2.5 min-h-[44px] min-w-[44px] text-xs font-semibold rounded-xl text-status-coral whitespace-nowrap">
                              <Zap className="h-3.5 w-3.5 fill-status-coral shrink-0" />
                              <span className="truncate">Strike Issued</span>
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                triggerHaptic(15);
                                onVoteStrike(member.id);
                              }}
                              disabled={isVotingStrike || member.has_voted_strike}
                              className={`flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 px-2.5 py-2.5 min-h-[44px] min-w-[44px] text-xs font-semibold rounded-xl whitespace-nowrap transition-colors ${
                                member.has_voted_strike
                                  ? 'border border-status-coral/30 bg-night-elevated text-status-coral/60 cursor-not-allowed'
                                  : 'border border-status-coral/40 bg-status-coral/15 text-status-coral hover:bg-status-coral/25 active:scale-95'
                              }`}
                            >
                              <Zap className="h-3.5 w-3.5 fill-status-coral shrink-0" />
                              <span className="truncate">
                                {member.has_voted_strike
                                  ? `Voted (${strikeVotesCount}/2)`
                                  : `Vote Strike (${strikeVotesCount}/2)`}
                              </span>
                            </button>
                          )
                        ) : state.isPastWakeTime ? (
                          /* 2. Wake-up reminder if past wake time */
                          <button
                            type="button"
                            onClick={handleSendWakeUpNagNotif}
                            disabled={isSendingWakeNag || wakeCooldownSeconds > 0}
                            className={`flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 px-2.5 py-2.5 min-h-[44px] min-w-[44px] text-xs font-semibold rounded-xl whitespace-nowrap transition-colors shadow-sm ${
                              wakeCooldownSeconds > 0
                                ? 'border border-night-border/70 bg-night-elevated/70 text-cream-muted cursor-not-allowed'
                                : 'border border-status-amber/40 bg-status-amber/15 text-status-amber hover:bg-status-amber/25 active:scale-95'
                            }`}
                            title={
                              wakeCooldownSeconds > 0
                                ? `Wake-up reminder sent! You can send another reminder in ${formatNagCooldown(wakeCooldownSeconds)}.`
                                : `Send wake-up reminder notification to ${member.discord_username}`
                            }
                          >
                            {isSendingWakeNag ? (
                              <>
                                <RefreshCw className="h-3.5 w-3.5 animate-spin shrink-0" />
                                <span className="truncate">Sending...</span>
                              </>
                            ) : wakeCooldownSeconds > 0 ? (
                              <>
                                <Clock className="h-3.5 w-3.5 text-cream-muted shrink-0" />
                                <span className="truncate">Nag in {formatNagCooldown(wakeCooldownSeconds)}</span>
                              </>
                            ) : (
                              <>
                                <Sun className="h-3.5 w-3.5 text-status-amber shrink-0" />
                                <span className="truncate">Wake Up Nag</span>
                              </>
                            )}
                          </button>
                        ) : isTargetShieldOn && !isViewer ? (
                          /* 3. Shield On */
                          <button
                            type="button"
                            onClick={handleSendNagNotif}
                            className="flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 px-2.5 py-2.5 min-h-[44px] min-w-[44px] text-xs font-semibold rounded-xl whitespace-nowrap transition-colors border border-status-slumber/40 bg-status-slumber/15 text-status-slumber hover:bg-status-slumber/25 shadow-sm"
                            title={`Sleep Shield is ON for ${member.discord_username} until their wake time (${state.activeWakeTimeLocal || '07:00'}). Tap to view shield status.`}
                          >
                            <Shield className="h-3.5 w-3.5 fill-status-slumber/20 shrink-0" />
                            <span className="truncate">Shield On</span>
                          </button>
                        ) : null}

                        {/* Leave quiet note */}
                        <a
                          href={member.journal_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`${
                            hasSleepingActionButton ? '' : 'col-span-2'
                          } flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 px-2.5 py-2.5 min-h-[44px] min-w-[44px] text-xs font-medium rounded-xl whitespace-nowrap transition-colors border border-night-border bg-night-elevated text-cream-secondary hover:text-cream-primary hover:border-night-border/80 shadow-sm`}
                          title="Open Discord journal to leave a quiet note"
                        >
                          <span className="truncate">
                            Quiet Note
                            <span className="sr-only"> (Leave quiet note)</span>
                          </span>
                          <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                        </a>
                      </div>
                    )}
                  </div>
                )}

                {bucket === 'AWAKE' && (
                  <div className={isViewer && (state.needsWakeUpLog || (isWokeUp && onCheckIn)) ? "grid grid-cols-2 gap-2 w-full" : "w-full"}>
                    {isViewer && state.needsWakeUpLog && (
                      <button
                        type="button"
                        onClick={async () => {
                          triggerHaptic(20);
                          const prevWokeUp = optimisticWokeUp;
                          setOptimisticWokeUp(true);
                          try {
                            if (onWakeUp) {
                              const res = await onWakeUp(member.id, 'button');
                              if (res === false) {
                                setOptimisticWokeUp(prevWokeUp);
                              }
                            }
                          } catch {
                            setOptimisticWokeUp(prevWokeUp);
                          }
                        }}
                        className="w-full min-w-0 inline-flex items-center justify-center gap-1.5 px-2.5 py-2.5 min-h-[44px] min-w-[44px] text-xs font-bold rounded-xl border border-status-amber bg-status-amber text-night-bg hover:bg-status-amber/90 active:scale-95 transition-all shadow-sm whitespace-nowrap"
                        title="Log when you woke up"
                      >
                        <Sun className="h-4 w-4 shrink-0" />
                        <span className="truncate">☀️ I Woke Up</span>
                      </button>
                    )}
                    {isViewer && isWokeUp && !state.needsWakeUpLog && onCheckIn && (
                      <button
                        type="button"
                        onClick={handleCheckInClick}
                        disabled={isCheckingIn}
                        className="w-full min-w-0 inline-flex items-center justify-center gap-1.5 px-2.5 py-2.5 min-h-[44px] min-w-[44px] text-xs font-semibold rounded-xl border border-status-amber/40 bg-status-amber/15 text-status-amber hover:bg-status-amber/25 active:scale-95 transition-all shadow-sm whitespace-nowrap"
                        title="Go to bed and turn on Sleep Shield"
                      >
                        <BedDouble className="h-3.5 w-3.5 text-status-amber shrink-0" />
                        <span className="truncate">Go to Bed</span>
                      </button>
                    )}
                    <a
                      href={member.journal_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full min-w-0 inline-flex items-center justify-center gap-1.5 px-2.5 py-2.5 min-h-[44px] min-w-[44px] text-xs font-medium rounded-xl whitespace-nowrap transition-colors border border-night-border bg-night-elevated text-cream-secondary hover:text-cream-primary hover:border-night-border/80 shadow-sm"
                      title="Open Discord Journal"
                    >
                      <span className="truncate">Journal</span>
                      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
