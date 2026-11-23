import { DateTime } from 'luxon';
import { toValidLuxonZone } from '@/lib/timezone';

export type StrikeHistoryEntry = {
  source_id: string;
  cycle_date: string;
  record_type: 'strike' | 'metastrike';
  source_type: 'nightly' | 'moderator';
  issued_at: string | null;
  issuance_timezone: string | null;
  recorded_at: string | null;
  changed_at: string | null;
  replacement_until: string | null;
  counts: boolean;
  status: 'counted' | 'replaced' | 'removed' | 'protected' | 'reversed';
  replaced_strike: boolean;
};

export type StrikeHistoryMonth = {
  month: string;
  timezone: string;
  entries: StrikeHistoryEntry[];
};

const STATUS_LABELS: Record<StrikeHistoryEntry['status'], string> = {
  counted: 'Strike counts',
  replaced: 'Strike replaced',
  removed: 'Strike removed',
  protected: 'Metastrike applied',
  reversed: 'Metastrike reversed',
};

export function StrikeHistoryList({ days, loading, failed, onRetry, onSelectDay }: {
  days: ReadonlyMap<string, StrikeHistoryEntry[]>;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  onSelectDay: (date: string) => void;
}) {
  return (
    <section aria-labelledby="strike-history-title" className="rounded-2xl border border-night-border/90 bg-night-elevated/70 p-3.5 sm:p-4">
      <h3 id="strike-history-title" className="text-sm font-bold text-cream-primary">Strike history</h3>
      {loading ? <p role="status" className="mt-2 text-xs text-cream-secondary">Loading strike history…</p>
        : failed ? (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 text-xs">
            <p role="status" className="text-cream-secondary">Strike history is unavailable.</p>
            <button type="button" onClick={onRetry} className="min-h-[44px] font-semibold text-status-amber underline">
              Retry strike history
            </button>
          </div>
        ) : days.size === 0 ? (
          <p className="mt-2 text-xs text-cream-secondary">No recorded strikes or Metastrikes this month.</p>
        ) : (
          <ul className="mt-2 divide-y divide-night-border/70">
            {Array.from(days, ([date, entries]) => (
              <li key={date}>
                <button type="button" onClick={() => onSelectDay(date)}
                  className="flex min-h-[44px] w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md px-1 py-2 text-left text-xs hover:bg-night-surface">
                  <span className="font-semibold text-cream-primary">{DateTime.fromISO(date).toFormat('LLL d')}</span>
                  <span className="text-cream-secondary">
                    {Array.from(new Set(entries.map(entry => STATUS_LABELS[entry.status]))).join(' · ')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}

function formatTimestamp(value: string, zone: string) {
  const timestamp = DateTime.fromISO(value, { setZone: true });
  const local = timestamp.setZone(toValidLuxonZone(zone));
  const display = local.isValid ? local : timestamp.toUTC();
  return `${display.toFormat('LLL d, yyyy · h:mm a ZZZZ')} (${local.isValid ? zone : 'UTC'})`;
}

export function StrikeDayDetails({ entries, timezone }: { entries: StrikeHistoryEntry[]; timezone: string }) {
  return (
    <section aria-label="Strike details" className="border-t border-night-border/60 pt-3">
      <h3 className="text-xs font-bold text-cream-primary">Strike details</h3>
      <ul className="mt-2 grid gap-2">
        {entries.map(entry => {
          const isPass = entry.record_type === 'metastrike';
          const source = isPass
            ? (entry.replaced_strike ? 'Metastrike replacement' : entry.issuance_timezone ? 'Bedtime protection' : 'Metastrike pass')
            : (entry.source_type === 'moderator' ? 'Staff correction' : 'Nightly strike');
          const zone = entry.issuance_timezone ?? timezone;
          return (
            <li key={`${entry.source_id}:${entry.record_type}`}
              className="min-w-0 rounded-lg border border-night-border/80 bg-night-surface/60 px-3 py-2 text-xs text-cream-secondary [overflow-wrap:anywhere]">
              <p className="font-semibold text-cream-primary">{STATUS_LABELS[entry.status]} · {source}</p>
              {!isPass && <p className="mt-1">{entry.counts ? 'Counts toward punishments.' : 'No longer counts toward punishments.'}</p>}
              <p className="mt-1">
                {entry.issued_at
                  ? `${isPass ? 'Applied' : 'Issued'} ${formatTimestamp(entry.issued_at, zone)}`
                  : 'Issuance time unavailable'}
              </p>
              {entry.recorded_at && <p className="mt-1">Correction recorded {formatTimestamp(entry.recorded_at, timezone)}</p>}
              {entry.changed_at && <p className="mt-1">Changed {formatTimestamp(entry.changed_at, zone)}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
