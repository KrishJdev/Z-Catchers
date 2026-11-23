import { DateTime } from 'luxon';
import { getMemberByIdSafe, isSupabaseConfigured, safeDatabaseErrorCode, supabaseAdmin, type Member } from '@/lib/db';
import { punishmentResponse } from '@/lib/punishments';
import { checkCooldownPromotion, getNightScheduleDateTime, getSleepCycleDate, toValidLuxonZone } from '@/lib/sleepEngine';

export const METASTRIKE_MONTH = /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/;

export function isMetastrikeCycle(value: unknown): value is string {
  return typeof value === 'string' && /^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value) &&
    DateTime.fromISO(value, { zone: 'utc' }).isValid;
}

type CycleEvidence = {
  checked_at: string | null;
  checked_in: boolean;
  woke: boolean;
  last_woke_up_at: string | null;
  last_wake_cycle_date: string | null;
};

function effectiveCycleTime(member: Member, nowUtc: DateTime<true>) {
  const { activeMember } = checkCooldownPromotion(member, nowUtc);
  const timezone = toValidLuxonZone(activeMember.timezone);
  const localTime = nowUtc.setZone(timezone);
  return { activeMember, localTime: localTime.isValid ? localTime : nowUtc };
}

export function metastrikeCycleContext(member: Member, nowUtc: DateTime<true>, evidence: CycleEvidence, cycle?: string) {
  const { activeMember, localTime } = effectiveCycleTime(member, nowUtc);
  const yesterday = localTime.minus({ days: 1 }).toISODate();
  const inBed = evidence.checked_in && !evidence.woke;
  const scheduledMember = {
    ...activeMember,
    is_in_bed: inBed,
    in_bed_at: evidence.checked_at,
    last_wake_cycle_date: evidence.woke ? yesterday : evidence.last_wake_cycle_date,
  };
  const anchor = getSleepCycleDate(scheduledMember, nowUtc, inBed);
  const localAnchor = DateTime.fromISO(anchor, { zone: localTime.zone });
  const cutoffFor = (day: DateTime) => day.isValid
    ? getNightScheduleDateTime(activeMember, day).bedtimeDateTime.plus({ minutes: 10 }).toUTC().toISO()
    : null;
  const choices = Array.from({ length: 7 }, (_, index) => localAnchor.plus({ days: index - 3 }));

  return {
    anchor,
    timezone: localTime.zoneName,
    profile_timezone: activeMember.timezone,
    revision: member.strike_schedule_revision,
    as_of: nowUtc.toISO(),
    local_month: localTime.toFormat('yyyy-MM'),
    local_day: localTime.toISODate(),
    day_start: localTime.startOf('day').toUTC().toISO(),
    day_end: localTime.plus({ days: 1 }).startOf('day').toUTC().toISO(),
    cutoff: cycle ? cutoffFor(DateTime.fromISO(cycle, { zone: localTime.zone })) : null,
    cutoffs: Object.fromEntries(choices.map(day => [day.toISODate(), cutoffFor(day)])),
    evidence,
  };
}

export async function loadMetastrikeCycleContext(memberId: string, cycle?: string) {
  if (!isSupabaseConfigured) return metastrikeResponse(null, null);
  const { data: member, error } = await getMemberByIdSafe(memberId, { requireFresh: true });
  if (error) return metastrikeResponse(null, error);
  if (!member?.is_active) return punishmentResponse({ error: 'This profile is inactive or unavailable.' }, 403);
  const nowUtc = DateTime.utc();
  const { localTime } = effectiveCycleTime(member, nowUtc);
  const { data: evidence, error: evidenceError } = await supabaseAdmin.rpc('get_metastrike_cycle_evidence', {
    p_member_id: memberId, p_cycle: localTime.minus({ days: 1 }).toISODate(),
  });
  if (evidenceError || !evidence) return metastrikeResponse(null, evidenceError);
  return metastrikeCycleContext(member, nowUtc, evidence, cycle);
}

export function metastrikeResponse(data: unknown, error: { code?: string; message?: string } | null) {
  if (!error && data != null) return punishmentResponse(data);
  if (error?.code && /^PT(400|403|404|409)$/.test(error.code)) {
    return punishmentResponse({ error: error.message }, Number(error.code.slice(2)));
  }
  console.error('[metastrikes] Dependency failure', { databaseCode: safeDatabaseErrorCode(error?.code) });
  return punishmentResponse({ error: 'Could not reach the Metastrike service. Try again.' }, 503);
}
