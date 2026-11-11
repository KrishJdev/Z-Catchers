import { NextResponse } from 'next/server';
import { supabaseAdmin, Member, updateMemberSafe } from '@/lib/db';
import {
  getRequestSession,
  createSessionToken,
  setSessionCookie,
  sanitizeMember,
  isModDiscordId,
} from '@/lib/auth';
import { DateTime } from 'luxon';

/**
 * GET: Retrieve the authenticated session member's profile and perform rolling session renewal.
 * Refreshes the 90-day session cookie and synchronizes moderator status against MOD_DISCORD_IDS.
 *
 * @param request - Incoming HTTP request with session cookie or Authorization header
 * @returns JSON response with authentication status and member entity, plus renewed Set-Cookie
 */
export async function GET(request: Request) {
  try {
    const session = getRequestSession(request);

    if (!session || !session.memberId) {
      return NextResponse.json({ authenticated: false, member: null }, { status: 200 });
    }

    const { data: memberData, error } = await supabaseAdmin
      .from('members')
      .select('*')
      .eq('id', session.memberId)
      .eq('is_active', true)
      .single();

    if (error || !memberData) {
      return NextResponse.json({ authenticated: false, member: null }, { status: 200 });
    }

    const currentMember = memberData as Member;

    // Evaluate effective moderator status dynamically (MOD_DISCORD_IDS is live; do not persist into DB role)
    const isDbMod = currentMember.role === 'moderator';
    const isEnvMod = isModDiscordId(currentMember.discord_id);
    const effectiveIsMod = isDbMod || isEnvMod;

    // Clean up stale database is_moderator flag if role is not moderator
    if (!isDbMod && currentMember.is_moderator) {
      await updateMemberSafe(currentMember.id, {
        is_moderator: false,
        updated_at: DateTime.utc().toISO() as string,
      });
      currentMember.is_moderator = false;
    }

    // Rolling 90-Day Session Renewal: Generate fresh token and extend expiration
    const renewedToken = createSessionToken(
      {
        memberId: currentMember.id,
        discordId: currentMember.discord_id || session.discordId || null,
        isModerator: effectiveIsMod,
      },
      90
    );

    const sanitized = sanitizeMember(currentMember);
    sanitized.is_moderator = effectiveIsMod;

    const response = NextResponse.json({
      authenticated: true,
      member: sanitized,
      token: renewedToken,
    });

    // Refresh rolling 90-day HttpOnly cookie
    setSessionCookie(response, renewedToken);

    return response;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
