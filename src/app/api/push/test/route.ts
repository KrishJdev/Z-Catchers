import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db';
import { sendPushNotification } from '@/lib/pushServer';
import { getRequestSession } from '@/lib/auth';

/**
 * POST: Send an authenticated test push notification to the logged-in member's registered devices.
 *
 * @param request - Incoming HTTP request with member session cookie
 * @returns JSON response with delivered and failed subscription counts
 */
export async function POST(request: Request) {
  try {
    const session = getRequestSession(request);
    if (!session?.discordId) {
      return NextResponse.json(
        { error: 'Unauthorized. You must be logged in to send a test notification.' },
        { status: 401 }
      );
    }

    const { data: owner, error: ownerError } = await supabaseAdmin.from('members')
      .select('id').eq('id', session.memberId).eq('discord_id', session.discordId).eq('is_active', true).maybeSingle();
    if (ownerError || !owner) {
      return NextResponse.json({ error: 'An active Discord profile is required.' }, { status: ownerError ? 503 : 403 });
    }
    // Only resolve targets registered to the authenticated session member
    const { data: targets, error } = await supabaseAdmin
      .from('push_subscriptions')
      .select('*')
      .eq('member_id', session.memberId);

    if (error || !targets || targets.length === 0) {
      return NextResponse.json(
        {
          error:
            'No active push subscriptions registered for your profile. Please enable notifications on this device first.',
        },
        { status: 404 }
      );
    }

    // Fixed safe notification payload and same-origin URL (prevent arbitrary content injection)
    const title = '🦊 Z Catchers: Test Bedtime Alert';
    const body = 'Success! Your Sleep Shield and push notifications are active.';
    const url = '/';

    let delivered = 0;
    let failed = 0;
    let cleaned = 0;

    for (const target of targets) {
      const result = await sendPushNotification(
        {
          id: target.id,
          rotationDigest: target.rotation_digest,
          endpoint: target.endpoint,
          keys: {
            p256dh: target.p256dh_key,
            auth: target.auth_key,
          },
        },
        {
          title,
          body,
          url,
        }
      );

      if (result.success) {
        delivered++;
      } else {
        failed++;
        if (result.pruned) cleaned++;
      }
    }

    return NextResponse.json({
      success: delivered > 0,
      delivered,
      failed,
      cleaned,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal push error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
