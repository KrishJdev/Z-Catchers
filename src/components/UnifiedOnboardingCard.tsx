'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { FoxMascot } from './FoxMascot';
import { Member } from '@/lib/db';
import {
  Download,
  Share,
  Bell,
  CheckCircle2,
  ShieldCheck,
  X,
  Sparkles,
  AlertCircle,
} from 'lucide-react';
import {
  getExistingSubscription,
  getNotificationPermission,
  isPushSupported,
  subscribeToPush,
  registerServiceWorker,
  syncPushSubscriptionHealth,
  isStandaloneMode,
  shouldAutoDismissOnboarding,
} from '@/lib/pushClient';

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export interface UnifiedOnboardingCardProps {
  onEnablePush?: () => void;
  isPushGranted?: boolean;
  currentUser?: Member | null;
  onPushStateChanged?: (enabled: boolean) => void;
  onDismiss?: () => void;
}

export const STORAGE_KEY_PWA_DISMISSED = 'zcatchers_pwa_banner_dismissed_at';
export const STORAGE_KEY_ONBOARDING_DISMISSED = 'zcatchers_unified_onboarding_dismissed_at';
export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Unified PWA Install & Push Onboarding Card.
 * Replaces competing banners with a single 2-step setup card:
 * 1. Add Z-Catchers to Home Screen (PWA installation)
 * 2. Enable Push Notifications (with Sleep Shield guarantee explanation)
 *
 * Automatically and permanently dismisses when both standalone mode and push notifications are active.
 */
