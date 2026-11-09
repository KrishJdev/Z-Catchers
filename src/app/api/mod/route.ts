import { NextResponse } from 'next/server';
import { supabaseAdmin, Member } from '@/lib/db';
import { verifyModPasscode, hashPin } from '@/lib/auth';
import { checkCooldownPromotion } from '@/lib/sleepEngine';
import { DateTime } from 'luxon';

const DISCORD_JOURNAL_REGEX = /^https:\/\/(ptb\.|canary\.)?discord\.com\/channels\/\d+\/\d+(\/\d+)?$/;
const TIME_FORMAT_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Helper to extract and verify moderator passcode from headers, search params, or body
 */
function isAuthorized(request: Request, passcodeFromBody?: string): boolean {
  const url = new URL(request.url);
  const queryPasscode = url.searchParams.get('passcode');
  const headerPasscode = request.headers.get('x-mod-passcode');
  const candidate = passcodeFromBody || headerPasscode || queryPasscode;
  return verifyModPasscode(candidate);
}

/**
 * GET: Fetch all members (including inactive and pending schedules) for moderator view
 */
export async function GET(request: Request) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json(
        { error: 'Unauthorized: Invalid moderator passcode.' },
        { status: 401 }
      );
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
    const processedMembers: Member[] = [];
    for (const member of (members as Member[]) || []) {
      const { promoted, activeMember } = checkCooldownPromotion(member);
      if (promoted) {
        await supabaseAdmin
          .from('members')
          .update({
            bedtime_local: activeMember.bedtime_local,
            wake_time_local: activeMember.wake_time_local,
            timezone: activeMember.timezone,
            pending_bedtime_local: null,
            pending_wake_time_local: null,
            pending_timezone: null,
            pending_effective_at: null,
            updated_at: DateTime.utc().toISO() as string,
          })
          .eq('id', member.id);
      }
      processedMembers.push(activeMember);
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
    const body = await request.json();
    const { action, mod_passcode } = body;

    if (!isAuthorized(request, mod_passcode)) {
      return NextResponse.json(
        { error: 'Unauthorized: Invalid moderator secret passcode.' },
        { status: 401 }
      );
    }

    // 1. Verify Passcode action
    if (action === 'verify') {
      return NextResponse.json({
        success: true,
        message: 'Moderator passcode verified successfully.',
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

      if (!member.pending_effective_at || !member.pending_bedtime_local) {
        return NextResponse.json(
          { error: 'Member does not have an active pending schedule change.' },
          { status: 400 }
        );
      }

      const { data: updated, error: updateErr } = await supabaseAdmin
        .from('members')
        .update({
          bedtime_local: member.pending_bedtime_local,
          wake_time_local: member.pending_wake_time_local || member.wake_time_local,
          timezone: member.pending_timezone || member.timezone,
          pending_bedtime_local: null,
          pending_wake_time_local: null,
          pending_timezone: null,
          pending_effective_at: null,
          updated_at: DateTime.utc().toISO() as string,
        })
        .eq('id', member_id)
        .select('*')
        .single();

      if (updateErr) {
        return NextResponse.json({ error: updateErr.message }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        message: `Approved schedule change for ${member.discord_username} immediately!`,
        member: updated,
      });
    }

    // 3. Cancel / Reject Pending Cooldown
    if (action === 'cancel_cooldown') {
      const { member_id } = body;
      if (!member_id) {
        return NextResponse.json({ error: 'Missing member_id' }, { status: 400 });
      }

      const { data: updated, error: updateErr } = await supabaseAdmin
        .from('members')
        .update({
          pending_bedtime_local: null,
          pending_wake_time_local: null,
          pending_timezone: null,
          pending_effective_at: null,
          updated_at: DateTime.utc().toISO() as string,
        })
        .eq('id', member_id)
        .select('*')
        .single();

      if (updateErr) {
        return NextResponse.json({ error: updateErr.message }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        message: 'Pending schedule change cancelled.',
        member: updated,
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

      if (timezone && !DateTime.now().setZone(timezone.trim()).isValid) {
        return NextResponse.json(
          { error: `Invalid IANA timezone "${timezone}".` },
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

      const { data: updated, error: updateErr } = await supabaseAdmin
        .from('members')
        .update(updates)
        .eq('id', member_id)
        .select('*')
        .single();

      if (updateErr) {
        return NextResponse.json({ error: updateErr.message }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        message: `Member ${updated.discord_username} updated immediately!`,
        member: updated,
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

      if (!DateTime.now().setZone(timezone.trim()).isValid) {
        return NextResponse.json(
          { error: `Invalid IANA timezone "${timezone}".` },
          { status: 400 }
        );
      }

      const passcode_hash =
        pin && /^\d{4,6}$/.test(pin.trim()) ? hashPin(pin.trim()) : null;
      const avatar_url = `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(
        discord_username.trim()
      )}`;

      const { data, error } = await supabaseAdmin
        .from('members')
        .insert({
          discord_username: discord_username.trim(),
          discord_handle: discord_handle?.trim() || null,
          avatar_url,
          journal_url: journal_url.trim(),
          bedtime_local: bedtime_local.trim(),
          wake_time_local: wake_time_local.trim(),
          timezone: timezone.trim(),
          role: role === 'moderator' ? 'moderator' : 'member',
          passcode_hash,
          is_active: true,
        })
        .select('*')
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        message: `Member ${data.discord_username} created successfully!`,
        member: data,
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

      const { data: updated, error: updateErr } = await supabaseAdmin
        .from('members')
        .update({
          is_active,
          updated_at: DateTime.utc().toISO() as string,
        })
        .eq('id', member_id)
        .select('*')
        .single();

      if (updateErr) {
        return NextResponse.json({ error: updateErr.message }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        message: `Member status set to ${is_active ? 'Active' : 'Deactivated'}.`,
        member: updated,
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

      const { data: updated, error: updateErr } = await supabaseAdmin
        .from('members')
        .update({
          passcode_hash,
          updated_at: DateTime.utc().toISO() as string,
        })
        .eq('id', member_id)
        .select('*')
        .single();

      if (updateErr) {
        return NextResponse.json({ error: updateErr.message }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        message: passcode_hash
          ? 'Member PIN reset successfully.'
          : 'Member PIN cleared. Member may now claim their profile with a new PIN.',
        member: updated,
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

    return NextResponse.json(
      { error: `Unsupported action: "${action}"` },
      { status: 400 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
