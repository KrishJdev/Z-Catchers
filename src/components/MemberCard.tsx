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
}: MemberCardProps) {
  const { bucket, formattedViewerTime, formattedSleeperTime, pendingNotice, streakMilestone } = state;
  const isViewer = Boolean(currentMemberId && member.id === currentMemberId);

  // Optimistic UI state for "I'm In Bed" check-in
  const [optimisticInBed, setOptimisticInBed] = useState<boolean | null>(null);
  const isInBed = optimisticInBed !== null ? optimisticInBed : Boolean(member.is_in_bed || state.checkedInEarly);

  // Local Nag Assist State with optimistic increment & rollback
  const [localNagCount, setLocalNagCount] = useState<number>(member.nag_assists_count || 0);
  const [hasNagged, setHasNagged] = useState(false);

  // Subtle alert message for rollbacks
  const [cardError, setCardError] = useState<string | null>(null);

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
  }, [member.nag_assists_count, member.is_in_bed, state.checkedInEarly]);

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
    setCardError(null);
    try {
      await onCheckIn(member.id);
    } catch {
      setOptimisticInBed(false);
      setCardError('Check-in failed. Reverting status.');
      setTimeout(() => setCardError(null), 3000);
    }
  };

  // Optimistic Cancel "I'm in Bed" action
  const handleCancelInBedClick = async () => {
    triggerHaptic(15);
    if (!onCancelInBed) return;
    setOptimisticInBed(false);
    setCardError(null);
    try {
      await onCancelInBed(member.id);
    } catch {
      setOptimisticInBed(true);
      setCardError('Failed to cancel check-in.');
      setTimeout(() => setCardError(null), 3000);
    }
  };

  // Safe fallback avatar
  const avatarUrl =
    member.avatar_url ||
    `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(member.discord_username)}`;

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

  // Single-line, non-wrapping status pill configuration
  const getStatusPillConfig = () => {
    if (isNagNow) {
      const isGrace = state.status === 'BEDTIME_GRACE' || bucket === 'BEDTIME_GRACE';
      const label = isGrace
        ? `${state.graceMinutesLeft || 5}m grace`
        : `${Math.max(1, Math.floor(state.diffMinutes))}m overdue`;
      return {
        className: 'bg-[#E07A5F]/15 text-[#E07A5F]',
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
        className: 'bg-[#261E1A] text-cream-muted',
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
      className: 'bg-[#261E1A] text-cream-muted',
      icon: <Sun className="h-3.5 w-3.5 shrink-0 text-cream-muted" />,
      label,
    };
  };

  const statusPillConfig = getStatusPillConfig();

  // Subtle border and resting opacity variations anchored to #1A1412
  let cardBorderAndResting = 'border-[#2C221E]';
  if (isNagNow) {
    cardBorderAndResting = 'border-[#E07A5F]/40 shadow-sm shadow-[#E07A5F]/5';
  } else if (bucket === 'WINDING_DOWN') {
    cardBorderAndResting = 'border-[#F4A261]/30';
  } else if (bucket === 'SLEEPING') {
    cardBorderAndResting = 'border-[#2C221E] opacity-85 hover:opacity-100';
  } else {
    cardBorderAndResting = 'border-[#2C221E] hover:border-[#382C27]';
  }

  return (
    <div
      className={`w-full p-5 rounded-2xl bg-[#1A1412] border transition-colors flex flex-col justify-between gap-4 ${cardBorderAndResting}`}
    >
      <div className="flex flex-col gap-3.5">
        {/* Header: Fixed avatar wrapper, consistent metadata sequence, and viewer time + pill */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {/* Avatar with fixed dimensions to prevent squishing */}
            <div className="relative w-11 h-11 rounded-full shrink-0 flex items-center justify-center">
              <img
                src={avatarUrl}
                alt={member.discord_username}
                className="w-11 h-11 rounded-full object-cover border border-[#2C221E] bg-[#261E1A]"
              />
              {isInBed && (
                <span
                  className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#F4A261] text-[#120F0D] shadow font-bold"
                  title="Checked into bed"
                >
                  <Check className="h-2.5 w-2.5 stroke-[3]" />
                </span>
              )}
            </div>

            {/* Member Info: Name, YOU badge, Star button, Streak pill in exact same position */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span
                  className="text-base font-semibold text-[#F5EBE1] truncate max-w-[120px] sm:max-w-[150px]"
                  title={member.discord_username}
                >
                  {member.discord_username}
                </span>

                {isViewer && (
                  <span className="rounded bg-[#F4A261]/20 border border-[#F4A261]/40 px-1.5 py-0.5 text-[9px] font-bold text-[#F4A261] shrink-0">
                    YOU
                  </span>
                )}

                {member.role === 'moderator' && (
                  <span className="rounded bg-[#261E1A] border border-[#2C221E] px-1.5 py-0.5 text-[9px] font-medium text-[#A89F91] shrink-0">
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
                        ? 'text-[#F4A261] hover:text-[#F4A261]/80'
                        : 'text-[#A89F91]/40 hover:text-[#A89F91]'
                    }`}
                    title={isStarred ? 'Remove from Starred Buddies' : 'Star as Accountability Buddy'}
                    aria-label={isStarred ? 'Remove from Starred Buddies' : 'Star as Accountability Buddy'}
                  >
                    <Star className={`h-4 w-4 ${isStarred ? 'fill-[#F4A261]' : ''}`} />
                  </button>
                )}

                {/* Streak milestone badge */}
                {member.streak_days && member.streak_days > 0 ? (
                  <span
                    className="inline-flex items-center gap-1 rounded-full border border-[#F4A261]/30 bg-[#F4A261]/10 px-2 py-0.5 text-[10px] font-semibold text-[#F4A261] shrink-0"
                    title={streakMilestone?.description || `${member.streak_days} days on track`}
                  >
                    <Flame className="h-3 w-3 fill-[#F4A261] text-[#F4A261]" />
                    <span>{streakMilestone?.badgeLabel || `${member.streak_days}d`}</span>
                  </span>
                ) : null}
              </div>

              <div className="flex items-center gap-1.5 flex-wrap text-xs text-[#A89F91] mt-0.5">
                <span>
                  {formattedSleeperTime} local ({formatGmtOffset(member.timezone)})
                </span>
                {state.isWeekendSchedule && (
                  <span
                    className="inline-flex items-center gap-1 rounded bg-[#F4A261]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#F4A261] border border-[#F4A261]/30"
                    title="Weekend bedtime schedule active (Friday/Saturday nights)"
                  >
                    <Moon className="h-2.5 w-2.5 text-[#F4A261]" />
                    <span>Weekend</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right Header: Bedtime in viewer timezone & status badge */}
          <div className="flex flex-col items-end shrink-0 gap-1 text-right">
            <span className="text-xl font-bold tabular-nums text-[#F5EBE1]">
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
        <div className="flex items-center justify-between rounded-xl border border-[#2C221E] bg-[#261E1A]/50 px-3 py-1.5 text-[11px]">
          {/* Strikes Indicator */}
          <div className="flex items-center gap-1.5" title={`${strikesUsed} of 3 monthly strikes used`}>
            <span className="font-semibold text-[#E07A5F] flex items-center gap-1">
              <Zap className="h-3 w-3 fill-[#E07A5F] text-[#E07A5F]" />
              <span>Strikes:</span>
              <span className="tabular-nums font-bold">{strikesUsed}/3</span>
            </span>
            <div className="flex items-center gap-1 ml-0.5">
              {[1, 2, 3].map((pip) => (
                <span
                  key={`strike-${member.id}-${pip}`}
                  className={`h-2 w-2 rounded-full transition-colors ${
                    pip <= strikesUsed
                      ? 'bg-[#E07A5F] ring-1 ring-[#E07A5F]/40 shadow-sm shadow-[#E07A5F]/50'
                      : 'bg-[#2C221E] border border-[#382C27]'
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
            <span className="font-semibold text-[#F4A261] flex items-center gap-1">
              <Shield className="h-3 w-3 fill-[#F4A261]/20 text-[#F4A261]" />
              <span>Meta:</span>
              <span className="tabular-nums font-bold">{metastrikesUsed}/3</span>
            </span>
            <div className="flex items-center gap-1 ml-0.5">
              {[1, 2, 3].map((pip) => (
                <span
                  key={`meta-${member.id}-${pip}`}
                  className={`h-2 w-2 rounded-full transition-colors ${
                    pip <= metastrikesUsed
                      ? 'bg-[#F4A261] ring-1 ring-[#F4A261]/40 shadow-sm shadow-[#F4A261]/50'
                      : 'bg-[#2C221E] border border-[#382C27]'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Out of Strikes Sleepy Fox Alert Badge */}
        {strikesUsed >= 3 && (
          <div className="flex items-center justify-between rounded-lg border border-[#E07A5F]/40 bg-[#E07A5F]/10 px-2.5 py-1 text-[11px] font-semibold text-[#E07A5F]">
            <div className="flex items-center gap-1.5">
              <FoxMascot state="alert" size={16} />
              <span>Out of Strikes • 0 Margin Left</span>
            </div>
            <span className="text-[10px] text-[#A89F91]">Resets on 1st</span>
          </div>
        )}

        {/* Pending 48-Hour Schedule Shift Cooldown Notice */}
        {pendingNotice && (
          <div className="flex items-center justify-between rounded-lg border border-dashed border-[#F4A261]/40 bg-[#F4A261]/10 px-3 py-1.5 text-xs tabular-nums text-[#F4A261]">
            <span className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 shrink-0" />
              <span>{pendingNotice}</span>
            </span>
          </div>
        )}

        {/* Metastrike Active Notice (Body) */}
        {isMetastrikeActive && !isNagNow && (
          <div className="flex items-center gap-1.5 rounded-xl border border-[#F4A261]/40 bg-[#F4A261]/15 px-3 py-2 text-xs font-semibold text-[#F4A261] min-h-[44px]">
            <Shield className="h-4 w-4 fill-[#F4A261]/20 shrink-0" />
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
            className="flex min-h-[44px] min-w-[44px] w-full items-center justify-center gap-2 rounded-xl bg-[#F4A261] px-3 font-bold text-[#120F0D] shadow transition-transform hover:bg-[#F4A261]/90 active:scale-[0.98]"
          >
            <BedDouble className="h-4 w-4" />
            <span>{isNagNow ? "I'm in Bed Now (Mute Nags)" : "I'm in Bed (Goodnight)"}</span>
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
              className="flex min-h-[44px] min-w-[44px] w-full items-center justify-center gap-2 rounded-xl border border-[#F4A261]/40 bg-[#F4A261]/15 text-xs font-semibold text-[#F4A261] transition-colors hover:bg-[#F4A261]/25"
            >
              <BedDouble className="h-4 w-4" />
              <span>Early Bedtime Check-In</span>
            </button>
          )}

        {/* Checked-in Confirmation Banner */}
        {isViewer && isInBed && (isNagNow || bucket === 'WINDING_DOWN') && (
          <div className="flex items-center justify-between rounded-xl border border-[#F4A261]/30 bg-[#F4A261]/10 px-3 py-2 text-xs font-medium text-[#F4A261] min-h-[44px]">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>You&apos;re checked in! Nags muted</span>
            </span>
            {onCancelInBed && (
              <button
                onClick={handleCancelInBedClick}
                disabled={isCheckingIn}
                className="text-xs underline opacity-80 hover:opacity-100 min-h-[44px] min-w-[44px] flex items-center justify-end"
              >
                Undo
              </button>
            )}
          </div>
        )}

        {/* Checked-in Confirmation Banner for Sleeping State */}
        {isViewer && isInBed && bucket === 'SLEEPING' && (
          <div className="flex items-center justify-between rounded-xl border border-[#2C221E] bg-[#261E1A] px-3 py-2 text-xs text-[#C8B6A6] min-h-[44px]">
            <span className="flex items-center gap-1.5">
              <Shield className="h-4 w-4 text-[#C8B6A6] shrink-0" />
              <span>Sleep Shield Active • Nags Muted</span>
            </span>
            {onCancelInBed && (
              <button
                onClick={handleCancelInBedClick}
                disabled={isCheckingIn}
                className="underline opacity-80 hover:opacity-100 min-h-[44px] min-w-[44px] flex items-center justify-end"
              >
                Undo
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
            className="flex min-h-[44px] min-w-[44px] w-full items-center justify-center gap-1.5 rounded-xl border border-[#F4A261]/40 bg-[#F4A261]/10 px-3 py-2 text-xs font-semibold text-[#F4A261] hover:bg-[#F4A261]/20 transition-all"
          >
            <Shield className="h-4 w-4 fill-[#F4A261]/20 shrink-0" />
            <span>Use Metastrike Tonight (Excused Pass)</span>
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
            className="flex min-h-[44px] min-w-[44px] w-full items-center justify-center gap-1.5 rounded-xl border border-[#F4A261] bg-[#F4A261] px-3 py-2 text-xs font-bold text-[#120F0D] shadow hover:bg-[#F4A261]/90 transition-all"
          >
            <RefreshCw className="h-4 w-4 shrink-0" />
            <span>Convert Strike to Metastrike (24h Swap)</span>
          </button>
        )}

        {/* Nagged Assist Counter */}
        {isNagNow && localNagCount > 0 && (
          <div className="flex items-center gap-1.5 rounded-xl border border-[#E07A5F]/30 bg-[#E07A5F]/10 px-3 py-2 text-xs font-semibold text-[#E07A5F] min-h-[40px]">
            <Users className="h-4 w-4 shrink-0" />
            <span>
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
          <div className="rounded-lg border border-status-coral/40 bg-status-coral/10 p-2 text-center text-xs text-status-coral animate-fade-in">
            {cardError}
          </div>
        )}
      </div>

      {/* Action Bar (Anchored to bottom via flex layout, touch targets >= 44x44px) */}
      <div className="mt-auto pt-1">
        {isNagNow && (
          <div className="flex items-center gap-2 flex-wrap">
            {/* Primary Action Button: Nag in Discord Journal */}
            <a
              href={member.journal_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleNagJournalClick}
              className="flex-1 min-h-[44px] min-w-[44px] flex items-center justify-center gap-2 rounded-xl bg-[#E07A5F] font-semibold text-[#120F0D] transition-all hover:bg-[#E07A5F]/90 active:scale-[0.98] text-xs sm:text-sm px-3"
            >
              <span>{hasNagged ? 'Nagged! Reopen Journal' : 'Nag in Discord Journal'}</span>
              <ExternalLink className="h-4 w-4 shrink-0" />
            </a>

            {/* Secondary Action Pill: Metastrike / Strike Issued / Grace / Vote Strike */}
            {isMetastrikeActive ? (
              <div
                className="flex items-center gap-1.5 rounded-xl border border-[#F4A261]/40 bg-[#F4A261]/15 px-3 py-2 text-xs font-semibold text-[#F4A261] min-h-[44px]"
                title={`Protected tonight: ${
                  member.metastrike_reason || member.tonight_strike_log?.reason || 'Excused'
                }`}
              >
                <Shield className="h-3.5 w-3.5 fill-[#F4A261]/20 shrink-0" />
                <span className="truncate max-w-[130px]">
                  Metastrike Active: {member.metastrike_reason || member.tonight_strike_log?.reason || 'Excused'}
                </span>
              </div>
            ) : isStrikeIssuedTonight ? (
              <div
                className="flex items-center gap-1.5 rounded-xl border border-[#E07A5F]/40 bg-[#E07A5F]/15 px-3 py-2 text-xs font-semibold text-[#E07A5F] min-h-[44px]"
                title="2/2 community verification votes reached. Strike issued for tonight."
              >
                <Zap className="h-3.5 w-3.5 fill-[#E07A5F] shrink-0" />
                <span>Strike Issued</span>
              </div>
            ) : state.status === 'BEDTIME_GRACE' ? (
              <div
                className="flex items-center gap-1.5 rounded-xl border border-[#2C221E] bg-[#261E1A] px-2.5 py-2 text-xs text-[#A89F91] min-h-[44px]"
                title="5-minute grace period active. Strike voting is locked."
              >
                <Clock className="h-3.5 w-3.5 shrink-0" />
                <span>Grace: {state.graceMinutesLeft || 5}m left</span>
              </div>
            ) : (
              onVoteStrike &&
              !isViewer && (
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(15);
                    onVoteStrike(member.id);
                  }}
                  disabled={isVotingStrike || member.has_voted_strike}
                  className={`flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all min-h-[44px] min-w-[44px] ${
                    member.has_voted_strike
                      ? 'border border-[#E07A5F]/30 bg-[#261E1A] text-[#E07A5F]/60 cursor-not-allowed'
                      : 'border border-[#E07A5F]/50 bg-[#E07A5F]/15 text-[#E07A5F] hover:bg-[#E07A5F]/25 active:scale-95'
                  }`}
                  title={
                    member.has_voted_strike
                      ? 'You have already voted to strike this member tonight'
                      : 'Vote to verify bedtime missed (2 community votes needed)'
                  }
                >
                  <Zap className="h-3.5 w-3.5 fill-[#E07A5F] shrink-0" />
                  <span>
                    {member.has_voted_strike
                      ? `Voted (${strikeVotesCount}/2)`
                      : `Vote Strike (${strikeVotesCount}/2)`}
                  </span>
                </button>
              )
            )}
          </div>
        )}

        {bucket === 'WINDING_DOWN' && (
          <a
            href={member.journal_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleNagJournalClick}
            className="w-full min-h-[44px] min-w-[44px] flex items-center justify-center gap-2 rounded-xl border border-[#F4A261]/40 bg-[#261E1A] font-medium text-[#F4A261] transition-colors hover:bg-[#F4A261]/15 active:scale-[0.98] text-xs sm:text-sm px-3"
          >
            <span>{hasNagged ? 'Noted! Reopen Journal' : 'Say Goodnight in Journal'}</span>
            <ExternalLink className="h-4 w-4" />
          </a>
        )}

        {bucket === 'SLEEPING' && (
          <div className="flex items-center justify-between gap-2 w-full">
            {!isInBed && !isMetastrikeActive && !isViewer && onVoteStrike ? (
              <div>
                {isStrikeIssuedTonight ? (
                  <span className="text-xs font-semibold text-[#E07A5F] flex items-center gap-1 min-h-[44px]">
                    <Zap className="h-3.5 w-3.5 fill-[#E07A5F]" />
                    <span>Strike Issued</span>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic(15);
                      onVoteStrike(member.id);
                    }}
                    disabled={isVotingStrike || member.has_voted_strike}
                    className="text-xs font-medium text-[#E07A5F] hover:underline flex items-center gap-1 min-h-[44px] min-w-[44px]"
                  >
                    <Zap className="h-3.5 w-3.5 fill-[#E07A5F]" />
                    <span>
                      {member.has_voted_strike
                        ? `Voted (${strikeVotesCount}/2)`
                        : `Vote Strike (${strikeVotesCount}/2)`}
                    </span>
                  </button>
                )}
              </div>
            ) : (
              <div />
            )}

            <a
              href={member.journal_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-xl border border-[#2C221E] bg-[#261E1A] px-3.5 py-1.5 text-xs text-[#A89F91] transition-colors hover:text-[#F5EBE1] hover:border-[#2C221E]/80 ml-auto"
            >
              <span>Leave quiet note</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        )}

        {bucket === 'AWAKE' && (
          <div className="flex items-center justify-end w-full">
            <a
              href={member.journal_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-xl border border-[#2C221E] bg-[#261E1A] px-3.5 py-1.5 text-xs font-medium text-[#A89F91] transition-colors hover:text-[#F5EBE1] hover:border-[#2C221E]/80"
              title="Open Discord Journal"
            >
              <span>Journal</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
