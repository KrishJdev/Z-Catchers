'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  EmptyPunishments, PunishmentDetails, PunishmentReadNotice, punishmentStatus, type Punishment,
} from '@/components/PunishmentList';
import { readPunishmentFailure, type PunishmentReadFailure } from '@/lib/punishmentAvailability';

const sections = [
  { status: 'awaiting_assignment', title: 'Needs assignment' },
  { status: 'assigned', title: 'Assigned work' },
  { status: 'pending', title: 'Pending' },
] as const;

type QueueStatus = typeof sections[number]['status'];
type Task = Punishment & { member_name: string };
type QueuePage = { items: Task[]; next_offset: number | null };
type TaskResult = { item: Task; open_count: number };
type TaskAction = 'assign' | 'edit' | 'complete';
const endpoint = '/api/mod/punishments';
const buttonStyle = 'min-h-[44px] rounded-lg border border-night-border bg-night-surface px-3 py-2 text-sm font-semibold text-cream-primary hover:border-status-amber/50 disabled:opacity-50';

async function readQueue(status: QueueStatus, offset: number, signal: AbortSignal): Promise<
  { page: QueuePage } | { failure: PunishmentReadFailure }
> {
  try {
    const response = await fetch(`${endpoint}?status=${status}&offset=${offset}`, { signal, cache: 'no-store' });
    if (!response.ok) return { failure: await readPunishmentFailure(response) };
    const page = await response.json() as QueuePage;
    if (Array.isArray(page?.items)) return { page };
  } catch {
    // A network error or invalid JSON should offer the same retry as a failed dependency.
  }
  return { failure: 'unavailable' };
}

