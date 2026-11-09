import { NextResponse } from 'next/server';
import { supabaseAdmin, PushSubscriptionRecord } from '@/lib/db';
import { sendPushNotification } from '@/lib/pushServer';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      member_id,
      endpoint,
      subscription,
      title = '🦊 Z Catchers: Test Alert',
      body: notificationBody = 'Test notification from Z Catchers! Your Sleep Shield is configured.',
      url = '/',
    } = body;

    let targets: { endpoint: string; p256dh_key: string; auth_key: string }[] = [];

    if (subscription?.endpoint && subscription?.keys?.p256dh && subscription?.keys?.auth) {
      targets.push({
        endpoint: subscription.endpoint,
        p256dh_key: subscription.keys.p256dh,
        auth_key: subscription.keys.auth,
      });
    } else if (endpoint) {
      const { data, error } = await supabaseAdmin
        .from('push_subscriptions')
        .select('*')
        .eq('endpoint', endpoint);

      if (error || !data || data.length === 0) {
        return NextResponse.json({ error: 'Subscription endpoint not found.' }, { status: 404 });
      }
      targets = data;
    } else if (member_id) {
      const { data, error } = await supabaseAdmin
        .from('push_subscriptions')
        .select('*')
        .eq('member_id', member_id);

      if (error || !data || data.length === 0) {
        return NextResponse.json(
          { error: 'No active push subscriptions registered for this member.' },
          { status: 404 }
        );
      }
      targets = data;
    } else {
      return NextResponse.json(
        { error: 'Must provide subscription, endpoint, or member_id.' },
        { status: 400 }
      );
    }

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
          body: notificationBody,
          url,
        }
      );

      if (result.success) {
        delivered++;
      } else {
        failed++;
        // Auto-prune 404 / 410 dead subscriptions
        if (result.statusCode === 404 || result.statusCode === 410) {
          deadEndpoints.push(target.endpoint);
        }
      }
    }

    if (deadEndpoints.length > 0) {
      await supabaseAdmin
        .from('push_subscriptions')
        .delete()
        .in('endpoint', deadEndpoints);
    }

    return NextResponse.json({
      success: true,
      delivered,
      failed,
      prunedDeadEndpoints: deadEndpoints.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
