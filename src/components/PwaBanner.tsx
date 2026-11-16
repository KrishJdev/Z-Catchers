'use client';

/**
 * PwaBanner.tsx - Re-exports UnifiedOnboardingCard for backwards compatibility.
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
