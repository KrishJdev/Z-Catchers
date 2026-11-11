'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Bell, Share, X, Download } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

interface PwaBannerProps {
  onEnablePush: () => void;
  isPushGranted: boolean;
}

const STORAGE_KEY_PWA_DISMISSED = 'zcatchers_pwa_banner_dismissed_at';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Progressive Web App installation prompt banner for mobile devices.
 * Handles Android/Chromium beforeinstallprompt events, iOS Add to Home Screen instructions, and 7-day dismissal cooldowns.
 *
 * @param props - Banner properties with onEnablePush and isPushGranted
 * @returns React JSX banner element or null if dismissed or running in standalone mode
 */
export function PwaBanner({ onEnablePush, isPushGranted }: PwaBannerProps) {
  const [isDismissed, setIsDismissed] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIosPrompt, setIsIosPrompt] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // 1. Detect standalone PWA execution mode
    const standaloneMode =
      window.matchMedia('(display-mode: standalone)').matches ||
      ('standalone' in window.navigator && Boolean((window.navigator as unknown as { standalone: boolean }).standalone));

    if (standaloneMode) {
      setIsStandalone(true);
      return;
    }

    // 2. Check 7-day dismissal cooldown
    try {
      const dismissedAtStr = localStorage.getItem(STORAGE_KEY_PWA_DISMISSED);
      if (dismissedAtStr) {
        const dismissedAt = parseInt(dismissedAtStr, 10);
        if (!isNaN(dismissedAt) && Date.now() - dismissedAt < SEVEN_DAYS_MS) {
          setIsDismissed(true);
        }
      }
    } catch (err) {
      console.warn('Failed to read PWA banner dismissal timestamp:', err);
    }

    // 3. Detect iOS/iPadOS Safari (touch Apple devices outside standalone mode)
    const ua = window.navigator.userAgent.toLowerCase();
    const isAppleMobile =
      /iphone|ipad|ipod/.test(ua) ||
      (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);

    if (isAppleMobile) {
      setIsIosPrompt(true);
    }

    // 4. Capture Chromium/Android install prompt
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  // Dismiss with 7-day cooldown
  const handleDismiss = useCallback(() => {
    setIsDismissed(true);
    try {
      localStorage.setItem(STORAGE_KEY_PWA_DISMISSED, String(Date.now()));
    } catch (err) {
      console.warn('Failed to store banner dismissal:', err);
    }
  }, []);

  // Handle native install prompt
  const handleInstallClick = async () => {
    if (!installPrompt) return;
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setInstallPrompt(null);
      }
    } catch (err) {
      console.warn('Install prompt error:', err);
    }
  };

  // If already running in standalone PWA mode or dismissed within 7-day cooldown, hide completely
  if (isStandalone || isDismissed) {
    return null;
  }

  // 1. Android / Chrome Native Install Banner (when install prompt captured)
  if (installPrompt) {
    return (
      <div className="relative mb-3 flex items-center justify-between gap-3 rounded-2xl border border-status-amber/40 bg-night-surface p-3.5 shadow-sm">
        <button
          onClick={handleDismiss}
          className="absolute right-2 top-2 p-1 text-cream-muted hover:text-cream-primary"
          aria-label="Dismiss banner"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-status-amber/20 text-status-amber">
            <Download className="h-4 w-4" />
          </div>
          <div className="pr-4">
            <p className="text-xs font-semibold text-cream-primary">Install Z Catchers App</p>
            <p className="text-[11px] text-cream-secondary">
              Add to your home screen for instant bedtime alarms & full PWA experience.
            </p>
          </div>
        </div>

        <button
          onClick={handleInstallClick}
          className="shrink-0 rounded-xl bg-status-amber px-3.5 py-2 text-xs font-semibold text-night-bg transition-opacity hover:opacity-90 active:scale-95"
        >
          Install App
        </button>
      </div>
    );
  }

  // 2. iOS / iPadOS Safari Instructions (Add to Home Screen)
  if (isIosPrompt && !isPushGranted) {
    return (
      <div className="relative mb-3 rounded-2xl border border-status-amber/40 bg-status-amber/10 p-3.5 text-xs text-cream-secondary">
        <button
          onClick={handleDismiss}
          className="absolute right-2 top-2 p-1 text-cream-muted hover:text-cream-primary"
          aria-label="Dismiss banner"
        >
          <X className="h-4 w-4" />
        </button>
        <p className="font-semibold text-status-amber">📲 Install Z Catchers for Bedtime Alerts</p>
        <p className="text-sm leading-relaxed text-[#A89F91] mt-1">
          Tap the Share button <span className="inline-flex items-center align-middle mx-1"><Share className="h-3.5 w-3.5 text-status-amber" /></span> and select{' '}
          <strong className="text-[#F4F1EA] font-semibold">&apos;Add to Home Screen&apos;</strong> to enable push notifications on iOS.
        </p>
      </div>
    );
  }

  // If push is already granted and no install prompt, hide banner
  if (isPushGranted) {
    return null;
  }

  // 3. Push Alert Gate Prompt (When push not granted)
  return (
    <div className="relative mb-3 flex items-center justify-between gap-3 rounded-2xl border border-status-amber/40 bg-night-surface p-3.5 shadow-sm">
      <button
        onClick={handleDismiss}
        className="absolute right-2 top-2 p-1 text-cream-muted hover:text-cream-primary"
        aria-label="Dismiss banner"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-status-amber/20 text-status-amber">
          <Bell className="h-4 w-4" />
        </div>
        <div className="pr-4">
          <p className="text-xs font-semibold text-cream-primary">Never miss a friend&apos;s bedtime</p>
          <p className="text-[11px] text-cream-secondary">Get notified when it&apos;s time to nag awake friends.</p>
        </div>
      </div>

      <button
        onClick={onEnablePush}
        className="shrink-0 rounded-xl bg-status-amber px-3 py-2 text-xs font-semibold text-night-bg transition-opacity hover:opacity-90"
      >
        Turn On
      </button>
    </div>
  );
}
