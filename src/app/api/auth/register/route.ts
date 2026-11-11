/**
 * POST: Member registration via legacy PIN (Deprecated).
 * Superseded by Discord OAuth profile claim & onboarding (/api/auth/claim-profile).
 *
 * @returns 410 Gone response instructing clients to authenticate via Discord OAuth
 */
export async function POST() {
  return Response.json(
    {
      error:
        'Legacy PIN registration has been deprecated in favor of Discord OAuth2. Please connect your Discord account via /api/auth/discord or /join.',
      deprecated: true,
      auth_url: '/api/auth/discord',
    },
    { status: 410 }
  );
}

/**
 * GET: Browser redirect to Discord OAuth initiation endpoint.
 *
 * @param request - Incoming HTTP request
 * @returns 302 redirect to /api/auth/discord
 */
export async function GET(request: Request) {
  const url = new URL('/api/auth/discord', request.url);
  return Response.redirect(url.toString(), 302);
}
