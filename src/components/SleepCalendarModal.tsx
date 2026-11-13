'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
  Calendar as CalendarIcon,
  Star,
  ExternalLink,
  Shield,
  Zap,
  Moon,
  Check,
  Edit3,
} from 'lucide-react';
import { DateTime } from 'luxon';
import { FoxMascot } from './FoxMascot';
import type { Member, SleepLog, WeeklySchedule } from '@/lib/db';
import {
  formatGmtOffset,
  toValidLuxonZone,
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
    discord_handle?: string | null;
    avatar: string | null;
    timezone: string;
    bedtime: string;
    wake_time: string;
    current_streak: number;
    weekly_schedule?: WeeklySchedule | null;
    weekend_bedtime_local?: string | null;
    weekend_wake_time_local?: string | null;
    journal_url?: string;
    role?: string;
    is_in_bed?: boolean;
    is_woke_up?: boolean;
    strikes_count?: number;
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
  initialTab?: 'calendar' | 'timetable';
  onOpenScheduleModal?: () => void;
}

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
  onOpenScheduleModal,
}: SleepCalendarModalProps) {
  const [data, setData] = useState<SleepHistoryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'calendar' | 'timetable'>(initialTab);

  // Active month in "YYYY-MM" format
  const [currentMonth, setCurrentMonth] = useState<string>(() => {
    return DateTime.now().toFormat('yyyy-MM');
  });

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
    async (mId: string, monthStr: string) => {
      const requestId = ++requestSeqRef.current;
      setLoading(true);
      setError(null);
      setData(null);
      try {
        const res = await fetch(
          `/api/members/sleep-history?memberId=${encodeURIComponent(mId)}&month=${encodeURIComponent(monthStr)}`
        );
        const json = await res.json();
        if (requestSeqRef.current !== requestId) {
          return;
        }
        if (!res.ok) {
          throw new Error(json.error || 'Failed to load sleep history');
        }
        setData(json);
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

  useEffect(() => {
    if (isOpen && memberId) {
      fetchHistory(memberId, currentMonth);
    }
  }, [isOpen, memberId, currentMonth, fetchHistory]);

  // Set default selected date when data changes or month loads
  useEffect(() => {
    if (data && data.logs.length > 0) {
      const latestLog = data.logs[data.logs.length - 1];
      setSelectedDate(latestLog.cycle_date);
    } else if (isOpen) {
      setSelectedDate(`${currentMonth}-01`);
    }
    setIsEditingWakeTime(false);
    setEditError(null);
    setEditSuccess(null);
  }, [data, currentMonth, isOpen]);

  // Navigation handlers
  const handlePrevMonth = () => {
    triggerHaptic(10);
    const dt = DateTime.fromISO(`${currentMonth}-01`);
    setCurrentMonth(dt.minus({ months: 1 }).toFormat('yyyy-MM'));
  };

  const handleNextMonth = () => {
    triggerHaptic(10);
    const dt = DateTime.fromISO(`${currentMonth}-01`);
    setCurrentMonth(dt.plus({ months: 1 }).toFormat('yyyy-MM'));
  };

  // Resolved Member profile info (merged from direct prop and API)
  const resolvedProfile = useMemo(() => {
    const apiMember = data?.member;
    const base = initialMember;
    const id = memberId || base?.id || apiMember?.id || '';
    const name = base?.discord_username || apiMember?.name || 'Member';
    const handle = base?.discord_handle || apiMember?.discord_handle || (name ? `@${name.toLowerCase()}` : '');
    const avatar = base?.avatar_url || apiMember?.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(name)}`;
    const timezone = base?.timezone || apiMember?.timezone || 'GMT+00:00';
    const bedtime = base?.bedtime_local || apiMember?.bedtime || '23:00';
    const wakeTime = base?.wake_time_local || apiMember?.wake_time || '07:00';
    const weekendBedtime = base?.weekend_bedtime_local || apiMember?.weekend_bedtime_local || null;
    const weekendWakeTime = base?.weekend_wake_time_local || apiMember?.weekend_wake_time_local || null;
    const streak = typeof apiMember?.current_streak === 'number' ? apiMember.current_streak : (base?.streak_days || 0);
    const strikesUsed = typeof base?.strikes_count === 'number' ? base.strikes_count : (typeof apiMember?.strikes_count === 'number' ? apiMember.strikes_count : 0);
    const metastrikesUsed = typeof base?.metastrikes_count === 'number' ? base.metastrikes_count : (typeof apiMember?.metastrikes_count === 'number' ? apiMember.metastrikes_count : 0);
    const weeklySchedule = base?.weekly_schedule || apiMember?.weekly_schedule || null;
    const journalUrl = base?.journal_url || apiMember?.journal_url || '';
    const role = base?.role || apiMember?.role || 'member';
    const isInBed = Boolean(base?.is_in_bed || apiMember?.is_in_bed);
    const isWokeUp = Boolean(base?.is_woke_up || apiMember?.is_woke_up);

    // Current time in member's timezone using luxon
    const memberZone = toValidLuxonZone(timezone);
    const memberNow = DateTime.utc().setZone(memberZone);
    const currentLocalTimeFormatted = memberNow.toFormat('hh:mm a');
    const todayWeekdayNumber = memberNow.weekday; // 1 = Mon ... 7 = Sun
    const currentDayKey = (['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as DayKey[])[todayWeekdayNumber - 1];

    return {
      id,
      name,
      handle,
      avatar,
      timezone,
      bedtime,
      wakeTime,
      weekendBedtime,
      weekendWakeTime,
      streak,
      strikesUsed,
      metastrikesUsed,
      weeklySchedule,
      journalUrl,
      role,
      isInBed,
      isWokeUp,
      currentLocalTimeFormatted,
      currentDayKey,
    };
  }, [data?.member, initialMember, memberId]);

  const isViewer = Boolean(currentUser && resolvedProfile.id && currentUser.id === resolvedProfile.id);

  // Map of logs keyed on cycle_date
  const logsMap = useMemo(() => {
    const map = new Map<string, SleepLog>();
    if (data?.logs) {
      for (const log of data.logs) {
        map.set(log.cycle_date, log);
      }
    }
    return map;
  }, [data?.logs]);

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
    if (!selectedDate) return null;
    return logsMap.get(selectedDate) || null;
  }, [selectedDate, logsMap]);

  // Check if selected date is eligible for self-edit
  const isEligibleForSelfEdit = useMemo(() => {
    if (!currentUser || !resolvedProfile.id || currentUser.id !== resolvedProfile.id || !selectedDate) {
      return false;
    }
    const targetDt = DateTime.fromISO(selectedDate);
    const now = DateTime.now();
    const diffDays = now.startOf('day').diff(targetDt.startOf('day'), 'days').days;
    return diffDays >= 0 && diffDays <= 7;
  }, [currentUser, resolvedProfile.id, selectedDate]);

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

      setEditSuccess(
        json.formatted_duration
          ? `Logged! Sleep duration: ${json.formatted_duration}.`
          : 'Wake-up time updated successfully!'
      );
      setIsEditingWakeTime(false);
      setEditWakeTime('');

      if (memberId) {
        await fetchHistory(memberId, currentMonth);
      }
      if (onWakeUpUpdated) {
        await onWakeUpUpdated();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setEditError(message);
    } finally {
      setEditSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const monthTitle = DateTime.fromISO(`${currentMonth}-01`).toFormat('MMMM yyyy');

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-night-bg/85 backdrop-blur-md transition-opacity">
      {/* Container: Bottom Sheet on Mobile, Centered Dialog on Desktop */}
      <div
        className="w-full sm:max-w-2xl lg:max-w-3xl max-h-[92vh] sm:max-h-[88vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl border border-night-border/90 bg-night-surface p-4 sm:p-6 shadow-2xl flex flex-col gap-4 text-cream-primary transition-all animate-in fade-in duration-200"
        style={{ paddingBottom: 'calc(1rem + var(--safe-area-bottom, 0px))' }}
      >
        {/* Mobile Drag Indicator */}
        <div className="flex justify-center sm:hidden -mt-1 -mb-1">
          <div className="w-12 h-1.5 rounded-full bg-cream-muted/30" />
        </div>

        {/* Profile Header Section */}
        <div className="flex flex-col gap-3.5 border-b border-night-border/70 pb-4">
          <div className="flex items-start justify-between gap-3">
            {/* Avatar & Member Info */}
            <div className="flex items-center gap-3 min-w-0">
              <div className="relative w-12 h-12 rounded-full shrink-0 flex items-center justify-center">
                <img
                  src={resolvedProfile.avatar}
                  alt={resolvedProfile.name}
                  className="w-12 h-12 rounded-full object-cover border-2 border-night-border bg-night-elevated"
                />
                {resolvedProfile.isInBed && (
                  <span
                    className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-status-amber text-night-bg shadow font-bold"
                    title="Checked into bed"
                  >
                    <Check className="h-2.5 w-2.5 stroke-[3]" />
                  </span>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <h2 className="text-lg font-bold text-cream-primary truncate max-w-[180px] sm:max-w-[260px]">
                    {resolvedProfile.name}
                  </h2>

                  {isViewer && (
                    <span className="rounded bg-status-amber/20 border border-status-amber/40 px-1.5 py-0.5 text-[9px] font-bold text-status-amber shrink-0">
                      YOU
                    </span>
                  )}

                  {(resolvedProfile.role === 'moderator') && (
                    <span className="rounded bg-night-elevated border border-night-border px-1.5 py-0.5 text-[9px] font-medium text-cream-secondary shrink-0">
                      MOD
                    </span>
                  )}

                  {/* Accountability Star Button */}
                  {onToggleStar && resolvedProfile.id && (
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic(10);
                        onToggleStar(resolvedProfile.id);
                      }}
                      className={`min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg transition-colors shrink-0 ${
                        isStarred
                          ? 'text-status-amber hover:text-status-amber/80'
                          : 'text-cream-secondary/40 hover:text-cream-secondary'
                      }`}
                      title={isStarred ? 'Remove from Starred Buddies' : 'Star as Accountability Buddy'}
                      aria-label={isStarred ? 'Remove from Starred Buddies' : 'Star as Accountability Buddy'}
                    >
                      <Star className={`h-4 w-4 ${isStarred ? 'fill-status-amber' : ''}`} />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2 text-xs text-cream-secondary mt-0.5 flex-wrap">
                  <span className="font-mono text-cream-muted">{resolvedProfile.handle}</span>
                  <span>•</span>
                  <span>{formatGmtOffset(resolvedProfile.timezone)}</span>
                  <span>•</span>
                  <span className="text-status-amber font-mono font-medium">
                    {resolvedProfile.currentLocalTimeFormatted} local
                  </span>
                </div>
              </div>
            </div>

            {/* Close Button & Journal Link */}
            <div className="flex items-center gap-1.5 shrink-0">
              {resolvedProfile.journalUrl && (
                <a
                  href={resolvedProfile.journalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 rounded-xl border border-night-border bg-night-elevated px-2.5 py-2 text-xs font-medium text-cream-secondary hover:text-cream-primary hover:border-night-border/80 transition-colors min-h-[44px]"
                  title="Open Discord accountability journal thread"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Journal</span>
                </a>
              )}

              <button
                type="button"
                onClick={() => {
                  triggerHaptic(10);
                  onClose();
                }}
                className="flex items-center justify-center rounded-xl p-2 text-cream-secondary hover:text-cream-primary hover:bg-night-elevated transition-colors min-h-[44px] min-w-[44px]"
                aria-label="Close profile modal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Quick Metrics Bar: Streaks, Strikes, Status */}
          <div className="flex items-center justify-between rounded-xl border border-night-border bg-night-elevated/60 px-3 py-2 text-xs flex-wrap gap-2">
            {/* Streak Pill */}
            <div className="flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full border border-status-amber/40 bg-status-amber/15 px-2.5 py-0.5 text-xs font-bold text-status-amber">
                <Flame className="h-3.5 w-3.5 fill-status-amber text-status-amber" />
                <span>{resolvedProfile.streak}d streak</span>
              </span>
            </div>

            {/* Strikes & Meta Indicators */}
            <div className="flex items-center gap-3 text-[11px]">
              <span className="flex items-center gap-1 font-semibold text-status-coral">
                <Zap className="h-3 w-3 fill-status-coral text-status-coral" />
                <span>Strikes: {resolvedProfile.strikesUsed}/3</span>
              </span>
              <span className="flex items-center gap-1 font-semibold text-status-amber">
                <Shield className="h-3 w-3 fill-status-amber/20 text-status-amber" />
                <span>Meta: {resolvedProfile.metastrikesUsed}/3</span>
              </span>
            </div>
          </div>

          {/* Profile Section Tabs */}
          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-night-elevated border border-night-border/80">
            <button
              type="button"
              onClick={() => {
                triggerHaptic(10);
                setActiveTab('calendar');
              }}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-bold transition-all min-h-[40px] ${
                activeTab === 'calendar'
                  ? 'bg-status-amber text-night-bg shadow-sm'
                  : 'text-cream-secondary hover:text-cream-primary'
              }`}
            >
              <CalendarIcon className="h-4 w-4" />
              <span>Calendar & Streak</span>
            </button>

            <button
              type="button"
              onClick={() => {
                triggerHaptic(10);
                setActiveTab('timetable');
              }}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-bold transition-all min-h-[40px] ${
                activeTab === 'timetable'
                  ? 'bg-status-amber text-night-bg shadow-sm'
                  : 'text-cream-secondary hover:text-cream-primary'
              }`}
            >
              <Clock className="h-4 w-4" />
              <span>Weekly Timetable</span>
            </button>
          </div>
        </div>

        {/* Tab 1: Calendar Streak View */}
        {activeTab === 'calendar' && (
          <div className="flex flex-col gap-4 animate-in fade-in duration-150">
            {/* Month Switcher Bar */}
            <div className="flex items-center justify-between rounded-xl bg-night-elevated/70 border border-night-border/60 px-3 py-2">
              <button
                type="button"
                onClick={handlePrevMonth}
                className="inline-flex items-center justify-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-cream-secondary hover:text-cream-primary hover:bg-night-surface transition-colors min-h-[44px]"
                title="Previous month"
              >
                <ChevronLeft className="h-4 w-4" />
                <span className="hidden sm:inline">Prev</span>
              </button>

              <div className="flex items-center gap-2">
                <CalendarIcon className="h-4 w-4 text-status-amber" />
                <span className="text-sm font-bold text-cream-primary tracking-wide">
                  {monthTitle}
                </span>
              </div>

              <button
                type="button"
                onClick={handleNextMonth}
                className="inline-flex items-center justify-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-cream-secondary hover:text-cream-primary hover:bg-night-surface transition-colors min-h-[44px]"
                title="Next month"
              >
                <span className="hidden sm:inline">Next</span>
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            {/* 3-Pill Monthly Summary Strip */}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl border border-night-border/80 bg-night-elevated/50 p-2.5 flex flex-col justify-center">
                <span className="text-[10px] uppercase font-semibold text-cream-secondary tracking-wider">
                  Avg Sleep
                </span>
                <span className="text-sm sm:text-base font-bold text-cream-primary mt-0.5">
                  {data?.summary.avgDurationMinutes
                    ? `${Math.floor(data.summary.avgDurationMinutes / 60)}h ${data.summary.avgDurationMinutes % 60}m`
                    : '--'}
                </span>
              </div>

              <div className="rounded-xl border border-night-border/80 bg-night-elevated/50 p-2.5 flex flex-col justify-center">
                <span className="text-[10px] uppercase font-semibold text-cream-secondary tracking-wider">
                  Avg Bed → Wake
                </span>
                <span className="text-xs sm:text-sm font-bold text-cream-primary mt-0.5 tabular-nums">
                  {data?.summary.avgBedtime && data?.summary.avgWakeTime
                    ? `${data.summary.avgBedtime} → ${data.summary.avgWakeTime}`
                    : '--'}
                </span>
              </div>

              <div className="rounded-xl border border-night-border/80 bg-night-elevated/50 p-2.5 flex flex-col justify-center">
                <span className="text-[10px] uppercase font-semibold text-cream-secondary tracking-wider">
                  On-Time Rate
                </span>
                <span className="text-sm sm:text-base font-bold text-status-amber mt-0.5">
                  {data ? `${data.summary.onTimePercentage}%` : '--'}
                </span>
              </div>
            </div>

            {/* Error / Loading notices */}
            {loading && (
              <div className="py-8 text-center text-xs text-cream-secondary">
                Loading sleep logs for {monthTitle}...
              </div>
            )}

            {error && (
              <div className="rounded-xl border border-status-coral/40 bg-status-coral/10 p-3 text-xs text-status-coral flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* 7-Column Monthly Calendar Grid (Mon–Sun) */}
            {!loading && !error && (
              <div className="flex flex-col gap-1.5">
                {/* Weekday Labels */}
                <div className="grid grid-cols-7 gap-1 text-center">
                  {WEEKDAY_HEADERS.map((day) => (
                    <span key={day} className="text-[11px] font-semibold text-cream-muted uppercase tracking-wider py-1">
                      {day}
                    </span>
                  ))}
                </div>

                {/* Day Cells Grid */}
                <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
                  {calendarCells.map((cell, idx) => {
                    if (cell.type === 'padding' || !cell.dateStr || !cell.dayNumber) {
                      return (
                        <div
                          key={`padding-${idx}`}
                          className="min-h-[48px] rounded-xl border border-transparent bg-transparent"
                        />
                      );
                    }

                    const isSelected = selectedDate === cell.dateStr;
                    const log = cell.log;

                    let cellBadgeClass = 'bg-night-elevated/40 border-night-border/50 text-cream-secondary';
                    let indicatorDotClass = 'bg-cream-muted/40';

                    if (log) {
                      if (log.status === 'on_time') {
                        if (log.woke_up_local_time) {
                          cellBadgeClass = 'border-emerald-500/40 bg-emerald-950/25 text-emerald-200';
                          indicatorDotClass = 'bg-emerald-400';
                        } else {
                          cellBadgeClass = 'border-status-slumber/40 bg-status-slumber/15 text-status-slumber';
                          indicatorDotClass = 'bg-status-slumber';
                        }
                      } else if (log.status === 'metastrike') {
                        cellBadgeClass = 'border-status-slumber/40 bg-status-slumber/20 text-status-slumber';
                        indicatorDotClass = 'bg-status-slumber';
                      } else if (log.status === 'late' || log.status === 'missed') {
                        cellBadgeClass = 'border-status-coral/40 bg-status-coral/15 text-status-coral';
                        indicatorDotClass = 'bg-status-coral';
                      }
                    }

                    return (
                      <button
                        key={cell.dateStr}
                        type="button"
                        onClick={() => {
                          triggerHaptic(10);
                          setSelectedDate(cell.dateStr!);
                          setIsEditingWakeTime(false);
                          setEditError(null);
                          setEditSuccess(null);
                        }}
                        className={`min-h-[48px] rounded-xl border p-1 sm:p-1.5 flex flex-col justify-between items-center transition-all cursor-pointer relative ${cellBadgeClass} ${
                          isSelected ? 'ring-2 ring-status-amber border-status-amber scale-[1.02] shadow-md' : 'hover:border-cream-secondary/40'
                        }`}
                      >
                        <span className="text-xs font-bold tabular-nums">
                          {cell.dayNumber}
                        </span>

                        <div className="flex items-center justify-center w-full my-0.5">
                          <span className={`h-1.5 w-1.5 rounded-full ${indicatorDotClass}`} />
                        </div>

                        {log?.duration_minutes ? (
                          <span className="hidden sm:inline text-[9px] font-medium opacity-80 tabular-nums">
                            {Math.floor(log.duration_minutes / 60)}h{log.duration_minutes % 60 ? `${log.duration_minutes % 60}m` : ''}
                          </span>
                        ) : (
                          <span className="hidden sm:inline text-[9px] text-cream-muted">--</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Selected Day Inspector Card */}
            {selectedDate && (
              <div className="rounded-2xl border border-night-border/90 bg-night-elevated/70 p-3.5 sm:p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-night-border/60 pb-2">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-status-amber" />
                    <span className="text-xs sm:text-sm font-bold text-cream-primary">
                      {DateTime.fromISO(selectedDate).toFormat('cccc, LLLL d, yyyy')}
                    </span>
                  </div>

                  {selectedLog?.wake_source && (
                    <span className="rounded-full bg-night-surface border border-night-border px-2 py-0.5 text-[10px] font-semibold text-cream-secondary">
                      {selectedLog.wake_source === 'button' ? 'Instant ☀️' : 'Manual ✍️'}
                    </span>
                  )}
                </div>

                {selectedLog ? (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[10px] uppercase font-semibold text-cream-muted">
                        Slept At
                      </span>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-sm font-bold text-cream-primary tabular-nums">
                          {selectedLog.in_bed_local_time || '--:--'}
                        </span>
                        <span className="text-xs text-cream-muted">
                          (Target: {selectedLog.target_bedtime || resolvedProfile.bedtime || '--:--'})
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col gap-0.5">
                      <span className="text-[10px] uppercase font-semibold text-cream-muted">
                        Woke Up At
                      </span>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-sm font-bold text-cream-primary tabular-nums">
                          {selectedLog.woke_up_local_time || '--:--'}
                        </span>
                        <span className="text-xs text-cream-muted">
                          (Target: {selectedLog.target_wake_time || resolvedProfile.wakeTime || '--:--'})
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col gap-0.5">
                      <span className="text-[10px] uppercase font-semibold text-cream-muted">
                        Total Sleep Duration
                      </span>
                      <span className="text-sm font-bold text-status-amber tabular-nums">
                        {selectedLog.duration_minutes
                          ? `${Math.floor(selectedLog.duration_minutes / 60)}h ${selectedLog.duration_minutes % 60}m`
                          : 'Not completed'}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="py-2 text-xs text-cream-muted italic">
                    No sleep activity recorded for this night.
                  </div>
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
                          <p className="text-xs text-status-coral flex items-center gap-1">
                            <AlertCircle className="h-3.5 w-3.5" />
                            <span>{editError}</span>
                          </p>
                        )}
                      </form>
                    )}

                    {editSuccess && (
                      <p className="text-xs text-emerald-400 mt-2 flex items-center gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>{editSuccess}</span>
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Weekly Timetable View */}
        {activeTab === 'timetable' && (
          <div className="flex flex-col gap-4 animate-in fade-in duration-150">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-cream-primary">
                  7-Day Sleep & Wake Timetable
                </h3>
                <p className="text-xs text-cream-secondary mt-0.5">
                  Scheduled bedtimes and wake targets in {resolvedProfile.name}&apos;s local timezone ({formatGmtOffset(resolvedProfile.timezone)}).
                </p>
              </div>

              {isViewer && onOpenScheduleModal && (
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(10);
                    onOpenScheduleModal();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-status-amber/40 bg-status-amber/15 px-3 py-1.5 text-xs font-semibold text-status-amber hover:bg-status-amber/25 transition-all min-h-[40px] whitespace-nowrap shrink-0"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  <span>Edit Schedule</span>
                </button>
              )}
            </div>

            {/* 7-Day Timetable Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-7 gap-2">
              {DAY_KEYS.map((k) => {
                const isToday = resolvedProfile.currentDayKey === k;
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

            {/* Schedule Highlights Summary Card */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mt-1">
              <div className="rounded-xl border border-night-border bg-night-elevated/40 p-3">
                <span className="text-[10px] uppercase font-semibold text-cream-secondary block">
                  Regular Bedtime
                </span>
                <span className="text-sm font-bold text-cream-primary mt-1 block tabular-nums">
                  {format12Hour(resolvedProfile.bedtime)} ({resolvedProfile.bedtime})
                </span>
              </div>

              <div className="rounded-xl border border-night-border bg-night-elevated/40 p-3">
                <span className="text-[10px] uppercase font-semibold text-cream-secondary block">
                  Weekend Bedtime
                </span>
                <span className="text-sm font-bold text-cream-primary mt-1 block tabular-nums">
                  {resolvedProfile.weekendBedtime
                    ? `${format12Hour(resolvedProfile.weekendBedtime)} (${resolvedProfile.weekendBedtime})`
                    : 'Same as weekday'}
                </span>
              </div>

              <div className="rounded-xl border border-night-border bg-night-elevated/40 p-3">
                <span className="text-[10px] uppercase font-semibold text-cream-secondary block">
                  Target Wake-Up
                </span>
                <span className="text-sm font-bold text-cream-primary mt-1 block tabular-nums">
                  {format12Hour(resolvedProfile.wakeTime)} ({resolvedProfile.wakeTime})
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
