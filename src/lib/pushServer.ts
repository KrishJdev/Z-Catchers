import webpush from 'web-push';
import { supabaseAdmin } from '@/lib/db';

const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || '';
const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  icon?: string;
  badge?: string;
  tag?: string;
}

export interface PushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

export interface PushSubscriptionData {
  endpoint: string;
  keys: PushSubscriptionKeys;
}

/**
 * Sends a web push notification to a specific client subscription.
 * Handles WebPushError with statusCode inspection (404 Not Found / 410 Gone)
 * and automatically deletes dead or uninstalled subscription endpoints from Supabase.
 */
export async function sendPushNotification(
  subscription: PushSubscriptionData,
  payload: PushPayload
): Promise<{ success: boolean; statusCode?: number; error?: string; pruned?: boolean }> {
  try {
    const res = await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
        },
      },
      JSON.stringify(payload)
    );

    return {
      success: true,
      statusCode: res.statusCode,
    };
  } catch (err: unknown) {
    const webPushErr = err as { statusCode?: number; message?: string };
    const statusCode = webPushErr.statusCode;
    let pruned = false;

    // Prune stale/expired endpoints (404 Not Found, 410 Gone)
    if (statusCode === 404 || statusCode === 410) {
      try {
        const { error: delErr } = await supabaseAdmin
          .from('push_subscriptions')
          .delete()
          .eq('endpoint', subscription.endpoint);

        if (!delErr) {
          pruned = true;
          console.warn(`[PushServer] Pruned dead/uninstalled push subscription (${statusCode}): ${subscription.endpoint}`);
        } else {
          console.error('[PushServer] Failed to prune dead subscription from database:', delErr);
        }
      } catch (dbErr) {
        console.error('[PushServer] Database error while pruning dead subscription:', dbErr);
      }
    }

    return {
      success: false,
      statusCode,
      error: webPushErr.message || 'Unknown push error',
      pruned,
    };
  }
}

/**
 * Sends push notifications to an array of subscriptions (e.g., multiple devices belonging to a member).
 * Automatically continues delivery to remaining devices even if one device fails or is pruned.
 */
export async function sendPushToMemberSubscriptions(
  subscriptions: PushSubscriptionData[],
  payload: PushPayload
): Promise<{ total: number; sent: number; failed: number; pruned: number }> {
  let sent = 0;
  let failed = 0;
  let pruned = 0;

  for (const sub of subscriptions) {
    const res = await sendPushNotification(sub, payload);
    if (res.success) {
      sent++;
    } else {
      failed++;
      if (res.pruned) {
        pruned++;
      }
    }
  }

  return {
    total: subscriptions.length,
    sent,
    failed,
    pruned,
  };
}

export { webpush };
