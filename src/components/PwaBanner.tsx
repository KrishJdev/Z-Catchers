'use client';

/**
 * PwaBanner.tsx - Re-exports UnifiedOnboardingCard for backwards compatibility.
 *
 * This module preserves compatibility for existing imports and test suites.
 * The underlying UnifiedOnboardingCard implementation manages:
 * - Standalone PWA detection via (display-mode: standalone) and navigator.standalone
 * - Chromium/Android beforeinstallprompt capture and install flows
 * - iOS Safari instructions with Share and 'Add to Home Screen'
 * - Dismiss button with min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg touch target
 * - LocalStorage dismissal persistence with key zcatchers_pwa_banner_dismissed_at
 *   and 7-day cooldown (SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000)
 */

import {
  UnifiedOnboardingCard,
  UnifiedOnboardingCardProps,
  STORAGE_KEY_PWA_DISMISSED,
  STORAGE_KEY_ONBOARDING_DISMISSED,
  SEVEN_DAYS_MS,
  BeforeInstallPromptEvent,
} from './UnifiedOnboardingCard';

export type { UnifiedOnboardingCardProps, BeforeInstallPromptEvent };
export {
  UnifiedOnboardingCard,
  STORAGE_KEY_PWA_DISMISSED,
  STORAGE_KEY_ONBOARDING_DISMISSED,
  SEVEN_DAYS_MS,
};

export type PwaBannerProps = UnifiedOnboardingCardProps;

/**
 * PwaBanner alias for backward compatibility.
 */
export const PwaBanner = UnifiedOnboardingCard;
