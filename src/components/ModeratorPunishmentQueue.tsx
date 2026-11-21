'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { PunishmentDetails, punishmentStatus, type Punishment } from '@/components/PunishmentList';

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

async function readQueue(status: QueueStatus, offset: number, headers: HeadersInit, signal?: AbortSignal): Promise<QueuePage> {
  const response = await fetch(`${endpoint}?status=${status}&offset=${offset}`, { headers, signal, cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not load punishments.');
  return data;
}

export function ModeratorPunishmentQueue({ passcode, onTaskChanged }: {
  passcode: string;
  onTaskChanged: () => Promise<void>;
}) {
  const [pages, setPages] = useState<Partial<Record<QueueStatus, QueuePage>>>({});
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [queueError, setQueueError] = useState('');
  const [actionError, setActionError] = useState('');
  const [editor, setEditor] = useState<{ item: Task; action: TaskAction } | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TaskResult | null>(null);
  const resultRef = useRef<HTMLParagraphElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const editorTrigger = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const headers = passcode ? { 'x-mod-passcode': passcode } : undefined;
    setLoading(true);
    setQueueError('');
    Promise.all(sections.map(async ({ status }) => [
      status, await readQueue(status, 0, headers ?? {}, controller.signal),
    ] as const)).then(entries => {
      if (!controller.signal.aborted) setPages(Object.fromEntries(entries));
    }).catch(error => {
      if (!controller.signal.aborted) setQueueError(error.message);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [attempt, passcode]);

  useEffect(() => () => requestRef.current?.abort(), []);
  useEffect(() => { if (result) resultRef.current?.focus(); }, [result]);

  const loadMore = async (status: QueueStatus, offset: number) => {
    const controller = new AbortController();
    requestRef.current = controller;
    setBusy(true);
    setQueueError('');
    try {
      const page = await readQueue(status, offset, passcode ? { 'x-mod-passcode': passcode } : {}, controller.signal);
      setPages(previous => {
        const existing = previous[status]?.items ?? [];
        const ids = new Set(existing.map(item => item.id));
        return { ...previous, [status]: { ...page, items: [...existing, ...page.items.filter(item => !ids.has(item.id))] } };
      });
    } catch (error) {
      if (!controller.signal.aborted) setQueueError(error instanceof Error ? error.message : 'Could not load more punishments.');
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
        headers: { 'Content-Type': 'application/json', ...(passcode && { 'x-mod-passcode': passcode }) },
        body: JSON.stringify({
          action,
          punishment_id: item.id,
          ...(action !== 'complete' && { title: fields.get('title'), instructions: fields.get('instructions') }),
        }),
      });
      const data = await response.json();
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

  const startAction = (trigger: HTMLButtonElement, item: Task, action: TaskAction) => {
    editorTrigger.current = trigger;
    setEditor({ item, action });
    setActionError('');
    setResult(null);
  };

  return (
    <div className="mt-4 space-y-5">
      {result && (
        <p tabIndex={-1} ref={resultRef} role="status" className="rounded-xl border border-status-sage/40 bg-status-sage/10 p-3 text-sm [overflow-wrap:anywhere]">
          {result.item.member_name} · {result.item.title} · {punishmentStatus[result.item.status]} · {result.open_count} open
        </p>
      )}
      {queueError && <p role="alert" className="text-sm text-status-coral">{queueError}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => setAttempt(value => value + 1)} disabled={loading || busy || !!editor}
          className={buttonStyle}>Refresh queue</button>
        {loading && <span role="status" className="text-sm text-cream-secondary">Loading punishments…</span>}
      </div>
      {!loading && !queueError && sections.map(({ status, title }) => {
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
                            setEditor(null);
                            requestAnimationFrame(() => editorTrigger.current?.focus());
                          }}>Cancel</button>
                        </div>
                      </form>
                    ) : status !== 'pending' && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        <button type="button" className={buttonStyle} disabled={busy || !!editor}
                          onClick={event => startAction(event.currentTarget, item, status === 'assigned' ? 'edit' : 'assign')}>
                          {status === 'assigned' ? 'Edit task' : 'Assign task'}
                        </button>
                        {status === 'assigned' && (
                          <button type="button" className={buttonStyle} disabled={busy || !!editor}
                            onClick={event => startAction(event.currentTarget, item, 'complete')}>Mark complete</button>
                        )}
                      </div>
                    )}
                  </PunishmentDetails>
                ))}
              </ul>
            )}
            {page.next_offset !== null && (
              <button type="button" className={buttonStyle} disabled={busy || !!editor}
                onClick={() => void loadMore(status, page.next_offset!)}>Load more {title.toLowerCase()}</button>
            )}
          </section>
        );
      })}
    </div>
  );
}
