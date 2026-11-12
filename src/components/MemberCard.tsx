'use client';

import React, { useState, useEffect } from 'react';
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
} from 'lucide-react';
import type { Member } from '@/lib/db';
import type { MemberState } from '@/lib/sleepEngine';
import { formatGmtOffset } from '@/lib/timezone';
import { FoxMascot } from './FoxMascot';


interface MemberCardProps {
  member: Member;
  state: MemberState;
  currentMemberId?: string | null;
  isStarred?: boolean;
  onToggleStar?: (memberId: string) => void;
  onCheckIn?: (memberId: string) => Promise<void>;
  onCancelInBed?: (memberId: string) => Promise<void>;
  isCheckingIn?: boolean;
  onVoteStrike?: (targetMemberId: string) => Promise<void>;
  onOpenMetastrike?: (member: Member, mode: 'proactive' | 'convert_retroactive') => void;
  isVotingStrike?: boolean;
  isModerator?: boolean;
  onOpenSleepCalendar?: (memberId: string) => void;
  onOpenProfile?: (memberId: string, initialTab?: 'calendar' | 'timetable') => void;
  onWakeUp?: (memberId: string, mode?: 'button' | 'manual', wokeUpTime?: string) => Promise<void>;
}

/**
 * Visual card displaying an individual community member's bedtime status,
 * streak milestone badge, live nag assist counter, and strike actions.
 *
 * @param props - Component properties for member state and interaction handlers
 * @returns Rendered member card
 */
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

  // Strikes & Metastrikes data
  const strikesUsed =
    typeof member.strikes_count === 'number'
      ? member.strikes_count
      : typeof member.strikes_used === 'number'
      ? member.strikes_used
      : 0;
  const metastrikesUsed =
    typeof member.metastrikes_count === 'number'
      ? member.metastrikes_count
      : typeof member.metastrikes_used === 'number'
      ? member.metastrikes_used
      : 0;
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
        setCardFeedback({
          type: 'error',
          text: data.message || `You already reminded ${member.discord_username} tonight.`,
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
    if (isWokeUp) {
      return {
        className: 'bg-status-amber/15 text-status-amber border border-status-amber/30',
        icon: <Sun className="h-3.5 w-3.5 shrink-0 text-status-amber" />,
        label: 'Awake',
      };
    }
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
    <div
      className={`w-full max-w-full overflow-hidden p-5 rounded-2xl bg-night-surface border transition-colors flex flex-col justify-between gap-4 ${cardBorderAndResting}`}
    >
      <div className="flex flex-col gap-3.5">
        {/* Header: Fixed avatar wrapper, consistent metadata sequence, and viewer time + pill */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {/* Avatar with fixed dimensions to prevent squishing & profile modal trigger */}
            <button
              type="button"
              onClick={handleProfileClick}
              className="relative w-11 h-11 rounded-full shrink-0 flex items-center justify-center cursor-pointer hover:ring-2 hover:ring-status-amber/50 transition-all focus:outline-none"
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

            {/* Member Info: Name (clickable profile trigger), YOU badge, Star button, Streak pill */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={handleProfileClick}
                  className="text-base font-semibold text-cream-primary truncate max-w-[120px] sm:max-w-[150px] hover:text-status-amber hover:underline transition-colors text-left cursor-pointer focus:outline-none focus:ring-1 focus:ring-status-amber/40 rounded px-0.5 -mx-0.5"
                  title={`View ${member.discord_username}'s profile, sleep calendar history & weekly timetable`}
                  aria-label={`View ${member.discord_username}'s profile`}
                >
                  {member.discord_username}
                </button>

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

                {/* Buddy Star Toggle (Meets 44x44 touch target) */}
                {onToggleStar && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      triggerHaptic(10);
                      onToggleStar(member.id);
                    }}
                    className={`min-h-[44px] min-w-[44px] -my-2.5 -mx-2 flex items-center justify-center rounded-lg transition-colors shrink-0 ${
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

              <div className="flex items-center gap-1.5 flex-wrap text-xs text-cream-secondary mt-0.5">
                <span>
                  {formattedSleeperTime} → {state.activeWakeTimeLocal || member.wake_time_local || '07:00'} ({formatGmtOffset(member.timezone)})
                </span>
                {state.isWeekendSchedule ? (
                  <span
                    className="inline-flex items-center gap-1 rounded bg-status-amber/15 px-1.5 py-0.5 text-[10px] font-semibold text-status-amber border border-status-amber/30"
                    title="Weekend bedtime schedule active (Friday/Saturday nights)"
                  >
                    <Moon className="h-2.5 w-2.5 text-status-amber" />
                    <span>Weekend</span>
                  </span>
                ) : state.isCustomScheduleToday ? (
                  <span
                    className="inline-flex items-center gap-1 rounded bg-status-amber/15 px-1.5 py-0.5 text-[10px] font-semibold text-status-amber border border-status-amber/30"
                    title={`Custom daily schedule active for ${state.dayKey ? state.dayKey.toUpperCase() : 'today'}`}
                  >
                    <Sparkles className="h-2.5 w-2.5 text-status-amber" />
                    <span>Custom today</span>
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          {/* Right Header: Bedtime in viewer timezone & status badge */}
          <div className="flex flex-col items-end shrink-0 gap-1 text-right">
            <span className="text-xl font-bold tabular-nums text-cream-primary">
              {formattedViewerTime}
            </span>
            <span
              className={`whitespace-nowrap px-2.5 py-1 text-xs rounded-full inline-flex items-center gap-1.5 ${statusPillConfig.className}`}
            >
              {statusPillConfig.icon}
              <span>{statusPillConfig.label}</span>
            </span>
          </div>
        </div>

        {/* Compact Accountability Row: Strikes & Metastrikes */}
        <div className="flex items-center justify-between rounded-xl border border-night-border bg-night-elevated/50 px-3 py-1.5 text-[11px]">
          {/* Strikes Indicator */}
          <div className="flex items-center gap-1.5" title={`${strikesUsed} of 3 monthly strikes used`}>
            <span className="font-semibold text-status-coral flex items-center gap-1">
              <Zap className="h-3 w-3 fill-status-coral text-status-coral" />
              <span>Strikes:</span>
              <span className="tabular-nums font-bold">{strikesUsed}/3</span>
            </span>
            <div className="flex items-center gap-1 ml-0.5">
              {[1, 2, 3].map((pip) => (
                <span
                  key={`strike-${member.id}-${pip}`}
                  className={`h-2 w-2 rounded-full transition-colors ${
                    pip <= strikesUsed
                      ? 'bg-status-coral ring-1 ring-status-coral/40 shadow-sm shadow-status-coral/50'
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
            <span className="font-semibold text-status-amber flex items-center gap-1">
              <Shield className="h-3 w-3 fill-status-amber/20 text-status-amber" />
              <span>Meta:</span>
              <span className="tabular-nums font-bold">{metastrikesUsed}/3</span>
            </span>
            <div className="flex items-center gap-1 ml-0.5">
              {[1, 2, 3].map((pip) => (
                <span
                  key={`meta-${member.id}-${pip}`}
                  className={`h-2 w-2 rounded-full transition-colors ${
                    pip <= metastrikesUsed
                      ? 'bg-status-amber ring-1 ring-status-amber/40 shadow-sm shadow-status-amber/50'
                      : 'bg-night-border border border-night-border/80'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Out of Strikes Sleepy Fox Alert Badge */}
        {strikesUsed >= 3 && (
          <div className="flex items-center justify-between rounded-lg border border-status-coral/40 bg-status-coral/10 px-2.5 py-1 text-[11px] font-semibold text-status-coral">
            <div className="flex items-center gap-1.5">
              <FoxMascot state="alert" size={16} />
              <span>Out of Strikes • 0 Margin Left</span>
            </div>
            <span className="text-[10px] text-cream-secondary">Resets on 1st</span>
          </div>
        )}

        {/* Pending 48-Hour Schedule Shift Cooldown Notice */}
        {pendingNotice && (
          <div className="flex items-center justify-between rounded-lg border border-dashed border-status-amber/40 bg-status-amber/10 px-3 py-1.5 text-xs tabular-nums text-status-amber">
            <span className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 shrink-0" />
              <span>{pendingNotice}</span>
            </span>
          </div>
        )}

        {/* Metastrike Active Notice (Body) */}
        {isMetastrikeActive && !isNagNow && (
          <div className="flex items-center gap-1.5 rounded-xl border border-status-amber/40 bg-status-amber/15 px-3 py-2 text-xs font-semibold text-status-amber min-h-[44px]">
            <Shield className="h-4 w-4 fill-status-amber/20 shrink-0" />
            <span>
              Metastrike Active: {member.metastrike_reason || member.tonight_strike_log?.reason || 'Excused'}
            </span>
          </div>
        )}

        {/* Safe Check-In Button for Viewer (Nag Now & Winding Down) */}
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
              className="flex h-11 min-h-[44px] min-w-[44px] w-full items-center justify-center gap-2 rounded-xl border border-status-amber/40 bg-status-amber/15 text-xs font-semibold text-status-amber transition-colors hover:bg-status-amber/25 whitespace-nowrap"
            >
              <BedDouble className="h-4 w-4 shrink-0" />
              <span>Early Bedtime Check-In</span>
            </button>
          )}

        {/* Checked-in Confirmation Banner */}
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

        {/* Checked-in Confirmation Banner for Sleeping State */}
        {(isViewer || isModerator) && isInBed && bucket === 'SLEEPING' && (
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

        {/* Viewer Self-Service Metastrike Options */}
        {isViewer && !isMetastrikeActive && metastrikesUsed < 3 && onOpenMetastrike && (
          <button
            type="button"
            onClick={() => {
              triggerHaptic(10);
              onOpenMetastrike(member, 'proactive');
            }}
            className="flex h-11 min-h-[44px] min-w-[44px] w-full items-center justify-center gap-1.5 rounded-xl border border-status-amber/40 bg-status-amber/10 px-3 text-xs font-semibold text-status-amber hover:bg-status-amber/20 transition-all whitespace-nowrap"
          >
            <Shield className="h-4 w-4 fill-status-amber/20 shrink-0" />
            <span className="truncate">Use Metastrike Tonight (Excused Pass)</span>
          </button>
        )}

        {/* Viewer Retroactive Strike Conversion */}
        {isViewer && isStrikeConvertible && metastrikesUsed < 3 && onOpenMetastrike && (
          <button
            type="button"
            onClick={() => {
              triggerHaptic(10);
              onOpenMetastrike(member, 'convert_retroactive');
            }}
            className="flex h-11 min-h-[44px] min-w-[44px] w-full items-center justify-center gap-1.5 rounded-xl border border-status-amber bg-status-amber px-3 text-xs font-bold text-night-bg shadow hover:bg-status-amber/90 transition-all whitespace-nowrap"
          >
            <RefreshCw className="h-4 w-4 shrink-0" />
            <span className="truncate">Convert Strike to Metastrike (24h Swap)</span>
          </button>
        )}

        {/* Nagged Assist Counter */}
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

        {/* Error Toast for Rollbacks */}
        {cardError && (
          <div className="rounded-lg border border-status-coral/40 bg-status-coral/10 p-2.5 text-center text-xs text-status-coral animate-fade-in break-words text-balance leading-snug">
            {cardError}
          </div>
        )}

        {/* Action Feedback Toast (Sleep Shield Notice, Success, or Rate-Limit Alert) */}
        {cardFeedback && (
          <div
            className={`rounded-lg border p-2.5 text-center text-xs font-semibold animate-fade-in break-words text-balance leading-snug ${
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
      </div>

      {/* Action Bar (Anchored to bottom via flex layout, touch targets >= 44x44px) */}
      <div className="mt-auto pt-1 w-full">
        {isNagNow && (
          <div className="flex flex-col gap-2 w-full">
            {/* Primary Action Button: Nag in Discord Journal - Normalized Full-Width, Height-Locked */}
            <a
              href={member.journal_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleNagJournalClick}
              className="w-full h-11 min-h-[44px] flex items-center justify-center gap-2 rounded-xl bg-status-coral font-semibold text-night-bg transition-all hover:bg-status-coral/90 active:scale-[0.98] text-xs sm:text-sm px-3 whitespace-nowrap shadow-sm"
            >
              <span className="truncate">{hasNagged ? 'Nagged! Reopen Journal' : 'Nag in Discord Journal'}</span>
              <ExternalLink className="h-4 w-4 shrink-0" />
            </a>

            {/* Contextual Secondary Status / Action Row: Grace / Vote Strike / Strike Issued / Metastrike */}
            <div className="flex items-center gap-2 w-full">
              {/* Nag Notif Button */}
              {isEligibleForNagNotif && (
                <button
                  type="button"
                  onClick={handleSendNagNotif}
                  disabled={isSendingNagNotif || (nagNotifSent && !isTargetShieldOn)}
                  className={`flex-1 h-9 min-h-[36px] min-w-[44px] flex items-center justify-center gap-1.5 rounded-xl px-2.5 text-xs font-semibold transition-all whitespace-nowrap ${
                    isTargetShieldOn
                      ? 'border border-status-slumber/40 bg-status-slumber/15 text-status-slumber hover:bg-status-slumber/25 active:scale-95'
                      : nagNotifSent
                      ? 'border border-status-sage/40 bg-status-sage/15 text-status-sage cursor-default'
                      : 'border border-status-coral/50 bg-status-coral/15 text-status-coral hover:bg-status-coral/25 active:scale-95'
                  }`}
                  title={
                    isTargetShieldOn
                      ? `Sleep Shield is ON for ${member.discord_username}. Tap to see shield status.`
                      : nagNotifSent
                      ? 'Bedtime reminder notification sent'
                      : `Send bedtime reminder notification to ${member.discord_username}`
                  }
                >
                  {isTargetShieldOn ? (
                    <>
                      <Shield className="h-3.5 w-3.5 fill-status-slumber/20 shrink-0" />
                      <span>Shield On</span>
                    </>
                  ) : isSendingNagNotif ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 animate-spin shrink-0" />
                      <span>Sending...</span>
                    </>
                  ) : nagNotifSent ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-status-sage shrink-0" />
                      <span>Nag Sent</span>
                    </>
                  ) : (
                    <>
                      <Bell className="h-3.5 w-3.5 shrink-0" />
                      <span>Nag Notif</span>
                    </>
                  )}
                </button>
              )}

              {/* Contextual Secondary Status / Action Pill: Grace / Vote Strike / Strike Issued / Metastrike */}
              {isMetastrikeActive ? (
                <div
                  className={`${isEligibleForNagNotif ? 'flex-1' : 'w-full'} h-9 min-h-[36px] flex items-center justify-center gap-1.5 rounded-xl border border-status-amber/40 bg-status-amber/15 px-2.5 text-xs font-semibold text-status-amber whitespace-nowrap`}
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
                  className={`${isEligibleForNagNotif ? 'flex-1' : 'w-full'} h-9 min-h-[36px] flex items-center justify-center gap-1.5 rounded-xl border border-status-coral/40 bg-status-coral/15 px-2.5 text-xs font-semibold text-status-coral whitespace-nowrap`}
                  title="2/2 community verification votes reached. Strike issued for tonight."
                >
                  <Zap className="h-3.5 w-3.5 fill-status-coral shrink-0" />
                  <span>Strike Issued</span>
                </div>
              ) : state.status === 'BEDTIME_GRACE' ? (
                <div
                  className={`${isEligibleForNagNotif ? 'flex-1' : 'w-full'} h-9 min-h-[36px] flex items-center justify-center gap-1.5 rounded-xl border border-night-border bg-night-elevated px-2.5 text-xs text-cream-secondary whitespace-nowrap`}
                  title="5-minute grace period active. Strike voting is locked."
                >
                  <Clock className="h-3.5 w-3.5 shrink-0" />
                  <span>Grace: {state.graceMinutesLeft || 5}m left</span>
                </div>
              ) : onVoteStrike && !isViewer ? (
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(15);
                    onVoteStrike(member.id);
                  }}
                  disabled={isVotingStrike || member.has_voted_strike}
                  className={`${isEligibleForNagNotif ? 'flex-1' : 'w-full'} h-9 min-h-[36px] flex items-center justify-center gap-1.5 rounded-xl px-2.5 text-xs font-semibold transition-all whitespace-nowrap ${
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
                  <span>
                    {member.has_voted_strike
                      ? `Voted (${strikeVotesCount}/2)`
                      : `Vote Strike (${strikeVotesCount}/2)`}
                  </span>
                </button>
              ) : null}
            </div>
          </div>
        )}

        {bucket === 'WINDING_DOWN' && (
          <div className="flex flex-col gap-2 w-full">
            <a
              href={member.journal_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleNagJournalClick}
              className="w-full h-11 min-h-[44px] min-w-[44px] flex items-center justify-center gap-2 rounded-xl border border-status-amber/40 bg-night-elevated font-medium text-status-amber transition-colors hover:bg-status-amber/15 active:scale-[0.98] text-xs sm:text-sm px-3 whitespace-nowrap"
            >
              <span className="truncate">{hasNagged ? 'Noted! Reopen Journal' : 'Say Goodnight in Journal'}</span>
              <ExternalLink className="h-4 w-4 shrink-0" />
            </a>

            {isEligibleForNagNotif && (
              <button
                type="button"
                onClick={handleSendNagNotif}
                disabled={isSendingNagNotif || (nagNotifSent && !isTargetShieldOn)}
                className={`w-full h-9 min-h-[36px] flex items-center justify-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition-all whitespace-nowrap ${
                  isTargetShieldOn
                    ? 'border border-status-slumber/40 bg-status-slumber/15 text-status-slumber hover:bg-status-slumber/25 active:scale-95'
                    : nagNotifSent
                    ? 'border border-status-sage/40 bg-status-sage/15 text-status-sage cursor-default'
                    : 'border border-status-amber/50 bg-status-amber/15 text-status-amber hover:bg-status-amber/25 active:scale-95'
                }`}
                title={
                  isTargetShieldOn
                    ? `Sleep Shield is ON for ${member.discord_username}. Nags muted.`
                    : nagNotifSent
                    ? 'Bedtime reminder sent'
                    : `Send bedtime reminder notification to ${member.discord_username}`
                }
              >
                {isTargetShieldOn ? (
                  <>
                    <Shield className="h-3.5 w-3.5 fill-status-slumber/20 shrink-0" />
                    <span>Shield On (Muted)</span>
                  </>
                ) : isSendingNagNotif ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin shrink-0" />
                    <span>Sending...</span>
                  </>
                ) : nagNotifSent ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-status-sage shrink-0" />
                    <span>Nag Sent</span>
                  </>
                ) : (
                  <>
                    <Bell className="h-3.5 w-3.5 shrink-0" />
                    <span>Nag Notif</span>
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
                      setOptimisticWokeUp(true);
                      setOptimisticInBed(false);
                      if (onWakeUp) {
                        await onWakeUp(member.id, 'button');
                      } else if (onCancelInBed) {
                        await onCancelInBed(member.id);
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
                      setOptimisticWokeUp(true);
                      setOptimisticInBed(false);
                      setShowManualWakeInput(false);
                      if (onWakeUp) {
                        await onWakeUp(member.id, 'manual', manualWakeTimeInput);
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
                      className="h-11 min-h-[44px] px-3.5 rounded-lg bg-status-amber text-xs font-bold text-night-bg hover:bg-status-amber/90 active:scale-95 transition-all"
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
              <div className="flex items-center gap-2 w-full">
                {(member.is_in_bed || isModerator) && onCancelInBed ? (
                  <button
                    type="button"
                    onClick={handleCancelInBedClick}
                    disabled={isCheckingIn}
                    className="flex-1 min-w-0 h-11 min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl border border-status-amber/40 bg-status-amber/15 px-2.5 text-xs font-semibold text-status-amber hover:bg-status-amber/25 active:scale-95 transition-all shadow-sm"
                    title="Wake up and undo sleep status (returns from sleeping state to awake)"
                  >
                    <Sun className="h-3.5 w-3.5 text-status-amber shrink-0" />
                    <span className="truncate">Wake Up (Undo)</span>
                  </button>
                ) : !isInBed && !isMetastrikeActive && !isViewer && onVoteStrike ? (
                  <div className="flex-1 min-w-0">
                    {isStrikeIssuedTonight ? (
                      <span className="h-11 min-h-[44px] flex items-center justify-center gap-1 rounded-xl px-2.5 text-xs font-semibold text-status-coral whitespace-nowrap">
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
                        className="w-full h-11 min-h-[44px] flex items-center justify-center gap-1 rounded-xl border border-status-coral/40 bg-status-coral/15 px-2.5 text-xs font-semibold text-status-coral hover:bg-status-coral/25 active:scale-95 transition-all"
                      >
                        <Zap className="h-3.5 w-3.5 fill-status-coral shrink-0" />
                        <span className="truncate">
                          {member.has_voted_strike
                            ? `Voted (${strikeVotesCount}/2)`
                            : `Vote Strike (${strikeVotesCount}/2)`}
                        </span>
                      </button>
                    )}
                  </div>
                ) : isTargetShieldOn && !isViewer ? (
                  <button
                    type="button"
                    onClick={handleSendNagNotif}
                    className="flex-1 min-w-0 h-11 min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl border border-status-slumber/40 bg-status-slumber/15 px-2.5 text-xs font-semibold text-status-slumber hover:bg-status-slumber/25 transition-all shadow-sm"
                    title={`Sleep Shield is ON for ${member.discord_username}. Tap to view shield status.`}
                  >
                    <Shield className="h-3.5 w-3.5 fill-status-slumber/20 shrink-0" />
                    <span className="truncate">Shield On</span>
                  </button>
                ) : null}

                {/* Leave quiet note - flex-1 min-w-0 with truncate to prevent ANY overflow */}
                <a
                  href={member.journal_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 min-w-0 h-11 min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl border border-night-border bg-night-elevated px-2.5 text-xs text-cream-secondary transition-colors hover:text-cream-primary hover:border-night-border/80 shadow-sm"
                  title="Open Discord journal to leave a quiet note"
                >
                  <span className="truncate">Leave quiet note</span>
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                </a>
              </div>
            )}
          </div>
        )}

        {bucket === 'AWAKE' && (
          <div className="flex items-center gap-2 w-full">
            {isViewer && state.needsWakeUpLog && (
              <button
                type="button"
                onClick={async () => {
                  triggerHaptic(20);
                  setOptimisticWokeUp(true);
                  if (onWakeUp) {
                    await onWakeUp(member.id, 'button');
                  }
                }}
                className="flex-1 min-w-0 h-11 min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl border border-status-amber bg-status-amber text-night-bg px-2.5 text-xs font-bold hover:bg-status-amber/90 active:scale-95 transition-all shadow-sm"
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
                className="flex-1 min-w-0 h-11 min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl border border-status-amber/40 bg-status-amber/15 px-2.5 text-xs font-semibold text-status-amber hover:bg-status-amber/25 active:scale-95 transition-all shadow-sm"
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
              className="flex-1 min-w-0 h-11 min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl border border-night-border bg-night-elevated px-3 text-xs font-medium text-cream-secondary transition-colors hover:text-cream-primary hover:border-night-border/80 ml-auto shadow-sm"
              title="Open Discord Journal"
            >
              <span className="truncate">Journal</span>
              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            </a>
          </div>
        )}
      </div>
    </div>
  );
}