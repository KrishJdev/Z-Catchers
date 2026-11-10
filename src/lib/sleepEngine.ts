import { DateTime } from 'luxon';
import type { Member } from './db';

/**
 * Standard list of global GMT / UTC offsets spanning all inhabited timezones (-12:00 to +14:00).
 * Replaces city / location names so community members do not have to disclose their physical location.
 */
export const GMT_OFFSETS = [
  'GMT-12:00',
  'GMT-11:00',
  'GMT-10:00',
  'GMT-09:30',
  'GMT-09:00',
  'GMT-08:00',
  'GMT-07:00',
  'GMT-06:00',
  'GMT-05:00',
  'GMT-04:00',
  'GMT-03:30',
  'GMT-03:00',
  'GMT-02:00',
  'GMT-01:00',
  'GMT+00:00',
  'GMT+01:00',
  'GMT+02:00',
  'GMT+03:00',
  'GMT+03:30',
  'GMT+04:00',
  'GMT+04:30',
  'GMT+05:00',
  'GMT+05:30',
  'GMT+05:45',
  'GMT+06:00',
  'GMT+06:30',
  'GMT+07:00',
  'GMT+08:00',
  'GMT+08:45',
  'GMT+09:00',
  'GMT+09:30',
  'GMT+10:00',
  'GMT+10:30',
  'GMT+11:00',
  'GMT+12:00',
  'GMT+12:45',
  'GMT+13:00',
  'GMT+14:00',
] as const;

export type GmtOffset = (typeof GMT_OFFSETS)[number];

/**
 * Translates any timezone identifier (GMT offset, bare offset, or legacy IANA string)
 * into a specifier that Luxon's `DateTime.setZone()` natively supports (e.g. `UTC+05:30`).
 */
