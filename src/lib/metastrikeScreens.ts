import { DateTime } from 'luxon';

export const memberMetastrikesEndpoint = '/api/members/strikes/metastrike/requests';
export const moderatorMetastrikesEndpoint = '/api/mod/metastrikes';

export const metastrikeStatuses = {
  pending: 'Pending',
  approved: 'Approved',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
  closed: 'Closed',
};

export type MetastrikeQuota = { month: string; used: number; reserved: number; remaining: number };

export const unavailableNights = {
  submissions_closed: 'Requests are closed',
  pass_exists: 'Already protected',
  pending_request: 'Request pending',
  nightly_strike_required: 'No recorded nightly strike',
  no_strike: 'No strike to excuse',
  quota_full: 'Monthly quota full',
};

type MetastrikeChoice = {
  cycle_date: string;
  quota: MetastrikeQuota;
  unavailable_reason: keyof typeof unavailableNights | null;
};

export type MetastrikeRequest = {
  id: string;
  cycle_date: string;
  reason: string;
  timezone: string;
  submitted_at: string;
  status: keyof typeof metastrikeStatuses;
  decided_at: string | null;
  decision_reason: string | null;
};

export type MemberMetastrikes = {
  items: MetastrikeRequest[];
  choices: MetastrikeChoice[];
  submissions_open: boolean;
  current_cycle: string;
  timezone: string;
  quota: MetastrikeQuota;
};

export type StaffMetastrikeRequest = MetastrikeRequest & {
  member_name: string;
  member_active: boolean;
  cutoff_at: string;
  nightly_type: 'strike' | 'metastrike' | 'pending_vote' | null;
  strike_source_id: string | null;
  no_strike_confirmed: boolean;
  quota: MetastrikeQuota;
};

export type MetastrikePage = {
  items: StaffMetastrikeRequest[];
  pending_count: number;
  next_offset: number | null;
};

export function metastrikeDate(date: string) {
  return DateTime.fromISO(date, { zone: 'utc' }).toLocaleString(DateTime.DATE_MED_WITH_WEEKDAY);
}

export function metastrikeTime(instant: string, timezone: string) {
  return DateTime.fromISO(instant, { zone: timezone }).toLocaleString(DateTime.DATETIME_MED_WITH_WEEKDAY);
}

export function metastrikeQuotaLabel(quota: MetastrikeQuota) {
  const month = DateTime.fromISO(quota.month, { zone: 'utc' }).toFormat('LLLL yyyy');
  return `${month} · ${quota.used} used · ${quota.reserved} reserved · ${quota.remaining} remaining`;
}

export function metastrikeReasonError(reason: string) {
  const length = Array.from(reason.trim()).length;
  return length >= 1 && length <= 500 ? '' : 'Enter a reason of 1–500 characters.';
}

export class MetastrikeRequestError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function fetchMetastrikes<T>(
  path: string,
  { body, signal }: { body?: object; signal?: AbortSignal } = {},
): Promise<T> {
  const fallback = 'Could not reach the Metastrike service. Try again.';
  let response: Response;
  try {
    response = await fetch(path, {
      cache: 'no-store',
      signal,
      ...(body && {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    });
  } catch {
    throw new MetastrikeRequestError(fallback, 0);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || data === null) {
    const message = response.status === 401 ? 'Your session has expired. Sign in with Discord and try again.'
      : typeof data?.error === 'string' ? data.error : fallback;
    throw new MetastrikeRequestError(message, response.status);
  }
  return data;
}
