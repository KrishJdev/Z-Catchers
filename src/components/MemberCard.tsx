'use client';

import React from 'react';
import { ExternalLink, ShieldAlert, Sparkles, Moon, Sun, Clock } from 'lucide-react';
import type { Member } from '@/lib/db';
import type { MemberState } from '@/lib/sleepEngine';

interface MemberCardProps {
  member: Member;
  state: MemberState;
}

export function MemberCard({ member, state }: MemberCardProps) {
  const { bucket, formattedViewerTime, formattedSleeperTime, pendingNotice } = state;

  // Safe fallback avatar
  const avatarUrl =
    member.avatar_url ||
    `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(member.discord_username)}`;

  // Bucket-specific rendering
  if (bucket === 'BEDTIME_NOW') {
    return (
      <div className="rounded-2xl border-2 border-status-coral/80 bg-night-surface p-4 shadow-lg shadow-status-coral/10 transition-all">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <img
              src={avatarUrl}
              alt={member.discord_username}
              className="h-10 w-10 rounded-full border border-status-coral/40 bg-night-elevated"
            />
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-base font-semibold text-cream-primary">
                  {member.discord_username}
                </span>
                {member.role === 'moderator' && (
                  <span className="rounded bg-night-elevated px-1.5 py-0.5 text-[10px] font-medium text-cream-muted">
                    MOD
                  </span>
                )}
              </div>
              <p className="text-xs text-cream-secondary">
                {formattedSleeperTime} local ({member.timezone.split('/').pop()?.replace('_', ' ')})
              </p>
            </div>
          </div>

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

        <a
          href={member.journal_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-status-coral font-semibold text-night-bg transition-opacity hover:opacity-90"
        >
          <span>Nag in Discord Journal</span>
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>
    );
  }

  if (bucket === 'WINDING_DOWN') {
    return (
      <div className="rounded-2xl border border-status-amber/60 bg-night-surface p-4 transition-all">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <img
              src={avatarUrl}
              alt={member.discord_username}
              className="h-10 w-10 rounded-full border border-status-amber/40 bg-night-elevated"
            />
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-base font-semibold text-cream-primary">
                  {member.discord_username}
                </span>
                {member.role === 'moderator' && (
                  <span className="rounded bg-night-elevated px-1.5 py-0.5 text-[10px] font-medium text-cream-muted">
                    MOD
                  </span>
                )}
              </div>
              <p className="text-xs text-cream-secondary">
                {formattedSleeperTime} local ({member.timezone.split('/').pop()?.replace('_', ' ')})
              </p>
            </div>
          </div>

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

        <a
          href={member.journal_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-status-amber/40 bg-night-elevated font-medium text-status-amber transition-colors hover:bg-status-amber/15"
        >
          <span>Say Goodnight in Journal</span>
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>
    );
  }

  if (bucket === 'SLEEPING') {
    return (
      <div className="rounded-2xl border border-night-border/60 bg-night-surface/60 p-3.5 opacity-60 transition-opacity hover:opacity-90">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <img
              src={avatarUrl}
              alt={member.discord_username}
              className="h-9 w-9 rounded-full border border-night-border bg-night-elevated"
            />
            <div>
              <span className="text-sm font-medium text-cream-primary">
                {member.discord_username}
              </span>
              <p className="text-[11px] text-cream-muted">
                {formattedSleeperTime} local ({member.timezone.split('/').pop()?.replace('_', ' ')})
              </p>
            </div>
          </div>

          <div className="flex flex-col items-end">
            <span className="text-base font-bold tabular-nums text-cream-secondary">
              {formattedViewerTime}
            </span>
            <span className="mt-0.5 flex items-center gap-1 rounded-full border border-status-slumber/30 bg-status-slumber/15 px-2 py-0.5 text-[10px] text-status-slumber">
              <Moon className="h-2.5 w-2.5" />
              Catching Z&apos;s • Shield Active
            </span>
          </div>
        </div>

        <div className="mt-2.5 flex justify-end">
          <a
            href={member.journal_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-cream-muted transition-colors hover:text-cream-secondary"
          >
            <span>Leave quiet note in Journal</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    );
  }

  // AWAKE state
  return (
    <div className="rounded-2xl border border-night-border bg-night-surface p-3.5 transition-all">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <img
            src={avatarUrl}
            alt={member.discord_username}
            className="h-9 w-9 rounded-full border border-night-border bg-night-elevated"
          />
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium text-cream-primary">
                {member.discord_username}
              </span>
              {member.role === 'moderator' && (
                <span className="rounded bg-night-elevated px-1.5 py-0.5 text-[9px] font-medium text-cream-muted">
                  MOD
                </span>
              )}
            </div>
            <p className="text-[11px] text-cream-secondary">
              {formattedSleeperTime} local ({member.timezone.split('/').pop()?.replace('_', ' ')})
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <span className="text-base font-bold tabular-nums text-cream-primary">
              {formattedViewerTime}
            </span>
            <p className="text-[11px] tabular-nums text-cream-secondary flex items-center justify-end gap-1">
              <Sun className="h-2.5 w-2.5 text-status-sage" />
              {state.statusText}
            </p>
          </div>

          <a
            href={member.journal_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[36px] items-center gap-1 rounded-lg bg-night-elevated px-2.5 text-xs font-medium text-cream-secondary transition-colors hover:text-cream-primary"
            title="Open Discord Journal"
          >
            <span>Journal</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    </div>
  );
}
