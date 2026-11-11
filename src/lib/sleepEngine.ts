import { DateTime } from 'luxon';
import type { Member } from './db';

/**
 * Curated list of popular IANA timezones spanning global Discord communities.
 * Used for auto-complete and select inputs while preserving exact IANA identifiers.
 */
export const COMMON_IANA_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'America/Vancouver',
  'America/Sao_Paulo',
  'America/Buenos_Aires',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Amsterdam',
  'Europe/Athens',
  'Europe/Helsinki',
  'Europe/Madrid',
  'Europe/Rome',
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Africa/Lagos',
  'Asia/Dubai',
  'Asia/Jerusalem',
  'Asia/Kolkata',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Shanghai',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Australia/Perth',
  'Pacific/Auckland',
  'Pacific/Honolulu',
  'UTC',
] as const;

/**
 * Standard list of global GMT / UTC offsets spanning all inhabited timezones (-12:00 to +14:00).
 * Kept for backward compatibility and manual offset selections.
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
 * Translates any timezone identifier (strict IANA identifier, GMT offset, or bare offset)
 * into a specifier that Luxon's `DateTime.setZone()` natively supports (e.g. `UTC+05:30` or `Europe/Athens`).
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
 * Validates whether the given string represents a valid IANA timezone identifier or supported offset in Luxon.
 */
export function isValidTimezone(zoneStr: string | null | undefined): boolean {
  if (!zoneStr || typeof zoneStr !== 'string') return false;
  const luxonZone = toValidLuxonZone(zoneStr);
  if (luxonZone === 'invalid') return false;
  return DateTime.now().setZone(luxonZone).isValid;
}

/**
 * Converts any timezone identifier (including IANA city names) into a
 * standard `GMT±HH:mm` representation for UI display and location privacy.
 */
export function formatGmtOffset(zoneStr: string | null | undefined): string {
  if (!zoneStr) return 'GMT+00:00';
  const clean = zoneStr.trim();
  const luxonZone = toValidLuxonZone(clean);
  const dt = DateTime.now().setZone(luxonZone);
  if (!dt.isValid) return clean.startsWith('GMT') ? clean : 'GMT+00:00';
  return `GMT${dt.toFormat('ZZ')}`;
}

/**
 * Automatically captures the local system IANA timezone using the Intl API.
 * Falls back to 'UTC' if detection fails or runs on an unsupported runtime.
 */
export function detectUserTimezone(): string {
  try {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (detected && isValidTimezone(detected)) {
      return detected;
    }
  } catch {
    // Ignore runtime exceptions in non-browser or sandbox environments
  }
  return 'UTC';
}

export type SleepBucket =
  | 'BEDTIME_NOW'
  | 'BEDTIME_GRACE'
  | 'OVERDUE_NAG_NOW'
  | 'WINDING_DOWN'
  | 'SLEEPING'
  | 'AWAKE';

export type SleepStatus =
  | 'BEDTIME_GRACE'
  | 'OVERDUE_NAG_NOW'
  | 'WINDING_DOWN'
  | 'SLEEPING'
  | 'AWAKE';

export interface StreakMilestone {
  title: string;
  badgeLabel: string;
  icon: string;
  color: string;
  description: string;
}

