import { NextResponse } from 'next/server';
import { executeNotificationDispatcher } from '@/lib/cronDispatcher';

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return true; // If not configured, allow local/dev execution

  const authHeader = request.headers.get('authorization');
  if (authHeader && authHeader === `Bearer ${cronSecret}`) {
    return true;
  }

  // Also check x-cron-secret header or url parameter
  const secretHeader = request.headers.get('x-cron-secret');
  if (secretHeader && secretHeader === cronSecret) {
    return true;
  }

  const url = new URL(request.url);
  if (url.searchParams.get('secret') === cronSecret) {
    return true;
  }

  return false;
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
