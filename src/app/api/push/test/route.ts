import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db';
import { sendPushNotification } from '@/lib/pushServer';
import { getRequestSessionMemberId } from '@/lib/auth';

export async function POST(request: Request) {
  try {
    const sessionMemberId = getRequestSessionMemberId(request);
    if (!sessionMemberId) {
      return NextResponse.json(
        { error: 'Unauthorized. You must be logged in to send a test notification.' },
        { status: 401 }
      );
    }

    // Only resolve targets registered to the authenticated session member
    const { data: targets, error } = await supabaseAdmin
      .from('push_subscriptions')
      .select('*')
      .eq('member_id', sessionMemberId);

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
    const deadEndpoints: string[] = [];

    for (const target of targets) {
      const result = await sendPushNotification(
        {
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
        if (result.statusCode === 404 || result.statusCode === 410) {
          deadEndpoints.push(target.endpoint);
        }
      }
    }

    // Clean up expired or dead subscriptions
    if (deadEndpoints.length > 0) {
      await supabaseAdmin.from('push_subscriptions').delete().in('endpoint', deadEndpoints);
    }

    return NextResponse.json({
      success: delivered > 0,
      delivered,
      failed,
      cleaned: deadEndpoints.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal push error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
