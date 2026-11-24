import { NextResponse } from 'next/server';
import {
  supabaseAdmin,
  Member,
  type ModerationRosterMember,
  updateMemberSafe,
  getMemberByIdSafe,
} from '@/lib/db';
import { canModerateTarget, isSameOriginMutation, sanitizeMember, verifyModeratorSession, getRequestSession } from '@/lib/auth';
import { staffIdentity, staffWriteError } from '@/lib/moderation';
import { pendingScheduleSnapshot } from '@/lib/pendingSchedule';
import { DEMO_SEED_FINGERPRINTS, isDemoSeedMember } from '@/lib/demoSeed';
import { checkCooldownPromotion, getSleepCycleDate } from '@/lib/sleepEngine';
import { isValidTimezone, DAY_KEYS, type DayKey, type WeeklySchedule } from '@/lib/timezone';
import { resolveMemberStrikeCounts, modAdjustPasses, modClearMetastrikeLog } from '@/lib/strikes';
import { punishmentDependencyResponse, punishmentResponse, punishmentRpcResponse, UUID_PATTERN } from '@/lib/punishments';
import { DateTime } from 'luxon';

const DISCORD_JOURNAL_REGEX = /^https:\/\/(ptb\.|canary\.)?discord\.com\/channels\/\d+\/\d+(\/\d+)?$/;
const TIME_FORMAT_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const STRIKE_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const CYCLE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

async function setModerator(request: Request, body: Record<string, unknown>) {
  const session = getRequestSession(request);
  if (!session?.discordId) {
    return NextResponse.json({ error: 'Sign in with your linked Discord account.' }, { status: 401 });
  }

  const { member_id, expected_role, new_role } = body;
  if (typeof member_id !== 'string' || !UUID_PATTERN.test(member_id) ||
      (expected_role !== 'member' && expected_role !== 'moderator') ||
      (new_role !== 'member' && new_role !== 'moderator') || expected_role === new_role) {
    return NextResponse.json(
      { error: 'Supply a valid member_id and a transition between member and moderator.' },
      { status: 400 }
    );
  }

  // Use the signed identity; the RPC checks the actor's live owner role under lock.
  const { data: role, error } = await supabaseAdmin.rpc('set_moderator', {
    p_actor_id: session.memberId,
    p_actor_discord_id: session.discordId,
    p_target_id: member_id,
    p_expected_role: expected_role,
    p_new_role: new_role,
  });

  if (error && /^PT(400|403|404|409)$/.test(error.code)) {
    return NextResponse.json({ error: error.message }, { status: Number(error.code.slice(2)) });
  }
  if (error || role !== new_role) {
    console.error('[mod] Could not change moderator role:', error?.code);
    return NextResponse.json({ error: 'Moderator assignment is currently unavailable.' }, { status: 503 });
  }
  return NextResponse.json({ success: true, member_id, role });
}

/**
 * GET: Fetch all members (including inactive and pending schedules) for moderator view.
 *
 * @param request - Incoming HTTP request with a linked Discord session
 * @returns JSON response containing list of all members
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const review = params.get('view') === 'strike_month';
  try {
    const auth = await verifyModeratorSession(request);
    if (!auth.authorized) {
      if (review && auth.status === 503) return punishmentDependencyResponse('moderator read', auth.databaseCode);
      return review ? punishmentResponse({ error: auth.error }, auth.status)
        : NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    if (review) {
      const memberId = params.get('member_id');
      const month = params.get('month');
      if (!memberId || !UUID_PATTERN.test(memberId) ||
          (month !== null && (!STRIKE_MONTH_PATTERN.test(month) || month < '2026-11'))) {
        return punishmentResponse({ error: 'Choose a member and an available strike month.' }, 400);
      }
      const { data, error } = await supabaseAdmin.rpc('read_moderation_strike_month', {
        ...staffIdentity(auth.actor),
        p_member_id: memberId,
        p_month: month === null ? null : month + '-01',
      });
      return punishmentRpcResponse('moderator read', data, error);
    }

    // Fetch all members with service role (includes is_active = false)
    const { data: members, error } = await supabaseAdmin
      .from('members')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Run self-healing promotion check on all members
    const processedMembers: ModerationRosterMember[] = [];
    for (const member of (members as Member[]) || []) {
      const { promoted, activeMember } = checkCooldownPromotion(member);
      let rosterMember = member;
      if (promoted) {
        const { data: saved } = await updateMemberSafe(member.id, {
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
        }, { conditions: { updated_at: member.updated_at, pending_effective_at: member.pending_effective_at } });
        if (saved) rosterMember = saved;
      }
      const hydrated = rosterMember;
      let strikeCounts;
      try {
        strikeCounts = await resolveMemberStrikeCounts(hydrated);
      } catch (error) {
        console.error(`[mod] Could not resolve strike counts for ${hydrated.id}:`, error);
      }
      processedMembers.push({
        ...sanitizeMember(hydrated),
        can_review_strikes: auth.actor.role === 'owner' || auth.actor.id !== hydrated.id,
        strike_counts_unavailable: !strikeCounts,
        strikes_used: strikeCounts?.strikes_used,
        strikes_count: strikeCounts?.strikes_used,
        metastrikes_used: strikeCounts?.metastrikes_used,
        metastrikes_count: strikeCounts?.metastrikes_used,
        strike_cycle_month: strikeCounts?.strike_cycle_month,
      });
    }

    return punishmentResponse({
      success: true,
      members: processedMembers,
    });
  } catch (err: unknown) {
    if (review) return punishmentDependencyResponse('moderator read');
    const message = err instanceof Error ? err.message : 'Unknown server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST: Moderator operations
 * Actions:
 * - 'approve_cooldown': Instantly promote a pending schedule change
 * - 'cancel_cooldown': Cancel a pending schedule change without altering current schedule
 * - 'edit_member': Edit routine profile details
 * - 'edit_schedule': Edit the active schedule immediately
 * - 'set_moderator': Promote or demote a roster member with a signed owner session
 * - 'toggle_active': Activate or deactivate a member
 * - 'delete_member': Permanently remove a member
 */
