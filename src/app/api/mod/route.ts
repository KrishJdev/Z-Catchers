import { NextResponse } from 'next/server';
import {
  supabaseAdmin,
  Member,
  updateMemberSafe,
  insertMemberSafe,
  hydrateMemberWeekendHours,
} from '@/lib/db';
import { verifyModPasscode, hashPin, sanitizeMember, verifyModeratorAuthorization } from '@/lib/auth';
import {
  getClientIp,
  checkPinRateLimitPersistent,
  recordPinFailurePersistent,
  resetPinFailurePersistent,
} from '@/lib/rateLimit';
import { DEMO_SEED_FINGERPRINTS, isDemoSeedMember } from '@/lib/demoSeed';
import { checkCooldownPromotion, getSleepCycleDate } from '@/lib/sleepEngine';
import { isValidTimezone, formatGmtOffset } from '@/lib/timezone';
import { resolveMemberStrikeCounts, modAdjustStrikes, modClearStrikeLog } from '@/lib/strikes';
import { DateTime } from 'luxon';

const DISCORD_JOURNAL_REGEX = /^https:\/\/(ptb\.|canary\.)?discord\.com\/channels\/\d+\/\d+(\/\d+)?$/;
const TIME_FORMAT_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * GET: Fetch all members (including inactive and pending schedules) for moderator view
 */
export async function GET(request: Request) {
  try {
    const clientIp = getClientIp(request);
    const rateCheck = await checkPinRateLimitPersistent(clientIp, 'mod_admin');
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
      await recordPinFailurePersistent(clientIp, 'mod_admin');
      return NextResponse.json(
        { error: authResult.error || 'Unauthorized: Invalid moderator passcode or session.' },
        { status: 401 }
      );
    }

    await resetPinFailurePersistent(clientIp, 'mod_admin');

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
          pending_bedtime_local: null,
          pending_wake_time_local: null,
          pending_timezone: null,
          pending_weekend_bedtime_local: null,
          pending_weekend_wake_time_local: null,
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
export async function POST(request: Request) {
  try {
    const clientIp = getClientIp(request);
    const rateCheck = await checkPinRateLimitPersistent(clientIp, 'mod_admin');
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

    const authResult = await verifyModeratorAuthorization(request, mod_passcode, pin);
    if (!authResult.authorized) {
      await recordPinFailurePersistent(clientIp, 'mod_admin');
      return NextResponse.json(
        { error: authResult.error || 'Unauthorized: Invalid moderator secret passcode or session.' },
        { status: 401 }
      );
    }

    await resetPinFailurePersistent(clientIp, 'mod_admin');

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

      if (!member.pending_effective_at || (!member.pending_bedtime_local && !member.pending_weekend_bedtime_local)) {
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

      const { data: updated, error: updateErr } = await updateMemberSafe(member_id, {
        bedtime_local: member.pending_bedtime_local || member.bedtime_local,
        wake_time_local: member.pending_wake_time_local || member.wake_time_local,
        timezone: member.pending_timezone || member.timezone,
        weekend_bedtime_local: nextWeekendBedtime,
        weekend_wake_time_local: nextWeekendWakeTime,
        pending_bedtime_local: null,
        pending_wake_time_local: null,
        pending_timezone: null,
        pending_weekend_bedtime_local: null,
        pending_weekend_wake_time_local: null,
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

      if (timezone && !isValidTimezone(timezone.trim())) {
        return NextResponse.json(
          { error: `Invalid timezone "${timezone}". Please select a valid GMT offset (e.g. "GMT+05:30").` },
          { status: 400 }
        );
      }

      const updates: Partial<Member> = {
        discord_username: discord_username?.trim() || existing.discord_username,
        discord_handle:
          discord_handle !== undefined
            ? discord_handle?.trim() || null
            : existing.discord_handle,
        journal_url: journal_url?.trim() || existing.journal_url,
        role: role === 'moderator' ? 'moderator' : 'member',
        updated_at: DateTime.utc().toISO() as string,
      };

      // Direct schedule update: bypasses 48h cooldown and wipes any pending change
      if (bedtime_local) {
        updates.bedtime_local = bedtime_local.trim();
        updates.pending_bedtime_local = null;
        updates.pending_effective_at = null;
      }
      if (wake_time_local) {
        updates.wake_time_local = wake_time_local.trim();
        updates.pending_wake_time_local = null;
      }
      if (timezone) {
        updates.timezone = timezone.trim();
        updates.pending_timezone = null;
      }
      if (weekend_bedtime_local !== undefined) {
        updates.weekend_bedtime_local =
          weekend_bedtime_local && weekend_bedtime_local.trim() !== ''
            ? weekend_bedtime_local.trim()
            : null;
        updates.pending_weekend_bedtime_local = null;
      }
      if (weekend_wake_time_local !== undefined) {
        updates.weekend_wake_time_local =
          weekend_wake_time_local && weekend_wake_time_local.trim() !== ''
            ? weekend_wake_time_local.trim()
            : null;
        updates.pending_weekend_wake_time_local = null;
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
        const { data: member } = await supabaseAdmin
          .from('members')
          .select('*')
          .eq('id', member_id)
          .single();
        if (member) {
          cycleDate = getSleepCycleDate(member as Member, DateTime.utc());
        }
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
