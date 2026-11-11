import { NextResponse } from 'next/server';
import { supabaseAdmin, Member, updateMemberSafe, insertMemberSafe } from '@/lib/db';
import {
  verifyClaimToken,
  createSessionToken,
  setSessionCookie,
  sanitizeMember,
  isModDiscordId,
  verifyPin,
  verifyModPasscode,
} from '@/lib/auth';
import {
  getClientIp,
  checkPinRateLimitPersistent,
  recordPinFailurePersistent,
  resetPinFailurePersistent,
} from '@/lib/rateLimit';
import { isValidTimezone } from '@/lib/timezone';
import { DateTime } from 'luxon';

const DISCORD_JOURNAL_REGEX = /^https:\/\/(ptb\.|canary\.)?discord\.com\/channels\/\d+\/\d+(\/\d+)?$/;
const TIME_FORMAT_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * GET: Retrieve details of a pending claim token and unclaimed roster candidates.
 *
 * @param request - Incoming HTTP request with claim_token query or cookie
 * @returns JSON response with candidate Discord user details and unclaimed roster members
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

    // Fetch unclaimed members (where discord_id is NULL)
    const { data: unclaimedMembers } = await supabaseAdmin
      .from('members')
      .select('id, discord_username, bedtime_local, timezone, avatar_url, role, passcode_hash')
      .is('discord_id', null)
      .eq('is_active', true)
      .order('discord_username', { ascending: true });

    const formattedUnclaimed = (unclaimedMembers || []).map((m: any) => ({
      id: m.id,
      discord_username: m.discord_username,
      bedtime_local: m.bedtime_local,
      timezone: m.timezone,
      avatar_url: m.avatar_url,
      role: m.role,
      has_pin: Boolean(m.passcode_hash),
    }));

    return NextResponse.json({
      valid: true,
      discordUser: {
        id: payload.discordId,
        username: payload.discordUsername,
        avatarUrl: payload.avatarUrl,
        isModerator: payload.isModerator,
        suggestedMemberId: payload.suggestedMemberId || null,
      },
      unclaimedMembers: formattedUnclaimed,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST: Finalize first-time Discord onboarding.
 * Option A (claim): Binds Discord ID and avatar to an existing unclaimed member row.
 * Option B (new): Creates a new member row with user's bedtime, timezone, and journal URL.
 *
 * @param request - Incoming HTTP request containing claim_token, option, and schedule parameters
 * @returns JSON response with 90-day session cookie and sanitized member profile
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const clientIp = getClientIp(request);
    const {
      claim_token,
      option,
      target_member_id,
      pin,
      mod_passcode,
      discord_username,
      discord_handle,
      journal_url,
      bedtime_local,
      wake_time_local = '07:00',
      timezone,
      weekend_bedtime_local,
      weekend_wake_time_local,
    } = body;

    // 1. Verify signed claim token
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
    const { data: existingLinked } = await supabaseAdmin
      .from('members')
      .select('id')
      .eq('discord_id', payload.discordId)
      .eq('is_active', true)
      .maybeSingle();

    if (existingLinked) {
      // If already linked, directly issue rolling session cookie
      const sessionToken = createSessionToken(
        {
          memberId: existingLinked.id,
          discordId: payload.discordId,
          isModerator: payload.isModerator || isModDiscordId(payload.discordId),
        },
        90
      );
      const res = NextResponse.json({
        success: true,
        message: 'Account is already linked. Logged in successfully.',
      });
      setSessionCookie(res, sessionToken);
      res.cookies.set({ name: 'zcatchers_claim_token', value: '', maxAge: 0, path: '/' });
      return res;
    }

    const isModerator = Boolean(payload.isModerator || isModDiscordId(payload.discordId));

    // Option A: Claim existing unclaimed roster profile
    if (option === 'claim') {
      if (!target_member_id || typeof target_member_id !== 'string') {
        return NextResponse.json(
          { error: 'Please select an existing member profile to claim.' },
          { status: 400 }
        );
      }

      const { data: targetData, error: targetErr } = await supabaseAdmin
        .from('members')
        .select('*')
        .eq('id', target_member_id)
        .eq('is_active', true)
        .maybeSingle();

      if (targetErr || !targetData) {
        return NextResponse.json(
          { error: 'Selected member profile was not found or is inactive.' },
          { status: 404 }
        );
      }

      const target = targetData as Member;
      if (target.discord_id && target.discord_id !== payload.discordId) {
        return NextResponse.json(
          { error: 'This profile has already been claimed by another Discord account.' },
          { status: 409 }
        );
      }

      const isTargetMod = target.role === 'moderator' || target.is_moderator === true;
      const hasValidModPasscode = Boolean(mod_passcode && verifyModPasscode(mod_passcode));
      const hasModAuthorization = isModerator || hasValidModPasscode;

      if (isTargetMod && !hasModAuthorization) {
        return NextResponse.json(
          { error: 'Claiming a moderator profile requires moderator authorization.' },
          { status: 403 }
        );
      }

      if (target.passcode_hash && !hasModAuthorization) {
        const rateCheck = await checkPinRateLimitPersistent(clientIp, target.id);
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

        if (!pin || typeof pin !== 'string' || !verifyPin(pin.trim(), target.passcode_hash)) {
          await recordPinFailurePersistent(clientIp, target.id);
          return NextResponse.json(
            { error: 'Invalid PIN. Please enter the correct PIN for this profile.' },
            { status: 401 }
          );
        }

        await resetPinFailurePersistent(clientIp, target.id);
      }

      const willBeMod = isModerator;

      const { data: updatedMember, error: updateErr } = await updateMemberSafe(
        target.id,
        {
          discord_id: payload.discordId,
          discord_username: payload.discordUsername || target.discord_username,
          avatar_url: payload.avatarUrl || target.avatar_url,
          is_moderator: willBeMod,
          role: willBeMod ? 'moderator' : (target.role === 'moderator' ? 'member' : target.role),
          onboarding_completed: true,
          updated_at: DateTime.utc().toISO() as string,
        },
        { requireUnlinkedDiscord: true }
      );

      if (updateErr) {
        return NextResponse.json(
          { error: updateErr.message || 'Failed to claim member profile.' },
          { status: 500 }
        );
      }

      if (!updatedMember) {
        return NextResponse.json(
          { error: 'This profile has already been claimed by another Discord account.' },
          { status: 409 }
        );
      }

      const sessionToken = createSessionToken(
        {
          memberId: updatedMember.id,
          discordId: payload.discordId,
          isModerator: willBeMod,
        },
        90
      );

      const response = NextResponse.json({
        success: true,
        member: sanitizeMember(updatedMember),
        token: sessionToken,
        message: `Welcome back! You have successfully claimed @${updatedMember.discord_username}.`,
      });

      setSessionCookie(response, sessionToken);
      response.cookies.set({ name: 'zcatchers_claim_token', value: '', maxAge: 0, path: '/' });
      return response;
    }

    // Option B: Create new Fox Den profile
    if (option === 'new') {
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

      const insertPayload: Record<string, unknown> = {
        discord_id: payload.discordId,
        discord_username: cleanUsername,
        discord_handle: discord_handle?.trim() || null,
        avatar_url: payload.avatarUrl,
        journal_url: cleanJournal,
        bedtime_local: cleanBedtime,
        wake_time_local: cleanWakeTime,
        timezone: cleanTz,
        is_moderator: isModerator,
        role: isModerator ? 'moderator' : 'member',
        onboarding_completed: true,
        is_active: true,
        strikes_used: 0,
        metastrikes_used: 0,
        strike_cycle_month: DateTime.utc().toFormat('yyyy-MM'),
      };

      if (weekend_bedtime_local?.trim() && TIME_FORMAT_REGEX.test(weekend_bedtime_local.trim())) {
        insertPayload.weekend_bedtime_local = weekend_bedtime_local.trim();
      }
      if (weekend_wake_time_local?.trim() && TIME_FORMAT_REGEX.test(weekend_wake_time_local.trim())) {
        insertPayload.weekend_wake_time_local = weekend_wake_time_local.trim();
      }

      const { data: createdMember, error: insertErr } = await insertMemberSafe(insertPayload);
      if (insertErr || !createdMember) {
        return NextResponse.json(
          { error: insertErr?.message || 'Failed to create new member profile.' },
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
    }

    return NextResponse.json(
      { error: "Invalid option. Please specify 'claim' or 'new'." },
      { status: 400 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
