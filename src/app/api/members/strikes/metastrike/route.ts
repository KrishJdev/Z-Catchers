import { NextResponse } from 'next/server';
import { supabaseAdmin, Member } from '@/lib/db';
import { getRequestSessionMemberId, verifyPin, verifyModPasscode } from '@/lib/auth';
import {
  useProactiveMetastrike,
  convertStrikeToMetastrike,
  getRecentEligibleStrikeLog,
} from '@/lib/strikes';
import { getSleepCycleDate } from '@/lib/sleepEngine';
import {
  getClientIp,
  checkPinRateLimitPersistent,
  recordPinFailurePersistent,
  resetPinFailurePersistent,
} from '@/lib/rateLimit';
import { DateTime } from 'luxon';

/**
 * POST /api/members/strikes/metastrike
 *
 * Allows a member or moderator to use an excused Metastrike pass:
 * 1. Proactive (Tonight): Claims a pass for tonight with an optional excuse reason ("Monthly Battle", "Family", etc.)
 * 2. Retroactive (24-Hour Swap): Converts a community-issued strike within a 24-hour window following the missed bedtime into an excused Metastrike.
 *
 * @param request - Incoming HTTP request with member ID, action, reason, and auth credentials
 * @returns JSON response containing action result and updated strike counts
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const {
      member_id,
      action = 'proactive',
      reason,
      pin,
      mod_passcode,
      sleep_cycle_date,
    } = body;

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
    const clientIp = getClientIp(request);

    // Rate limit check before verifying auth
    const rateCheck = await checkPinRateLimitPersistent(clientIp, member.id);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          error: `Too many failed attempts. Please wait ${rateCheck.retryAfterSeconds} seconds.`,
        },
        {
          status: 429,
          headers: { 'Retry-After': String(rateCheck.retryAfterSeconds) },
        }
      );
    }

    // Security check: Target member ownership OR Moderator authorization
    const sessionMemberId = getRequestSessionMemberId(request);
    let isAuthorized = false;
    let isModerator = false;

    // 1. Check moderator passcode
    const headerPasscode = request.headers.get('x-mod-passcode');
    const candidatePasscode = mod_passcode || headerPasscode;
    if (candidatePasscode) {
      if (verifyModPasscode(candidatePasscode)) {
        isAuthorized = true;
        isModerator = true;
      } else {
        await recordPinFailurePersistent(clientIp, member.id);
        return NextResponse.json(
          { error: 'Invalid moderator passcode.' },
          { status: 401 }
        );
      }
    }

    // 2. Check session token (matching target member OR moderator role)
    if (!isAuthorized && sessionMemberId) {
      if (sessionMemberId === member.id) {
        isAuthorized = true;
      } else {
        const { data: sessionUser } = await supabaseAdmin
          .from('members')
          .select('role, is_active')
          .eq('id', sessionMemberId)
          .single();

        if (sessionUser && sessionUser.is_active && sessionUser.role === 'moderator') {
          isAuthorized = true;
          isModerator = true;
        }
      }
    }

    // 3. Check 4-digit PIN for target member
    if (!isAuthorized && pin !== undefined && pin !== null) {
      if (typeof pin !== 'string') {
        return NextResponse.json({ error: 'PIN must be a string.' }, { status: 400 });
      }

      if (member.passcode_hash && verifyPin(pin, member.passcode_hash)) {
        isAuthorized = true;
        await resetPinFailurePersistent(clientIp, member.id);
      } else {
        await recordPinFailurePersistent(clientIp, member.id);
        return NextResponse.json(
          { error: 'Invalid 4-digit PIN for this profile.' },
          { status: 401 }
        );
      }
    }

    if (!isAuthorized) {
      if (sessionMemberId && sessionMemberId !== member.id) {
        return NextResponse.json(
          {
            error: 'Forbidden. You cannot manage Metastrikes for another member without moderator privileges.',
            code: 'FORBIDDEN',
          },
          { status: 403 }
        );
      }
      return NextResponse.json(
        {
          error: 'Authentication required. Please log in with your profile or moderator passcode to use a Metastrike.',
          code: 'UNAUTHORIZED',
        },
        { status: 401 }
      );
    }

    const nowUtc = DateTime.utc();
    const cycleDate = getSleepCycleDate(member, nowUtc);

    if (action === 'convert_retroactive') {
      let targetCycleDate =
        typeof sleep_cycle_date === 'string' && sleep_cycle_date.trim()
          ? sleep_cycle_date.trim()
          : undefined;
      if (!targetCycleDate) {
        const eligibleStrike = await getRecentEligibleStrikeLog(member.id, nowUtc);
        targetCycleDate = eligibleStrike ? eligibleStrike.sleep_cycle_date : cycleDate;
      }

      const result = await convertStrikeToMetastrike(
        member,
        reason || (isModerator ? 'Moderator Retroactive Excuse' : 'Converted from Strike'),
        targetCycleDate,
        nowUtc,
        isModerator
      );

      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }

      return NextResponse.json({
        success: true,
        action: 'convert_retroactive',
        member_id: member.id,
        sleep_cycle_date: targetCycleDate,
        log: result.log,
        strikes_used: result.strikesUsed,
        strikes_count: result.strikesUsed,
        metastrikes_used: result.metastrikesUsed,
        metastrikes_count: result.metastrikesUsed,
      });
    }

    // Default: Proactive Metastrike pass for tonight
    const result = await useProactiveMetastrike(
      member,
      reason || (isModerator ? 'Moderator Excused Pass' : 'Excused Night'),
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
      metastrikes_count: result.metastrikesUsed,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
