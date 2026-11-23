'use client';

import React, { useEffect, useState } from 'react';
import type { Member } from '@/lib/db';
import {
  fetchMetastrikes, memberMetastrikesEndpoint, metastrikeDate, metastrikeQuotaLabel,
  metastrikeStatuses, metastrikeTime, type MemberMetastrikes, type MetastrikeRequestError,
} from '@/lib/metastrikeScreens';

export function MemberMetastrikeHistory({ month, member, refreshVersion, onChanged }: {
  month: string;
  member: Member | null | undefined;
  refreshVersion: number;
  onChanged?: () => Promise<void>;
}) {
  const [data, setData] = useState<MemberMetastrikes | null>(null);
  const [readError, setReadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const endpoint = `${memberMetastrikesEndpoint}?month=${encodeURIComponent(month)}`;

  useEffect(() => {
    const controller = new AbortController();
    fetchMetastrikes<MemberMetastrikes>(endpoint, { signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted) return;
        setData(result);
        setReadError('');
      })
      .catch((error: MetastrikeRequestError) => {
        if (controller.signal.aborted) return;
        setData(null);
        setReadError(error.message);
      });
    return () => controller.abort();
  }, [endpoint, member, refreshVersion, attempt]);

  const withdraw = async (id: string) => {
    if (busyId) return;
    setBusyId(id);
    setActionError('');
    setNotice('');
    try {
      await fetchMetastrikes(memberMetastrikesEndpoint, { body: { action: 'withdraw', request_id: id } });
      setNotice('Request withdrawn. Your reserved slot is available again.');
      setAttempt(value => value + 1);
      void onChanged?.();
    } catch (error) {
      const failure = error as MetastrikeRequestError;
      setActionError(failure.message);
      if ([401, 403, 404, 409].includes(failure.status)) {
        setData(null);
        setAttempt(value => value + 1);
        if (failure.status === 409) void onChanged?.();
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section aria-labelledby="member-metastrike-history" className="space-y-2">
      <h3 id="member-metastrike-history" className="text-sm font-bold">Metastrike requests</h3>
      {notice && <p role="status" className="text-sm text-status-sage">{notice}</p>}
      {actionError && !readError && <p role="alert" className="text-sm text-status-coral">{actionError}</p>}
      {readError ? (
        <div role="alert" className="text-sm text-status-coral">
          <p>{readError}</p>
          <button type="button" className="min-h-[44px] font-semibold text-status-amber"
            onClick={() => { setReadError(''); setAttempt(value => value + 1); }}>Retry</button>
        </div>
      ) : !data ? (
        <p role="status" className="text-sm text-cream-secondary">Loading Metastrike requests…</p>
      ) : (
        <>
          <p className="text-xs font-semibold text-status-amber">{metastrikeQuotaLabel(data.quota)}</p>
          {data.items.length === 0 ? (
            <p className="text-sm text-cream-secondary">No requests for this month.</p>
          ) : (
            <ul className="space-y-2">
              {data.items.map(item => (
                <li key={item.id} className="space-y-1 rounded-xl border border-night-border bg-night-elevated/65 p-3 [overflow-wrap:anywhere]">
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm font-semibold">
                    <time dateTime={item.cycle_date}>{metastrikeDate(item.cycle_date)}</time>
                    <span className="text-status-amber">{metastrikeStatuses[item.status]}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-cream-primary">{item.reason}</p>
                  {item.decision_reason && <p className="whitespace-pre-wrap text-sm text-cream-secondary">{item.decision_reason}</p>}
                  {item.decided_at && <p className="text-xs text-cream-secondary">
                    <time dateTime={item.decided_at}>{metastrikeTime(item.decided_at, item.timezone)}</time>
                  </p>}
                  {item.status === 'pending' && (
                    <button type="button" disabled={Boolean(busyId)} onClick={() => void withdraw(item.id)}
                      className="min-h-[44px] rounded-lg border border-night-border bg-night-surface px-3 text-sm font-semibold disabled:opacity-50">
                      {busyId === item.id ? 'Withdrawing…' : 'Withdraw request'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
