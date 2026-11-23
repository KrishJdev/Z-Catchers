'use client';

import React, { useEffect, useRef, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { FoxMascot } from '@/components/FoxMascot';
import { ResponsiveDialog } from '@/components/ResponsiveDialog';
import {
  fetchMetastrikes, memberMetastrikesEndpoint, metastrikeDate, metastrikeQuotaLabel,
  metastrikeReasonError, MetastrikeRequestError, unavailableNights, type MemberMetastrikes,
} from '@/lib/metastrikeScreens';

export function MetastrikeModal({ initialCycle, isOwner, onClose, onSuccess }: {
  initialCycle?: string;
  isOwner: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [data, setData] = useState<MemberMetastrikes | null>(null);
  const [cycle, setCycle] = useState<string | undefined>(initialCycle);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const pending = useRef<{ cycle_date: string; reason: string; request_id: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoadError('');
    fetchMetastrikes<MemberMetastrikes>(memberMetastrikesEndpoint, { signal: controller.signal })
      .then(window => {
        if (controller.signal.aborted) return;
        setData(window);
        setCycle(previous => window.choices.some(choice => choice.cycle_date === previous) ? previous
          : window.choices.find(choice => choice.cycle_date === window.current_cycle && !choice.unavailable_reason)?.cycle_date
            ?? window.choices.find(choice => !choice.unavailable_reason)?.cycle_date
            ?? window.current_cycle);
      })
      .catch((error: MetastrikeRequestError) => {
        if (!controller.signal.aborted) setLoadError(error.message);
      });
    return () => controller.abort();
  }, [attempt]);

  const selected = data?.choices.find(choice => choice.cycle_date === cycle);
  const reload = () => {
    setData(null);
    setAttempt(value => value + 1);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || selected.unavailable_reason || busy || !data?.submissions_open) return;
    setSubmitError('');
    const invalidReason = metastrikeReasonError(reason);
    setReasonError(invalidReason);
    if (invalidReason) return;

    const trimmed = reason.trim();
    if (pending.current?.cycle_date !== selected.cycle_date || pending.current.reason !== trimmed) {
      pending.current = { cycle_date: selected.cycle_date, reason: trimmed, request_id: crypto.randomUUID() };
    }
    setBusy(true);
    try {
      await fetchMetastrikes(memberMetastrikesEndpoint, { body: { action: 'submit', ...pending.current } });
      setSubmitted(true);
      onSuccess();
    } catch (error) {
      if (error instanceof MetastrikeRequestError) {
        setSubmitError(error.message);
        if (error.status === 409) reload();
        if (error.status === 401 || error.status === 403) {
          setData(null);
          setLoadError(error.message);
        }
      } else {
        setSubmitError('Could not submit the request. Try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <ResponsiveDialog labelledBy="metastrike-request-title" onClose={busy ? () => {} : onClose}
      className="max-h-[90dvh] space-y-4 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:max-w-lg md:p-6">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="shrink-0"><FoxMascot state="lantern" size={40} /></span>
        <h2 id="metastrike-request-title" className="flex-1 text-lg font-bold">Request Metastrike</h2>
        <button type="button" onClick={onClose} disabled={busy} aria-label="Close"
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border border-night-border text-cream-secondary">
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      {!data && !loadError && <p role="status" className="text-sm text-cream-secondary">Loading sleep cycles…</p>}
      {loadError && (
        <div role="alert" className="text-sm text-status-coral">
          <p>{loadError}</p>
          <button type="button" className="min-h-[44px] font-semibold text-status-amber" onClick={reload}>Retry</button>
        </div>
      )}
      {submitError && !loadError && <p role="alert" className="text-sm text-status-coral">{submitError}</p>}

      {submitted && (
        <div className="space-y-3">
          <p role="status" className="text-sm text-status-sage">Metastrike request sent for review.</p>
          <button type="button" onClick={onClose} autoFocus
            className="min-h-[44px] rounded-lg bg-status-amber px-4 py-2 text-sm font-bold text-night-bg">Done</button>
        </div>
      )}
      {data && !submitted && (
        <form onSubmit={submit} className="space-y-3">
          {data.submissions_open ? (
            <p className="text-sm text-cream-secondary">A pending request reserves a slot. The pass takes effect after approval.</p>
          ) : (
            <p role="status" className="text-sm text-cream-secondary">
              {isOwner ? 'Owner requests require an authorized operator review.' : 'Metastrike requests are closed for now.'}
            </p>
          )}
          <label htmlFor="metastrike-cycle" className="block text-sm font-semibold">
            Sleep-cycle date <span className="font-normal text-cream-secondary">({data.timezone})</span>
          </label>
          <select id="metastrike-cycle" value={cycle ?? ''} disabled={busy} onChange={event => {
            setCycle(event.target.value);
            setSubmitError('');
          }} aria-describedby="metastrike-quota"
            className="min-h-[44px] w-full rounded-lg border border-night-border bg-night-elevated px-2 text-sm">
            {data.choices.map(choice => (
              <option key={choice.cycle_date} value={choice.cycle_date}>
                {metastrikeDate(choice.cycle_date)}
                {choice.cycle_date === data.current_cycle ? ' · Current cycle' : ''}
                {choice.unavailable_reason ? ` · ${unavailableNights[choice.unavailable_reason]}` : ''}
              </option>
            ))}
          </select>
          {selected && <p id="metastrike-quota" aria-live="polite" className="text-sm font-semibold text-status-amber">
            {metastrikeQuotaLabel(selected.quota)}
          </p>}
          {data.submissions_open && (
            <>
              {selected?.unavailable_reason && <p role="status" className="text-sm text-cream-secondary">
                {unavailableNights[selected.unavailable_reason]}. Choose an available cycle to send a request.
              </p>}
              <label htmlFor="metastrike-reason" className="block text-sm font-semibold">Reason</label>
              <textarea id="metastrike-reason" rows={3} value={reason} disabled={busy} aria-required="true"
                aria-invalid={Boolean(reasonError)} aria-describedby={reasonError ? 'metastrike-reason-error' : undefined}
                onChange={event => {
                  setReason(event.target.value);
                  setReasonError('');
                }} className="w-full rounded-lg border border-night-border bg-night-elevated p-3 text-sm" />
              {reasonError && <p id="metastrike-reason-error" role="alert" className="text-sm text-status-coral">{reasonError}</p>}
              <button type="submit" disabled={busy || !selected || Boolean(selected.unavailable_reason)}
                className="min-h-[44px] rounded-lg bg-status-amber px-4 py-2 text-sm font-bold text-night-bg disabled:opacity-50">
                {busy ? 'Sending…' : 'Send request'}
              </button>
            </>
          )}
        </form>
      )}
    </ResponsiveDialog>
  );
}
