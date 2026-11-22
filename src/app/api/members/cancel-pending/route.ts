import { NextResponse } from 'next/server';
import {
  supabaseAdmin,
  Member,
  updateMemberSafe,
  removeInMemorySleepLog,
  isSupabaseConfigured,
  isTestMemberFixture,
} from '@/lib/db';
import { sanitizeMember } from '@/lib/auth';
import { pendingScheduleSnapshot } from '@/lib/pendingSchedule';
import { authorizeProfileAction, cancelOwnSleepCheckIn, staffIdentity, staffWriteError } from '@/lib/moderation';
import { calculateSleepStreak, resolveActiveSleepCycleWindow } from '@/lib/sleepEngine';
import { toValidLuxonZone } from '@/lib/timezone';
import { DateTime } from 'luxon';

/**
 * POST: Cancel a member's pending schedule changes during the 48-hour cooldown window,
 * or cancel an active pending/in-bed check-in state.
 * Requires the linked Discord session or an authorized staff session.
 *
 * @param request - Incoming HTTP request with member_id
 * @returns JSON response confirming cancellation of pending changes
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { member_id, memberId, action, type } = body;
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
    const staff = await authorizeProfileAction(request, member);
    if (staff instanceof Response) return staff;

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

    let updatedMember: Member;
    if (staff) {
      const identity = staffIdentity(staff);
      const { data, error } = shouldCancelInBed
        ? await supabaseAdmin.rpc('moderate_sleep', {
            ...identity, p_target_id: member.id, p_action: 'cancel_pending_and_checkin', p_cycle: localDate,
            p_now: nowUtc.toISO(), p_expected_updated_at: member.updated_at,
          })
        : await supabaseAdmin.rpc('moderate_roster_member', {
            ...identity, p_target_id: member.id, p_action: 'cancel_cooldown',
            p_expected_pending: pendingScheduleSnapshot(member),
          });
      if (error || !data) return staffWriteError(error);
      if (shouldCancelInBed) removeInMemorySleepLog(member.id, localDate);
      updatedMember = shouldCancelInBed ? { ...data.member, is_in_bed: false, is_woke_up: false } : data;
    } else if (shouldCancelInBed && isSupabaseConfigured && !isTestMemberFixture(member.id)) {
      const result = await cancelOwnSleepCheckIn(member, localDate, true);
      if (result instanceof Response) return result;
      updatedMember = result;
    } else {
      const { data, error } = await updateMemberSafe(targetMemberId, updateFields, {
        conditions: { is_active: true, discord_id: member.discord_id },
      });
      if (error || !data) {
        return NextResponse.json({ error: error?.message || 'Failed to cancel pending change.' }, { status: 500 });
      }
      updatedMember = data;
      if (shouldCancelInBed) removeInMemorySleepLog(member.id, localDate);
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
