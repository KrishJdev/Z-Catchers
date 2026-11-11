import { NextResponse } from 'next/server';
import { supabaseAdmin, Member, updateMemberSafe } from '@/lib/db';
import { verifyPin, verifyModPasscode, sanitizeMember, getRequestSessionMemberId } from '@/lib/auth';
import { getClientIp, checkPinRateLimit, recordPinFailure, resetPinFailure } from '@/lib/rateLimit';
import { DateTime } from 'luxon';

/**
 * POST: Cancel a member's pending schedule changes during the 48-hour cooldown window.
 * Requires member PIN authentication or moderator passcode override.
 *
 * @param request - Incoming HTTP request with member_id and PIN or mod_passcode
 * @returns JSON response confirming cancellation of pending schedule changes
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { member_id, pin, mod_passcode } = body;

    if (!member_id) {
      return NextResponse.json({ error: 'Missing member_id' }, { status: 400 });
    }

    const { data: memberData, error: fetchError } = await supabaseAdmin
      .from('members')
      .select('*')
      .eq('id', member_id)
      .single();

    if (fetchError || !memberData) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    const member = memberData as Member;
    const clientIp = getClientIp(request);

    let isModerator = false;
    if (mod_passcode) {
      if (checkPinRateLimit(clientIp, '').allowed) {
        isModerator = verifyModPasscode(mod_passcode);
        if (!isModerator) {
          recordPinFailure(clientIp, '');
        }
      }
    }

    const sessionMemberId = getRequestSessionMemberId(request);
    const isSessionOwner = Boolean(sessionMemberId && sessionMemberId === member.id);

    if (!isModerator && !isSessionOwner) {
      if (!member.passcode_hash) {
        return NextResponse.json(
          { error: 'PIN protection or owner session is required to cancel pending schedule changes.' },
          { status: 403 }
        );
      }

      const rateCheck = checkPinRateLimit(clientIp, member.id);
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

      if (!pin || typeof pin !== 'string' || !verifyPin(pin.trim(), member.passcode_hash)) {
        recordPinFailure(clientIp, member.id);
        return NextResponse.json(
          { error: 'Invalid PIN. PIN is required to cancel your pending change.' },
          { status: 401 }
        );
      }
      resetPinFailure(clientIp, member.id);
    }

    const { data: updatedMember, error: updateError } = await updateMemberSafe(
      member_id,
      {
        pending_bedtime_local: null,
        pending_wake_time_local: null,
        pending_timezone: null,
        pending_weekend_bedtime_local: null,
        pending_weekend_wake_time_local: null,
        pending_effective_at: null,
        updated_at: DateTime.utc().toISO() as string,
      }
    );

    if (updateError || !updatedMember) {
      return NextResponse.json(
        { error: updateError?.message || 'Failed to cancel pending change' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Pending schedule change cancelled. Existing schedule remains active.',
      member: sanitizeMember(updatedMember as Member),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
