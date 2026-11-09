import { NextResponse } from 'next/server';
import { supabaseAdmin, Member } from '@/lib/db';
import { DateTime } from 'luxon';
import { verifyPin, getRequestSessionMemberId } from '@/lib/auth';
import { calculateSleepStreak } from '@/lib/sleepEngine';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const memberId = searchParams.get('memberId');

    if (!memberId) {
      return NextResponse.json({ error: 'Missing memberId query parameter' }, { status: 400 });
    }

    const { data: member, error: memberErr } = await supabaseAdmin
      .from('members')
      .select('*')
      .eq('id', memberId)
      .single();

    if (memberErr || !member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    const sleeperNow = DateTime.utc().setZone(member.timezone);
    const todayStr = sleeperNow.toISODate();

    // Fetch member's recent check-ins
    const { data: logs } = await supabaseAdmin
      .from('notification_logs')
      .select('local_date')
      .eq('member_id', member.id)
      .eq('notification_type', 'IN_BED_EARLY')
      .order('local_date', { ascending: false })
      .limit(60);

    const checkinDates = (logs || []).map((l: { local_date: string }) => l.local_date);
    const isInBed = checkinDates.includes(todayStr || '');
    const streakDays = calculateSleepStreak(checkinDates, sleeperNow);

    return NextResponse.json({
      member_id: member.id,
      is_in_bed: isInBed,
      streak_days: streakDays,
      local_date: todayStr,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { memberId, action = 'check_in', pin } = body;

    if (!memberId) {
      return NextResponse.json({ error: 'Missing required field: memberId' }, { status: 400 });
    }

    const { data: rawMember, error: memberErr } = await supabaseAdmin
      .from('members')
      .select('*')
      .eq('id', memberId)
      .single();

    if (memberErr || !rawMember) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    const member = rawMember as Member;

    // Security Gate:
    // 1. Session must match target memberId, OR
    // 2. A valid PIN must be provided matching member's passcode_hash.
    const sessionMemberId = getRequestSessionMemberId(request);
    const isSessionMatch = sessionMemberId && sessionMemberId === member.id;
    const isPinMatch = pin && member.passcode_hash && verifyPin(pin.trim(), member.passcode_hash);

    if (!isSessionMatch && !isPinMatch) {
      if (sessionMemberId && sessionMemberId !== member.id) {
        return NextResponse.json(
          {
            error: 'Forbidden. You cannot check in or modify bedtime status for another member.',
            code: 'FORBIDDEN',
          },
          { status: 403 }
        );
      }

      return NextResponse.json(
        {
          error: member.passcode_hash
            ? 'Authentication required. Please log in with your 4-digit PIN before checking in.'
            : 'Please claim your profile with a 4-digit PIN before checking in.',
          code: 'UNAUTHORIZED',
        },
        { status: 401 }
      );
    }

    const nowUtc = DateTime.utc();
    const sleeperNow = nowUtc.setZone(member.timezone);
    const localDate = sleeperNow.toISODate();

    if (!localDate) {
      return NextResponse.json({ error: 'Failed to compute local date' }, { status: 500 });
    }

    if (action === 'cancel') {
      // Remove check-in for member's current local date
      const { error: delErr } = await supabaseAdmin
        .from('notification_logs')
        .delete()
        .eq('member_id', member.id)
        .eq('notification_type', 'IN_BED_EARLY')
        .eq('local_date', localDate);

      if (delErr) {
        return NextResponse.json({ error: delErr.message }, { status: 500 });
      }

      // Recompute streak after cancellation
      const { data: logs } = await supabaseAdmin
        .from('notification_logs')
        .select('local_date')
        .eq('member_id', member.id)
        .eq('notification_type', 'IN_BED_EARLY')
        .order('local_date', { ascending: false })
        .limit(60);

      const checkinDates = (logs || []).map((l: { local_date: string }) => l.local_date);
      const streakDays = calculateSleepStreak(checkinDates, sleeperNow);

      return NextResponse.json({
        success: true,
        action: 'cancel',
        is_in_bed: false,
        streak_days: streakDays,
        message: 'Check-in cancelled. Community nag notifications restored if within bedtime window.',
      });
    }

    // Default action: 'check_in' ("I'm in Bed" Safe Button)
    const { error: insertErr } = await supabaseAdmin
      .from('notification_logs')
      .upsert(
        {
          member_id: member.id,
          notification_type: 'IN_BED_EARLY',
          local_date: localDate,
          dispatched_at: nowUtc.toISO(),
        },
        { onConflict: 'member_id,notification_type,local_date' }
      );

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    // Compute updated streak
    const { data: logs } = await supabaseAdmin
      .from('notification_logs')
      .select('local_date')
      .eq('member_id', member.id)
      .eq('notification_type', 'IN_BED_EARLY')
      .order('local_date', { ascending: false })
      .limit(60);

    const checkinDates = (logs || []).map((l: { local_date: string }) => l.local_date);
    const streakDays = calculateSleepStreak(checkinDates, sleeperNow);

    return NextResponse.json({
      success: true,
      action: 'check_in',
      is_in_bed: true,
      local_date: localDate,
      streak_days: streakDays,
      message: 'Sweet dreams! You are checked in and community nag alerts are suppressed for tonight.',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
