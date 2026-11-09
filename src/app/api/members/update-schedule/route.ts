import { NextResponse } from 'next/server';
import { supabaseAdmin, Member } from '@/lib/db';
import { hashPin, verifyPin, verifyModPasscode } from '@/lib/auth';
import { DateTime } from 'luxon';

const DISCORD_JOURNAL_REGEX = /^https:\/\/(ptb\.|canary\.)?discord\.com\/channels\/\d+\/\d+(\/\d+)?$/;
const TIME_FORMAT_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      member_id,
      pin,
      new_pin,
      discord_username,
      discord_handle,
      journal_url,
      bedtime_local,
      wake_time_local = '07:00',
      timezone,
      mod_passcode,
    } = body;

    if (!member_id) {
      return NextResponse.json({ error: 'Missing member_id' }, { status: 400 });
    }

    // 1. Fetch current member from database
    const { data: memberData, error: fetchError } = await supabaseAdmin
      .from('members')
      .select('*')
      .eq('id', member_id)
      .single();

    if (fetchError || !memberData) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    const currentMember = memberData as Member;

    // 2. PIN verification / Claiming profile
    const isModeratorOverride = verifyModPasscode(mod_passcode);

    let updatedPasscodeHash = currentMember.passcode_hash;

    if (!isModeratorOverride) {
      if (!currentMember.passcode_hash) {
        // Unclaimed profile: user must set a 4-digit PIN to claim and protect it
        if (!pin || pin.length < 4 || !/^\d{4,6}$/.test(pin)) {
          return NextResponse.json(
            { error: 'Please choose a 4-to-6 digit PIN to claim and protect your profile.' },
            { status: 400 }
          );
        }
        updatedPasscodeHash = hashPin(pin);
      } else {
        // Profile already claimed: verify PIN
        if (!pin || !verifyPin(pin, currentMember.passcode_hash)) {
          return NextResponse.json(
            { error: 'Invalid 4-digit PIN. Please enter your correct PIN.' },
            { status: 401 }
          );
        }
        // If updating PIN
        if (new_pin) {
          if (!/^\d{4,6}$/.test(new_pin)) {
            return NextResponse.json(
              { error: 'New PIN must be 4 to 6 digits.' },
              { status: 400 }
            );
          }
          updatedPasscodeHash = hashPin(new_pin);
        }
      }
    }

    // 3. Validate Journal URL
    if (journal_url) {
      if (!DISCORD_JOURNAL_REGEX.test(journal_url.trim())) {
        return NextResponse.json(
          {
            error:
              'Invalid Discord Journal URL. Format must match: https://discord.com/channels/{guild}/{thread}',
          },
          { status: 400 }
        );
      }
    }

    // 4. Validate Timezone (Must be a valid Luxon/IANA timezone)
    if (timezone) {
      if (!DateTime.now().setZone(timezone).isValid) {
        return NextResponse.json(
          { error: `Invalid IANA timezone "${timezone}". Example: "America/New_York"` },
          { status: 400 }
        );
      }
    }

    // 5. Validate Bedtime & Wake Time formats
    if (bedtime_local && !TIME_FORMAT_REGEX.test(bedtime_local)) {
      return NextResponse.json(
        { error: 'Bedtime must be in 24-hour "HH:mm" format (e.g. "23:30").' },
        { status: 400 }
      );
    }
    if (wake_time_local && !TIME_FORMAT_REGEX.test(wake_time_local)) {
      return NextResponse.json(
        { error: 'Wake time must be in 24-hour "HH:mm" format (e.g. "07:00").' },
        { status: 400 }
      );
    }

    // 6. Check for Schedule Changes vs Immediate Profile Changes
    const targetBedtime = bedtime_local || currentMember.bedtime_local;
    const targetWakeTime = wake_time_local || currentMember.wake_time_local;
    const targetTimezone = timezone || currentMember.timezone;

    const scheduleHasChanged =
      targetBedtime !== currentMember.bedtime_local ||
      targetTimezone !== currentMember.timezone ||
      targetWakeTime !== currentMember.wake_time_local;

    const updates: Partial<Member> = {
      discord_username: discord_username?.trim() || currentMember.discord_username,
      discord_handle:
        discord_handle !== undefined
          ? discord_handle?.trim() || null
          : currentMember.discord_handle,
      journal_url: journal_url?.trim() || currentMember.journal_url,
      passcode_hash: updatedPasscodeHash,
      updated_at: DateTime.utc().toISO() as string,
    };

    let cooldownApplied = false;
    let pendingEffectiveAt: string | null = null;

    if (scheduleHasChanged) {
      if (isModeratorOverride) {
        // Moderator bypass: updates schedule directly and wipes pending
        updates.bedtime_local = targetBedtime;
        updates.wake_time_local = targetWakeTime;
        updates.timezone = targetTimezone;
        updates.pending_bedtime_local = null;
        updates.pending_wake_time_local = null;
        updates.pending_timezone = null;
        updates.pending_effective_at = null;
      } else {
        // Enforce 48-Hour Cooldown Rule for regular member edits
        const effectiveAt = DateTime.utc().plus({ hours: 48 });
        updates.pending_bedtime_local = targetBedtime;
        updates.pending_wake_time_local = targetWakeTime;
        updates.pending_timezone = targetTimezone;
        updates.pending_effective_at = effectiveAt.toISO() as string;
        cooldownApplied = true;
        pendingEffectiveAt = effectiveAt.toISO() as string;
      }
    }

    // 7. Persist to Supabase
    const { data: updatedMember, error: updateError } = await supabaseAdmin
      .from('members')
      .update(updates)
      .eq('id', member_id)
      .select('*')
      .single();

    if (updateError || !updatedMember) {
      return NextResponse.json(
        { error: updateError?.message || 'Failed to update member' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      cooldown_applied: cooldownApplied,
      pending_effective_at: pendingEffectiveAt,
      member: updatedMember,
      message: cooldownApplied
        ? 'Accountability Cooldown Active: Your new bedtime will take effect in 48 hours. Profile links updated immediately.'
        : 'Profile updated successfully!',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
