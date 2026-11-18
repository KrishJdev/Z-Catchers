import { NextResponse } from 'next/server';
import {
  supabaseAdmin,
  Member,
  updateMemberSafe,
  deleteSleepLog,
  isSupabaseConfigured,
  isTestMemberFixture,
} from '@/lib/db';
import { verifyPin, verifyModPasscode, sanitizeMember, getRequestSessionMemberId } from '@/lib/auth';
import {
  getClientIp,
  checkPinRateLimitPersistent,
  recordPinFailurePersistent,
  resetPinFailurePersistent,
} from '@/lib/rateLimit';
import { calculateSleepStreak, resolveActiveSleepCycleWindow } from '@/lib/sleepEngine';
import { toValidLuxonZone } from '@/lib/timezone';
import { DateTime } from 'luxon';

/**
 * POST: Cancel a member's pending schedule changes during the 48-hour cooldown window,
 * or cancel an active pending/in-bed check-in state.
 * Requires member PIN authentication or moderator passcode override.
 *
 * @param request - Incoming HTTP request with member_id and PIN or mod_passcode
 * @returns JSON response confirming cancellation of pending changes
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { member_id, memberId, pin, mod_passcode, action, type } = body;
    const targetMemberId = member_id || memberId;

    if (!targetMemberId) {
      return NextResponse.json({ error: 'Missing member_id' }, { status: 400 });
    }

    const { data: memberData, error: fetchError } = await supabaseAdmin
      .from('members')
      .select('*')
      .eq('id', targetMemberId)
      .single();

    if (fetchError || !memberData) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    const member = memberData as Member;
    const clientIp = getClientIp(request);

    const sessionMemberId = getRequestSessionMemberId(request);
    const isSessionOwner = Boolean(sessionMemberId && sessionMemberId === member.id);

    let isModerator = false;
    if (mod_passcode) {
      const modGateTarget = sessionMemberId ? `mod_gate_member:${sessionMemberId}` : `mod_gate_ip:${clientIp}`;
      const modRate = await checkPinRateLimitPersistent(clientIp, modGateTarget);
      if (!modRate.allowed) {
        return NextResponse.json(
          {
            error: `Too many failed moderator passcode attempts. Please wait ${modRate.retryAfterSeconds} seconds before trying again.`,
          },
          {
            status: 429,
            headers: { 'Retry-After': String(modRate.retryAfterSeconds) },
          }
        );
      }

      isModerator = verifyModPasscode(mod_passcode);
      if (!isModerator) {
        await recordPinFailurePersistent(clientIp, modGateTarget);
      } else {
        await resetPinFailurePersistent(clientIp, modGateTarget);
      }
    }

    if (!isModerator && isSessionOwner && !member.is_active) {
      return NextResponse.json({ error: 'Member is inactive.' }, { status: 403 });
    }

    if (!isModerator && !isSessionOwner) {
      if (member.discord_id) {
        return NextResponse.json(
          { error: 'This profile is linked to a Discord account and can only be updated by its owner or a moderator.' },
          { status: 403 }
        );
      }

      if (!member.passcode_hash) {
        return NextResponse.json(
          { error: 'PIN protection or owner session is required to cancel pending schedule changes.' },
          { status: 403 }
        );
      }

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

      if (!pin || typeof pin !== 'string') {
        return NextResponse.json(
          { error: 'Invalid PIN. PIN is required to cancel your pending change.' },
          { status: 401 }
        );
      }

      if (!verifyPin(pin.trim(), member.passcode_hash)) {
        await recordPinFailurePersistent(clientIp, member.id);
        return NextResponse.json(
          { error: 'Invalid PIN. PIN is required to cancel your pending change.' },
          { status: 401 }
        );
      }
      await resetPinFailurePersistent(clientIp, member.id);
    }

    const nowUtc = DateTime.utc();
    const sleeperNow = nowUtc.setZone(toValidLuxonZone(member.timezone));
    const activeCycle = resolveActiveSleepCycleWindow(member, nowUtc, true);
    const localDate =
      member.last_notified_stage === 'IN_BED_EARLY' && member.last_notified_cycle_date
        ? member.last_notified_cycle_date
        : activeCycle.cycleAnchorDate;

    const isScheduleOnly = action === 'schedule' || type === 'schedule';

    const isCancelInBedRequested =
      !isScheduleOnly &&
      (action === 'in_bed' ||
        action === 'cancel_in_bed' ||
        action === 'cancel' ||
        type === 'in_bed');

    // Only cancel active in-bed check-in session when an explicit in-bed cancellation was requested.
    // Requests that omit action/type retain schedule-only cancellation behavior and preserve active check-in/sleep data.
    const shouldCancelInBed = isCancelInBedRequested;

    let cleanupError: any = null;
    if (shouldCancelInBed) {
      // 1. Clean up notification logs
      if (isSupabaseConfigured && !isTestMemberFixture(member.id)) {
        try {
          const { error: earlyErr } = await supabaseAdmin
            .from('notification_logs')
            .delete()
            .eq('member_id', member.id)
            .eq('notification_type', 'IN_BED_EARLY')
            .eq('local_date', localDate);

          if (earlyErr) {
            console.warn('[cancel-pending] Error deleting IN_BED_EARLY notification logs:', earlyErr);
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
            console.warn('[cancel-pending] Error deleting WOKE_UP notification logs:', wokeErr);
            cleanupError = wokeErr;
          }
        } catch (err) {
          if (!cleanupError) cleanupError = err;
        }
      }

      // 2. Clean up today's sleep history entry in sleep_logs
      try {
        const sleepLogRes = await deleteSleepLog(member.id, localDate);
        if ((sleepLogRes.error || !sleepLogRes.success) && !cleanupError) {
          console.warn('[cancel-pending] Error deleting sleep log:', sleepLogRes.error);
          cleanupError = sleepLogRes.error || new Error('Failed to delete sleep log');
        }
      } catch (err) {
        if (!cleanupError) cleanupError = err;
      }
    }

    if (cleanupError) {
      return NextResponse.json(
        { error: 'Failed to clean up sleep records during cancellation.' },
        { status: 500 }
      );
    }

    const updateFields: Record<string, unknown> = {
      pending_bedtime_local: null,
      pending_wake_time_local: null,
      pending_timezone: null,
      pending_weekend_bedtime_local: null,
      pending_weekend_wake_time_local: null,
      pending_weekly_schedule: null,
      pending_effective_at: null,
      updated_at: nowUtc.toISO() as string,
    };

    if (shouldCancelInBed) {
      updateFields.is_in_bed = false;
      updateFields.in_bed_at = null;
      updateFields.is_woke_up = false;
      if (member.last_notified_stage === 'IN_BED_EARLY' || member.last_notified_cycle_date === localDate) {
        updateFields.last_notified_stage = null;
        updateFields.last_notified_cycle_date = null;
      }
      if (member.last_wake_cycle_date === localDate) {
        updateFields.last_wake_cycle_date = null;
        updateFields.last_woke_up_at = null;
      }
    }

    const { data: updatedMember, error: updateError } = await updateMemberSafe(
      targetMemberId,
      updateFields,
      { requireUnlinkedDiscord: !isModerator && !isSessionOwner }
    );

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message || 'Failed to cancel pending change' },
        { status: 500 }
      );
    }

    if (!updatedMember) {
      return NextResponse.json(
        { error: 'This profile has been linked to a Discord account and can only be updated by its owner or a moderator.' },
        { status: 409 }
      );
    }

    // Recalculate streak
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

    const hasSchedulePending = Boolean(member.pending_bedtime_local || member.pending_effective_at);
    const message = hasSchedulePending
      ? 'Pending schedule change cancelled. Existing schedule remains active.'
      : 'Pending in-bed state cancelled. Status restored based on current schedule.';

    const resolvedIsInBed = Boolean(updatedMember.is_in_bed);
    const resolvedIsWokeUp = Boolean(updatedMember.is_woke_up);

    return NextResponse.json({
      success: true,
      message,
      member: sanitizeMember({
        ...(updatedMember as Member),
        streak_days: streakDays,
        is_in_bed: resolvedIsInBed,
        is_woke_up: resolvedIsWokeUp,
      }),
      streak_days: streakDays,
      is_in_bed: resolvedIsInBed,
      is_woke_up: resolvedIsWokeUp,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
