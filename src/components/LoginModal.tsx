'use client';

/**
 * @deprecated Retired in Phase 2 in favor of the standalone `/join` onboarding and login route (`src/app/join/page.tsx`).
 * Preserved as a backward-compatible shim for existing references.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { Member } from '@/lib/db';

export interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  members?: Member[];
  currentUser?: Member | null;
  onLoginSuccess?: (member: Member) => void;
  onLogout?: () => void;
  initialTab?: 'login' | 'register';
  viewerTimezone?: string;
  onRefreshRoster?: () => Promise<void>;
}

/**
 * Backward-compatibility modal shim that redirects modal triggers to the standalone `/join` route.
 *
 * @param props - Login modal properties
 * @returns Null (redirects imperatively)
 */
export function LoginModal({
  isOpen,
  onClose,
}: LoginModalProps) {
  const router = useRouter();

  useEffect(() => {
    if (isOpen) {
      router.push('/join');
      onClose();
    }
  }, [isOpen, onClose, router]);

  return null;
}
