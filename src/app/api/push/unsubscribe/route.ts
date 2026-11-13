import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db';
import { getRequestSessionMemberId } from '@/lib/auth';

/**
 * POST: Unsubscribe a specific push endpoint or all push endpoints for an authenticated member.
 * Member-wide unsubscription strictly requires an authenticated session.
 *
 * @param request - Incoming HTTP request containing endpoint or session credentials
 * @returns JSON response with unsubscription status
 */
export async function POST(request: Request) {
  try {
    const sessionMemberId = getRequestSessionMemberId(request);
    const body = await request.json().catch(() => ({}));
    const { endpoint } = body;

    const targetMemberId = sessionMemberId;

    // 1. Specific endpoint provided: delete only that specific device's endpoint
    if (endpoint && typeof endpoint === 'string') {
      const query = supabaseAdmin
        .from('push_subscriptions')
        .delete()
        .eq('endpoint', endpoint);

      if (sessionMemberId) {
        query.eq('member_id', sessionMemberId);
      }

      const { error } = await query;

      if (error) {
        console.error('Failed to remove push subscription for endpoint:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        message: 'Endpoint unsubscribed successfully',
        endpoint,
      });
    }

    // 2. No specific endpoint provided: require authenticated session for member-wide subscription removal
    if (targetMemberId && typeof targetMemberId === 'string') {
      const { error } = await supabaseAdmin
        .from('push_subscriptions')
        .delete()
        .eq('member_id', targetMemberId);

      if (error) {
        console.error('Failed to remove all push subscriptions for member:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        message: 'All push subscription endpoints for member unsubscribed successfully',
        member_id: targetMemberId,
      });
    }

    return NextResponse.json(
      { error: 'Missing endpoint or authenticated session for unsubscription' },
      { status: 400 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
