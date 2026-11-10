'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { FoxMascot } from '@/components/FoxMascot';
import type { Member } from '@/lib/db';
import { COMMON_IANA_TIMEZONES, GMT_OFFSETS, formatGmtOffset } from '@/lib/timezone';
import {
  setStoredAuthToken,
  setStoredAuthMember,
  getStoredAuthMember,
  getStoredAuthToken,
} from '@/lib/pushClient';
import {
  Sparkles,
  KeyRound,
  UserPlus,
  AlertTriangle,
  CheckCircle2,
  Lock,
  Clock,
  ExternalLink,
} from 'lucide-react';

const DISCORD_JOURNAL_REGEX = /^https:\/\/(ptb\.|canary\.)?discord\.com\/channels\/\d+\/\d+(\/\d+)?$/;

export default function JoinPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'register' | 'login'>('register');

  // Roster members for returning foxes
  const [members, setMembers] = useState<Member[]>([]);
  const [loadingRoster, setLoadingRoster] = useState(true);

  // New Fox (Registration) Form State
  const [regUsername, setRegUsername] = useState('');
  const [regJournalUrl, setRegJournalUrl] = useState('');
  const [regBedtime, setRegBedtime] = useState('23:00');
  const [regTimezone, setRegTimezone] = useState('GMT+00:00');
  const [detectedIana, setDetectedIana] = useState('UTC');
  const [regPin, setRegPin] = useState('');

  // Returning Fox (Login) Form State
  const [loginMethod, setLoginMethod] = useState<'select' | 'username'>('select');
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPin, setLoginPin] = useState('');

  // Status & Feedback
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Haptic feedback helper
  const triggerHaptic = (duration = 15) => {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(duration);
      } catch {
        // Ignore vibration errors
      }
    }
  };

  // Route Guard: If already authenticated, redirect to dashboard
  useEffect(() => {
    let isMounted = true;
    const cachedMember = getStoredAuthMember<Member>();
    const cachedToken = getStoredAuthToken();

    if (cachedMember || cachedToken) {
      router.replace('/');
      return;
    }

    fetch('/api/auth/me')
      .then((res) => res.json())
      .then((data) => {
        if (!isMounted) return;
        if (data.authenticated && data.member) {
          setStoredAuthMember(data.member);
          router.replace('/');
        }
      })
      .catch((err) => console.warn('Auth check on /join error:', err));

    return () => {
      isMounted = false;
    };
  }, [router]);

  // Detect viewer timezone & fetch roster
  useEffect(() => {
    try {
      const iana = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      setDetectedIana(iana);
      setRegTimezone(iana);
    } catch {
      setDetectedIana('UTC');
      setRegTimezone('UTC');
    }

    fetch('/api/members')
      .then((res) => res.json())
      .then((data) => {
        if (data.members && Array.isArray(data.members)) {
          setMembers(data.members);
          if (data.members.length > 0) {
            setSelectedMemberId(data.members[0].id);
          }
        }
      })
      .catch((err) => console.error('Failed to load roster:', err))
      .finally(() => setLoadingRoster(false));
  }, []);

  // Handler for New Fox (Join Den) Registration
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    triggerHaptic();
    setErrorMessage(null);
    setSuccessMessage(null);

    const cleanUsername = regUsername.trim().replace(/^@/, '');
    if (!cleanUsername || cleanUsername.length < 2) {
      setErrorMessage('Please enter a valid display name (at least 2 characters).');
      return;
    }

    const cleanJournal = regJournalUrl.trim();
    if (!cleanJournal || !DISCORD_JOURNAL_REGEX.test(cleanJournal)) {
      setErrorMessage(
        'Invalid Discord journal URL. Must match format: https://discord.com/channels/{server}/{thread}'
      );
      return;
    }

    const cleanPin = regPin.trim();
    if (!cleanPin || !/^\d{4,6}$/.test(cleanPin)) {
      setErrorMessage('Please create a 4-to-6 digit numeric PIN to protect your profile.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          discord_username: cleanUsername,
          journal_url: cleanJournal,
          bedtime_local: regBedtime.trim(),
          wake_time_local: '07:00',
          timezone: regTimezone.trim(),
          pin: cleanPin,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || 'Failed to create profile.');
        setSubmitting(false);
        return;
      }

      setStoredAuthToken(data.token);
      setStoredAuthMember(data.member);
      setSuccessMessage(data.message || 'Welcome to the Fox Den! Entering dashboard...');

      setTimeout(() => {
        router.replace('/');
      }, 600);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Registration failed.';
      setErrorMessage(msg);
      setSubmitting(false);
    }
  };

  // Handler for Returning Fox (PIN Login)
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    triggerHaptic();
    setErrorMessage(null);
    setSuccessMessage(null);

    const cleanPin = loginPin.trim();
    if (!cleanPin || cleanPin.length < 4) {
      setErrorMessage('Please enter your 4-to-6 digit PIN.');
      return;
    }

    const payload: { pin: string; member_id?: string; username?: string } = {
      pin: cleanPin,
    };

    if (loginMethod === 'username') {
      const cleanU = loginUsername.trim().replace(/^@/, '');
      if (!cleanU) {
        setErrorMessage('Please enter your Discord display name.');
        return;
      }
      payload.username = cleanU;
    } else {
      if (!selectedMemberId) {
        setErrorMessage('Please select your profile from the list.');
        return;
      }
      payload.member_id = selectedMemberId;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || 'Invalid PIN or credentials.');
        setSubmitting(false);
        return;
      }

      setStoredAuthToken(data.token);
      setStoredAuthMember(data.member);
      setSuccessMessage(data.message || 'Welcome back to the Fox Den!');

      setTimeout(() => {
        router.replace('/');
      }, 600);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Login failed.';
      setErrorMessage(msg);
      setSubmitting(false);
    }
  };

  const selectedMember = members.find((m) => m.id === selectedMemberId);
  const isProfileUnclaimed =
    loginMethod === 'select' &&
    selectedMember &&
    !(selectedMember.has_pin ?? Boolean(selectedMember.passcode_hash));

  return (
    <main className="min-h-[100dvh] bg-night-bg flex flex-col items-center justify-center px-4 py-8 sm:py-12 pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
      {/* Centered Brand Header with Sleepy Fox Mascot */}
      <div className="flex flex-col items-center text-center mb-6 animate-fade-in">
        <div className="rounded-2xl bg-night-surface p-3 border border-night-border shadow-lg">
          <FoxMascot state="logo" size={56} className="transition-transform hover:scale-105" />
        </div>
        <h1 className="mt-3 text-2xl sm:text-3xl font-bold tracking-tight text-cream-primary">
          Z Catchers
        </h1>
        <p className="mt-1 text-xs sm:text-sm text-[#A89F91] max-w-sm">
          Cross-timezone bedtime accountability for the Fox Den
        </p>
      </div>

      {/* Main Card Container */}
      <div className="w-full max-w-md mx-auto rounded-3xl border border-night-border bg-night-surface p-5 sm:p-7 shadow-2xl backdrop-blur-sm">
        {/* Two-Tab Switcher */}
        <div className="grid grid-cols-2 rounded-2xl bg-night-bg p-1 border border-night-border/80 mb-5">
          <button
            type="button"
            onClick={() => {
              triggerHaptic(10);
              setActiveTab('register');
              setErrorMessage(null);
            }}
            className={`flex items-center justify-center gap-1.5 rounded-xl py-3 text-xs font-semibold min-h-[44px] transition-all ${
              activeTab === 'register'
                ? 'bg-night-surface text-status-amber border border-night-border shadow-sm font-bold'
                : 'text-cream-muted hover:text-cream-secondary'
            }`}
          >
            <UserPlus className="h-4 w-4" />
            <span>New Fox (Join Den)</span>
          </button>
          <button
            type="button"
            onClick={() => {
              triggerHaptic(10);
              setActiveTab('login');
              setErrorMessage(null);
            }}
            className={`flex items-center justify-center gap-1.5 rounded-xl py-3 text-xs font-semibold min-h-[44px] transition-all ${
              activeTab === 'login'
                ? 'bg-night-surface text-status-amber border border-night-border shadow-sm font-bold'
                : 'text-cream-muted hover:text-cream-secondary'
            }`}
          >
            <KeyRound className="h-4 w-4" />
            <span>Returning Fox</span>
          </button>
        </div>

        {/* Feedback Messages */}
        {errorMessage && (
          <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-status-coral/40 bg-status-coral/10 p-3 text-xs text-status-coral leading-relaxed animate-fade-in">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        {successMessage && (
          <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-status-sage/40 bg-status-sage/10 p-3 text-xs text-status-sage leading-relaxed animate-fade-in">
            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Tab 1: New Fox (Join Den) Form */}
        {activeTab === 'register' ? (
          <form onSubmit={handleRegister} className="space-y-4">
            {/* Display Name */}
            <div>
              <label className="block text-xs font-semibold text-cream-primary mb-1">
                Display Name <span className="text-status-amber">*</span>
              </label>
              <input
                type="text"
                required
                value={regUsername}
                onChange={(e) => setRegUsername(e.target.value)}
                placeholder="e.g. Alex"
                className="w-full rounded-xl border border-night-border bg-night-bg px-3.5 py-3 text-base text-cream-primary focus:border-status-amber focus:outline-none placeholder:text-cream-muted/50 min-h-[44px]"
                autoCapitalize="none"
                autoCorrect="off"
              />
            </div>

            {/* Target Bedtime */}
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
                  className="w-full rounded-xl border border-night-border bg-night-bg px-3 py-2.5 text-base text-cream-primary focus:border-status-amber focus:outline-none text-center font-semibold min-h-[44px]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-cream-primary mb-1">
                  Wake Time (24h)
                </label>
                <input
                  type="time"
                  disabled
                  value="07:00"
                  className="w-full rounded-xl border border-night-border bg-night-bg/60 px-3 py-2.5 text-base text-cream-muted focus:outline-none text-center font-medium min-h-[44px]"
                />
              </div>
            </div>

            {/* Auto-detected IANA Timezone */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-cream-primary">
                  IANA Timezone <span className="text-status-amber">*</span>
                </label>
                <span className="text-[10px] text-[#A89F91]">
                  Detected: {detectedIana}
                </span>
              </div>
              <select
                value={regTimezone}
                onChange={(e) => setRegTimezone(e.target.value)}
                className="w-full appearance-none rounded-xl border border-night-border bg-night-bg px-3.5 py-3 text-base text-cream-primary focus:border-status-amber focus:outline-none min-h-[44px]"
              >
                {!COMMON_IANA_TIMEZONES.includes(regTimezone as any) && (
                  <option value={regTimezone}>
                    {regTimezone} ({formatGmtOffset(regTimezone)})
                  </option>
                )}
                {COMMON_IANA_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz} ({formatGmtOffset(tz)})
                  </option>
                ))}
              </select>
            </div>

            {/* Discord Journal Thread URL */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-cream-primary">
                  Discord Journal Thread URL <span className="text-status-amber">*</span>
                </label>
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(10);
                    setRegJournalUrl('https://discord.com/channels/123456789/987654321');
                  }}
                  className="text-[11px] text-status-amber hover:underline min-h-[36px] flex items-center"
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
                className="w-full rounded-xl border border-night-border bg-night-bg px-3.5 py-3 text-base text-cream-primary focus:border-status-amber focus:outline-none placeholder:text-cream-muted/50 font-mono text-xs min-h-[44px]"
              />
              <p className="mt-1 text-[11px] text-[#A89F91]">
                Community friends click this link to nag you off screens when your bedtime hits.
              </p>
            </div>

            {/* 4-digit PIN */}
            <div>
              <label className="block text-xs font-semibold text-cream-primary mb-1">
                4-Digit Security PIN <span className="text-status-amber">*</span>
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
                className="w-full tracking-widest text-center text-xl font-bold rounded-xl border border-night-border bg-night-bg px-3 py-2.5 text-cream-primary focus:border-status-amber focus:outline-none placeholder:text-cream-muted/40 min-h-[44px]"
              />
              <p className="mt-1 text-[10px] text-[#A89F91] text-center">
                Remember this PIN to log in across your devices and adjust your bedtime schedule.
              </p>
            </div>

            {/* Submit Button */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={submitting}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-status-amber py-3.5 text-xs font-bold text-night-bg shadow-lg hover:bg-status-amber/90 transition-all disabled:opacity-50 active:scale-95 min-h-[48px]"
              >
                <Sparkles className="h-4 w-4" />
                <span>{submitting ? 'Creating Profile...' : 'Join Fox Den & Enter Dashboard'}</span>
              </button>
            </div>
          </form>
        ) : (
          /* Tab 2: Returning Fox (PIN Login) Form */
          <form onSubmit={handleLogin} className="space-y-4">
            {/* Toggle Login Method: Dropdown vs Username */}
            {members.length > 0 && (
              <div className="flex items-center justify-between text-xs text-cream-muted mb-1">
                <span>Select login method:</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic(10);
                      setLoginMethod('select');
                    }}
                    className={`underline hover:text-cream-primary transition-colors min-h-[36px] flex items-center ${
                      loginMethod === 'select' ? 'text-status-amber font-semibold' : ''
                    }`}
                  >
                    From Den List
                  </button>
                  <span className="flex items-center">•</span>
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic(10);
                      setLoginMethod('username');
                    }}
                    className={`underline hover:text-cream-primary transition-colors min-h-[36px] flex items-center ${
                      loginMethod === 'username' ? 'text-status-amber font-semibold' : ''
                    }`}
                  >
                    Type Name
                  </button>
                </div>
              </div>
            )}

            {loginMethod === 'select' && members.length > 0 ? (
              <div>
                <label className="block text-xs font-semibold text-cream-primary mb-1">
                  Select Your Profile
                </label>
                <select
                  value={selectedMemberId}
                  onChange={(e) => {
                    setSelectedMemberId(e.target.value);
                    setErrorMessage(null);
                  }}
                  className="w-full appearance-none rounded-xl border border-night-border bg-night-bg px-3.5 py-3 text-base text-cream-primary focus:border-status-amber focus:outline-none min-h-[44px]"
                >
                  {members.map((m) => (
                    <option key={m.id} value={m.id} className="bg-night-surface">
                      {m.discord_username} ({m.bedtime_local} • {formatGmtOffset(m.timezone)})
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-semibold text-cream-primary mb-1">
                  Discord Display Name
                </label>
                <input
                  type="text"
                  value={loginUsername}
                  onChange={(e) => setLoginUsername(e.target.value)}
                  placeholder="e.g. Alex"
                  className="w-full rounded-xl border border-night-border bg-night-bg px-3.5 py-3 text-base text-cream-primary focus:border-status-amber focus:outline-none placeholder:text-cream-muted/50 min-h-[44px]"
                  autoCapitalize="none"
                  autoCorrect="off"
                />
              </div>
            )}

            {isProfileUnclaimed && (
              <div className="rounded-xl border border-status-amber/40 bg-status-amber/10 p-3 text-xs text-status-amber flex items-start gap-2">
                <Sparkles className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Unclaimed Profile!</p>
                  <p className="text-[11px] opacity-90 mt-0.5">
                    Choose a new 4-digit PIN below to claim this profile on your device.
                  </p>
                </div>
              </div>
            )}

            {/* 4-digit PIN Input */}
            <div>
              <label className="block text-xs font-semibold text-cream-primary mb-1">
                {isProfileUnclaimed ? 'Create 4-Digit PIN' : 'Enter 4-Digit PIN'}
              </label>
              <input
                type="password"
                required
                maxLength={6}
                inputMode="numeric"
                pattern="[0-9]*"
                value={loginPin}
                onChange={(e) => setLoginPin(e.target.value.replace(/\D/g, ''))}
                placeholder="••••"
                className="w-full tracking-widest text-center text-xl font-bold rounded-xl border border-night-border bg-night-bg px-3.5 py-2.5 text-cream-primary focus:border-status-amber focus:outline-none placeholder:text-cream-muted/40 min-h-[44px]"
              />
            </div>

            {/* Submit Button */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={submitting}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-status-amber py-3.5 text-xs font-bold text-night-bg shadow-lg hover:bg-status-amber/90 transition-all disabled:opacity-50 active:scale-95 min-h-[48px]"
              >
                <Lock className="h-4 w-4" />
                <span>
                  {submitting
                    ? 'Authenticating...'
                    : isProfileUnclaimed
                    ? 'Claim Profile & Enter Den'
                    : 'Log In with PIN'}
                </span>
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
