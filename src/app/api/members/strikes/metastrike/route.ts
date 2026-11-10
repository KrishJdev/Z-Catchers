import { NextResponse } from 'next/server';
import { supabaseAdmin, Member } from '@/lib/db';
import { getRequestSessionMemberId, verifyPin } from '@/lib/auth';
import { useProactiveMetastrike, convertStrikeToMetastrike } from '@/lib/strikes';
import { getSleepCycleDate } from '@/lib/sleepEngine';
import { getClientIp, checkPinRateLimit, recordPinFailure, resetPinFailure } from '@/lib/rateLimit';
import { DateTime } from 'luxon';

/**
 * POST /api/members/strikes/metastrike
 *
 * Allows a member to use an excused Metastrike pass:
 * 1. Proactive (Tonight): Claims a pass for tonight with an optional excuse reason ("Monthly Battle", "Family", etc.)
 * 2. Retroactive (24-Hour Swap): Converts a community-issued strike from the last 24 hours into an excused Metastrike.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { member_id, action = 'proactive', reason, pin } = body;

    if (!member_id || typeof member_id !== 'string') {
      return NextResponse.json({ error: 'Missing member_id.' }, { status: 400 });
    }

    // Fetch target member
    const { data: rawMember, error: memberErr } = await supabaseAdmin
      .from('members')
      .select('*')
      .eq('id', member_id)
      .single();

    if (memberErr || !rawMember) {
      return NextResponse.json({ error: 'Member not found.' }, { status: 404 });
    }

    const member = rawMember as Member;

    // Security check: Session must match target member OR valid PIN provided
    const sessionMemberId = getRequestSessionMemberId(request);
    const isSessionMatch = Boolean(sessionMemberId && sessionMemberId === member.id);

    let isPinMatch = false;
    if (!isSessionMatch) {
      if (sessionMemberId && sessionMemberId !== member.id) {
        return NextResponse.json(
          {
            error: 'Forbidden. You cannot manage Metastrikes for another member.',
            code: 'FORBIDDEN',
          },
          { status: 403 }
        );
      }

      if (pin !== undefined && pin !== null) {
        if (typeof pin !== 'string') {
          return NextResponse.json({ error: 'PIN must be a string.' }, { status: 400 });
        }
        const clientIp = getClientIp(request);
        const rateCheck = checkPinRateLimit(clientIp, member.id);
        if (!rateCheck.allowed) {
          return NextResponse.json(
            {
              error: `Too many failed PIN attempts. Please wait ${rateCheck.retryAfterSeconds} seconds.`,
            },
            {
              status: 429,
              headers: { 'Retry-After': String(rateCheck.retryAfterSeconds) },
            }
          );
        }

        if (member.passcode_hash && verifyPin(pin, member.passcode_hash)) {
          isPinMatch = true;
          resetPinFailure(clientIp, member.id);
        } else {
          recordPinFailure(clientIp, member.id);
          return NextResponse.json(
            { error: 'Invalid 4-digit PIN for this profile.' },
            { status: 401 }
          );
        }
      } else {
        return NextResponse.json(
          {
            error: 'Authentication required. Please log in with your profile to use a Metastrike.',
            code: 'UNAUTHORIZED',
          },
          { status: 401 }
        );
      }
    }

    const nowUtc = DateTime.utc();
    const cycleDate = getSleepCycleDate(member, nowUtc);

    if (action === 'convert_retroactive') {
      const result = await convertStrikeToMetastrike(
        member,
        reason || 'Converted from Strike',
        cycleDate,
        nowUtc
      );

      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }

      return NextResponse.json({
        success: true,
        action: 'convert_retroactive',
        member_id: member.id,
        sleep_cycle_date: cycleDate,
        log: result.log,
        strikes_used: result.strikesUsed,
        metastrikes_used: result.metastrikesUsed,
      });
    }

    // Default: Proactive Metastrike pass for tonight
    const result = await useProactiveMetastrike(
      member,
      reason || 'Excused Night',
      cycleDate,
      nowUtc
    );

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      action: 'proactive',
      member_id: member.id,
      sleep_cycle_date: cycleDate,
      log: result.log,
      metastrikes_used: result.metastrikesUsed,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
