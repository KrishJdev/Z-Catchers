import { NextResponse } from 'next/server';
import { supabaseAdmin, Member, updateMemberSafe } from '@/lib/db';
import {
  createSessionToken,
  setSessionCookie,
  createClaimToken,
  isModDiscordId,
  getAppBaseUrl,
} from '@/lib/auth';
import { DateTime } from 'luxon';

/**
 * Computes a user's Discord avatar URL with fallback to default Discord avatars.
 */
function computeDiscordAvatarUrl(
  id: string,
  avatarHash: string | null,
  discriminator?: string
): string {
  if (avatarHash) {
    const isAnimated = avatarHash.startsWith('a_');
    const ext = isAnimated ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${id}/${avatarHash}.${ext}?size=256`;
  }
  let index = 0;
  try {
    if (!discriminator || discriminator === '0') {
      index = Number((BigInt(id) >> BigInt(22)) % BigInt(6));
    } else {
      index = Number(discriminator) % 5;
    }
  } catch {
    index = 0;
  }
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

/**
 * GET: Handle Discord OAuth2 authorization callback.
 * 1. Validates CSRF state token against cookie.
 * 2. Exchanges authorization code for access token.
 * 3. Fetches user profile from Discord API v10 (@me).
 * 4. Resolves moderator privileges and matches/links Supabase member profile.
 * 5. Issues 90-day persistent session cookie or redirects to onboarding claim step.
 *
 * @param request - Incoming HTTP request with query parameters code & state
 * @returns NextResponse redirecting to dashboard or claim page
 */
export async function GET(request: Request) {
  const baseUrl = getAppBaseUrl(request);
  const { searchParams } = new URL(request.url);

  const errorParam = searchParams.get('error');
  const errorDescription = searchParams.get('error_description');

  // Handle prompt=none fallback: if consent is required on first login, retry with prompt=consent
  if (errorParam === 'consent_required' || errorParam === 'interaction_required') {
    return NextResponse.redirect(`${baseUrl}/api/auth/discord?prompt=consent`, { status: 302 });
  }

  if (errorParam) {
    const errorMsg = errorDescription || errorParam;
    return NextResponse.redirect(
      `${baseUrl}/join?error=${encodeURIComponent(`Discord OAuth error: ${errorMsg}`)}`,
      { status: 302 }
    );
  }

  const code = searchParams.get('code');
  const state = searchParams.get('state');

  // Validate CSRF state against short-lived cookie
  const cookieHeader = request.headers.get('cookie') || '';
  const stateMatch = cookieHeader.match(/zcatchers_oauth_state=([^;]+)/);
  const cookieState = stateMatch ? decodeURIComponent(stateMatch[1]) : null;

  if (!state || !cookieState || state !== cookieState) {
    return NextResponse.redirect(
      `${baseUrl}/join?error=${encodeURIComponent('Security validation failed: invalid CSRF state. Please try logging in again.')}`,
      { status: 302 }
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `${baseUrl}/join?error=${encodeURIComponent('Missing authorization code from Discord.')}`,
      { status: 302 }
    );
  }

  const clientId = process.env.DISCORD_CLIENT_ID?.trim();
  const clientSecret = process.env.DISCORD_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(
      `${baseUrl}/join?error=${encodeURIComponent('Server configuration error: Discord credentials missing.')}`,
      { status: 302 }
    );
  }

  try {
    // 1. Exchange authorization code for access token
    const tokenResponse = await fetch('https://discord.com/api/v10/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${baseUrl}/api/auth/discord/callback`,
      }),
    });

    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text();
      console.error('[Discord OAuth] Token exchange failed:', tokenResponse.status, errText);
      return NextResponse.redirect(
        `${baseUrl}/join?error=${encodeURIComponent('Failed to exchange authorization token with Discord.')}`,
        { status: 302 }
      );
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // 2. Fetch authenticated Discord user profile (@me)
    const userResponse = await fetch('https://discord.com/api/v10/users/@me', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!userResponse.ok) {
      return NextResponse.redirect(
        `${baseUrl}/join?error=${encodeURIComponent('Failed to fetch Discord user profile.')}`,
        { status: 302 }
      );
    }

    const discordUser = await userResponse.json();
    const discordId: string = discordUser.id;
    const discordUsername: string = discordUser.global_name || discordUser.username;
    const discordHandle: string = discordUser.username
      ? (discordUser.username.startsWith('@') ? discordUser.username : `@${discordUser.username}`)
      : (discordUsername.startsWith('@') ? discordUsername : `@${discordUsername}`);
    const avatarUrl = computeDiscordAvatarUrl(
      discordId,
      discordUser.avatar,
      discordUser.discriminator
    );
    const isModerator = isModDiscordId(discordId);

    // 3. Query existing member row in Supabase by discord_id
    const { data: existingMemberData } = await supabaseAdmin
      .from('members')
      .select('*')
      .eq('discord_id', discordId)
      .eq('is_active', true)
      .maybeSingle();

    if (existingMemberData) {
      // Returning Discord Member: update username, avatar, and moderator flag
      const member = existingMemberData as Member;
      const isDbMod = member.role === 'moderator' || member.is_moderator === true;
      const isEnvMod = isModDiscordId(discordId);
      const effectiveIsMod = isDbMod || isEnvMod;

      await updateMemberSafe(member.id, {
        discord_username: member.discord_username || discordUsername,
        discord_handle: discordHandle || member.discord_handle,
        avatar_url: avatarUrl,
        is_moderator: isDbMod,
        role: member.role,
        updated_at: DateTime.utc().toISO() as string,
      });

      // Issue 90-day persistent session token
      const sessionToken = createSessionToken(
        {
          memberId: member.id,
          discordId,
          isModerator: effectiveIsMod,
        },
        90
      );

      const response = NextResponse.redirect(`${baseUrl}/`, { status: 302 });
      setSessionCookie(response, sessionToken);

      // Clear CSRF state cookie
      response.cookies.set({
        name: 'zcatchers_oauth_state',
        value: '',
        maxAge: 0,
        path: '/',
      });

      return response;
    }

    // 4. First-time Discord Login: Check for unclaimed legacy rows matching candidate names
    const candidateNames = [discordUser.global_name, discordUser.username].filter(
      Boolean
    ) as string[];

    let matchedMemberId: string | null = null;
    for (const name of candidateNames) {
      const { data: match } = await supabaseAdmin
        .from('members')
        .select('id, discord_username')
        .is('discord_id', null)
        .ilike('discord_username', name.trim())
        .eq('is_active', true)
        .maybeSingle();

      if (match) {
        matchedMemberId = match.id;
        break;
      }
    }

    // Create signed claim token (valid for 60 minutes)
    const claimToken = createClaimToken(
      {
        discordId,
        discordUsername,
        discordHandle,
        avatarUrl,
        isModerator,
        suggestedMemberId: matchedMemberId,
      },
      60
    );

    // Redirect user to /join with claim token to select existing profile or configure new schedule
    const claimUrl = `${baseUrl}/join?claim_token=${encodeURIComponent(claimToken)}`;
    const response = NextResponse.redirect(claimUrl, { status: 302 });

    // Store claim token in cookie as backup
    response.cookies.set({
      name: 'zcatchers_claim_token',
      value: claimToken,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60, // 1 hour
    });

    // Clear CSRF state cookie
    response.cookies.set({
      name: 'zcatchers_oauth_state',
      value: '',
      maxAge: 0,
      path: '/',
    });

    return response;
  } catch (err: unknown) {
    console.error('[Discord OAuth Callback Error]:', err);
    const message = err instanceof Error ? err.message : 'Unknown OAuth callback error';
    return NextResponse.redirect(
      `${baseUrl}/join?error=${encodeURIComponent(`Authentication error: ${message}`)}`,
      { status: 302 }
    );
  }
}
