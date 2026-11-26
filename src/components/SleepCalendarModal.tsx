'use client';

import { ResponsiveDialog } from '@/components/ResponsiveDialog';
import { MemberPunishmentList } from '@/components/PunishmentList';
import { MemberMetastrikeHistory } from '@/components/MemberMetastrikeHistory';
import { StrikeDayDetails, StrikeHistoryList, type StrikeHistoryEntry, type StrikeHistoryMonth } from '@/components/StrikeHistory';
import React, { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react';
import {
  X,
  ChevronLeft,
  ChevronRight,
  Flame,
  Clock,
  BedDouble,
  Sun,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Star,
  ExternalLink,
  Shield,
  Zap,
  Moon,
  Edit3,
} from 'lucide-react';
import { DateTime } from 'luxon';
import { computeMemberState, getMemberCalendarDate, isOverdueBucket, type SleepBucket } from '@/lib/sleepEngine';
import { FoxMascot } from './FoxMascot';
import type { Member, SleepLog, WeeklySchedule } from '@/lib/db';
import {
  formatGmtOffset,
  DayKey,
  DAY_KEYS,
  WEEKDAY_TO_DAY_KEY,
} from '@/lib/timezone';

const DAY_LABELS: Record<DayKey, { short: string; full: string }> = {
  mon: { short: 'Mon', full: 'Monday' },
  tue: { short: 'Tue', full: 'Tuesday' },
  wed: { short: 'Wed', full: 'Wednesday' },
  thu: { short: 'Thu', full: 'Thursday' },
  fri: { short: 'Fri', full: 'Friday' },
  sat: { short: 'Sat', full: 'Saturday' },
  sun: { short: 'Sun', full: 'Sunday' },
};

interface MonthlySummary {
  totalLoggedNights: number;
  avgDurationMinutes: number | null;
  avgBedtime: string | null;
  avgWakeTime: string | null;
  onTimePercentage: number;
}

interface SleepHistoryData {
  member: {
    id: string;
    name: string;
    avatar: string | null;
    timezone: string;
    bedtime: string;
    wake_time: string;
    current_streak: number;
    weekly_schedule?: WeeklySchedule | null;
    weekend_bedtime_local?: string | null;
    weekend_wake_time_local?: string | null;
    journal_url?: string;
    active_day_key?: DayKey;
    sleep_bucket?: SleepBucket;
    strikes_used?: number;
    strikes_count?: number;
    metastrikes_used?: number;
    metastrikes_count?: number;
  };
  month: string; // "YYYY-MM"
  logs: SleepLog[];
  summary: MonthlySummary;
}

export interface SleepCalendarModalProps {
  isOpen: boolean;
  onClose: () => void;
  memberId: string | null;
  member?: Member | null;
  currentUser?: Member | null;
  onWakeUpUpdated?: () => Promise<void>;
  onToggleStar?: (memberId: string) => void;
  isStarred?: boolean;
  initialTab?: 'calendar' | 'timetable' | 'punishments';
  isMySleep?: boolean;
  onOpenScheduleModal?: () => void;
  accountabilityRevision?: number;
  onMetastrikeChanged?: () => Promise<void>;
  onRequestMetastrike?: (cycle?: string) => void;
}

const DISCORD_JOURNAL_REGEX = /^https:\/\/(ptb\.|canary\.)?discord\.com\/channels\/\d+\/\d+(\/\d+)?$/;

const SLEEP_DAY_STYLE: Record<SleepLog['status'], { label: string; dot: string }> = {
  on_time: { label: 'On-time check-in', dot: 'bg-status-sage' },
  late: { label: 'Late check-in', dot: 'bg-status-coral' },
  missed: { label: 'Missed check-in', dot: 'bg-status-coral' },
  metastrike: { label: 'Metastrike applied', dot: 'bg-status-slumber' },
};

const PROFILE_TABS = [
  { key: 'calendar', label: 'Calendar' },
  { key: 'timetable', label: 'Schedule' },
  { key: 'punishments', label: 'Punishments' },
] as const;

export const WEEKDAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Calculates duration between bedtime ("HH:mm") and wake time ("HH:mm") across midnight.
 */
function calculatePlannedDuration(bedtime: string, wakeTime: string): { hours: number; minutes: number; text: string } {
  try {
    const [bH, bM] = bedtime.split(':').map(Number);
    const [wH, wM] = wakeTime.split(':').map(Number);
    const bTotal = (isNaN(bH) ? 23 : bH) * 60 + (isNaN(bM) ? 0 : bM);
    let wTotal = (isNaN(wH) ? 7 : wH) * 60 + (isNaN(wM) ? 0 : wM);
    if (wTotal <= bTotal) {
      wTotal += 1440;
    }
    const diff = wTotal - bTotal;
    const hours = Math.floor(diff / 60);
    const minutes = diff % 60;
    return {
      hours,
      minutes,
      text: minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`,
    };
  } catch {
    return { hours: 8, minutes: 0, text: '8h' };
  }
}

/**
 * Formats "HH:mm" 24h string into gentle readable 12h time (e.g. "11:00 PM").
 */
function format12Hour(timeStr?: string | null): string {
  if (!timeStr) return '--:--';
  const parts = timeStr.split(':');
  if (parts.length < 2) return timeStr;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return timeStr;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const displayH = h % 12 === 0 ? 12 : h % 12;
  return `${displayH}:${String(m).padStart(2, '0')} ${ampm}`;
}

/**
 * Comprehensive Member Profile, Sleep Consistency Calendar, and Weekly Timetable Modal.
 * Provides member profile overview, interactive month calendar with streaks,
 * and 7-day schedule breakdown.
 */
export function SleepCalendarModal({
  isOpen,
  onClose,
  memberId,
  member: initialMember,
  currentUser,
  onWakeUpUpdated,
  onToggleStar,
  isStarred = false,
  initialTab = 'calendar',
  isMySleep = false,
  onOpenScheduleModal,
  accountabilityRevision = 0,
  onMetastrikeChanged,
  onRequestMetastrike,
}: SleepCalendarModalProps) {
  const [data, setData] = useState<SleepHistoryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(initialTab);
  const [strikeHistory, setStrikeHistory] = useState<{
    memberId: string;
    month: string;
    view: string;
    viewerId?: string;
    data: StrikeHistoryMonth | null;
  } | null>(null);
  const [strikeHistoryRetry, setStrikeHistoryRetry] = useState(0);
  const dayDetailsRef = useRef<HTMLElement>(null);
  const [focusRequest, setFocusRequest] = useState<{ memberId: string | null; date: string } | null>(null);

  // The existing roster sync delivers current totals to an open My Sleep panel.
  const punishmentSnapshot = [
    memberId, initialMember?.strike_cycle_month, initialMember?.strikes_used,
    initialMember?.metastrikes_used, initialMember?.open_punishment_count,
  ].join(':');

  const activeTargetId = memberId || initialMember?.id || null;
  const isViewer = Boolean(activeTargetId && currentUser?.id === activeTargetId);
  const rosterMember = initialMember?.id === activeTargetId ? initialMember : null;
  const liveMember = rosterMember ?? (isViewer ? currentUser : null);
  const apiMember = data?.member?.id === activeTargetId ? data.member : null;
  const calendarTimezone = liveMember?.timezone ?? apiMember?.timezone;
  const now = DateTime.utc();
  const { localNow, today, month: localMonth } = getMemberCalendarDate(calendarTimezone, now);
  const [monthChoice, setMonthChoice] = useState<{ memberId: string | null; month: string } | null>(null);
  const chosenMonth = monthChoice?.memberId === activeTargetId ? monthChoice.month : undefined;
  const loadedDefaultMonth = !liveMember?.timezone && apiMember ? data?.month : undefined;
  const currentMonth = chosenMonth ?? loadedDefaultMonth ?? localMonth;
  // The endpoint uses the target's timezone when a profile opens without roster data.
  const requestMonth = chosenMonth ?? (liveMember?.timezone ? localMonth : undefined);

  const requestSeqRef = useRef(0);

  // Selected date ("YYYY-MM-DD") in the calendar inspector
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Inline wake-up time edit state
  const [isEditingWakeTime, setIsEditingWakeTime] = useState(false);
  const [editWakeTime, setEditWakeTime] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSuccess, setEditSuccess] = useState<string | null>(null);

  // Light haptic feedback helper
  const triggerHaptic = (ms = 15) => {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(ms);
      } catch {
        // Ignore vibration errors
      }
    }
  };

  // Sync initial tab when modal opens or prop changes
  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  // Fetch sleep history from API
  const fetchHistory = useCallback(
    async (mId: string, monthStr?: string, background = false) => {
      const requestId = ++requestSeqRef.current;
      if (!background) {
        setLoading(true);
        setError(null);
      }
      try {
        const params = new URLSearchParams({ memberId: mId });
        if (monthStr) params.set('month', monthStr);
        const res = await fetch(`/api/members/sleep-history?${params}`, { cache: 'no-store' });
        const json = await res.json();
        if (requestSeqRef.current !== requestId) {
          return;
        }
        if (!res.ok) {
          throw new Error(json.error || 'Failed to load sleep history');
        }
        setData(json);
        setError(null);
      } catch (err: unknown) {
        if (requestSeqRef.current === requestId) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          setError(message);
        }
      } finally {
        if (requestSeqRef.current === requestId) {
          setLoading(false);
        }
      }
    },
    []
  );

  const initialFingerprint = initialMember
    ? `${initialMember.id}_${initialMember.strikes_used}_${initialMember.strikes_count}_${initialMember.metastrikes_used}_${initialMember.metastrikes_count}_${initialMember.strike_cycle_month}`
    : null;

  const privateRosterMember = isMySleep && currentUser?.id === activeTargetId && activeTab === 'calendar' ? initialMember : null;
  const prevRosterMemberRef = useRef(privateRosterMember);
  const prevAccountabilityRef = useRef(accountabilityRevision);
  const prevTargetIdRef = useRef<string | null>(null);
  const prevFingerprintRef = useRef<string | null>(null);
  const prevMonthRef = useRef(requestMonth);
  const prevIsOpenRef = useRef<boolean>(false);

  useEffect(() => {
    if (!isOpen || !activeTargetId) {
      requestSeqRef.current += 1;
      prevTargetIdRef.current = null;
      prevFingerprintRef.current = null;
      prevIsOpenRef.current = isOpen;
      setMonthChoice(null);
      return;
    }

    const justOpened = !prevIsOpenRef.current && isOpen;
    const idChanged = prevTargetIdRef.current !== activeTargetId;
    const fingerprintChanged = prevFingerprintRef.current !== initialFingerprint;
    const monthChanged = prevMonthRef.current !== requestMonth;

    const accountabilityChanged = prevRosterMemberRef.current !== privateRosterMember ||
      prevAccountabilityRef.current !== accountabilityRevision;
    prevRosterMemberRef.current = privateRosterMember;
    prevAccountabilityRef.current = accountabilityRevision;
    prevIsOpenRef.current = isOpen;

    if (justOpened || idChanged || fingerprintChanged || monthChanged) {
      prevTargetIdRef.current = activeTargetId;
      prevFingerprintRef.current = initialFingerprint;
      prevMonthRef.current = requestMonth;
      if (justOpened || idChanged) setSelectedDate(null);
      fetchHistory(activeTargetId, requestMonth);
    } else if (privateRosterMember && accountabilityChanged) {
      // A past-cycle approval can change the calendar without changing current-month counters.
      fetchHistory(activeTargetId, requestMonth, true);
    }
  }, [isOpen, activeTargetId, initialFingerprint, requestMonth, fetchHistory, privateRosterMember, accountabilityRevision]);

  // Set default selected date when data changes or month loads
  useEffect(() => {
    if ((apiMember && data?.month === currentMonth) || error) {
      const latestLogDate = apiMember && data?.month === currentMonth ? data.logs.at(-1)?.cycle_date : null;
      setSelectedDate(previous => previous?.startsWith(`${currentMonth}-`) ? previous
        : latestLogDate ?? `${currentMonth}-01`);
    }
  }, [apiMember, data, currentMonth, error]);

  useEffect(() => {
    setIsEditingWakeTime(false);
    setEditError(null);
    setEditSuccess(null);
  }, [activeTargetId, currentMonth]);

  // Navigation handlers
  const navigateMonth = (direction: -1 | 1) => {
    triggerHaptic(10);
    const month = DateTime.fromISO(`${currentMonth}-01`, { zone: 'utc' }).plus({ months: direction }).toFormat('yyyy-MM');
    setMonthChoice({ memberId: activeTargetId, month });
  };

  // Resolved Member profile info (merged from direct prop and API)
  const resolvedProfile = useMemo(() => {
    const base = liveMember;
    const id = activeTargetId ?? '';
    const name = base?.discord_username || apiMember?.name || 'Member';
    const avatar = base?.avatar_url || apiMember?.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(name)}`;
    const timezone = base?.timezone || apiMember?.timezone || 'GMT+00:00';
    const bedtime = base?.bedtime_local || apiMember?.bedtime || '23:00';
    const wakeTime = base?.wake_time_local || apiMember?.wake_time || '07:00';
    const weekendBedtime = base?.weekend_bedtime_local || apiMember?.weekend_bedtime_local || null;
    const weekendWakeTime = base?.weekend_wake_time_local || apiMember?.weekend_wake_time_local || null;
    const streak = typeof apiMember?.current_streak === 'number' ? apiMember.current_streak : (base?.streak_days || 0);
    // Reconcile aliases strictly within a single snapshot: prefer the newer API snapshot when available,
    // otherwise fallback to initialMember base, preserving corrected or decremented counts and monthly resets.
    const activeSnapshot = apiMember || base;
    const strikesUsed = activeSnapshot
      ? Math.max(
          typeof activeSnapshot.strikes_used === 'number' ? activeSnapshot.strikes_used : 0,
          typeof activeSnapshot.strikes_count === 'number' ? activeSnapshot.strikes_count : 0
        )
      : 0;
    const metastrikesUsed = activeSnapshot
      ? Math.max(
          typeof activeSnapshot.metastrikes_used === 'number' ? activeSnapshot.metastrikes_used : 0,
          typeof activeSnapshot.metastrikes_count === 'number' ? activeSnapshot.metastrikes_count : 0
        )
      : 0;
    const weeklySchedule = base?.weekly_schedule || apiMember?.weekly_schedule || null;
    const journalUrl = base?.journal_url || apiMember?.journal_url || '';

    return {
      id,
      name,
      avatar,
      timezone,
      bedtime,
      wakeTime,
      weekendBedtime,
      weekendWakeTime,
      streak,
      strikesUsed,
      metastrikesUsed,
      strikeCountsUnavailable: !apiMember && Boolean(base?.strike_counts_unavailable),
      weeklySchedule,
      journalUrl,
    };
  }, [apiMember, liveMember, activeTargetId]);

  const calendarHistory = Boolean(isOpen && currentUser && activeTab === 'calendar');
  const privateCalendar = calendarHistory && isMySleep && isViewer;
  const historyView = privateCalendar ? 'self' : 'profile';

  useEffect(() => {
    if (!calendarHistory || !activeTargetId) {
      setStrikeHistory(null);
      return;
    }
    // Roster sync refreshes even when a correction only affects a prior month.
    const controller = new AbortController();
    const query = { memberId: activeTargetId, month: currentMonth, view: historyView, viewerId: currentUser?.id };
    const params = new URLSearchParams({ memberId: query.memberId, month: query.month, view: query.view });
    async function loadHistory() {
      try {
        const response = await fetch(`/api/members/strikes?${params}`, { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('Strike history is unavailable');
        const result: StrikeHistoryMonth = await response.json();
        if (!controller.signal.aborted) setStrikeHistory({ ...query, data: result });
      } catch {
        if (!controller.signal.aborted) setStrikeHistory({ ...query, data: null });
      }
    }
    void loadHistory();
    return () => controller.abort();
  }, [calendarHistory, currentUser?.id, historyView, activeTargetId, currentMonth, initialMember, strikeHistoryRetry, accountabilityRevision]);

  const historyForView = calendarHistory && strikeHistory?.viewerId === currentUser?.id &&
    strikeHistory?.view === historyView && strikeHistory?.memberId === activeTargetId &&
    strikeHistory?.month === currentMonth ? strikeHistory : null;
  const visibleStrikeHistory = historyForView?.data;
  const strikeDays = useMemo(() => {
    const days = new Map<string, StrikeHistoryEntry[]>();
    for (const entry of visibleStrikeHistory?.entries ?? []) {
      const day = days.get(entry.cycle_date);
      if (day) day.push(entry);
      else days.set(entry.cycle_date, [entry]);
    }
    return days;
  }, [visibleStrikeHistory]);
  const displayedDate = selectedDate?.startsWith(`${currentMonth}-`) ? selectedDate : `${currentMonth}-01`;
  const selectedStrikeEntries = strikeDays.get(displayedDate);

  useLayoutEffect(() => {
    if (!focusRequest) return;
    const sameSelection = focusRequest.memberId === activeTargetId && focusRequest.date === displayedDate;
    if (!isOpen || activeTab !== 'calendar' || !sameSelection) {
      setFocusRequest(null);
    } else if (dayDetailsRef.current) {
      dayDetailsRef.current.focus();
      setFocusRequest(null);
    }
  }, [focusRequest, isOpen, activeTab, activeTargetId, displayedDate, loading]);

  const selectDay = (date: string) => {
    triggerHaptic(10);
    setSelectedDate(date);
    setIsEditingWakeTime(false);
    setEditError(null);
    setEditSuccess(null);
    setFocusRequest({ memberId: activeTargetId, date });
  };

  // Map of logs keyed on cycle_date
  const logsMap = useMemo(() => {
    const map = new Map<string, SleepLog>();
    if (apiMember && data?.month === currentMonth) {
      for (const log of data.logs) {
        map.set(log.cycle_date, log);
      }
    }
    return map;
  }, [apiMember, data, currentMonth]);

  // Calendar cells generation for 7-column grid
  const calendarCells = useMemo(() => {
    const startOfMonth = DateTime.fromISO(`${currentMonth}-01`);
    if (!startOfMonth.isValid) return [];

    const daysInMonth = startOfMonth.daysInMonth || 30;
    const startWeekdayOffset = startOfMonth.weekday - 1; // 0 for Mon, 6 for Sun

    const cells: Array<{
      type: 'padding' | 'day';
      dayNumber?: number;
      dateStr?: string;
      log?: SleepLog | null;
    }> = [];

    for (let i = 0; i < startWeekdayOffset; i++) {
      cells.push({ type: 'padding' });
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${currentMonth}-${String(day).padStart(2, '0')}`;
      const log = logsMap.get(dateStr) || null;
      cells.push({
        type: 'day',
        dayNumber: day,
        dateStr,
        log,
      });
    }

    return cells;
  }, [currentMonth, logsMap]);

  // Selected log details
  const selectedLog = useMemo(() => {
    return error ? null : logsMap.get(displayedDate) ?? null;
  }, [error, displayedDate, logsMap]);

  // Check if selected date is eligible for self-edit
  const isEligibleForSelfEdit = useMemo(() => {
    if (!currentUser || !resolvedProfile.id || currentUser.id !== resolvedProfile.id || selectedDate !== displayedDate) {
      return false;
    }
    const targetDt = DateTime.fromISO(selectedDate);
    const now = DateTime.now();
    const diffDays = now.startOf('day').diff(targetDt.startOf('day'), 'days').days;
    return diffDays >= 0 && diffDays <= 7;
  }, [currentUser, resolvedProfile.id, selectedDate, displayedDate]);

  const visibleCalendarRef = useRef({ isOpen, memberId: activeTargetId, month: currentMonth, date: displayedDate });
  useLayoutEffect(() => {
    visibleCalendarRef.current = { isOpen, memberId: activeTargetId, month: currentMonth, date: displayedDate };
  }, [isOpen, activeTargetId, currentMonth, displayedDate]);

  // Submit manual wake-up time for selected date
  const handleSaveWakeTime = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDate || !editWakeTime || !currentUser) return;

    setEditSubmitting(true);
    setEditError(null);
    setEditSuccess(null);
    triggerHaptic(20);

    try {
      const res = await fetch('/api/members/wake-up', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memberId: currentUser.id,
          mode: 'manual',
          wokeUpTime: editWakeTime,
          cycleDate: selectedDate,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Failed to update wake time');
      }

      const view = visibleCalendarRef.current;
      if (view.isOpen && view.memberId === currentUser.id) {
        if (view.date === selectedDate) {
          setEditSuccess(
            json.formatted_duration
              ? `Logged! Sleep duration: ${json.formatted_duration}.`
              : 'Wake-up time updated successfully!'
          );
          setIsEditingWakeTime(false);
          setEditWakeTime('');
        }
        await fetchHistory(view.memberId, view.month, true);
      }
      if (onWakeUpUpdated) {
        await onWakeUpUpdated();
      }
    } catch (err: unknown) {
      const view = visibleCalendarRef.current;
      if (view.isOpen && view.memberId === currentUser.id && view.date === selectedDate) {
        setEditError(err instanceof Error ? err.message : 'Unknown error');
      }
    } finally {
      setEditSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const timezone = formatGmtOffset(resolvedProfile.timezone);
  const state = liveMember ? computeMemberState(liveMember, resolvedProfile.timezone, now) : null;
  const bucket = state?.bucket ?? apiMember?.sleep_bucket;
  const sleepStatus = bucket === 'SLEEPING' ? 'Sleeping'
    : bucket === 'WINDING_DOWN' ? 'Winding down'
      : isOverdueBucket(bucket) ? 'Overdue'
        : bucket === 'AWAKE' ? 'Awake' : 'Status unavailable';
  const currentDayKey = apiMember?.active_day_key ?? state?.dayKey ?? WEEKDAY_TO_DAY_KEY[localNow.weekday];
  const monthTitle = DateTime.fromISO(`${currentMonth}-01`).toFormat('MMMM yyyy');
  const monthSummary = !loading && !error && apiMember && data?.month === currentMonth ? data.summary : null;

  return (
    <ResponsiveDialog labelledBy="sleep-calendar-title" onClose={onClose}
      className="px-1 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] max-[349px]:[scrollbar-width:none] min-[350px]:px-2 min-[390px]:px-3 sm:px-5 md:max-w-2xl md:p-6 lg:max-w-5xl">
        <header className="border-b border-night-border pb-3">
          <div className="flex items-start gap-3">
            {isMySleep ? (
              <FoxMascot state="lantern" size={40} className="shrink-0" />
            ) : (
              <img src={resolvedProfile.avatar} alt=""
                className="h-10 w-10 shrink-0 rounded-full bg-night-elevated object-cover" />
            )}
            <div className="min-w-0 flex-1 self-center">
              <h2 id="sleep-calendar-title" className="text-lg font-bold leading-tight [overflow-wrap:anywhere]">
                {isMySleep ? 'My Sleep' : resolvedProfile.name}
              </h2>
              {!isMySleep && (
                <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-sm text-cream-secondary">
                  <span className={sleepStatus === 'Overdue' ? 'font-semibold text-status-coral'
                    : sleepStatus === 'Winding down' ? 'font-semibold text-status-amber' : 'font-semibold text-cream-primary'}>
                    {sleepStatus}
                  </span>
                  {calendarTimezone && <span className="tabular-nums">{localNow.toFormat('h:mm a')} local · {timezone}</span>}
                </p>
              )}
            </div>
            <button type="button" onClick={onClose}
              className="grid min-h-[44px] min-w-[44px] shrink-0 place-items-center rounded-xl text-cream-secondary hover:bg-night-elevated hover:text-cream-primary"
              aria-label={isMySleep ? 'Close My Sleep' : 'Close member profile'}>
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          {isMySleep ? (
            <section aria-labelledby="tonight-title" className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl bg-night-elevated px-3 py-2">
              <h3 id="tonight-title" className="text-sm font-semibold">Tonight</h3>
              <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums">
                <div className="flex flex-wrap items-baseline gap-x-1.5">
                  <dt className="text-cream-secondary">Bedtime</dt>
                  <dd className="font-semibold">{format12Hour(state?.activeBedtimeLocal ?? resolvedProfile.bedtime)}</dd>
                </div>
                <div className="flex flex-wrap items-baseline gap-x-1.5">
                  <dt className="text-cream-secondary">Wake</dt>
                  <dd className="font-semibold">{format12Hour(state?.activeWakeTimeLocal ?? resolvedProfile.wakeTime)}</dd>
                </div>
              </dl>
            </section>
          ) : (
            <div className="mt-1 flex flex-wrap items-center gap-x-2">
              {DISCORD_JOURNAL_REGEX.test(resolvedProfile.journalUrl) && (
                <a href={resolvedProfile.journalUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-lg px-2 text-sm font-semibold text-status-amber hover:bg-night-elevated">
                  <ExternalLink className="h-4 w-4" aria-hidden="true" /> Open journal
                </a>
              )}
              {onToggleStar && resolvedProfile.id && (
                <button type="button" onClick={() => {
                  triggerHaptic(10);
                  onToggleStar(resolvedProfile.id);
                }} aria-label="Star member" aria-pressed={isStarred}
                  className={`grid min-h-[44px] min-w-[44px] place-items-center rounded-lg hover:bg-night-elevated ${isStarred ? 'text-status-amber' : 'text-cream-secondary'}`}>
                  <Star className={`h-4 w-4 ${isStarred ? 'fill-current' : ''}`} aria-hidden="true" />
                </button>
              )}
            </div>
          )}

          <div role="group" aria-label={isMySleep ? 'My Sleep views' : 'Profile views'}
            className="mt-2 flex gap-1 rounded-xl bg-night-elevated p-1">
            {PROFILE_TABS.filter(tab => tab.key !== 'punishments' || (isMySleep && isViewer)).map(tab => (
              <button key={tab.key} type="button" aria-pressed={activeTab === tab.key}
                aria-controls="sleep-view-panel" onClick={() => {
                  triggerHaptic(10);
                  setActiveTab(tab.key);
                }}
                className={`min-h-[44px] min-w-0 flex-1 rounded-lg px-1.5 text-sm font-semibold [overflow-wrap:anywhere] ${activeTab === tab.key
                  ? 'bg-status-amber text-night-bg' : 'text-cream-secondary hover:text-cream-primary'}`}>
                {tab.label}
              </button>
            ))}
          </div>
        </header>

        <div id="sleep-view-panel">
        {activeTab === 'punishments' && isMySleep && isViewer && memberId && (
          <div className="mt-4"><MemberPunishmentList key={punishmentSnapshot} memberId={memberId}
            rosterMember={initialMember} accountabilityRevision={accountabilityRevision} /></div>
        )}

        {activeTab === 'calendar' && (
          <div className="mt-2 space-y-4">
            <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
              <section aria-label="Sleep calendar" className="min-w-0">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <button type="button" aria-label="Previous month" onClick={() => navigateMonth(-1)}
                    className="grid min-h-[44px] min-w-[44px] place-items-center rounded-lg text-cream-secondary hover:bg-night-elevated hover:text-cream-primary">
                    <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                  </button>
                  <h3 aria-live="polite" className="text-center text-sm font-bold">{monthTitle}</h3>
                  <button type="button" aria-label="Next month" onClick={() => navigateMonth(1)}
                    className="grid min-h-[44px] min-w-[44px] place-items-center rounded-lg text-cream-secondary hover:bg-night-elevated hover:text-cream-primary">
                    <ChevronRight className="h-5 w-5" aria-hidden="true" />
                  </button>
                </div>
                {loading && <p role="status" className="py-6 text-center text-sm text-cream-secondary">Loading sleep logs…</p>}
                {error && (
                  <div className="flex flex-wrap items-center justify-between gap-x-3 rounded-xl border border-status-coral/40 bg-status-coral/10 px-3 py-2">
                    <p role="alert" className="text-sm text-status-coral [overflow-wrap:anywhere]">{error}</p>
                    {activeTargetId && (
                      <button type="button" onClick={() => void fetchHistory(activeTargetId, calendarTimezone ? currentMonth : requestMonth)}
                        className="min-h-[44px] text-sm font-semibold text-status-amber underline">
                        Retry sleep logs
                      </button>
                    )}
                  </div>
                )}

                {!loading && !error && (
                  <>
                    <div className="mb-1 grid grid-cols-7 text-center min-[350px]:gap-x-0.5 sm:gap-1">
                      {WEEKDAY_HEADERS.map(day => (
                        <span key={day} className="py-0.5 text-xs font-medium text-cream-secondary">{day}</span>
                      ))}
                    </div>
                    <div className="grid grid-cols-7 gap-y-0.5 min-[350px]:gap-x-0.5 sm:gap-1">
                      {calendarCells.map((cell, index) => {
                        const date = cell.dateStr;
                        if (!date) return <div key={`padding-${index}`} aria-hidden="true" />;

                        const isSelected = displayedDate === date;
                        const isToday = today === date;
                        const log = cell.log;
                        const sleep = log ? SLEEP_DAY_STYLE[log.status] : null;
                        const strikeEntries = strikeDays.get(date);
                        const hasStrike = strikeEntries?.some(entry => entry.record_type === 'strike');
                        const hasPass = strikeEntries?.some(entry => entry.record_type === 'metastrike');
                        const dateLabel = [
                          DateTime.fromISO(date).toFormat('LLLL d'),
                          sleep?.label ?? 'No sleep activity recorded',
                          log?.woke_up_local_time ? 'Wake logged' : null,
                          hasStrike ? 'Strike history' : null,
                          hasPass ? 'Metastrike history' : null,
                        ].filter(Boolean).join(', ');

                        return (
                          <button key={date} type="button" aria-pressed={isSelected}
                            aria-current={isToday ? 'date' : undefined} aria-controls="selected-sleep-night"
                            aria-label={dateLabel} onClick={() => selectDay(date)}
                            className={`relative flex min-h-[44px] min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg border px-0.5 text-sm font-semibold tabular-nums ${isSelected
                              ? 'border-status-amber bg-status-amber/15 text-cream-primary'
                              : 'border-transparent bg-night-elevated/70 text-cream-secondary hover:border-night-border hover:text-cream-primary'}`}>
                            <span className={isToday ? 'rounded-full bg-cream-primary px-1.5 text-night-bg' : ''}>
                              {cell.dayNumber}
                            </span>
                            <span aria-hidden="true" className="flex h-3.5 items-center gap-0.5">
                              {sleep && <span className={`h-1.5 w-1.5 rounded-full ${sleep.dot}`} />}
                              {hasStrike && <Zap className="h-3 w-3 text-fox-rust" />}
                              {hasPass && <Shield className="h-3 w-3 text-status-amber" />}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </section>

              {/* Selected Day Inspector Card */}
              {!loading && (
                <section id="selected-sleep-night" ref={dayDetailsRef} tabIndex={-1} aria-labelledby="selected-sleep-date"
                  className="flex min-w-0 flex-col gap-3 rounded-xl bg-night-elevated p-3 focus-visible:outline-2 focus-visible:outline-status-amber lg:col-start-2 lg:row-start-1 lg:row-span-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-night-border pb-2">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-status-amber" />
                      <h3 id="selected-sleep-date" className="text-sm font-bold text-cream-primary">
                        {DateTime.fromISO(displayedDate).toFormat('cccc, LLLL d, yyyy')}
                      </h3>
                    </div>

                    {selectedLog?.wake_source && (
                      <span className="rounded-full bg-night-surface border border-night-border px-2 py-0.5 text-[10px] font-semibold text-cream-secondary">
                        {selectedLog.wake_source === 'button' ? 'Instant wake' : 'Manual wake'}
                      </span>
                    )}
                  </div>

                  {selectedLog ? (
                    <div className="space-y-2">
                      <p className="text-sm text-cream-secondary">{SLEEP_DAY_STYLE[selectedLog.status]?.label}</p>
                      <dl className="grid grid-cols-2 gap-x-2 gap-y-3 text-sm tabular-nums">
                        <div>
                          <dt className="text-xs font-semibold text-cream-secondary">Checked in</dt>
                          <dd className="font-bold">{selectedLog.in_bed_local_time || '—'}</dd>
                          <dd className="text-xs text-cream-secondary">Target {selectedLog.target_bedtime || resolvedProfile.bedtime}</dd>
                        </div>
                        <div>
                          <dt className="text-xs font-semibold text-cream-secondary">Woke up</dt>
                          <dd className="font-bold">{selectedLog.woke_up_local_time || '—'}</dd>
                          <dd className="text-xs text-cream-secondary">Target {selectedLog.target_wake_time || resolvedProfile.wakeTime}</dd>
                        </div>
                        <div className="col-span-2">
                          <dt className="text-xs font-semibold text-cream-secondary">Sleep duration</dt>
                          <dd className="font-bold text-status-amber">
                            {selectedLog.duration_minutes != null
                              ? `${Math.floor(selectedLog.duration_minutes / 60)}h ${selectedLog.duration_minutes % 60}m`
                              : '—'}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  ) : (
                    <p className="text-sm text-cream-secondary">
                      {error ? 'Sleep logs are unavailable for this night.' : 'No sleep activity recorded for this night.'}
                    </p>
                  )}

                  {selectedStrikeEntries && visibleStrikeHistory && (
                    <StrikeDayDetails entries={selectedStrikeEntries} timezone={visibleStrikeHistory.timezone} />
                  )}

                  {/* Self-Edit Action for Current User */}
                  {isEligibleForSelfEdit && (
                    <div className="mt-1 pt-2 border-t border-night-border/50">
                      {!isEditingWakeTime ? (
                        <button
                          type="button"
                          onClick={() => {
                            triggerHaptic(10);
                            setEditWakeTime(selectedLog?.woke_up_local_time || '07:30');
                            setIsEditingWakeTime(true);
                            setEditError(null);
                            setEditSuccess(null);
                          }}
                          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-status-amber/40 bg-status-amber/15 px-3 py-2 text-xs font-semibold text-status-amber hover:bg-status-amber/25 active:scale-95 transition-all min-h-[44px] whitespace-nowrap shrink-0"
                        >
                          <Sun className="h-3.5 w-3.5" />
                          <span>{selectedLog?.woke_up_local_time ? 'Edit Wake-Up Time' : 'Log Wake-Up Time'}</span>
                        </button>
                      ) : (
                        <form onSubmit={handleSaveWakeTime} className="flex flex-col gap-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <label htmlFor="manual-wake-input" className="text-xs font-semibold text-cream-secondary">
                              Enter wake time:
                            </label>
                            <input
                              id="manual-wake-input"
                              type="time"
                              value={editWakeTime}
                              onChange={(e) => setEditWakeTime(e.target.value)}
                              required
                              className="rounded-lg border border-night-border bg-night-surface px-2.5 py-1.5 text-sm text-cream-primary font-mono focus:border-status-amber focus:outline-none min-h-[44px]"
                            />
                            <button
                              type="submit"
                              disabled={editSubmitting}
                              className="rounded-lg bg-status-amber px-3.5 py-1.5 text-xs font-bold text-night-bg hover:bg-status-amber/90 active:scale-95 transition-all min-h-[44px] whitespace-nowrap shrink-0"
                            >
                              {editSubmitting ? 'Saving...' : 'Save Wake Time'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setIsEditingWakeTime(false);
                                setEditError(null);
                              }}
                              className="rounded-lg border border-night-border bg-night-surface px-3 py-1.5 text-xs font-medium text-cream-secondary hover:text-cream-primary min-h-[44px] whitespace-nowrap shrink-0"
                            >
                              Cancel
                            </button>
                          </div>

                          {editError && (
                            <p role="alert" className="text-sm text-status-coral flex items-center gap-1">
                              <AlertCircle className="h-3.5 w-3.5" />
                              <span>{editError}</span>
                            </p>
                          )}
                        </form>
                      )}

                      {editSuccess && (
                        <p role="status" className="text-sm text-status-sage mt-2 flex items-center gap-1">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span>{editSuccess}</span>
                        </p>
                      )}
                    </div>
                  )}
                  {privateCalendar && onRequestMetastrike && (
                    <button type="button" onClick={() => onRequestMetastrike(selectedDate === displayedDate ? selectedDate : undefined)}
                      className="inline-flex min-h-[44px] items-center gap-2 self-start rounded-lg border border-status-amber/40 px-3 text-sm font-semibold text-status-amber hover:bg-night-surface">
                      <Shield className="h-4 w-4 shrink-0" aria-hidden="true" /> Request Metastrike
                    </button>
                  )}
                </section>
              )}

              {monthSummary && (
                <section aria-label="Monthly sleep summary" className="space-y-2 border-y border-night-border py-2 lg:col-start-1 lg:row-start-2">
                  {strikeDays.size > 0 && (
                    <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-cream-secondary">
                      <span className="inline-flex items-center gap-1"><Zap className="h-3.5 w-3.5 text-fox-rust" aria-hidden="true" /> Strike history</span>
                      <span className="inline-flex items-center gap-1"><Shield className="h-3.5 w-3.5 text-status-amber" aria-hidden="true" /> Metastrike history</span>
                    </p>
                  )}
                  <dl className="grid grid-cols-3 gap-x-2 text-sm tabular-nums">
                    <div>
                      <dt className="text-xs text-cream-secondary">Avg. sleep</dt>
                      <dd className="font-semibold">{monthSummary.avgDurationMinutes !== null
                        ? `${Math.floor(monthSummary.avgDurationMinutes / 60)}h ${monthSummary.avgDurationMinutes % 60}m` : '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-cream-secondary">Avg. bed / wake</dt>
                      <dd className="font-semibold">{monthSummary.avgBedtime && monthSummary.avgWakeTime
                        ? `${monthSummary.avgBedtime} / ${monthSummary.avgWakeTime}` : '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-cream-secondary">On time</dt>
                      <dd className="font-semibold">{monthSummary.totalLoggedNights ? `${monthSummary.onTimePercentage}%` : '—'}</dd>
                    </div>
                  </dl>
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-cream-secondary">
                    <span className="inline-flex items-center gap-1.5">
                      <Flame className="h-3.5 w-3.5 text-status-amber" aria-hidden="true" /> {resolvedProfile.streak}-day streak
                    </span>
                    {!isMySleep && (resolvedProfile.strikeCountsUnavailable
                      ? <span>Strike and pass counts unavailable</span>
                      : <><span>Monthly strikes {resolvedProfile.strikesUsed}</span><span>Metastrikes {resolvedProfile.metastrikesUsed}/3</span></>)}
                  </p>
                </section>
              )}
            </div>

            {calendarHistory && (
              <StrikeHistoryList days={strikeDays} selectedDate={displayedDate} loading={!historyForView}
                failed={historyForView?.data === null} onRetry={() => {
                  setStrikeHistory(null);
                  setStrikeHistoryRetry(value => value + 1);
                }} onSelectDay={selectDay} />
            )}
            {privateCalendar && (
              <MemberMetastrikeHistory key={`${activeTargetId}:${currentMonth}`} month={currentMonth}
                member={initialMember} refreshVersion={accountabilityRevision} onChanged={onMetastrikeChanged} />
            )}
          </div>
        )}

        {/* Tab 2: Weekly Timetable View */}
        {activeTab === 'timetable' && (
          <div className="mt-4 flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-cream-primary">
                  Weekly schedule
                </h3>
                <p className="text-xs text-cream-secondary mt-0.5">
                  Times shown in {resolvedProfile.timezone} ({timezone}).
                </p>
              </div>

              {isViewer && onOpenScheduleModal && (
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(10);
                    onOpenScheduleModal();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-status-amber/40 bg-status-amber/15 px-3 py-1.5 text-xs font-semibold text-status-amber hover:bg-status-amber/25 transition-all min-h-[44px] whitespace-nowrap shrink-0"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  <span>Edit Schedule</span>
                </button>
              )}
            </div>

            {/* 7-Day Timetable Cards Grid */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-7">
              {DAY_KEYS.map((k) => {
                const isToday = currentDayKey === k;
                const isWeekend = k === 'fri' || k === 'sat';
                const daySched = resolvedProfile.weeklySchedule?.[k] || {
                  bedtime: isWeekend && resolvedProfile.weekendBedtime ? resolvedProfile.weekendBedtime : resolvedProfile.bedtime,
                  wake_time: isWeekend && resolvedProfile.weekendWakeTime ? resolvedProfile.weekendWakeTime : resolvedProfile.wakeTime,
                };
                const planned = calculatePlannedDuration(daySched.bedtime, daySched.wake_time);

                return (
                  <div
                    key={`timetable-${resolvedProfile.id}-${k}`}
                    className={`rounded-2xl border p-3 flex flex-col justify-between gap-2.5 transition-all ${
                      isToday
                        ? 'border-status-amber bg-status-amber/15 shadow-md shadow-status-amber/10 ring-1 ring-status-amber/40'
                        : 'border-night-border/80 bg-night-elevated/50'
                    }`}
                  >
                    {/* Header: Day Name + Today Badge */}
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col">
                        <span className="text-xs font-bold text-cream-primary uppercase">
                          {DAY_LABELS[k].short}
                        </span>
                        <span className="text-[10px] text-cream-muted hidden sm:inline">
                          {DAY_LABELS[k].full}
                        </span>
                      </div>

                      {isToday && (
                        <span className="rounded-full bg-status-amber px-2 py-0.5 text-[9px] font-bold text-night-bg shadow">
                          TODAY
                        </span>
                      )}
                      {!isToday && isWeekend && (
                        <span className="rounded bg-night-surface border border-night-border px-1.5 py-0.5 text-[9px] font-medium text-cream-muted">
                          Weekend
                        </span>
                      )}
                    </div>

                    {/* Times */}
                    <div className="flex flex-col gap-1.5 pt-1 border-t border-night-border/40">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-[10px] text-cream-muted flex items-center gap-1">
                          <Moon className="h-3 w-3 text-status-amber" />
                          <span>Bed</span>
                        </span>
                        <span className="font-mono font-bold text-cream-primary tabular-nums">
                          {daySched.bedtime}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-xs">
                        <span className="text-[10px] text-cream-muted flex items-center gap-1">
                          <Sun className="h-3 w-3 text-status-amber" />
                          <span>Wake</span>
                        </span>
                        <span className="font-mono font-bold text-cream-primary tabular-nums">
                          {daySched.wake_time}
                        </span>
                      </div>
                    </div>

                    {/* Sleep Duration Target */}
                    <div className="pt-1 border-t border-night-border/40 text-center">
                      <span className="text-[10px] font-medium text-cream-secondary">
                        Target: <strong className="text-status-amber tabular-nums">{planned.text}</strong>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

          </div>
        )}
        </div>
    </ResponsiveDialog>
  );
}
