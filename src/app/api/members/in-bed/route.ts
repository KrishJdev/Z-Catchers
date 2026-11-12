import { NextResponse } from 'next/server';
import { supabaseAdmin, Member, updateMemberSafe, upsertSleepLog, getMemberByIdSafe } from '@/lib/db';
import { DateTime } from 'luxon';
import { verifyPin, getRequestSessionMemberId, verifyModeratorAuthorization } from '@/lib/auth';
import { calculateSleepStreak, getSleepCycleDate, resolveActiveSleepCycle } from '@/lib/sleepEngine';
import { toValidLuxonZone } from '@/lib/timezone';
import {
  getClientIp,
  checkPinRateLimitPersistent,
  recordPinFailurePersistent,
  resetPinFailurePersistent,
} from '@/lib/rateLimit';

/**
 * GET: Retrieve member's in-bed status and current sleep streak for their active sleep cycle date.
 *
 * @param request - Incoming HTTP request with memberId query parameter
 * @returns JSON response with check-in status, streak count, and sleep cycle date
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const memberId = searchParams.get('memberId');

    if (!memberId) {
      return NextResponse.json({ error: 'Missing memberId query parameter' }, { status: 400 });
    }

    const { data: member, error: memberErr } = await supabaseAdmin
      .from('members')
      .select('*')
      .eq('id', memberId)
      .single();

    if (memberErr || !member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    const sleeperNow = DateTime.utc().setZone(toValidLuxonZone(member.timezone));
    const cycleDate = getSleepCycleDate(member, DateTime.utc());

    // Fetch member's recent check-ins and woke-up logs
    const { data: logs } = await supabaseAdmin
      .from('notification_logs')
      .select('notification_type, local_date')
      .eq('member_id', member.id)
      .in('notification_type', ['IN_BED_EARLY', 'WOKE_UP'])
      .order('local_date', { ascending: false })
      .limit(60);

    const checkinDates = (logs || [])
      .filter((l: { notification_type: string }) => l.notification_type === 'IN_BED_EARLY')
      .map((l: { local_date: string }) => l.local_date);
    const isInBed = checkinDates.includes(cycleDate);
    const isWokeUp = (logs || []).some(
      (l: { notification_type: string; local_date: string }) =>
        l.notification_type === 'WOKE_UP' && l.local_date === cycleDate
    );
    const streakDays = calculateSleepStreak(checkinDates, sleeperNow);

    return NextResponse.json({
      member_id: member.id,
      is_in_bed: isInBed,
      is_woke_up: isWokeUp,
      streak_days: streakDays,
      local_date: cycleDate,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST: Record an "I'm in Bed" check-in or cancel an existing check-in for tonight's sleep cycle.
 * Requires member PIN authentication or valid session cookie.
 *
 * @param request - Incoming HTTP request with memberId, action, and optional PIN
 * @returns JSON response with updated in-bed status and recalculated streak days
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { memberId, action = 'check_in', pin } = body;

    if (!memberId) {
      return NextResponse.json({ error: 'Missing required field: memberId' }, { status: 400 });
    }

    const { data: rawMember, error: memberErr } = await getMemberByIdSafe(memberId);

    if (memberErr || !rawMember) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    const member = rawMember;

    // Security Gate:
    // 1. Session must match target memberId, OR
    // 2. Authenticated server moderator (session or secret passcode), OR
    // 3. A valid PIN must be provided matching member's passcode_hash.
    const sessionMemberId = getRequestSessionMemberId(request);
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
          {
            error: 'Forbidden. You cannot check in or modify bedtime status for another member.',
            code: 'FORBIDDEN',
          },
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
            ? 'Authentication required. Please log in with your 4-digit PIN before checking in.'
            : 'Please claim your profile with a 4-digit PIN before checking in.',
          code: 'UNAUTHORIZED',
        },
        { status: 401 }
      );
    }

    const nowUtc = DateTime.utc();
    const sleeperNow = nowUtc.setZone(toValidLuxonZone(member.timezone));
    const localDate = getSleepCycleDate(member, nowUtc);

    if (!localDate) {
      return NextResponse.json({ error: 'Failed to compute local date' }, { status: 500 });
    }

    if (action === 'cancel' || action === 'wake_up') {
      // Remove check-in for member's current local date
      const { error: delErr } = await supabaseAdmin
        .from('notification_logs')
        .delete()
        .eq('member_id', member.id)
        .eq('notification_type', 'IN_BED_EARLY')
        .eq('local_date', localDate);

      if (delErr) {
        return NextResponse.json({ error: delErr.message }, { status: 500 });
      }

      if (member.last_notified_stage === 'IN_BED_EARLY' && member.last_notified_cycle_date === localDate) {
        await updateMemberSafe(member.id, {
          last_notified_stage: null,
          last_woke_up_at: nowUtc.toISO(),
          last_wake_cycle_date: localDate,
        });
      } else {
        await updateMemberSafe(member.id, {
          last_woke_up_at: nowUtc.toISO(),
          last_wake_cycle_date: localDate,
        });
      }

      // Record WOKE_UP log to transition member from sleeping state to AWAKE
      await supabaseAdmin
        .from('notification_logs')
        .upsert(
          {
            member_id: member.id,
            notification_type: 'WOKE_UP',
            local_date: localDate,
            dispatched_at: nowUtc.toISO(),
          },
          { onConflict: 'member_id,notification_type,local_date' }
        );

      // If action is explicit wake_up, record in sleep_logs
      if (action === 'wake_up') {
        await upsertSleepLog({
          member_id: member.id,
          cycle_date: localDate,
          timezone: member.timezone,
          woke_up_at: nowUtc.toISO(),
          woke_up_local_time: sleeperNow.toFormat('HH:mm'),
          wake_source: 'button',
        });
      }

      // Recompute streak after cancellation
      const { data: logs } = await supabaseAdmin
        .from('notification_logs')
        .select('local_date')
        .eq('member_id', member.id)
        .eq('notification_type', 'IN_BED_EARLY')
        .order('local_date', { ascending: false })
        .limit(60);

      const checkinDates = (logs || []).map((l: { local_date: string }) => l.local_date);
      const streakDays = calculateSleepStreak(checkinDates, sleeperNow);

      return NextResponse.json({
        success: true,
        action: 'cancel',
        is_in_bed: false,
        is_woke_up: true,
        streak_days: streakDays,
        message: 'Sleep state undone. Status updated to Awake and notifications restored.',
      });
    }

    // Default action: 'check_in' ("I'm in Bed" Safe Button)
    // Clear any active WOKE_UP override for tonight's sleep cycle
    await supabaseAdmin
      .from('notification_logs')
      .delete()
      .eq('member_id', member.id)
      .eq('notification_type', 'WOKE_UP')
      .eq('local_date', localDate);

    const { error: insertErr } = await supabaseAdmin
      .from('notification_logs')
      .upsert(
        {
          member_id: member.id,
          notification_type: 'IN_BED_EARLY',
          local_date: localDate,
          dispatched_at: nowUtc.toISO(),
        },
        { onConflict: 'member_id,notification_type,local_date' }
      );

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    await updateMemberSafe(member.id, {
      last_notified_stage: 'IN_BED_EARLY',
      last_notified_cycle_date: localDate,
    });

    // Resolve active schedule for this sleep cycle to record targets & status in sleep_logs
    const activeCycle = resolveActiveSleepCycle(member, sleeperNow, true);
    await upsertSleepLog({
      member_id: member.id,
      cycle_date: localDate,
      timezone: member.timezone,
      target_bedtime: activeCycle.activeBedtimeLocal,
      target_wake_time: activeCycle.activeWakeTimeLocal,
      in_bed_at: nowUtc.toISO(),
      in_bed_local_time: sleeperNow.toFormat('HH:mm'),
      status: activeCycle.diffMinutes > 5 ? 'late' : 'on_time',
    });

    // Compute updated streak
    const { data: logs } = await supabaseAdmin
      .from('notification_logs')
      .select('local_date')
      .eq('member_id', member.id)
      .eq('notification_type', 'IN_BED_EARLY')
      .order('local_date', { ascending: false })
      .limit(60);

    const checkinDates = (logs || []).map((l: { local_date: string }) => l.local_date);
    const streakDays = calculateSleepStreak(checkinDates, sleeperNow);

    return NextResponse.json({
      success: true,
      action: 'check_in',
      is_in_bed: true,
      is_woke_up: false,
      local_date: localDate,
      streak_days: streakDays,
      message: 'Sweet dreams! You are checked in and community nag alerts are suppressed for tonight.',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
