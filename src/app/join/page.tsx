'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FoxMascot } from '@/components/FoxMascot';
import type { Member } from '@/lib/db';
import { COMMON_IANA_TIMEZONES, GMT_OFFSETS, formatGmtOffset } from '@/lib/timezone';
import { TimezoneSelect } from '@/components/TimezoneSelect';
import {
  setStoredAuthToken,
  setStoredAuthMember,
  getStoredAuthMember,
  getStoredAuthToken,
} from '@/lib/pushClient';
import {
  Sparkles,
  UserPlus,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Shield,
  Moon,
  ArrowRight,
  UserCheck,
  RefreshCw,
} from 'lucide-react';

const DISCORD_JOURNAL_REGEX = /^https:\/\/(ptb\.|canary\.)?discord\.com\/channels\/\d+\/\d+(\/\d+)?$/;

function DiscordIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.893.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

interface DiscordProfileDetails {
  id: string;
  username: string;
  avatarUrl: string | null;
  isModerator: boolean;
  suggestedMemberId: string | null;
}

function JoinPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const urlClaimToken = searchParams.get('claim_token');
  const urlError = searchParams.get('error');

  // Claim Mode State
  const [claimToken, setClaimToken] = useState<string | null>(urlClaimToken);
  const [discordUser, setDiscordUser] = useState<DiscordProfileDetails | null>(null);
  const [unclaimedMembers, setUnclaimedMembers] = useState<Member[]>([]);
  const [loadingClaim, setLoadingClaim] = useState<boolean>(Boolean(urlClaimToken));

  // 1-Step Claim/Setup Choice: 'claim' | 'new'
  const [claimOption, setClaimOption] = useState<'claim' | 'new'>('claim');
  const [selectedTargetId, setSelectedTargetId] = useState<string>('');
  const [claimPin, setClaimPin] = useState<string>('');
  const [claimModPasscode, setClaimModPasscode] = useState<string>('');

  // New Profile Form State
  const [regUsername, setRegUsername] = useState('');
  const [regJournalUrl, setRegJournalUrl] = useState('');
  const [regBedtime, setRegBedtime] = useState('23:00');
  const [regWakeTime, setRegWakeTime] = useState('07:00');
  const [regTimezone, setRegTimezone] = useState('UTC');
  const [enableWeekend, setEnableWeekend] = useState(false);
  const [weekendBedtime, setWeekendBedtime] = useState('00:00');
  const [weekendWakeTime, setWeekendWakeTime] = useState('08:30');

  // Status & Feedback
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(urlError || null);
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

  // Route Guard: If already authenticated and not claiming, redirect to dashboard
  useEffect(() => {
    if (claimToken) return;

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
  }, [router, claimToken]);

  // Auto-detect viewer timezone
  useEffect(() => {
    try {
      const iana = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      setRegTimezone(iana);
    } catch {
      setRegTimezone('UTC');
    }
  }, []);

  // Fetch claim details if claimToken is present
  useEffect(() => {
    if (!claimToken) return;

    setLoadingClaim(true);
    fetch(`/api/auth/claim-profile?claim_token=${encodeURIComponent(claimToken)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.valid && data.discordUser) {
          setDiscordUser(data.discordUser);
          setRegUsername(data.discordUser.username || '');
          setUnclaimedMembers(data.unclaimedMembers || []);

          if (data.unclaimedMembers && data.unclaimedMembers.length > 0) {
            const initialId = data.discordUser.suggestedMemberId || data.unclaimedMembers[0].id;
            setSelectedTargetId(initialId);
            setClaimOption('claim');
          } else {
            setClaimOption('new');
          }
        } else {
          setErrorMessage(data.error || 'Invalid or expired claim token. Please log in with Discord again.');
          setClaimToken(null);
        }
      })
      .catch((err) => {
        console.error('Failed to resolve claim token:', err);
        setErrorMessage('Network error resolving Discord claim session.');
        setClaimToken(null);
      })
      .finally(() => setLoadingClaim(false));
  }, [claimToken]);

  // Handler for Claim Profile submission
  const handleClaimSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    triggerHaptic(20);
    setErrorMessage(null);
    setSuccessMessage(null);

    if (claimOption === 'claim') {
      if (!selectedTargetId) {
        setErrorMessage('Please select a member profile from the list to claim.');
        return;
      }

      const targetMember = unclaimedMembers.find((m) => m.id === selectedTargetId);
      const isTargetMod = Boolean(targetMember?.is_moderator || targetMember?.role === 'moderator');

      if (targetMember?.has_pin && (!claimPin || claimPin.length < 4)) {
        setErrorMessage('Please enter the 4-digit PIN to claim this profile.');
        return;
      }

      if (isTargetMod && !discordUser?.isModerator && !claimModPasscode.trim()) {
        setErrorMessage('Claiming an unlinked moderator profile requires the master moderator passcode.');
        return;
      }

      setSubmitting(true);
      try {
        const res = await fetch('/api/auth/claim-profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            claim_token: claimToken,
            option: 'claim',
            target_member_id: selectedTargetId,
            pin: claimPin.trim() || undefined,
            mod_passcode: claimModPasscode.trim() || undefined,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          setErrorMessage(data.error || 'Failed to claim profile.');
          setSubmitting(false);
          return;
        }

        if (data.token) setStoredAuthToken(data.token);
        if (data.member) setStoredAuthMember(data.member);
        setSuccessMessage(data.message || 'Profile claimed successfully! Entering dashboard...');

        setTimeout(() => {
          router.replace('/');
        }, 600);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Claiming failed.';
        setErrorMessage(msg);
        setSubmitting(false);
      }
      return;
    }

    // Option: 'new'
    const cleanUsername = regUsername.trim();
    if (!cleanUsername || cleanUsername.length < 2) {
      setErrorMessage('Please enter a display name (at least 2 characters).');
      return;
    }

    const cleanJournal = regJournalUrl.trim();
    if (!cleanJournal || !DISCORD_JOURNAL_REGEX.test(cleanJournal)) {
      setErrorMessage(
        'Invalid Discord journal URL. Must match format: https://discord.com/channels/{server}/{thread}'
      );
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/claim-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          claim_token: claimToken,
          option: 'new',
          discord_username: cleanUsername,
          journal_url: cleanJournal,
          bedtime_local: regBedtime.trim(),
          wake_time_local: regWakeTime.trim(),
          timezone: regTimezone.trim(),
          weekend_bedtime_local: enableWeekend ? weekendBedtime.trim() : null,
          weekend_wake_time_local: enableWeekend ? weekendWakeTime.trim() : null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || 'Failed to create profile.');
        setSubmitting(false);
        return;
      }

      if (data.token) setStoredAuthToken(data.token);
      if (data.member) setStoredAuthMember(data.member);
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

  return (
    <main className="min-h-[100dvh] bg-night-bg flex flex-col items-center justify-center px-4 py-8 sm:py-12 pt-[calc(2rem+env(safe-area-inset-top,0px))] pb-[calc(2.5rem+env(safe-area-inset-bottom,0px))]">
      {/* Brand Header with Sleepy Fox Mascot */}
      <div className="flex flex-col items-center text-center mb-6 animate-fade-in">
        <FoxMascot state="logo" size={56} className="mb-3 drop-shadow-lg" />
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-cream-primary">
          Z Catchers
        </h1>
        <p className="text-xs sm:text-sm text-cream-secondary mt-1 max-w-sm">
          Cross-timezone bedtime accountability for the Fox Den 🦊💤
        </p>
      </div>

      {/* Main Card Container */}
      <div className="w-full max-w-md bg-night-surface border border-night-border rounded-2xl shadow-2xl p-6 sm:p-7 relative overflow-hidden">
        {/* Subtle Warm Amber Glow Behind Mascot */}
        <div className="absolute -top-16 -right-16 w-32 h-32 bg-status-amber/10 rounded-full blur-2xl pointer-events-none" />

        {/* Global Error Notice */}
        {errorMessage && (
          <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-status-coral/40 bg-status-coral/10 p-3.5 text-xs text-status-coral">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <div className="leading-relaxed">{errorMessage}</div>
          </div>
        )}

        {/* Global Success Notice */}
        {successMessage && (
          <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-status-sage/40 bg-status-sage/10 p-3.5 text-xs text-status-sage">
            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
            <div className="leading-relaxed">{successMessage}</div>
          </div>
        )}

        {/* Loading State when resolving claim token */}
        {loadingClaim ? (
          <div className="py-12 flex flex-col items-center justify-center text-center gap-3">
            <RefreshCw className="h-7 w-7 text-status-amber animate-spin" />
            <p className="text-xs text-cream-secondary">Connecting with Discord...</p>
          </div>
        ) : claimToken && discordUser ? (
          /* ========================================================================= */
          /* 1-Step Claim & Setup Screen (Only on First Discord Login)                */
          /* ========================================================================= */
          <div className="space-y-5 animate-fade-in">
            {/* Authenticated Discord User Badge */}
            <div className="flex items-center gap-3 p-3.5 rounded-xl border border-night-border bg-night-elevated">
              {discordUser.avatarUrl ? (
                <img
                  src={discordUser.avatarUrl}
                  alt={discordUser.username}
                  className="w-11 h-11 rounded-full object-cover border border-status-amber/40"
                />
              ) : (
                <div className="w-11 h-11 rounded-full bg-status-amber/20 border border-status-amber/40 flex items-center justify-center text-status-amber font-bold">
                  {discordUser.username.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-sm text-cream-primary truncate">
                    {discordUser.username}
                  </span>
                  {discordUser.isModerator && (
                    <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-status-amber/20 text-status-amber border border-status-amber/40">
                      Mod
                    </span>
                  )}
                </div>
                <span className="text-xs text-cream-secondary flex items-center gap-1">
                  <DiscordIcon className="w-3.5 h-3.5 text-status-amber" />
                  Connected via Discord
                </span>
              </div>
            </div>

            {/* Option Tabs: Claim Existing vs. New Profile */}
            <div className="flex border-b border-night-border pb-2 gap-4 text-xs font-semibold">
              {unclaimedMembers.length > 0 && (
                <button
                  type="button"
                  onClick={() => setClaimOption('claim')}
                  className={`pb-1 transition-all ${
                    claimOption === 'claim'
                      ? 'border-b-2 border-status-amber text-status-amber'
                      : 'text-cream-muted hover:text-cream-secondary'
                  }`}
                >
                  Claim Existing Profile ({unclaimedMembers.length})
                </button>
              )}
              <button
                type="button"
                onClick={() => setClaimOption('new')}
                className={`pb-1 transition-all ${
                  claimOption === 'new'
                    ? 'border-b-2 border-status-amber text-status-amber'
                    : 'text-cream-muted hover:text-cream-secondary'
                }`}
              >
                Create New Member Profile
              </button>
            </div>

            <form onSubmit={handleClaimSubmit} className="space-y-4">
              {claimOption === 'claim' && unclaimedMembers.length > 0 ? (
                /* Mode A: Select Unclaimed Profile */
                <div className="space-y-3">
                  <p className="text-xs text-cream-secondary leading-relaxed">
                    Select your existing Z Catchers profile to link your Discord account. This preserves your current bedtime schedule, journal link, and sleep streak!
                  </p>

                  <div>
                    <label className="block text-xs font-medium text-cream-secondary mb-1.5">
                      Select Your Unclaimed Profile
                    </label>
                    <select
                      value={selectedTargetId}
                      onChange={(e) => {
                        setSelectedTargetId(e.target.value);
                        setClaimPin('');
                        setClaimModPasscode('');
                      }}
                      className="w-full rounded-xl border border-night-border bg-night-elevated px-3 py-2.5 text-cream-primary text-sm focus:border-status-amber focus:outline-none"
                    >
                      {unclaimedMembers.map((m) => (
                        <option key={m.id} value={m.id}>
                          @{m.discord_username} — Bedtime {m.bedtime_local} ({m.timezone}){m.has_pin ? ' 🔒 (PIN Protected)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  {unclaimedMembers.find((m) => m.id === selectedTargetId)?.has_pin && (
                    <div>
                      <label htmlFor="claim-profile-pin" className="block text-xs font-medium text-cream-secondary mb-1">
                        Profile PIN <span className="text-status-amber">*</span>
                      </label>
                      <input
                        id="claim-profile-pin"
                        type="password"
                        inputMode="numeric"
                        maxLength={6}
                        required
                        placeholder="Enter 4-digit PIN"
                        value={claimPin}
                        onChange={(e) => setClaimPin(e.target.value.replace(/\D/g, ''))}
                        className="w-full rounded-xl border border-night-border bg-night-elevated px-3 py-2 text-cream-primary text-sm focus:border-status-amber focus:outline-none"
                      />
                      <p className="text-[11px] text-cream-muted mt-1">
                        This profile is protected with a legacy PIN. Enter the PIN to verify ownership.
                      </p>
                    </div>
                  )}

                  {Boolean(
                    (unclaimedMembers.find((m) => m.id === selectedTargetId)?.is_moderator ||
                      unclaimedMembers.find((m) => m.id === selectedTargetId)?.role === 'moderator') &&
                      !discordUser?.isModerator
                  ) && (
                    <div>
                      <label htmlFor="claim-mod-passcode" className="block text-xs font-medium text-cream-secondary mb-1">
                        Master Moderator Passcode <span className="text-status-amber">*</span>
                      </label>
                      <input
                        id="claim-mod-passcode"
                        type="password"
                        required
                        placeholder="Enter master moderator passcode"
                        value={claimModPasscode}
                        onChange={(e) => setClaimModPasscode(e.target.value)}
                        className="w-full rounded-xl border border-night-border bg-night-elevated px-3 py-2 text-cream-primary text-sm focus:border-status-amber focus:outline-none"
                      />
                      <p className="text-[11px] text-cream-muted mt-1">
                        Claiming an unlinked moderator profile requires the master moderator secret passcode if not pre-authorized.
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                /* Mode B: Configure New Schedule */
                <div className="space-y-3.5">
                  <div>
                    <label className="block text-xs font-medium text-cream-secondary mb-1">
                      Display Name
                    </label>
                    <input
                      type="text"
                      value={regUsername}
                      onChange={(e) => setRegUsername(e.target.value)}
                      placeholder="e.g. Alex"
                      className="w-full rounded-xl border border-night-border bg-night-elevated px-3 py-2 text-cream-primary text-sm focus:border-status-amber focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-cream-secondary mb-1">
                      Discord Journal Thread URL
                    </label>
                    <input
                      type="url"
                      value={regJournalUrl}
                      onChange={(e) => setRegJournalUrl(e.target.value)}
                      placeholder="https://discord.com/channels/..."
                      className="w-full rounded-xl border border-night-border bg-night-elevated px-3 py-2 text-cream-primary text-sm focus:border-status-amber focus:outline-none"
                    />
                    <p className="text-[11px] text-cream-muted mt-1">
                      Right-click your journal thread in Discord and select <strong>Copy Link</strong>.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-cream-secondary mb-1">
                        Bedtime (24h)
                      </label>
                      <input
                        type="time"
                        value={regBedtime}
                        onChange={(e) => setRegBedtime(e.target.value)}
                        className="w-full rounded-xl border border-night-border bg-night-elevated px-3 py-2 text-cream-primary text-sm focus:border-status-amber focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-cream-secondary mb-1">
                        Wake Time (24h)
                      </label>
                      <input
                        type="time"
                        value={regWakeTime}
                        onChange={(e) => setRegWakeTime(e.target.value)}
                        className="w-full rounded-xl border border-night-border bg-night-elevated px-3 py-2 text-cream-primary text-sm focus:border-status-amber focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-cream-secondary mb-1">
                      Your Local Timezone
                    </label>
                    <TimezoneSelect
                      value={regTimezone}
                      onChange={setRegTimezone}
                      selectClassName="w-full rounded-xl border border-night-border bg-night-elevated px-3 py-2 text-cream-primary text-sm focus:border-status-amber focus:outline-none"
                    />
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-[48px] rounded-xl bg-status-amber hover:bg-status-amber/90 text-night-bg font-semibold text-sm flex items-center justify-center gap-2 shadow-lg shadow-status-amber/15 transition-all mt-4"
              >
                {submitting ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>Saving Profile...</span>
                  </>
                ) : (
                  <>
                    <UserCheck className="h-4 w-4" />
                    <span>{claimOption === 'claim' ? 'Claim Profile & Enter Den' : 'Join Den & Save Schedule'}</span>
                  </>
                )}
              </button>
            </form>
          </div>
        ) : (
          /* ========================================================================= */
          /* Default Welcome / Sign In with Discord Screen                             */
          /* ========================================================================= */
          <div className="space-y-6 text-center animate-fade-in">
            <div className="space-y-2">
              <h2 className="text-base font-semibold text-cream-primary">
                Welcome to the Den
              </h2>
              <p className="text-xs text-cream-secondary leading-relaxed">
                Connect your Discord account to see your friends' bedtimes converted into your local timezone and receive quiet Sleep Shield alerts.
              </p>
            </div>

            {/* Feature Highlights */}
            <div className="grid grid-cols-1 gap-2.5 text-left text-xs text-cream-secondary">
              <div className="flex items-center gap-2.5 p-2.5 rounded-xl border border-night-border bg-night-elevated">
                <Clock className="w-4 h-4 text-status-amber shrink-0" />
                <span>Auto-converts all bedtimes to your local time</span>
              </div>
              <div className="flex items-center gap-2.5 p-2.5 rounded-xl border border-night-border bg-night-elevated">
                <Moon className="w-4 h-4 text-status-slumber shrink-0" />
                <span>Sleep Shield strictly mutes late-night nag spam</span>
              </div>
              <div className="flex items-center gap-2.5 p-2.5 rounded-xl border border-night-border bg-night-elevated">
                <Shield className="w-4 h-4 text-fox-rust shrink-0" />
                <span>48-hour cooldown stops bedtime dodging</span>
              </div>
            </div>

            {/* Primary Discord OAuth Action Button */}
            <a
              href="/api/auth/discord"
              onClick={() => triggerHaptic(20)}
              className="w-full min-h-[50px] bg-[#5865F2] hover:bg-[#4752C4] text-white font-semibold rounded-xl flex items-center justify-center gap-2.5 px-6 shadow-lg shadow-[#5865F2]/25 transition-all hover:scale-[1.01] active:scale-[0.98]"
            >
              <DiscordIcon className="w-5 h-5 shrink-0" />
              <span>Continue with Discord</span>
            </a>

            <p className="text-[11px] text-cream-muted leading-tight">
              Requires only basic Discord <code>identify</code> scope to display your avatar and name. Zero passwords or PINs required.
            </p>
          </div>
        )}
      </div>

      {/* Footer Branding Note */}
      <div className="mt-6 text-center text-xs text-cream-muted flex items-center gap-1.5">
        <span>Z Catchers</span>
        <span>•</span>
        <span>Warm Dark Mobile PWA</span>
        <span>•</span>
        <span>Sleepy Fox 🦊</span>
      </div>
    </main>
  );
}

export default function JoinPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-[100dvh] bg-night-bg flex items-center justify-center">
          <RefreshCw className="h-6 w-6 text-status-amber animate-spin" />
        </main>
      }
    >
      <JoinPageContent />
    </Suspense>
  );
}
