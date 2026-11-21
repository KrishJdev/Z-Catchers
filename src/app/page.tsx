'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/Header';
import { UnifiedOnboardingCard } from '@/components/UnifiedOnboardingCard';
import { StatusBucket } from '@/components/StatusBucket';
import { MemberCard } from '@/components/MemberCard';
import { FoxMascot } from '@/components/FoxMascot';
import { MyScheduleModal } from '@/components/MyScheduleModal';
import { ModDrawer } from '@/components/ModDrawer';
import { PushModal } from '@/components/PushModal';
import { BottomNav, type MobileNavTab } from '@/components/BottomNav';
import { MetastrikeModal } from '@/components/MetastrikeModal';
import { SleepCalendarModal } from '@/components/SleepCalendarModal';
import { PinnedSelfActionBar } from '@/components/PinnedSelfActionBar';
import { computeMemberState, hasRosterSleepShield, MemberState } from '@/lib/sleepEngine';
import { formatGmtOffset } from '@/lib/timezone';
import {
  registerServiceWorker,
  syncPushSubscriptionHealth,
  isPushSupported,
  setStoredAuthMember,
  setStoredAuthToken,
  getStoredAuthToken,
  clearAuthSession,
} from '@/lib/pushClient';
import type { Member } from '@/lib/db';
import {
  ShieldAlert,
  Sparkles,
  Sun,
  Moon,
  RefreshCw,
  Star,
  Users,
  KeyRound,
} from 'lucide-react';

const STORAGE_KEY_STARRED = 'zcatchers_starred_members';
const STORAGE_KEY_CACHED_ROSTER = 'zcatchers_cached_roster';

function rosterWithoutPrivateCounts(members: Member[]): Member[] {
  return members.map(({ open_punishment_count: _privateCount, ...member }) => member);
}

function readCachedRoster(): Member[] {
  try {
    const snapshot = JSON.parse(localStorage.getItem(STORAGE_KEY_CACHED_ROSTER) ?? 'null');
    if (!Array.isArray(snapshot)) return [];
    const roster = rosterWithoutPrivateCounts(snapshot);
    if (snapshot.some(member => 'open_punishment_count' in member)) {
      try {
        localStorage.setItem(STORAGE_KEY_CACHED_ROSTER, JSON.stringify(roster));
      } catch {
        // Keep the sanitized roster usable when storage cannot be written.
      }
    }
    return roster;
  } catch {
    return [];
  }
}

/**
 * Main dashboard page for Z Catchers.
 * Displays the live community member roster sorted by sleep bucket,
 * real-time timezone conversion, sleep consistency streaks, and strike accountability.
 *
 * @returns Rendered Home dashboard component
 */
