import { NextResponse } from 'next/server';
import { supabaseAdmin, Member, getMemberSleepLogs, SleepLog, getMemberByIdSafe } from '@/lib/db';
import { DateTime } from 'luxon';
import { toValidLuxonZone } from '@/lib/timezone';
import { isDemoSeedMember, generateDemoSleepLogs } from '@/lib/demoSeed';
import { calculateSleepStreak } from '@/lib/sleepEngine';

const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Calculates average bedtime ("HH:mm") circular across midnight.
 */
function calculateAverageTime(times: string[], anchorAtNoon = false): string | null {
  if (times.length === 0) return null;

  let totalMinutes = 0;
  for (const time of times) {
    const [h, m] = time.split(':').map(Number);
    let mins = h * 60 + m;
    if (anchorAtNoon) {
      // Offset relative to midnight: >= 12:00 is negative minutes until midnight
      if (mins >= 720) {
        mins -= 1440;
      }
    }
    totalMinutes += mins;
  }

  let avgMinutes = Math.round(totalMinutes / times.length);
  if (anchorAtNoon && avgMinutes < 0) {
    avgMinutes += 1440;
  }
  avgMinutes = (avgMinutes + 1440) % 1440;

  const avgH = Math.floor(avgMinutes / 60);
  const avgM = avgMinutes % 60;
  return `${String(avgH).padStart(2, '0')}:${String(avgM).padStart(2, '0')}`;
}

