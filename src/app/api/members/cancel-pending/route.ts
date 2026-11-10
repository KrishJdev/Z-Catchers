import { NextResponse } from 'next/server';
import { supabaseAdmin, Member } from '@/lib/db';
import { verifyPin, verifyModPasscode, sanitizeMember } from '@/lib/auth';
import { getClientIp, checkPinRateLimit, recordPinFailure, resetPinFailure } from '@/lib/rateLimit';
import { DateTime } from 'luxon';

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

    if (!isModerator) {
      if (!member.passcode_hash) {
        return NextResponse.json(
          { error: 'PIN protection is required to cancel pending schedule changes.' },
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

    const { data: updatedMember, error: updateError } = await supabaseAdmin
      .from('members')
      .update({
        pending_bedtime_local: null,
        pending_wake_time_local: null,
        pending_timezone: null,
        pending_weekend_bedtime_local: null,
        pending_weekend_wake_time_local: null,
        pending_effective_at: null,
        updated_at: DateTime.utc().toISO() as string,
      })
      .eq('id', member_id)
      .select('*')
      .single();

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
