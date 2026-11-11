'use client';

import React from 'react';
import { X } from 'lucide-react';
import { FoxMascot } from './FoxMascot';
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

function DiscordIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.893.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

/**
 * Clean Discord OAuth sign-in modal styled in Warm Dark low-blue-light aesthetics.
 *
 * @param props - LoginModalProps
 * @returns React modal dialog element or null
 */
export function LoginModal({ isOpen, onClose }: LoginModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-night-bg/80 backdrop-blur-md animate-fade-in">
      <div className="w-full max-w-sm bg-night-surface border border-night-border rounded-2xl p-6 shadow-2xl relative text-center">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-xl border border-night-border text-cream-muted hover:text-cream-primary hover:bg-night-elevated transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex flex-col items-center mb-5">
          <FoxMascot state="logo" size={48} className="mb-2" />
          <h2 className="text-lg font-bold text-cream-primary">Sign in to Z Catchers</h2>
          <p className="text-xs text-cream-secondary mt-1">
            Connect your Discord account to sync your schedule & sleep alerts.
          </p>
        </div>

        <a
          href="/api/auth/discord"
          className="w-full min-h-[48px] bg-[#5865F2] hover:bg-[#4752C4] text-white font-semibold rounded-xl flex items-center justify-center gap-2.5 px-4 shadow-lg shadow-[#5865F2]/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
        >
          <DiscordIcon className="w-5 h-5 shrink-0" />
          <span>Continue with Discord</span>
        </a>

        <p className="text-[11px] text-cream-muted mt-3">
          Zero PINs or passwords required.
        </p>
      </div>
    </div>
  );
}
