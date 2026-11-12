import { NextResponse } from 'next/server';
import {
  supabaseAdmin,
  Member,
  updateMemberSafe,
  insertMemberSafe,
  hydrateMemberWeekendHours,
} from '@/lib/db';
import { verifyModPasscode, hashPin, sanitizeMember, verifyModeratorAuthorization, getRequestSessionMemberId } from '@/lib/auth';
import {
  getClientIp,
  checkPinRateLimitPersistent,
  recordPinFailurePersistent,
  resetPinFailurePersistent,
} from '@/lib/rateLimit';
import { DEMO_SEED_FINGERPRINTS, isDemoSeedMember } from '@/lib/demoSeed';
import { checkCooldownPromotion, getSleepCycleDate } from '@/lib/sleepEngine';
import { isValidTimezone, formatGmtOffset, DAY_KEYS, type DayKey, type WeeklySchedule, type DailySchedule } from '@/lib/timezone';
import { resolveMemberStrikeCounts, modAdjustStrikes, modClearStrikeLog } from '@/lib/strikes';
import { DateTime } from 'luxon';

const DISCORD_JOURNAL_REGEX = /^https:\/\/(ptb\.|canary\.)?discord\.com\/channels\/\d+\/\d+(\/\d+)?$/;
const TIME_FORMAT_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * GET: Fetch all members (including inactive and pending schedules) for moderator view.
 *
 * @param request - Incoming HTTP request with moderator credentials or session
 * @returns JSON response containing list of all members
 */
