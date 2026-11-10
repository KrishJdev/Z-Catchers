import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { executeNotificationDispatcher } from '@/lib/cronDispatcher';

/**
 * Validates timing-safe authorization against CRON_SECRET from Bearer token or x-cron-secret header.
 *
 * @param request - Incoming HTTP request
 * @returns True if authorized, false otherwise
 */
function isAuthorized(request: Request): boolean {
  const isProd = process.env.NODE_ENV === 'production';
  const cronSecret = process.env.CRON_SECRET?.trim();

  if (!cronSecret) {
    if (isProd) {
      console.warn('CRON_SECRET is not configured in production. Dispatcher access disabled.');
      return false; // Fail closed in production
    }
    return true; // Allow local dev testing when secret unset
  }

  // 1. Authorization: Bearer <cronSecret>
  const authHeader = request.headers.get('authorization');
  let providedToken: string | null = null;
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    providedToken = authHeader.slice(7).trim();
  }

  // 2. x-cron-secret header
  if (!providedToken) {
    providedToken = request.headers.get('x-cron-secret')?.trim() || null;
  }

  if (!providedToken) {
    return false;
  }

  try {
    const expectedHash = crypto.createHash('sha256').update(cronSecret).digest();
    const actualHash = crypto.createHash('sha256').update(providedToken).digest();
    return crypto.timingSafeEqual(expectedHash, actualHash);
  } catch {
    return false;
  }
}

/**
 * GET: Trigger scheduled notification dispatch cycle (invoked by Vercel Cron or monitoring tasks).
 *
 * @param request - Incoming HTTP request with authorization headers
 * @returns JSON response with dispatch results
 */
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized cron request.' }, { status: 401 });
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get('dry_run') === 'true';
  const forcedMemberId = url.searchParams.get('member_id') || undefined;

  try {
    const results = await executeNotificationDispatcher({
      dryRun,
      forcedMemberId,
    });
    return NextResponse.json({ success: true, ...results });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown cron error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST: Trigger scheduled notification dispatch cycle via HTTP POST body.
 *
 * @param request - Incoming HTTP request with optional dry_run or member_id parameters
 * @returns JSON response with dispatch results
 */
export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized cron request.' }, { status: 401 });
  }

  try {
    let body: { dry_run?: boolean; member_id?: string } = {};
    try {
      body = await request.json();
    } catch {
      // Empty or non-JSON body is valid
    }

    const results = await executeNotificationDispatcher({
      dryRun: Boolean(body.dry_run),
      forcedMemberId: body.member_id,
    });

    return NextResponse.json({ success: true, ...results });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown cron error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
