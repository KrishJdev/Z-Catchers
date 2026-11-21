'use client';

import React, { useEffect, useState, type ReactNode } from 'react';
import { DateTime } from 'luxon';
import { FoxMascot } from '@/components/FoxMascot';

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
  title: string | null;
  instructions: string | null;
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

export function PunishmentDetails({ item, memberName, children }: {
  item: Punishment;
  memberName?: string;
  children?: ReactNode;
}) {
  const earned = DateTime.fromISO(item.earned_cycle_date, { zone: 'utc' }).toLocaleString(DateTime.DATE_MED);
  return (
    <li className="space-y-2 rounded-xl border border-night-border bg-night-elevated/65 p-3 [overflow-wrap:anywhere]">
      {memberName && <p className="font-semibold">{memberName}</p>}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        <span className="font-semibold text-status-amber">{punishmentStatus[item.status]}</span>
        <span className="text-cream-secondary">Earned <time dateTime={item.earned_cycle_date}>{earned}</time></span>
      </div>
      {item.title && <p className="text-sm font-semibold">{item.title}</p>}
      {item.instructions && <p className="whitespace-pre-wrap text-sm text-cream-secondary">{item.instructions}</p>}
      {item.completed_at && (
        <p className="text-xs text-cream-secondary">
          Completed <time dateTime={item.completed_at}>{DateTime.fromISO(item.completed_at).toLocaleString(DateTime.DATE_MED)}</time>
        </p>
      )}
      {children}
    </li>
  );
}

export function MemberPunishmentList({ memberId }: { memberId: string }) {
  const [data, setData] = useState<MemberPunishments | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/members/punishments?memberId=${encodeURIComponent(memberId)}`, {
      cache: 'no-store',
      signal: controller.signal,
    }).then(async response => {
      if (!response.ok) throw new Error('Punishments unavailable');
      const result = await response.json() as MemberPunishments;
      if (!controller.signal.aborted) setData(result);
    }).catch(() => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => controller.abort();
  }, [attempt, memberId]);

  if (failed) {
    return (
      <div className="rounded-xl border border-night-border p-4" role="status">
        <p className="text-sm text-cream-secondary">Punishments and strike progress are currently unavailable.</p>
        <button type="button" className="min-h-[44px] font-semibold text-status-amber" onClick={() => {
          setFailed(false);
          setAttempt(value => value + 1);
        }}>Retry</button>
      </div>
    );
  }
  if (!data) return <p role="status" className="p-3 text-sm text-cream-secondary">Loading punishments…</p>;

  const month = DateTime.fromISO(data.month, { zone: 'utc' }).toFormat('LLLL yyyy');
  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-night-border bg-night-elevated/65 p-3">
        <h3 className="font-semibold">{month}</h3>
        <p className="mt-1 text-sm text-cream-secondary">Monthly strikes <strong className="text-cream-primary">{data.strikes_used}</strong></p>
        <p className="text-sm text-cream-secondary">Metastrikes used {data.metastrikes_used}/3</p>
        <div className="mt-3 flex gap-1.5" aria-hidden="true">
          {Array.from({ length: data.strikes_per_punishment }, (_, index) => (
            <span key={index} className={`h-1.5 flex-1 rounded-full ${index < data.strikes_toward_next ? 'bg-status-amber' : 'bg-night-border'}`} />
          ))}
        </div>
        <p className="mt-2 text-xs text-cream-secondary">{data.strikes_toward_next} of {data.strikes_per_punishment} toward your next punishment</p>
      </section>
      <section className="space-y-2">
        <h3 className="font-semibold">Open punishments <span className="ml-1 text-sm text-status-amber">{data.open_count}</span></h3>
        {data.open_items.length ? (
          <ul className="space-y-2">{data.open_items.map(item => <PunishmentDetails key={item.id} item={item} />)}</ul>
        ) : (
          <div className="flex items-center gap-3 rounded-xl border border-night-border p-3 text-sm text-cream-secondary">
            <FoxMascot state="sleeping" size={40} className="shrink-0" />
            No open punishments.
          </div>
        )}
      </section>
      <section className="space-y-2">
        <h3 className="font-semibold">Completed history</h3>
        {data.history.length ? (
          <ul className="space-y-2">{data.history.map(item => <PunishmentDetails key={item.id} item={item} />)}</ul>
        ) : <p className="text-sm text-cream-secondary">No completed punishments yet.</p>}
      </section>
    </div>
  );
}
