import { getAppBaseUrl } from '@/lib/auth';

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
 * Sanitizes base URL via getAppBaseUrl to prevent host header poisoning.
 *
 * @param request - Incoming HTTP request
 * @returns 302 redirect to /api/auth/discord
 */
export async function GET(request: Request) {
  const baseUrl = getAppBaseUrl(request);
  return Response.redirect(`${baseUrl}/api/auth/discord`, 302);
}
