import { NextResponse } from 'next/server';
import {
  supabaseAdmin,
  Member,
  updateMemberSafe,
  upsertSleepLog,
  deleteSleepLog,
  getMemberByIdSafe,
  isSupabaseConfigured,
  isTestMemberFixture,
} from '@/lib/db';
import { DateTime } from 'luxon';
import { ownsDiscordProfile, getRequestSessionMemberId, verifyModeratorAuthorization } from '@/lib/auth';
import {
  calculateSleepStreak,
  getSleepCycleDate,
  resolveActiveSleepCycle,
  resolveActiveSleepCycleWindow,
} from '@/lib/sleepEngine';
import { toValidLuxonZone } from '@/lib/timezone';


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
    const yesterdayDate = sleeperNow.minus({ days: 1 }).startOf('day').toISODate()!;

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
    const wokeUpDates = (logs || [])
      .filter((l: { notification_type: string }) => l.notification_type === 'WOKE_UP')
      .map((l: { local_date: string }) => l.local_date);

    const hasOpenYesterday =
      checkinDates.includes(yesterdayDate) && !wokeUpDates.includes(yesterdayDate);

    const activeCycle = resolveActiveSleepCycleWindow(
      member,
      DateTime.utc(),
      hasOpenYesterday || Boolean(member.is_in_bed)
    );
    const cycleDate = activeCycle.cycleAnchorDate;
    const isInBed = checkinDates.includes(cycleDate);
    const isWokeUp = wokeUpDates.includes(cycleDate);
    const streakDays = calculateSleepStreak(checkinDates, sleeperNow);

    return NextResponse.json({
      member_id: member.id,
      is_in_bed: isInBed && !isWokeUp,
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
 * Requires the linked Discord session or moderator authorization.
 *
 * @param request - Incoming HTTP request with memberId, and action
 * @returns JSON response with updated in-bed status and recalculated streak days
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { memberId, action = 'check_in' } = body;

    if (!memberId) {
      return NextResponse.json({ error: 'Missing required field: memberId' }, { status: 400 });
    }

    const { data: rawMember, error: memberErr } = await getMemberByIdSafe(memberId);

    if (memberErr || !rawMember) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    const member = rawMember;

    const sessionMemberId = getRequestSessionMemberId(request);
    if (!member.is_active || (!ownsDiscordProfile(request, member) &&
        !(await verifyModeratorAuthorization(request)).authorized)) {
      return NextResponse.json(
        { error: 'Sign in with the Discord account linked to this profile.', code: sessionMemberId ? 'FORBIDDEN' : 'UNAUTHORIZED' },
        { status: sessionMemberId ? 403 : 401 }
      );
    }

    const nowUtc = DateTime.utc();
    const sleeperNow = nowUtc.setZone(toValidLuxonZone(member.timezone));
    
    // Standardized Active Sleep Cycle Window Resolution
    const activeCheckinWindow = resolveActiveSleepCycleWindow(member, nowUtc, true);
    const localDate =
      (action === 'cancel' || action === 'wake_up') &&
      member.last_notified_stage === 'IN_BED_EARLY' &&
      member.last_notified_cycle_date
        ? member.last_notified_cycle_date
        : activeCheckinWindow.cycleAnchorDate;

    if (!localDate) {
      return NextResponse.json({ error: 'Failed to compute local date' }, { status: 500 });
    }

    if (action === 'cancel') {
      let cleanupError: any = null;

      // 1. Remove check-in and woke-up logs for member's current local date
      if (isSupabaseConfigured && !isTestMemberFixture(member.id)) {
        try {
          const { error: earlyErr } = await supabaseAdmin
            .from('notification_logs')
            .delete()
            .eq('member_id', member.id)
            .eq('notification_type', 'IN_BED_EARLY')
            .eq('local_date', localDate);

          if (earlyErr) {
            console.warn('[in-bed] Error deleting IN_BED_EARLY notification logs:', earlyErr);
            cleanupError = earlyErr;
          }
        } catch (err) {
          cleanupError = err;
        }

        try {
          const { error: wokeErr } = await supabaseAdmin
            .from('notification_logs')
            .delete()
            .eq('member_id', member.id)
            .eq('notification_type', 'WOKE_UP')
            .eq('local_date', localDate);

          if (wokeErr && !cleanupError) {
            console.warn('[in-bed] Error deleting WOKE_UP notification logs:', wokeErr);
            cleanupError = wokeErr;
          }
        } catch (err) {
          if (!cleanupError) cleanupError = err;
        }
      }

      // 2. Remove today's sleep log entry from sleep_logs
      try {
        const sleepLogRes = await deleteSleepLog(member.id, localDate);
        if ((sleepLogRes.error || !sleepLogRes.success) && !cleanupError) {
          console.warn('[in-bed] Error deleting sleep log:', sleepLogRes.error);
          cleanupError = sleepLogRes.error || new Error('Failed to delete sleep log');
        }
      } catch (err) {
        if (!cleanupError) cleanupError = err;
      }

      // 3. Reset member record state without falsely marking cycle as completed
      const updatePayload: Record<string, unknown> = {
        is_in_bed: false,
        in_bed_at: null,
        is_woke_up: false,
        updated_at: nowUtc.toISO(),
      };

      if (member.last_notified_stage === 'IN_BED_EARLY' || member.last_notified_cycle_date === localDate) {
        updatePayload.last_notified_stage = null;
        updatePayload.last_notified_cycle_date = null;
      }
      if (member.last_wake_cycle_date === localDate) {
        updatePayload.last_wake_cycle_date = null;
        updatePayload.last_woke_up_at = null;
      }

      if (cleanupError) {
        return NextResponse.json(
          { error: 'Failed to clean up sleep records during cancellation.' },
          { status: 500 }
        );
      }

      const updateRes = await updateMemberSafe(member.id, updatePayload);

      if (updateRes.error || !updateRes.data) {
        return NextResponse.json(
          { error: updateRes.error?.message || 'Failed to update member state.' },
          { status: 500 }
        );
      }

      // 4. Recompute streak after cancellation
      let checkinDates: string[] = [];
      if (isSupabaseConfigured && !isTestMemberFixture(member.id)) {
        const { data: logs } = await supabaseAdmin
          .from('notification_logs')
          .select('local_date')
          .eq('member_id', member.id)
          .eq('notification_type', 'IN_BED_EARLY')
          .order('local_date', { ascending: false })
          .limit(60);

        checkinDates = (logs || []).map((l: { local_date: string }) => l.local_date);
      }
      const streakDays = calculateSleepStreak(checkinDates, sleeperNow);

      return NextResponse.json({
        success: true,
        action: 'cancel',
        is_in_bed: false,
        is_woke_up: false,
        streak_days: streakDays,
        local_date: localDate,
        message: 'Sleep state undone. Status restored based on current schedule.',
      });
    }

    if (action === 'wake_up') {
      // Remove check-in for member's current local date
      if (isSupabaseConfigured && !isTestMemberFixture(member.id)) {
        const { error: delErr } = await supabaseAdmin
          .from('notification_logs')
          .delete()
          .eq('member_id', member.id)
          .eq('notification_type', 'IN_BED_EARLY')
          .eq('local_date', localDate);

        if (delErr) {
          return NextResponse.json({ error: delErr.message }, { status: 500 });
        }
      }

      let updateRes;
      if (member.last_notified_stage === 'IN_BED_EARLY' && member.last_notified_cycle_date === localDate) {
        updateRes = await updateMemberSafe(member.id, {
          last_notified_stage: null,
          last_woke_up_at: nowUtc.toISO(),
          last_wake_cycle_date: localDate,
          is_in_bed: false,
          is_woke_up: true,
        });
      } else {
        updateRes = await updateMemberSafe(member.id, {
          last_woke_up_at: nowUtc.toISO(),
          last_wake_cycle_date: localDate,
          is_in_bed: false,
          is_woke_up: true,
        });
      }

      if (updateRes.error || !updateRes.data) {
        return NextResponse.json(
          { error: updateRes.error?.message || 'Failed to update member state.' },
          { status: 500 }
        );
      }

      // Record WOKE_UP log to transition member from sleeping state to AWAKE
      if (isSupabaseConfigured && !isTestMemberFixture(member.id)) {
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
      }

      await upsertSleepLog({
        member_id: member.id,
        cycle_date: localDate,
        timezone: member.timezone,
        woke_up_at: nowUtc.toISO(),
        woke_up_local_time: sleeperNow.toFormat('HH:mm'),
        wake_source: 'button',
      });

      // Recompute streak after wake_up
      let checkinDates: string[] = [];
      if (isSupabaseConfigured && !isTestMemberFixture(member.id)) {
        const { data: logs } = await supabaseAdmin
          .from('notification_logs')
          .select('local_date')
          .eq('member_id', member.id)
          .eq('notification_type', 'IN_BED_EARLY')
          .order('local_date', { ascending: false })
          .limit(60);

        checkinDates = (logs || []).map((l: { local_date: string }) => l.local_date);
      }
      const streakDays = calculateSleepStreak(checkinDates, sleeperNow);

      return NextResponse.json({
        success: true,
        action: 'wake_up',
        is_in_bed: false,
        is_woke_up: true,
        streak_days: streakDays,
        message: 'Status updated to Awake and notifications restored.',
      });
    }

    // Default action: 'check_in' ("I'm in Bed" Safe Button)
    // Clear any active WOKE_UP override for tonight's sleep cycle
    if (isSupabaseConfigured && !isTestMemberFixture(member.id)) {
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
    }

    const checkinUpdateRes = await updateMemberSafe(member.id, {
      last_notified_stage: 'IN_BED_EARLY',
      last_notified_cycle_date: localDate,
      last_woke_up_at: null,
      last_wake_cycle_date: null,
      is_in_bed: true,
      is_woke_up: false,
      in_bed_at: nowUtc.toISO(),
    });

    if (checkinUpdateRes.error || !checkinUpdateRes.data) {
      return NextResponse.json(
        { error: checkinUpdateRes.error?.message || 'Failed to update member state.' },
        { status: 500 }
      );
    }

    // Record active schedule targets & status in sleep_logs
    await upsertSleepLog({
      member_id: member.id,
      cycle_date: localDate,
      timezone: member.timezone,
      target_bedtime: activeCheckinWindow.activeBedtimeLocal,
      target_wake_time: activeCheckinWindow.activeWakeTimeLocal,
      in_bed_at: nowUtc.toISO(),
      in_bed_local_time: sleeperNow.toFormat('HH:mm'),
      woke_up_at: null,
      woke_up_local_time: null,
      wake_source: null,
      duration_minutes: null,
      status: activeCheckinWindow.diffMinutes > 5 ? 'late' : 'on_time',
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
