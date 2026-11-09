import { DateTime } from 'luxon';
import type { Member } from './db';

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
    const updated: Member = {
      ...member,
      bedtime_local: member.pending_bedtime_local || member.bedtime_local,
      wake_time_local: member.pending_wake_time_local || member.wake_time_local,
      timezone: member.pending_timezone || member.timezone,
      pending_bedtime_local: null,
      pending_wake_time_local: null,
      pending_timezone: null,
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
 * Computes a member's sleep bucket, viewer-adjusted bedtime, and sleep shield state.
 */
export function computeMemberState(
  member: Member,
  viewerTz: string,
  nowUtc = DateTime.utc(),
  isInBed?: boolean
): MemberState {
  // Validate IANA timezone or fallback
  const sleeperZone = DateTime.now().setZone(member.timezone).isValid
    ? member.timezone
    : 'UTC';
  const targetViewerZone = DateTime.now().setZone(viewerTz).isValid
    ? viewerTz
    : 'UTC';

  const [hours, minutes] = member.bedtime_local.split(':').map(Number);
  const sleeperNow = nowUtc.setZone(sleeperZone);

  const bedtimeToday = sleeperNow.set({
    hour: hours || 0,
    minute: minutes || 0,
    second: 0,
    millisecond: 0,
  });

  const bedtimeYesterday = bedtimeToday.minus({ days: 1 });
  const bedtimeTomorrow = bedtimeToday.plus({ days: 1 });

  const candidates = [bedtimeYesterday, bedtimeToday, bedtimeTomorrow];

  // Find candidate closest to current time
  const targetBedtime = candidates.reduce((closest, curr) =>
    Math.abs(curr.diff(sleeperNow, 'minutes').minutes) <
    Math.abs(closest.diff(sleeperNow, 'minutes').minutes)
      ? curr
      : closest
  );

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
    const nextBedtime = diffMinutes < 0 ? targetBedtime : bedtimeTomorrow;
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
  if (member.pending_effective_at && member.pending_bedtime_local) {
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
  };
}
