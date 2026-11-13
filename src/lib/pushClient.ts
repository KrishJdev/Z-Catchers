/**
 * Client-side Web Push & Service Worker utilities for Z Catchers PWA
 */

export const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';

export const STORAGE_KEY_MEMBER_ID = 'zcatchers_member_id';
export const STORAGE_KEY_PUSH_ENABLED = 'zcatchers_push_enabled';
export const STORAGE_KEY_AUTH_TOKEN = 'zcatchers_auth_token';
export const STORAGE_KEY_AUTH_MEMBER = 'zcatchers_auth_member';
export const STORAGE_KEY_NOTIFY_PERSONAL = 'zcatchers_notify_personal';
export const STORAGE_KEY_NOTIFY_COMMUNITY = 'zcatchers_notify_community';

/**
 * Scopes a notification preference localStorage key to a specific member ID.
 */
export function getMemberNotificationStorageKey(
  baseKey: string,
  memberId: string
): string {
  return `${baseKey}_${memberId}`;
}

/**
 * Retrieves client-stored notification preferences scoped to a specific member ID.
 * Returns empty object if no member is specified or preferences are not set.
 */
export function getStoredNotificationPreferences(memberId?: string | null): {
  notifyPersonal?: boolean;
  notifyCommunity?: boolean;
} {
  if (typeof localStorage === 'undefined' || !memberId) return {};
  const personalKey = getMemberNotificationStorageKey(STORAGE_KEY_NOTIFY_PERSONAL, memberId);
  const communityKey = getMemberNotificationStorageKey(STORAGE_KEY_NOTIFY_COMMUNITY, memberId);
  const storedPersonal = localStorage.getItem(personalKey);
  const storedCommunity = localStorage.getItem(communityKey);
  return {
    notifyPersonal: storedPersonal !== null ? storedPersonal === 'true' : undefined,
    notifyCommunity: storedCommunity !== null ? storedCommunity === 'true' : undefined,
  };
}

/**
 * Persists notification preferences in localStorage scoped to a specific member ID.
 */
export function setStoredNotificationPreferences(
  memberId: string | null | undefined,
  prefs: { notifyPersonal?: boolean; notifyCommunity?: boolean }
): void {
  if (typeof localStorage === 'undefined' || !memberId) return;
  const personalKey = getMemberNotificationStorageKey(STORAGE_KEY_NOTIFY_PERSONAL, memberId);
  const communityKey = getMemberNotificationStorageKey(STORAGE_KEY_NOTIFY_COMMUNITY, memberId);
  if (prefs.notifyPersonal !== undefined) {
    localStorage.setItem(personalKey, String(prefs.notifyPersonal));
  }
  if (prefs.notifyCommunity !== undefined) {
    localStorage.setItem(communityKey, String(prefs.notifyCommunity));
  }
}

/**
 * Converts a URL-safe Base64 VAPID public key into a Uint8Array backed by an ArrayBuffer
 * required by navigator.serviceWorker.pushManager.subscribe()
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Verifies if the browser supports Service Workers, Push Manager, and Notifications
 */
export function isPushSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * Detects whether the user is browsing via Brave Browser
 */
export async function isBraveBrowser(): Promise<boolean> {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as unknown as { brave?: { isBrave?: () => Promise<boolean> } };
  if (nav.brave && typeof nav.brave.isBrave === 'function') {
    try {
      return await nav.brave.isBrave();
    } catch {
      return true;
    }
  }
  return false;
}

/**
 * Gets the current Notification permission state
 */
export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

/**
 * Registers the /sw.js service worker
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupported()) return null;

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
    });
    return registration;
  } catch (err) {
    console.error('Service worker registration failed:', err);
    return null;
  }
}

/**
 * Retrieves the current push subscription if active
 */
export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;

  try {
    const registration = await navigator.serviceWorker.ready;
    return await registration.pushManager.getSubscription();
  } catch (err) {
    console.error('Failed to get existing push subscription:', err);
    return null;
  }
}