export interface MemberState {
  bucket: SleepBucket;
  status: SleepStatus;
  statusText: string;
  isSleepShieldActive: boolean;
  formattedViewerTime: string;
  formattedSleeperTime: string;
  diffMinutes: number;
  graceMinutesLeft?: number;
  canVoteStrike?: boolean;
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
 * Determines whether a given night date falls on a weekend night.
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
 * Calculates the exact DateTime when a given night's bedtime occurs in the sleeper's IANA timezone.
 * If bedtime hour >= 12, it takes place on the nightDate calendar day (e.g. Friday 23:30).
 * If bedtime hour < 12, it takes place on the following calendar day morning (e.g. Friday night's 01:00 AM sleep hits Saturday 01:00 AM).
 * Preserves the IANA zone to accurately account for Daylight Saving Time (DST) transitions.
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
 * Defined strictly by the local evening the sleep window begins.
 * Applies circular time-delta math across midnight (±12 hours relative to the target bedtime)
 * so early check-ins before midnight and grace-period check-ins after midnight resolve to the
 * exact same sleep cycle.
 */
export function getSleepCycleDate(member: Member, nowUtc = DateTime.utc()): string {
  const normalizedSleeperZone = toValidLuxonZone(member.timezone);
  const sleeperZone = DateTime.now().setZone(normalizedSleeperZone).isValid
    ? normalizedSleeperZone
    : 'UTC';
  const sleeperNow = nowUtc.setZone(sleeperZone);

  // Candidate evening dates around sleeperNow (-2 to +2 days)
  const candidateNights = [
    sleeperNow.minus({ days: 2 }),
    sleeperNow.minus({ days: 1 }),
    sleeperNow,
    sleeperNow.plus({ days: 1 }),
    sleeperNow.plus({ days: 2 }),
  ];

  const candidates = candidateNights.map((nightDt) => {
    const eveningDate = nightDt.startOf('day');
    const { bedtimeDateTime, isWeekend, bedtimeStr } = getNightBedtimeDateTime(member, eveningDate);
    const diffMinutes = sleeperNow.diff(bedtimeDateTime, 'minutes').minutes;
    return {
      cycleEveningDate: eveningDate.toISODate()!,
      bedtimeDateTime,
      diffMinutes,
      absDiffMinutes: Math.abs(diffMinutes),
      isWeekend,
      bedtimeStr,
    };
  });

  // Find candidate whose bedtime is closest to sleeperNow using circular time-delta math (±12h / ±720m)
  const closest = candidates.reduce((best, curr) =>
    curr.absDiffMinutes < best.absDiffMinutes ? curr : best
  );

  return closest.cycleEveningDate || sleeperNow.toISODate()!;
}

/**
 * Checks whether the active sleep cycle (anchored strictly to the local evening) is a weekend night.
 * Weekend nights are explicitly defined as Friday nights and Saturday nights.
 */
export function isWeekendCycle(member: Member, nowUtc = DateTime.utc()): boolean {
  const cycleDateStr = getSleepCycleDate(member, nowUtc);
  const normalizedZone = toValidLuxonZone(member.timezone);
  const dt = DateTime.fromISO(cycleDateStr, { zone: normalizedZone });
  return dt.weekday === 5 || dt.weekday === 6;
}

/**
 * Computes a member's sleep bucket, viewer-adjusted bedtime, and sleep shield state.
 * Fully DST-aware using Luxon's IANA timezone conversion engine.
 * Supports distinct weekend hours for Friday night and Saturday night bedtimes.
 */
export function computeMemberState(
  member: Member,
  viewerTz: string,
  nowUtc = DateTime.utc(),
  isInBed?: boolean
): MemberState {
  // Validate timezone (supports strict IANA zones and GMT offsets)
  const normalizedSleeperZone = toValidLuxonZone(member.timezone);
  const normalizedViewerZone = toValidLuxonZone(viewerTz);

  const sleeperZone = DateTime.now().setZone(normalizedSleeperZone).isValid
    ? normalizedSleeperZone
    : 'UTC';
  const targetViewerZone = DateTime.now().setZone(normalizedViewerZone).isValid
    ? normalizedViewerZone
    : 'UTC';

  const sleeperNow = nowUtc.setZone(sleeperZone);

  // Consider candidate evening dates around now: 2 days ago, yesterday, today, tomorrow, and 2 days ahead
  const candidateNights = [
    sleeperNow.minus({ days: 2 }),
    sleeperNow.minus({ days: 1 }),
    sleeperNow,
    sleeperNow.plus({ days: 1 }),
    sleeperNow.plus({ days: 2 }),
  ];

  const candidates = candidateNights.map((nightDt) => {
    const eveningDate = nightDt.startOf('day');
    const { bedtimeDateTime, isWeekend, bedtimeStr } = getNightBedtimeDateTime(member, eveningDate);
    const diffMinutes = sleeperNow.diff(bedtimeDateTime, 'minutes').minutes;
    return {
      eveningDate,
      cycleEveningDate: eveningDate.toISODate()!,
      bedtimeDateTime,
      diffMinutes,
      absDiffMinutes: Math.abs(diffMinutes),
      isWeekend,
      bedtimeStr,
    };
  });

  // Find candidate whose bedtimeDateTime is closest to sleeperNow (circular ±12h / ±720m math)
  const closestCandidate = candidates.reduce((closest, curr) =>
    curr.absDiffMinutes < closest.absDiffMinutes ? curr : closest
  );

  const targetBedtime = closestCandidate.bedtimeDateTime;
  const isWeekendSchedule = closestCandidate.isWeekend && Boolean(member.weekend_bedtime_local);
  const activeBedtimeLocal = closestCandidate.bedtimeStr;

  const diffMinutes = closestCandidate.diffMinutes;

  let bucket: SleepBucket = 'AWAKE';
  let status: SleepStatus = 'AWAKE';
  let statusText = '';
  let isSleepShieldActive = false;
  let checkedInEarly = false;
  let graceMinutesLeft = 0;
  let canVoteStrike = false;

  const effectiveInBed = isInBed !== undefined ? isInBed : Boolean(member.is_in_bed);

  // If member has checked in via "I'm in Bed" Safe Button
  // (Applies when within 3h before bedtime through 8h sleep window)
  if (effectiveInBed && diffMinutes >= -180 && diffMinutes <= 480) {
    bucket = 'SLEEPING';
    status = 'SLEEPING';
    statusText = 'In Bed (Checked In) • Resting';
    isSleepShieldActive = true;
    checkedInEarly = true;
    canVoteStrike = false;
  } else if (diffMinutes >= 0 && diffMinutes <= 5) {
    // 5-minute grace window: Strike voting is strictly locked
    bucket = 'BEDTIME_NOW';
    status = 'BEDTIME_GRACE';
    graceMinutesLeft = Math.max(1, Math.ceil(5 - diffMinutes));
    statusText = `Grace Period: ${graceMinutesLeft}m left`;
    canVoteStrike = false;
  } else if (diffMinutes > 5 && diffMinutes <= 60) {
    // Overdue within the immediate nag window: Strike voting unlocked
    bucket = 'BEDTIME_NOW';
    status = 'OVERDUE_NAG_NOW';
    statusText = `Bedtime hit ${Math.floor(diffMinutes)}m ago — Nag them!`;
    canVoteStrike = true;
  } else if (diffMinutes < 0 && diffMinutes >= -60) {
    bucket = 'WINDING_DOWN';
    status = 'WINDING_DOWN';
    statusText = `Bedtime in ${Math.abs(Math.floor(diffMinutes))}m`;
    canVoteStrike = false;
  } else if (diffMinutes > 60 && diffMinutes <= 480) {
    // Active sleep window (60m to 480m) without safe check-in:
    // Status is OVERDUE_NAG_NOW (overdue past 5m through active sleep window), strike voting remains active
    bucket = 'SLEEPING';
    status = 'OVERDUE_NAG_NOW';
    statusText = `Catching Z's (Asleep)`;
    isSleepShieldActive = true;
    canVoteStrike = true;
  } else {
    bucket = 'AWAKE';
    status = 'AWAKE';
    canVoteStrike = false;
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

  // Convert bedtime to viewer's local time (DST-aware Luxon conversion)
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
    status,
    statusText,
    isSleepShieldActive,
    formattedViewerTime,
    formattedSleeperTime,
    diffMinutes,
    graceMinutesLeft,
    canVoteStrike,
    pendingNotice,
    checkedInEarly,
    streakMilestone,
    isWeekendSchedule,
    activeBedtimeLocal,
  };
}

/**
 * Returns the current calendar month in the member's local timezone (format: 'YYYY-MM', e.g. '2026-11').
 */
export function getCurrentStrikeMonth(member: Member, nowUtc = DateTime.utc()): string {
  const normalizedSleeperZone = toValidLuxonZone(member.timezone);
  const sleeperZone = DateTime.now().setZone(normalizedSleeperZone).isValid
    ? normalizedSleeperZone
    : 'UTC';
  const sleeperNow = nowUtc.setZone(sleeperZone);
  return sleeperNow.toFormat('yyyy-MM');
}

/**
 * Checks if a member's strike cycle month has rolled over to a new calendar month.
 * If so, lazily resets strikes_used and metastrikes_used to 0 (3 remaining each).
 */
export function checkMonthlyStrikeReset(
  member: Member,
  nowUtc = DateTime.utc()
): {
  reset: boolean;
  activeMember: Member;
} {
  const currentMonth = getCurrentStrikeMonth(member, nowUtc);
  const cycleMonth = member.strike_cycle_month || '2026-01';

  if (cycleMonth !== currentMonth) {
    const updated: Member = {
      ...member,
      strikes_used: 0,
      metastrikes_used: 0,
      strike_cycle_month: currentMonth,
    };
    return { reset: true, activeMember: updated };
  }

  return { reset: false, activeMember: member };
}
