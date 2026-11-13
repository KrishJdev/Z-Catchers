import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db';
import { getRequestSessionMemberId } from '@/lib/auth';

/**
 * POST: Unsubscribe a specific push endpoint or all push endpoints for an authenticated member.
 * All unsubscription operations strictly require an authenticated member session to prevent
 * unauthenticated subscription deletion / denial of service.
 *
 * @param request - Incoming HTTP request containing endpoint or session credentials
 * @returns JSON response with unsubscription status
 */
export async function POST(request: Request) {
  try {
    const sessionMemberId = getRequestSessionMemberId(request);
    if (!sessionMemberId) {
      return NextResponse.json(
        { error: 'Unauthorized: Active member session required to unsubscribe from push notifications.' },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { endpoint } = body;

    // 1. Specific endpoint provided: delete only that specific device's endpoint for the authenticated member
    if (endpoint !== undefined && endpoint !== null) {
      if (typeof endpoint !== 'string' || !endpoint.trim()) {
        return NextResponse.json(
          { error: 'Invalid push endpoint format. Expected non-empty string.' },
          { status: 400 }
        );
      }

      const trimmedEndpoint = endpoint.trim();
      const { error } = await supabaseAdmin
        .from('push_subscriptions')
        .delete()
        .eq('endpoint', trimmedEndpoint)
        .eq('member_id', sessionMemberId);

      if (error) {
        console.error('Failed to remove push subscription for endpoint:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        message: 'Endpoint unsubscribed successfully',
        endpoint: trimmedEndpoint,
        member_id: sessionMemberId,
      });
    }

    // 2. No specific endpoint provided: member-wide subscription removal for authenticated session
    const { error } = await supabaseAdmin
      .from('push_subscriptions')
      .delete()
      .eq('member_id', sessionMemberId);

    if (error) {
      console.error('Failed to remove all push subscriptions for member:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'All push subscription endpoints for member unsubscribed successfully',
      member_id: sessionMemberId,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const DELETE = POST;