/**
 * Silent push subscription health-check called on app boot and foreground resume.
 * When Notification.permission === 'granted', verifies that registration.pushManager.getSubscription()
 * exists and re-syncs it with /api/push/subscribe so local browser state and Supabase rows never drift out of sync.
 */
export async function syncPushSubscriptionHealth(): Promise<boolean> {
  if (!isPushSupported()) return false;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;

  try {
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();

    // If permission is granted but subscription was lost/cleared, attempt silent resubscribe
    if (!subscription && VAPID_PUBLIC_KEY) {
      try {
        const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey as unknown as BufferSource,
        });
      } catch (subErr) {
        console.warn('[PushClient] Silent resubscribe error:', subErr);
      }
    }

    if (!subscription) return false;

    const subJson = subscription.toJSON();
    if (!subJson.endpoint || !subJson.keys?.p256dh || !subJson.keys?.auth) {
      return false;
    }

    const memberIdToUse = getStoredMemberId();
    const token = getStoredAuthToken();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // Preserve client-stored notification preferences ONLY for the current signed-in member.
    // If no member is signed in or no member-scoped choice exists, leave as undefined so
    // another member's stored choices are never applied or transmitted.
    let notifyPersonal: boolean | undefined = undefined;
    let notifyCommunity: boolean | undefined = undefined;
    if (memberIdToUse) {
      const prefs = getStoredNotificationPreferences(memberIdToUse);
      notifyPersonal = prefs.notifyPersonal;
      notifyCommunity = prefs.notifyCommunity;
    }

    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        member_id: memberIdToUse || null,
        notify_personal: notifyPersonal,
        notify_community: notifyCommunity,
        subscription: {
          endpoint: subJson.endpoint,
          keys: {
            p256dh: subJson.keys.p256dh,
            auth: subJson.keys.auth,
          },
        },
        user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      }),
    });

    if (res.ok) {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY_PUSH_ENABLED, 'true');
      }
      return true;
    }
    return false;
  } catch (err) {
    console.warn('[PushClient] Push subscription health sync failed:', err);
    return false;
  }
}

export interface SubscribePushOptions {
  memberId?: string;
  notifyPersonal?: boolean;
  notifyCommunity?: boolean;
}

/**
 * Requests permission, registers push with browser PushManager,
 * and saves subscription record in Supabase via /api/push/subscribe
 */
export async function subscribeToPush(
  options: SubscribePushOptions = {}
): Promise<{ success: boolean; subscription?: PushSubscription; error?: string }> {
  if (!isPushSupported()) {
    return { success: false, error: 'Push notifications are not supported by this browser.' };
  }

  if (!VAPID_PUBLIC_KEY) {
    return { success: false, error: 'VAPID public key is not configured.' };
  }

  try {
    // 1. Request permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return { success: false, error: 'Push notification permission was denied or dismissed.' };
    }

    // 2. Ensure Service Worker is registered and active
    const registration = await navigator.serviceWorker.ready;

    // 3. Subscribe or get existing subscription
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey as unknown as BufferSource,
      });
    }

    const subJson = subscription.toJSON();
    if (!subJson.endpoint || !subJson.keys?.p256dh || !subJson.keys?.auth) {
      return { success: false, error: 'Incomplete push subscription generated by browser.' };
    }

    // 4. Save to backend database
    const memberIdToUse = options.memberId || getStoredMemberId() || null;
    const token = getStoredAuthToken();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        member_id: memberIdToUse,
        subscription: {
          endpoint: subJson.endpoint,
          keys: {
            p256dh: subJson.keys.p256dh,
            auth: subJson.keys.auth,
          },
        },
        notify_personal: options.notifyPersonal ?? true,
        notify_community: options.notifyCommunity ?? true,
        user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      }),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      return {
        success: false,
        error: errorData.error || `Server responded with ${res.status}`,
      };
    }

    // Record push enabled and member-scoped preferences in local storage
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY_PUSH_ENABLED, 'true');
      if (memberIdToUse) {
        localStorage.setItem(STORAGE_KEY_MEMBER_ID, memberIdToUse);
        setStoredNotificationPreferences(memberIdToUse, {
          notifyPersonal: options.notifyPersonal,
          notifyCommunity: options.notifyCommunity,
        });
      }
    }

    return { success: true, subscription };
  } catch (err: unknown) {
    const rawMessage = err instanceof Error ? err.message : 'Unknown push subscription error';
    let userFriendlyError = rawMessage;

    const isBrave = await isBraveBrowser();
    if (
      rawMessage.toLowerCase().includes('push service error') ||
      rawMessage.toLowerCase().includes('registration failed')
    ) {
      if (isBrave) {
        userFriendlyError =
          'Brave blocks Web Push by default. Enable "Use Google services for push messaging" in brave://settings/privacy, restart Brave, and try again.';
      } else {
        userFriendlyError =
          'Push registration failed. This usually occurs if your browser cannot reach Google Push Services (FCM). Check if an ad blocker, VPN, or network firewall is blocking Google push messaging.';
      }
    }

    return { success: false, error: userFriendlyError };
  }
}

