'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ResponsiveDialog } from '@/components/ResponsiveDialog';
import { computeMemberState } from '@/lib/sleepEngine';
import { FoxMascot } from './FoxMascot';
import { Member } from '@/lib/db';
import { DateTime } from 'luxon';
import {
  X,
  Lock,
  Moon,
  Clock,
  Calendar,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  Shield,
  RefreshCw,
  LogOut,
  Pencil,
  UserRound,
  ChevronRight,
} from 'lucide-react';

import { COMMON_IANA_TIMEZONES, GMT_OFFSETS, formatGmtOffset, toValidLuxonZone, detectUserTimezone, DayKey, DailySchedule, WeeklySchedule, DAY_KEYS } from '@/lib/timezone';
import { TimezoneSelect } from '@/components/TimezoneSelect';

const DAY_LABELS: Record<DayKey, { short: string; full: string }> = {
  mon: { short: 'Mon', full: 'Monday' },
  tue: { short: 'Tue', full: 'Tuesday' },
  wed: { short: 'Wed', full: 'Wednesday' },
  thu: { short: 'Thu', full: 'Thursday' },
  fri: { short: 'Fri', full: 'Friday' },
  sat: { short: 'Sat', full: 'Saturday' },
  sun: { short: 'Sun', full: 'Sunday' },
};

type SchedulePresetMode = 'everyday' | 'weekdays_weekends' | 'custom';
const TIME_FORMAT_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

const DISCORD_JOURNAL_REGEX = /^https:\/\/(ptb\.|canary\.)?discord\.com\/channels\/\d+\/\d+(\/\d+)?$/;

interface MyScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  viewerTimezone: string;
  onRefreshRoster: () => Promise<void>;
  currentUser: Member;
  onLogout: () => void;
  initialView?: 'profile' | 'schedule';
}

