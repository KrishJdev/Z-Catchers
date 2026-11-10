import { NextResponse } from 'next/server';
import {
  supabase,
  supabaseAdmin,
  Member,
  fetchAllNotificationLogs,
  updateMemberSafe,
  insertMemberSafe,
  hydrateMemberWeekendHours,
} from '@/lib/db';
import { checkCooldownPromotion, calculateSleepStreak, getSleepCycleDate } from '@/lib/sleepEngine';
import { hashPin, sanitizeMember, createSessionToken, getRequestSessionMemberId } from '@/lib/auth';
import { toValidLuxonZone, isValidTimezone, formatGmtOffset, detectUserTimezone } from '@/lib/timezone';
import { resolveMemberStrikeCounts, getNightlyStrikeLog } from '@/lib/strikes';
import { DateTime } from 'luxon';

const DISCORD_JOURNAL_REGEX = /^https:\/\/(ptb\.|canary\.)?discord\.com\/channels\/\d+\/\d+(\/\d+)?$/;
const TIME_FORMAT_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function GET(request: Request) {
  try {
    const sessionMemberId = getRequestSessionMemberId(request);
    const { data: members, error } = await supabase
      .from('members')
      .select('*')
      .eq('is_active', true)
      .order('discord_username', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const nowUtc = DateTime.utc();

    // Query recent check-ins for streak calculation and today's status (paginated to avoid PostgREST row cap)
    const sixtyDaysAgo = nowUtc.minus({ days: 60 }).toISODate() || '2026-01-01';
    const { data: inBedLogs } = await fetchAllNotificationLogs<{ member_id: string; local_date: string }>((q) =>
      q.select('member_id, local_date')
        .eq('notification_type', 'IN_BED_EARLY')
        .gte('local_date', sixtyDaysAgo)
    );

    const checkinsByMember = new Map<string, string[]>();
    for (const log of (inBedLogs || [])) {
      const dates = checkinsByMember.get(log.member_id) || [];
      dates.push(log.local_date);
      checkinsByMember.set(log.member_id, dates);
    }

    // Query recent nag assists for today's active count (paginated to avoid PostgREST row cap)
    const twoDaysAgo = nowUtc.minus({ days: 2 }).toISODate() || '2026-01-01';
    const { data: nagLogs } = await fetchAllNotificationLogs<{ member_id: string; local_date: string }>((q) =>
      q.select('member_id, local_date')
        .like('notification_type', 'NAG_ASSIST:%')
        .gte('local_date', twoDaysAgo)
    );

    const nagAssistsByMemberAndDate = new Map<string, number>();
    for (const log of (nagLogs || [])) {
      const key = `${log.member_id}_${log.local_date}`;
      nagAssistsByMemberAndDate.set(key, (nagAssistsByMemberAndDate.get(key) || 0) + 1);
    }

    // Process self-healing cooldown promotions and calculate streaks
    const processedMembers: Member[] = [];
    for (const member of (members as Member[]) || []) {
      const { promoted, activeMember } = checkCooldownPromotion(member, nowUtc);
      if (promoted) {
        // Update DB in background with safe column stripping
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
          updated_at: nowUtc.toISO(),
        });
      }

      const hydratedMember = hydrateMemberWeekendHours(activeMember);

      // Check-in & streak computation
      const sleeperNow = nowUtc.setZone(toValidLuxonZone(hydratedMember.timezone));
      const localDateStr = getSleepCycleDate(hydratedMember, nowUtc);
      const memberCheckins = checkinsByMember.get(hydratedMember.id) || [];
      const is_in_bed = memberCheckins.includes(localDateStr);
      const streak_days = calculateSleepStreak(memberCheckins, sleeperNow);
      const nag_assists_count = nagAssistsByMemberAndDate.get(`${hydratedMember.id}_${localDateStr}`) || 0;

      // Strikes & Metastrikes resolution (handles lazy monthly resets)
      const strikeInfo = await resolveMemberStrikeCounts(hydratedMember, nowUtc);
      const tonightLog = await getNightlyStrikeLog(hydratedMember.id, localDateStr);
      const is_metastrike_active = tonightLog?.record_type === 'metastrike';
      const metastrike_reason = tonightLog?.reason || null;
      const has_voted_strike = Boolean(sessionMemberId && tonightLog?.voter_ids?.includes(sessionMemberId));

      processedMembers.push({
        ...sanitizeMember(hydratedMember),
        is_in_bed,
        streak_days,
        nag_assists_count,
        strikes_used: strikeInfo.strikes_used,
        strikes_count: strikeInfo.strikes_used,
        metastrikes_used: strikeInfo.metastrikes_used,
        metastrikes_count: strikeInfo.metastrikes_used,
        strike_cycle_month: strikeInfo.strike_cycle_month,
        tonight_strike_log: tonightLog,
        is_metastrike_active,
        metastrike_reason,
        has_voted_strike,
      });
    }

    return NextResponse.json({ members: processedMembers });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      discord_username,
      discord_handle,
      journal_url,
      bedtime_local,
      wake_time_local = '07:00',
      timezone,
      weekend_bedtime_local,
      weekend_wake_time_local,
      pin,
    } = body;

    if (!discord_username || !journal_url || !bedtime_local) {
      return NextResponse.json(
        { error: 'Missing required fields (username, journal link, bedtime).' },
        { status: 400 }
      );
    }

    const cleanUsername = String(discord_username).trim();
    if (cleanUsername.length < 2 || cleanUsername.length > 32) {
      return NextResponse.json(
        { error: 'Username must be between 2 and 32 characters.' },
        { status: 400 }
      );
    }

    // Check for username duplication (case-insensitive)
    const { data: existingUser } = await supabaseAdmin
      .from('members')
      .select('id, discord_username')
      .ilike('discord_username', cleanUsername)
      .eq('is_active', true)
      .maybeSingle();

    if (existingUser) {
      return NextResponse.json(
        { error: `The username "${cleanUsername}" is already taken. Please choose a different username or log in.` },
        { status: 409 }
      );
    }

    // Validate Discord Journal URL
    const cleanJournal = String(journal_url).trim();
    if (!DISCORD_JOURNAL_REGEX.test(cleanJournal)) {
      return NextResponse.json(
        { error: 'Invalid Discord journal thread URL. Must match format: https://discord.com/channels/{server_id}/{thread_id}' },
        { status: 400 }
      );
    }

    // Validate 4-to-6 digit numeric PIN
    const cleanPin = pin ? String(pin).trim() : '';
    if (!cleanPin || !/^\d{4,6}$/.test(cleanPin)) {
      return NextResponse.json(
        { error: 'Please choose a 4-to-6 digit numeric PIN to protect your profile.' },
        { status: 400 }
      );
    }

    // Validate Timezone (auto-detects IANA timezone if not provided)
    const cleanTz = timezone && String(timezone).trim() ? String(timezone).trim() : detectUserTimezone();
    if (!isValidTimezone(cleanTz)) {
      return NextResponse.json(
        { error: `Invalid timezone identifier "${cleanTz}". Please provide a valid IANA timezone (e.g. "Europe/Athens", "America/New_York", "Asia/Kolkata").` },
        { status: 400 }
      );
    }

    // Validate 24-hour time format (HH:mm)
    if (!TIME_FORMAT_REGEX.test(bedtime_local.trim())) {
      return NextResponse.json(
        { error: 'Invalid bedtime format. Must be HH:mm (24-hour, e.g. 23:00).' },
        { status: 400 }
      );
    }
    if (wake_time_local && !TIME_FORMAT_REGEX.test(wake_time_local.trim())) {
      return NextResponse.json(
        { error: 'Invalid wake time format. Must be HH:mm (24-hour, e.g. 07:00).' },
        { status: 400 }
      );
    }
    if (weekend_bedtime_local?.trim() && !TIME_FORMAT_REGEX.test(weekend_bedtime_local.trim())) {
      return NextResponse.json(
        { error: 'Invalid weekend bedtime format. Must be HH:mm (24-hour, e.g. 01:00).' },
        { status: 400 }
      );
    }
    if (weekend_wake_time_local?.trim() && !TIME_FORMAT_REGEX.test(weekend_wake_time_local.trim())) {
      return NextResponse.json(
        { error: 'Invalid weekend wake time format. Must be HH:mm (24-hour, e.g. 09:00).' },
        { status: 400 }
      );
    }

    const passcode_hash = hashPin(cleanPin);
    const avatar_url = `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(
      cleanUsername
    )}`;

    const insertPayload: Record<string, unknown> = {
      discord_username: cleanUsername,
      discord_handle: discord_handle?.trim() || null,
      avatar_url,
      journal_url: cleanJournal,
      bedtime_local: bedtime_local.trim(),
      wake_time_local: wake_time_local.trim(),
      timezone: cleanTz,
      role: 'member',
      passcode_hash,
      strikes_used: 0,
      metastrikes_used: 0,
      strike_cycle_month: DateTime.utc().toFormat('yyyy-MM'),
    };

    if (weekend_bedtime_local?.trim()) {
      insertPayload.weekend_bedtime_local = weekend_bedtime_local.trim();
    }
    if (weekend_wake_time_local?.trim()) {
      insertPayload.weekend_wake_time_local = weekend_wake_time_local.trim();
    }

    let { data, error } = await supabaseAdmin
      .from('members')
      .insert(insertPayload)
      .select()
      .single();

    // Resilient fallback: If strikes/weekend columns do not exist in the database schema yet, retry with core fields
    if (error && (error.code === 'PGRST204' || error.code === '42703')) {
      delete insertPayload.weekend_bedtime_local;
      delete insertPayload.weekend_wake_time_local;
      delete insertPayload.strikes_used;
      delete insertPayload.metastrikes_used;
      delete insertPayload.strike_cycle_month;
      const fallbackRes = await supabaseAdmin
        .from('members')
        .insert(insertPayload)
        .select()
        .single();
      data = fallbackRes.data;
      error = fallbackRes.error;
    }

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const createdMember = data as Member;
    const token = createSessionToken(createdMember.id);
    const sanitized = sanitizeMember(createdMember);

    const response = NextResponse.json(
      {
        success: true,
        member: sanitized,
        token,
        message: `Welcome to Z Catchers, ${cleanUsername}! Your profile has been created and secured with your PIN.`,
      },
      { status: 201 }
    );

    // Set 30-day HttpOnly session cookie
    response.cookies.set({
      name: 'zcatchers_session',
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });

    return response;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
