import { DateTime } from 'luxon';
import type { SleepLog, WeeklySchedule, DayKey } from './db';
import { setInMemorySleepLog } from './db';

/**
 * Pre-seeded demo member fingerprint definitions and helper utilities.
 * Used to identify and safely purge default demo profiles (Aoi, SarahK, Marcus, Arjun)
 * without impacting real community members who share common names.
 */

export interface DemoSeedFingerprint {
  discord_username: string;
  discord_handle: string;
  journal_url: string;
  avatar_url?: string;
  timezone?: string;
}

export const DEMO_SEED_FINGERPRINTS: readonly DemoSeedFingerprint[] = [
  {
    discord_username: 'Aoi',
    discord_handle: 'aoi_jp',
    journal_url: 'https://discord.com/channels/123456789/987654321',
    avatar_url: 'https://api.dicebear.com/7.x/bottts/svg?seed=Aoi',
    timezone: 'Asia/Tokyo',
  },
  {
    discord_username: 'SarahK',
    discord_handle: 'sarah_ny',
    journal_url: 'https://discord.com/channels/123456789/987654322',
    avatar_url: 'https://api.dicebear.com/7.x/bottts/svg?seed=SarahK',
    timezone: 'America/New_York',
  },
  {
    discord_username: 'Marcus',
    discord_handle: 'marcus_ldn',
    journal_url: 'https://discord.com/channels/123456789/987654323',
    avatar_url: 'https://api.dicebear.com/7.x/bottts/svg?seed=Marcus',
    timezone: 'Europe/London',
  },
  {
    discord_username: 'Arjun',
    discord_handle: 'arjun_in',
    journal_url: 'https://discord.com/channels/123456789/987654324',
    avatar_url: 'https://api.dicebear.com/7.x/bottts/svg?seed=Arjun',
    timezone: 'Asia/Kolkata',
  },
] as const;

/**
 * Checks if a member profile matches one of the pre-seeded demo member fingerprints.
 * Strictly verifies username, handle, and the dummy test journal URL to prevent false positives.
 */
export function isDemoSeedMember(member: {
  discord_username?: string | null;
  discord_handle?: string | null;
  journal_url?: string | null;
} | null | undefined): boolean {
  if (!member || !member.discord_username) return false;
  const username = member.discord_username.trim().toLowerCase();
  const handle = (member.discord_handle || '').trim().toLowerCase();
  const journal = (member.journal_url || '').trim();

  return DEMO_SEED_FINGERPRINTS.some(
    (seed) =>
      seed.discord_username.toLowerCase() === username &&
      seed.discord_handle.toLowerCase() === handle &&
      seed.journal_url === journal
  );
}

/**
 * Generates 14–30 days of realistic past sleep_logs for demo members and local offline testing.
 */
export function generateDemoSleepLogs(
  memberId: string,
  memberTimezone: string = 'UTC',
  weeklySchedule?: WeeklySchedule | null,
  daysCount = 30
): SleepLog[] {
  const logs: SleepLog[] = [];
  const tz = memberTimezone || 'UTC';
  const now = DateTime.utc().setZone(tz);

  const weekdayMap: Record<number, DayKey> = {
    1: 'mon',
    2: 'tue',
    3: 'wed',
    4: 'thu',
    5: 'fri',
    6: 'sat',
    7: 'sun',
  };

  for (let i = daysCount; i >= 1; i--) {
    const cycleDt = now.minus({ days: i }).startOf('day');
    const cycleDate = cycleDt.toISODate()!;
    const dayKey = weekdayMap[cycleDt.weekday] || 'mon';
    const daySchedule = weeklySchedule?.[dayKey] || {
      bedtime: '23:00',
      wake_time: '07:00',
    };

    const targetBedtime = daySchedule.bedtime;
    const targetWakeTime = daySchedule.wake_time;

    const [tBedH, tBedM] = targetBedtime.split(':').map(Number);
    const [tWakeH, tWakeM] = targetWakeTime.split(':').map(Number);

    // Realistic variation across past 30 days
    let status: SleepLog['status'] = 'on_time';
    let bedMinuteShift = -5 + ((i * 3) % 11);
    let wakeMinuteShift = -3 + ((i * 2) % 9);

    if (i % 14 === 4) {
      status = 'late';
      bedMinuteShift = 25;
    } else if (i === 12) {
      status = 'metastrike';
    } else if (i === 19) {
      status = 'missed';
    }

    if (status === 'missed') {
      logs.push({
        id: `demo-${memberId}-${cycleDate}`,
        member_id: memberId,
        cycle_date: cycleDate,
        timezone: tz,
        target_bedtime: targetBedtime,
        target_wake_time: targetWakeTime,
        in_bed_at: null,
        in_bed_local_time: null,
        woke_up_at: null,
        woke_up_local_time: null,
        wake_source: null,
        duration_minutes: null,
        status: 'missed',
        created_at: cycleDt.toUTC().toISO()!,
        updated_at: cycleDt.toUTC().toISO()!,
      });
      continue;
    }

    const bedIsPastMidnight = tBedH >= 0 && tBedH < 6;
    const bedBaseDt = bedIsPastMidnight ? cycleDt.plus({ days: 1 }) : cycleDt;
    const inBedDt = bedBaseDt
      .set({ hour: tBedH, minute: tBedM, second: 0, millisecond: 0 })
      .plus({ minutes: bedMinuteShift });

    const wokeUpDt = cycleDt
      .plus({ days: 1 })
      .set({ hour: tWakeH, minute: tWakeM, second: 0, millisecond: 0 })
      .plus({ minutes: wakeMinuteShift });

    const durationMinutes = Math.max(1, Math.round(wokeUpDt.diff(inBedDt, 'minutes').minutes));

    logs.push({
      id: `demo-${memberId}-${cycleDate}`,
      member_id: memberId,
      cycle_date: cycleDate,
      timezone: tz,
      target_bedtime: targetBedtime,
      target_wake_time: targetWakeTime,
      in_bed_at: inBedDt.toUTC().toISO()!,
      in_bed_local_time: inBedDt.toFormat('HH:mm'),
      woke_up_at: wokeUpDt.toUTC().toISO()!,
      woke_up_local_time: wokeUpDt.toFormat('HH:mm'),
      wake_source: i % 3 === 0 ? 'manual' : 'button',
      duration_minutes: durationMinutes,
      status,
      created_at: inBedDt.toUTC().toISO()!,
      updated_at: wokeUpDt.toUTC().toISO()!,
    });
  }

  return logs;
}

/**
 * Pre-populates the in-memory fallback store with realistic sleep_logs for all demo members.
 */
export function seedDemoSleepLogsInMemory(): void {
  for (const seed of DEMO_SEED_FINGERPRINTS) {
    const logs = generateDemoSleepLogs(
      seed.discord_username.toLowerCase(),
      seed.timezone || 'UTC',
      null,
      30
    );
    for (const log of logs) {
      setInMemorySleepLog(log);
    }
  }
}
