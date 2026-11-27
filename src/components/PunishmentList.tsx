'use client';

import React, { useEffect, useState, type ReactNode } from 'react';
import { DateTime } from 'luxon';
import { FoxMascot } from '@/components/FoxMascot';
import { ModerationMemberName } from './ModerationMemberName';
import { readPunishmentFailure, type PunishmentReadFailure } from '@/lib/punishmentAvailability';
import { getPunishmentDeadlineState } from '@/lib/sleepEngine';
import type { Member } from '@/lib/db';

export const punishmentStatus = {
  pending: 'Pending',
  awaiting_assignment: 'Awaiting assignment',
  assigned: 'Assigned',
  completed: 'Completed',
  canceled: 'Canceled',
};

export interface Punishment {
  id: string;
  status: keyof typeof punishmentStatus;
  earned_cycle_date: string;
  completed_at: string | null;
  due_at?: string | null;
  member_timezone?: string;
  title: string | null;
  instructions: string | null;
  metastrike_hold?: boolean;
}

interface MemberPunishments {
  month: string;
  strikes_used: number;
  strikes_toward_next: number;
  strikes_per_punishment: number;
  metastrikes_used: number;
  open_count: number;
  open_items: Punishment[];
  history: Punishment[];
}

export function PunishmentDetails({ item, memberName, memberHandle, children }: {
  item: Punishment;
  memberName?: string;
  memberHandle?: string | null;
  children?: ReactNode;
}) {
  const [, refreshDeadline] = useState(0);
  const { due_at: dueAt, member_timezone: timezone, status } = item;
  const due = getPunishmentDeadlineState(dueAt, timezone);
  const overdue = status === 'assigned' && due?.overdue;

  useEffect(() => {
    if (status !== 'assigned' || !dueAt) return;
    let timer: ReturnType<typeof setTimeout>;
    function updateAtDeadline() {
      const deadline = getPunishmentDeadlineState(dueAt, timezone);
      if (!deadline) return;
      if (deadline.overdue) refreshDeadline(value => value + 1);
      else timer = setTimeout(updateAtDeadline, Math.min(deadline.remainingMs, 2147483647));
    }
    updateAtDeadline();
    return () => clearTimeout(timer);
  }, [status, dueAt, timezone]);

  const earned = DateTime.fromISO(item.earned_cycle_date, { zone: 'utc' }).toLocaleString(DateTime.DATE_MED);
  return (
    <li className="space-y-2 rounded-xl border border-night-border bg-night-elevated/65 p-3 [overflow-wrap:anywhere]">
      {memberName && <p className="font-semibold"><ModerationMemberName name={memberName} handle={memberHandle} /></p>}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        <span className="font-semibold text-status-amber">{punishmentStatus[item.status]}</span>
        <span className="text-cream-secondary">Earned <time dateTime={item.earned_cycle_date}>{earned}</time></span>
      </div>
      {item.metastrike_hold && (
        <p className="text-sm text-status-amber">
          {item.status === 'assigned' ? 'Completion on hold for Metastrike review.' : 'Assignment on hold for Metastrike review.'}
        </p>
      )}
      {item.title && <p className="text-sm font-semibold">{item.title}</p>}
      {item.instructions && <p className="whitespace-pre-wrap text-sm text-cream-secondary">{item.instructions}</p>}
      {due ? (
        <p className={overdue ? 'text-sm font-semibold text-status-coral' : 'text-sm text-cream-secondary'}>
          {overdue ? 'Overdue · due ' : 'Due '}
          <time dateTime={dueAt ?? undefined}>{due.label}</time>
        </p>
      ) : item.status === 'assigned' ? <p className="text-sm text-cream-secondary">No deadline set</p> : null}
      {item.completed_at && (
        <p className="text-xs text-cream-secondary">
          Completed <time dateTime={item.completed_at}>{DateTime.fromISO(item.completed_at).toLocaleString(DateTime.DATE_MED)}</time>
        </p>
      )}
      {children}
    </li>
  );
}

const readFailureMessages: Record<PunishmentReadFailure, string> = {
  closed: 'Punishments are closed for now.',
  unavailable: 'Could not load punishments. Try again.',
  'sign-in': 'Sign in with your linked Discord account to view punishments.',
  forbidden: 'Your account does not have access to these punishments.',
};

