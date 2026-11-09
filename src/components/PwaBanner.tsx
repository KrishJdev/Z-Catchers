'use client';

import React, { useState, useEffect } from 'react';
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

export function PwaBanner({ onEnablePush, isPushGranted }: PwaBannerProps) {
  const [isDismissed, setIsDismissed] = useState(false);
  const [isIosPrompt, setIsIosPrompt] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // Check if running on iOS Safari outside standalone PWA mode
    const isIos = /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase());
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      ('standalone' in window.navigator && (window.navigator as unknown as { standalone: boolean }).standalone);

    if (isIos && !isStandalone) {
      setIsIosPrompt(true);
    }

    // Listen for Chrome/Android install prompt
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  if (isDismissed) {
    return null;
  }

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
      console.warn('Install prompt failed:', err);
    }
  };

  // 1. Android / Chrome Native Install Banner (if installable)
  if (installPrompt) {
    return (
      <div className="relative mb-3 flex items-center justify-between gap-3 rounded-2xl border border-status-amber/40 bg-night-surface p-3.5 shadow-sm">
        <button
          onClick={() => setIsDismissed(true)}
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

  // 2. iOS Safari Instructions
  if (isIosPrompt && !isPushGranted) {
    return (
      <div className="relative mb-3 rounded-2xl border border-status-amber/40 bg-status-amber/10 p-3.5 text-xs text-cream-secondary">
        <button
          onClick={() => setIsDismissed(true)}
          className="absolute right-2 top-2 p-1 text-cream-muted hover:text-cream-primary"
          aria-label="Dismiss banner"
        >
          <X className="h-4 w-4" />
        </button>
        <p className="font-semibold text-status-amber">📲 Install Z Catchers for Bedtime Alerts</p>
        <p className="mt-1 flex items-center gap-1.5 leading-relaxed">
          Tap the Share button <Share className="inline h-3.5 w-3.5 text-status-amber" /> below and select{' '}
          <strong className="text-cream-primary">&apos;Add to Home Screen&apos;</strong> to enable push notifications on iOS.
        </p>
      </div>
    );
  }

  // If push is already granted, hide banner
  if (isPushGranted) {
    return null;
  }

  // 3. Push Alert Gate Prompt
  return (
    <div className="relative mb-3 flex items-center justify-between gap-3 rounded-2xl border border-status-amber/40 bg-night-surface p-3.5 shadow-sm">
      <button
        onClick={() => setIsDismissed(true)}
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
