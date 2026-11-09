import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin, Member } from '@/lib/db';
import { checkCooldownPromotion, calculateSleepStreak } from '@/lib/sleepEngine';
import { hashPin, sanitizeMember } from '@/lib/auth';
import { DateTime } from 'luxon';

const DISCORD_JOURNAL_REGEX = /^https:\/\/(ptb\.|canary\.)?discord\.com\/channels\/\d+\/\d+(\/\d+)?$/;

export async function GET() {
  try {
    const { data: members, error } = await supabase
      .from('members')
      .select('*')
      .eq('is_active', true)
      .order('discord_username', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const nowUtc = DateTime.utc();

    // Query recent check-ins for streak calculation and today's status
    const sixtyDaysAgo = nowUtc.minus({ days: 60 }).toISODate();
    const { data: inBedLogs } = await supabaseAdmin
      .from('notification_logs')
      .select('member_id, local_date')
      .eq('notification_type', 'IN_BED_EARLY')
      .gte('local_date', sixtyDaysAgo || '2026-01-01');

    const checkinsByMember = new Map<string, string[]>();
    for (const log of (inBedLogs || []) as { member_id: string; local_date: string }[]) {
      const dates = checkinsByMember.get(log.member_id) || [];
      dates.push(log.local_date);
      checkinsByMember.set(log.member_id, dates);
    }

    // Query recent nag assists for today's active count
    const twoDaysAgo = nowUtc.minus({ days: 2 }).toISODate();
    const { data: nagLogs } = await supabaseAdmin
      .from('notification_logs')
      .select('member_id, local_date')
      .like('notification_type', 'NAG_ASSIST:%')
      .gte('local_date', twoDaysAgo || '2026-01-01');

    const nagAssistsByMemberAndDate = new Map<string, number>();
    for (const log of (nagLogs || []) as { member_id: string; local_date: string }[]) {
      const key = `${log.member_id}_${log.local_date}`;
      nagAssistsByMemberAndDate.set(key, (nagAssistsByMemberAndDate.get(key) || 0) + 1);
    }

    // Process self-healing cooldown promotions and calculate streaks
    const processedMembers: Member[] = [];
    for (const member of (members as Member[]) || []) {
      const { promoted, activeMember } = checkCooldownPromotion(member, nowUtc);
      if (promoted) {
        // Update DB in background with supabaseAdmin
        await supabaseAdmin
          .from('members')
          .update({
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
          })
          .eq('id', member.id);
      }

      // Check-in & streak computation
      const sleeperNow = nowUtc.setZone(activeMember.timezone);
      const localDateStr = sleeperNow.toISODate() || '';
      const memberCheckins = checkinsByMember.get(activeMember.id) || [];
      const is_in_bed = memberCheckins.includes(localDateStr);
      const streak_days = calculateSleepStreak(memberCheckins, sleeperNow);
      const nag_assists_count = nagAssistsByMemberAndDate.get(`${activeMember.id}_${localDateStr}`) || 0;

      processedMembers.push({
        ...sanitizeMember(activeMember),
        is_in_bed,
        streak_days,
        nag_assists_count,
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

    if (!discord_username || !journal_url || !bedtime_local || !timezone) {
      return NextResponse.json(
        { error: 'Missing required fields (username, journal_url, bedtime, timezone)' },
        { status: 400 }
      );
    }

    if (!DISCORD_JOURNAL_REGEX.test(journal_url.trim())) {
      return NextResponse.json(
        { error: 'Invalid Discord journal thread URL. Must match https://discord.com/channels/...' },
        { status: 400 }
      );
    }

    const passcode_hash = pin && /^\d{4,6}$/.test(pin.trim()) ? hashPin(pin.trim()) : null;
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
        weekend_bedtime_local: weekend_bedtime_local?.trim() || null,
        weekend_wake_time_local: weekend_wake_time_local?.trim() || null,
        role: 'member',
        passcode_hash,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ member: sanitizeMember(data as Member) }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
