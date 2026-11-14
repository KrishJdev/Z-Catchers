'use client';

import React, { useState, useEffect, useCallback } from 'react';
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
} from 'lucide-react';
import {
  getExistingSubscription,
  getNotificationPermission,
  isPushSupported,
  subscribeToPush,
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
  const [isPushSubscribed, setIsPushSubscribed] = useState(isPushGranted);
  const [isIosPrompt, setIsIosPrompt] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isEnablingPush, setIsEnablingPush] = useState(false);

  useEffect(() => {
    // 1. Detect standalone PWA execution mode via standard CSS display-mode and navigator.standalone
    const standaloneMode =
      window.matchMedia('(display-mode: standalone)').matches ||
      ('standalone' in window.navigator && Boolean((window.navigator as unknown as { standalone: boolean }).standalone)) ||
      isStandaloneMode();
    setIsStandalone(standaloneMode);

    // 2. Check dismissal state with 7-day cooldown
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

    // 5. Inspect active push subscription asynchronously
    let isMounted = true;
    const inspectPushState = async () => {
      if (isPushSupported()) {
        try {
          const sub = await getExistingSubscription();
          const perm = getNotificationPermission();
          if (isMounted) {
            setIsPushSubscribed(Boolean(sub) && perm === 'granted');
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
    };
  }, []);

  // Update internal push state if parent prop updates
  useEffect(() => {
    if (isPushGranted) {
      setIsPushSubscribed(true);
    }
  }, [isPushGranted]);

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

  // Handle Chromium / Android native install prompt
  const handleInstallClick = async () => {
    if (!installPrompt) return;
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setInstallPrompt(null);
        setIsStandalone(true);
      }
    } catch (err) {
      console.warn('Install prompt error:', err);
    }
  };

  // Handle push notification setup
  const handleEnablePushClick = async () => {
    if (currentUser) {
      setIsEnablingPush(true);
      try {
        const result = await subscribeToPush({
          memberId: currentUser.id,
          notifyPersonal: true,
          notifyCommunity: true,
        });
        if (result.success) {
          setIsPushSubscribed(true);
          onPushStateChanged?.(true);
          return;
        }
      } catch (err) {
        console.warn('Inline subscribe error, delegating to push modal:', err);
      } finally {
        setIsEnablingPush(false);
      }
    }
    // Fall back to opening detailed Push modal
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
            Complete this 2-step setup for instant bedtime alarms & full PWA features.
          </p>
        </div>
      </div>

      {/* 2-Step Onboarding Grid / Stack */}
      <div className="flex flex-col gap-3">
        {/* Step 1: Add to Home Screen (PWA Installation) */}
        {isStandalone ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-night-border/60 bg-night-elevated/40 p-3.5">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400">
                <CheckCircle2 className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-cream-primary">Step 1: Add to Home Screen</p>
                <p className="text-[11px] text-cream-secondary">
                  Installed as a standalone PWA on your device.
                </p>
              </div>
            </div>
            <span className="shrink-0 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-400">
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
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400">
                <CheckCircle2 className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-cream-primary">Step 2: Enable Push Notifications</p>
                <p className="text-[11px] text-cream-secondary">
                  Bedtime alerts & Sleep Shield protections are active on this device.
                </p>
              </div>
            </div>
            <span className="shrink-0 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-400">
              Active ✓
            </span>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-status-amber/40 bg-night-elevated p-3.5">
            <div className="flex items-start gap-3 min-w-0">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-status-amber/20 text-status-amber">
                <Bell className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-cream-primary">Step 2: Enable Push Notifications</p>
                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-status-amber font-medium">
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-status-amber" />
                  <span>Sleep Shield Guarantee: Never nagged during your personal 8-hour sleep window.</span>
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
        )}
      </div>
    </section>
  );
}
