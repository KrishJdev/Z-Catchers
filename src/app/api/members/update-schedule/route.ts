import { NextResponse } from 'next/server';
import { supabaseAdmin, Member, updateMemberSafe } from '@/lib/db';
import { hashPin, verifyPin, verifyModPasscode, sanitizeMember } from '@/lib/auth';
import { isValidTimezone, formatGmtOffset } from '@/lib/timezone';
import {
  getClientIp,
  checkPinRateLimitPersistent,
  recordPinFailurePersistent,
  resetPinFailurePersistent,
} from '@/lib/rateLimit';
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
      weekend_bedtime_local,
      weekend_wake_time_local,
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
    const clientIp = getClientIp(request);

    // 2. PIN verification / Claiming profile
    let isModeratorOverride = false;
    if (mod_passcode) {
      const modRate = await checkPinRateLimitPersistent(clientIp, 'mod_passcode_gate');
      if (modRate.allowed) {
        isModeratorOverride = verifyModPasscode(mod_passcode);
        if (!isModeratorOverride) {
          await recordPinFailurePersistent(clientIp, 'mod_passcode_gate');
        } else {
          await resetPinFailurePersistent(clientIp, 'mod_passcode_gate');
        }
      }
    }
    const isFirstTimeClaim = !isModeratorOverride && !currentMember.passcode_hash;

    let updatedPasscodeHash = currentMember.passcode_hash;

    if (!isModeratorOverride) {
      const rateCheck = await checkPinRateLimitPersistent(clientIp, currentMember.id);
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

      if (!currentMember.passcode_hash) {
        if (currentMember.role === 'moderator') {
          await recordPinFailurePersistent(clientIp, currentMember.id);
          return NextResponse.json(
            { error: 'Claiming an initial moderator profile requires moderator authorization.' },
            { status: 403 }
          );
        }
        // Unclaimed profile: user must set a 4-digit PIN to claim and protect it
        if (!pin || typeof pin !== 'string' || pin.trim().length < 4 || !/^\d{4,6}$/.test(pin.trim())) {
          return NextResponse.json(
            { error: 'Please choose a 4-to-6 digit PIN to claim and protect your profile.' },
            { status: 400 }
          );
        }
        updatedPasscodeHash = hashPin(pin.trim());
        await resetPinFailurePersistent(clientIp, currentMember.id);
      } else {
        // Profile already claimed: verify PIN with rate limit protection
        if (!pin || typeof pin !== 'string' || !verifyPin(pin.trim(), currentMember.passcode_hash)) {
          await recordPinFailurePersistent(clientIp, currentMember.id);
          return NextResponse.json(
            { error: 'Invalid 4-digit PIN. Please enter your correct PIN.' },
            { status: 401 }
          );
        }
        await resetPinFailurePersistent(clientIp, currentMember.id);

        // If updating PIN
        if (new_pin) {
          if (typeof new_pin !== 'string' || !/^\d{4,6}$/.test(new_pin.trim())) {
            return NextResponse.json(
              { error: 'New PIN must be 4 to 6 digits.' },
              { status: 400 }
            );
          }
          updatedPasscodeHash = hashPin(new_pin.trim());
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

    // 4. Validate Timezone (Must be a valid IANA timezone or supported offset)
    if (timezone) {
      if (!isValidTimezone(timezone)) {
        return NextResponse.json(
          { error: `Invalid timezone "${timezone}". Please select a valid IANA timezone (e.g. "Europe/Athens", "America/New_York", "Asia/Kolkata").` },
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
    if (
      weekend_bedtime_local &&
      weekend_bedtime_local.trim() !== '' &&
      !TIME_FORMAT_REGEX.test(weekend_bedtime_local.trim())
    ) {
      return NextResponse.json(
        { error: 'Weekend bedtime must be in 24-hour "HH:mm" format (e.g. "00:30").' },
        { status: 400 }
      );
    }
    if (
      weekend_wake_time_local &&
      weekend_wake_time_local.trim() !== '' &&
      !TIME_FORMAT_REGEX.test(weekend_wake_time_local.trim())
    ) {
      return NextResponse.json(
        { error: 'Weekend wake time must be in 24-hour "HH:mm" format (e.g. "09:00").' },
        { status: 400 }
      );
    }

    // 6. Check for Schedule Changes vs Immediate Profile Changes
    const targetBedtime = bedtime_local || currentMember.bedtime_local;
    const targetWakeTime = wake_time_local || currentMember.wake_time_local;
    const targetTimezone = timezone ? timezone.trim() : currentMember.timezone;
    const targetWeekendBedtime =
      weekend_bedtime_local !== undefined
        ? weekend_bedtime_local && weekend_bedtime_local.trim() !== ''
          ? weekend_bedtime_local.trim()
          : null
        : (currentMember.weekend_bedtime_local || null);
    const targetWeekendWakeTime =
      weekend_wake_time_local !== undefined
        ? weekend_wake_time_local && weekend_wake_time_local.trim() !== ''
          ? weekend_wake_time_local.trim()
          : null
        : (currentMember.weekend_wake_time_local || null);

    const scheduleHasChanged =
      targetBedtime !== currentMember.bedtime_local ||
      targetTimezone !== currentMember.timezone ||
      targetWakeTime !== currentMember.wake_time_local ||
      targetWeekendBedtime !== (currentMember.weekend_bedtime_local || null) ||
      targetWeekendWakeTime !== (currentMember.weekend_wake_time_local || null);

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
        updates.weekend_bedtime_local = targetWeekendBedtime;
        updates.weekend_wake_time_local = targetWeekendWakeTime;
        updates.pending_bedtime_local = null;
        updates.pending_wake_time_local = null;
        updates.pending_timezone = null;
        updates.pending_weekend_bedtime_local = null;
        updates.pending_weekend_wake_time_local = null;
        updates.pending_effective_at = null;
      } else {
        // Enforce 48-Hour Cooldown Rule for regular member edits
        const effectiveAt = DateTime.utc().plus({ hours: 48 });
        updates.pending_bedtime_local = targetBedtime;
        updates.pending_wake_time_local = targetWakeTime;
        updates.pending_timezone = targetTimezone;
        updates.pending_weekend_bedtime_local = targetWeekendBedtime;
        updates.pending_weekend_wake_time_local = targetWeekendWakeTime;
        updates.pending_effective_at = effectiveAt.toISO() as string;
        cooldownApplied = true;
        pendingEffectiveAt = effectiveAt.toISO() as string;
      }
    }

    // 7. Persist to Supabase
    const { data: updatedMember, error: updateError } = await updateMemberSafe(
      member_id,
      updates,
      { isFirstTimeClaim }
    );

    if (updateError || !updatedMember) {
      return NextResponse.json(
        {
          error:
            updateError?.message ||
            (isFirstTimeClaim
              ? 'Profile has already been claimed or could not be updated. Please try logging in.'
              : 'Failed to update member'),
        },
        { status: updateError ? 500 : isFirstTimeClaim ? 409 : 500 }
      );
    }

    return NextResponse.json({
      success: true,
      cooldown_applied: cooldownApplied,
      pending_effective_at: pendingEffectiveAt,
      member: sanitizeMember(updatedMember as Member),
      message: cooldownApplied
        ? 'Accountability Cooldown Active: Your new bedtime will take effect in 48 hours. Profile links updated immediately.'
        : 'Profile updated successfully!',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