export function toValidLuxonZone(zoneStr: string | null | undefined): string {
  if (!zoneStr) return 'UTC';
  const clean = zoneStr.trim();
  if (/^GMT$/i.test(clean) || /^UTC$/i.test(clean)) return 'UTC';

  // Format: GMT+05:30, GMT-5, GMT+5:30
  const gmtMatch = clean.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/i);
  if (gmtMatch) {
    const sign = gmtMatch[1];
    const hours = parseInt(gmtMatch[2], 10);
    const mins = gmtMatch[3] ? parseInt(gmtMatch[3], 10) : 0;
    if (hours > 14 || mins >= 60) return 'invalid';
    return `UTC${sign}${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  }

  // Bare offset format: +05:30, -05:00, +5, -8
  const offsetMatch = clean.match(/^([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (offsetMatch) {
    const sign = offsetMatch[1];
    const hours = parseInt(offsetMatch[2], 10);
    const mins = offsetMatch[3] ? parseInt(offsetMatch[3], 10) : 0;
    if (hours > 14 || mins >= 60) return 'invalid';
    return `UTC${sign}${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  }

  // UTC offset format: UTC+05:30, UTC-5
  const utcMatch = clean.match(/^UTC([+-])(\d{1,2})(?::?(\d{2}))?$/i);
  if (utcMatch) {
    const sign = utcMatch[1];
    const hours = parseInt(utcMatch[2], 10);
    const mins = utcMatch[3] ? parseInt(utcMatch[3], 10) : 0;
    if (hours > 14 || mins >= 60) return 'invalid';
    return `UTC${sign}${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  }

  return clean;
}

/**
 * Validates whether the given string represents a valid timezone (GMT offset or IANA zone).
 */
export function isValidTimezone(zoneStr: string | null | undefined): boolean {
  if (!zoneStr || typeof zoneStr !== 'string') return false;
  const luxonZone = toValidLuxonZone(zoneStr);
  if (luxonZone === 'invalid') return false;
  return DateTime.now().setZone(luxonZone).isValid;
}

/**
 * Converts any timezone identifier (including legacy IANA city names) into a
 * privacy-friendly standard `GMT±HH:mm` representation.
 */
export function formatGmtOffset(zoneStr: string | null | undefined): string {
  if (!zoneStr) return 'GMT+00:00';
  const clean = zoneStr.trim();
  const luxonZone = toValidLuxonZone(clean);
  const dt = DateTime.now().setZone(luxonZone);
  if (!dt.isValid) return clean.startsWith('GMT') ? clean : 'GMT+00:00';
  return `GMT${dt.toFormat('ZZ')}`;
}

export type SleepBucket = 'BEDTIME_NOW' | 'WINDING_DOWN' | 'SLEEPING' | 'AWAKE';

export interface StreakMilestone {
  title: string;
  badgeLabel: string;
  icon: string;
  color: string;
  description: string;
}

export interface MemberState {
  bucket: SleepBucket;
  statusText: string;
  isSleepShieldActive: boolean;
  formattedViewerTime: string;
  formattedSleeperTime: string;
  diffMinutes: number;
  pendingNotice?: string | null;
  checkedInEarly?: boolean;
  streakMilestone?: StreakMilestone | null;
  isWeekendSchedule?: boolean;
  activeBedtimeLocal?: string;
}

/**
 * Checks and promotes pending schedule if 48-hour cooldown has elapsed.
 */
export function checkCooldownPromotion(
  member: Member,
  nowUtc = DateTime.utc()
): {
  promoted: boolean;
  activeMember: Member;
} {
  if (!member.pending_effective_at) {
    return { promoted: false, activeMember: member };
  }

  const effectiveAt = DateTime.fromISO(member.pending_effective_at, { zone: 'utc' });

  if (nowUtc >= effectiveAt) {
    const nextWeekendBedtime =
      member.pending_weekend_bedtime_local !== undefined
        ? (member.pending_weekend_bedtime_local || null)
        : (member.weekend_bedtime_local || null);
    const nextWeekendWakeTime =
      member.pending_weekend_wake_time_local !== undefined
        ? (member.pending_weekend_wake_time_local || null)
        : (member.weekend_wake_time_local || null);

    const updated: Member = {
      ...member,
      bedtime_local: member.pending_bedtime_local || member.bedtime_local,
      wake_time_local: member.pending_wake_time_local || member.wake_time_local,
      timezone: member.pending_timezone || member.timezone,
      weekend_bedtime_local: nextWeekendBedtime,
      weekend_wake_time_local: nextWeekendWakeTime,
      pending_bedtime_local: null,
      pending_wake_time_local: null,
      pending_timezone: null,
      pending_weekend_bedtime_local: null,
      pending_weekend_wake_time_local: null,
      pending_effective_at: null,
    };
    return { promoted: true, activeMember: updated };
  }

  return { promoted: false, activeMember: member };
}

/**
 * Calculates consecutive sleep check-in streak in days.
 * @param checkinDates Array of distinct local dates ("YYYY-MM-DD") the member checked in
 * @param sleeperNow Current DateTime in the sleeper's timezone
 */
export function calculateSleepStreak(
  checkinDates: string[],
  sleeperNow: DateTime
): number {
  if (!checkinDates || checkinDates.length === 0) return 0;

  const dateSet = new Set(checkinDates);
  const todayStr = sleeperNow.toISODate();
  const yesterdayStr = sleeperNow.minus({ days: 1 }).toISODate();

  if (!todayStr || !yesterdayStr) return 0;

  let currentStreak = 0;
  let checkCursor = sleeperNow;

  if (dateSet.has(todayStr)) {
    currentStreak = 1;
    checkCursor = sleeperNow.minus({ days: 1 });
  } else if (dateSet.has(yesterdayStr)) {
    // If not checked in today yet, but checked in yesterday, the streak is still alive
    currentStreak = 1;
    checkCursor = sleeperNow.minus({ days: 2 });
  } else {
    return 0;
  }

  while (true) {
    const cursorStr = checkCursor.toISODate();
    if (cursorStr && dateSet.has(cursorStr)) {
      currentStreak++;
      checkCursor = checkCursor.minus({ days: 1 });
    } else {
      break;
    }
  }

  return currentStreak;
}

/**
 * Returns celebratory mascot milestone badges for consistent sleep streaks.
 */
export function getStreakMilestoneBadge(streakDays: number): StreakMilestone | null {
  if (!streakDays || streakDays <= 0) return null;

  if (streakDays >= 30) {
    return {
      title: 'Grand Slumber Fox',
      badgeLabel: '30d Master',
      icon: '👑',
      color: 'text-status-amber border-status-amber/40 bg-status-amber/10',
      description: '30 consecutive days of on-time bedtime!',
    };
  }
  if (streakDays >= 14) {
    return {
      title: 'Night Guardian Fox',
      badgeLabel: '14d Guard',
      icon: '🥇',
      color: 'text-status-coral border-status-coral/40 bg-status-coral/10',
      description: '14 consecutive days of consistent sleep!',
    };
  }
  if (streakDays >= 7) {
    return {
      title: 'Dream Weaver Fox',
      badgeLabel: '7d Dreamer',
      icon: '🥈',
      color: 'text-status-sage border-status-sage/40 bg-status-sage/10',
      description: '1 full week of hitting bedtime!',
    };
  }
  if (streakDays >= 3) {
    return {
      title: 'Cozy Den Kit',
      badgeLabel: '3d Cozy',
      icon: '🥉',
      color: 'text-status-amber border-status-amber/40 bg-status-amber/10',
      description: '3 consecutive days on track!',
    };
  }

  return {
    title: 'First Snooze',
    badgeLabel: `${streakDays}d streak`,
    icon: '🔥',
    color: 'text-cream-secondary border-night-border bg-night-elevated',
    description: `${streakDays} consecutive day on track.`,
  };
}

/**
 * Determines whether a night date falls on a weekend night.
 * Weekend nights are explicitly defined as Friday nights and Saturday nights.
 * In Luxon: 5 = Friday, 6 = Saturday.
 */
export function isWeekendNight(dt: DateTime): boolean {
  return dt.weekday === 5 || dt.weekday === 6;
}

/**
 * Returns the effective bedtime string and whether weekend hours apply for a given night date.
 */
export function getBedtimeForNight(
  member: Member,
  nightDate: DateTime
): { bedtimeStr: string; isWeekend: boolean } {
  const isWeekend = isWeekendNight(nightDate);
  if (isWeekend && member.weekend_bedtime_local && member.weekend_bedtime_local.trim() !== '') {
    return { bedtimeStr: member.weekend_bedtime_local.trim(), isWeekend: true };
  }
  return { bedtimeStr: member.bedtime_local.trim(), isWeekend: false };
}

/**
 * Calculates the exact DateTime when a given night's bedtime occurs in the sleeper's timezone.
 * If bedtime hour >= 12, it takes place on the nightDate calendar day (e.g. Friday 23:30).
 * If bedtime hour < 12, it takes place on the following calendar day morning (e.g. Friday night's 01:00 AM sleep hits Saturday 01:00 AM).
 */
export function getNightBedtimeDateTime(
  member: Member,
  nightDate: DateTime
): { bedtimeDateTime: DateTime; isWeekend: boolean; bedtimeStr: string } {
  const { bedtimeStr, isWeekend } = getBedtimeForNight(member, nightDate);
  const [hours, minutes] = bedtimeStr.split(':').map(Number);
  const h = hours || 0;
  const m = minutes || 0;

  const baseDate = h < 12 ? nightDate.plus({ days: 1 }) : nightDate;

  const bedtimeDateTime = baseDate.set({
    hour: h,
    minute: m,
    second: 0,
    millisecond: 0,
  });

  return { bedtimeDateTime, isWeekend, bedtimeStr };
}

/**
 * Computes the canonical sleep cycle night date ("YYYY-MM-DD") for a member at a given moment.
 * If the member's target bedtime hour < 12 (i.e. after midnight, e.g. 01:30 AM),
 * the night date belongs to the prior evening (targetBedtime minus 1 day).
 * This ensures check-ins before midnight or in the early hours map to the same sleep session.
 */
export function getSleepCycleDate(member: Member, nowUtc = DateTime.utc()): string {
  const normalizedSleeperZone = toValidLuxonZone(member.timezone);
  const sleeperZone = DateTime.now().setZone(normalizedSleeperZone).isValid
    ? normalizedSleeperZone
    : 'UTC';
  const sleeperNow = nowUtc.setZone(sleeperZone);

  const candidateNights = [
    sleeperNow.minus({ days: 2 }),
    sleeperNow.minus({ days: 1 }),
    sleeperNow,
    sleeperNow.plus({ days: 1 }),
    sleeperNow.plus({ days: 2 }),
  ];

  const candidates = candidateNights.map((nightDate) =>
    getNightBedtimeDateTime(member, nightDate)
  );

  const closest = candidates.reduce((best, curr) =>
    Math.abs(curr.bedtimeDateTime.diff(sleeperNow, 'minutes').minutes) <
    Math.abs(best.bedtimeDateTime.diff(sleeperNow, 'minutes').minutes)
      ? curr
      : best
  );

  const target = closest.bedtimeDateTime;
  const nightDt = target.hour < 12 ? target.minus({ days: 1 }) : target;
  return nightDt.toISODate() || sleeperNow.toISODate()!;
}

/**
 * Computes a member's sleep bucket, viewer-adjusted bedtime, and sleep shield state.
 * Supports distinct weekend hours for Friday night and Saturday night bedtimes.
 */
export function computeMemberState(
  member: Member,
  viewerTz: string,
  nowUtc = DateTime.utc(),
  isInBed?: boolean
): MemberState {
  // Validate timezone (supports GMT offsets and IANA) or fallback
  const normalizedSleeperZone = toValidLuxonZone(member.timezone);
  const normalizedViewerZone = toValidLuxonZone(viewerTz);

  const sleeperZone = DateTime.now().setZone(normalizedSleeperZone).isValid
    ? normalizedSleeperZone
    : 'UTC';
  const targetViewerZone = DateTime.now().setZone(normalizedViewerZone).isValid
    ? normalizedViewerZone
    : 'UTC';

  const sleeperNow = nowUtc.setZone(sleeperZone);

  // Consider night dates around now: 2 days ago, yesterday, today, tomorrow, and 2 days ahead
  const candidateNights = [
    sleeperNow.minus({ days: 2 }),
    sleeperNow.minus({ days: 1 }),
    sleeperNow,
    sleeperNow.plus({ days: 1 }),
    sleeperNow.plus({ days: 2 }),
  ];

  const candidates = candidateNights.map((nightDate) =>
    getNightBedtimeDateTime(member, nightDate)
  );

  // Find candidate whose bedtimeDateTime is closest to sleeperNow
  const closestCandidate = candidates.reduce((closest, curr) =>
    Math.abs(curr.bedtimeDateTime.diff(sleeperNow, 'minutes').minutes) <
    Math.abs(closest.bedtimeDateTime.diff(sleeperNow, 'minutes').minutes)
      ? curr
      : closest
  );

  const targetBedtime = closestCandidate.bedtimeDateTime;
  const isWeekendSchedule = closestCandidate.isWeekend && Boolean(member.weekend_bedtime_local);
  const activeBedtimeLocal = closestCandidate.bedtimeStr;

  const diffMinutes = sleeperNow.diff(targetBedtime, 'minutes').minutes;

  let bucket: SleepBucket = 'AWAKE';
  let statusText = '';
  let isSleepShieldActive = false;
  let checkedInEarly = false;

  const effectiveInBed = isInBed !== undefined ? isInBed : Boolean(member.is_in_bed);

  // If member has checked in via "I'm in Bed" Safe Button
  // (Applies when within 3h before bedtime through 8h sleep window)
  if (effectiveInBed && diffMinutes >= -180 && diffMinutes <= 480) {
    bucket = 'SLEEPING';
    statusText = "In Bed (Checked In) • Resting";
    isSleepShieldActive = true;
    checkedInEarly = true;
  } else if (diffMinutes >= 0 && diffMinutes <= 60) {
    bucket = 'BEDTIME_NOW';
    statusText = `Bedtime hit ${Math.floor(diffMinutes)}m ago — Nag them!`;
  } else if (diffMinutes < 0 && diffMinutes >= -60) {
    bucket = 'WINDING_DOWN';
    statusText = `Bedtime in ${Math.abs(Math.floor(diffMinutes))}m`;
  } else if (diffMinutes > 60 && diffMinutes <= 480) {
    // 8 hour sleep shield window (60m to 480m)
    bucket = 'SLEEPING';
    statusText = `Catching Z's (Asleep)`;
    isSleepShieldActive = true;
  } else {
    bucket = 'AWAKE';
    // Find next upcoming bedtime strictly in the future
    const upcomingCandidates = candidates
      .map((c) => c.bedtimeDateTime)
      .filter((dt) => dt > sleeperNow)
      .sort((a, b) => a.toMillis() - b.toMillis());
    const nextBedtime = upcomingCandidates[0] || targetBedtime.plus({ days: 1 });
    const hoursUntil = Math.floor(nextBedtime.diff(sleeperNow, 'hours').hours);
    const minsUntil = Math.floor(nextBedtime.diff(sleeperNow, 'minutes').minutes % 60);
    statusText = `Awake • in ${hoursUntil}h ${minsUntil}m`;
  }

  // Convert bedtime to viewer's local time
  const viewerBedtime = targetBedtime.setZone(targetViewerZone);
  const formattedViewerTime = viewerBedtime.toFormat('h:mm a');
  const formattedSleeperTime = targetBedtime.toFormat('h:mm a');

  // Cooldown notice calculation if pending
  let pendingNotice: string | null = null;
  if (member.pending_effective_at && (member.pending_bedtime_local || member.pending_weekend_bedtime_local)) {
    const effectiveAt = DateTime.fromISO(member.pending_effective_at, { zone: 'utc' });
    const remainingHours = Math.max(0, Math.floor(effectiveAt.diff(nowUtc, 'hours').hours));
    const remainingMins = Math.max(0, Math.floor(effectiveAt.diff(nowUtc, 'minutes').minutes % 60));
    pendingNotice = `Schedule shifting in ${remainingHours}h ${remainingMins}m`;
  }

  const streakMilestone = member.streak_days ? getStreakMilestoneBadge(member.streak_days) : null;

  return {
    bucket,
    statusText,
    isSleepShieldActive,
    formattedViewerTime,
    formattedSleeperTime,
    diffMinutes,
    pendingNotice,
    checkedInEarly,
    streakMilestone,
    isWeekendSchedule,
    activeBedtimeLocal,
  };
}
