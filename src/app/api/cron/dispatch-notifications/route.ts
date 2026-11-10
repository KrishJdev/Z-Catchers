import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { executeNotificationDispatcher } from '@/lib/cronDispatcher';

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
