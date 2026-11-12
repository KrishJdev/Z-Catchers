import { NextResponse } from 'next/server';
import {
  supabaseAdmin,
  Member,
  updateMemberSafe,
  upsertSleepLog,
  getMemberSleepLogs,
  getMemberByIdSafe,
  isSupabaseConfigured,
} from '@/lib/db';
import { DateTime } from 'luxon';
import { verifyPin, getRequestSessionMemberId, verifyModeratorAuthorization, sanitizeMember } from '@/lib/auth';
import { getNightScheduleDateTime } from '@/lib/sleepEngine';
import { toValidLuxonZone } from '@/lib/timezone';
import {
  getClientIp,
  checkPinRateLimitPersistent,
  recordPinFailurePersistent,
  resetPinFailurePersistent,
} from '@/lib/rateLimit';

const TIME_FORMAT_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_FORMAT_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * POST /api/members/wake-up
 * Allows members to log when they woke up either by tapping the instant button or entering manual time.
 * Supports:
 * - Mode 1: Instant Button ({ mode: 'button' } or empty body)
 * - Mode 2: Manual Time Entry ({ mode: 'manual', wokeUpTime: 'HH:mm', cycleDate?: 'YYYY-MM-DD' })
 */
export async function POST(request: Request) {
  try {
    let body: any = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const { memberId: requestedMemberId, mode = 'button', wokeUpTime, cycleDate, pin } = body;

    // Authentication:
    const sessionMemberId = getRequestSessionMemberId(request);
    const targetMemberId = requestedMemberId || sessionMemberId;

    if (!targetMemberId) {
      return NextResponse.json(
        { error: 'Missing memberId and no active session found.', code: 'UNAUTHORIZED' },
        { status: 401 }
      );
    }

    const { data: rawMember, error: memberErr } = await getMemberByIdSafe(targetMemberId);

    if (memberErr || !rawMember) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    const member = rawMember;

    // Authorization verification
    const isSessionMatch = Boolean(sessionMemberId && sessionMemberId === member.id);

    let isModMatch = false;
    if (!isSessionMatch) {
      const modAuth = await verifyModeratorAuthorization(request);
      if (modAuth.authorized) {
        isModMatch = true;
      }
    }

    let isPinMatch = false;
    if (!isSessionMatch && !isModMatch) {
      if (sessionMemberId && sessionMemberId !== member.id) {
        return NextResponse.json(
          { error: 'Forbidden. You cannot log wake-up for another member.', code: 'FORBIDDEN' },
          { status: 403 }
        );
      }

      if (pin !== undefined && pin !== null) {
        if (typeof pin !== 'string') {
          return NextResponse.json({ error: 'PIN must be a string.' }, { status: 400 });
        }
        const clientIp = getClientIp(request);
        const rateCheck = await checkPinRateLimitPersistent(clientIp, member.id);
        if (!rateCheck.allowed) {
          return NextResponse.json(
            {
              error: `Too many failed attempts. Please wait ${rateCheck.retryAfterSeconds} seconds before trying again.`,
            },
            {
              status: 429,
              headers: { 'Retry-After': String(rateCheck.retryAfterSeconds) },
            }
          );
        }

        const cleanPin = pin.trim();
        if (member.passcode_hash && verifyPin(cleanPin, member.passcode_hash)) {
          isPinMatch = true;
          await resetPinFailurePersistent(clientIp, member.id);
        } else {
          await recordPinFailurePersistent(clientIp, member.id);
        }
      }
    }

    if (!isSessionMatch && !isModMatch && !isPinMatch) {
      return NextResponse.json(
        {
          error: member.passcode_hash
            ? 'Authentication required. Please log in with your 4-digit PIN before logging wake-up.'
            : 'Please claim your profile before logging wake-up.',
          code: 'UNAUTHORIZED',
        },
        { status: 401 }
      );
    }

    const nowUtc = DateTime.utc();
    const sleeperZone = toValidLuxonZone(member.timezone);
    const sleeperNow = nowUtc.setZone(sleeperZone);

    // Resolve target cycle date
    let targetCycleDate: string;

    // Determine the active or most recent sleep cycle for the sleeper
    let currentCycleDate: string;
    if (member.last_notified_stage === 'IN_BED_EARLY' && member.last_notified_cycle_date) {
      currentCycleDate = member.last_notified_cycle_date;
    } else {
      const todayNight = sleeperNow.startOf('day');
      const todaySched = getNightScheduleDateTime(member, todayNight);
      // If current time is before today's wind-down window (-180m), this wake-up belongs to yesterday's night cycle
      if (sleeperNow < todaySched.bedtimeDateTime.minus({ minutes: 180 })) {
        currentCycleDate = sleeperNow.minus({ days: 1 }).toISODate()!;
      } else {
        currentCycleDate = sleeperNow.toISODate()!;
      }
    }

    if (cycleDate) {
      if (!DATE_FORMAT_REGEX.test(cycleDate)) {
        return NextResponse.json({ error: 'Invalid cycleDate format. Expected YYYY-MM-DD.' }, { status: 400 });
      }
      const requestedDate = DateTime.fromISO(cycleDate, { zone: sleeperZone });
      if (!requestedDate.isValid) {
        return NextResponse.json({ error: 'Invalid cycleDate value.' }, { status: 400 });
      }
      // Must not be in the future
      if (requestedDate.startOf('day') > sleeperNow.startOf('day')) {
        return NextResponse.json({ error: 'Cannot log wake-up for a future date.' }, { status: 400 });
      }
      // Must be within past 7 days
      const daysDiff = sleeperNow.startOf('day').diff(requestedDate.startOf('day'), 'days').days;
      if (daysDiff > 7) {
        return NextResponse.json({ error: 'Cannot log wake-up for cycles older than 7 days.' }, { status: 400 });
      }
      targetCycleDate = cycleDate;
    } else {
      targetCycleDate = currentCycleDate;
    }

    // Retrieve any existing sleep log for this member + cycleDate
    const { data: existingLogs } = await getMemberSleepLogs(member.id, targetCycleDate, targetCycleDate);
    const existingLog = existingLogs && existingLogs.length > 0 ? existingLogs[0] : null;

    let wokeUpUtcIso: string;
    let wokeUpLocalStr: string;
    let wakeSource: 'button' | 'manual';
    let wokeUpDateTime: DateTime;

    if (mode === 'button' && cycleDate && cycleDate !== currentCycleDate) {
      return NextResponse.json(
        { error: 'Historical wake-up entries require manual mode with a specified wake time.' },
        { status: 400 }
      );
    }

    if (mode === 'manual') {
      if (!wokeUpTime || typeof wokeUpTime !== 'string' || !TIME_FORMAT_REGEX.test(wokeUpTime.trim())) {
        return NextResponse.json(
          { error: 'Invalid wokeUpTime. Please provide a 24-hour time in HH:mm format (e.g. 07:30).' },
          { status: 400 }
        );
      }
      const cleanTime = wokeUpTime.trim();
      const [wH, wM] = cleanTime.split(':').map(Number);

      const cycleDt = DateTime.fromISO(targetCycleDate, { zone: sleeperZone }).startOf('day');
      // Wake-up for a cycle occurs on the morning concluding that night: cycleDt + 1 day
      wokeUpDateTime = cycleDt
        .plus({ days: 1 })
        .set({ hour: wH, minute: wM, second: 0, millisecond: 0 });

      // Ensure wake-up is not in the future relative to now
      if (wokeUpDateTime > sleeperNow) {
        return NextResponse.json(
          { error: 'Wake-up time cannot be in the future.' },
          { status: 400 }
        );
      }

      // If in_bed_at is present, ensure wake-up is chronologically after check-in
      if (existingLog && existingLog.in_bed_at) {
        const inBedDt = DateTime.fromISO(existingLog.in_bed_at, { zone: sleeperZone });
        if (wokeUpDateTime <= inBedDt) {
          return NextResponse.json(
            { error: 'Wake-up time must be after check-in bedtime.' },
            { status: 400 }
          );
        }
      }

      wokeUpUtcIso = wokeUpDateTime.toUTC().toISO()!;
      wokeUpLocalStr = cleanTime;
      wakeSource = 'manual';
    } else {
      // Instant button mode: use exact current timestamp
      wokeUpDateTime = sleeperNow;
      wokeUpUtcIso = nowUtc.toISO()!;
      wokeUpLocalStr = sleeperNow.toFormat('HH:mm');
      wakeSource = 'button';
    }

    // Resolve target bedtime & wake time for the cycle using getNightScheduleDateTime
    const cycleDt = DateTime.fromISO(targetCycleDate, { zone: sleeperZone }).startOf('day');
    const nightSchedule = getNightScheduleDateTime(member, cycleDt);

    // Calculate sleep duration in minutes if in_bed_at (or in_bed_local_time/target_bedtime) is available
    let durationMinutes: number | null = null;
    let inBedReferenceDt: DateTime | null = null;

    if (existingLog?.in_bed_at) {
      inBedReferenceDt = DateTime.fromISO(existingLog.in_bed_at, { zone: sleeperZone });
    } else if (existingLog?.in_bed_local_time) {
      const [bH, bM] = existingLog.in_bed_local_time.split(':').map(Number);
      const isPastMidnight = bH >= 0 && bH < 6;
      inBedReferenceDt = (isPastMidnight ? cycleDt.plus({ days: 1 }) : cycleDt).set({
        hour: bH,
        minute: bM,
        second: 0,
        millisecond: 0,
      });
    } else {
      inBedReferenceDt = nightSchedule.bedtimeDateTime;
    }

    if (inBedReferenceDt && wokeUpDateTime > inBedReferenceDt) {
      const rawDiff = wokeUpDateTime.diff(inBedReferenceDt, 'minutes').minutes;
      durationMinutes = Math.min(1440, Math.max(1, Math.round(rawDiff)));
    }

    // Upsert the sleep log entry
    const { data: updatedSleepLog, error: upsertErr, isDurable } = await upsertSleepLog({
      member_id: member.id,
      cycle_date: targetCycleDate,
      timezone: member.timezone,
      target_bedtime: existingLog?.target_bedtime || nightSchedule.bedtimeStr,
      target_wake_time: existingLog?.target_wake_time || nightSchedule.wakeTimeStr,
      woke_up_at: wokeUpUtcIso,
      woke_up_local_time: wokeUpLocalStr,
      wake_source: wakeSource,
      duration_minutes: durationMinutes,
      status: existingLog?.status || 'on_time',
    });

    if (!updatedSleepLog) {
      console.error('[wake-up] Error during sleep_logs upsert:', upsertErr);
      return NextResponse.json(
        { error: 'Failed to durably persist sleep log.' },
        { status: 500 }
      );
    }

    // Update member record: update last_woke_up_at & last_wake_cycle_date only if newer
    const isNewerWake =
      !member.last_woke_up_at ||
      wokeUpDateTime >= DateTime.fromISO(member.last_woke_up_at, { zone: 'utc' });

    const memberUpdates: Record<string, any> = {
      updated_at: nowUtc.toISO(),
    };

    if (isNewerWake) {
      memberUpdates.last_woke_up_at = wokeUpUtcIso;
      memberUpdates.last_wake_cycle_date = targetCycleDate;
    }

    if (member.last_notified_stage === 'IN_BED_EARLY' && member.last_notified_cycle_date === targetCycleDate) {
      memberUpdates.last_notified_stage = null;
    }

    const { data: updatedMember } = await updateMemberSafe(member.id, memberUpdates);

    // Record WOKE_UP notification log for backwards compatibility with roster queries
    await supabaseAdmin
      .from('notification_logs')
      .upsert(
        {
          member_id: member.id,
          notification_type: 'WOKE_UP',
          local_date: targetCycleDate,
          dispatched_at: nowUtc.toISO(),
        },
        { onConflict: 'member_id,notification_type,local_date' }
      );

    const formattedDuration = durationMinutes
      ? `${Math.floor(durationMinutes / 60)}h ${durationMinutes % 60}m`
      : null;

    return NextResponse.json({
      success: true,
      message: formattedDuration
        ? `Good morning! Logged ${formattedDuration} of sleep.`
        : 'Good morning! Wake-up logged.',
      member: updatedMember ? sanitizeMember(updatedMember) : sanitizeMember(member),
      sleep_log: updatedSleepLog,
      isDurable: Boolean(isDurable),
      duration_minutes: durationMinutes,
      formatted_duration: formattedDuration,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
