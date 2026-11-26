'use client';

import React, { useEffect, useRef, useState, type FormEvent } from 'react';
import { EmptyPunishments } from './PunishmentList';
import { queueNotice } from './ModeratorQueueState';
import {
  fetchMetastrikes, moderatorMetastrikesEndpoint as endpoint, metastrikeDate, metastrikeQuotaLabel,
  metastrikeReasonError, metastrikeStatuses, metastrikeTime,
  type MetastrikePage, type MetastrikeRequestError, type StaffMetastrikeRequest,
} from '@/lib/metastrikeScreens';

const sections = [
  { filter: 'pending', title: 'Pending requests', empty: 'No pending requests.' },
  { filter: 'decided', title: 'Recent decisions', empty: 'No decisions yet.' },
] as const;

type Filter = typeof sections[number]['filter'];
type ReviewAction = 'approve' | 'decline';

const button = 'min-h-[44px] rounded-lg border border-night-border bg-night-surface px-3 py-2 text-sm font-semibold hover:border-status-amber disabled:opacity-50';

function strikeEvidence(item: StaffMetastrikeRequest) {
  if (item.strike_source_id) return 'Recorded nightly strike';
  if (item.nightly_type === 'metastrike') return 'Metastrike protection recorded';
  if (item.no_strike_confirmed) return 'No strike confirmed';
  return 'No nightly strike recorded yet';
}

