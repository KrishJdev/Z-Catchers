import { NextResponse } from 'next/server';
import crypto from 'crypto';

/**
 * Resolves the canonical application base URL for OAuth callbacks.
 */
function getAppBaseUrl(request: Request): string {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (envUrl && !envUrl.includes('placeholder') && !envUrl.includes('your-production-domain')) {
    return envUrl.replace(/\/+$/, '');
  }
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') || 'http';
  if (host) {
    return `${proto}://${host}`;
  }
  return 'http://localhost:3000';
}

/**
 * GET: Initiate Discord OAuth2 authorization flow.
 * Employs a top-level redirect (never popups) for mobile PWA standalone compatibility.
 * Generates and stores a cryptographic CSRF state token in an httpOnly SameSite=Lax cookie.
 *
 * @param request - Incoming HTTP request
 * @returns NextResponse performing 302 redirect to Discord OAuth authorize endpoint
 */
export async function GET(request: Request) {
  try {
    const clientId = process.env.DISCORD_CLIENT_ID?.trim();
    if (!clientId) {
      return NextResponse.json(
        {
          error:
            'DISCORD_CLIENT_ID is not configured on the server. Please set it in your environment variables.',
        },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(request.url);
    const requestedPrompt = searchParams.get('prompt');
    const prompt = requestedPrompt === 'consent' ? 'consent' : 'none';

    const baseUrl = getAppBaseUrl(request);
    const redirectUri = `${baseUrl}/api/auth/discord/callback`;

    // Generate cryptographic CSRF state token
    const state = crypto.randomBytes(32).toString('hex');

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'identify',
      state,
      prompt,
    });

    const discordAuthUrl = `https://discord.com/oauth2/authorize?${params.toString()}`;

    const response = NextResponse.redirect(discordAuthUrl, { status: 302 });

    // Store state in short-lived httpOnly SameSite=Lax cookie
    response.cookies.set({
      name: 'zcatchers_oauth_state',
      value: state,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 10, // 10 minutes
    });

    return response;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to initiate Discord OAuth flow';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
