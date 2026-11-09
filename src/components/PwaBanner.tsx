'use client';

import React, { useState, useEffect } from 'react';
import { Bell, Share, X } from 'lucide-react';

interface PwaBannerProps {
  onEnablePush: () => void;
  isPushGranted: boolean;
}

export function PwaBanner({ onEnablePush, isPushGranted }: PwaBannerProps) {
  const [isDismissed, setIsDismissed] = useState(false);
  const [isIosPrompt, setIsIosPrompt] = useState(false);

  useEffect(() => {
    // Check if running on iOS Safari outside standalone PWA mode
    const isIos = /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase());
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      ('standalone' in window.navigator && (window.navigator as unknown as { standalone: boolean }).standalone);

    if (isIos && !isStandalone) {
      setIsIosPrompt(true);
    }
  }, []);

  if (isDismissed || isPushGranted) {
    return null;
  }

  if (isIosPrompt) {
    return (
      <div className="relative mb-3 rounded-2xl border border-status-amber/40 bg-status-amber/10 p-3.5 text-xs text-cream-secondary">
        <button
          onClick={() => setIsDismissed(true)}
          className="absolute right-2 top-2 p-1 text-cream-muted hover:text-cream-primary"
        >
          <X className="h-4 w-4" />
        </button>
        <p className="font-semibold text-status-amber">📲 Install Z Catchers for Bedtime Alerts</p>
        <p className="mt-1 flex items-center gap-1.5 leading-relaxed">
          Tap the Share button <Share className="inline h-3.5 w-3.5 text-status-amber" /> below and select
          <strong className="text-cream-primary">&apos;Add to Home Screen&apos;</strong> to enable push notifications on iOS.
        </p>
      </div>
    );
  }

  return (
    <div className="relative mb-3 flex items-center justify-between gap-3 rounded-2xl border border-status-amber/40 bg-night-surface p-3.5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-status-amber/20 text-status-amber">
          <Bell className="h-4 w-4" />
        </div>
        <div>
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
