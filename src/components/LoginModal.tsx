'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { FoxMascot } from './FoxMascot';
import { Member } from '@/lib/db';
import {
  X,
  Lock,
  Unlock,
  KeyRound,
  CheckCircle2,
  AlertTriangle,
  UserCheck,
  ShieldCheck,
  LogOut,
  Sparkles,
} from 'lucide-react';
import {
  setStoredAuthToken,
  setStoredAuthMember,
  clearAuthSession,
} from '@/lib/pushClient';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  members: Member[];
  currentUser: Member | null;
  onLoginSuccess: (member: Member) => void;
  onLogout: () => void;
}

export function LoginModal({
  isOpen,
  onClose,
  members,
  currentUser,
  onLoginSuccess,
  onLogout,
}: LoginModalProps) {
  const [selectedMemberId, setSelectedMemberId] = useState<string>('');
  const [pin, setPin] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Sync selected member ID
  useEffect(() => {
    if (currentUser) {
      setSelectedMemberId(currentUser.id);
    } else if (members.length > 0 && !selectedMemberId) {
      setSelectedMemberId(members[0].id);
    }
  }, [currentUser, members, isOpen, selectedMemberId]);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setError(null);
      setSuccess(null);
      setPin('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const selectedMember = members.find((m) => m.id === selectedMemberId);
  const isProfileUnclaimed =
    selectedMember && !(selectedMember.has_pin ?? Boolean(selectedMember.passcode_hash));

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!selectedMemberId) {
      setError('Please select your Discord profile.');
      return;
    }

    if (!pin || pin.trim().length < 4) {
      setError('Please enter your 4-to-6 digit PIN.');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          member_id: selectedMemberId,
          pin: pin.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to authenticate PIN.');
        return;
      }

      setStoredAuthToken(data.token);
      setStoredAuthMember(data.member);
      setSuccess(data.message || 'Successfully logged in!');
      onLoginSuccess(data.member);

      setTimeout(() => {
        onClose();
      }, 700);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Login failed';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleLogoutClick = async () => {
    setLoading(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore network errors on logout
    }
    clearAuthSession();
    onLogout();
    setSuccess('Logged out successfully.');
    setLoading(false);
    setTimeout(() => {
      onClose();
    }, 600);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-md rounded-3xl border border-night-border bg-night-surface p-6 shadow-2xl">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-xl p-2 text-cream-muted hover:bg-night-elevated hover:text-cream-primary transition-colors"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3.5 mb-5">
          <FoxMascot state={currentUser ? 'lantern' : 'sleeping'} size={38} />
          <div>
            <h2 className="text-lg font-bold text-cream-primary">
              {currentUser ? 'Member Account' : 'Log In to Z Catchers'}
            </h2>
            <p className="text-xs text-cream-secondary">
              {currentUser
                ? 'Manage your active den session'
                : 'Link your device to receive personal bedtime alerts'}
            </p>
          </div>
        </div>

        {/* Error Feedback Alert */}
        {error && (
          <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-status-coral/40 bg-status-coral/10 p-3 text-xs text-status-coral leading-relaxed">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Success Feedback Alert */}
        {success && (
          <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-status-sage/40 bg-status-sage/10 p-3 text-xs text-status-sage leading-relaxed">
            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{success}</span>
          </div>
        )}

        {currentUser ? (
          /* Currently Logged In View */
          <div className="space-y-4">
            <div className="rounded-2xl border border-night-border bg-night-bg/80 p-4">
              <div className="flex items-center gap-3">
                <img
                  src={
                    currentUser.avatar_url ||
                    `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(
                      currentUser.discord_username
                    )}`
                  }
                  alt={currentUser.discord_username}
                  className="h-12 w-12 rounded-full border border-status-amber/40 bg-night-elevated"
                />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-base font-bold text-cream-primary">
                      {currentUser.discord_username}
                    </span>
                    <span className="rounded bg-status-sage/20 border border-status-sage/40 px-1.5 py-0.5 text-[10px] font-semibold text-status-sage">
                      Logged In
                    </span>
                  </div>
                  <p className="text-xs text-cream-secondary">
                    Bedtime: {currentUser.bedtime_local} ({currentUser.timezone.split('/').pop()?.replace(/_/g, ' ')})
                  </p>
                </div>
              </div>

              <div className="mt-3.5 pt-3 border-t border-night-border/60 text-xs text-cream-secondary flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-status-sage shrink-0" />
                <span>Personal Sleep Shield and Bedtime Alerts are active for this account.</span>
              </div>
            </div>

            <div className="pt-2 flex flex-col gap-2">
              <button
                type="button"
                onClick={handleLogoutClick}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 rounded-xl border border-status-coral/40 bg-status-coral/10 py-2.5 text-xs font-semibold text-status-coral hover:bg-status-coral/20 transition-colors disabled:opacity-50"
              >
                <LogOut className="h-4 w-4" />
                <span>Log Out of Profile</span>
              </button>
            </div>
          </div>
        ) : (
          /* Login Form */
          <form onSubmit={handleLogin} className="space-y-4">
            {/* Member Profile Selector */}
            <div>
              <label className="block text-xs font-semibold text-cream-primary mb-1.5">
                Select Your Discord Profile
              </label>
              <select
                value={selectedMemberId}
                onChange={(e) => {
                  setSelectedMemberId(e.target.value);
                  setError(null);
                }}
                className="w-full appearance-none rounded-xl border border-night-border bg-night-bg px-3.5 py-2.5 text-xs text-cream-primary focus:border-status-amber focus:outline-none"
              >
                {members.map((m) => (
                  <option key={m.id} value={m.id} className="bg-night-surface">
                    {m.discord_username} ({m.bedtime_local} in{' '}
                    {m.timezone.split('/').pop()?.replace(/_/g, ' ')})
                  </option>
                ))}
              </select>
            </div>

            {/* Claim Notice or Existing PIN Notice */}
            {isProfileUnclaimed ? (
              <div className="rounded-xl border border-status-amber/40 bg-status-amber/10 p-3 text-xs text-status-amber flex items-start gap-2">
                <Sparkles className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Unclaimed Profile!</p>
                  <p className="text-[11px] opacity-90 mt-0.5">
                    Choose a new 4-digit PIN below to claim this profile and secure your account.
                  </p>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-night-border bg-night-elevated/40 p-3 text-xs text-cream-secondary flex items-start gap-2">
                <KeyRound className="h-4 w-4 shrink-0 text-status-amber mt-0.5" />
                <span className="text-[11px]">
                  Enter your 4-digit PIN to authenticate and link push notifications to your device.
                </span>
              </div>
            )}

            {/* PIN Input */}
            <div>
              <label className="block text-xs font-semibold text-cream-primary mb-1.5">
                {isProfileUnclaimed ? 'Create 4-Digit PIN' : 'Enter 4-Digit PIN'}
              </label>
              <div className="relative">
                <input
                  type="password"
                  maxLength={6}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                  placeholder="••••"
                  className="w-full tracking-widest text-center text-lg font-bold rounded-xl border border-night-border bg-night-bg px-3.5 py-2.5 text-cream-primary focus:border-status-amber focus:outline-none placeholder:text-cream-muted/40"
                  autoFocus
                />
              </div>
              <p className="mt-1 text-[11px] text-cream-muted text-center">
                Forgot your PIN? Ask a moderator in Discord to reset it via the Mod Panel.
              </p>
            </div>

            {/* Submit Button */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-status-amber py-2.5 text-xs font-bold text-night-bg shadow hover:bg-status-amber/90 transition-all disabled:opacity-50"
              >
                <Lock className="h-4 w-4" />
                <span>
                  {loading
                    ? 'Authenticating...'
                    : isProfileUnclaimed
                    ? 'Claim Profile & Log In'
                    : 'Log In with PIN'}
                </span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