export function PunishmentReadNotice({ failure, onRetry }: {
  failure: PunishmentReadFailure;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-xl border border-night-border p-4" role={failure === 'unavailable' ? 'alert' : 'status'}>
      <p className="text-sm text-cream-secondary">{readFailureMessages[failure]}</p>
      {failure === 'unavailable' && (
        <button type="button" className="min-h-[44px] font-semibold text-status-amber" onClick={onRetry}>Retry</button>
      )}
    </div>
  );
}

export function EmptyPunishments({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-night-border p-3 text-sm text-cream-secondary">
      <span aria-hidden="true" className="shrink-0"><FoxMascot state="sleeping" size={40} /></span>
      <p>{children}</p>
    </div>
  );
}

export function MemberPunishmentList({ memberId, rosterMember, accountabilityRevision }: {
  memberId: string;
  rosterMember?: Member | null;
  accountabilityRevision?: number;
}) {
  const [data, setData] = useState<MemberPunishments | null>(null);
  const [failure, setFailure] = useState<PunishmentReadFailure | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/members/punishments?memberId=${encodeURIComponent(memberId)}`, {
      cache: 'no-store',
      signal: controller.signal,
    }).then(async response => {
      if (!response.ok) {
        const reason = await readPunishmentFailure(response);
        if (!controller.signal.aborted) setFailure(reason);
        return;
      }
      const result = await response.json() as MemberPunishments;
      if (!Array.isArray(result?.open_items) || !Array.isArray(result.history)) {
        throw new Error('Invalid punishments response');
      }
      if (!controller.signal.aborted) {
        setData(result);
        setFailure(null);
      }
    }).catch(() => {
      if (!controller.signal.aborted) setFailure('unavailable');
    });
    return () => controller.abort();
  }, [attempt, memberId, rosterMember, accountabilityRevision]);

  if (failure) {
    return <PunishmentReadNotice failure={failure} onRetry={() => {
      setFailure(null);
      setAttempt(value => value + 1);
    }} />;
  }
  if (!data) return <p role="status" className="p-3 text-sm text-cream-secondary">Loading punishments…</p>;

  const month = DateTime.fromISO(data.month, { zone: 'utc' }).toFormat('LLLL yyyy');
  return (
    <div className="space-y-5">
      <section aria-labelledby="monthly-punishment-progress" className="max-w-xl rounded-xl bg-night-elevated p-3.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 id="monthly-punishment-progress" className="text-sm font-semibold">Monthly progress</h3>
          <p className="text-xs text-cream-secondary">{month}</p>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-cream-secondary tabular-nums">
          <p>Monthly strikes <strong className="text-cream-primary">{data.strikes_used}</strong></p>
          <p>Metastrikes used <strong className="text-cream-primary">{data.metastrikes_used}/3</strong></p>
        </div>
        <div className="mt-2 flex gap-1.5" aria-hidden="true">
          {Array.from({ length: data.strikes_per_punishment }, (_, index) => (
            <span key={index} className={`h-1.5 flex-1 rounded-full ${index < data.strikes_toward_next ? 'bg-status-amber' : 'bg-night-border'}`} />
          ))}
        </div>
        <p className="mt-2 text-xs text-cream-secondary">{data.strikes_toward_next} of {data.strikes_per_punishment} toward your next punishment</p>
      </section>
      <section aria-labelledby="open-punishments" className="space-y-2">
        <h3 id="open-punishments" className="text-sm font-semibold">Open punishments <span className="ml-1 tabular-nums text-status-amber">{data.open_count}</span></h3>
        {data.open_items.length ? (
          <ul className="space-y-2">{data.open_items.map(item => <PunishmentDetails key={item.id} item={item} />)}</ul>
        ) : (
          <EmptyPunishments>No open punishments.</EmptyPunishments>
        )}
      </section>
      <section aria-labelledby="completed-punishments" className="space-y-2 border-t border-night-border pt-3">
        <h3 id="completed-punishments" className="text-sm font-semibold">Completed history</h3>
        {data.history.length ? (
          <ul className="space-y-2">{data.history.map(item => <PunishmentDetails key={item.id} item={item} />)}</ul>
        ) : <p className="text-sm text-cream-secondary">No completed punishments yet.</p>}
      </section>
    </div>
  );
}
