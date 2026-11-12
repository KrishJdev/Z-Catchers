import { NextResponse } from 'next/server';
import { supabaseAdmin, Member, updateMemberSafe } from '@/lib/db';
import { hashPin, verifyPin, verifyModPasscode, sanitizeMember, getRequestSessionMemberId } from '@/lib/auth';
import { isValidTimezone, formatGmtOffset, DAY_KEYS, type DayKey, type WeeklySchedule, type DailySchedule } from '@/lib/timezone';
import {
  getClientIp,
  checkPinRateLimitPersistent,
  recordPinFailurePersistent,
  resetPinFailurePersistent,
} from '@/lib/rateLimit';
import { DateTime } from 'luxon';

const DISCORD_JOURNAL_REGEX = /^https:\/\/(ptb\.|canary\.)?discord\.com\/channels\/\d+\/\d+(\/\d+)?$/;
const TIME_FORMAT_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * POST: Update a member's bedtime schedule with 48-hour cooldown protection or moderator override.
 *
 * @param request - Incoming HTTP request containing schedule updates and PIN/passcode
 * @returns JSON response with updated or pending schedule status
 */
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
      bedtime: legacyBedtime,
      wake_time_local,
      wake_time: legacyWakeTime,
      timezone,
      weekend_bedtime_local,
      weekend_bedtime: legacyWeekendBedtime,
      weekend_wake_time_local,
      weekend_wake_time: legacyWeekendWakeTime,
      weekly_schedule,
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

    // 2. PIN verification / Session Authorization / Claiming profile
    const sessionMemberId = getRequestSessionMemberId(request);
    const isSessionOwner = Boolean(sessionMemberId && sessionMemberId === currentMember.id);
    let isModeratorOverride = false;
    if (mod_passcode) {
      const modGateTarget = sessionMemberId ? `mod_gate_member:${sessionMemberId}` : `mod_gate_ip:${clientIp}`;
      const modRate = await checkPinRateLimitPersistent(clientIp, modGateTarget);
      if (modRate.allowed) {
        isModeratorOverride = verifyModPasscode(mod_passcode);
        if (!isModeratorOverride) {
          await recordPinFailurePersistent(clientIp, modGateTarget);
        } else {
          await resetPinFailurePersistent(clientIp, modGateTarget);
        }
      }
    }
    const isFirstTimeClaim = !isModeratorOverride && !isSessionOwner && !currentMember.passcode_hash;

    let updatedPasscodeHash = currentMember.passcode_hash;

    if (!isModeratorOverride) {
      if (isSessionOwner) {
        if (!currentMember.is_active) {
          return NextResponse.json({ error: 'Member is inactive.' }, { status: 403 });
        }
        // Authenticated owner session: no PIN required; allow PIN update if new_pin supplied
        if (new_pin) {
          if (typeof new_pin !== 'string' || !/^\d{4,6}$/.test(new_pin.trim())) {
            return NextResponse.json(
              { error: 'New PIN must be 4 to 6 digits.' },
              { status: 400 }
            );
          }
          updatedPasscodeHash = hashPin(new_pin.trim());
        }
      } else {
        // Non-owner: If profile is linked to Discord, only authenticated owner or moderator can update it
        if (currentMember.discord_id) {
          return NextResponse.json(
            { error: 'This profile is linked to a Discord account and can only be updated by its owner or a moderator.' },
            { status: 403 }
          );
        }

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
          // Unclaimed unlinked profile: user must set a 4-digit PIN to claim and protect it
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

    // 5. Validate Schedule (7-Day Variable Schedule or Legacy Bedtime/Wake formats)
    const effectiveBedtime = bedtime_local || legacyBedtime;
    const effectiveWakeTime = wake_time_local || legacyWakeTime;
    const effectiveWeekendBedtime = weekend_bedtime_local !== undefined ? weekend_bedtime_local : legacyWeekendBedtime;
    const effectiveWeekendWakeTime = weekend_wake_time_local !== undefined ? weekend_wake_time_local : legacyWeekendWakeTime;

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
            { error: `Missing daily schedule for day "${day}". All 7 days (mon through sun) must be provided.` },
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
      // Legacy payload validation & automatic 7-day schedule construction
      if (effectiveBedtime && !TIME_FORMAT_REGEX.test(effectiveBedtime.trim())) {
        return NextResponse.json(
          { error: 'Bedtime must be in 24-hour "HH:mm" format (e.g. "23:30").' },
          { status: 400 }
        );
      }
      if (effectiveWakeTime && !TIME_FORMAT_REGEX.test(effectiveWakeTime.trim())) {
        return NextResponse.json(
          { error: 'Wake time must be in 24-hour "HH:mm" format (e.g. "07:00").' },
          { status: 400 }
        );
      }
      if (
        effectiveWeekendBedtime &&
        effectiveWeekendBedtime.trim() !== '' &&
        !TIME_FORMAT_REGEX.test(effectiveWeekendBedtime.trim())
      ) {
        return NextResponse.json(
          { error: 'Weekend bedtime must be in 24-hour "HH:mm" format (e.g. "00:30").' },
          { status: 400 }
        );
      }
      if (
        effectiveWeekendWakeTime &&
        effectiveWeekendWakeTime.trim() !== '' &&
        !TIME_FORMAT_REGEX.test(effectiveWeekendWakeTime.trim())
      ) {
        return NextResponse.json(
          { error: 'Weekend wake time must be in 24-hour "HH:mm" format (e.g. "09:00").' },
          { status: 400 }
        );
      }

      const baseBedtime = (effectiveBedtime ? effectiveBedtime.trim() : currentMember.bedtime_local) || '23:00';
      const baseWakeTime = (effectiveWakeTime ? effectiveWakeTime.trim() : currentMember.wake_time_local) || '07:00';
      const weekendBedtimeVal =
        effectiveWeekendBedtime !== undefined
          ? effectiveWeekendBedtime && effectiveWeekendBedtime.trim() !== ''
            ? effectiveWeekendBedtime.trim()
            : null
          : (currentMember.weekend_bedtime_local || null);
      const weekendWakeTimeVal =
        effectiveWeekendWakeTime !== undefined
          ? effectiveWeekendWakeTime && effectiveWeekendWakeTime.trim() !== ''
            ? effectiveWeekendWakeTime.trim()
            : null
          : (currentMember.weekend_wake_time_local || null);

      const hasFlatScheduleEdit =
        Boolean(effectiveBedtime) ||
        Boolean(effectiveWakeTime) ||
        effectiveWeekendBedtime !== undefined ||
        effectiveWeekendWakeTime !== undefined;

      if (currentMember.weekly_schedule && !hasFlatScheduleEdit) {
        // Profile-only update: preserve existing weekly schedule completely
        targetWeeklySchedule = currentMember.weekly_schedule;
      } else if (currentMember.weekly_schedule) {
        // Partial legacy edit: modify only represented days and keep distinct routine on other days
        targetWeeklySchedule = JSON.parse(JSON.stringify(currentMember.weekly_schedule));
        const weekdays: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'sun'];
        const weekends: DayKey[] = ['fri', 'sat'];
        if (effectiveBedtime) {
          for (const d of weekdays) targetWeeklySchedule[d].bedtime = effectiveBedtime.trim();
        }
        if (effectiveWakeTime) {
          for (const d of weekdays) targetWeeklySchedule[d].wake_time = effectiveWakeTime.trim();
        }
        if (effectiveWeekendBedtime !== undefined) {
          for (const d of weekends) {
            targetWeeklySchedule[d].bedtime = weekendBedtimeVal || targetWeeklySchedule.mon.bedtime;
          }
        }
        if (effectiveWeekendWakeTime !== undefined) {
          for (const d of weekends) {
            targetWeeklySchedule[d].wake_time = weekendWakeTimeVal || targetWeeklySchedule.mon.wake_time;
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

    // Sync legacy flat columns from weekly schedule
    // Monday represents the weekday baseline, Saturday represents weekend
    const syncBedtime = targetWeeklySchedule.mon.bedtime;
    const syncWakeTime = targetWeeklySchedule.mon.wake_time;
    const syncWeekendBedtime = targetWeeklySchedule.sat.bedtime;
    const syncWeekendWakeTime = targetWeeklySchedule.sat.wake_time;

    // 6. Check for Schedule Changes vs Immediate Profile Changes
    const targetTimezone = timezone ? timezone.trim() : currentMember.timezone;

    const isWeeklyScheduleChanged = DAY_KEYS.some((day) => {
      const nxt = targetWeeklySchedule[day];
      if (currentMember.weekly_schedule) {
        const cur = currentMember.weekly_schedule[day];
        return !cur || cur.bedtime !== nxt.bedtime || cur.wake_time !== nxt.wake_time;
      }
      const isWeekend = day === 'fri' || day === 'sat';
      const curBed = (isWeekend && currentMember.weekend_bedtime_local) || currentMember.bedtime_local;
      const curWake = (isWeekend && currentMember.weekend_wake_time_local) || currentMember.wake_time_local;
      return nxt.bedtime !== curBed || nxt.wake_time !== curWake;
    });

    const storedWeekendBedtime = currentMember.weekend_bedtime_local || currentMember.bedtime_local;
    const storedWeekendWakeTime = currentMember.weekend_wake_time_local || currentMember.wake_time_local;
    const isWeekendBedtimeChanged = syncWeekendBedtime !== storedWeekendBedtime && Boolean(currentMember.weekend_bedtime_local || syncWeekendBedtime !== syncBedtime);
    const isWeekendWakeChanged = syncWeekendWakeTime !== storedWeekendWakeTime && Boolean(currentMember.weekend_wake_time_local || syncWeekendWakeTime !== syncWakeTime);

    const scheduleHasChanged =
      isWeeklyScheduleChanged ||
      syncBedtime !== currentMember.bedtime_local ||
      targetTimezone !== currentMember.timezone ||
      syncWakeTime !== currentMember.wake_time_local ||
      isWeekendBedtimeChanged ||
      isWeekendWakeChanged;

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
        updates.bedtime_local = syncBedtime;
        updates.wake_time_local = syncWakeTime;
        updates.timezone = targetTimezone;
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
      } else {
        // Enforce 48-Hour Cooldown Rule for regular member edits
        const effectiveAt = DateTime.utc().plus({ hours: 48 });
        updates.pending_bedtime_local = syncBedtime;
        updates.pending_wake_time_local = syncWakeTime;
        updates.pending_timezone = targetTimezone;
        updates.pending_weekend_bedtime_local = syncWeekendBedtime;
        updates.pending_weekend_wake_time_local = syncWeekendWakeTime;
        updates.pending_weekly_schedule = targetWeeklySchedule;
        updates.pending_effective_at = effectiveAt.toISO() as string;
        cooldownApplied = true;
        pendingEffectiveAt = effectiveAt.toISO() as string;
      }
    }

    // 7. Persist to Supabase
    const { data: updatedMember, error: updateError } = await updateMemberSafe(
      member_id,
      updates,
      {
        isFirstTimeClaim,
        requireUnlinkedDiscord: isFirstTimeClaim && !isSessionOwner && !isModeratorOverride,
      }
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

/**
 * PUT: Alias for POST to update a member's bedtime schedule.
 */
export async function PUT(request: Request) {
  return POST(request);
}
