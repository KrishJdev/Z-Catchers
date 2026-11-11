import { NextResponse } from 'next/server';
import { supabaseAdmin, Member } from '@/lib/db';
import { hashPin, verifyPin, createSessionToken, verifyModPasscode } from '@/lib/auth';
import {
  getClientIp,
  checkPinRateLimitPersistent,
  recordPinFailurePersistent,
  resetPinFailurePersistent,
} from '@/lib/rateLimit';

/**
 * POST: Authenticate member session via PIN or moderator passcode.
 * Enforces persistent serverless sliding-window rate limiting per IP and target profile.
 *
 * @param request - Incoming HTTP request containing member_id/username and pin
 * @returns JSON response with session cookie and authenticated member object
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { member_id, username, pin, mod_passcode } = body;

    const cleanUsername = typeof username === 'string' ? username.trim() : '';
    const cleanMemberId = typeof member_id === 'string' ? member_id.trim() : '';

    if (!cleanMemberId && !cleanUsername) {
      return NextResponse.json(
        { error: 'Please enter your username or select your member profile.' },
        { status: 400 }
      );
    }

    if (!pin || typeof pin !== 'string' || pin.trim().length < 4) {
      return NextResponse.json({ error: 'Please enter a valid 4-to-6 digit PIN.' }, { status: 400 });
    }

    const cleanPin = pin.trim();
    const clientIp = getClientIp(request);
    const targetIdentifier = cleanMemberId || cleanUsername.toLowerCase();

    // Rate limit check before verifying PIN
    const rateCheck = await checkPinRateLimitPersistent(clientIp, targetIdentifier);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          error: `Too many failed PIN attempts. Please wait ${rateCheck.retryAfterSeconds} seconds before trying again.`,
        },
        {
          status: 429,
          headers: { 'Retry-After': String(rateCheck.retryAfterSeconds) },
        }
      );
    }

    // 1. Fetch member from Supabase by member_id or case-insensitive username
    let query = supabaseAdmin.from('members').select('*').eq('is_active', true);
    if (cleanMemberId) {
      query = query.eq('id', cleanMemberId);
    } else {
      query = query.ilike('discord_username', cleanUsername);
    }

    const { data: member, error: memberErr } = await query.maybeSingle();

    if (memberErr || !member) {
      return NextResponse.json(
        { error: 'Profile not found. Please check your username or create a new profile.' },
        { status: 404 }
      );
    }

    const currentMember = member as Member;

    // Apply shared per-member attempt limit before PIN verification/claiming
    const memberRateCheck = await checkPinRateLimitPersistent(clientIp, currentMember.id);
    if (!memberRateCheck.allowed) {
      return NextResponse.json(
        {
          error: `Too many failed PIN attempts. Please wait ${memberRateCheck.retryAfterSeconds} seconds before trying again.`,
        },
        {
          status: 429,
          headers: { 'Retry-After': String(memberRateCheck.retryAfterSeconds) },
        }
      );
    }

    // 2. PIN validation or first-time claim
    if (!currentMember.passcode_hash) {
      // Require trusted authorization before enrolling/claiming unconfigured moderator accounts
      if (currentMember.role === 'moderator') {
        const isModAuthorized = verifyModPasscode(mod_passcode);
        if (!isModAuthorized) {
          await recordPinFailurePersistent(clientIp, currentMember.id);
          if (targetIdentifier && targetIdentifier !== currentMember.id) {
            await recordPinFailurePersistent('', targetIdentifier);
          }
          return NextResponse.json(
            { error: 'Claiming an initial moderator profile requires the moderator secret passcode.' },
            { status: 403 }
          );
        }
      }

      // First-time profile claiming: atomic update requiring passcode_hash to still be null
      const newHash = hashPin(cleanPin);
      const { data: updatedRows, error: updateErr } = await supabaseAdmin
        .from('members')
        .update({ passcode_hash: newHash })
        .eq('id', currentMember.id)
        .is('passcode_hash', null)
        .select('id');

      if (updateErr || !updatedRows || updatedRows.length === 0) {
        return NextResponse.json(
          { error: 'Profile has already been claimed or could not be updated. Please try logging in.' },
          { status: 409 }
        );
      }
      currentMember.passcode_hash = newHash;
      await resetPinFailurePersistent(clientIp, currentMember.id);
      if (targetIdentifier && targetIdentifier !== currentMember.id) {
        await resetPinFailurePersistent(clientIp, targetIdentifier);
      }
    } else {
      // Verify existing PIN
      const isMatch = verifyPin(cleanPin, currentMember.passcode_hash);
      if (!isMatch) {
        await recordPinFailurePersistent(clientIp, currentMember.id);
        if (targetIdentifier && targetIdentifier !== currentMember.id) {
          await recordPinFailurePersistent('', targetIdentifier);
        }
        return NextResponse.json({ error: 'Invalid PIN. Please check your PIN and try again.' }, { status: 401 });
      }
      await resetPinFailurePersistent(clientIp, currentMember.id);
      if (targetIdentifier && targetIdentifier !== currentMember.id) {
        await resetPinFailurePersistent(clientIp, targetIdentifier);
      }
    }

    // 3. Generate session token
    const token = createSessionToken(currentMember.id);

    // Sanitize member before returning (do not leak passcode_hash)
    const sanitizedMember: Omit<Member, 'passcode_hash'> & { has_pin: boolean } = {
      id: currentMember.id,
      discord_username: currentMember.discord_username,
      discord_handle: currentMember.discord_handle,
      avatar_url: currentMember.avatar_url,
      journal_url: currentMember.journal_url,
      bedtime_local: currentMember.bedtime_local,
      wake_time_local: currentMember.wake_time_local,
      timezone: currentMember.timezone,
      weekend_bedtime_local: currentMember.weekend_bedtime_local,
      weekend_wake_time_local: currentMember.weekend_wake_time_local,
      pending_bedtime_local: currentMember.pending_bedtime_local,
      pending_wake_time_local: currentMember.pending_wake_time_local,
      pending_timezone: currentMember.pending_timezone,
      pending_weekend_bedtime_local: currentMember.pending_weekend_bedtime_local,
      pending_weekend_wake_time_local: currentMember.pending_weekend_wake_time_local,
      pending_effective_at: currentMember.pending_effective_at,
      role: currentMember.role,
      is_active: currentMember.is_active,
      created_at: currentMember.created_at,
      updated_at: currentMember.updated_at,
      has_pin: true,
    };

    const response = NextResponse.json({
      success: true,
      message: `Welcome back, ${currentMember.discord_username}!`,
      member: sanitizedMember,
      token,
    });

    // 4. Set HttpOnly Cookie for seamless Next.js session persistence
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
    const message = err instanceof Error ? err.message : 'Unknown server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