export function MyScheduleModal({
  isOpen,
  onClose,
  viewerTimezone,
  onRefreshRoster,
  currentUser,
  onLogout,
  initialView = 'profile',
}: MyScheduleModalProps) {
  const [view, setView] = useState<'profile' | 'edit' | 'schedule'>(initialView);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousView = useRef(view);

  useEffect(() => {
    if (previousView.current !== view) {
      headingRef.current?.focus();
      previousView.current = view;
    }
  }, [view]);

  // Form fields for editing
  const [username, setUsername] = useState<string>('');
  const [handle, setHandle] = useState<string>('');
  const [journalUrl, setJournalUrl] = useState<string>('');
  const [bedtime, setBedtime] = useState<string>('23:00');
  const [wakeTime, setWakeTime] = useState<string>('07:00');
  const [timezone, setTimezone] = useState<string>(viewerTimezone || detectUserTimezone());

  // Weekend hours (Friday & Saturday nights)
  const [enableWeekendHours, setEnableWeekendHours] = useState<boolean>(false);
  const [weekendBedtime, setWeekendBedtime] = useState<string>('00:30');
  const [weekendWakeTime, setWeekendWakeTime] = useState<string>('09:00');

  // 7-Day Variable Sleep Schedule state
  const [schedulePreset, setSchedulePreset] = useState<SchedulePresetMode>('weekdays_weekends');
  const [selectedScheduleDay, setSelectedScheduleDay] = useState<DayKey>('mon');
  const [weeklySchedule, setWeeklySchedule] = useState<WeeklySchedule>({
    mon: { bedtime: '23:00', wake_time: '07:00' },
    tue: { bedtime: '23:00', wake_time: '07:00' },
    wed: { bedtime: '23:00', wake_time: '07:00' },
    thu: { bedtime: '23:00', wake_time: '07:00' },
    fri: { bedtime: '00:30', wake_time: '09:00' },
    sat: { bedtime: '00:30', wake_time: '09:00' },
    sun: { bedtime: '23:00', wake_time: '07:00' },
  });

  // UI state
  const [loading, setLoading] = useState<boolean>(false);
  const [cancelLoading, setCancelLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const activeMember = currentUser;
  const draftMemberId = useRef<string | null>(null);

  // Populate the schedule editor for the signed-in member.
  useEffect(() => {
    if (!isOpen || !activeMember) {
      draftMemberId.current = null;
      return;
    }
    if (draftMemberId.current === activeMember.id) return;
    draftMemberId.current = activeMember.id;

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

      if (activeMember.weekly_schedule) {
        const ws: WeeklySchedule = JSON.parse(JSON.stringify(activeMember.weekly_schedule));
        setWeeklySchedule(ws);
        const allSame = DAY_KEYS.every(
          (k) => ws[k]?.bedtime === ws.mon?.bedtime && ws[k]?.wake_time === ws.mon?.wake_time
        );
        const weekdayMatch = ['tue', 'wed', 'thu', 'sun'].every(
          (k) => ws[k as DayKey]?.bedtime === ws.mon?.bedtime && ws[k as DayKey]?.wake_time === ws.mon?.wake_time
        );
        const weekendMatch = ws.fri?.bedtime === ws.sat?.bedtime && ws.fri?.wake_time === ws.sat?.wake_time;

        if (allSame) {
          setSchedulePreset('everyday');
        } else if (weekdayMatch && weekendMatch) {
          setSchedulePreset('weekdays_weekends');
        } else {
          setSchedulePreset('custom');
        }
      } else {
        const bBed = activeMember.bedtime_local || '23:00';
        const bWake = activeMember.wake_time_local || '07:00';
        const wBed = activeMember.weekend_bedtime_local || bBed;
        const wWake = activeMember.weekend_wake_time_local || bWake;
        const hasWeekend = Boolean(activeMember.weekend_bedtime_local || activeMember.weekend_wake_time_local);
        setWeeklySchedule({
          mon: { bedtime: bBed, wake_time: bWake },
          tue: { bedtime: bBed, wake_time: bWake },
          wed: { bedtime: bBed, wake_time: bWake },
          thu: { bedtime: bBed, wake_time: bWake },
          fri: { bedtime: wBed, wake_time: wWake },
          sat: { bedtime: wBed, wake_time: wWake },
          sun: { bedtime: bBed, wake_time: bWake },
        });
        setSchedulePreset(hasWeekend ? 'weekdays_weekends' : 'everyday');
      }
      setErrorMessage(null);
      setSuccessMessage(null);
    }
  }, [isOpen, activeMember]);

  // Check if pending cooldown is currently active on selected member
  const pendingCooldownNotice = useMemo(() => {
    if (!activeMember || !activeMember.pending_effective_at) return null;
    const now = DateTime.utc();
    const effectiveAt = DateTime.fromISO(activeMember.pending_effective_at, { zone: 'utc' });
    if (!effectiveAt.isValid || now >= effectiveAt) return null;

    const remainingHours = Math.max(0, Math.floor(effectiveAt.diff(now, 'hours').hours));
    const remainingMins = Math.max(0, Math.floor(effectiveAt.diff(now, 'minutes').minutes % 60));

    return {
      pendingBedtime: activeMember.pending_bedtime_local,
      pendingWakeTime: activeMember.pending_wake_time_local,
      pendingWeekendBedtime: activeMember.pending_weekend_bedtime_local,
      pendingTimezone: activeMember.pending_timezone,
      remainingHours,
      remainingMins,
      effectiveDate: effectiveAt.setZone(toValidLuxonZone(viewerTimezone)).toFormat('LLL d, h:mm a ZZZZ'),
    };
  }, [activeMember, viewerTimezone]);

  // Preview bedtime converted to viewer timezone
  const previewTime = useMemo(() => {
    const activeBedtime =
      schedulePreset === 'custom'
        ? weeklySchedule[selectedScheduleDay]?.bedtime || bedtime
        : bedtime;
    try {
      const [h, m] = activeBedtime.split(':').map(Number);
      const nowInTz = DateTime.now().setZone(toValidLuxonZone(timezone));
      const dt = nowInTz.set({ hour: h || 0, minute: m || 0, second: 0 });
      return {
        sleeper: dt.toFormat('h:mm a'),
        viewer: dt.setZone(toValidLuxonZone(viewerTimezone)).toFormat('h:mm a'),
      };
    } catch {
      return { sleeper: activeBedtime, viewer: activeBedtime };
    }
  }, [bedtime, timezone, viewerTimezone, schedulePreset, selectedScheduleDay, weeklySchedule]);

  // Check if schedule (bedtime, wake time, timezone, weekend hours, 7-day schedule) has changed from active values
  const hasScheduleChanged = useMemo(() => {
    if (!activeMember) return false;
    if (timezone !== activeMember.timezone) return true;
    if (activeMember.weekly_schedule) {
      return DAY_KEYS.some((day) => {
        const cur = weeklySchedule[day];
        const prev = activeMember.weekly_schedule?.[day];
        return !cur || !prev || cur.bedtime !== prev.bedtime || cur.wake_time !== prev.wake_time;
      });
    }
    const bBed = activeMember.bedtime_local;
    const bWake = activeMember.wake_time_local;
    const wBed = activeMember.weekend_bedtime_local || bBed;
    const wWake = activeMember.weekend_wake_time_local || bWake;
    for (const d of ['mon', 'tue', 'wed', 'thu', 'sun'] as DayKey[]) {
      if (weeklySchedule[d]?.bedtime !== bBed || weeklySchedule[d]?.wake_time !== bWake) return true;
    }
    for (const d of ['fri', 'sat'] as DayKey[]) {
      if (weeklySchedule[d]?.bedtime !== wBed || weeklySchedule[d]?.wake_time !== wWake) return true;
    }
    return false;
  }, [activeMember, timezone, weeklySchedule]);

  if (!isOpen) return null;

  // Validate journal URL
  const isJournalValid = journalUrl.trim() === '' || DISCORD_JOURNAL_REGEX.test(journalUrl.trim());

  // Handle Schedule & Profile Update Submission
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (view === 'edit' && (!isJournalValid || !journalUrl.trim())) {
      setErrorMessage(
        'Please enter a valid Discord Journal Thread URL: https://discord.com/channels/{guild}/{thread}'
      );
      return;
    }

    if (view === 'edit' && !username.trim()) {
      setErrorMessage('Please enter your Discord display name.');
      return;
    }

    // Validate 7-day schedule
    for (const day of view === 'schedule' ? DAY_KEYS : []) {
      const item = weeklySchedule[day];
      if (!item || !TIME_FORMAT_REGEX.test(item.bedtime) || !TIME_FORMAT_REGEX.test(item.wake_time)) {
        setErrorMessage(`Please enter a valid 24h HH:mm bedtime and wake time for ${DAY_LABELS[day].full}.`);
        return;
      }
      if (item.bedtime === item.wake_time) {
        setErrorMessage(`Bedtime and wake time cannot be identical on ${DAY_LABELS[day].full}.`);
        return;
      }
    }

    if (!activeMember) return;

    setLoading(true);

    try {
      const res = await fetch('/api/members/update-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          member_id: activeMember.id,
          ...(view === 'edit'
            ? {
                discord_username: username.trim(),
                discord_handle: handle.trim() || null,
                journal_url: journalUrl.trim(),
              }
            : {
                weekly_schedule: weeklySchedule,
                timezone: timezone.trim(),
              }),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrorMessage(data.error || 'Failed to update schedule.');
        return;
      }

      setSuccessMessage(data.message);
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
          action: 'schedule',
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrorMessage(data.error || 'Failed to cancel pending schedule change.');
        return;
      }

      setSuccessMessage(data.message);
      await onRefreshRoster();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network error';
      setErrorMessage(msg);
    } finally {
      setCancelLoading(false);
    }
  };

  const activeSchedule = computeMemberState(currentUser, viewerTimezone);
  const title = view === 'profile' ? 'Account settings' : view === 'edit' ? 'Edit profile' : 'Sleep schedule';
  const accountHandle = currentUser.discord_handle?.trim().replace(/^@/, '');
  const openView = (next: typeof view) => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setView(next);
  };

  return (
    <ResponsiveDialog labelledBy="modal-schedule-title" onClose={onClose}
      className="max-h-[90dvh] p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] md:max-w-lg md:p-6">
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-night-border md:hidden" />
        <div className="flex items-center gap-3 border-b border-night-border pb-3">
          <FoxMascot state="lantern" size={32} className="shrink-0" />
          <h2 ref={headingRef} tabIndex={-1} id="modal-schedule-title" className="min-w-0 flex-1 font-bold">{title}</h2>
          <button type="button" onClick={onClose}
            className="grid min-h-[44px] min-w-[44px] place-items-center rounded-xl text-cream-secondary hover:bg-night-elevated"
            aria-label="Close account settings">
            <X className="h-5 w-5" />
          </button>
        </div>

        {view === 'profile' ? (
          <div className="pt-3">
            <div className="flex items-center gap-3 pb-3">
              {currentUser.avatar_url ? (
                <img src={currentUser.avatar_url} alt="" className="h-10 w-10 shrink-0 rounded-full bg-night-elevated object-cover" />
              ) : (
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-night-elevated">
                  <UserRound className="h-5 w-5 text-cream-secondary" aria-hidden="true" />
                </span>
              )}
              <div className="min-w-0 [overflow-wrap:anywhere]">
                <p className="text-sm font-semibold">{currentUser.discord_username}</p>
                {accountHandle && <p className="text-sm text-cream-secondary">@{accountHandle}</p>}
              </div>
            </div>
            <div className="divide-y divide-night-border border-y border-night-border">
              <button type="button" onClick={() => openView('edit')}
                className="flex min-h-[44px] w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm hover:bg-night-elevated">
                <Pencil className="h-4 w-4 shrink-0 text-cream-secondary" aria-hidden="true" />
                <span className="min-w-0 flex-1 font-semibold">Edit profile</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-cream-secondary" aria-hidden="true" />
              </button>
              <button type="button" onClick={() => openView('schedule')}
                className="flex min-h-[44px] w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm hover:bg-night-elevated">
                <Moon className="h-4 w-4 shrink-0 text-cream-secondary" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">Sleep schedule</span>
                  <span className="block text-xs text-cream-secondary tabular-nums">
                    Bedtime {activeSchedule.activeBedtimeLocal} · Wake {activeSchedule.activeWakeTimeLocal}
                  </span>
                  {pendingCooldownNotice && (
                    <span className="mt-0.5 block text-xs text-status-amber">
                      Pending change applies {pendingCooldownNotice.effectiveDate}
                    </span>
                  )}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-cream-secondary" aria-hidden="true" />
              </button>
            </div>
            <button type="button" onClick={onLogout}
              className="mt-2 flex min-h-[44px] w-full items-center gap-2.5 rounded-lg px-2 text-left text-sm font-semibold text-status-coral hover:bg-status-coral/10">
              <LogOut className="h-4 w-4" aria-hidden="true" /> Sign out
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {initialView === 'profile' && (
              <button type="button" onClick={() => openView('profile')} disabled={loading || cancelLoading}
                className="min-h-[44px] text-sm font-semibold text-status-amber">
                Back to account settings
              </button>
            )}

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

            {/* Active pending cooldown alert banner (if exists) */}
            {view === 'schedule' && pendingCooldownNotice && (
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
                    className="shrink-0 min-h-[44px] rounded-lg border border-night-border bg-night-surface px-3 py-1.5 text-[11px] font-semibold text-cream-muted hover:text-status-coral hover:border-status-coral/40 transition-colors whitespace-nowrap"
                  >
                    {cancelLoading ? 'Cancelling...' : 'Cancel Shift'}
                  </button>
                </div>
              </div>
            )}

            <form onSubmit={handleSaveProfile} className="space-y-4">
              {view === 'edit' ? (
                <>
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

                </>
              ) : (
                <>
                {/* 7-Day Sleep Schedule Section */}
                <div className="rounded-2xl border border-night-border bg-night-elevated/70 p-4 space-y-3.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Moon className="h-4 w-4 text-status-amber" />
                      <div>
                        <span className="text-xs font-bold text-cream-primary block">
                          Sleep Schedule &amp; Routine
                        </span>
                        <span className="text-[11px] text-cream-muted">
                          Choose a preset or customize hours for each day of the week
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Preset Mode Switcher Segmented Control */}
                  <div className="grid grid-cols-3 gap-1 rounded-xl bg-night-surface p-1 border border-night-border">
                    <button
                      type="button"
                      onClick={() => {
                        setSchedulePreset('everyday');
                        const b = weeklySchedule.mon?.bedtime || bedtime;
                        const w = weeklySchedule.mon?.wake_time || wakeTime;
                        setBedtime(b);
                        setWakeTime(w);
                        setWeeklySchedule({
                          mon: { bedtime: b, wake_time: w },
                          tue: { bedtime: b, wake_time: w },
                          wed: { bedtime: b, wake_time: w },
                          thu: { bedtime: b, wake_time: w },
                          fri: { bedtime: b, wake_time: w },
                          sat: { bedtime: b, wake_time: w },
                          sun: { bedtime: b, wake_time: w },
                        });
                        setEnableWeekendHours(false);
                      }}
                      className={`rounded-lg py-2 px-1 text-center text-xs font-semibold transition-all min-h-[44px] flex flex-col items-center justify-center ${
                        schedulePreset === 'everyday'
                          ? 'bg-status-amber text-night-bg font-bold shadow'
                          : 'text-cream-muted hover:text-cream-secondary'
                      }`}
                    >
                      <span>Every Day</span>
                      <span className="text-[10px] opacity-75 font-normal">Single time</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setSchedulePreset('weekdays_weekends');
                        setEnableWeekendHours(true);
                        const b = weeklySchedule.mon?.bedtime || bedtime;
                        const w = weeklySchedule.mon?.wake_time || wakeTime;
                        const wB = weekendBedtime || '00:30';
                        const wW = weekendWakeTime || '09:00';
                        setBedtime(b);
                        setWakeTime(w);
                        setWeekendBedtime(wB);
                        setWeekendWakeTime(wW);
                        setWeeklySchedule({
                          mon: { bedtime: b, wake_time: w },
                          tue: { bedtime: b, wake_time: w },
                          wed: { bedtime: b, wake_time: w },
                          thu: { bedtime: b, wake_time: w },
                          fri: { bedtime: wB, wake_time: wW },
                          sat: { bedtime: wB, wake_time: wW },
                          sun: { bedtime: b, wake_time: w },
                        });
                      }}
                      className={`rounded-lg py-2 px-1 text-center text-xs font-semibold transition-all min-h-[44px] flex flex-col items-center justify-center ${
                        schedulePreset === 'weekdays_weekends'
                          ? 'bg-status-amber text-night-bg font-bold shadow'
                          : 'text-cream-muted hover:text-cream-secondary'
                      }`}
                    >
                      <span>Weekdays / Weekends</span>
                      <span className="text-[10px] opacity-75 font-normal">Fri &amp; Sat custom</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setSchedulePreset('custom');
                      }}
                      className={`rounded-lg py-2 px-1 text-center text-xs font-semibold transition-all min-h-[44px] flex flex-col items-center justify-center ${
                        schedulePreset === 'custom'
                          ? 'bg-status-amber text-night-bg font-bold shadow'
                          : 'text-cream-muted hover:text-cream-secondary'
                      }`}
                    >
                      <span>Custom Per Day</span>
                      <span className="text-[10px] opacity-75 font-normal">All 7 days</span>
                    </button>
                  </div>

                  {/* Mode 1: Every Day */}
                  {schedulePreset === 'everyday' && (
                    <div className="space-y-3 pt-1">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-cream-secondary mb-1">
                            Local Bedtime (24h)
                          </label>
                          <input
                            type="time"
                            required
                            value={bedtime}
                            onChange={(e) => {
                              const val = e.target.value;
                              setBedtime(val);
                              setWeeklySchedule((prev) => {
                                const next = { ...prev };
                                for (const k of DAY_KEYS) {
                                  next[k] = { ...next[k], bedtime: val };
                                }
                                return next;
                              });
                            }}
                            className="w-full min-h-[44px] rounded-xl border border-night-border bg-night-surface px-3 py-2 text-xs font-semibold text-cream-primary outline-none focus:border-status-amber"
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
                            onChange={(e) => {
                              const val = e.target.value;
                              setWakeTime(val);
                              setWeeklySchedule((prev) => {
                                const next = { ...prev };
                                for (const k of DAY_KEYS) {
                                  next[k] = { ...next[k], wake_time: val };
                                }
                                return next;
                              });
                            }}
                            className="w-full min-h-[44px] rounded-xl border border-night-border bg-night-surface px-3 py-2 text-xs font-semibold text-cream-primary outline-none focus:border-status-amber"
                          />
                        </div>
                      </div>
                      <p className="text-[11px] text-cream-muted flex items-center gap-1.5">
                        <span>🦊</span>
                        <span>Applies the same bedtime and wake time across all 7 days of the week.</span>
                      </p>
                    </div>
                  )}

                  {/* Mode 2: Weekdays / Weekends */}
                  {schedulePreset === 'weekdays_weekends' && (
                    <div className="space-y-3 pt-1">
                      <div>
                        <span className="text-[11px] font-bold text-cream-primary block mb-2">
                          Weekday Routine (Sunday – Thursday Nights)
                        </span>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[10px] font-medium text-cream-muted mb-1">
                              Weekday Bedtime (24h)
                            </label>
                            <input
                              type="time"
                              required
                              value={bedtime}
                              onChange={(e) => {
                                const val = e.target.value;
                                setBedtime(val);
                                setWeeklySchedule((prev) => ({
                                  ...prev,
                                  mon: { ...prev.mon, bedtime: val },
                                  tue: { ...prev.tue, bedtime: val },
                                  wed: { ...prev.wed, bedtime: val },
                                  thu: { ...prev.thu, bedtime: val },
                                  sun: { ...prev.sun, bedtime: val },
                                }));
                              }}
                              className="w-full min-h-[44px] rounded-xl border border-night-border bg-night-surface px-3 py-2 text-xs font-semibold text-cream-primary outline-none focus:border-status-amber"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-medium text-cream-muted mb-1">
                              Weekday Wake Time (24h)
                            </label>
                            <input
                              type="time"
                              required
                              value={wakeTime}
                              onChange={(e) => {
                                const val = e.target.value;
                                setWakeTime(val);
                                setWeeklySchedule((prev) => ({
                                  ...prev,
                                  mon: { ...prev.mon, wake_time: val },
                                  tue: { ...prev.tue, wake_time: val },
                                  wed: { ...prev.wed, wake_time: val },
                                  thu: { ...prev.thu, wake_time: val },
                                  sun: { ...prev.sun, wake_time: val },
                                }));
                              }}
                              className="w-full min-h-[44px] rounded-xl border border-night-border bg-night-surface px-3 py-2 text-xs font-semibold text-cream-primary outline-none focus:border-status-amber"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="pt-2 border-t border-night-border/50">
                        <span className="text-[11px] font-bold text-status-amber block mb-2">
                          🌙 Weekend Hours (Friday &amp; Saturday Nights)
                        </span>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[10px] font-medium text-cream-muted mb-1">
                              Weekend Bedtime (24h)
                            </label>
                            <input
                              type="time"
                              required
                              value={weekendBedtime}
                              onChange={(e) => {
                                const val = e.target.value;
                                setWeekendBedtime(val);
                                setWeeklySchedule((prev) => ({
                                  ...prev,
                                  fri: { ...prev.fri, bedtime: val },
                                  sat: { ...prev.sat, bedtime: val },
                                }));
                              }}
                              className="w-full min-h-[44px] rounded-xl border border-night-border bg-night-surface px-3 py-2 text-xs font-semibold text-cream-primary outline-none focus:border-status-amber"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-medium text-cream-muted mb-1">
                              Weekend Wake Time (24h)
                            </label>
                            <input
                              type="time"
                              required
                              value={weekendWakeTime}
                              onChange={(e) => {
                                const val = e.target.value;
                                setWeekendWakeTime(val);
                                setWeeklySchedule((prev) => ({
                                  ...prev,
                                  fri: { ...prev.fri, wake_time: val },
                                  sat: { ...prev.sat, wake_time: val },
                                }));
                              }}
                              className="w-full min-h-[44px] rounded-xl border border-night-border bg-night-surface px-3 py-2 text-xs font-semibold text-cream-primary outline-none focus:border-status-amber"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Mode 3: Custom Per Day */}
                  {schedulePreset === 'custom' && (
                    <div className="space-y-3 pt-1">
                      <div>
                        <label className="block text-[11px] font-medium text-cream-secondary mb-1.5">
                          Select Day to Customize
                        </label>
                        <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5">
                          {DAY_KEYS.map((day) => {
                            const isSelected = selectedScheduleDay === day;
                            const daySched = weeklySchedule[day];
                            return (
                              <button
                                key={`custom-pill-${day}`}
                                type="button"
                                onClick={() => setSelectedScheduleDay(day)}
                                className={`flex flex-col items-center justify-center rounded-xl p-1 text-center transition-all min-h-[44px] ${
                                  isSelected
                                    ? 'bg-status-amber text-night-bg font-bold shadow'
                                    : 'bg-night-surface border border-night-border text-cream-secondary hover:border-status-amber/40'
                                }`}
                              >
                                <span className="text-[10px] uppercase font-semibold">
                                  {DAY_LABELS[day].short}
                                </span>
                                <span className="text-[9px] tabular-nums mt-0.5 opacity-90">
                                  {daySched?.bedtime || '--:--'}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Selected Day Inputs */}
                      <div className="rounded-xl border border-night-border bg-night-surface p-3 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-cream-primary flex items-center gap-1.5">
                            <Calendar className="h-3.5 w-3.5 text-status-amber" />
                            <span>{DAY_LABELS[selectedScheduleDay].full} Night Schedule</span>
                          </span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                const src = weeklySchedule[selectedScheduleDay];
                                setWeeklySchedule((prev) => ({
                                  ...prev,
                                  mon: { ...src },
                                  tue: { ...src },
                                  wed: { ...src },
                                  thu: { ...src },
                                  sun: { ...src },
                                }));
                              }}
                              className="rounded-lg px-2 py-1 text-[10px] font-medium text-cream-muted bg-night-elevated hover:text-status-amber border border-night-border min-h-[44px]"
                            >
                              Copy to Weekdays
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const src = weeklySchedule[selectedScheduleDay];
                                setWeeklySchedule((prev) => ({
                                  ...prev,
                                  mon: { ...src },
                                  tue: { ...src },
                                  wed: { ...src },
                                  thu: { ...src },
                                  fri: { ...src },
                                  sat: { ...src },
                                  sun: { ...src },
                                }));
                              }}
                              className="rounded-lg px-2 py-1 text-[10px] font-medium text-cream-muted bg-night-elevated hover:text-status-amber border border-night-border min-h-[44px]"
                            >
                              Apply to All 7 Days
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[10px] font-medium text-cream-muted mb-1">
                              Bedtime (24h)
                            </label>
                            <input
                              type="time"
                              required
                              value={weeklySchedule[selectedScheduleDay]?.bedtime || '23:00'}
                              onChange={(e) => {
                                const val = e.target.value;
                                setWeeklySchedule((prev) => ({
                                  ...prev,
                                  [selectedScheduleDay]: {
                                    ...prev[selectedScheduleDay],
                                    bedtime: val,
                                  },
                                }));
                                if (selectedScheduleDay === 'mon') {
                                  setBedtime(val);
                                }
                              }}
                              className="w-full min-h-[44px] rounded-xl border border-night-border bg-night-elevated px-3 py-2 text-xs font-semibold text-cream-primary outline-none focus:border-status-amber"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-medium text-cream-muted mb-1">
                              Wake Time (24h)
                            </label>
                            <input
                              type="time"
                              required
                              value={weeklySchedule[selectedScheduleDay]?.wake_time || '07:00'}
                              onChange={(e) => {
                                const val = e.target.value;
                                setWeeklySchedule((prev) => ({
                                  ...prev,
                                  [selectedScheduleDay]: {
                                    ...prev[selectedScheduleDay],
                                    wake_time: val,
                                  },
                                }));
                                if (selectedScheduleDay === 'mon') {
                                  setWakeTime(val);
                                }
                              }}
                              className="w-full min-h-[44px] rounded-xl border border-night-border bg-night-elevated px-3 py-2 text-xs font-semibold text-cream-primary outline-none focus:border-status-amber"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Compact 7-Day Summary Preview */}
                  <div className="rounded-xl border border-night-border bg-night-surface/60 p-2.5 text-[11px] text-cream-muted">
                    <span className="font-semibold text-cream-secondary block mb-1.5 flex items-center justify-between">
                      <span>7-Day Routine Summary:</span>
                      <span className="text-[10px] font-normal text-cream-muted">
                        {schedulePreset === 'everyday' ? 'Single Daily Schedule' : schedulePreset === 'weekdays_weekends' ? 'Weekday / Weekend Preset' : 'Custom Daily Schedule'}
                      </span>
                    </span>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 tabular-nums text-[10px]">
                      {DAY_KEYS.map((k) => (
                        <span key={`summary-${k}`} className="rounded bg-night-elevated/80 px-1.5 py-1 border border-night-border/40 truncate">
                          <strong className="text-cream-primary">{DAY_LABELS[k].short}:</strong>{' '}
                          {weeklySchedule[k]?.bedtime || '--'} → {weeklySchedule[k]?.wake_time || '--'}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Timezone Selector */}
                <div>
                  <label className="block text-xs font-medium text-cream-secondary mb-1">
                    Your Timezone (GMT Offset)
                  </label>
                  <TimezoneSelect
                    value={timezone}
                    onChange={setTimezone}
                    compact={true}
                    selectClassName="w-full min-h-[44px] rounded-xl border border-night-border bg-night-elevated px-3 py-2 text-xs text-cream-primary outline-none focus:border-status-amber"
                  />
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

                </>
              )}
                {/* Save Button */}
                <div className="flex gap-2 pt-2">
                  <button
                    type="submit"
                    disabled={loading || (view === 'edit' && !isJournalValid)}
                    className="flex-1 h-11 min-h-[44px] rounded-xl bg-status-amber font-semibold text-xs text-night-bg hover:bg-status-amber/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 px-4 whitespace-nowrap"
                  >
                    {loading ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        <span>Saving...</span>
                      </>
                    ) : view === 'schedule' && hasScheduleChanged ? (
                      <span>Queue 48h Schedule Change</span>
                    ) : (
                      <span>{view === 'edit' ? 'Save profile' : 'Save schedule'}</span>
                    )}
                  </button>
                </div>
            </form>

          </div>
        )}
    </ResponsiveDialog>
  );
}