/**
 * GET /api/members/sleep-history
 * Query Parameters:
 * - memberId (required): Target member UUID/ID
 * - month (optional): "YYYY-MM" target month (defaults to current month in member's timezone)
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const memberId = searchParams.get('memberId');
    const monthParam = searchParams.get('month');

    if (!memberId) {
      return NextResponse.json({ error: 'Missing required query parameter: memberId' }, { status: 400 });
    }

    // Fetch target member
    const { data: rawMember, error: memberErr } = await getMemberByIdSafe(memberId);

    if (memberErr || !rawMember) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    const member = rawMember;
    const memberTz = toValidLuxonZone(member.timezone);
    const nowLocal = DateTime.utc().setZone(memberTz);

    let targetMonth = monthParam ? monthParam.trim() : nowLocal.toFormat('yyyy-MM');
    if (!MONTH_REGEX.test(targetMonth)) {
      return NextResponse.json(
        { error: 'Invalid month format. Expected YYYY-MM (e.g. 2026-11).' },
        { status: 400 }
      );
    }

    const startCycleDate = `${targetMonth}-01`;
    const endCycleDate = `${targetMonth}-31`;

    // Fetch sleep logs for target month
    let { data: sleepLogs } = await getMemberSleepLogs(member.id, startCycleDate, endCycleDate);

    // If no sleep logs exist and this is a demo seed member, auto-populate with realistic demo history
    if ((!sleepLogs || sleepLogs.length === 0) && isDemoSeedMember(member)) {
      const generated = generateDemoSleepLogs(member.id, member.timezone, member.weekly_schedule, 30);
      for (const log of generated) {
        if (log.cycle_date >= startCycleDate && log.cycle_date <= endCycleDate) {
          sleepLogs.push(log);
        }
      }
    }

    // Fetch strikes and metastrikes for this member in the given month to merge
    try {
      const { data: strikeRows } = await supabaseAdmin
        .from('nightly_strike_logs')
        .select('*')
        .eq('target_member_id', member.id)
        .gte('sleep_cycle_date', startCycleDate)
        .lte('sleep_cycle_date', endCycleDate);

      if (strikeRows && strikeRows.length > 0) {
        const logMap = new Map<string, SleepLog>();
        for (const log of sleepLogs) {
          logMap.set(log.cycle_date, { ...log });
        }

        for (const strike of strikeRows) {
          const date = strike.sleep_cycle_date;
          const existing = logMap.get(date);
          const strikeStatus: SleepLog['status'] =
            strike.record_type === 'metastrike' ? 'metastrike' : 'missed';

          if (existing) {
            existing.status = strikeStatus;
            logMap.set(date, existing);
          } else {
            logMap.set(date, {
              member_id: member.id,
              cycle_date: date,
              timezone: member.timezone,
              target_bedtime: member.bedtime_local,
              target_wake_time: member.wake_time_local,
              in_bed_at: null,
              in_bed_local_time: null,
              woke_up_at: null,
              woke_up_local_time: null,
              wake_source: null,
              duration_minutes: null,
              status: strikeStatus,
            });
          }
        }
        sleepLogs = Array.from(logMap.values());
      }
    } catch (strikeErr) {
      console.warn('[sleep-history] Failed to merge nightly_strike_logs:', strikeErr);
    }

    // Sort logs chronologically
    sleepLogs.sort((a, b) => a.cycle_date.localeCompare(b.cycle_date));

    // Calculate monthly summary statistics
    const loggedNights = sleepLogs.filter(
      (l) => l.in_bed_local_time || l.woke_up_local_time || l.duration_minutes !== null
    );
    const totalLoggedNights = loggedNights.length;

    const durations = sleepLogs
      .filter((l) => typeof l.duration_minutes === 'number' && l.duration_minutes > 0)
      .map((l) => l.duration_minutes as number);

    const avgDurationMinutes =
      durations.length > 0
        ? Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length)
        : null;

    const bedtimes = sleepLogs
      .filter((l) => l.in_bed_local_time)
      .map((l) => l.in_bed_local_time as string);

    const wakeTimes = sleepLogs
      .filter((l) => l.woke_up_local_time)
      .map((l) => l.woke_up_local_time as string);

    const avgBedtime = calculateAverageTime(bedtimes, true) || member.bedtime_local;
    const avgWakeTime = calculateAverageTime(wakeTimes, false) || member.wake_time_local;

    const onTimeCount = loggedNights.filter((l) => l.status === 'on_time').length;
    const onTimePercentage =
      totalLoggedNights > 0 ? Math.round((onTimeCount / totalLoggedNights) * 100) : 100;

    // Fetch streak days
    const { data: checkinRows } = await supabaseAdmin
      .from('notification_logs')
      .select('local_date')
      .eq('member_id', member.id)
      .eq('notification_type', 'IN_BED_EARLY')
      .order('local_date', { ascending: false })
      .limit(60);

    const checkinDates = (checkinRows || []).map((l: { local_date: string }) => l.local_date);
    const streakDays = calculateSleepStreak(checkinDates, nowLocal);

    return NextResponse.json({
      member: {
        id: member.id,
        name: member.discord_username,
        discord_handle: member.discord_handle,
        avatar: member.avatar_url,
        timezone: member.timezone,
        bedtime: member.bedtime_local,
        wake_time: member.wake_time_local,
        current_streak: streakDays,
        weekly_schedule: member.weekly_schedule,
        weekend_bedtime_local: member.weekend_bedtime_local,
        weekend_wake_time_local: member.weekend_wake_time_local,
        journal_url: member.journal_url,
        role: member.role,
        is_in_bed: member.is_in_bed,
        is_woke_up: member.is_woke_up,
        strikes_count: typeof member.strikes_count === 'number' ? member.strikes_count : member.strikes_used || 0,
        metastrikes_count: typeof member.metastrikes_count === 'number' ? member.metastrikes_count : member.metastrikes_used || 0,
      },
      month: targetMonth,
      logs: sleepLogs.map((l) => ({
        cycle_date: l.cycle_date,
        in_bed_local_time: l.in_bed_local_time,
        woke_up_local_time: l.woke_up_local_time,
        target_bedtime: l.target_bedtime,
        target_wake_time: l.target_wake_time,
        duration_minutes: l.duration_minutes,
        wake_source: l.wake_source,
        status: l.status,
      })),
      summary: {
        totalLoggedNights,
        avgDurationMinutes,
        avgBedtime,
        avgWakeTime,
        onTimePercentage,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
