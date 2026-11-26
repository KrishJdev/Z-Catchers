'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  ExternalLink,
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
  Bell,
  Calendar,
  X,
} from 'lucide-react';
import type { Member } from '@/lib/db';
import { formatTime12h, type MemberState } from '@/lib/sleepEngine';
import { formatGmtOffset } from '@/lib/timezone';

interface MemberCardProps {
  member: Member;
  state: MemberState;
  currentMemberId?: string | null;
  isStarred?: boolean;
  onToggleStar?: (memberId: string) => void;
  onCheckIn?: (memberId: string) => Promise<boolean | void> | void;
  onCancelInBed?: (memberId: string) => Promise<boolean | void>;
  isCheckingIn?: boolean;
  onOpenMetastrike?: (member: Member) => void;
  isVotingStrike?: boolean;
  isModerator?: boolean;
  onOpenPunishments?: () => void;
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
  onOpenMetastrike,
  onOpenSleepCalendar,
  onOpenPunishments,
  onOpenProfile,
  onWakeUp,
}: MemberCardProps) {
  const { bucket, formattedViewerTime, formattedSleeperTime, pendingNotice, streakMilestone } = state;
  const isViewer = Boolean(currentMemberId && member.id === currentMemberId);

  // Progressive Disclosure Bottom Sheet state & focus management refs
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const sheetDialogRef = useRef<HTMLDivElement>(null);
  const detailsTriggerRef = useRef<HTMLButtonElement>(null);

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

    const detailsTrigger = detailsTriggerRef.current;

    const focusableControls = () => Array.from(sheetDialogRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, [tabindex]'
    ) ?? []).filter(element => element.tabIndex >= 0 && !element.matches(':disabled') &&
      element.getClientRects().length > 0 && getComputedStyle(element).visibility === 'visible');

    const firstFocusable = focusableControls()[0];
    (firstFocusable ?? sheetDialogRef.current)?.focus({ preventScroll: true });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsDetailsOpen(false);
        return;
      }

      if (e.key === 'Tab') {
        if (!sheetDialogRef.current) return;
        const focusables = focusableControls();
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
      window.removeEventListener('keydown', handleKeyDown);
      detailsTrigger?.focus({ preventScroll: true });
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
      const res = await onCheckIn(member.id);
      if (res === false) {
        setOptimisticInBed(false);
        setOptimisticWokeUp(null);
        setCardError('Check-in failed. Reverting status.');
        setTimeout(() => setCardError(null), 3000);
      }
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
    setOptimisticWokeUp(false);
    setCardError(null);
    try {
      const res = await onCancelInBed(member.id);
      if (res === false) {
        setCardError('Failed to cancel check-in.');
        setTimeout(() => setCardError(null), 3000);
      }
    } catch {
      setCardError('Failed to cancel check-in.');
      setTimeout(() => setCardError(null), 3000);
    } finally {
      // Clear transient optimistic overrides so the member is not erroneously left out of bed
      setOptimisticInBed(null);
      setOptimisticWokeUp(null);
    }
  };

  // Optimistic "I Woke Up" action
  const handleWakeUpClick = async () => {
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
        const res = await onCancelInBed(member.id);
        if (res === false) {
          setOptimisticWokeUp(prevWokeUp);
          setOptimisticInBed(prevInBed);
        }
      }
    } catch {
      setOptimisticWokeUp(prevWokeUp);
      setOptimisticInBed(prevInBed);
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

  const isNagNow = bucket === 'BEDTIME_NOW' || state.status === 'BEDTIME_GRACE' || state.status === 'OVERDUE_NAG_NOW';

  // Real-time bedtime nag notification eligibility:
  // 1. Viewer cannot nag themselves (!isViewer)
  // 2. Target member is within 30m before bedtime (-30 <= diffMinutes < 0) OR past bedtime (0 <= diffMinutes <= 480)
  const canSendPushNag = Boolean(currentMemberId) && !isViewer;
  const isEligibleForNagNotif = canSendPushNag && state.diffMinutes >= -30 && state.diffMinutes <= 480;

  // Secondary contextual status/action exists alongside the Nag Notif button
  const hasSecondaryNagAction = Boolean(
    isMetastrikeActive ||
    isStrikeIssuedTonight ||
    state.status === 'BEDTIME_GRACE'
  );

  // Sleep Shield protection state:
  // True if member is checked in early (Safe Button), in the 8-hour sleep window, or has an active Metastrike excuse pass.
  const isTargetShieldOn = Boolean(
    isInBed ||
    state.isSleepShieldActive ||
    bucket === 'SLEEPING' ||
    isMetastrikeActive
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

  const isSleeping = bucket === 'SLEEPING';
  const isWindingDown = bucket === 'WINDING_DOWN';
  const isGrace = state.status === 'BEDTIME_GRACE' || bucket === 'BEDTIME_GRACE';
  const roleLabel = member.role === 'owner' ? 'Owner' : member.role === 'moderator' || member.is_moderator ? 'Moderator' : null;

  let statusLabel = 'Awake';
  let statusColor = 'text-cream-secondary';
  let cardBorder = 'border-night-border';
  if (isSleeping) {
    statusLabel = isInBed ? 'In bed' : 'Sleeping';
  } else if (isNagNow) {
    statusLabel = isGrace
      ? `${state.graceMinutesLeft || 5}m grace`
      : `${Math.max(1, Math.floor(state.diffMinutes))}m overdue`;
    statusColor = 'text-status-coral';
    cardBorder = 'border-status-coral/40';
  } else if (isWindingDown) {
    statusLabel = `In ${Math.abs(Math.floor(state.diffMinutes))}m`;
    statusColor = 'text-status-amber';
    cardBorder = 'border-status-amber/30';
  }

  const recordsJournalAssist = !isViewer && !isSleeping && (isNagNow || isWindingDown);
  let journalLabel = isSleeping ? 'Quiet Note' : 'Journal';
  let journalStyle = 'border-night-border bg-night-elevated text-cream-secondary hover:text-cream-primary';
  if (recordsJournalAssist && isNagNow) {
    journalLabel = hasNagged ? 'Nagged! Reopen Journal' : 'Nag in Journal';
    journalStyle = 'border-status-coral bg-status-coral text-night-bg hover:bg-status-coral/90';
  } else if (recordsJournalAssist && isWindingDown) {
    journalLabel = hasNagged ? 'Noted! Reopen Journal' : 'Say Goodnight';
    journalStyle = 'border-status-amber/50 text-status-amber hover:bg-status-amber/10';
  }

  const focusStyle = 'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-status-amber';
  const journalLink = (className: string) => (
    <a
      href={member.journal_url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={recordsJournalAssist ? handleNagJournalClick : undefined}
      className={`flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-lg border px-2 py-0.5 text-center text-sm font-semibold leading-4 transition-colors ${journalStyle} ${focusStyle} ${className}`}
    >
      <span className="min-w-0">{journalLabel}</span>
      {(!recordsJournalAssist || !hasNagged) && <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
    </a>
  );

  const openFromDetails = (open: () => void) => {
    detailsTriggerRef.current?.focus({ preventScroll: true });
    setIsDetailsOpen(false);
    open();
  };

  return (
    <>
      <div
        role="region"
        aria-label={`${member.discord_username} member card`}
        className={`w-full max-w-full overflow-hidden flex min-w-0 flex-col justify-between gap-1 rounded-xl border bg-night-surface px-2.5 py-2 ${cardBorder}`}
      >
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={handleProfileClick}
            className={`flex min-h-[44px] min-w-[44px] flex-1 items-center gap-2 rounded-lg text-left text-sm font-semibold text-cream-primary transition-colors hover:text-status-amber ${focusStyle}`}
            title={member.discord_username}
            aria-label={`View ${member.discord_username}'s profile${isViewer ? ', you' : ''}`}
          >
            <img
              src={avatarSrc}
              alt=""
              onError={() => setAvatarSrc(fallbackAvatarUrl)}
              className="h-8 w-8 shrink-0 rounded-full border border-night-border bg-night-elevated object-cover"
            />
            <span className="min-w-0">
              <span className="block truncate">{member.discord_username}</span>
              {isViewer && <span className="block text-xs font-medium text-cream-secondary">You</span>}
            </span>
          </button>
          <p className="shrink-0 text-right leading-tight">
            <span className="sr-only">Bedtime </span>
            <span className="block whitespace-nowrap text-base font-bold tabular-nums text-cream-primary">{formattedViewerTime}</span>
            <span className="block text-xs text-cream-secondary">your time</span>
          </p>
          {onToggleStar && (
            <button
              type="button"
              onClick={() => {
                triggerHaptic(10);
                onToggleStar(member.id);
              }}
              className={`flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg transition-colors ${focusStyle} ${
                isStarred ? 'text-status-amber' : 'text-cream-secondary hover:text-cream-primary'
              }`}
              title={isStarred ? 'Remove from Starred Buddies' : 'Star as Accountability Buddy'}
              aria-label={`Star ${member.discord_username}`}
              aria-pressed={isStarred}
            >
              <Star className={`h-4 w-4 ${isStarred ? 'fill-status-amber' : ''}`} aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1.9fr)_auto] items-center gap-1.5">
          <p className={`text-sm font-medium leading-tight tabular-nums ${statusColor}`}>{statusLabel}</p>
          {journalLink('min-w-0 self-stretch')}
          <button
            type="button"
            ref={detailsTriggerRef}
            onClick={() => {
              triggerHaptic(10);
              setIsDetailsOpen(true);
            }}
            aria-expanded={isDetailsOpen}
            aria-controls={isDetailsOpen ? `member-details-${member.id}` : undefined}
            aria-haspopup="dialog"
            aria-label={`Details for ${member.discord_username}`}
            className={`min-h-[44px] min-w-[44px] self-stretch rounded-lg px-2 text-sm font-semibold text-cream-secondary transition-colors hover:bg-night-elevated hover:text-cream-primary ${focusStyle}`}
          >
            Details
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
          className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-night-bg/80 backdrop-blur-sm p-0 md:p-4 animate-fade-in motion-reduce:animate-none"
          onClick={() => setIsDetailsOpen(false)}
        >
          <div
            ref={sheetDialogRef}
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg max-h-[92dvh] md:max-h-[85dvh] bg-night-surface border-t md:border border-night-border rounded-t-3xl md:rounded-2xl flex flex-col shadow-2xl overflow-hidden animate-slide-up outline-none motion-reduce:animate-none"
          >
            {/* Sheet Handle (Mobile) */}
            <div className="w-12 h-1 bg-night-border rounded-full mx-auto my-2.5 shrink-0 md:hidden" />

            {/* Sheet Header */}
            <div className="flex shrink-0 items-center justify-between px-4 py-3 border-b border-night-border bg-night-elevated/40">
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
                  <span className="text-sm text-cream-secondary tabular-nums">
                    {statusLabel}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsDetailsOpen(false)}
                className={`min-h-[44px] min-w-[44px] shrink-0 p-2 flex items-center justify-center rounded-xl text-cream-secondary hover:text-cream-primary hover:bg-night-elevated transition-colors ${focusStyle}`}
                aria-label="Close details"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Sheet Scrollable Body */}
            <div className="overflow-y-auto overscroll-contain p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] flex flex-col gap-4 md:p-5">
              {/* Full Schedule & Timezone Details Row */}
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-sm text-cream-secondary bg-night-elevated/40 px-3 py-2 rounded-xl border border-night-border/50">
                <div className="flex flex-wrap items-center gap-1.5 font-medium text-cream-secondary">
                  <span className="min-w-0">
                    Local schedule: {formattedSleeperTime} – {state.formattedWakeTime || formatTime12h(state.activeWakeTimeLocal || member.wake_time_local || '07:00')}
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
                <span className="whitespace-nowrap text-cream-secondary">
                  ({formatGmtOffset(member.timezone)})
                </span>
              </div>

              {(roleLabel || (member.streak_days ?? 0) > 0) && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-cream-secondary">
                  {roleLabel && <span>{roleLabel}</span>}
                  {(member.streak_days ?? 0) > 0 && (
                    <span className="inline-flex items-center gap-1.5 text-status-amber"
                      title={streakMilestone?.description}>
                      <Flame className="h-4 w-4 shrink-0" aria-hidden="true" />
                      {streakMilestone?.badgeLabel || (member.streak_days + ' days on track')}
                    </span>
                  )}
                </div>
              )}

              {/* Notice Zone */}
              {/* Pending 48-Hour Cooldown Notice */}
              {pendingNotice && (
                <div
                  className="text-xs py-2 px-3 rounded-xl border border-dashed border-status-amber/40 bg-status-amber/10 text-status-amber tabular-nums flex items-center justify-between"
                  title={pendingNotice}
                >
                  <span className="flex items-start gap-1.5">
                    <Clock className="h-3.5 w-3.5 shrink-0" />
                    <span>{pendingNotice}</span>
                  </span>
                </div>
              )}

              {/* Metastrike Active Notice */}
              {isMetastrikeActive && !isNagNow && (
                <div
                  className="flex items-center gap-1.5 rounded-xl border border-status-amber/40 bg-status-amber/15 px-3 py-2 text-xs font-semibold text-status-amber min-h-[44px] min-w-0"
                  title="Protected by Metastrike"
                >
                  <Shield className="h-4 w-4 fill-status-amber/20 shrink-0" />
                  <span className="truncate">Protected by Metastrike</span>
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
                      className="hidden text-xs underline opacity-80 hover:opacity-100 min-h-[44px] min-w-[44px] md:flex items-center justify-end shrink-0 ml-2"
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
                      className="hidden md:inline-flex items-center gap-1 font-bold underline hover:opacity-100 min-h-[44px] px-2 shrink-0 ml-2"
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
                {member.strike_counts_unavailable ? (
                  <p className="text-xs text-cream-secondary">Strike and pass counts unavailable</p>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border border-night-border bg-night-elevated px-3 py-2 text-sm">
                    <p className="flex items-center gap-1.5 font-semibold text-fox-rust">
                      <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                      Monthly strikes {strikesUsed}
                    </p>

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
                )}

                {/* Modal Triggers: Sleep Calendar & Metastrike */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
                  {/* Trigger for SleepCalendarModal.tsx */}
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic(10);
                      openFromDetails(() => {
                        if (onOpenSleepCalendar) onOpenSleepCalendar(member.id);
                        else onOpenProfile?.(member.id, 'calendar');
                      });
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

                  {isViewer && typeof member.open_punishment_count === 'number' && onOpenPunishments && (
                    <button
                      type="button"
                      aria-haspopup="dialog"
                      onClick={() => openFromDetails(onOpenPunishments)}
                      className="min-h-[44px] min-w-[44px] rounded-xl border border-night-border bg-night-surface px-3 py-2 text-left text-sm font-semibold text-cream-primary hover:border-status-amber/40 hover:text-status-amber"
                    >
                      Punishments <span className="text-cream-secondary">({member.open_punishment_count} open)</span>
                    </button>
                  )}

                  {/* Trigger for MetastrikeModal.tsx */}
                  {onOpenMetastrike && isViewer && (
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic(10);
                        openFromDetails(() => onOpenMetastrike(member));
                      }}
                      className="w-full min-h-[44px] flex items-center justify-between px-3 py-2 rounded-xl border border-night-border bg-night-surface text-xs font-semibold text-cream-primary hover:border-status-amber/40 hover:text-status-amber transition-colors"
                    >
                      <span className="flex items-center gap-1.5 truncate">
                        <Shield className="h-3.5 w-3.5 text-status-amber shrink-0" />
                        <span className="truncate">Request Metastrike</span>
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
                  className="hidden md:flex h-11 min-h-[44px] min-w-[44px] w-full items-center justify-center gap-2 rounded-xl bg-status-amber px-3 font-bold text-night-bg shadow transition-transform hover:bg-status-amber/90 active:scale-[0.98] whitespace-nowrap"
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
                    className="hidden md:flex h-11 min-h-[44px] min-w-0 w-full items-center justify-center gap-2 rounded-xl border border-status-amber/40 bg-status-amber/15 text-xs font-semibold text-status-amber transition-colors hover:bg-status-amber/25"
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

                {journalLink('w-full')}

                {/* Bucket-Specific Secondary Actions */}
                {isNagNow && bucket !== 'SLEEPING' && (
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

                    {/* Contextual Secondary Status Pill: Grace / Strike Issued / Metastrike */}
                    {isMetastrikeActive ? (
                      <div
                        className={`${isEligibleForNagNotif ? 'flex-1' : 'w-full'} min-w-0 h-9 min-h-[36px] flex items-center justify-center gap-1.5 rounded-xl border border-status-amber/40 bg-status-amber/15 px-2.5 text-xs font-semibold text-status-amber shadow-sm`}
                        title="Protected by Metastrike"
                      >
                        <Shield className="h-3.5 w-3.5 fill-status-amber/20 shrink-0" />
                        <span className="truncate">Protected by Metastrike</span>
                      </div>
                    ) : isStrikeIssuedTonight ? (
                      <div
                        className={`${isEligibleForNagNotif ? 'flex-1' : 'w-full'} min-w-0 h-9 min-h-[36px] flex items-center justify-center gap-1.5 rounded-xl border border-status-coral/40 bg-status-coral/15 px-2.5 text-xs font-semibold text-status-coral shadow-sm`}
                        title="Automatic bedtime strike recorded for tonight."
                      >
                        <Zap className="h-3.5 w-3.5 fill-status-coral shrink-0" />
                        <span className="truncate">Strike Issued</span>
                      </div>
                    ) : state.status === 'BEDTIME_GRACE' ? (
                      <div
                        className={`${isEligibleForNagNotif ? 'flex-1' : 'w-full'} min-w-0 h-9 min-h-[36px] flex items-center justify-center gap-1.5 rounded-xl border border-night-border bg-night-elevated px-2.5 text-xs text-cream-secondary shadow-sm`}
                        title="5-minute grace period active."
                      >
                        <Clock className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">Grace: {state.graceMinutesLeft || 5}m left</span>
                      </div>
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
                      <div className="hidden flex-col gap-2 w-full md:flex">
                        <div className="flex items-center gap-2 w-full flex-wrap sm:flex-nowrap">
                          {/* Primary ☀️ I Woke Up Button */}
                          <button
                            type="button"
                            onClick={handleWakeUpClick}
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
                      <>
                        {state.isPastWakeTime && canSendPushNag ? (
                          /* 1. Wake-up reminder if past wake time */
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
                      </>
                    )}
                  </div>
                )}

                {bucket === 'AWAKE' && isViewer && (state.needsWakeUpLog || (isWokeUp && onCheckIn)) && (
                  <div className="w-full">
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
                        className="w-full min-w-0 hidden md:inline-flex items-center justify-center gap-1.5 px-2.5 py-2.5 min-h-[44px] min-w-[44px] text-xs font-bold rounded-xl border border-status-amber bg-status-amber text-night-bg hover:bg-status-amber/90 active:scale-95 transition-all shadow-sm whitespace-nowrap"
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
                        className="w-full min-w-0 hidden md:inline-flex items-center justify-center gap-1.5 px-2.5 py-2.5 min-h-[44px] min-w-[44px] text-xs font-semibold rounded-xl border border-status-amber/40 bg-status-amber/15 text-status-amber hover:bg-status-amber/25 active:scale-95 transition-all shadow-sm whitespace-nowrap"
                        title="Go to bed and turn on Sleep Shield"
                      >
                        <BedDouble className="h-3.5 w-3.5 text-status-amber shrink-0" />
                        <span className="truncate">Go to Bed</span>
                      </button>
                    )}
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
