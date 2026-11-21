'use client';

import React, { useLayoutEffect, useRef, useState } from 'react';
import { BedDouble, Clock, RotateCcw, Sun } from 'lucide-react';
import type { Member } from '@/lib/db';
import { computeMemberState } from '@/lib/sleepEngine';
import { ResponsiveDialog } from '@/components/ResponsiveDialog';

export interface PinnedSelfActionBarProps {
  currentUser: Member;
  onCheckIn: (memberId: string) => Promise<boolean>;
  onWakeUp: (
    memberId: string, mode?: 'button' | 'manual', wokeUpTime?: string,
    cycleDate?: string, expectedInBedAt?: string | null
  ) => Promise<boolean>;
  onCancelInBed: (memberId: string) => Promise<boolean>;
  isCheckingIn: boolean;
}

const secondary = 'flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-xl border border-night-border bg-night-elevated px-2 py-2 text-xs font-semibold text-cream-primary disabled:opacity-50';
const primary = 'flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-xl bg-status-amber px-3 py-2 text-xs font-bold text-night-bg disabled:opacity-50';

export function PinnedSelfActionBar({ currentUser, onCheckIn, onWakeUp, onCancelInBed, isCheckingIn }: PinnedSelfActionBarProps) {
  const [draft, setDraft] = useState<{ time: string; checkedInAt: string | null } | null>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const focusStatus = useRef(false);
  const [wakeError, setWakeError] = useState(false);
  const state = computeMemberState(currentUser, currentUser.timezone);
  const canLogWake = state.needsWakeUpLog || (currentUser.is_in_bed && !currentUser.is_woke_up);
  const draftMatches = canLogWake && draft?.checkedInAt === (currentUser.in_bed_at ?? null);
  const closeWakeDialog = (restoreToStatus = !draftMatches) => {
    focusStatus.current = restoreToStatus;
    setDraft(null);
  };

  useLayoutEffect(() => {
    if (!draft && focusStatus.current) {
      statusRef.current?.focus();
      focusStatus.current = false;
    }
  }, [draft]);

  const canCheckIn = state.isOverdue || state.bucket === 'WINDING_DOWN' ||
    state.hasLoggedWakeUp || (state.bucket === 'AWAKE' && state.diffMinutes >= -180 && state.diffMinutes < 0);

  return (
    <div role="region" aria-label="Quick Check-In Bar"
      className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-night-border bg-night-surface/95 px-3 py-2 backdrop-blur-md md:bottom-0">
      <div className="mx-auto flex max-w-7xl flex-col gap-2 md:flex-row md:items-center md:justify-between md:px-3">
        <p ref={statusRef} tabIndex={-1} className="text-xs text-cream-secondary">
          {state.statusText}
          {!canLogWake && <span className="ml-2 text-cream-primary">Bedtime {state.activeBedtimeLocal}</span>}
        </p>
        {canLogWake ? (
          <div className="grid grid-cols-3 gap-1.5 md:flex md:gap-2">
            <button type="button" className={primary} disabled={isCheckingIn} onClick={() => void onWakeUp(currentUser.id, 'button', undefined, undefined, currentUser.in_bed_at ?? null)}>
              <Sun className="h-4 w-4 shrink-0" aria-hidden="true" /> I woke up
            </button>
            <button type="button" className={secondary} disabled={isCheckingIn} onClick={() => {
              setWakeError(false);
              setDraft({ time: state.activeWakeTimeLocal || '07:30', checkedInAt: currentUser.in_bed_at ?? null });
            }} aria-haspopup="dialog">
              <Clock className="h-4 w-4 shrink-0" aria-hidden="true" /> Enter wake time
            </button>
            <button type="button" className={secondary} disabled={isCheckingIn} onClick={() => void onCancelInBed(currentUser.id)}>
              <RotateCcw className="h-4 w-4 shrink-0" aria-hidden="true" /> Undo check-in
            </button>
          </div>
        ) : canCheckIn && (
          <button type="button" className={primary} disabled={isCheckingIn} onClick={() => void onCheckIn(currentUser.id)}>
            <BedDouble className="h-4 w-4" aria-hidden="true" />
            {state.hasLoggedWakeUp && state.bucket === 'AWAKE' ? 'Back to bed' : 'I’m in bed'}
          </button>
        )}
      </div>

      {draft && (
        <ResponsiveDialog labelledBy="manual-wake-title" onClose={() => closeWakeDialog()}
          className="p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:max-w-sm">
          <h2 id="manual-wake-title" className="font-bold">Enter wake time</h2>
          <form className="mt-3 space-y-3" onSubmit={async event => {
            event.preventDefault();
            if (isCheckingIn || !draftMatches || !draft.time) return;
            setWakeError(false);
            if (await onWakeUp(currentUser.id, 'manual', draft.time, undefined, draft.checkedInAt)) closeWakeDialog(true);
            else setWakeError(true);
          }}>
            <label className="block text-sm text-cream-secondary">Wake time ({currentUser.timezone})
              <input type="time" autoFocus required value={draft.time} onChange={event => setDraft({ ...draft, time: event.target.value })}
                className="mt-1 block min-h-[44px] w-full rounded-xl border border-night-border bg-night-elevated px-3 text-cream-primary" />
            </label>
            {!draftMatches && !isCheckingIn ? (
              <p role="status" className="text-sm text-status-amber">This check-in changed. Close the form and reopen it from the current check-in.</p>
            ) : wakeError && (
              <p role="alert" className="text-sm text-status-coral">Could not log your wake time. Check the time and retry.</p>
            )}
            <div className="flex gap-2">
              <button type="submit" disabled={isCheckingIn || !draftMatches} className={primary}>{isCheckingIn ? 'Saving…' : 'Save wake time'}</button>
              <button type="button" disabled={isCheckingIn} className={secondary} onClick={() => closeWakeDialog()}>Cancel</button>
            </div>
          </form>
        </ResponsiveDialog>
      )}
    </div>
  );
}
