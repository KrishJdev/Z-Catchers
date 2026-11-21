import { NextResponse } from 'next/server';
import { supabaseAdmin, insertMemberSafe } from '@/lib/db';
import {
  verifyClaimToken,
  createSessionToken,
  setSessionCookie,
  sanitizeMember,
  isModDiscordId,
} from '@/lib/auth';
import { isValidTimezone, DAY_KEYS, type WeeklySchedule } from '@/lib/timezone';
import { DateTime } from 'luxon';

const DISCORD_JOURNAL_REGEX = /^https:\/\/(ptb\.|canary\.)?discord\.com\/channels\/\d+\/\d+(\/\d+)?$/;
const TIME_FORMAT_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * GET: Retrieve the verified Discord identity for onboarding.
 *
 * @param request - Incoming HTTP request with claim_token query or cookie
 * @returns JSON response with verified Discord user details
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const queryToken = searchParams.get('claim_token');
    const cookieHeader = request.headers.get('cookie') || '';
    const cookieMatch = cookieHeader.match(/zcatchers_claim_token=([^;]+)/);
    const token = queryToken || (cookieMatch ? decodeURIComponent(cookieMatch[1]) : null);

    const payload = verifyClaimToken(token);
    if (!payload) {
      return NextResponse.json(
        { valid: false, error: 'Invalid or expired claim session. Please log in with Discord again.' },
        { status: 401 }
      );
    }

    return NextResponse.json({
      valid: true,
      discordUser: {
        id: payload.discordId,
        username: payload.discordUsername,
        handle: payload.discordHandle || `@${payload.discordUsername.toLowerCase().replace(/\s+/g, '')}`,
        avatarUrl: payload.avatarUrl,
        isModerator: isModDiscordId(payload.discordId),
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST: Finalize first-time Discord onboarding.
 * Creates a Discord-linked member with an initial bedtime, timezone, and journal URL.
 *
 * @param request - Incoming HTTP request containing claim_token, option, and schedule parameters
 * @returns JSON response with 90-day session cookie and sanitized member profile
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid onboarding request.' }, { status: 400 });
    }
    const {
      claim_token,
      option,
      discord_username,
      discord_handle,
      journal_url,
      bedtime_local,
      wake_time_local = '07:00',
      timezone,
      weekend_bedtime_local,
      weekend_wake_time_local,
      weekly_schedule,
    } = body;

    if (option !== undefined && option !== 'new') {
      return NextResponse.json({ error: 'This endpoint only supports new Discord profiles.' }, { status: 400 });
    }

    const stringFields = ['claim_token', 'discord_username', 'discord_handle', 'journal_url', 'bedtime_local',
      'wake_time_local', 'timezone', 'weekend_bedtime_local', 'weekend_wake_time_local'];
    if (stringFields.some(field => body[field] != null && typeof body[field] !== 'string')) {
      return NextResponse.json({ error: 'Onboarding text fields must be strings.' }, { status: 400 });
    }

    // Verify the signed onboarding token
    const cookieHeader = request.headers.get('cookie') || '';
    const cookieMatch = cookieHeader.match(/zcatchers_claim_token=([^;]+)/);
    const rawToken = claim_token || (cookieMatch ? decodeURIComponent(cookieMatch[1]) : null);

    const payload = verifyClaimToken(rawToken);
    if (!payload) {
      return NextResponse.json(
        {
          error:
            'Invalid or expired Discord claim session. Please start the login process again from the Fox Den.',
        },
        { status: 401 }
      );
    }

    // 2. Prevent duplicate claims: verify no active member already has this discordId
    const { data: existingLinked, error: lookupError } = await supabaseAdmin
      .from('members')
      .select('*')
      .eq('discord_id', payload.discordId)
      .maybeSingle();

    if (lookupError) {
      return NextResponse.json({ error: 'Could not look up the Discord profile. Please try again.' }, { status: 503 });
    }
    if (existingLinked && !existingLinked.is_active) {
      return NextResponse.json({ error: 'Your Discord profile is inactive. Contact a moderator.' }, { status: 403 });
    }

    if (existingLinked) {
      // If already linked, directly issue rolling session cookie
      const isLiveMod = isModDiscordId(payload.discordId);
      const isDbMod = existingLinked.role === 'moderator';
      const sessionToken = createSessionToken(
        {
          memberId: existingLinked.id,
          discordId: payload.discordId,
          isModerator: isDbMod || isLiveMod,
        },
        90
      );
      const res = NextResponse.json({
        success: true,
        member: sanitizeMember(existingLinked),
        token: sessionToken,
        message: 'Account is already linked. Logged in successfully.',
      });
      setSessionCookie(res, sessionToken);
      res.cookies.set({ name: 'zcatchers_claim_token', value: '', maxAge: 0, path: '/' });
      return res;
    }

    const isModerator = isModDiscordId(payload.discordId);

    const cleanUsername = (discord_username || payload.discordUsername || '').trim();
    if (!cleanUsername || cleanUsername.length < 2) {
      return NextResponse.json(
        { error: 'Please enter a valid display name (at least 2 characters).' },
        { status: 400 }
      );
    }

    const cleanJournal = (journal_url || '').trim();
    if (!cleanJournal || !DISCORD_JOURNAL_REGEX.test(cleanJournal)) {
      return NextResponse.json(
        {
          error:
            'Invalid Discord Journal Thread URL. Format must match: https://discord.com/channels/{guild}/{thread}',
        },
        { status: 400 }
      );
    }

    const cleanTz = (timezone || '').trim();
    if (!cleanTz || !isValidTimezone(cleanTz)) {
      return NextResponse.json(
        {
          error: `Invalid timezone identifier "${cleanTz}". Please select a valid IANA timezone (e.g. "America/New_York", "Asia/Kolkata").`,
        },
        { status: 400 }
      );
    }

    const cleanBedtime = (bedtime_local || '').trim();
    if (!cleanBedtime || !TIME_FORMAT_REGEX.test(cleanBedtime)) {
      return NextResponse.json(
        { error: 'Bedtime must be in 24-hour "HH:mm" format (e.g. "23:00").' },
        { status: 400 }
      );
    }

    const cleanWakeTime = (wake_time_local || '07:00').trim();
    if (!TIME_FORMAT_REGEX.test(cleanWakeTime)) {
      return NextResponse.json(
        { error: 'Wake time must be in 24-hour "HH:mm" format (e.g. "07:00").' },
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
        const ds = weekly_schedule[day];
        if (!ds || typeof ds !== 'object' || typeof ds.bedtime !== 'string' || typeof ds.wake_time !== 'string' || !TIME_FORMAT_REGEX.test(ds.bedtime.trim()) || !TIME_FORMAT_REGEX.test(ds.wake_time.trim())) {
          return NextResponse.json(
            { error: 'Invalid weekly_schedule format. Each day (mon through sun) must specify valid 24h HH:mm bedtime and wake_time.' },
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
      targetWeeklySchedule = {
        mon: { bedtime: cleanBedtime, wake_time: cleanWakeTime },
        tue: { bedtime: cleanBedtime, wake_time: cleanWakeTime },
        wed: { bedtime: cleanBedtime, wake_time: cleanWakeTime },
        thu: { bedtime: cleanBedtime, wake_time: cleanWakeTime },
        fri: {
          bedtime: weekend_bedtime_local?.trim() && TIME_FORMAT_REGEX.test(weekend_bedtime_local.trim()) ? weekend_bedtime_local.trim() : cleanBedtime,
          wake_time: weekend_wake_time_local?.trim() && TIME_FORMAT_REGEX.test(weekend_wake_time_local.trim()) ? weekend_wake_time_local.trim() : cleanWakeTime,
        },
        sat: {
          bedtime: weekend_bedtime_local?.trim() && TIME_FORMAT_REGEX.test(weekend_bedtime_local.trim()) ? weekend_bedtime_local.trim() : cleanBedtime,
          wake_time: weekend_wake_time_local?.trim() && TIME_FORMAT_REGEX.test(weekend_wake_time_local.trim()) ? weekend_wake_time_local.trim() : cleanWakeTime,
        },
        sun: { bedtime: cleanBedtime, wake_time: cleanWakeTime },
      };
    }

    const matchingDay = DAY_KEYS.find(day => targetWeeklySchedule[day].bedtime === targetWeeklySchedule[day].wake_time);
    if (matchingDay) {
      return NextResponse.json(
        { error: `Invalid schedule for "${matchingDay}": Bedtime and wake time cannot be identical.` },
        { status: 400 }
      );
    }

    const insertPayload: Record<string, unknown> = {
      discord_id: payload.discordId,
      discord_username: cleanUsername,
      discord_handle: discord_handle?.trim() || null,
      avatar_url: payload.avatarUrl,
      journal_url: cleanJournal,
      bedtime_local: targetWeeklySchedule.mon.bedtime,
      wake_time_local: targetWeeklySchedule.mon.wake_time,
      timezone: cleanTz,
      weekly_schedule: targetWeeklySchedule,
      is_moderator: false,
      role: 'member',
      onboarding_completed: true,
      is_active: true,
      strikes_used: 0,
      metastrikes_used: 0,
      strike_cycle_month: DateTime.utc().toFormat('yyyy-MM'),
    };

    if (targetWeeklySchedule.sat.bedtime) {
      insertPayload.weekend_bedtime_local = targetWeeklySchedule.sat.bedtime;
    }
    if (targetWeeklySchedule.sat.wake_time) {
      insertPayload.weekend_wake_time_local = targetWeeklySchedule.sat.wake_time;
    }

    const { data: createdMember, error: insertErr } = await insertMemberSafe(insertPayload);
    if (insertErr?.code === '23505') {
      return NextResponse.json({ error: 'Your profile was already created. Submit again to sign in.' }, { status: 409 });
    }
    if (insertErr || createdMember?.discord_id !== payload.discordId) {
      return NextResponse.json(
        { error: 'Failed to create the Discord profile. Please try again.' },
        { status: 500 }
      );
    }

    const sessionToken = createSessionToken(
      {
        memberId: createdMember.id,
        discordId: payload.discordId,
        isModerator,
      },
      90
    );

    const response = NextResponse.json(
      {
        success: true,
        member: sanitizeMember(createdMember),
        token: sessionToken,
        message: `Welcome to Z Catchers, ${createdMember.discord_username}! Your Discord account is linked.`,
      },
      { status: 201 }
    );

    setSessionCookie(response, sessionToken);
    response.cookies.set({ name: 'zcatchers_claim_token', value: '', maxAge: 0, path: '/' });
    return response;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