export function UnifiedOnboardingCard({
  onEnablePush,
  isPushGranted = false,
  currentUser,
  onPushStateChanged,
  onDismiss,
}: UnifiedOnboardingCardProps) {
  const [isDismissed, setIsDismissed] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isInstallAccepted, setIsInstallAccepted] = useState(false);
  const [isPushSubscribed, setIsPushSubscribed] = useState(isPushGranted);
  const [isIosPrompt, setIsIosPrompt] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isEnablingPush, setIsEnablingPush] = useState(false);
  const [pushErrorMessage, setPushErrorMessage] = useState<string | null>(null);

  // Synchronize internal push state with parent prop updates (both true and false)
  // and maintain an inspection token so stale async checks never overwrite newer states.
  const inspectionTokenRef = useRef(0);
  const pushGrantedRef = useRef(isPushGranted);

  useEffect(() => {
    pushGrantedRef.current = isPushGranted;
    // Invalidate any active background inspection
    inspectionTokenRef.current += 1;
    setIsPushSubscribed(isPushGranted);
    if (isPushGranted) {
      setPushErrorMessage(null);
    }
  }, [isPushGranted]);

  useEffect(() => {
    // 0. Pre-register service worker on mount if supported so it is ready before user interaction
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      registerServiceWorker().catch(() => null);
    }

    // 1. Detect standalone PWA execution mode via standard CSS display-mode and navigator.standalone
    const standaloneMode =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      ('standalone' in window.navigator && Boolean((window.navigator as unknown as { standalone: boolean }).standalone)) ||
      isStandaloneMode();

    setIsStandalone(Boolean(standaloneMode));

    // 2. Check dismissal state with 7-day dismissal cooldown
    try {
      const pwaDismissedStr = localStorage.getItem(STORAGE_KEY_PWA_DISMISSED);
      const unifiedDismissedStr = localStorage.getItem(STORAGE_KEY_ONBOARDING_DISMISSED);
      const dismissedTimestamp = unifiedDismissedStr || pwaDismissedStr;

      if (dismissedTimestamp) {
        const dismissedAt = parseInt(dismissedTimestamp, 10);
        if (!isNaN(dismissedAt) && Date.now() - dismissedAt < SEVEN_DAYS_MS) {
          setIsDismissed(true);
        }
      }
    } catch (err) {
      console.warn('Failed to read onboarding card dismissal timestamp:', err);
    }

    // 3. Detect iOS/iPadOS Safari outside standalone mode
    const ua = window.navigator.userAgent.toLowerCase();
    const isAppleMobile =
      /iphone|ipad|ipod/.test(ua) ||
      (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);

    if (isAppleMobile) {
      setIsIosPrompt(true);
    }

    // 4. Capture Chromium/Android beforeinstallprompt
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // 5. Handle appinstalled event when user accepts PWA install
    const handleAppInstalled = () => {
      setInstallPrompt(null);
      setIsInstallAccepted(true);
      setIsStandalone(isStandaloneMode());
    };

    window.addEventListener('appinstalled', handleAppInstalled);

    // 6. Listen for dynamic display-mode changes (e.g. window pop-out to standalone)
    const mediaQuery = window.matchMedia?.('(display-mode: standalone)');
    const handleDisplayModeChange = (e: MediaQueryListEvent) => {
      setIsStandalone(Boolean(e.matches || isStandaloneMode()));
    };

    mediaQuery?.addEventListener?.('change', handleDisplayModeChange);

    // 7. Inspect active push subscription asynchronously with token guard
    const currentToken = ++inspectionTokenRef.current;
    let isMounted = true;

    const inspectPushState = async () => {
      if (isPushSupported()) {
        try {
          const sub = await getExistingSubscription();
          const perm = getNotificationPermission();
          let serverSynced = false;
          if (Boolean(sub) && perm === 'granted') {
            serverSynced = await syncPushSubscriptionHealth().catch(() => false);
          }

          // Only apply if component is still mounted and no newer prop update has occurred
          if (isMounted && currentToken === inspectionTokenRef.current) {
            if (serverSynced) {
              setIsPushSubscribed(true);
              onPushStateChanged?.(true);
            } else if (!pushGrantedRef.current) {
              setIsPushSubscribed(false);
            }
          }
        } catch (err) {
          console.warn('Failed to inspect push subscription state:', err);
        }
      }
    };
    inspectPushState();

    return () => {
      isMounted = false;
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      mediaQuery?.removeEventListener?.('change', handleDisplayModeChange);
    };
  }, [onPushStateChanged]);

  // User dismissal handler with local storage persistence
  const handleDismiss = useCallback(() => {
    setIsDismissed(true);
    try {
      const nowStr = String(Date.now());
      localStorage.setItem(STORAGE_KEY_PWA_DISMISSED, nowStr);
      localStorage.setItem(STORAGE_KEY_ONBOARDING_DISMISSED, nowStr);
    } catch (err) {
      console.warn('Failed to store onboarding dismissal:', err);
    }
    onDismiss?.();
  }, [onDismiss]);

  // Handle Chromium / Android native install prompt:
  // Derives standalone state from isStandaloneMode() rather than assuming acceptance means the current window is standalone.
  const handleInstallClick = async () => {
    if (!installPrompt) return;
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      setInstallPrompt(null);
      if (choice.outcome === 'accepted') {
        setIsInstallAccepted(true);
        setIsStandalone(isStandaloneMode());
      }
    } catch (err) {
      console.warn('Install prompt error:', err);
    }
  };

  // Handle push notification setup:
  // Immediately requests Notification permission during the click gesture to preserve transient
  // user activation in WebKit/iOS Safari & Chromium, verifies service worker registration,
  // and bounds only the wait for SW readiness.
  const handleEnablePushClick = async () => {
    setPushErrorMessage(null);

    if (currentUser) {
      setIsEnablingPush(true);
      try {
        // Verify push support in current browser
        if (!isPushSupported()) {
          setPushErrorMessage('Push notifications are not supported by this browser.');
          setIsEnablingPush(false);
          return;
        }

        // 1. Immediately request notification permission during user click gesture
        // to preserve transient activation in WebKit/iOS Safari & Chromium
        if (typeof Notification !== 'undefined') {
          const perm = await Notification.requestPermission();
          if (perm !== 'granted') {
            setPushErrorMessage(
              perm === 'denied'
                ? 'Notifications are blocked in browser settings. Please enable them to receive alerts.'
                : 'Notification permission was dismissed.'
            );
            setIsEnablingPush(false);
            return;
          }
        }

        // 2. Verify or trigger service worker registration
        const existingReg = await navigator.serviceWorker.getRegistration().catch(() => null);
        if (!existingReg) {
          await registerServiceWorker().catch(() => null);
        }

        // 3. Bounded wait for service worker readiness (at most 4000ms)
        const isSwReady = await Promise.race([
          navigator.serviceWorker.ready.then(() => true).catch(() => false),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 4000)),
        ]);

        if (!isSwReady) {
          setPushErrorMessage('Service worker is taking longer than expected. Please try again.');
          setIsEnablingPush(false);
          return;
        }

        // 4. Perform subscription (permission is already granted) without timeout on subscription itself
        const result = await subscribeToPush({
          memberId: currentUser.id,
        });

        if (result.success) {
          setIsPushSubscribed(true);
          onPushStateChanged?.(true);
          return;
        } else {
          setPushErrorMessage(result.error || 'Failed to enable push notifications.');
        }
      } catch (err) {
        console.warn('Inline subscribe error:', err);
        setPushErrorMessage('Network error enabling notifications. Please try again.');
      } finally {
        setIsEnablingPush(false);
      }
      return;
    }

    // Fall back to opening detailed Push modal if unauthenticated or manual preference tuning needed
    onEnablePush?.();
  };

  const isPushActive = isPushGranted || isPushSubscribed;

  // Auto-dismiss permanently when BOTH standalone mode and push notifications are active,
  // or if dismissed by user within cooldown window.
  if (shouldAutoDismissOnboarding(isStandalone, isPushActive) || isDismissed) {
    return null;
  }

  return (
    <section
      aria-label="App Setup Guide"
      className="relative mb-6 rounded-2xl border border-night-border/80 bg-night-surface/95 p-4 sm:p-5 shadow-lg backdrop-blur-sm"
    >
      {/* Dismiss Button */}
      <button
        type="button"
        onClick={handleDismiss}
        className="absolute right-2.5 top-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-cream-muted hover:text-cream-primary hover:bg-night-elevated transition-colors"
        aria-label="Dismiss setup card"
      >
        <X className="h-4 w-4" />
      </button>

      {/* Header with Mascot & Title */}
      <div className="flex items-center gap-3 pr-10 mb-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-night-elevated border border-night-border/60">
          <FoxMascot state="lantern" size={28} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-cream-primary">Get the Full Z Catchers Experience</h2>
            <Sparkles className="h-3.5 w-3.5 text-status-amber hidden sm:inline" />
          </div>
          <p className="text-xs text-cream-secondary mt-0.5">
            Install the app and enable wind-down reminders on this device.
          </p>
        </div>
      </div>

      {/* 2-Step Onboarding Grid / Stack */}
      <div className="flex flex-col gap-3">
        {/* Step 1: Add to Home Screen (PWA Installation) */}
        {isStandalone ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-night-border/60 bg-night-elevated/40 p-3.5">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-status-sage/15 text-status-sage">
                <CheckCircle2 className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-cream-primary">Step 1: Add to Home Screen</p>
                <p className="text-[11px] text-cream-secondary">
                  Installed as a standalone PWA on your device.
                </p>
              </div>
            </div>
            <span className="shrink-0 rounded-full bg-status-sage/10 px-2.5 py-1 text-[11px] font-semibold text-status-sage">
              Installed ✓
            </span>
          </div>
        ) : isInstallAccepted ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-night-border/60 bg-night-elevated/40 p-3.5">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-status-sage/15 text-status-sage">
                <CheckCircle2 className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-cream-primary">Step 1: Add to Home Screen</p>
                <p className="text-[11px] text-cream-secondary">
                  App installation accepted. Launch from your home screen or apps list.
                </p>
              </div>
            </div>
            <span className="shrink-0 rounded-full bg-status-sage/10 px-2.5 py-1 text-[11px] font-semibold text-status-sage">
              Installed ✓
            </span>
          </div>
        ) : installPrompt ? (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-status-amber/40 bg-night-elevated p-3.5">
            <div className="flex items-start gap-3 min-w-0">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-status-amber/20 text-status-amber">
                <Download className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-cream-primary">Step 1: Add to Home Screen</p>
                <p className="text-[11px] text-cream-secondary mt-0.5">
                  Install Z Catchers to your home screen for instant full-screen alarms & fast check-in.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleInstallClick}
              className="h-10 min-h-[44px] px-4 flex items-center justify-center rounded-xl bg-status-amber text-xs font-semibold text-night-bg transition-opacity hover:opacity-90 active:scale-95 whitespace-nowrap shrink-0"
            >
              Install App
            </button>
          </div>
        ) : isIosPrompt ? (
          <div className="flex items-start gap-3 rounded-xl border border-status-amber/40 bg-status-amber/10 p-3.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-status-amber/20 text-status-amber">
              <Share className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-status-amber">Step 1: Add to Home Screen</p>
              <p className="text-xs leading-relaxed text-cream-secondary mt-1">
                Tap the Share button <span className="inline-flex items-center align-middle mx-1"><Share className="h-3 w-3 text-status-amber" /></span> and select{' '}
                <strong className="text-cream-primary font-semibold">&apos;Add to Home Screen&apos;</strong> to enable push notifications on iOS.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-night-border/80 bg-night-elevated/40 p-3.5">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-night-border text-cream-muted">
                <Download className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-cream-primary">Step 1: Add to Home Screen</p>
                <p className="text-[11px] text-cream-secondary">
                  Install or bookmark Z Catchers in your browser for quick bedtime check-ins.
                </p>
              </div>
            </div>
            <span className="shrink-0 text-[11px] text-cream-muted font-medium">
              Web Browser
            </span>
          </div>
        )}

        {/* Step 2: Enable Push Notifications (with Sleep Shield Guarantee) */}
        {isPushActive ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-night-border/60 bg-night-elevated/40 p-3.5">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-status-sage/15 text-status-sage">
                <CheckCircle2 className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-cream-primary">Step 2: Enable Push Notifications</p>
                <p className="text-[11px] text-cream-secondary">
                  Bedtime alerts & Sleep Shield protections are active on this device.
                </p>
              </div>
            </div>
            <span className="shrink-0 rounded-full bg-status-sage/10 px-2.5 py-1 text-[11px] font-semibold text-status-sage">
              Active ✓
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-2 rounded-xl border border-status-amber/40 bg-night-elevated p-3.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-status-amber/20 text-status-amber">
                  <Bell className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-cream-primary">Step 2: Enable Push Notifications</p>
                  <div className="mt-1 flex items-center gap-1.5 text-[11px] text-status-amber font-medium">
                    <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-status-amber" />
                    <span>Sleep Shield Guarantee · Check in to mute nags during your 8-hour sleep window.</span>
                  </div>
                  <p className="text-[11px] text-cream-secondary mt-0.5">
                    Receive gentle bedtime reminders and alerts when friends need a bedtime nag.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleEnablePushClick}
                  disabled={isEnablingPush}
                  className="h-10 min-h-[44px] px-4 flex items-center justify-center rounded-xl bg-status-amber text-xs font-semibold text-night-bg transition-opacity hover:opacity-90 active:scale-95 disabled:opacity-50 whitespace-nowrap"
                >
                  {isEnablingPush ? 'Enabling...' : 'Enable Alerts'}
                </button>
              </div>
            </div>

            {/* Recoverable Error Feedback */}
            {pushErrorMessage && (
              <div className="flex items-center gap-1.5 pt-1 text-[11px] text-coral-alert">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                <span>{pushErrorMessage}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