export async function GET(request: Request) {
  try {
    const clientIp = getClientIp(request);
    const sessionMemberId = getRequestSessionMemberId(request);
    const modTarget = sessionMemberId ? `mod_member:${sessionMemberId}` : `mod_ip:${clientIp}`;

    const rateCheck = await checkPinRateLimitPersistent(clientIp, modTarget);
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

    const authResult = await verifyModeratorAuthorization(request);
    if (!authResult.authorized) {
      await recordPinFailurePersistent(clientIp, modTarget);
      return NextResponse.json(
        { error: authResult.error || 'Unauthorized: Invalid moderator passcode or session.' },
        { status: 401 }
      );
    }

    await resetPinFailurePersistent(clientIp, modTarget);

    // Fetch all members with service role (includes is_active = false)
    const { data: members, error } = await supabaseAdmin
      .from('members')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Run self-healing promotion check on all members
    const processedMembers: Member[] = [];
    for (const member of (members as Member[]) || []) {
      const { promoted, activeMember } = checkCooldownPromotion(member);
      if (promoted) {
        await updateMemberSafe(member.id, {
          bedtime_local: activeMember.bedtime_local,
          wake_time_local: activeMember.wake_time_local,
          timezone: activeMember.timezone,
          weekend_bedtime_local: activeMember.weekend_bedtime_local || null,
          weekend_wake_time_local: activeMember.weekend_wake_time_local || null,
          weekly_schedule: activeMember.weekly_schedule || member.weekly_schedule || null,
          pending_bedtime_local: null,
          pending_wake_time_local: null,
          pending_timezone: null,
          pending_weekend_bedtime_local: null,
          pending_weekend_wake_time_local: null,
          pending_weekly_schedule: null,
          pending_effective_at: null,
          updated_at: DateTime.utc().toISO() as string,
        });
      }
      const hydrated = hydrateMemberWeekendHours(activeMember);
      const strikeCounts = await resolveMemberStrikeCounts(hydrated);
      processedMembers.push({
        ...sanitizeMember(hydrated),
        strikes_used: strikeCounts.strikes_used,
        metastrikes_used: strikeCounts.metastrikes_used,
        strike_cycle_month: strikeCounts.strike_cycle_month,
      });
    }

    return NextResponse.json({
      success: true,
      members: processedMembers,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST: Moderator operations
 * Actions:
 * - 'verify': Check if passcode is valid
 * - 'approve_cooldown': Instantly promote a pending schedule change
 * - 'cancel_cooldown': Cancel a pending schedule change without altering current schedule
 * - 'edit_member': Directly modify member profile/schedule (bypasses 48h cooldown)
 * - 'add_member': Create a new member profile
 * - 'toggle_active': Activate or deactivate a member
 * - 'reset_pin': Reset or clear a member's 4-digit PIN
 * - 'delete_member': Permanently remove a member
 */
/**
 * POST: Execute moderator administration actions.
 *
 * @param request - Incoming HTTP request with action name, moderator credentials, and action payload
 * @returns JSON response with action execution results
 */
export async function POST(request: Request) {
  try {
    const clientIp = getClientIp(request);
    const sessionMemberId = getRequestSessionMemberId(request);
    const modTarget = sessionMemberId ? `mod_member:${sessionMemberId}` : `mod_ip:${clientIp}`;

    const rateCheck = await checkPinRateLimitPersistent(clientIp, modTarget);
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

    const body = await request.json();
    const { action, mod_passcode, pin } = body;

    const authResult = await verifyModeratorAuthorization(request, mod_passcode);
    if (!authResult.authorized) {
      await recordPinFailurePersistent(clientIp, modTarget);
      return NextResponse.json(
        { error: authResult.error || 'Unauthorized: Invalid moderator secret passcode or session.' },
        { status: 401 }
      );
    }

    await resetPinFailurePersistent(clientIp, modTarget);

    // 1. Verify Passcode action
    if (action === 'verify') {
      return NextResponse.json({
        success: true,
        message: 'Moderator passcode verified successfully.',
        moderatorId: authResult.moderatorId,
        moderatorRole: authResult.moderatorRole,
      });
    }

    // 2. Approve 48-Hour Cooldown Immediately
    if (action === 'approve_cooldown') {
      const { member_id } = body;
      if (!member_id) {
        return NextResponse.json({ error: 'Missing member_id' }, { status: 400 });
      }

      const { data: member, error: fetchErr } = await supabaseAdmin
        .from('members')
        .select('*')
        .eq('id', member_id)
        .single();

      if (fetchErr || !member) {
        return NextResponse.json({ error: 'Member not found' }, { status: 404 });
      }

      if (!member.pending_effective_at || (!member.pending_bedtime_local && !member.pending_weekend_bedtime_local && !member.pending_weekly_schedule)) {
        return NextResponse.json(
          { error: 'Member does not have an active pending schedule change.' },
          { status: 400 }
        );
      }

      const nextWeekendBedtime =
        member.pending_weekend_bedtime_local !== undefined
          ? member.pending_weekend_bedtime_local
          : member.weekend_bedtime_local;
      const nextWeekendWakeTime =
        member.pending_weekend_wake_time_local !== undefined
          ? member.pending_weekend_wake_time_local
          : member.weekend_wake_time_local;
      const nextWeeklySchedule =
        member.pending_weekly_schedule || member.weekly_schedule || null;

      const { data: updated, error: updateErr } = await updateMemberSafe(member_id, {
        bedtime_local: member.pending_bedtime_local || member.bedtime_local,
        wake_time_local: member.pending_wake_time_local || member.wake_time_local,
        timezone: member.pending_timezone || member.timezone,
        weekend_bedtime_local: nextWeekendBedtime,
        weekend_wake_time_local: nextWeekendWakeTime,
        weekly_schedule: nextWeeklySchedule,
        pending_bedtime_local: null,
        pending_wake_time_local: null,
        pending_timezone: null,
        pending_weekend_bedtime_local: null,
        pending_weekend_wake_time_local: null,
        pending_weekly_schedule: null,
        pending_effective_at: null,
        updated_at: DateTime.utc().toISO() as string,
      });

      if (updateErr || !updated) {
        return NextResponse.json({ error: updateErr?.message || 'Failed to approve change' }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        message: `Approved schedule change for ${member.discord_username} immediately!`,
        member: sanitizeMember(updated as Member),
      });
    }

    // 3. Cancel / Reject Pending Cooldown
    if (action === 'cancel_cooldown') {
      const { member_id } = body;
      if (!member_id) {
        return NextResponse.json({ error: 'Missing member_id' }, { status: 400 });
      }

      const { data: updated, error: updateErr } = await updateMemberSafe(member_id, {
        pending_bedtime_local: null,
        pending_wake_time_local: null,
        pending_timezone: null,
        pending_weekend_bedtime_local: null,
        pending_weekend_wake_time_local: null,
        pending_weekly_schedule: null,
        pending_effective_at: null,
        updated_at: DateTime.utc().toISO() as string,
      });

      if (updateErr || !updated) {
        return NextResponse.json({ error: updateErr?.message || 'Failed to cancel cooldown' }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        message: 'Pending schedule change cancelled.',
        member: sanitizeMember(updated as Member),
      });
    }

    // 4. Edit Member Directly (Bypasses 48-hour cooldown)
    if (action === 'edit_member') {
      const {
        member_id,
        discord_username,
        discord_handle,
        journal_url,
        bedtime_local,
        wake_time_local,
        timezone,
        weekend_bedtime_local,
        weekend_wake_time_local,
        weekly_schedule,
        role,
      } = body;

      if (!member_id) {
        return NextResponse.json({ error: 'Missing member_id' }, { status: 400 });
      }

      const { data: existing, error: fetchErr } = await supabaseAdmin
        .from('members')
        .select('*')
        .eq('id', member_id)
        .single();

      if (fetchErr || !existing) {
        return NextResponse.json({ error: 'Member not found' }, { status: 404 });
      }

      if (journal_url && !DISCORD_JOURNAL_REGEX.test(journal_url.trim())) {
        return NextResponse.json(
          { error: 'Invalid Discord journal thread URL.' },
          { status: 400 }
        );
      }

      let targetWeeklySchedule: WeeklySchedule;

      if (weekly_schedule !== undefined && weekly_schedule !== null) {
        if (typeof weekly_schedule !== 'object' || Array.isArray(weekly_schedule)) {
          return NextResponse.json(
            { error: 'weekly_schedule must be a valid 7-day schedule object.' },
            { status: 400 }
          );
        }

        for (const day of DAY_KEYS) {
          const daySched = weekly_schedule[day];
          if (!daySched || typeof daySched !== 'object') {
            return NextResponse.json(
              { error: `Missing daily schedule for day "${day}". All 7 days must be provided.` },
              { status: 400 }
            );
          }
          if (!daySched.bedtime || typeof daySched.bedtime !== 'string' || !TIME_FORMAT_REGEX.test(daySched.bedtime.trim())) {
            return NextResponse.json(
              { error: `Invalid bedtime format for "${day}". Must be 24-hour "HH:mm" format (e.g. "23:30").` },
              { status: 400 }
            );
          }
          if (!daySched.wake_time || typeof daySched.wake_time !== 'string' || !TIME_FORMAT_REGEX.test(daySched.wake_time.trim())) {
            return NextResponse.json(
              { error: `Invalid wake_time format for "${day}". Must be 24-hour "HH:mm" format (e.g. "07:00").` },
              { status: 400 }
            );
          }
          if (daySched.bedtime.trim() === daySched.wake_time.trim()) {
            return NextResponse.json(
              { error: `Invalid schedule for "${day}": Bedtime and wake time cannot be identical.` },
              { status: 400 }
            );
          }
        }

        targetWeeklySchedule = {
          mon: { bedtime: weekly_schedule.mon.bedtime.trim(), wake_time: weekly_schedule.mon.wake_time.trim() },
          tue: { bedtime: weekly_schedule.tue.bedtime.trim(), wake_time: weekly_schedule.tue.wake_time.trim() },
          wed: { bedtime: weekly_schedule.wed.bedtime.trim(), wake_time: weekly_schedule.wed.wake_time.trim() },
          thu: { bedtime: weekly_schedule.thu.bedtime.trim(), wake_time: weekly_schedule.thu.wake_time.trim() },
          fri: { bedtime: weekly_schedule.fri.bedtime.trim(), wake_time: weekly_schedule.fri.wake_time.trim() },
          sat: { bedtime: weekly_schedule.sat.bedtime.trim(), wake_time: weekly_schedule.sat.wake_time.trim() },
          sun: { bedtime: weekly_schedule.sun.bedtime.trim(), wake_time: weekly_schedule.sun.wake_time.trim() },
        };
      } else {
        if (bedtime_local && !TIME_FORMAT_REGEX.test(bedtime_local.trim())) {
          return NextResponse.json(
            { error: 'Bedtime must be in "HH:mm" format (e.g. "23:30").' },
            { status: 400 }
          );
        }
        if (wake_time_local && !TIME_FORMAT_REGEX.test(wake_time_local.trim())) {
          return NextResponse.json(
            { error: 'Wake time must be in "HH:mm" format (e.g. "07:00").' },
            { status: 400 }
          );
        }
        if (
          weekend_bedtime_local &&
          weekend_bedtime_local.trim() !== '' &&
          !TIME_FORMAT_REGEX.test(weekend_bedtime_local.trim())
        ) {
          return NextResponse.json(
            { error: 'Weekend bedtime must be in "HH:mm" format (e.g. "00:30").' },
            { status: 400 }
          );
        }
        if (
          weekend_wake_time_local &&
          weekend_wake_time_local.trim() !== '' &&
          !TIME_FORMAT_REGEX.test(weekend_wake_time_local.trim())
        ) {
          return NextResponse.json(
            { error: 'Weekend wake time must be in "HH:mm" format (e.g. "09:00").' },
            { status: 400 }
          );
        }

        const baseBedtime = (bedtime_local ? bedtime_local.trim() : existing.bedtime_local) || '23:00';
        const baseWakeTime = (wake_time_local ? wake_time_local.trim() : existing.wake_time_local) || '07:00';
        const weekendBedtimeVal =
          weekend_bedtime_local !== undefined
            ? weekend_bedtime_local && weekend_bedtime_local.trim() !== ''
              ? weekend_bedtime_local.trim()
              : null
            : (existing.weekend_bedtime_local || null);
        const weekendWakeTimeVal =
          weekend_wake_time_local !== undefined
            ? weekend_wake_time_local && weekend_wake_time_local.trim() !== ''
              ? weekend_wake_time_local.trim()
              : null
            : (existing.weekend_wake_time_local || null);

        if (existing.weekly_schedule && !bedtime_local && !wake_time_local && weekend_bedtime_local === undefined && weekend_wake_time_local === undefined) {
          targetWeeklySchedule = existing.weekly_schedule;
        } else if (existing.weekly_schedule) {
          targetWeeklySchedule = JSON.parse(JSON.stringify(existing.weekly_schedule));
          const weekdays: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'sun'];
          const weekends: DayKey[] = ['fri', 'sat'];
          if (bedtime_local) {
            for (const d of weekdays) targetWeeklySchedule[d].bedtime = bedtime_local.trim();
          }
          if (wake_time_local) {
            for (const d of weekdays) targetWeeklySchedule[d].wake_time = wake_time_local.trim();
          }
          if (weekend_bedtime_local !== undefined) {
            for (const d of weekends) {
              targetWeeklySchedule[d].bedtime = weekend_bedtime_local?.trim() || targetWeeklySchedule.mon.bedtime;
            }
          }
          if (weekend_wake_time_local !== undefined) {
            for (const d of weekends) {
              targetWeeklySchedule[d].wake_time = weekend_wake_time_local?.trim() || targetWeeklySchedule.mon.wake_time;
            }
          }
        } else {
          targetWeeklySchedule = {
            mon: { bedtime: baseBedtime, wake_time: baseWakeTime },
            tue: { bedtime: baseBedtime, wake_time: baseWakeTime },
            wed: { bedtime: baseBedtime, wake_time: baseWakeTime },
            thu: { bedtime: baseBedtime, wake_time: baseWakeTime },
            fri: { bedtime: weekendBedtimeVal || baseBedtime, wake_time: weekendWakeTimeVal || baseWakeTime },
            sat: { bedtime: weekendBedtimeVal || baseBedtime, wake_time: weekendWakeTimeVal || baseWakeTime },
            sun: { bedtime: baseBedtime, wake_time: baseWakeTime },
          };
        }
      }

      if (timezone && !isValidTimezone(timezone.trim())) {
        return NextResponse.json(
          { error: `Invalid timezone "${timezone}". Please select a valid GMT offset or IANA zone.` },
          { status: 400 }
        );
      }

      const hasScheduleUpdate =
        (weekly_schedule !== undefined && weekly_schedule !== null) ||
        bedtime_local !== undefined ||
        wake_time_local !== undefined ||
        weekend_bedtime_local !== undefined ||
        weekend_wake_time_local !== undefined;

      const syncBedtime = targetWeeklySchedule.mon.bedtime;
      const syncWakeTime = targetWeeklySchedule.mon.wake_time;
      const syncWeekendBedtime = targetWeeklySchedule.sat.bedtime;
      const syncWeekendWakeTime = targetWeeklySchedule.sat.wake_time;

      const isTargetMod = role === 'moderator';
      const updates: Partial<Member> = {
        discord_username: discord_username?.trim() || existing.discord_username,
        discord_handle:
          discord_handle !== undefined
            ? discord_handle?.trim() || null
            : existing.discord_handle,
        journal_url: journal_url?.trim() || existing.journal_url,
        timezone: timezone ? timezone.trim() : existing.timezone,
        role: isTargetMod ? 'moderator' : 'member',
        is_moderator: isTargetMod,
        updated_at: DateTime.utc().toISO() as string,
      };

      if (hasScheduleUpdate) {
        updates.bedtime_local = syncBedtime;
        updates.wake_time_local = syncWakeTime;
        updates.weekend_bedtime_local = syncWeekendBedtime;
        updates.weekend_wake_time_local = syncWeekendWakeTime;
        updates.weekly_schedule = targetWeeklySchedule;
        updates.pending_bedtime_local = null;
        updates.pending_wake_time_local = null;
        updates.pending_timezone = null;
        updates.pending_weekend_bedtime_local = null;
        updates.pending_weekend_wake_time_local = null;
        updates.pending_weekly_schedule = null;
        updates.pending_effective_at = null;
      }

      if (timezone) {
        updates.timezone = timezone.trim();
      }

      const { data: updated, error: updateErr } = await updateMemberSafe(member_id, updates);

      if (updateErr || !updated) {
        return NextResponse.json({ error: updateErr?.message || 'Failed to update member' }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        message: `Member ${updated.discord_username} updated immediately!`,
        member: sanitizeMember(updated as Member),
      });
    }

    // 5. Add New Member
    if (action === 'add_member') {
      const {
        discord_username,
        discord_handle,
        journal_url,
        bedtime_local,
        wake_time_local = '07:00',
        timezone,
        weekend_bedtime_local,
        weekend_wake_time_local,
        role = 'member',
        pin,
      } = body;

      if (!discord_username || !journal_url || !bedtime_local || !timezone) {
        return NextResponse.json(
          { error: 'Missing required fields (username, journal_url, bedtime, timezone).' },
          { status: 400 }
        );
      }

      if (!DISCORD_JOURNAL_REGEX.test(journal_url.trim())) {
        return NextResponse.json(
          { error: 'Invalid Discord journal thread URL.' },
          { status: 400 }
        );
      }

      if (!TIME_FORMAT_REGEX.test(bedtime_local.trim())) {
        return NextResponse.json(
          { error: 'Bedtime must be in "HH:mm" format (e.g. "23:30").' },
          { status: 400 }
        );
      }

      if (!TIME_FORMAT_REGEX.test(wake_time_local.trim())) {
        return NextResponse.json(
          { error: 'Wake time must be in "HH:mm" format (e.g. "07:00").' },
          { status: 400 }
        );
      }

      if (
        weekend_bedtime_local &&
        weekend_bedtime_local.trim() !== '' &&
        !TIME_FORMAT_REGEX.test(weekend_bedtime_local.trim())
      ) {
        return NextResponse.json(
          { error: 'Weekend bedtime must be in "HH:mm" format (e.g. "00:30").' },
          { status: 400 }
        );
      }

      if (
        weekend_wake_time_local &&
        weekend_wake_time_local.trim() !== '' &&
        !TIME_FORMAT_REGEX.test(weekend_wake_time_local.trim())
      ) {
        return NextResponse.json(
          { error: 'Weekend wake time must be in "HH:mm" format (e.g. "09:00").' },
          { status: 400 }
        );
      }

      if (!isValidTimezone(timezone.trim())) {
        return NextResponse.json(
          { error: `Invalid timezone "${timezone}". Please select a valid GMT offset (e.g. "GMT+05:30").` },
          { status: 400 }
        );
      }

      const passcode_hash =
        pin && /^\d{4,6}$/.test(pin.trim()) ? hashPin(pin.trim()) : null;
      const avatar_url = `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(
        discord_username.trim()
      )}`;

      const { data, error } = await insertMemberSafe({
        discord_username: discord_username.trim(),
        discord_handle: discord_handle?.trim() || null,
        avatar_url,
        journal_url: journal_url.trim(),
        bedtime_local: bedtime_local.trim(),
        wake_time_local: wake_time_local.trim(),
        timezone: timezone.trim(),
        weekend_bedtime_local: weekend_bedtime_local?.trim() || null,
        weekend_wake_time_local: weekend_wake_time_local?.trim() || null,
        role: role === 'moderator' ? 'moderator' : 'member',
        passcode_hash,
        is_active: true,
      });

      if (error || !data) {
        return NextResponse.json({ error: error?.message || 'Failed to create member' }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        message: `Member ${data.discord_username} created successfully!`,
        member: sanitizeMember(data as Member),
      }, { status: 201 });
    }

    // 6. Toggle Member Active Status (Soft Delete / Reactivate)
    if (action === 'toggle_active') {
      const { member_id, is_active } = body;
      if (!member_id || typeof is_active !== 'boolean') {
        return NextResponse.json(
          { error: 'Missing member_id or is_active boolean.' },
          { status: 400 }
        );
      }

      const { data: updated, error: updateErr } = await updateMemberSafe(member_id, {
        is_active,
        updated_at: DateTime.utc().toISO() as string,
      });

      if (updateErr || !updated) {
        return NextResponse.json({ error: updateErr?.message || 'Failed to update member status' }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        message: `Member status set to ${is_active ? 'Active' : 'Deactivated'}.`,
        member: sanitizeMember(updated as Member),
      });
    }

    // 7. Reset or Clear Member 4-Digit PIN
    if (action === 'reset_pin') {
      const { member_id, new_pin } = body;
      if (!member_id) {
        return NextResponse.json({ error: 'Missing member_id.' }, { status: 400 });
      }

      let passcode_hash: string | null = null;
      if (new_pin && new_pin.trim().length > 0) {
        if (!/^\d{4,6}$/.test(new_pin.trim())) {
          return NextResponse.json(
            { error: 'New PIN must be 4 to 6 digits.' },
            { status: 400 }
          );
        }
        passcode_hash = hashPin(new_pin.trim());
      }

      const { data: updated, error: updateErr } = await updateMemberSafe(member_id, {
        passcode_hash,
        updated_at: DateTime.utc().toISO() as string,
      });

      if (updateErr || !updated) {
        return NextResponse.json({ error: updateErr?.message || 'Failed to reset PIN' }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        message: passcode_hash
          ? 'Member PIN reset successfully.'
          : 'Member PIN cleared. Member may now claim their profile with a new PIN.',
        member: sanitizeMember(updated as Member),
      });
    }

    // 8. Delete Member (Hard delete if desired)
    if (action === 'delete_member') {
      const { member_id } = body;
      if (!member_id) {
        return NextResponse.json({ error: 'Missing member_id.' }, { status: 400 });
      }

      const { error: delErr } = await supabaseAdmin
        .from('members')
        .delete()
        .eq('id', member_id);

      if (delErr) {
        return NextResponse.json({ error: delErr.message }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        message: 'Member removed permanently.',
      });
    }

    // 9. Purge Demo Seed Members ('Aoi', 'SarahK', 'Marcus', 'Arjun')
    if (action === 'purge_seed_members') {
      const seedNames = DEMO_SEED_FINGERPRINTS.map((s) => s.discord_username);

      // Match demo profiles specifically by name, handle, and dummy demo journal URL to protect real users
      const { data: candidates, error: findErr } = await supabaseAdmin
        .from('members')
        .select('id, discord_username, discord_handle, journal_url')
        .in('discord_username', seedNames);

      if (findErr) {
        return NextResponse.json({ error: findErr.message }, { status: 500 });
      }

      const seedIds = (candidates || []).filter(isDemoSeedMember).map((m: { id: string }) => m.id);
      if (seedIds.length === 0) {
        return NextResponse.json({
          success: true,
          message: 'No demo seed profiles found to purge.',
          purged: [],
        });
      }

      const { data: deleted, error: purgeErr } = await supabaseAdmin
        .from('members')
        .delete()
        .in('id', seedIds)
        .select('id, discord_username');

      if (purgeErr) {
        return NextResponse.json({ error: purgeErr.message }, { status: 500 });
      }

      const count = deleted ? deleted.length : 0;
      return NextResponse.json({
        success: true,
        message: `Successfully purged ${count} demo seed profiles from the den.`,
        purged: deleted,
      });
    }

    // 10. Adjust Member Strikes & Metastrikes
    if (action === 'adjust_strikes') {
      const { member_id, strikes_used, metastrikes_used } = body;
      if (!member_id) {
        return NextResponse.json({ error: 'Missing member_id' }, { status: 400 });
      }

      const strikesNum = Math.max(0, Math.min(3, parseInt(String(strikes_used ?? 0), 10)));
      const metasNum = Math.max(0, Math.min(3, parseInt(String(metastrikes_used ?? 0), 10)));

      const result = await modAdjustStrikes(member_id, strikesNum, metasNum);
      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }

      return NextResponse.json({
        success: true,
        message: 'Member strikes and metastrikes updated successfully.',
        strikes_used: strikesNum,
        metastrikes_used: metasNum,
      });
    }

    // 11. Clear Nightly Strike Log (Clear accidental vote / strike)
    if (action === 'clear_strike_log') {
      const { member_id, sleep_cycle_date } = body;
      if (!member_id) {
        return NextResponse.json({ error: 'Missing member_id' }, { status: 400 });
      }

      let cycleDate = sleep_cycle_date;
      if (!cycleDate) {
        const { data: member, error: memberErr } = await supabaseAdmin
          .from('members')
          .select('*')
          .eq('id', member_id)
          .maybeSingle();

        if (memberErr || !member) {
          return NextResponse.json({ error: 'Member not found' }, { status: 404 });
        }

        cycleDate = getSleepCycleDate(member as Member, DateTime.utc());
      }

      if (!cycleDate) {
        return NextResponse.json({ error: 'Could not resolve sleep cycle date' }, { status: 400 });
      }

      const result = await modClearStrikeLog(member_id, cycleDate);
      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }

      return NextResponse.json({
        success: true,
        message: 'Nightly strike log and associated counts cleared successfully.',
        sleep_cycle_date: cycleDate,
      });
    }

    return NextResponse.json(
      { error: `Unsupported action: "${action}"` },
      { status: 400 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
