'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { FoxMascot } from './FoxMascot';
import { Member } from '@/lib/db';
import { DateTime } from 'luxon';
import {
  X,
  Lock,
  KeyRound,
  CheckCircle2,
  AlertTriangle,
  UserCheck,
  ShieldCheck,
  LogOut,
  Sparkles,
  UserPlus,
  Clock,
  ExternalLink,
  Moon,
  Compass,
} from 'lucide-react';
import {
  setStoredAuthToken,
  setStoredAuthMember,
  clearAuthSession,
} from '@/lib/pushClient';

const DISCORD_JOURNAL_REGEX = /^https:\/\/(ptb\.|canary\.)?discord\.com\/channels\/\d+\/\d+(\/\d+)?$/;

const POPULAR_TIMEZONES = [
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Africa/Cairo',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
  'UTC',
];

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  members: Member[];
  currentUser: Member | null;
  onLoginSuccess: (member: Member) => void;
  onLogout: () => void;
  initialTab?: 'login' | 'register';
  viewerTimezone?: string;
  onRefreshRoster?: () => Promise<void>;
}

export function LoginModal({
  isOpen,
  onClose,
  members,
  currentUser,
  onLoginSuccess,
  onLogout,
  initialTab = 'login',
  viewerTimezone = 'UTC',
  onRefreshRoster,
}: LoginModalProps) {
  const [tab, setTab] = useState<'login' | 'register'>(initialTab);

  // Login form state
  const [loginMethod, setLoginMethod] = useState<'username' | 'select'>('username');
  const [loginUsername, setLoginUsername] = useState<string>('');
  const [selectedMemberId, setSelectedMemberId] = useState<string>('');
  const [pin, setPin] = useState<string>('');

  // Register / Join form state
  const [regUsername, setRegUsername] = useState<string>('');
  const [regHandle, setRegHandle] = useState<string>('');
  const [regBedtime, setRegBedtime] = useState<string>('23:00');
  const [regWakeTime, setRegWakeTime] = useState<string>('07:00');
  const [regTimezone, setRegTimezone] = useState<string>(viewerTimezone || 'UTC');
  const [regEnableWeekend, setRegEnableWeekend] = useState<boolean>(false);
  const [regWeekendBedtime, setRegWeekendBedtime] = useState<string>('00:30');
  const [regWeekendWakeTime, setRegWeekendWakeTime] = useState<string>('09:00');
  const [regJournalUrl, setRegJournalUrl] = useState<string>('');
  const [regPin, setRegPin] = useState<string>('');

  // UI state
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Sync initial tab and detect default timezone
  useEffect(() => {
    if (isOpen) {
      setError(null);
      setSuccess(null);
      setPin('');
      setRegPin('');
      setTab(initialTab);
      if (viewerTimezone && viewerTimezone !== 'UTC') {
        setRegTimezone(viewerTimezone);
      }
      if (currentUser) {
        setSelectedMemberId(currentUser.id);
        setLoginUsername(currentUser.discord_username);
      } else if (members.length > 0) {
        setSelectedMemberId(members[0].id);
      }
    }
  }, [isOpen, initialTab, viewerTimezone, currentUser, members]);

  // Bedtime preview for registration
  const bedtimePreview = useMemo(() => {
    try {
      const [h, m] = regBedtime.split(':').map(Number);
      const dt = DateTime.now().setZone(regTimezone).set({ hour: h || 0, minute: m || 0, second: 0 });
      return {
        sleeper: dt.toFormat('h:mm a'),
        viewer: dt.setZone(viewerTimezone).toFormat('h:mm a'),
        sameZone: regTimezone === viewerTimezone,
      };
    } catch {
      return { sleeper: regBedtime, viewer: regBedtime, sameZone: true };
    }
  }, [regBedtime, regTimezone, viewerTimezone]);

  if (!isOpen) return null;

  const selectedMember = members.find((m) => m.id === selectedMemberId);
  const isProfileUnclaimed =
    loginMethod === 'select' &&
    selectedMember &&
    !(selectedMember.has_pin ?? Boolean(selectedMember.passcode_hash));

  // Handle Log In
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const cleanPin = pin.trim();
    if (!cleanPin || cleanPin.length < 4) {
      setError('Please enter your 4-to-6 digit PIN.');
      return;
    }

    const payload: { pin: string; member_id?: string; username?: string } = {
      pin: cleanPin,
    };

    if (loginMethod === 'username') {
      const cleanU = loginUsername.trim().replace(/^@/, '');
      if (!cleanU) {
        setError('Please enter your Discord username.');
        return;
      }
      payload.username = cleanU;
    } else {
      if (!selectedMemberId) {
        setError('Please select your Discord profile.');
        return;
      }
      payload.member_id = selectedMemberId;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
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
      if (onRefreshRoster) {
        await onRefreshRoster();
      }

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

  // Handle Self-Service Sign Up & Profile Creation
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const cleanU = regUsername.trim().replace(/^@/, '');
    if (!cleanU || cleanU.length < 2) {
      setError('Please enter a valid username (at least 2 characters).');
      return;
    }

    const cleanJournal = regJournalUrl.trim();
    if (!cleanJournal || !DISCORD_JOURNAL_REGEX.test(cleanJournal)) {
      setError(
        'Please enter a valid Discord Journal Thread URL: https://discord.com/channels/{guild}/{thread}'
      );
      return;
    }

    const cleanPin = regPin.trim();
    if (!cleanPin || !/^\d{4,6}$/.test(cleanPin)) {
      setError('Please choose a 4-to-6 digit numeric PIN to protect your profile.');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          discord_username: cleanU,
          discord_handle: regHandle.trim() || null,
          journal_url: cleanJournal,
          bedtime_local: regBedtime.trim(),
          wake_time_local: regWakeTime.trim(),
          timezone: regTimezone.trim(),
          weekend_bedtime_local: regEnableWeekend ? regWeekendBedtime.trim() : null,
          weekend_wake_time_local: regEnableWeekend ? regWeekendWakeTime.trim() : null,
          pin: cleanPin,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to create profile.');
        return;
      }

      setStoredAuthToken(data.token);
      setStoredAuthMember(data.member);
      setSuccess(data.message || 'Welcome to Z Catchers! Profile created.');
      onLoginSuccess(data.member);
      if (onRefreshRoster) {
        await onRefreshRoster();
      }

      setTimeout(() => {
        onClose();
      }, 850);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Registration failed';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  // Handle Logout
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
    if (onRefreshRoster) {
      await onRefreshRoster();
    }
    setTimeout(() => {
      onClose();
    }, 600);
  };

  // Helper to fill sample Discord thread link
  const handleUseSampleJournal = () => {
    setRegJournalUrl('https://discord.com/channels/123456789/987654321');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-night-bg/85 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-3xl border border-night-border bg-night-surface p-5 sm:p-6 shadow-2xl">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-xl p-2 text-cream-muted hover:bg-night-elevated hover:text-cream-primary transition-colors"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3.5 mb-5">
          <FoxMascot state={currentUser ? 'lantern' : tab === 'register' ? 'sleeping' : 'lantern'} size={38} />
          <div>
            <h2 className="text-lg font-bold text-cream-primary">
              {currentUser
                ? 'Member Account'
                : tab === 'register'
                ? 'Join the Den (Create Profile)'
                : 'Log In to Z Catchers'}
            </h2>
            <p className="text-xs text-cream-secondary">
              {currentUser
                ? 'Manage your active den session'
                : tab === 'register'
                ? 'Set your local bedtime & 4-digit PIN for friend accountability'
                : 'Log in with your username & 4-digit PIN'}
            </p>
          </div>
        </div>

        {/* Navigation Tabs (Only when not logged in) */}
        {!currentUser && (
          <div className="mb-5 flex rounded-2xl bg-night-bg p-1 border border-night-border/80">
            <button
              type="button"
              onClick={() => {
                setTab('login');
                setError(null);
              }}
              className={`flex-1 flex items-center justify-center gap-2 rounded-xl py-2 text-xs font-semibold transition-all ${
                tab === 'login'
                  ? 'bg-night-surface text-status-amber border border-night-border shadow-sm'
                  : 'text-cream-muted hover:text-cream-secondary'
              }`}
            >
              <KeyRound className="h-3.5 w-3.5" />
              <span>Log In</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('register');
                setError(null);
              }}
              className={`flex-1 flex items-center justify-center gap-2 rounded-xl py-2 text-xs font-semibold transition-all ${
                tab === 'register'
                  ? 'bg-night-surface text-status-amber border border-night-border shadow-sm'
                  : 'text-cream-muted hover:text-cream-secondary'
              }`}
            >
              <UserPlus className="h-3.5 w-3.5" />
              <span>Join Den (New Profile)</span>
            </button>
          </div>
        )}

        {/* Feedback Alerts */}
        {error && (
          <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-status-coral/40 bg-status-coral/10 p-3 text-xs text-status-coral leading-relaxed">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-status-sage/40 bg-status-sage/10 p-3 text-xs text-status-sage leading-relaxed">
            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{success}</span>
          </div>
        )}

        {/* 1. Logged In View */}
        {currentUser ? (
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
        ) : tab === 'login' ? (
          /* 2. Login Form */
          <form onSubmit={handleLogin} className="space-y-4">
            {/* Toggle Login by Username vs Select from Roster */}
            {members.length > 0 && (
              <div className="flex items-center justify-between text-xs text-cream-muted mb-1">
                <span>Login with:</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setLoginMethod('username')}
                    className={`underline hover:text-cream-primary ${
                      loginMethod === 'username' ? 'text-status-amber font-semibold' : ''
                    }`}
                  >
                    Username
                  </button>
                  <span>•</span>
                  <button
                    type="button"
                    onClick={() => setLoginMethod('select')}
                    className={`underline hover:text-cream-primary ${
                      loginMethod === 'select' ? 'text-status-amber font-semibold' : ''
                    }`}
                  >
                    Pick from Den List
                  </button>
                </div>
              </div>
            )}

            {loginMethod === 'username' || members.length === 0 ? (
              <div>
                <label className="block text-xs font-semibold text-cream-primary mb-1.5">
                  Discord Username
                </label>
                <input
                  type="text"
                  value={loginUsername}
                  onChange={(e) => setLoginUsername(e.target.value)}
                  placeholder="e.g. Alex or fox_friend"
                  className="w-full rounded-xl border border-night-border bg-night-bg px-3.5 py-2.5 text-xs text-cream-primary focus:border-status-amber focus:outline-none placeholder:text-cream-muted/50"
                  autoFocus
                />
              </div>
            ) : (
              <div>
                <label className="block text-xs font-semibold text-cream-primary mb-1.5">
                  Select Your Profile
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
            )}

            {isProfileUnclaimed && (
              <div className="rounded-xl border border-status-amber/40 bg-status-amber/10 p-3 text-xs text-status-amber flex items-start gap-2">
                <Sparkles className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Unclaimed Profile!</p>
                  <p className="text-[11px] opacity-90 mt-0.5">
                    Choose a new 4-digit PIN below to claim this profile and secure your account.
                  </p>
                </div>
              </div>
            )}

            {/* PIN Input */}
            <div>
              <label className="block text-xs font-semibold text-cream-primary mb-1.5">
                {isProfileUnclaimed ? 'Create 4-Digit PIN' : 'Enter 4-Digit PIN'}
              </label>
              <input
                type="password"
                maxLength={6}
                inputMode="numeric"
                pattern="[0-9]*"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                placeholder="••••"
                className="w-full tracking-widest text-center text-lg font-bold rounded-xl border border-night-border bg-night-bg px-3.5 py-2.5 text-cream-primary focus:border-status-amber focus:outline-none placeholder:text-cream-muted/40"
              />
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

            {/* Switch to Register link */}
            <div className="text-center pt-2">
              <button
                type="button"
                onClick={() => setTab('register')}
                className="text-xs text-cream-muted hover:text-status-amber transition-colors"
              >
                Don&apos;t have a profile yet? <span className="font-semibold text-status-amber underline">Join the Den (Sign Up) →</span>
              </button>
            </div>
          </form>
        ) : (
          /* 3. Register / Join Den Form */
          <form onSubmit={handleRegister} className="space-y-3.5">
            {/* Username & Handle */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-cream-primary mb-1">
                  Discord Display Name <span className="text-status-amber">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={regUsername}
                  onChange={(e) => setRegUsername(e.target.value)}
                  placeholder="e.g. Alex"
                  className="w-full rounded-xl border border-night-border bg-night-bg px-3 py-2 text-xs text-cream-primary focus:border-status-amber focus:outline-none"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-cream-primary mb-1">
                  Discord Handle (Optional)
                </label>
                <input
                  type="text"
                  value={regHandle}
                  onChange={(e) => setRegHandle(e.target.value)}
                  placeholder="e.g. @alex"
                  className="w-full rounded-xl border border-night-border bg-night-bg px-3 py-2 text-xs text-cream-primary focus:border-status-amber focus:outline-none"
                />
              </div>
            </div>

            {/* Timezone Selector */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-cream-primary">
                  Your Timezone <span className="text-status-amber">*</span>
                </label>
                <span className="text-[10px] text-cream-muted">
                  Auto-detected: {viewerTimezone.split('/').pop()?.replace(/_/g, ' ')}
                </span>
              </div>
              <select
                value={regTimezone}
                onChange={(e) => setRegTimezone(e.target.value)}
                className="w-full appearance-none rounded-xl border border-night-border bg-night-bg px-3 py-2 text-xs text-cream-primary focus:border-status-amber focus:outline-none"
              >
                {!POPULAR_TIMEZONES.includes(regTimezone) && (
                  <option value={regTimezone}>{regTimezone} (Local)</option>
                )}
                {POPULAR_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </div>

            {/* Bedtime & Wake Time */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-cream-primary mb-1">
                  Bedtime (24h) <span className="text-status-amber">*</span>
                </label>
                <input
                  type="time"
                  required
                  value={regBedtime}
                  onChange={(e) => setRegBedtime(e.target.value)}
                  className="w-full rounded-xl border border-night-border bg-night-bg px-3 py-2 text-xs text-cream-primary focus:border-status-amber focus:outline-none text-center font-semibold"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-cream-primary mb-1">
                  Wake Time (24h)
                </label>
                <input
                  type="time"
                  value={regWakeTime}
                  onChange={(e) => setRegWakeTime(e.target.value)}
                  className="w-full rounded-xl border border-night-border bg-night-bg px-3 py-2 text-xs text-cream-primary focus:border-status-amber focus:outline-none text-center font-semibold"
                />
              </div>
            </div>

            {/* Live Bedtime Preview */}
            <div className="rounded-xl border border-night-border/80 bg-night-bg/60 p-2.5 text-xs text-cream-secondary flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-status-amber" />
                <span>Your Bedtime:</span>
                <span className="font-bold text-cream-primary">{bedtimePreview.sleeper}</span>
              </div>
              {!bedtimePreview.sameZone && (
                <div className="text-[11px] text-cream-muted">
                  Viewer Time: <span className="font-semibold text-cream-primary">{bedtimePreview.viewer}</span>
                </div>
              )}
            </div>

            {/* Weekend Hours Toggle */}
            <div className="rounded-xl border border-night-border bg-night-elevated/40 p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Moon className="h-4 w-4 text-status-amber" />
                  <div>
                    <span className="text-xs font-semibold text-cream-primary">Custom Weekend Hours</span>
                    <p className="text-[10px] text-cream-muted">Different bedtime for Friday & Saturday nights</p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={regEnableWeekend}
                  onChange={(e) => setRegEnableWeekend(e.target.checked)}
                  className="h-4 w-4 rounded border-night-border bg-night-bg text-status-amber focus:ring-status-amber"
                />
              </div>

              {regEnableWeekend && (
                <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-night-border/60">
                  <div>
                    <label className="block text-[11px] font-medium text-cream-secondary mb-1">
                      Weekend Bedtime
                    </label>
                    <input
                      type="time"
                      value={regWeekendBedtime}
                      onChange={(e) => setRegWeekendBedtime(e.target.value)}
                      className="w-full rounded-lg border border-night-border bg-night-bg px-2.5 py-1.5 text-xs text-cream-primary focus:border-status-amber focus:outline-none text-center font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-cream-secondary mb-1">
                      Weekend Wake Time
                    </label>
                    <input
                      type="time"
                      value={regWeekendWakeTime}
                      onChange={(e) => setRegWeekendWakeTime(e.target.value)}
                      className="w-full rounded-lg border border-night-border bg-night-bg px-2.5 py-1.5 text-xs text-cream-primary focus:border-status-amber focus:outline-none text-center font-semibold"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Discord Journal Link */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-cream-primary">
                  Discord Journal Thread URL <span className="text-status-amber">*</span>
                </label>
                <button
                  type="button"
                  onClick={handleUseSampleJournal}
                  className="text-[10px] text-status-amber hover:underline"
                >
                  Use sample URL
                </button>
              </div>
              <input
                type="url"
                required
                value={regJournalUrl}
                onChange={(e) => setRegJournalUrl(e.target.value)}
                placeholder="https://discord.com/channels/123.../456..."
                className="w-full rounded-xl border border-night-border bg-night-bg px-3 py-2 text-xs text-cream-primary focus:border-status-amber focus:outline-none placeholder:text-cream-muted/50 font-mono text-[11px]"
              />
              <p className="mt-1 text-[10px] text-cream-muted">
                Friends click this link when your bedtime hits to nag you to sleep!
              </p>
            </div>

            {/* 4-Digit PIN */}
            <div>
              <label className="block text-xs font-semibold text-cream-primary mb-1">
                Create 4-to-6 Digit PIN <span className="text-status-amber">*</span>
              </label>
              <input
                type="password"
                required
                maxLength={6}
                inputMode="numeric"
                pattern="[0-9]*"
                value={regPin}
                onChange={(e) => setRegPin(e.target.value.replace(/\D/g, ''))}
                placeholder="••••"
                className="w-full tracking-widest text-center text-lg font-bold rounded-xl border border-night-border bg-night-bg px-3 py-2 text-cream-primary focus:border-status-amber focus:outline-none placeholder:text-cream-muted/40"
              />
              <p className="mt-1 text-[10px] text-cream-muted text-center">
                Remember your PIN! You will use it to log in and update your bedtime.
              </p>
            </div>

            {/* Submit Button */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-status-amber py-2.5 text-xs font-bold text-night-bg shadow hover:bg-status-amber/90 transition-all disabled:opacity-50 hover:scale-[1.01] active:scale-95"
              >
                <Sparkles className="h-4 w-4" />
                <span>{loading ? 'Creating Profile...' : 'Join Den & Create Profile 🦊'}</span>
              </button>
            </div>

            {/* Switch to Login link */}
            <div className="text-center pt-1">
              <button
                type="button"
                onClick={() => setTab('login')}
                className="text-xs text-cream-muted hover:text-status-amber transition-colors"
              >
                Already have a profile? <span className="font-semibold text-status-amber underline">Log in here →</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