/**
 * Unsubscribes the current device from push notifications
 */
export async function unsubscribeFromPush(): Promise<{ success: boolean; error?: string }> {
  if (!isPushSupported()) return { success: true };

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    if (subscription) {
      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();

      const token = getStoredAuthToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      // Notify backend to remove from push_subscriptions
      await fetch('/api/push/unsubscribe', {
        method: 'POST',
        headers,
        body: JSON.stringify({ endpoint }),
      }).catch((err) => console.warn('Failed to unregister endpoint on server:', err));
    }

    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY_PUSH_ENABLED);
    }

    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unsubscribe error';
    return { success: false, error: message };
  }
}

/**
 * Retrieves the stored member ID from localStorage
 */
export function getStoredMemberId(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(STORAGE_KEY_MEMBER_ID);
}

/**
 * Stores the claimed member ID in localStorage and re-syncs active push subscription if present
 */
export function setStoredMemberId(memberId: string | null): void {
  if (typeof localStorage === 'undefined') return;
  if (memberId) {
    localStorage.setItem(STORAGE_KEY_MEMBER_ID, memberId);
  } else {
    localStorage.removeItem(STORAGE_KEY_MEMBER_ID);
  }
}

/**
 * Retrieves the stored auth session token
 */
export function getStoredAuthToken(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(STORAGE_KEY_AUTH_TOKEN);
}

/**
 * Stores or clears the auth session token
 */
export function setStoredAuthToken(token: string | null): void {
  if (typeof localStorage === 'undefined') return;
  if (token) {
    localStorage.setItem(STORAGE_KEY_AUTH_TOKEN, token);
  } else {
    localStorage.removeItem(STORAGE_KEY_AUTH_TOKEN);
  }
}

/**
 * Retrieves the stored authenticated member object
 */
export function getStoredAuthMember<T = unknown>(): T | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(STORAGE_KEY_AUTH_MEMBER);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Stores or clears the authenticated member object
 */
export function setStoredAuthMember(member: unknown | null): void {
  if (typeof localStorage === 'undefined') return;
  if (member) {
    localStorage.setItem(STORAGE_KEY_AUTH_MEMBER, JSON.stringify(member));
    if (typeof member === 'object' && member !== null && 'id' in member) {
      setStoredMemberId((member as { id: string }).id);
    }
  } else {
    localStorage.removeItem(STORAGE_KEY_AUTH_MEMBER);
    setStoredMemberId(null);
  }
}

/**
 * Clears all authentication credentials and member session data
 */
export function clearAuthSession(): void {
  setStoredAuthToken(null);
  setStoredAuthMember(null);
}
