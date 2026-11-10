import webpush from 'web-push';

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
 * Handles WebPushError with statusCode inspection for dead subscriptions (404/410).
 */
export async function sendPushNotification(
  subscription: PushSubscriptionData,
  payload: PushPayload
): Promise<{ success: boolean; statusCode?: number; error?: string }> {
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
    return {
      success: false,
      statusCode: webPushErr.statusCode,
      error: webPushErr.message || 'Unknown push error',
    };
  }
}

export { webpush };
