'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { FoxMascot } from './FoxMascot';
import { Member } from '@/lib/db';
import { DateTime } from 'luxon';
import {
  X,
  Lock,
  Unlock,
  Clock,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  Sparkles,
  Shield,
  UserCheck,
  UserPlus,
  RefreshCw,
  Moon,
  LogOut,
  ArrowRight,
} from 'lucide-react';

import { setStoredMemberId, setStoredAuthToken, setStoredAuthMember } from '@/lib/pushClient';
import { COMMON_IANA_TIMEZONES, GMT_OFFSETS, formatGmtOffset, toValidLuxonZone } from '@/lib/timezone';

const DISCORD_JOURNAL_REGEX = /^https:\/\/(ptb\.|canary\.)?discord\.com\/channels\/\d+\/\d+(\/\d+)?$/;

interface MyScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  members: Member[];
  viewerTimezone: string;
  onRefreshRoster: () => Promise<void>;
  currentUser?: Member | null;
  onLogout?: () => void;
}

/**
 * Modal dialog enabling members to update bedtime/wake schedules, manage pending 48-hour changes,
 * view active cooldowns, or log out of their session.
 *
 * @param props - Modal properties including members roster, timezone, and callbacks
 * @returns React JSX modal dialog element
 */
export function MyScheduleModal({
  isOpen,
  onClose,
  members,
  viewerTimezone,
  onRefreshRoster,
  currentUser,
  onLogout,
}: MyScheduleModalProps) {
  const [tab, setTab] = useState<'claim' | 'new'>('claim');

  // Selected existing member ID
  const [selectedMemberId, setSelectedMemberId] = useState<string>('');
  const [pin, setPin] = useState<string>('');
  const [isUnlocked, setIsUnlocked] = useState<boolean>(false);

  // Form fields for editing
  const [username, setUsername] = useState<string>('');
  const [handle, setHandle] = useState<string>('');
  const [journalUrl, setJournalUrl] = useState<string>('');
  const [bedtime, setBedtime] = useState<string>('23:00');
  const [wakeTime, setWakeTime] = useState<string>('07:00');
  const [timezone, setTimezone] = useState<string>(viewerTimezone);

  // Weekend hours (Friday & Saturday nights)
  const [enableWeekendHours, setEnableWeekendHours] = useState<boolean>(false);
  const [weekendBedtime, setWeekendBedtime] = useState<string>('00:30');
  const [weekendWakeTime, setWeekendWakeTime] = useState<string>('09:00');

  // New member specific fields
  const [newMemberPin, setNewMemberPin] = useState<string>('');

  // UI state
  const [loading, setLoading] = useState<boolean>(false);
  const [cancelLoading, setCancelLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Active selected member object
  const activeMember = useMemo(
    () => members.find((m) => m.id === selectedMemberId),
    [members, selectedMemberId]
  );
  const isOwner = Boolean(currentUser && activeMember && currentUser.id === activeMember.id);

  // Sync selected member data into form fields when selected or modal opens
  useEffect(() => {
    if (!isOpen) return;

    if (activeMember) {
      setUsername(activeMember.discord_username);
      const rawHandle =
        activeMember.discord_handle ||
        (activeMember.discord_username
          ? `@${activeMember.discord_username.toLowerCase().replace(/\s+/g, '')}`
          : '');
      setHandle(rawHandle ? (rawHandle.startsWith('@') ? rawHandle : `@${rawHandle}`) : '');
      setJournalUrl(activeMember.journal_url);
      setBedtime(activeMember.bedtime_local);
      setWakeTime(activeMember.wake_time_local);
      setTimezone(activeMember.timezone);
      if (activeMember.weekend_bedtime_local) {
        setEnableWeekendHours(true);
        setWeekendBedtime(activeMember.weekend_bedtime_local);
        setWeekendWakeTime(activeMember.weekend_wake_time_local || '09:00');
      } else {
        setEnableWeekendHours(false);
        setWeekendBedtime('00:30');
        setWeekendWakeTime('09:00');
      }
      setErrorMessage(null);
      setSuccessMessage(null);
      setPin('');
      // If member has no PIN, auto-unlock so they can set initial PIN
      const isOwner = Boolean(currentUser && activeMember && currentUser.id === activeMember.id);
      const isClaimed = Boolean(activeMember.has_pin ?? activeMember.passcode_hash);
      setIsUnlocked(isOwner || !isClaimed);
    } else if (currentUser) {
      setSelectedMemberId(currentUser.id);
    } else if (members.length > 0 && !selectedMemberId && tab === 'claim') {
      setSelectedMemberId(members[0].id);
    }
  }, [isOpen, activeMember, members, selectedMemberId, tab, currentUser]);

  // Reset states when modal is opened/closed
  useEffect(() => {
    if (isOpen) {
      setErrorMessage(null);
      setSuccessMessage(null);
      if (currentUser) {
        setSelectedMemberId(currentUser.id);
      } else if (members.length > 0 && !selectedMemberId) {
        setSelectedMemberId(members[0].id);
      }
    } else {
      setIsUnlocked(false);
      setPin('');
      setNewMemberPin('');
    }
  }, [isOpen, members, selectedMemberId, currentUser]);

  // Check if pending cooldown is currently active on selected member
  const pendingCooldownNotice = useMemo(() => {
    if (!activeMember || !activeMember.pending_effective_at) return null;
    const now = DateTime.utc();
    const effectiveAt = DateTime.fromISO(activeMember.pending_effective_at, { zone: 'utc' });
    if (now >= effectiveAt) return null;

    const remainingHours = Math.max(0, Math.floor(effectiveAt.diff(now, 'hours').hours));
    const remainingMins = Math.max(0, Math.floor(effectiveAt.diff(now, 'minutes').minutes % 60));

    return {
      pendingBedtime: activeMember.pending_bedtime_local,
      pendingWeekendBedtime: activeMember.pending_weekend_bedtime_local,
      pendingTimezone: activeMember.pending_timezone,
      remainingHours,
      remainingMins,
      effectiveDate: effectiveAt.setZone(toValidLuxonZone(viewerTimezone)).toFormat('LLL d, h:mm a'),
    };
  }, [activeMember, viewerTimezone]);

  // Preview bedtime converted to viewer timezone
  const previewTime = useMemo(() => {
    try {
      const [h, m] = bedtime.split(':').map(Number);
      const nowInTz = DateTime.now().setZone(toValidLuxonZone(timezone));
      const dt = nowInTz.set({ hour: h || 0, minute: m || 0, second: 0 });
      return {
        sleeper: dt.toFormat('h:mm a'),
        viewer: dt.setZone(toValidLuxonZone(viewerTimezone)).toFormat('h:mm a'),
      };
    } catch {
      return { sleeper: bedtime, viewer: bedtime };
    }
  }, [bedtime, timezone, viewerTimezone]);

  if (!isOpen) return null;

  // Validate journal URL
  const isJournalValid = journalUrl.trim() === '' || DISCORD_JOURNAL_REGEX.test(journalUrl.trim());

  // Check if schedule (bedtime, wake time, timezone, weekend hours) has changed from active values
  const hasScheduleChanged = activeMember
    ? bedtime !== activeMember.bedtime_local ||
      timezone !== activeMember.timezone ||
      wakeTime !== activeMember.wake_time_local ||
      (enableWeekendHours
        ? weekendBedtime !== (activeMember.weekend_bedtime_local || '') ||
          weekendWakeTime !== (activeMember.weekend_wake_time_local || '')
        : Boolean(activeMember.weekend_bedtime_local))
    : false;

  // Handle PIN Unlock
  const handleUnlockProfile = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!pin || pin.length < 4) {
      setErrorMessage('Please enter your 4-digit PIN.');
      return;
    }

    // Client-side quick check: will be strictly verified on server during submit
    if (selectedMemberId) {
      setStoredMemberId(selectedMemberId);
    }
    setIsUnlocked(true);
  };

  // Handle Schedule & Profile Update Submission
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!isJournalValid || !journalUrl.trim()) {
      setErrorMessage(
        'Please enter a valid Discord Journal Thread URL: https://discord.com/channels/{guild}/{thread}'
      );
      return;
    }

    if (!username.trim()) {
      setErrorMessage('Please enter your Discord display name.');
      return;
    }

    const isOwner = Boolean(currentUser && activeMember && currentUser.id === activeMember.id);
    const isClaimed = Boolean(activeMember?.has_pin ?? activeMember?.passcode_hash);
    if (!isOwner && !isClaimed && (!pin || pin.length < 4)) {
      setErrorMessage('Please create a 4-digit PIN to claim and secure your profile.');
      return;
    }
    if (!isOwner && isClaimed && (!pin || pin.length < 4)) {
      setErrorMessage('Please enter your 4-digit PIN to verify profile edits.');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/members/update-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          member_id: activeMember?.id,
          pin: pin.trim() || undefined,
          discord_username: username.trim(),
          discord_handle: handle.trim() || null,
          journal_url: journalUrl.trim(),
          bedtime_local: bedtime.trim(),
          wake_time_local: wakeTime.trim(),
          timezone: timezone.trim(),
          weekend_bedtime_local: enableWeekendHours ? weekendBedtime.trim() : null,
          weekend_wake_time_local: enableWeekendHours ? weekendWakeTime.trim() : null,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrorMessage(data.error || 'Failed to update schedule.');
        if (res.status === 401) {
          setIsUnlocked(false);
        }
        return;
      }

      setSuccessMessage(data.message);
      if (activeMember?.id) {
        setStoredMemberId(activeMember.id);
      }
      await onRefreshRoster();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network error';
      setErrorMessage(msg);
    } finally {
      setLoading(false);
    }
  };

  // Handle Cancel Pending Cooldown
  const handleCancelPending = async () => {
    if (!activeMember) return;
    setCancelLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/members/cancel-pending', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          member_id: activeMember.id,
          pin: pin.trim() || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrorMessage(data.error || 'Failed to cancel pending schedule change.');
        return;
      }

      setSuccessMessage(data.message);
      if (activeMember?.id) {
        setStoredMemberId(activeMember.id);
      }
      await onRefreshRoster();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network error';
      setErrorMessage(msg);
    } finally {
      setCancelLoading(false);
    }
  };



  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-night-bg/85 backdrop-blur-md p-0 md:items-center md:p-4">
      <div
        className="relative flex w-full max-w-lg flex-col rounded-t-3xl border-t border-night-border bg-night-surface p-5 shadow-2xl max-h-[90dvh] overflow-y-auto md:rounded-2xl md:border md:p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] md:pb-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-schedule-title"
      >
        {/* Mobile handle indicator */}
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-night-border md:hidden shrink-0" />

        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-night-border pb-4">
          <div className="flex items-center gap-3">
            <FoxMascot state="lantern" size={32} />
            <div>
              <h2
                id="modal-schedule-title"
                className="text-base font-bold text-cream-primary sm:text-lg"
              >
                My Profile &amp; Schedule
              </h2>
              <p className="text-xs text-cream-secondary">
                Accountability settings, sleep schedule &amp; website profile
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {currentUser && onLogout && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onLogout();
                }}
                title={`Log out of @${currentUser.discord_username}`}
                className="flex items-center gap-1.5 rounded-xl border border-night-border bg-night-surface px-2.5 sm:px-3 py-1.5 text-xs font-medium text-cream-muted hover:border-status-coral/40 hover:bg-status-coral/10 hover:text-status-coral transition-colors min-h-[44px]"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Log Out</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="rounded-xl p-2 text-cream-muted transition-colors hover:bg-night-elevated hover:text-cream-primary min-h-[44px] min-w-[44px] flex items-center justify-center"
              aria-label="Close modal"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Navigation Tabs: Edit Existing vs Join Roster */}
        <div className="mt-4 flex rounded-xl bg-night-elevated p-1">
          <button
            type="button"
            onClick={() => {
              setTab('claim');
              setErrorMessage(null);
            }}
            className={`flex-1 flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition-all ${
              tab === 'claim'
                ? 'bg-night-surface text-status-amber shadow'
                : 'text-cream-muted hover:text-cream-secondary'
            }`}
          >
            <UserCheck className="h-3.5 w-3.5" />
            <span>My Profile</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('new');
              setErrorMessage(null);
              setUsername('');
              setHandle('');
              setJournalUrl('');
              setBedtime('23:00');
              setWakeTime('07:00');
              setTimezone(formatGmtOffset(viewerTimezone));
            }}
            className={`flex-1 flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition-all ${
              tab === 'new'
                ? 'bg-night-surface text-status-amber shadow'
                : 'text-cream-muted hover:text-cream-secondary'
            }`}
          >
            <UserPlus className="h-3.5 w-3.5" />
            <span>Join Roster</span>
          </button>
        </div>

        {/* Feedback alerts */}
        {errorMessage && (
          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-status-coral/40 bg-status-coral/10 p-3 text-xs text-status-coral">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <p className="flex-1">{errorMessage}</p>
          </div>
        )}

        {successMessage && (
          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-status-sage/40 bg-status-sage/10 p-3 text-xs text-status-sage">
            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
            <p className="flex-1">{successMessage}</p>
          </div>
        )}

        {/* TAB 1: Edit Profile / Claim Existing */}
        {tab === 'claim' && (
          <div className="mt-4 space-y-4">
            {/* Member selector */}
            <div>
              <label className="block text-xs font-medium text-cream-secondary mb-1.5">
                Select Your Profile
              </label>
              <select
                value={selectedMemberId}
                onChange={(e) => {
                  setSelectedMemberId(e.target.value);
                  setIsUnlocked(false);
                }}
                className="w-full min-h-[44px] rounded-xl border border-night-border bg-night-elevated px-3 py-2 text-xs text-cream-primary outline-none focus:border-status-amber transition-colors"
              >
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.discord_username} ({formatGmtOffset(m.timezone)}) • Bedtime: {m.bedtime_local}
                  </option>
                ))}
              </select>
            </div>

            {/* Active pending cooldown alert banner (if exists) */}
            {pendingCooldownNotice && (
              <div className="rounded-xl border border-dashed border-status-amber/60 bg-status-amber/10 p-3.5 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <p className="font-semibold text-status-amber flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5" />
                      <span>Pending Cooldown Queue</span>
                    </p>
                    <p className="text-cream-secondary">
                      Shifting to{' '}
                      <span className="font-bold text-cream-primary">
                        {pendingCooldownNotice.pendingBedtime} ({formatGmtOffset(pendingCooldownNotice.pendingTimezone || activeMember?.timezone)})
                        {pendingCooldownNotice.pendingWeekendBedtime ? ` • Weekend: ${pendingCooldownNotice.pendingWeekendBedtime}` : ''}
                      </span>{' '}
                      in{' '}
                      <span className="font-bold text-status-amber">
                        {pendingCooldownNotice.remainingHours}h {pendingCooldownNotice.remainingMins}m
                      </span>{' '}
                      ({pendingCooldownNotice.effectiveDate})
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleCancelPending}
                    disabled={cancelLoading}
                    className="shrink-0 rounded-lg border border-night-border bg-night-surface px-2.5 py-1 text-[11px] font-medium text-cream-muted hover:text-status-coral hover:border-status-coral/40 transition-colors"
                  >
                    {cancelLoading ? 'Cancelling...' : 'Cancel Shift'}
                  </button>
                </div>
              </div>
            )}

            {/* PIN Unlock Section (If Claimed & Not Yet Unlocked) */}
            {(activeMember?.has_pin ?? Boolean(activeMember?.passcode_hash)) && !isUnlocked ? (
              <form
                onSubmit={handleUnlockProfile}
                className="rounded-2xl border border-night-border bg-night-elevated/70 p-4 space-y-3"
              >
                <div className="flex items-center gap-2 text-cream-primary font-medium text-xs">
                  <Lock className="h-4 w-4 text-status-amber" />
                  <span>Enter 4-Digit PIN to Edit Profile</span>
                </div>
                <p className="text-[11px] text-cream-muted leading-relaxed">
                  Your PIN guarantees accountability so no one else can change your bedtime or Discord link.
                </p>
                <div className="flex gap-2">
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="Enter PIN"
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                    className="flex-1 min-h-[44px] rounded-xl border border-night-border bg-night-surface px-3 py-2 text-center text-sm tracking-widest text-cream-primary outline-none focus:border-status-amber"
                  />
                  <button
                    type="submit"
                    className="min-h-[44px] rounded-xl bg-status-amber px-5 text-xs font-semibold text-night-bg hover:bg-status-amber/90 transition-colors"
                  >
                    Unlock
                  </button>
                </div>
              </form>
            ) : (
              /* Profile Edit Form (Unlocked or Unclaimed) */
              <div className="space-y-4">
                {/* Nightly Bedtime Check-In & Streak Card */}
                {activeMember && (
                  <div className="rounded-2xl border border-status-amber/40 bg-status-amber/10 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-status-amber" />
                        <span className="text-xs font-bold text-cream-primary">
                          Nightly Bedtime Check-In
                        </span>
                      </div>
                      {activeMember.streak_days && activeMember.streak_days > 0 ? (
                        <span className="rounded-full bg-status-amber/20 px-2.5 py-0.5 text-[11px] font-bold text-status-amber border border-status-amber/40">
                          🔥 {activeMember.streak_days} Day Streak
                        </span>
                      ) : (
                        <span className="text-[10px] text-cream-muted">0 day streak</span>
                      )}
                    </div>

                    <p className="text-[11px] text-cream-secondary leading-relaxed">
                      {activeMember.is_in_bed
                        ? "✓ You're safely checked in for tonight. Sleep Shield is active and community nag alerts are suppressed!"
                        : "Heading to bed now? Tapping 'I'm in Bed' silences community nag alerts for tonight and builds your sleep streak."}
                    </p>

                    <div className="flex gap-2">
                      {activeMember.is_in_bed ? (
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const res = await fetch('/api/members/in-bed', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                credentials: 'include',
                                body: JSON.stringify({ memberId: activeMember.id, action: 'cancel' }),
                              });
                              if (!res.ok) {
                                const errData = await res.json().catch(() => ({}));
                                console.warn('Cancel in-bed failed:', errData.error);
                              }
                            } catch (err) {
                              console.error('Failed to cancel check-in:', err);
                            }
                            await onRefreshRoster();
                          }}
                          className="flex-1 min-h-[38px] rounded-xl border border-night-border bg-night-surface text-xs font-medium text-cream-muted hover:text-status-coral transition-colors"
                        >
                          Wake Up / Undo Check-In
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const res = await fetch('/api/members/in-bed', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                credentials: 'include',
                                body: JSON.stringify({ memberId: activeMember.id, action: 'check_in' }),
                              });
                              if (!res.ok) {
                                const errData = await res.json().catch(() => ({}));
                                console.warn('Check-in failed:', errData.error);
                              }
                            } catch (err) {
                              console.error('Failed to check in:', err);
                            }
                            await onRefreshRoster();
                          }}
                          className="flex-1 min-h-[40px] rounded-xl bg-status-amber text-xs font-bold text-night-bg hover:bg-status-amber/90 transition-all shadow"
                        >
                          🛏️ I&apos;m in Bed Now (Mute Nags)
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <form onSubmit={handleSaveProfile} className="space-y-3.5">
                  {/* Unclaimed Notice (If setting initial PIN) */}
                  {!isOwner && !(activeMember?.has_pin ?? Boolean(activeMember?.passcode_hash)) && (
                    <div className="rounded-xl border border-status-sage/30 bg-status-sage/10 p-3 text-xs text-cream-secondary">
                      <p className="font-semibold text-status-sage flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>Unclaimed Profile: Choose a 4-Digit PIN</span>
                      </p>
                      <p className="mt-1 text-[11px]">
                        Create a 4-digit PIN below to claim this profile and secure your bedtime schedule.
                      </p>
                    </div>
                  )}

                {/* Website Username (User Editable) */}
                <div>
                  <label className="block text-xs font-medium text-cream-secondary mb-1">
                    Website Username
                  </label>
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Your display name on the website"
                    className="w-full min-h-[44px] rounded-xl border border-night-border bg-night-elevated px-3 py-2 text-xs text-cream-primary outline-none focus:border-status-amber"
                  />
                  <p className="mt-1 text-[11px] text-cream-muted">
                    Your display name shown across Z Catchers. You can modify this anytime.
                  </p>
                </div>

                {/* Discord Handle (Auto-filled & Linked) */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-cream-secondary">
                      Discord Handle
                    </label>
                    <span className="flex items-center gap-1 text-[10px] text-status-sage font-medium">
                      <CheckCircle2 className="h-3 w-3" />
                      <span>Auto-filled from Discord</span>
                    </span>
                  </div>
                  <div className="relative">
                    <input
                      type="text"
                      readOnly
                      disabled
                      value={handle}
                      className="w-full min-h-[44px] rounded-xl border border-night-border bg-night-surface/60 px-3 py-2 text-xs text-cream-secondary cursor-not-allowed outline-none select-none opacity-85"
                    />
                    <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-cream-muted">
                      <Lock className="h-3.5 w-3.5" />
                    </div>
                  </div>
                  <p className="mt-1 text-[11px] text-cream-muted leading-relaxed">
                    Linked to your authenticated Discord account. Cannot be modified manually.
                  </p>
                </div>

                {/* Discord Journal Link with live regex validation */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-cream-secondary">
                      Discord Journal Thread / Channel URL
                    </label>
                    <div className="flex items-center gap-2">
                      {isJournalValid && journalUrl.trim() && (
                        <a
                          href={journalUrl.trim()}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-status-amber hover:underline"
                        >
                          <span>Test link</span>
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                      <span className="text-[10px] text-status-sage font-medium">⚡ Instant Update</span>
                    </div>
                  </div>
                  <input
                    type="url"
                    required
                    placeholder="https://discord.com/channels/{guild}/{channel_or_thread}"
                    value={journalUrl}
                    onChange={(e) => setJournalUrl(e.target.value)}
                    className={`w-full min-h-[44px] rounded-xl border px-3 py-2 text-xs text-cream-primary outline-none transition-colors ${
                      isJournalValid
                        ? 'border-night-border bg-night-elevated focus:border-status-amber'
                        : 'border-status-coral bg-status-coral/10 focus:border-status-coral'
                    }`}
                  />
                  {!isJournalValid ? (
                    <p className="mt-1 text-[11px] text-status-coral">
                      Must match format: https://discord.com/channels/123456789/987654321
                    </p>
                  ) : (
                    <p className="mt-1 text-[11px] text-cream-muted leading-relaxed">
                      Friends who tap <strong>&quot;Nag in Discord Journal&quot;</strong> on your card will be redirected straight to this channel or thread in Discord.
                    </p>
                  )}
                  <p className="mt-0.5 text-[10px] text-cream-muted/70">
                    💡 In Discord, right-click (or tap and hold on mobile) your journal channel/thread and choose <strong>Copy Link</strong>.
                  </p>
                </div>

                {/* Bedtime & Wake Time Grid */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-cream-secondary mb-1">
                      Local Bedtime (24h)
                    </label>
                    <input
                      type="time"
                      required
                      value={bedtime}
                      onChange={(e) => setBedtime(e.target.value)}
                      className="w-full min-h-[44px] rounded-xl border border-night-border bg-night-elevated px-3 py-2 text-xs font-semibold text-cream-primary outline-none focus:border-status-amber"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-cream-secondary mb-1">
                      Wake Time (24h)
                    </label>
                    <input
                      type="time"
                      required
                      value={wakeTime}
                      onChange={(e) => setWakeTime(e.target.value)}
                      className="w-full min-h-[44px] rounded-xl border border-night-border bg-night-elevated px-3 py-2 text-xs font-semibold text-cream-primary outline-none focus:border-status-amber"
                    />
                  </div>
                </div>

                {/* Timezone Selector */}
                <div>
                  <label className="block text-xs font-medium text-cream-secondary mb-1">
                    Your Timezone (GMT Offset)
                  </label>
                  <select
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-night-border bg-night-elevated px-3 py-2 text-xs text-cream-primary outline-none focus:border-status-amber"
                  >
                    {!COMMON_IANA_TIMEZONES.includes(timezone as any) && (
                      <option value={timezone}>{timezone} ({formatGmtOffset(timezone)})</option>
                    )}
                    {COMMON_IANA_TIMEZONES.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz} ({formatGmtOffset(tz)})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Weekend Hours Toggle & Controls (Friday & Saturday Nights) */}
                <div className="rounded-2xl border border-night-border bg-night-elevated/70 p-3.5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Moon className="h-4 w-4 text-status-amber" />
                      <div>
                        <span className="text-xs font-bold text-cream-primary block">
                          Weekend Hours (Friday &amp; Saturday Nights)
                        </span>
                        <span className="text-[11px] text-cream-muted">
                          Sleep later on weekend nights? Set custom hours for Fri &amp; Sat.
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEnableWeekendHours((prev) => !prev)}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        enableWeekendHours ? 'bg-status-amber' : 'bg-night-border'
                      }`}
                      aria-label="Toggle weekend hours"
                    >
                      <span
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-night-bg shadow ring-0 transition duration-200 ease-in-out ${
                          enableWeekendHours ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>

                  {enableWeekendHours && (
                    <div className="pt-2 border-t border-night-border/50 space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-cream-secondary mb-1">
                            Weekend Bedtime (24h)
                          </label>
                          <input
                            type="time"
                            required={enableWeekendHours}
                            value={weekendBedtime}
                            onChange={(e) => setWeekendBedtime(e.target.value)}
                            className="w-full min-h-[44px] rounded-xl border border-night-border bg-night-surface px-3 py-2 text-xs font-semibold text-cream-primary outline-none focus:border-status-amber"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-cream-secondary mb-1">
                            Weekend Wake Time (24h)
                          </label>
                          <input
                            type="time"
                            required={enableWeekendHours}
                            value={weekendWakeTime}
                            onChange={(e) => setWeekendWakeTime(e.target.value)}
                            className="w-full min-h-[44px] rounded-xl border border-night-border bg-night-surface px-3 py-2 text-xs font-semibold text-cream-primary outline-none focus:border-status-amber"
                          />
                        </div>
                      </div>
                      <p className="text-[11px] text-cream-muted flex items-center gap-1.5">
                        <span>🦊</span>
                        <span>Applies on Friday night and Saturday night bedtimes. Sunday through Thursday use your regular hours.</span>
                      </p>
                    </div>
                  )}
                </div>

                {/* Live Dual-Time Preview Pill */}
                <div className="rounded-xl border border-night-border bg-night-elevated px-3 py-2 text-xs flex items-center justify-between text-cream-secondary">
                  <span>
                    Your Time: <strong className="text-cream-primary">{previewTime.sleeper}</strong>
                  </span>
                  <span>
                    Viewer Time: <strong className="text-status-amber">{previewTime.viewer}</strong>
                  </span>
                </div>

                {/* 4-Digit PIN Input (Required for non-owners; hidden for verified owners) */}
                {!isOwner ? (
                  <div>
                    <label className="block text-xs font-medium text-cream-secondary mb-1">
                      {!(activeMember?.has_pin ?? Boolean(activeMember?.passcode_hash))
                        ? 'Create 4-Digit PIN (to secure profile)'
                        : 'Confirm Your 4-Digit PIN'}
                    </label>
                    <input
                      type="password"
                      inputMode="numeric"
                      maxLength={6}
                      required
                      placeholder="4-digit PIN"
                      value={pin}
                      onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                      className="w-full min-h-[44px] rounded-xl border border-night-border bg-night-elevated px-3 py-2 text-xs text-cream-primary outline-none focus:border-status-amber"
                    />
                  </div>
                ) : (
                  <div className="rounded-xl border border-night-border bg-night-elevated/40 px-3 py-2 text-[11px] text-cream-muted flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-status-sage">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>Verified Owner Session</span>
                    </span>
                    <span>No PIN entry required</span>
                  </div>
                )}

                {/* 48-Hour Cooldown Warning Callout (Mandatory per Spec Section 6.2) */}
                {hasScheduleChanged ? (
                  <div className="rounded-xl border border-status-amber/30 bg-status-amber/10 p-3 text-xs text-cream-secondary leading-relaxed">
                    <p className="font-semibold text-status-amber flex items-center gap-1.5">
                      <Shield className="h-3.5 w-3.5" />
                      <span>Accountability Cooldown (48 Hours)</span>
                    </p>
                    <p className="mt-1">
                      Changing your bedtime, weekend hours, or timezone takes 48 hours to take effect so nobody can dodge
                      their bedtime at the last minute. Updating your Discord Journal link is instant.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-status-sage/30 bg-status-sage/10 p-2.5 text-xs text-status-sage flex items-center gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    <span>Bedtime matches active schedule. Updates to journal link will apply immediately.</span>
                  </div>
                )}

                {/* Save Button */}
                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsUnlocked(false)}
                    className="min-h-[44px] rounded-xl border border-night-border bg-night-elevated px-4 text-xs font-semibold text-cream-secondary hover:text-cream-primary transition-colors"
                  >
                    Lock
                  </button>
                  <button
                    type="submit"
                    disabled={loading || !isJournalValid}
                    className="flex-1 min-h-[44px] rounded-xl bg-status-amber font-semibold text-xs text-night-bg hover:bg-status-amber/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                  >
                    {loading ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        <span>Saving...</span>
                      </>
                    ) : hasScheduleChanged ? (
                      <span>Queue 48h Schedule Change</span>
                    ) : (
                      <span>Save Profile Changes</span>
                    )}
                  </button>
                </div>
              </form>
              </div>
            )}

            {/* Account & Session Management (Log Out) */}
            {currentUser && onLogout && (
              <div className="pt-4 border-t border-night-border">
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 rounded-2xl border border-night-border bg-night-elevated/40 p-3.5">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-night-surface border border-night-border text-status-amber">
                      <FoxMascot state="logo" size={20} />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-cream-primary">
                        Signed in as @{currentUser.discord_username}
                      </p>
                      <p className="text-[11px] text-cream-muted">
                        Need to switch accounts or take a break?
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onLogout();
                    }}
                    className="flex items-center justify-center gap-2 rounded-xl border border-status-coral/40 bg-status-coral/10 px-4 py-2 text-xs font-semibold text-status-coral hover:bg-status-coral/20 hover:border-status-coral/60 transition-all min-h-[44px]"
                  >
                    <LogOut className="h-4 w-4" />
                    <span>Log Out of Fox Den</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: Join Roster (Discord Onboarding) */}
        {tab === 'new' && (
          <div className="mt-4 space-y-4">
            <div className="rounded-xl border border-status-amber/30 bg-status-amber/10 p-4 text-xs text-cream-secondary leading-relaxed">
              <p className="font-semibold text-status-amber flex items-center gap-1.5 text-sm">
                <Sparkles className="h-4 w-4" />
                <span>Join the Z Catchers Den</span>
              </p>
              <p className="mt-2 text-cream-secondary">
                All new member registrations now onboard securely via Discord OAuth. Connect your Discord account to set your bedtime schedule, claim your profile, and join the sleep accountability roster.
              </p>
            </div>

            <div className="flex flex-col items-center justify-center p-6 rounded-2xl border border-night-border bg-night-elevated text-center gap-3">
              <FoxMascot state="lantern" size={56} className="mb-1" />
              <h3 className="text-sm font-bold text-cream-primary">
                Discord Onboarding &amp; Profile Claim
              </h3>
              <p className="text-xs text-cream-secondary max-w-xs">
                Zero passwords or PINs required. Seamlessly syncs your Discord avatar, journal link, and sleep notifications.
              </p>
              <a
                href="/api/auth/discord"
                className="w-full max-w-xs min-h-[44px] bg-status-amber hover:bg-status-amber/90 text-night-bg font-semibold rounded-xl flex items-center justify-center gap-2 px-4 shadow-lg shadow-status-amber/20 transition-all hover:scale-[1.02] active:scale-[0.98] text-xs mt-2"
              >
                <span>Continue with Discord</span>
                <ArrowRight className="h-4 w-4" />
              </a>
              <a
                href="/join"
                className="inline-flex min-h-[44px] items-center px-2 text-[11px] text-cream-muted hover:text-status-amber underline transition-colors"
              >
                Or visit the full onboarding page (/join)
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
