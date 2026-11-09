import { DateTime } from 'luxon';
import type { Member } from './db';

export type SleepBucket = 'BEDTIME_NOW' | 'WINDING_DOWN' | 'SLEEPING' | 'AWAKE';

export interface MemberState {
  bucket: SleepBucket;
  statusText: string;
  isSleepShieldActive: boolean;
  formattedViewerTime: string;
  formattedSleeperTime: string;
  diffMinutes: number;
  pendingNotice?: string | null;
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
 * Computes a member's sleep bucket, viewer-adjusted bedtime, and sleep shield state.
 */
export function computeMemberState(
  member: Member,
  viewerTz: string,
  nowUtc = DateTime.utc()
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

  if (diffMinutes >= 0 && diffMinutes <= 60) {
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

  return {
    bucket,
    statusText,
    isSleepShieldActive,
    formattedViewerTime,
    formattedSleeperTime,
    diffMinutes,
    pendingNotice,
  };
}