/**
 * POST: Execute moderator administration actions.
 *
 * @param request - Incoming HTTP request with action name, moderator credentials, and action payload
 * @returns JSON response with action execution results
 */
export async function POST(request: Request) {
  let datedCorrection = false;
  try {
    const origin = request.headers.get('origin');
    if (!isSameOriginMutation(request)) {
      return punishmentResponse({ error: 'Moderator actions require a same-origin request.' }, 403);
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return punishmentResponse({ error: 'Provide a valid action payload.' }, 400);
    }

    const { action } = body;
    datedCorrection = action === 'add_strike' || action === 'remove_strike';
    if (action === 'set_moderator') {
      if (!origin) {
        return NextResponse.json({ error: 'Moderator assignment requires a same-origin request.' }, { status: 403 });
      }
      return await setModerator(request, body);
    }

    const auth = await verifyModeratorSession(request);
    if (!auth.authorized) {
      if (datedCorrection && auth.status === 503) return punishmentDependencyResponse('moderator write', auth.databaseCode);
      return datedCorrection ? punishmentResponse({ error: auth.error }, auth.status)
        : NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { actor } = auth;
    const identity = staffIdentity(actor);
    if (['toggle_active', 'delete_member', 'purge_seed_members', 'adjust_passes', 'adjust_strikes', 'clear_metastrike_log', 'clear_strike_log'].includes(action) &&
        actor.role !== 'owner') {
      return NextResponse.json({ error: 'Owner access is required.' }, { status: 403 });
    }

    if (datedCorrection) {
      const { member_id, cycle_date, source_id, reason, request_id } = body;
      if (typeof member_id !== 'string' || !UUID_PATTERN.test(member_id) ||
          typeof cycle_date !== 'string' || !CYCLE_DATE_PATTERN.test(cycle_date) ||
          cycle_date < '2026-11-01' || !DateTime.fromISO(cycle_date, { zone: 'utc' }).isValid ||
          typeof reason !== 'string' || !reason.trim() || reason.trim().length > 500 ||
          typeof request_id !== 'string' || !UUID_PATTERN.test(request_id) ||
          (action === 'remove_strike' ? typeof source_id !== 'string' || !UUID_PATTERN.test(source_id) : source_id != null)) {
        return punishmentResponse({ error: 'Enter a cycle date, reason and request ID. Removal requires a strike source.' }, 400);
      }
      const { data, error } = await supabaseAdmin.rpc('moderate_dated_strike', {
        ...identity,
        p_member_id: member_id,
        p_action: action,
        p_cycle: cycle_date,
        p_source: source_id ?? null,
        p_reason: reason.trim(),
        p_request_id: request_id,
      });
      return punishmentRpcResponse('moderator write', data, error);
    }

    if (action === 'approve_cooldown' || action === 'cancel_cooldown') {
      const { member_id, expected_pending } = body;
      if (!member_id || (action === 'approve_cooldown' &&
          (!expected_pending || typeof expected_pending.pending_effective_at !== 'string' ||
           !DateTime.fromISO(expected_pending.pending_effective_at).isValid))) {
        return NextResponse.json({ error: 'Provide the member and the pending schedule you reviewed.' }, { status: 400 });
      }

      const { data, error } = await supabaseAdmin.rpc('moderate_roster_member', {
        ...identity,
        p_target_id: member_id,
        p_action: action,
        p_expected_pending: expected_pending ? pendingScheduleSnapshot(expected_pending) : null,
      });
      if (error || !data) return staffWriteError(error);

      return NextResponse.json({
        success: true,
        message: action === 'approve_cooldown' ? 'Pending schedule approved.' : 'Pending schedule change cancelled.',
        member: sanitizeMember(data),
      });
    }

    if (action === 'edit_member' || action === 'edit_schedule') {
      if ('role' in body || 'is_moderator' in body) {
        return NextResponse.json({ error: 'Use set_moderator to change moderator access.' }, { status: 400 });
      }
      const {
        member_id,
        expected_updated_at,
        discord_username,
        discord_handle,
        journal_url,
        bedtime_local,
        wake_time_local,
        timezone,
        weekend_bedtime_local,
        weekend_wake_time_local,
        weekly_schedule,
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
      if (!canModerateTarget(actor, existing)) {
        return NextResponse.json({ error: 'You cannot manage this profile.' }, { status: 403 });
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

      if (hasScheduleUpdate && DAY_KEYS.some(day => {
        const { bedtime, wake_time } = targetWeeklySchedule[day];
        return bedtime.trim() === wake_time.trim();
      })) {
        return NextResponse.json({ error: 'Bedtime and wake time cannot be identical.' }, { status: 400 });
      }

      const syncBedtime = targetWeeklySchedule.mon.bedtime;
      const syncWakeTime = targetWeeklySchedule.mon.wake_time;
      const syncWeekendBedtime = targetWeeklySchedule.sat.bedtime;
      const syncWeekendWakeTime = targetWeeklySchedule.sat.wake_time;

      const nextTimezone = timezone?.trim() || existing.timezone;
      const scheduleChanged = nextTimezone !== existing.timezone || (hasScheduleUpdate && DAY_KEYS.some((day) => {
        const active = existing.weekly_schedule?.[day];
        const weekend = day === 'fri' || day === 'sat';
        const activeBedtime = active?.bedtime || (weekend && existing.weekend_bedtime_local) || existing.bedtime_local;
        const activeWakeTime = active?.wake_time || (weekend && existing.weekend_wake_time_local) || existing.wake_time_local;
        return targetWeeklySchedule[day].bedtime !== activeBedtime || targetWeeklySchedule[day].wake_time !== activeWakeTime;
      }));
      if (action === 'edit_member' && (hasScheduleUpdate || timezone !== undefined)) {
        return NextResponse.json({ error: 'Use edit_schedule to change the active schedule.' }, { status: 400 });
      }

      if ((action === 'edit_schedule' || expected_updated_at !== undefined) &&
          (typeof expected_updated_at !== 'string' || !DateTime.fromISO(expected_updated_at).isValid)) {
        return NextResponse.json({ error: 'Provide the profile version you edited.' }, { status: 400 });
      }

      const updates: Partial<Member> = {
        discord_username: discord_username?.trim() || existing.discord_username,
        discord_handle:
          discord_handle !== undefined
            ? discord_handle?.trim() || null
            : existing.discord_handle,
        journal_url: journal_url?.trim() || existing.journal_url,
        timezone: nextTimezone,
      };

      if (scheduleChanged) {
        if (hasScheduleUpdate) {
          updates.bedtime_local = syncBedtime;
          updates.wake_time_local = syncWakeTime;
          updates.weekend_bedtime_local = syncWeekendBedtime;
          updates.weekend_wake_time_local = syncWeekendWakeTime;
          updates.weekly_schedule = targetWeeklySchedule;
        }
        updates.pending_bedtime_local = null;
        updates.pending_wake_time_local = null;
        updates.pending_timezone = null;
        updates.pending_weekend_bedtime_local = null;
        updates.pending_weekend_wake_time_local = null;
        updates.pending_weekly_schedule = null;
        updates.pending_effective_at = null;
      }

      const { data: updated, error } = await supabaseAdmin.rpc('moderate_roster_member', {
        ...identity,
        p_target_id: member_id,
        p_action: action,
        p_updates: updates,
        p_expected_updated_at: expected_updated_at ?? existing.updated_at,
      });
      if (error || !updated) return staffWriteError(error);

      return NextResponse.json({
        success: true,
        message: `Member ${updated.discord_username} updated immediately!`,
        member: sanitizeMember(updated as Member),
      });
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

      const { data: updated, error } = await supabaseAdmin.rpc('moderate_roster_member', {
        ...identity, p_target_id: member_id, p_action: action, p_updates: { is_active },
      });
      if (error || !updated) return staffWriteError(error);

      return NextResponse.json({
        success: true,
        message: `Member status set to ${is_active ? 'Active' : 'Deactivated'}.`,
        member: sanitizeMember(updated as Member),
      });
    }

    // Permanently delete a member
    if (action === 'delete_member') {
      const { member_id } = body;
      if (!member_id) {
        return NextResponse.json({ error: 'Missing member_id.' }, { status: 400 });
      }

      const { error } = await supabaseAdmin.rpc('moderate_roster_member', {
        ...identity, p_target_id: member_id, p_action: action,
      });
      if (error) return staffWriteError(error);

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

      const verifiedDemoProfiles = (candidates || []).filter(isDemoSeedMember);
      if (verifiedDemoProfiles.length === 0) {
        return NextResponse.json({
          success: true,
          message: 'No demo seed profiles found to purge.',
          purged: [],
        });
      }

      const { data: deleted, error: purgeErr } = await supabaseAdmin.rpc('purge_moderation_demo_members', {
        ...identity,
        p_profiles: verifiedDemoProfiles,
      });
      if (purgeErr) return staffWriteError(purgeErr);

      const count = deleted ? deleted.length : 0;
      return NextResponse.json({
        success: true,
        message: `Successfully purged ${count} demo seed profiles from the den.`,
        purged: deleted,
      });
    }

    // Retain the old action for staff clients that send a pass-only edit.
    if (action === 'adjust_passes' || action === 'adjust_strikes') {
      const { member_id, strikes_used, metastrikes_used, strike_delta, metastrike_delta } = body;
      if (strikes_used != null || (strike_delta != null && strike_delta !== 0)) {
        return NextResponse.json({ error: 'Use Review strikes to make a dated strike correction.' }, { status: 409 });
      }

      const relative = metastrike_delta !== undefined;
      const passes = relative ? metastrike_delta : metastrikes_used;
      if (typeof member_id !== 'string' || !UUID_PATTERN.test(member_id) ||
          (relative && metastrikes_used !== undefined) ||
          typeof passes !== 'number' || !Number.isInteger(passes) ||
          passes < (relative ? -1 : 0) || passes > (relative ? 1 : 3)) {
        return NextResponse.json({ error: 'Enter a valid Metastrike balance adjustment.' }, { status: 400 });
      }

      const result = await modAdjustPasses(member_id, passes, relative, actor);
      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
      }

      return NextResponse.json({
        success: true,
        message: 'Member Metastrike balance updated.',
        strikes_used: result.strikesUsed,
        strikes_count: result.strikesUsed,
        metastrikes_used: result.metastrikesUsed,
        metastrikes_count: result.metastrikesUsed,
      });
    }

    // Older clients use the same action for pass reversals and strike removals.
    if (action === 'clear_metastrike_log' || action === 'clear_strike_log') {
      const { member_id, sleep_cycle_date } = body;
      if (!member_id) {
        return NextResponse.json({ error: 'Missing member_id' }, { status: 400 });
      }

      const { data: member, error: memberErr } = await getMemberByIdSafe(member_id, { requireFresh: true });
      if (memberErr || !member) {
        return NextResponse.json({ error: 'Member not found' }, { status: 404 });
      }
      if (!canModerateTarget(actor, member)) {
        return NextResponse.json({ error: 'You cannot manage this profile.' }, { status: 403 });
      }
      const cycleDate = sleep_cycle_date || getSleepCycleDate(member, DateTime.utc());

      if (typeof cycleDate !== 'string' || !CYCLE_DATE_PATTERN.test(cycleDate) ||
          !DateTime.fromISO(cycleDate, { zone: 'utc' }).isValid) {
        return NextResponse.json({ error: 'Enter a valid sleep cycle date.' }, { status: 400 });
      }

      const result = await modClearMetastrikeLog(member_id, cycleDate, actor);
      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
      }

      return NextResponse.json({
        success: true,
        message: result.cleared ? 'Nightly Metastrike cleared.' : 'No Metastrike was recorded for this cycle.',
        sleep_cycle_date: cycleDate,
      });
    }

    return NextResponse.json(
      { error: `Unsupported action: "${action}"` },
      { status: 400 }
    );
  } catch (err: unknown) {
    if (datedCorrection) return punishmentDependencyResponse('moderator write');
    const message = err instanceof Error ? err.message : 'Unknown server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
