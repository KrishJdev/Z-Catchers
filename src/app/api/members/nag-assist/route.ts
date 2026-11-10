import { NextResponse } from 'next/server';
import { supabaseAdmin, Member } from '@/lib/db';
import { getRequestSessionMemberId } from '@/lib/auth';
import { DateTime } from 'luxon';
import { toValidLuxonZone } from '@/lib/timezone';
import crypto from 'crypto';

/**
 * Handles Nag Assists when community members click "Nag in Discord Journal"
 * for a member whose bedtime has hit.
 *
 * Enforces:
 * 1. Luxon-based local date calculation based on sleeper's specific timezone.
 * 2. Idempotent logging: one assist per helper per sleeper per local date.
 * 3. Graceful fallback for anonymous community helpers.
 */

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { sleeper_id, visitor_id } = body;

    if (!sleeper_id || typeof sleeper_id !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid sleeper_id' }, { status: 400 });
    }

    // 1. Fetch sleeper profile to determine timezone
    const { data: sleeper, error: sleeperErr } = await supabaseAdmin
      .from('members')
      .select('*')
      .eq('id', sleeper_id)
      .eq('is_active', true)
      .single();

    if (sleeperErr || !sleeper) {
      return NextResponse.json({ error: 'Sleeper member not found or inactive' }, { status: 404 });
    }

    // 2. Identify the helper (authenticated session or hashed visitor token)
    const sessionMemberId = getRequestSessionMemberId(request);
    let helperKey = sessionMemberId ? `user_${sessionMemberId}` : null;

    if (!helperKey) {
      const userAgent = request.headers.get('user-agent') || 'unknown';
      const ip =
        request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
        request.headers.get('x-real-ip') ||
        'anonymous';
      const seed = `${ip}:${userAgent}:${visitor_id || ''}`;
      const anonHash = crypto.createHash('sha256').update(seed).digest('hex').substring(0, 16);
      helperKey = `anon_${anonHash}`;
    }

    // 3. Compute sleeper's current local date with Luxon
    const nowUtc = DateTime.utc();
    const sleeperLocalNow = nowUtc.setZone(toValidLuxonZone((sleeper as Member).timezone));
    const localDate = sleeperLocalNow.toISODate();

    if (!localDate) {
      return NextResponse.json({ error: 'Could not resolve local date for timezone' }, { status: 500 });
    }

    const notificationType = `NAG_ASSIST:${helperKey}`;

    // 4. Insert assist log (idempotent via unique constraint on member_id, notification_type, local_date)
    let alreadyAssisted = false;
    const { error: insertErr } = await supabaseAdmin.from('notification_logs').insert({
      member_id: sleeper.id,
      notification_type: notificationType,
      local_date: localDate,
      dispatched_at: nowUtc.toISO(),
    });

    if (insertErr) {
      // Postgres error 23505 = unique_violation
      if (insertErr.code === '23505' || insertErr.message.includes('unique constraint')) {
        alreadyAssisted = true;
      } else {
        return NextResponse.json({ error: insertErr.message }, { status: 500 });
      }
    }

    // 5. Query total assists for this sleeper on tonight's local date
    const { data: assists, count } = await supabaseAdmin
      .from('notification_logs')
      .select('id', { count: 'exact' })
      .eq('member_id', sleeper.id)
      .like('notification_type', 'NAG_ASSIST:%')
      .eq('local_date', localDate);

    const totalAssists = count ?? (assists?.length || 0);

    return NextResponse.json({
      success: true,
      sleeper_id: sleeper.id,
      local_date: localDate,
      totalAssists,
      alreadyAssisted,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sleeper_id = searchParams.get('sleeper_id');

    if (!sleeper_id) {
      return NextResponse.json({ error: 'sleeper_id query parameter required' }, { status: 400 });
    }

    const { data: sleeper, error: sleeperErr } = await supabaseAdmin
      .from('members')
      .select('timezone')
      .eq('id', sleeper_id)
      .single();

    if (sleeperErr || !sleeper) {
      return NextResponse.json({ error: 'Sleeper member not found' }, { status: 404 });
    }

    const nowUtc = DateTime.utc();
    const localDate = nowUtc.setZone(toValidLuxonZone(sleeper.timezone)).toISODate();

    const { count } = await supabaseAdmin
      .from('notification_logs')
      .select('id', { count: 'exact' })
      .eq('member_id', sleeper_id)
      .like('notification_type', 'NAG_ASSIST:%')
      .eq('local_date', localDate);

    return NextResponse.json({
      sleeper_id,
      local_date: localDate,
      totalAssists: count || 0,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