export function ModeratorPunishmentQueue({ onTaskChanged, onAccessChanged }: {
  onAccessChanged?: () => void;
  onTaskChanged: () => Promise<void>;
}) {
  const [pages, setPages] = useState<Partial<Record<QueueStatus, QueuePage>>>({});
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [queueFailure, setQueueFailure] = useState<PunishmentReadFailure | null>(null);
  const [pageRetry, setPageRetry] = useState<{ status: QueueStatus; offset: number } | null>(null);
  const [actionError, setActionError] = useState('');
  const [editor, setEditor] = useState<{ item: Task; action: TaskAction } | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TaskResult | null>(null);
  const resultRef = useRef<HTMLParagraphElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const queueRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<{ id: string; action: TaskAction } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setQueueFailure(null);
    setPageRetry(null);
    Promise.all(sections.map(({ status }) => readQueue(status, 0, controller.signal))).then(responses => {
      if (controller.signal.aborted) return;
      const pages: Partial<Record<QueueStatus, QueuePage>> = {};
      const failures = new Set<PunishmentReadFailure>();
      responses.forEach((response, index) => {
        if ('failure' in response) failures.add(response.failure);
        else pages[sections[index].status] = response.page;
      });

      const failureOrder = ['sign-in', 'forbidden', 'unavailable', 'closed'] as const;
      const failure = failureOrder.find(reason => failures.has(reason));
      setQueueFailure(failure ?? null);
      setPages(failure ? {} : pages);
      setLoading(false);
      if (failure === 'sign-in' || failure === 'forbidden') onAccessChanged?.();
    });
    return () => controller.abort();
  }, [attempt, onAccessChanged]);

  useEffect(() => () => requestRef.current?.abort(), []);
  useEffect(() => { if (result) resultRef.current?.focus(); }, [result]);
  useEffect(() => {
    if (editor || !returnFocus.current) return;
    const { id, action } = returnFocus.current;
    queueRef.current?.querySelector<HTMLButtonElement>(`[data-task-action="${CSS.escape(id)}-${action}"]`)?.focus();
    returnFocus.current = null;
  }, [editor]);

  const loadMore = async (status: QueueStatus, offset: number) => {
    if (busy || editor) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setBusy(true);
    setPageRetry(null);
    try {
      const response = await readQueue(status, offset, controller.signal);
      if (controller.signal.aborted) return;
      if ('failure' in response) {
        if (response.failure === 'unavailable') {
          setPageRetry({ status, offset });
        } else {
          setPages({});
          setQueueFailure(response.failure);
          if (response.failure !== 'closed') onAccessChanged?.();
        }
        return;
      }
      const { page } = response;
      setPages(previous => {
        const existing = previous[status]?.items ?? [];
        const ids = new Set(existing.map(item => item.id));
        return { ...previous, [status]: { ...page, items: [...existing, ...page.items.filter(item => !ids.has(item.id))] } };
      });
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editor || busy) return;
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setActionError('');
    try {
      const { item, action } = editor;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          punishment_id: item.id,
          ...(action !== 'complete' && { title: fields.get('title'), instructions: fields.get('instructions') }),
        }),
      });
      const data = await response.json();
      if (response.status === 401 || response.status === 403) onAccessChanged?.();
      if (!response.ok) throw new Error(data.error || 'Could not save the task.');
      setResult(data);
      setEditor(null);
      setLoading(true);
      setAttempt(value => value + 1);
      void onTaskChanged();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not save the task.');
    } finally {
      setBusy(false);
    }
  };

  const startAction = (item: Task, action: TaskAction) => {
    setEditor({ item, action });
    setActionError('');
    setResult(null);
  };

  const refreshQueue = () => {
    setLoading(true);
    setAttempt(value => value + 1);
  };
  const emptyQueue = sections.every(({ status }) =>
    pages[status]?.items.length === 0 && pages[status]?.next_offset === null);
  return (
    <div ref={queueRef} className="mt-4 space-y-5">
      {result && !queueFailure && (
        <p tabIndex={-1} ref={resultRef} role="status" className="rounded-xl border border-status-sage/40 bg-status-sage/10 p-3 text-sm [overflow-wrap:anywhere]">
          {result.item.member_name} · {result.item.title} · {punishmentStatus[result.item.status]} · {result.open_count} open
        </p>
      )}
      {loading && <p role="status" className="text-sm text-cream-secondary">Loading punishments…</p>}
      {!loading && queueFailure && <PunishmentReadNotice failure={queueFailure} onRetry={refreshQueue} />}
      {!loading && !queueFailure && (
        <button type="button" onClick={refreshQueue} disabled={busy || !!editor} className={buttonStyle}>Refresh queue</button>
      )}
      {!loading && !queueFailure && emptyQueue && <EmptyPunishments>No punishments in the queue.</EmptyPunishments>}
      {!loading && !queueFailure && !emptyQueue && sections.map(({ status, title }) => {
        const page = pages[status];
        if (!page) return null;
        return (
          <section key={status} className="space-y-2">
            <h3 className="font-semibold">{title}</h3>
            {page.items.length === 0 ? <p className="text-sm text-cream-secondary">No items.</p> : (
              <ul className="space-y-2">
                {page.items.map(item => (
                  <PunishmentDetails key={item.id} item={item} memberName={item.member_name}>
                    {editor?.item.id === item.id ? (
                      <form key={editor.action} className="space-y-3 pt-2" onSubmit={save}>
                        {editor.action === 'complete' ? (
                          <p className="text-sm">Mark this task complete?</p>
                        ) : (
                          <>
                            <label className="block text-sm">Task title
                              <input autoFocus name="title" required maxLength={120} defaultValue={item.title ?? ''}
                                className="mt-1 block min-h-[44px] w-full rounded-lg border border-night-border bg-night-surface px-3" />
                            </label>
                            <label className="block text-sm">Instructions (optional)
                              <textarea name="instructions" rows={3} maxLength={2000} defaultValue={item.instructions ?? ''}
                                className="mt-1 block w-full rounded-lg border border-night-border bg-night-surface p-3" />
                            </label>
                          </>
                        )}
                        {actionError && <p role="alert" className="text-sm text-status-coral">{actionError}</p>}
                        <div className="flex flex-wrap gap-2">
                          <button type="submit" autoFocus={editor.action === 'complete'} disabled={busy} className={buttonStyle}>
                            {busy ? 'Saving…' : editor.action === 'complete' ? 'Confirm completion' : 'Save task'}
                          </button>
                          <button type="button" disabled={busy} className={buttonStyle} onClick={() => {
                            returnFocus.current = { id: item.id, action: editor.action };
                            setEditor(null);
                          }}>Cancel</button>
                        </div>
                      </form>
                    ) : status !== 'pending' && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        <button type="button" className={buttonStyle} disabled={busy || !!editor}
                          data-task-action={`${item.id}-${status === 'assigned' ? 'edit' : 'assign'}`}
                          onClick={() => startAction(item, status === 'assigned' ? 'edit' : 'assign')}>
                          {status === 'assigned' ? 'Edit task' : 'Assign task'}
                        </button>
                        {status === 'assigned' && (
                          <button type="button" className={buttonStyle} disabled={busy || !!editor}
                            data-task-action={`${item.id}-complete`} onClick={() => startAction(item, 'complete')}>Mark complete</button>
                        )}
                      </div>
                    )}
                  </PunishmentDetails>
                ))}
              </ul>
            )}
            {pageRetry?.status === status && !editor && (
              <PunishmentReadNotice failure="unavailable" onRetry={() => void loadMore(status, pageRetry.offset)} />
            )}
            {page.next_offset !== null && pageRetry?.status !== status && (
              <button type="button" className={buttonStyle} disabled={busy || !!editor}
                onClick={() => void loadMore(status, page.next_offset!)}>Load more {title.toLowerCase()}</button>
            )}
          </section>
        );
      })}
    </div>
  );
}