export function ModeratorMetastrikeQueue({ onReviewed, onAccessChanged }: {
  onReviewed: () => void;
  onAccessChanged?: () => void;
}) {
  const [pages, setPages] = useState<Partial<Record<Filter, MetastrikePage>>>({});
  const [attempt, setAttempt] = useState(0);
  const [readError, setReadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [editor, setEditor] = useState<{ item: StaffMetastrikeRequest; action: ReviewAction } | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');
  const [busy, setBusy] = useState(false);
  const pageRequest = useRef<AbortController | null>(null);

  const refresh = () => {
    setPages({});
    setReadError('');
    setAttempt(value => value + 1);
  };

  useEffect(() => {
    const controller = new AbortController();
    Promise.all(sections.map(({ filter }) => fetchMetastrikes<MetastrikePage>(
      `${endpoint}?status=${filter}`, { signal: controller.signal },
    ))).then(([pending, decided]) => {
      if (controller.signal.aborted) return;
      setPages({ pending, decided });
    }).catch((error: MetastrikeRequestError) => {
      if (controller.signal.aborted) return;
      setReadError(error.message);
      if (error.status === 401 || error.status === 403) onAccessChanged?.();
    });
    return () => controller.abort();
  }, [attempt, onAccessChanged]);

  useEffect(() => () => pageRequest.current?.abort(), []);

  const handleAccessFailure = (error: MetastrikeRequestError) => {
    if (error.status !== 401 && error.status !== 403) return false;
    setPages({});
    setEditor(null);
    setReadError(error.message);
    setNotice('');
    onAccessChanged?.();
    return true;
  };

  const loadMore = async (filter: Filter, offset: number) => {
    if (busy || editor) return;
    setBusy(true);
    setActionError('');
    const controller = new AbortController();
    pageRequest.current = controller;
    try {
      const page = await fetchMetastrikes<MetastrikePage>(`${endpoint}?status=${filter}&offset=${offset}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setPages(previous => {
        const items = previous[filter]?.items ?? [];
        const ids = new Set(items.map(item => item.id));
        return {
          ...previous,
          ...(previous.pending && { pending: { ...previous.pending, pending_count: page.pending_count } }),
          [filter]: { ...page, items: [...items, ...page.items.filter(item => !ids.has(item.id))] },
        };
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      const failure = error as MetastrikeRequestError;
      if (!handleAccessFailure(failure)) setActionError(failure.message);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };

  const startReview = (item: StaffMetastrikeRequest, action: ReviewAction) => {
    setEditor({ item, action });
    setReason('');
    setReasonError('');
    setNotice('');
    setActionError('');
  };

  const decide = async (event: FormEvent) => {
    event.preventDefault();
    if (!editor || busy) return;
    const { item, action } = editor;
    if (action === 'decline') {
      const invalidReason = metastrikeReasonError(reason);
      setReasonError(invalidReason);
      if (invalidReason) return;
    }
    setBusy(true);
    setActionError('');
    try {
      const { item: decided } = await fetchMetastrikes<{ item: StaffMetastrikeRequest }>(endpoint, {
        body: {
          request_id: item.id,
          action,
          ...(action === 'approve' ? { expected_source_id: item.strike_source_id } : { reason: reason.trim() }),
        },
      });
      setNotice(`Request ${metastrikeStatuses[decided.status].toLowerCase()}.`);
      setEditor(null);
      refresh();
      onReviewed();
    } catch (error) {
      const failure = error as MetastrikeRequestError;
      if (!handleAccessFailure(failure)) {
        setActionError(failure.message);
        if (failure.status === 409 || failure.status === 404) {
          setEditor(null);
          refresh();
          onReviewed();
        }
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {notice && <p role="status" className="text-sm text-status-sage">{notice}</p>}
      {actionError && <p role="alert" className="text-sm text-status-coral">{actionError}</p>}
      {readError ? (
        <div role="alert" className={queueNotice}>
          <p>{readError}</p>
          <button type="button" className={button} onClick={refresh}>Retry</button>
        </div>
      ) : !pages.pending ? (
        <p role="status" className={queueNotice}>Loading Metastrikes…</p>
      ) : (
        <>
          <button type="button" className={button} onClick={refresh} disabled={busy || Boolean(editor)}>Refresh queue</button>
          {sections.map(({ filter, title, empty }) => {
            const page = pages[filter];
            if (!page) return null;
            return (
              <section key={filter} className="space-y-2">
                <h4 className="text-sm font-semibold">{title}{filter === 'pending' && ` (${page.pending_count})`}</h4>
                {page.items.length === 0 ? <EmptyPunishments>{empty}</EmptyPunishments> : (
                  <ul className="space-y-2">
                    {page.items.map(item => (
                      <li key={item.id} className="space-y-2 rounded-xl border border-night-border bg-night-elevated/65 p-3 [overflow-wrap:anywhere]">
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm font-semibold">
                          <span>{item.member_name}</span>
                          <time dateTime={item.cycle_date}>{metastrikeDate(item.cycle_date)}</time>
                          <span className="text-status-amber">{metastrikeStatuses[item.status]}</span>
                        </div>
                        <p className="whitespace-pre-wrap text-sm">{item.reason}</p>
                        <div className="space-y-1 text-xs text-cream-secondary">
                          <p>Submitted <time dateTime={item.submitted_at}>{metastrikeTime(item.submitted_at, item.timezone)}</time> · {item.timezone}</p>
                          {filter === 'pending' && (
                            <>
                              <p>{strikeEvidence(item)}{!item.member_active && ' · Inactive profile'}</p>
                              {!item.strike_source_id && !item.no_strike_confirmed && item.member_active && !item.nightly_type && (
                                <p>Cutoff <time dateTime={item.cutoff_at}>{metastrikeTime(item.cutoff_at, item.timezone)}</time></p>
                              )}
                              <p className="text-status-amber">{metastrikeQuotaLabel(item.quota)}</p>
                            </>
                          )}
                          {item.decided_at && <p>
                            Decided <time dateTime={item.decided_at}>{metastrikeTime(item.decided_at, item.timezone)}</time>
                          </p>}
                          {item.decision_reason && <p className="whitespace-pre-wrap text-sm">{item.decision_reason}</p>}
                        </div>
                        {editor?.item.id === item.id ? (
                          <form className="space-y-2" onSubmit={decide}>
                            {editor.action === 'decline' ? (
                              <>
                                <label htmlFor="metastrike-decline-reason" className="block text-sm font-semibold">Explanation for the member</label>
                                <textarea id="metastrike-decline-reason" rows={3} autoFocus value={reason} disabled={busy}
                                  aria-required="true" aria-invalid={Boolean(reasonError)}
                                  aria-describedby={reasonError ? 'metastrike-decline-error' : undefined}
                                  onChange={event => { setReason(event.target.value); setReasonError(''); }}
                                  className="w-full rounded-lg border border-night-border bg-night-surface p-3 text-sm" />
                                {reasonError && <p id="metastrike-decline-error" role="alert" className="text-sm text-status-coral">{reasonError}</p>}
                              </>
                            ) : (
                              <p className="text-sm text-cream-secondary">
                                {item.strike_source_id ? 'Approval replaces this nightly strike.'
                                  : item.no_strike_confirmed || !item.member_active || item.nightly_type === 'metastrike'
                                    ? 'This request can close without charging a pass.'
                                    : 'Approval can protect this cycle before cutoff. After cutoff, the dispatcher must confirm the outcome.'}
                              </p>
                            )}
                            <div className="flex flex-wrap gap-2">
                              <button type="submit" autoFocus={editor.action === 'approve'} disabled={busy} className={button}>
                                {busy ? 'Saving…' : editor.action === 'approve' ? 'Confirm approval' : 'Confirm decline'}
                              </button>
                              <button type="button" disabled={busy} className={button} onClick={() => setEditor(null)}>Cancel</button>
                            </div>
                          </form>
                        ) : filter === 'pending' && (
                          <div className="flex flex-wrap gap-2">
                            <button type="button" className={button} disabled={busy || Boolean(editor)} onClick={() => startReview(item, 'approve')}>Approve</button>
                            <button type="button" className={button} disabled={busy || Boolean(editor)} onClick={() => startReview(item, 'decline')}>Decline</button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {page.next_offset !== null && (
                  <button type="button" className={button} disabled={busy || Boolean(editor)}
                    onClick={() => { if (page.next_offset !== null) void loadMore(filter, page.next_offset); }}>
                    Load more {filter === 'pending' ? 'requests' : 'decisions'}
                  </button>
                )}
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
