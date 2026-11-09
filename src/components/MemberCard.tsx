'use client';

import React from 'react';
import {
  ExternalLink,
  ShieldAlert,
  Sparkles,
  Moon,
  Sun,
  Star,
  CheckCircle2,
} from 'lucide-react';
import type { Member } from '@/lib/db';
import type { MemberState } from '@/lib/sleepEngine';

interface MemberCardProps {
  member: Member;
  state: MemberState;
  currentMemberId?: string | null;
  isStarred?: boolean;
  onToggleStar?: (memberId: string) => void;
  onCheckIn?: (memberId: string) => Promise<void>;
  onCancelInBed?: (memberId: string) => Promise<void>;
  isCheckingIn?: boolean;
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
}: MemberCardProps) {
  const { bucket, formattedViewerTime, formattedSleeperTime, pendingNotice, streakMilestone } = state;
  const isViewer = Boolean(currentMemberId && member.id === currentMemberId);
  const isInBed = Boolean(member.is_in_bed || state.checkedInEarly);

  // Safe fallback avatar
  const avatarUrl =
    member.avatar_url ||
    `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(member.discord_username)}`;

  // Header meta: Name, avatar, role, streak, and buddy star
  const renderHeaderLeft = () => (
    <div className="flex items-center gap-3">
      <div className="relative">
        <img
          src={avatarUrl}
          alt={member.discord_username}
          className={`h-10 w-10 rounded-full border bg-night-elevated ${
            bucket === 'BEDTIME_NOW'
              ? 'border-status-coral/40'
              : bucket === 'WINDING_DOWN'
              ? 'border-status-amber/40'
              : 'border-night-border'
          }`}
        />
        {isInBed && (
          <span
            className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-status-sage text-[9px] text-night-bg shadow"
            title="Checked into bed early"
          >
            ✓
          </span>
        )}
      </div>

      <div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-base font-semibold text-cream-primary">
            {member.discord_username}
          </span>

          {isViewer && (
            <span className="rounded bg-status-amber/20 border border-status-amber/40 px-1.5 py-0.2 text-[9px] font-bold text-status-amber">
              YOU
            </span>
          )}

          {member.role === 'moderator' && (
            <span className="rounded bg-night-elevated px-1.5 py-0.5 text-[10px] font-medium text-cream-muted">
              MOD
            </span>
          )}

          {/* Streak milestone badge */}
          {member.streak_days && member.streak_days > 0 ? (
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                streakMilestone?.color || 'text-status-amber border-status-amber/30 bg-status-amber/10'
              }`}
              title={streakMilestone?.description || `${member.streak_days} days on track`}
            >
              <span>{streakMilestone?.icon || '🔥'}</span>
              <span>{streakMilestone?.badgeLabel || `${member.streak_days}d`}</span>
            </span>
          ) : null}

          {/* Buddy Star Toggle */}
          {onToggleStar && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggleStar(member.id);
              }}
              className={`p-0.5 rounded transition-colors ${
                isStarred
                  ? 'text-status-amber hover:text-status-amber/80'
                  : 'text-cream-muted/30 hover:text-cream-secondary'
              }`}
              title={isStarred ? 'Remove from Starred Buddies' : 'Star as Accountability Buddy'}
            >
              <Star className={`h-3.5 w-3.5 ${isStarred ? 'fill-status-amber' : ''}`} />
            </button>
          )}
        </div>

        <p className="text-xs text-cream-secondary">
          {formattedSleeperTime} local ({member.timezone.split('/').pop()?.replace(/_/g, ' ')})
        </p>
      </div>
    </div>
  );

  // Bucket: BEDTIME_NOW
  if (bucket === 'BEDTIME_NOW') {
    return (
      <div className="flex h-full flex-col justify-between rounded-2xl border-2 border-status-coral/80 bg-night-surface p-4 shadow-lg shadow-status-coral/10 transition-all">
        <div>
          <div className="flex items-start justify-between gap-3">
            {renderHeaderLeft()}

            <div className="flex flex-col items-end">
              <span className="text-xl font-bold tabular-nums text-cream-primary">
                {formattedViewerTime}
              </span>
              <span className="mt-1 flex items-center gap-1 rounded-full border border-status-coral/40 bg-status-coral/20 px-2 py-0.5 text-xs font-semibold text-status-coral animate-pulse">
                <ShieldAlert className="h-3 w-3" />
                {state.statusText}
              </span>
            </div>
          </div>

          {pendingNotice && (
            <div className="mt-2.5 flex items-center justify-between rounded-lg border border-dashed border-status-amber/40 bg-status-amber/10 px-3 py-1.5 text-xs tabular-nums text-status-amber">
              <span>⏳ {pendingNotice}</span>
            </div>
          )}

          {/* "I'm in Bed" Safe Button for current user */}
          {isViewer && !isInBed && onCheckIn && (
            <button
              onClick={() => onCheckIn(member.id)}
              disabled={isCheckingIn}
              className="mt-3 flex min-h-[40px] w-full items-center justify-center gap-2 rounded-xl bg-status-amber px-3 font-bold text-night-bg shadow transition-transform hover:bg-status-amber/90 active:scale-[0.98]"
            >
              <span>🛏️ I&apos;m in Bed Now (Mute Nags)</span>
            </button>
          )}

          {isViewer && isInBed && (
            <div className="mt-2.5 flex items-center justify-between rounded-xl border border-status-sage/40 bg-status-sage/10 px-3 py-1.5 text-xs font-medium text-status-sage">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>You&apos;re checked in! Nags muted 🌙</span>
              </span>
              {onCancelInBed && (
                <button
                  onClick={() => onCancelInBed(member.id)}
                  disabled={isCheckingIn}
                  className="text-[11px] underline opacity-80 hover:opacity-100"
                >
                  Undo
                </button>
              )}
            </div>
          )}
        </div>

        <a
          href={member.journal_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3.5 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-status-coral font-semibold text-night-bg transition-opacity hover:opacity-90"
        >
          <span>Nag in Discord Journal</span>
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>
    );
  }

  // Bucket: WINDING_DOWN
  if (bucket === 'WINDING_DOWN') {
    return (
      <div className="flex h-full flex-col justify-between rounded-2xl border border-status-amber/60 bg-night-surface p-4 transition-all">
        <div>
          <div className="flex items-start justify-between gap-3">
            {renderHeaderLeft()}

            <div className="flex flex-col items-end">
              <span className="text-xl font-bold tabular-nums text-cream-primary">
                {formattedViewerTime}
              </span>
              <span className="mt-1 flex items-center gap-1 rounded-full border border-status-amber/30 bg-status-amber/15 px-2.5 py-0.5 text-xs font-medium text-status-amber">
                <Sparkles className="h-3 w-3" />
                {state.statusText}
              </span>
            </div>
          </div>

          {pendingNotice && (
            <div className="mt-2.5 flex items-center justify-between rounded-lg border border-dashed border-status-amber/40 bg-status-amber/10 px-3 py-1.5 text-xs tabular-nums text-status-amber">
              <span>⏳ {pendingNotice}</span>
            </div>
          )}

          {/* "I'm in Bed" Safe Button for current user */}
          {isViewer && !isInBed && onCheckIn && (
            <button
              onClick={() => onCheckIn(member.id)}
              disabled={isCheckingIn}
              className="mt-3 flex min-h-[40px] w-full items-center justify-center gap-2 rounded-xl bg-status-amber px-3 font-bold text-night-bg shadow transition-transform hover:bg-status-amber/90 active:scale-[0.98]"
            >
              <span>🛏️ I&apos;m in Bed (Goodnight)</span>
            </button>
          )}

          {isViewer && isInBed && (
            <div className="mt-2.5 flex items-center justify-between rounded-xl border border-status-sage/40 bg-status-sage/10 px-3 py-1.5 text-xs font-medium text-status-sage">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>You&apos;re checked in! Nags muted 🌙</span>
              </span>
              {onCancelInBed && (
                <button
                  onClick={() => onCancelInBed(member.id)}
                  disabled={isCheckingIn}
                  className="text-[11px] underline opacity-80 hover:opacity-100"
                >
                  Undo
                </button>
              )}
            </div>
          )}
        </div>

        <a
          href={member.journal_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3.5 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-status-amber/40 bg-night-elevated font-medium text-status-amber transition-colors hover:bg-status-amber/15"
        >
          <span>Say Goodnight in Journal</span>
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>
    );
  }

  // Bucket: SLEEPING
  if (bucket === 'SLEEPING') {
    return (
      <div className="flex h-full flex-col justify-between rounded-2xl border border-night-border/60 bg-night-surface/60 p-4 opacity-75 transition-opacity hover:opacity-100">
        <div>
          <div className="flex items-start justify-between gap-3">
            {renderHeaderLeft()}

            <div className="flex flex-col items-end">
              <span className="text-base font-bold tabular-nums text-cream-secondary">
                {formattedViewerTime}
              </span>
              <span className="mt-1 flex items-center gap-1 rounded-full border border-status-slumber/30 bg-status-slumber/15 px-2 py-0.5 text-[10px] text-status-slumber">
                <Moon className="h-2.5 w-2.5" />
                {isInBed ? 'In Bed (Early) 🌙' : "Catching Z's"}
              </span>
            </div>
          </div>

          {isViewer && isInBed && (
            <div className="mt-2.5 flex items-center justify-between rounded-lg border border-status-sage/30 bg-status-sage/10 px-2.5 py-1 text-[11px] text-status-sage">
              <span>Sleep Shield Active • Nags Muted</span>
              {onCancelInBed && (
                <button
                  onClick={() => onCancelInBed(member.id)}
                  disabled={isCheckingIn}
                  className="underline opacity-80 hover:opacity-100"
                >
                  Undo
                </button>
              )}
            </div>
          )}
        </div>

        <div className="mt-3 flex justify-end">
          <a
            href={member.journal_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-cream-muted transition-colors hover:text-cream-secondary"
          >
            <span>Leave quiet note</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    );
  }

  // Bucket: AWAKE
  return (
    <div className="flex h-full flex-col justify-between rounded-2xl border border-night-border bg-night-surface p-4 transition-all hover:border-night-elevated">
      <div>
        <div className="flex items-start justify-between gap-3">
          {renderHeaderLeft()}

          <div className="text-right">
            <span className="text-base font-bold tabular-nums text-cream-primary">
              {formattedViewerTime}
            </span>
            <p className="mt-0.5 flex items-center justify-end gap-1 text-[11px] tabular-nums text-cream-secondary">
              <Sun className="h-2.5 w-2.5 text-status-sage" />
              {state.statusText}
            </p>
          </div>
        </div>

        {/* If viewer is approaching bedtime (within 2h) but technically in AWAKE, allow early check-in */}
        {isViewer && !isInBed && state.diffMinutes >= -180 && state.diffMinutes < -60 && onCheckIn && (
          <button
            onClick={() => onCheckIn(member.id)}
            disabled={isCheckingIn}
            className="mt-3 flex min-h-[36px] w-full items-center justify-center gap-2 rounded-xl border border-status-amber/40 bg-status-amber/15 text-xs font-semibold text-status-amber transition-colors hover:bg-status-amber/25"
          >
            <span>🛏️ Early Bedtime Check-In</span>
          </button>
        )}
      </div>

      <div className="mt-3 flex justify-end">
        <a
          href={member.journal_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[34px] items-center gap-1 rounded-xl bg-night-elevated px-3 text-xs font-medium text-cream-secondary transition-colors hover:text-cream-primary"
          title="Open Discord Journal"
        >
          <span>Journal</span>
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}