export default function HomePage() {
  const router = useRouter();
  const [isSessionChecked, setIsSessionChecked] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOffline, setIsOffline] = useState(false);
  const [viewerTimezone, setViewerTimezone] = useState<string>('GMT+00:00');
  const [isPushEnabled, setIsPushEnabled] = useState(false);
  const [isSleepShieldActive, setIsSleepShieldActive] = useState(false);
  const [tick, setTick] = useState(0);

  // Authenticated current member session (ZC-13)
  const [currentUser, setCurrentUser] = useState<Member | null>(null);
  const claimedMemberId = currentUser?.id;

  const [sessionCheckFailed, setSessionCheckFailed] = useState(false);
  const [sessionCheckAttempt, retrySessionCheck] = useState(0);

  // Starred accountability buddies
  const [starredMembers, setStarredMembers] = useState<string[]>([]);
  const [buddyFilter, setBuddyFilter] = useState<'all' | 'buddies'>('all');

  // Check-in loading indicator
  const [isCheckingIn, setIsCheckingIn] = useState(false);

  // Strikes & Metastrikes accountability states
  const [metastrikeMember, setMetastrikeMember] = useState<Member | null>(null);
  const [metastrikeMode, setMetastrikeMode] = useState<'proactive' | 'convert_retroactive'>('proactive');
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  const [activeModal, setActiveModal] = useState<'profile' | 'schedule' | 'mod' | 'push' | null>(null);
  const [calendarView, setCalendarView] = useState<{
    memberId: string;
    tab: 'calendar' | 'timetable' | 'punishments';
    personal?: boolean;
  } | null>(null);

  const handleOpenMemberProfile = useCallback((memberId: string, tab: 'calendar' | 'timetable' = 'calendar') => {
    setCalendarView({ memberId, tab });
  }, []);

  const openMySleep = (tab: 'calendar' | 'punishments' = 'calendar') => {
    if (!currentUser) return;
    setCalendarView({ memberId: currentUser.id, tab, personal: true });
  };

  // Throttled foreground refetch tracking ref
  const lastForegroundSyncRef = useRef<number>(0);

  const handleOpenLogin = (_tab?: 'login' | 'register') => {
    router.push('/join');
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch (err) {
      console.warn('Logout request error:', err);
    } finally {
      clearAuthSession();
      setCurrentUser(null);
      setActiveModal(null);
      setCalendarView(null);
      setToastMessage({
        text: 'Logged out of Fox Den successfully.',
        type: 'info',
      });
      router.replace('/join');
    }
  };

  const handleMobileTabChange = (tab: MobileNavTab) => {
    if (tab === 'roster') {
      setActiveModal(null);
      setCalendarView(null);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (tab === 'sleep') {
      openMySleep();
    } else if (currentUser?.is_moderator) {
      setActiveModal('mod');
    }
  };

  const handleCloseModal = () => setActiveModal(null);

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    fetch('/api/auth/me', { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error('Session verification unavailable');
        return res.json();
      })
      .then((data) => {
        if (!isMounted) return;
        if (data.authenticated && data.member) {
          setCurrentUser(data.member);
          setStoredAuthMember(data.member);
          if (data.token) setStoredAuthToken(data.token);
          setSessionCheckFailed(false);
          setIsSessionChecked(true);
        } else if (data.authenticated === false) {
          clearAuthSession();
          router.replace('/join');
        } else {
          throw new Error('Unexpected session response');
        }
      })
      .catch(() => {
        if (isMounted) setSessionCheckFailed(true);
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      isMounted = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [router, sessionCheckAttempt]);

  useEffect(() => {
    if (!sessionCheckFailed) return;
    const retry = () => retrySessionCheck(attempt => attempt + 1);
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [sessionCheckFailed]);

  // Detect viewer's local timezone (formatted as GMT offset to prevent disclosing physical location)
  useEffect(() => {
    try {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (detected) setViewerTimezone(formatGmtOffset(detected));
      else setViewerTimezone('GMT+00:00');
    } catch {
      setViewerTimezone('GMT+00:00');
    }
  }, []);

  // Load starred buddies from localStorage
  useEffect(() => {
    try {

      const storedStarred = localStorage.getItem(STORAGE_KEY_STARRED);
      if (storedStarred) {
        setStarredMembers(JSON.parse(storedStarred));
      }
    } catch (err) {
      console.warn('Failed to load local settings:', err);
    }
  }, [activeModal]);

  // Fetch roster with offline localStorage snapshot caching and fallback
  const fetchRoster = useCallback(async () => {
    try {
      const token = getStoredAuthToken();
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/members', { headers });
      if (res.ok) {
        const json = await res.json();
        if (json.members) {
          setMembers(json.members);
          setCurrentUser((prev) => {
            if (!prev) return null;
            const updated = json.members.find((m: Member) => m.id === prev.id);
            return updated ? { ...prev, ...updated, is_moderator: prev.is_moderator } : prev;
          });
          try {
            localStorage.setItem(STORAGE_KEY_CACHED_ROSTER, JSON.stringify(rosterWithoutPrivateCounts(json.members)));
          } catch {
            // Ignore quota errors
          }
        }
      }
    } catch (err) {
      console.error('Failed to load roster:', err);
      const cached = readCachedRoster();
      if (cached.length) setMembers(prev => prev.length === 0 ? cached : prev);
    } finally {
      setLoading(false);
    }
  }, []);

  // Preload cached roster snapshot on initial mount & track online/offline connectivity
  useEffect(() => {
    const cached = readCachedRoster();
    if (cached.length) {
      setMembers(prev => prev.length === 0 ? cached : prev);
      setLoading(false);
    }

    if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
      setIsOffline(!navigator.onLine);
    }

    const handleOnline = () => {
      setIsOffline(false);
      fetchRoster();
      syncPushSubscriptionHealth().catch(() => {});
    };

    const handleOffline = () => {
      setIsOffline(true);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [fetchRoster]);

  useEffect(() => {
    if (isSessionChecked) {
      fetchRoster();
    }
  }, [fetchRoster, isSessionChecked]);

  // "I'm in Bed" Check-In Safe Button handler
  const handleCheckIn = useCallback(async (memberId: string): Promise<boolean> => {
    const priorInBed = currentUser?.id === memberId ? Boolean(currentUser.is_in_bed) : false;
    const priorWokeUp = currentUser?.id === memberId ? Boolean(currentUser.is_woke_up) : true;
    const priorShield = isSleepShieldActive;

    try {
      setIsCheckingIn(true);
      // Instant optimistic UI update
      setCurrentUser((prev) => (prev && prev.id === memberId ? { ...prev, is_in_bed: true, is_woke_up: false } : prev));
      setIsSleepShieldActive(true);

      const token = getStoredAuthToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/members/in-bed', {
        method: 'POST',
        headers,
        body: JSON.stringify({ memberId, action: 'check_in' }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        setCurrentUser((prev) => (prev && prev.id === memberId ? { ...prev, is_in_bed: true, is_woke_up: false } : prev));
        setIsSleepShieldActive(true);
        setToastMessage({
          text: data.message || 'Checked into bed! Sleep Shield activated.',
          type: 'success',
        });
        await fetchRoster();
        return true;
      } else if (res.status === 401) {
        // Restore prior sleep state directly
        setCurrentUser((prev) => (prev && prev.id === memberId ? { ...prev, is_in_bed: priorInBed, is_woke_up: priorWokeUp } : prev));
        setIsSleepShieldActive(priorShield);
        router.push('/join');
        return false;
      } else {
        const data = await res.json().catch(() => ({}));
        // Restore prior sleep state directly
        setCurrentUser((prev) => (prev && prev.id === memberId ? { ...prev, is_in_bed: priorInBed, is_woke_up: priorWokeUp } : prev));
        setIsSleepShieldActive(priorShield);
        setToastMessage({
          text: data.error || 'Failed to check in.',
          type: 'error',
        });
        await fetchRoster();
        return false;
      }
    } catch (err) {
      console.error('Failed to check in:', err);
      // Restore prior sleep state directly
      setCurrentUser((prev) => (prev && prev.id === memberId ? { ...prev, is_in_bed: priorInBed, is_woke_up: priorWokeUp } : prev));
      setIsSleepShieldActive(priorShield);
      setToastMessage({
        text: 'Network error checking in.',
        type: 'error',
      });
      await fetchRoster();
      return false;
    } finally {
      setIsCheckingIn(false);
    }
  }, [fetchRoster, router, currentUser, isSleepShieldActive]);

  // Wake Up handler (Instant Button or Manual Time Entry)
  const handleWakeUp = useCallback(
    async (memberId: string, mode: 'button' | 'manual' = 'button', wokeUpTime?: string, cycleDate?: string, expectedInBedAt?: string | null) => {
      try {
        setIsCheckingIn(true);
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        const token = getStoredAuthToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch('/api/members/wake-up', {
          method: 'POST',
          headers,
          body: JSON.stringify({ memberId, mode, wokeUpTime, cycleDate, expectedInBedAt }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          const updatedWakeCycleDate = data.member?.last_wake_cycle_date || data.sleep_log?.cycle_date;
          setCurrentUser((prev) =>
            prev && prev.id === memberId
              ? {
                  ...prev,
                  is_in_bed: false,
                  is_woke_up: true,
                  last_woke_up_at: data.sleep_log?.woke_up_at || data.member?.last_woke_up_at,
                  last_wake_cycle_date: updatedWakeCycleDate || prev.last_wake_cycle_date,
                  in_bed_at: data.member?.in_bed_at || data.sleep_log?.in_bed_at || prev.in_bed_at,
                }
              : prev
          );
          setIsSleepShieldActive(false);
          setToastMessage({
            text:
              data.message ||
              (data.formatted_duration
                ? `Good morning! Logged ${data.formatted_duration} of sleep.`
                : 'Good morning! Wake-up logged.'),
            type: 'success',
          });
          await fetchRoster();
          return true;
        } else if (res.status === 401) {
          router.push('/join');
          return false;
        } else {
          if (res.status === 409) await fetchRoster();
          setToastMessage({
            text: data.error || 'Failed to log wake-up.',
            type: 'error',
          });
          return false;
        }
      } catch (err) {
        console.error('Failed to log wake-up:', err);
        setToastMessage({
          text: err instanceof Error ? err.message : 'Network error logging wake-up.',
          type: 'error',
        });
        return false;
      } finally {
        setIsCheckingIn(false);
      }
    },
    [fetchRoster, router]
  );

  // Cancel "I'm in Bed" / Wake Up undo check-in handler
  const handleCancelInBed = useCallback(async (memberId: string): Promise<boolean> => {
    try {
      setIsCheckingIn(true);
      const token = getStoredAuthToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/members/in-bed', {
        method: 'POST',
        headers,
        body: JSON.stringify({ memberId, action: 'cancel' }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        setCurrentUser((prev) =>
          prev && prev.id === memberId
            ? {
                ...prev,
                is_in_bed: false,
                is_woke_up: false,
                in_bed_at: null,
                last_wake_cycle_date: null,
                last_woke_up_at: null,
                ...(prev.last_notified_stage === 'IN_BED_EARLY'
                  ? {
                      last_notified_stage: null,
                      last_notified_cycle_date: null,
                    }
                  : {}),
              }
            : prev
        );
        setIsSleepShieldActive(false);
        setToastMessage({
          text: data.message || 'Check-in cancelled.',
          type: 'success',
        });
        await fetchRoster();
        return true;
      } else if (res.status === 401) {
        router.push('/join');
        return false;
      } else if (res.status === 403) {
        const data = await res.json().catch(() => ({}));
        setToastMessage({
          text: data.error || 'Forbidden. Cannot modify bedtime status for another member.',
          type: 'error',
        });
        return false;
      } else {
        // Server failure where cancellation may have been partially committed:
        // refresh authoritative member state before returning false.
        try {
          await fetchRoster();
        } catch {
          // ignore roster refresh failure
        }
        const data = await res.json().catch(() => ({}));
        setToastMessage({
          text: data.error || 'Failed to undo sleep state.',
          type: 'error',
        });
        return false;
      }
    } catch (err) {
      console.error('Failed to cancel check-in:', err);
      setToastMessage({
        text: 'Network error undoing sleep state.',
        type: 'error',
      });
      return false;
    } finally {
      setIsCheckingIn(false);
    }
  }, [fetchRoster, router]);

  useEffect(() => {
    setIsSleepShieldActive(Boolean(currentUser && hasRosterSleepShield(currentUser)));
  }, [currentUser, tick]);

  // Deep-Link Action Handler: /?action=in-bed
  const processDeepLinkAction = useCallback(
    async (member: Member | null) => {
      if (typeof window === 'undefined') return;
      try {
        const url = new URL(window.location.href);
        const action = url.searchParams.get('action');

        if (action === 'in-bed') {
          // Clean query parameter from URL immediately to prevent repeated triggers
          url.searchParams.delete('action');
          const cleanedUrl = url.pathname + (url.search ? url.search : '') + url.hash;
          window.history.replaceState({}, '', cleanedUrl);

          if (member) {
            await handleCheckIn(member.id);
          }
        } else if (action === 'schedule') {
          url.searchParams.delete('action');
          const cleanedUrl = url.pathname + (url.search ? url.search : '') + url.hash;
          window.history.replaceState({}, '', cleanedUrl);
          setActiveModal('schedule');
        }
      } catch (err) {
        console.warn('Failed to parse or process deep link action:', err);
      }
    },
    [handleCheckIn]
  );

  // Throttled foreground resume handler (focus / visibilitychange)
  const handleForegroundResume = useCallback(async () => {
    const now = Date.now();
    // Throttle refetches to at most once every 5 seconds to prevent duplicate bursts
    if (now - lastForegroundSyncRef.current < 5000) {
      return;
    }
    lastForegroundSyncRef.current = now;

    // 1. Recalculate local countdown timers
    setTick((prev) => prev + 1);

    // 2. Re-fetch roster and current member session in parallel
    try {
      const token = getStoredAuthToken();
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const [rosterRes, authRes] = await Promise.all([
        fetch('/api/members', { headers }),
        fetch('/api/auth/me', { headers }),
      ]);

      if (rosterRes.ok) {
        const json = await rosterRes.json();
        if (json.members) setMembers(json.members);
      }

      if (authRes.ok) {
        const authJson = await authRes.json();
        if (authJson.authenticated && authJson.member) {
          setCurrentUser(authJson.member);
          setStoredAuthMember(authJson.member);
          if (authJson.token) setStoredAuthToken(authJson.token);
          processDeepLinkAction(authJson.member);
        } else if (authJson.authenticated === false) {
          clearAuthSession();
          setCurrentUser(null);
          router.replace('/join');
          return;
        }
      }
    } catch (err) {
      console.warn('Foreground sync failed:', err);
    }

    // 3. Silent push subscription health-check
    syncPushSubscriptionHealth().then(setIsPushEnabled);
  }, [processDeepLinkAction, router]);

  // Wait for the Discord session before enrolling or repairing this device.
  const signedInMemberId = currentUser?.id;
  useEffect(() => {
    if (!signedInMemberId || !isPushSupported()) return;
    let active = true;
    registerServiceWorker().then(async registration => {
      if (!registration || !active) return;
      const synced = await syncPushSubscriptionHealth();
      if (active) setIsPushEnabled(synced);
    });
    return () => { active = false; };
  }, [signedInMemberId]);

  // Process deep-link actions when user session is available
  useEffect(() => {
    if (currentUser) {
      processDeepLinkAction(currentUser);
    }
  }, [currentUser, processDeepLinkAction]);

  // Listen for Service Worker messages (e.g. notification clicks carrying in-bed action)
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    const handleSwMessage = (event: MessageEvent) => {
      if (event.data?.type === 'PUSH_DEVICE_CHANGED') {
        setIsPushEnabled(Boolean(event.data.active));
      }
      if (
        event.data?.action === 'in-bed' ||
        (event.data?.url && typeof event.data.url === 'string' && event.data.url.includes('action=in-bed'))
      ) {
        if (currentUser) {
          handleCheckIn(currentUser.id);
        }
      }
    };

    navigator.serviceWorker.addEventListener('message', handleSwMessage);
    return () => {
      navigator.serviceWorker.removeEventListener('message', handleSwMessage);
    };
  }, [currentUser, handleCheckIn]);

  // Self-refreshing interval every 30s and throttled foreground resume listeners
  useEffect(() => {
    if (!isSessionChecked) return;

    const tickInterval = setInterval(() => {
      setTick((prev) => prev + 1);
    }, 30000);

    // Periodic 60s roster sync to reflect buddy check-ins and bedtime shifts
    const rosterInterval = setInterval(() => {
      fetchRoster();
    }, 60000);

    // Throttled sync on window focus or tab visibility resume
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        handleForegroundResume();
      }
    };

    const onWindowFocus = () => {
      handleForegroundResume();
    };

    window.addEventListener('focus', onWindowFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      clearInterval(tickInterval);
      clearInterval(rosterInterval);
      window.removeEventListener('focus', onWindowFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [fetchRoster, handleForegroundResume, isSessionChecked]);

  // Toggle buddy star
  const handleToggleStar = (memberId: string) => {
    setStarredMembers((prev) => {
      const next = prev.includes(memberId)
        ? prev.filter((id) => id !== memberId)
        : [...prev, memberId];
      try {
        localStorage.setItem(STORAGE_KEY_STARRED, JSON.stringify(next));
      } catch (err) {
        console.warn('Failed to save starred buddies:', err);
      }
      return next;
    });
  };

  // Metastrike Excuse Modal Handler
  const handleOpenMetastrike = (member: Member, mode: 'proactive' | 'convert_retroactive') => {
    setMetastrikeMember(member);
    setMetastrikeMode(mode);
  };

  // Claimed member profile & state
  const claimedMember = useMemo(() => {
    if (!claimedMemberId) return null;
    return members.find((m) => m.id === claimedMemberId) || null;
  }, [members, claimedMemberId]);

  const claimedMemberState = useMemo(() => {
    if (!claimedMember) return null;
    return computeMemberState(claimedMember, viewerTimezone);
  }, [claimedMember, viewerTimezone, tick]);

  // Filtered members list based on buddy filter
  const displayedMembers = useMemo(() => {
    if (buddyFilter === 'buddies') {
      return members.filter((m) => starredMembers.includes(m.id));
    }
    return members;
  }, [members, buddyFilter, starredMembers]);

  // Categorize members into buckets based on viewer timezone & current clock
  const categorized = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _forceRecompute = tick;

    const overdue: { member: Member; state: MemberState }[] = [];
    const windingDown: { member: Member; state: MemberState }[] = [];
    const awake: { member: Member; state: MemberState }[] = [];
    const sleeping: { member: Member; state: MemberState }[] = [];

    for (const member of displayedMembers) {
      const state = computeMemberState(member, viewerTimezone);
      switch (state.bucket) {
        case 'BEDTIME_NOW':
        case 'OVERDUE':
        case 'OVERDUE_BEDTIME':
          overdue.push({ member, state });
          break;
        case 'WINDING_DOWN':
          windingDown.push({ member, state });
          break;
        case 'AWAKE':
          awake.push({ member, state });
          break;
        case 'SLEEPING':
          sleeping.push({ member, state });
          break;
      }
    }

    // Sort: overdue by most overdue, windingDown by closest to bedtime, awake by time until bedtime
    overdue.sort((a, b) => b.state.diffMinutes - a.state.diffMinutes);
    windingDown.sort((a, b) => b.state.diffMinutes - a.state.diffMinutes);

    return { overdue, nagNow: overdue, windingDown, awake, sleeping };
  }, [displayedMembers, viewerTimezone, tick]);

  // Home Screen App Badging API: Sync overdue friend count to mobile PWA icon
  useEffect(() => {
    if (typeof navigator !== 'undefined' && 'setAppBadge' in navigator) {
      const overdueCount = categorized.overdue.length;
      if (overdueCount > 0) {
        navigator.setAppBadge(overdueCount).catch(() => {});
      } else if ('clearAppBadge' in navigator) {
        navigator.clearAppBadge().catch(() => {});
      }
    }
  }, [categorized.overdue.length]);

  const handleOpenPushModal = () => {
    setActiveModal('push');
  };

  // If waiting for route guard session verification, show Warm Dark splash
  const sessionRetry = sessionCheckFailed && (
    <div role="status" className="mx-auto flex max-w-lg flex-wrap items-center justify-center gap-x-4 px-4 text-xs text-cream-secondary">
      <p>Session verification is unavailable.</p>
      <button type="button" className="min-h-[44px] font-semibold text-status-amber" onClick={() => retrySessionCheck(attempt => attempt + 1)}>
        Retry sign-in check
      </button>
    </div>
  );

  if (!isSessionChecked && !(sessionCheckFailed && members.length > 0)) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-night-bg text-cream-primary p-4">
        <FoxMascot state="sleeping" size={56} className="animate-pulse mb-3" />
        <h1 className="text-xl font-bold tracking-tight">Z Catchers</h1>
        {sessionRetry || <p className="text-xs text-cream-secondary mt-1">Entering the Fox Den...</p>}
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col bg-night-bg">
      {sessionRetry}
      <Header
        viewerTimezone={viewerTimezone}
        isPushEnabled={isPushEnabled}
        onOpenPush={handleOpenPushModal}
        isSleepShieldActive={isSleepShieldActive}
        onOpenProfile={() => setActiveModal('profile')}
        onOpenMySleep={() => openMySleep()}
        onOpenMod={() => handleMobileTabChange('mod')}
        currentUser={currentUser}
        onOpenLogin={handleOpenLogin}
      />

      <div className="w-full flex-1 max-w-7xl mx-auto px-4 sm:px-6 py-4 md:py-6 pb-[calc(10rem+env(safe-area-inset-bottom))] md:pb-24">
        {/* Floating Notification Toast */}
        {toastMessage && (
          <div
            role="status"
            className={`mb-4 flex items-center justify-between rounded-xl border px-4 py-2.5 text-xs font-semibold shadow-lg transition-all animate-fade-in ${
              toastMessage.type === 'success'
                ? 'border-status-sage/40 bg-status-sage/15 text-status-sage'
                : toastMessage.type === 'error'
                ? 'border-status-coral/40 bg-status-coral/15 text-status-coral'
                : 'border-status-amber/40 bg-status-amber/15 text-status-amber'
            }`}
          >
            <span>{toastMessage.text}</span>
            <button
              onClick={() => setToastMessage(null)}
              className="ml-3 text-cream-muted hover:text-cream-primary"
            >
              ✕
            </button>
          </div>
        )}

        {/* Offline Connectivity Notification Banner */}
        {isOffline && (
          <div className="mb-4 flex items-center justify-between rounded-xl border border-night-border bg-night-surface px-4 py-2.5 text-xs text-cream-secondary shadow-md animate-fade-in">
            <div className="flex items-center gap-2.5">
              <span className="h-2 w-2 rounded-full bg-status-amber animate-pulse shrink-0" />
              <span>You are offline • Showing cached Fox Den times</span>
            </div>
            <button
              onClick={() => fetchRoster()}
              className="text-xs font-semibold text-status-amber hover:underline ml-2"
            >
              Retry
            </button>
          </div>
        )}

        <UnifiedOnboardingCard
          onEnablePush={handleOpenPushModal}
          isPushGranted={isPushEnabled}
          currentUser={currentUser}
          onPushStateChanged={setIsPushEnabled}
        />

        {/* Contextual Sleepy Fox Status Banner */}
        <section className="mb-6 rounded-2xl border border-night-border/80 bg-night-surface/90 p-4 shadow-lg backdrop-blur-sm sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3.5">
              {claimedMember?.is_in_bed ? (
                <FoxMascot state="sleeping" size={42} />
              ) : categorized.overdue.length > 0 ? (
                <FoxMascot state="alert" size={42} className="animate-pulse" />
              ) : categorized.windingDown.length > 0 ? (
                <FoxMascot state="lantern" size={42} />
              ) : (
                <FoxMascot state="sleeping" size={42} />
              )}

              <div>
                <h2 className="text-sm font-bold text-cream-primary sm:text-base">Roster</h2>
                <p className="text-xs text-cream-secondary sm:text-sm">
                  {claimedMemberState?.statusText ?? (categorized.overdue.length ? 'Friends are past bedtime.' : 'The den is quiet.')}
                </p>
              </div>
            </div>

            {/* Quick summary counters */}
            <div className="flex items-center gap-2 self-start rounded-xl bg-night-surface border border-night-border px-3 py-1.5 text-xs font-medium text-cream-secondary sm:self-auto">
              <span className="text-status-coral font-bold tabular-nums">
                {categorized.overdue.length} Overdue
              </span>
              <span>•</span>
              <span className="text-status-amber font-bold tabular-nums">
                {categorized.windingDown.length} Wind
              </span>
              <span>•</span>
              <span className="text-cream-muted font-bold tabular-nums">
                {categorized.sleeping.length} Asleep
              </span>
            </div>
          </div>
        </section>

        {/* Buddy Filter Bar */}
        <div className="mb-4 flex items-center justify-between flex-wrap gap-2.5">
          <div className="flex items-center rounded-xl bg-night-surface p-1 border border-night-border/80">
            <button
              onClick={() => setBuddyFilter('all')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 min-h-[36px] text-xs font-semibold transition-colors whitespace-nowrap ${
                buddyFilter === 'all'
                  ? 'bg-night-elevated text-cream-primary'
                  : 'text-cream-muted hover:text-cream-secondary'
              }`}
            >
              <Users className="h-3.5 w-3.5" />
              <span>All Den ({members.length})</span>
            </button>
            <button
              onClick={() => setBuddyFilter('buddies')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 min-h-[36px] text-xs font-semibold transition-colors whitespace-nowrap ${
                buddyFilter === 'buddies'
                  ? 'bg-status-amber/20 text-status-amber border border-status-amber/40'
                  : 'text-cream-muted hover:text-cream-secondary'
              }`}
            >
              <Star
                className={`h-3.5 w-3.5 ${
                  buddyFilter === 'buddies' ? 'fill-status-amber text-status-amber' : ''
                }`}
              />
              <span>Starred Buddies ({starredMembers.length})</span>
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex min-h-[300px] flex-col items-center justify-center gap-3 text-cream-muted">
            <RefreshCw className="h-6 w-6 animate-spin text-status-amber" />
            <p className="text-xs">Gathering community foxes from across timezones...</p>
          </div>
        ) : displayedMembers.length === 0 && buddyFilter === 'buddies' ? (
          <div className="flex min-h-[200px] flex-col items-center justify-center rounded-2xl border border-dashed border-night-border bg-night-surface/50 p-6 text-center text-cream-muted">
            <Star className="h-8 w-8 text-status-amber/60 mb-2" />
            <p className="text-sm font-semibold text-cream-primary">No Starred Buddies Yet</p>
            <p className="text-xs max-w-sm mt-1 text-cream-secondary">
              Click the star icon ⭐ on any friend&apos;s card to add them to your priority accountability watchlist.
            </p>
            <button
              onClick={() => setBuddyFilter('all')}
              className="mt-3 rounded-lg bg-night-elevated px-3 py-1.5 text-xs font-medium text-status-amber hover:bg-night-border"
            >
              Show All Members
            </button>
          </div>
        ) : displayedMembers.length === 0 && buddyFilter === 'all' ? (
          <div className="flex min-h-[340px] flex-col items-center justify-center rounded-3xl border border-dashed border-night-border bg-night-surface/60 p-8 text-center backdrop-blur-sm animate-fade-in">
            <div className="mb-4 rounded-2xl bg-night-elevated/70 p-4 border border-night-border/50">
              <FoxMascot state="lantern" size={56} />
            </div>
            <h3 className="text-lg font-bold text-cream-primary sm:text-xl">
              Welcome to the Fox Den!
            </h3>
            <p className="mt-2 max-w-md text-xs sm:text-sm text-cream-secondary leading-relaxed">
              The den is peaceful and ready for your friends! Create your profile to set your local bedtime, and link your Discord journal.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <button
                onClick={() => router.push('/join')}
                className="flex items-center justify-center gap-2 rounded-xl bg-status-amber px-5 h-11 min-h-[44px] text-xs font-bold text-night-bg shadow-lg hover:bg-status-amber/90 transition-all hover:scale-[1.02] active:scale-95 whitespace-nowrap"
              >
                <Sparkles className="h-4 w-4" />
                <span>Join Den & Create Profile</span>
              </button>
              <button
                onClick={() => handleOpenLogin('login')}
                className="flex items-center justify-center gap-2 rounded-xl border border-night-border bg-night-elevated px-4 h-11 min-h-[44px] text-xs font-semibold text-cream-primary hover:bg-night-border transition-all whitespace-nowrap"
              >
                <KeyRound className="h-4 w-4 text-status-amber" />
                <span>Log In with Existing Profile</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* 1. Overdue / Past Bedtime (Always top priority) */}
            <StatusBucket
              id="overdue-past-bedtime"
              title="Overdue / Past Bedtime"
              count={categorized.overdue.length}
              accentColor="text-status-coral"
              icon={<ShieldAlert className="h-4 w-4 text-status-coral animate-pulse" />}
              defaultExpanded={true}
              showEmptyState={false}
            >
              {categorized.overdue.map(({ member, state }) => (
                <MemberCard
                  key={member.id}
                  member={member}
                  state={state}
                  currentMemberId={currentUser?.id}
                  isStarred={starredMembers.includes(member.id)}
                  onToggleStar={handleToggleStar}
                  onCheckIn={handleCheckIn}
                  onCancelInBed={handleCancelInBed}
                  isCheckingIn={isCheckingIn}
                  onOpenMetastrike={handleOpenMetastrike}
                  isModerator={Boolean(currentUser?.is_moderator)}
                  onOpenProfile={handleOpenMemberProfile}
                  onOpenSleepCalendar={handleOpenMemberProfile}
                  onWakeUp={handleWakeUp}
                  onOpenPunishments={() => openMySleep('punishments')}
                />
              ))}
            </StatusBucket>

            {/* 2. Winding Down */}
            <StatusBucket
              id="winding-down"
              title="Winding Down"
              count={categorized.windingDown.length}
              accentColor="text-status-amber"
              icon={<Sparkles className="h-4 w-4 text-status-amber" />}
              defaultExpanded={true}
              showEmptyState={false}
            >
              {categorized.windingDown.map(({ member, state }) => (
                <MemberCard
                  key={member.id}
                  member={member}
                  state={state}
                  currentMemberId={currentUser?.id}
                  isStarred={starredMembers.includes(member.id)}
                  onToggleStar={handleToggleStar}
                  onCheckIn={handleCheckIn}
                  onCancelInBed={handleCancelInBed}
                  isCheckingIn={isCheckingIn}
                  onOpenMetastrike={handleOpenMetastrike}
                  isModerator={Boolean(currentUser?.is_moderator)}
                  onOpenProfile={handleOpenMemberProfile}
                  onOpenSleepCalendar={handleOpenMemberProfile}
                  onWakeUp={handleWakeUp}
                  onOpenPunishments={() => openMySleep('punishments')}
                />
              ))}
            </StatusBucket>

            {/* 3. Awake */}
            <StatusBucket
              id="awake"
              title="Awake"
              count={categorized.awake.length}
              accentColor="text-cream-secondary"
              icon={<Sun className="h-4 w-4 text-cream-secondary" />}
              defaultExpanded={false}
            >
              {categorized.awake.map(({ member, state }) => (
                <MemberCard
                  key={member.id}
                  member={member}
                  state={state}
                  currentMemberId={currentUser?.id}
                  isStarred={starredMembers.includes(member.id)}
                  onToggleStar={handleToggleStar}
                  onCheckIn={handleCheckIn}
                  onCancelInBed={handleCancelInBed}
                  isCheckingIn={isCheckingIn}
                  onOpenMetastrike={handleOpenMetastrike}
                  isModerator={Boolean(currentUser?.is_moderator)}
                  onOpenProfile={handleOpenMemberProfile}
                  onOpenSleepCalendar={handleOpenMemberProfile}
                  onWakeUp={handleWakeUp}
                  onOpenPunishments={() => openMySleep('punishments')}
                />
              ))}
            </StatusBucket>

            {/* 4. Sleeping (Sleep Shield Active) */}
            <StatusBucket
              id="sleeping"
              title="Sleeping"
              count={categorized.sleeping.length}
              accentColor="text-cream-muted"
              icon={<Moon className="h-4 w-4 text-cream-muted" />}
              defaultExpanded={false}
              showEmptyState={true}
              emptyMessage="No members currently asleep."
            >
              {categorized.sleeping.map(({ member, state }) => (
                <MemberCard
                  key={member.id}
                  member={member}
                  state={state}
                  currentMemberId={currentUser?.id}
                  isStarred={starredMembers.includes(member.id)}
                  onToggleStar={handleToggleStar}
                  onCheckIn={handleCheckIn}
                  onCancelInBed={handleCancelInBed}
                  isCheckingIn={isCheckingIn}
                  onOpenMetastrike={handleOpenMetastrike}
                  isModerator={Boolean(currentUser?.is_moderator)}
                  onOpenProfile={handleOpenMemberProfile}
                  onOpenSleepCalendar={handleOpenMemberProfile}
                  onWakeUp={handleWakeUp}
                  onOpenPunishments={() => openMySleep('punishments')}
                />
              ))}
            </StatusBucket>
          </>
        )}
      </div>

      {/* Persistent Pinned Self-Action Bar (Authenticated Members Only) */}
      {currentUser && (
        <PinnedSelfActionBar
          currentUser={currentUser}
          onCheckIn={handleCheckIn}
          onWakeUp={handleWakeUp}
          onCancelInBed={handleCancelInBed}
          isCheckingIn={isCheckingIn}
        />
      )}

      {/* Sticky Bottom Navigation (Mobile Viewports Only: < 768px) */}
      <BottomNav
        activeTab={calendarView?.personal ? 'sleep' : activeModal === 'mod' ? 'mod' : 'roster'}
        onChangeTab={handleMobileTabChange}
        isModerator={Boolean(currentUser?.is_moderator)}
      />

      {/* Self-Service My Schedule Modal */}
      {currentUser && (activeModal === 'profile' || activeModal === 'schedule') && (
        <MyScheduleModal
          key={`${currentUser.id}-${activeModal}`}
          isOpen
          initialView={activeModal}
          onClose={handleCloseModal}
          viewerTimezone={viewerTimezone}
          onRefreshRoster={fetchRoster}
          currentUser={currentUser}
          onLogout={handleLogout}
        />
      )}

      {/* Push Notification Settings & Sleep Shield Modal */}
      <PushModal
        isOpen={activeModal === 'push'}
        onClose={handleCloseModal}
        isPushEnabled={isPushEnabled}
        onPushStateChanged={setIsPushEnabled}
        onOpenScheduleModal={() => {
          setActiveModal('schedule');
        }}
        currentUser={currentUser}
        onOpenLogin={handleOpenLogin}
        onLogout={handleLogout}
      />

      {/* Passcode-Protected Moderator Drawer */}
      <ModDrawer
        isOpen={activeModal === 'mod'}
        onClose={handleCloseModal}
        viewerTimezone={viewerTimezone}
        onRosterChanged={fetchRoster}
        currentUser={currentUser}
      />

      {/* Metastrike Excuse Pass Modal */}
      {metastrikeMember && (
        <MetastrikeModal
          isOpen={true}
          onClose={() => setMetastrikeMember(null)}
          member={metastrikeMember}
          mode={metastrikeMode}
          onSuccess={async () => {
            await fetchRoster();
            setToastMessage({
              text:
                metastrikeMode === 'convert_retroactive'
                  ? 'Metastrike pass applied! Strike successfully converted.'
                  : 'Protected by Metastrike tonight.',
              type: 'success',
            });
            setTimeout(() => setToastMessage(null), 4000);
          }}
        />
      )}

      {/* Interactive Member Profile, Sleep & Wake History Calendar, and Weekly Timetable Modal */}
      {calendarView && (!calendarView.personal || calendarView.memberId === currentUser?.id) && (
        <SleepCalendarModal
          key={`${calendarView.memberId}-${calendarView.personal ?? false}-${calendarView.tab}`}
          isOpen
          onClose={() => setCalendarView(null)}
          memberId={calendarView.memberId}
          member={members.find(member => member.id === calendarView.memberId) ?? null}
          currentUser={currentUser}
          onWakeUpUpdated={fetchRoster}
          onToggleStar={handleToggleStar}
          isStarred={starredMembers.includes(calendarView.memberId)}
          initialTab={calendarView.tab}
          isMySleep={calendarView.personal}
          onOpenScheduleModal={() => {
            setCalendarView(null);
            setActiveModal('schedule');
          }}
        />
      )}
    </main>
  );
}
