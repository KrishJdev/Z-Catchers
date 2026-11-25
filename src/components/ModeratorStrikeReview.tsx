'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { DateTime } from 'luxon';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { PUNISHMENT_ROLLOUT_CLOSED } from '@/lib/punishmentAvailability';

interface StrikeSource {
  source_id: string;
  source_type: 'nightly' | 'moderator';
  cycle_date: string;
  reason: string | null;
}

interface StrikeMonth {
  month: string;
  current_month: string;
  latest_cycle_date: string;
  verified_strikes: StrikeSource[];
  strikes_used: number;
  open_count: number | null;
  balance_reconciliation_required?: boolean;
}

const firstMonth = '2026-11';
const control = 'min-h-[44px] rounded-lg border border-night-border bg-night-bg px-3 text-sm text-cream-primary focus-visible:outline focus-visible:outline-status-amber disabled:opacity-50';
const monthDate = (value: string) => DateTime.fromISO(value, { zone: 'utc' });

export function ModeratorStrikeReview({ memberId, memberName, onClose, onChanged, onAccessChanged }: {
  memberId: string;
  memberName: string;
  onClose: () => void;
  onChanged: () => void;
  onAccessChanged?: () => void;
}) {
  const headingId = useId();
  const [month, setMonth] = useState('');
  const [review, setReview] = useState<StrikeMonth | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState<{ message: string; retry: boolean } | null>(null);
  const [cycleDate, setCycleDate] = useState('');
  const [reason, setReason] = useState('');
  const [removal, setRemoval] = useState<StrikeSource | null>(null);
  const [saving, setSaving] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [writeError, setWriteError] = useState('');
  const [notice, setNotice] = useState('');
  const draft = useRef<{ payload: string; id: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ view: 'strike_month', member_id: memberId });
    if (month) params.set('month', month);
    async function load() {
      try {
        const response = await fetch('/api/mod?' + params, { cache: 'no-store', signal: controller.signal });
        const data = await response.json();
        if (controller.signal.aborted) return;
        if (response.status === 401 || response.status === 403) onAccessChanged?.();
        if (response.ok) {
          setReview(data);
          return;
        }
        setReadError({
          message: data.error || 'Could not load strikes.',
          retry: data.code !== PUNISHMENT_ROLLOUT_CLOSED && response.status >= 500,
        });
      } catch {
        if (!controller.signal.aborted) setReadError({ message: 'Could not load strikes. Try again.', retry: true });
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [memberId, month, loadAttempt, onAccessChanged]);

  function resetForm() {
    setCycleDate('');
    setReason('');
    setRemoval(null);
    setWriteError('');
    setUncertain(false);
    draft.current = null;
  }

  function changeMonth(delta: number) {
    if (!review) return;
    resetForm();
    setNotice('');
    setReadError(null);
    setLoading(true);
    setMonth(monthDate(review.month).plus({ months: delta }).toFormat('yyyy-MM'));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!review || loading || readError || saving) return;
    const payload = {
      action: removal ? 'remove_strike' : 'add_strike',
      member_id: memberId,
      cycle_date: removal?.cycle_date ?? cycleDate,
      source_id: removal?.source_id ?? null,
      reason: reason.trim(),
    };
    if (!payload.cycle_date || !payload.reason) {
      setWriteError('Enter a cycle date and a reason.');
      return;
    }
    const serialized = JSON.stringify(payload);
    if (draft.current?.payload !== serialized) {
      draft.current = { payload: serialized, id: crypto.randomUUID() };
    }
    setSaving(true);
    setWriteError('');
    setNotice('');
    try {
      const response = await fetch('/api/mod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, request_id: draft.current.id }),
      });
      const data = await response.json();
      if (response.status === 401 || response.status === 403) onAccessChanged?.();
      if (!response.ok) {
        setUncertain(response.status >= 500 && data.code !== PUNISHMENT_ROLLOUT_CLOSED);
        setWriteError(data.error || 'Could not save the correction.');
        return;
      }
      setReview(data);
      resetForm();
      setNotice(removal ? 'Strike removed.' : 'Strike added.');
      onChanged();
    } catch {
      setUncertain(true);
      setWriteError('The save could not be confirmed. Retry the same correction.');
    } finally {
      setSaving(false);
    }
  }

  const locked = saving || uncertain;
  const selectedMonth = review ? monthDate(review.month) : null;
  const latestDate = review && selectedMonth && review.month !== review.current_month
    ? selectedMonth.endOf('month').toISODate() ?? undefined
    : review?.latest_cycle_date;

  return (
    <section className="mt-4 space-y-4 rounded-2xl border border-night-border bg-night-elevated p-3 sm:p-4" aria-labelledby={headingId}>
      <button autoFocus type="button" className="inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-cream-secondary hover:text-cream-primary" onClick={onClose}>
        <ArrowLeft size={16} aria-hidden="true" /> Back to roster
      </button>
      <h3 id={headingId} className="break-words font-bold text-cream-primary">Edit strikes for {memberName}</h3>
      {review && selectedMonth && (
        <div className="flex items-center justify-between gap-2">
          <button type="button" aria-label="Previous month" className={control} onClick={() => changeMonth(-1)} disabled={loading || locked || review.month === firstMonth}>
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <p className="text-center text-sm font-semibold text-cream-primary">{selectedMonth.toFormat('LLLL yyyy')}</p>
          <button type="button" aria-label="Next month" className={control} onClick={() => changeMonth(1)} disabled={loading || locked || review.month === review.current_month}>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </div>
      )}
      {loading && <p role="status" className="text-sm text-cream-secondary">Loading dated strikes…</p>}
      {readError && (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-cream-secondary">{readError.message}</p>
          {readError.retry && <button type="button" className={control} onClick={() => {
            setReadError(null);
            setLoading(true);
            setLoadAttempt(attempt => attempt + 1);
          }}>Retry</button>}
        </div>
      )}
      {review && !loading && !readError && (
        <>
          <p className="text-sm text-cream-secondary">{review.strikes_used} verified {review.strikes_used === 1 ? 'strike' : 'strikes'} this month
            {review.open_count != null && ` · ${review.open_count} open ${review.open_count === 1 ? 'punishment' : 'punishments'} across all months`}
          </p>
          {review.verified_strikes.length === 0 ? (
            <p className="text-sm text-cream-muted">No dated strikes this month.</p>
          ) : (
            <ul aria-label="Verified strike sources" className="space-y-2">
              {review.verified_strikes.map(source => (
                <li key={source.source_id} className="flex flex-wrap items-center justify-between gap-x-3 rounded-lg border border-night-border bg-night-bg p-2">
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="text-sm font-semibold text-cream-primary">
                      <time dateTime={source.cycle_date}>{monthDate(source.cycle_date).toFormat('d LLL yyyy')}</time>
                      {' · '}{source.source_type === 'nightly' ? 'Nightly strike' : 'Staff addition'}
                    </p>
                    {source.reason && <p className="break-words text-xs text-cream-secondary">{source.reason}</p>}
                  </div>
                  <button type="button" aria-label={`Select strike on ${source.cycle_date} for removal`}
                    aria-pressed={removal?.source_id === source.source_id} className={control} disabled={locked}
                    onClick={() => {
                      resetForm();
                      setNotice('');
                      setRemoval(source);
                      requestAnimationFrame(() => document.getElementById(headingId + '-reason')?.focus());
                    }}>
                    Select to remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={save} className="space-y-3 border-t border-night-border pt-3">
            <h4 className="text-sm font-semibold text-cream-primary">
              {removal ? `Remove strike from ${monthDate(removal.cycle_date).toFormat('d LLL yyyy')}` : 'Add a strike'}
            </h4>
            {!removal && <label className="block space-y-1 text-sm text-cream-secondary">
              <span>Sleep-cycle date</span>
              <input type="date" required value={cycleDate} min={review.month + '-01'} max={latestDate}
                disabled={locked} onChange={event => setCycleDate(event.target.value)} className={control + ' block w-full min-w-0 [color-scheme:dark]'} />
            </label>}
            <label className="block space-y-1 text-sm text-cream-secondary">
              <span>Correction reason</span>
              <textarea id={headingId + '-reason'} required maxLength={500} rows={2} value={reason} disabled={locked}
                onChange={event => setReason(event.target.value)} className={control + ' block w-full resize-y py-2'} />
            </label>
            {writeError && <p role="alert" className="break-words text-sm text-status-coral">{writeError}</p>}
            {notice && <p role="status" className="text-sm text-status-sage">{notice}</p>}
            {notice && review.balance_reconciliation_required && (
              <p role="alert" className="text-sm text-status-amber">The legacy strike balance needs reconciliation.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={saving} className="min-h-[44px] rounded-lg bg-status-amber px-3 text-sm font-bold text-night-bg disabled:opacity-50">
                {saving ? 'Saving…' : uncertain ? 'Retry save' : removal ? 'Remove strike' : 'Add strike'}
              </button>
              {removal && !locked && <button type="button" className={control} onClick={resetForm}>Cancel removal</button>}
            </div>
          </form>
        </>
      )}
    </section>
  );
}
