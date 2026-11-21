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
export const STORAGE_KEY_PENDING_UNSUBSCRIBE = 'zcatchers_pending_unsubscribe_endpoint';

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
    const registration = await waitForPushWorker();
    return await registration.pushManager.getSubscription();
  } catch (err) {
    console.error('Failed to get existing push subscription:', err);
    return null;
  }
}

function waitForPushWorker(): Promise<ServiceWorkerRegistration> {
  return new Promise((resolve, reject) => {
    const deadline = window.setTimeout(() => {
      reject(new Error('Notification service is still starting. Try again.'));
    }, 4000);
    navigator.serviceWorker.ready.then(resolve, reject).finally(() => window.clearTimeout(deadline));
  });
}

interface PushDeviceStatus {
  memberId?: string;
  repair?: 'sign_in' | 'retry';
  disabled?: boolean;
  notifyPersonal?: boolean;
  notifyCommunity?: boolean;
}

interface PushDeviceResult extends PushDeviceStatus {
  success?: boolean;
  error?: string;
}

async function requestPushDevice(
  action: 'status' | 'sync' | 'unlink',
  input: SubscribePushOptions & { enable?: boolean } = {}
): Promise<PushDeviceResult> {
  const registration = await waitForPushWorker();
  if (!registration.active) throw new Error('Notification service is still starting. Try again.');
  const worker = registration.active;
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => {
      channel.port1.close();
      reject(new Error('Notification service is updating or offline. Try again.'));
    }, 15000);
    channel.port1.onmessage = event => {
      window.clearTimeout(timeout);
      channel.port1.close();
      resolve(event.data);
    };
    worker.postMessage({
      type: 'PUSH_DEVICE',
      action,
      ...input,
      applicationServerKey: action === 'sync' && VAPID_PUBLIC_KEY
        ? urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        : undefined,
    }, [channel.port2]);
  });
}

export async function getPushDeviceStatus(): Promise<PushDeviceStatus> {
  if (!isPushSupported()) return {};
  return requestPushDevice('status').catch(() => ({ repair: 'retry' }));
}

/** Sync the device without changing its stored notification preferences. */
export async function syncPushSubscriptionHealth(): Promise<boolean> {
  const memberId = getStoredMemberId();
  if (!memberId || !isPushSupported() || getNotificationPermission() !== 'granted') return false;

  try {
    if (!await retryPendingUnsubscribe()) return false;
    const result = await requestPushDevice('sync', { memberId });
    if (result.success) {
      localStorage.setItem(STORAGE_KEY_PUSH_ENABLED, 'true');
      setStoredNotificationPreferences(memberId, result);
    } else {
      localStorage.removeItem(STORAGE_KEY_PUSH_ENABLED);
    }
    return Boolean(result.success);
  } catch {
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
): Promise<{ success: boolean; error?: string }> {
  if (!isPushSupported()) {
    return { success: false, error: 'Push notifications are not supported by this browser.' };
  }

  if (!VAPID_PUBLIC_KEY) {
    return { success: false, error: 'VAPID public key is not configured.' };
  }

  try {
    // 1. Request permission
    const permission = Notification.permission === 'default'
      ? await Notification.requestPermission()
      : Notification.permission;
    if (permission !== 'granted') {
      return { success: false, error: 'Push notification permission was denied or dismissed.' };
    }

    const memberId = options.memberId || getStoredMemberId();
    if (!memberId) return { success: false, error: 'Sign in with Discord to enable alerts.' };
    if (!await retryPendingUnsubscribe()) {
      return { success: false, error: 'Could not finish unlinking the previous device subscription. Try again.' };
    }
    // Keep the browser subscription request in the foreground permission flow.
    const registration = await waitForPushWorker();
    if (!await registration.pushManager.getSubscription()) {
      await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
    const result = await requestPushDevice('sync', { ...options, memberId, enable: true });
    if (!result.success) return { success: false, error: result.error || 'Could not enable alerts. Try again.' };
    localStorage.setItem(STORAGE_KEY_PUSH_ENABLED, 'true');
    setStoredNotificationPreferences(memberId, result);
    return { success: true };
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
    const memberId = getStoredMemberId();
    if (!memberId) return { success: false, error: 'Sign in with Discord to unlink this device.' };
    const result = await requestPushDevice('unlink', { memberId });
    if (!result.success) return { success: false, error: result.error || 'Could not unlink this device. Try again.' };
    localStorage.removeItem(STORAGE_KEY_PUSH_ENABLED);
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
 * Stores the authenticated member ID for client-side state
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

/**
 * Retrieves any pending unsubscribe endpoint stored in localStorage
 */
export function getStoredPendingUnsubscribeEndpoint(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(STORAGE_KEY_PENDING_UNSUBSCRIBE);
}

/**
 * Sets or clears the pending unsubscribe endpoint in localStorage
 */
export function setStoredPendingUnsubscribeEndpoint(endpoint: string | null): void {
  if (typeof localStorage === 'undefined') return;
  if (endpoint) {
    localStorage.setItem(STORAGE_KEY_PENDING_UNSUBSCRIBE, endpoint);
  } else {
    localStorage.removeItem(STORAGE_KEY_PENDING_UNSUBSCRIBE);
  }
}

/**
 * Retries unregistering any locally pending push subscription endpoint against the server
 * once an authenticated session token becomes available.
 */
export async function retryPendingUnsubscribe(): Promise<boolean> {
  const pendingEndpoint = getStoredPendingUnsubscribeEndpoint();
  if (!pendingEndpoint) return true;

  const token = getStoredAuthToken();
  if (!token) return false;

  try {
    const res = await fetch('/api/push/unsubscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ endpoint: pendingEndpoint }),
    });

    if (res.ok) {
      setStoredPendingUnsubscribeEndpoint(null);
      return true;
    }
  } catch {
    // Retry later
  }
  return false;
}

/**
 * Detects whether the application is running in standalone PWA display mode.
 * Evaluates both standard CSS display-mode media query and legacy iOS navigator.standalone.
 */
export function isStandaloneMode(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(
    window.matchMedia?.('(display-mode: standalone)').matches ||
      ('standalone' in window.navigator && Boolean((window.navigator as unknown as { standalone: boolean }).standalone))
  );
}

/**
 * Checks whether an active push subscription currently exists in the browser.
 * Verifies that Service Workers, PushManager, and Notification permissions are active,
 * and inspects pushManager.getSubscription().
 */
export async function hasActivePushSubscription(): Promise<boolean> {
  if (!isPushSupported()) return false;
  if (getNotificationPermission() !== 'granted') return false;
  try {
    const sub = await getExistingSubscription();
    return sub !== null;
  } catch {
    return false;
  }
}

/**
 * Determines whether the unified setup onboarding card should be auto-dismissed.
 * Automatically and permanently hides when both standalone mode and push notifications are active.
 *
 * @param isStandalone - Whether the client is executing in standalone PWA mode
 * @param isPushSubscribed - Whether active Web Push notifications are enabled on this device
 * @returns boolean indicating whether the card should be permanently auto-dismissed
 */
export function shouldAutoDismissOnboarding(
  isStandalone: boolean,
  isPushSubscribed: boolean
): boolean {
  return isStandalone && isPushSubscribed;
}

