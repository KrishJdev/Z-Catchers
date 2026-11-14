'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/Header';
import { PwaBanner } from '@/components/PwaBanner';
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
import { computeMemberState, MemberState } from '@/lib/sleepEngine';
import { formatGmtOffset } from '@/lib/timezone';
import {
  registerServiceWorker,
  getExistingSubscription,
  syncPushSubscriptionHealth,
  isPushSupported,
  getStoredMemberId,
  getStoredAuthMember,
  setStoredAuthMember,
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
  BedDouble,
  Clock,
  Calendar,
} from 'lucide-react';

const STORAGE_KEY_STARRED = 'zcatchers_starred_members';
const STORAGE_KEY_CACHED_ROSTER = 'zcatchers_cached_roster';

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
  const [claimedMemberId, setClaimedMemberId] = useState<string | null>(null);

  // Starred accountability buddies
  const [starredMembers, setStarredMembers] = useState<string[]>([]);
  const [buddyFilter, setBuddyFilter] = useState<'all' | 'buddies'>('all');

  // Check-in loading indicator
  const [isCheckingIn, setIsCheckingIn] = useState(false);

  // Strikes & Metastrikes accountability states
  const [metastrikeMember, setMetastrikeMember] = useState<Member | null>(null);
  const [metastrikeMode, setMetastrikeMode] = useState<'proactive' | 'convert_retroactive'>('proactive');
  const [isVotingStrike, setIsVotingStrike] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Dialog / Modal states: 'schedule' | 'mod' | 'push' | null
  const [activeModal, setActiveModal] = useState<'schedule' | 'mod' | 'push' | null>(null);
  const [mobileTab, setMobileTab] = useState<MobileNavTab>('roster');
  const [calendarModalMemberId, setCalendarModalMemberId] = useState<string | null>(null);
  const [calendarModalTab, setCalendarModalTab] = useState<'calendar' | 'timetable'>('calendar');
  const [showHeroManualWake, setShowHeroManualWake] = useState(false);
  const [heroManualWakeTime, setHeroManualWakeTime] = useState('07:30');

  const handleOpenMemberProfile = useCallback((memberId: string, initialTab: 'calendar' | 'timetable' = 'calendar') => {
    setCalendarModalMemberId(memberId);
    setCalendarModalTab(initialTab);
  }, []);

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
      setClaimedMemberId(null);
      setActiveModal(null);
      setToastMessage({
        text: 'Logged out of Fox Den successfully.',
        type: 'info',
      });
      router.replace('/join');
    }
  };

  const handleMobileTabChange = (tab: MobileNavTab) => {
    setMobileTab(tab);
    if (tab === 'roster') {
      setActiveModal(null);
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    } else if (tab === 'schedule') {
      setActiveModal('schedule');
    } else if (tab === 'alerts') {
      setActiveModal('push');
    } else if (tab === 'mod') {
      setActiveModal('mod');
    }
  };

  const handleCloseModal = () => {
    setActiveModal(null);
    setMobileTab('roster');
  };

  // Route Guard: verify claimed session in localStorage or via /api/auth/me cookie
  useEffect(() => {
    let isMounted = true;
    const cachedMember = getStoredAuthMember<Member>();
    const cachedToken = getStoredAuthToken();
    const cachedId = getStoredMemberId();

    if (cachedMember && (cachedToken || cachedId)) {
      setCurrentUser(cachedMember);
      setClaimedMemberId(cachedMember.id);
      setIsSessionChecked(true);

      // Verify in background
      fetch('/api/auth/me')
        .then((res) => res.json())
        .then((data) => {
          if (!isMounted) return;
          if (data.authenticated && data.member) {
            setCurrentUser(data.member);
            setClaimedMemberId(data.member.id);
            setStoredAuthMember(data.member);
          } else if (data.authenticated === false) {
            clearAuthSession();
            setCurrentUser(null);
            setClaimedMemberId(null);
            router.replace('/join');
          }
        })
        .catch((err) => console.warn('Auth background verify error:', err));
      return;
    }

    // No local storage session -> query /api/auth/me to check session cookie
    fetch('/api/auth/me')
      .then((res) => res.json())
      .then((data) => {
        if (!isMounted) return;
        if (data.authenticated && data.member) {
          setCurrentUser(data.member);
          setClaimedMemberId(data.member.id);
          setStoredAuthMember(data.member);
          setIsSessionChecked(true);
        } else {
          router.replace('/join');
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        console.warn('Auth check error:', err);
        router.replace('/join');
      });

    return () => {
      isMounted = false;
    };
  }, [router]);

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

  // Sync claimed member ID & starred buddies from localStorage
  useEffect(() => {
    try {
      const storedId = getStoredMemberId();
      if (storedId) setClaimedMemberId(storedId);

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
      const res = await fetch('/api/members');
      if (res.ok) {
        const json = await res.json();
        if (json.members) {
          setMembers(json.members);
          setCurrentUser((prev) => {
            if (!prev) return null;
            const updated = json.members.find((m: Member) => m.id === prev.id);
            return updated ? { ...prev, ...updated } : prev;
          });
          try {
            localStorage.setItem(STORAGE_KEY_CACHED_ROSTER, JSON.stringify(json.members));
          } catch {
            // Ignore quota errors
          }
        }
      }
    } catch (err) {
      console.error('Failed to load roster:', err);
      // Offline fallback: hydrate from cached snapshot if available
      try {
        const cached = localStorage.getItem(STORAGE_KEY_CACHED_ROSTER);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setMembers((prev) => (prev.length === 0 ? parsed : prev));
          }
        }
      } catch {
        // Ignore JSON parse errors
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Preload cached roster snapshot on initial mount & track online/offline connectivity
  useEffect(() => {
    try {
      const cached = localStorage.getItem(STORAGE_KEY_CACHED_ROSTER);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMembers((prev) => (prev.length === 0 ? parsed : prev));
          setLoading(false);
        }
      }
    } catch {
      // Ignore
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
  const handleCheckIn = useCallback(async (memberId: string) => {
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
      } else if (res.status === 401) {
        router.push('/join');
      } else {
        const data = await res.json().catch(() => ({}));
        setToastMessage({
          text: data.error || 'Failed to check in.',
          type: 'error',
        });
        await fetchRoster();
      }
    } catch (err) {
      console.error('Failed to check in:', err);
      setToastMessage({
        text: 'Network error checking in.',
        type: 'error',
      });
      await fetchRoster();
    } finally {
      setIsCheckingIn(false);
    }
  }, [fetchRoster, router]);

  // Wake Up handler (Instant Button or Manual Time Entry)
  const handleWakeUp = useCallback(
    async (memberId: string, mode: 'button' | 'manual' = 'button', wokeUpTime?: string, cycleDate?: string) => {
      try {
        setIsCheckingIn(true);
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        const token = getStoredAuthToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch('/api/members/wake-up', {
          method: 'POST',
          headers,
          body: JSON.stringify({ memberId, mode, wokeUpTime, cycleDate }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          setCurrentUser((prev) =>
            prev && prev.id === memberId
              ? { ...prev, is_in_bed: false, is_woke_up: true, last_woke_up_at: data.sleep_log?.woke_up_at }
              : prev
          );
          setIsSleepShieldActive(false);
          setShowHeroManualWake(false);
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
  const handleCancelInBed = useCallback(async (memberId: string) => {
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
        setCurrentUser((prev) => (prev && prev.id === memberId ? { ...prev, is_in_bed: false, is_woke_up: true } : prev));
        setIsSleepShieldActive(false);
        setToastMessage({
          text: data.message || 'Status updated from sleeping to awake.',
          type: 'success',
        });
        await fetchRoster();
      } else if (res.status === 401) {
        router.push('/join');
      } else {
        const data = await res.json().catch(() => ({}));
        setToastMessage({
          text: data.error || 'Failed to undo sleep state.',
          type: 'error',
        });
      }
    } catch (err) {
      console.error('Failed to cancel check-in:', err);
      setToastMessage({
        text: 'Network error undoing sleep state.',
        type: 'error',
      });
    } finally {
      setIsCheckingIn(false);
    }
  }, [fetchRoster, router]);

  // Cancel 48-hour pending schedule cooldown handler
  const handleCancelPending = useCallback(
    async (memberId: string) => {
      try {
        setIsCheckingIn(true);
        // Instant optimistic UI update
        setCurrentUser((prev) =>
          prev && prev.id === memberId
            ? {
                ...prev,
                pending_bedtime_local: null,
                pending_wake_time_local: null,
                pending_timezone: null,
                pending_weekend_bedtime_local: null,
                pending_weekend_wake_time_local: null,
                pending_weekly_schedule: null,
                pending_effective_at: null,
              }
            : prev
        );

        const token = getStoredAuthToken();
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch('/api/members/cancel-pending', {
          method: 'POST',
          headers,
          body: JSON.stringify({ member_id: memberId }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          setToastMessage({
            text: data.message || 'Pending schedule change cancelled successfully.',
            type: 'success',
          });
          await fetchRoster();
        } else {
          setToastMessage({
            text: data.error || 'Failed to cancel pending schedule change.',
            type: 'error',
          });
          await fetchRoster();
        }
      } catch (err) {
        console.error('Failed to cancel pending schedule change:', err);
        setToastMessage({
          text: 'Network error cancelling pending schedule change.',
          type: 'error',
        });
        await fetchRoster();
      } finally {
        setIsCheckingIn(false);
      }
    },
    [fetchRoster]
  );

  // Synchronize currentUser in_bed status to active Sleep Shield
  useEffect(() => {
    if (currentUser) {
      setIsSleepShieldActive(Boolean(currentUser.is_in_bed));
    }
  }, [currentUser, currentUser?.is_in_bed]);

  // Personal Sleep Shield toggle handler for Header
  const handleToggleSleepShield = useCallback(async () => {
    if (!currentUser) {
      setToastMessage({
        text: 'Please log in to your profile to toggle your personal Sleep Shield.',
        type: 'info',
      });
      return;
    }

    try {
      if (currentUser.is_in_bed) {
        await handleCancelInBed(currentUser.id);
        setIsSleepShieldActive(false);
        setToastMessage({
          text: 'Sleep Shield turned OFF. Bedtime reminders restored.',
          type: 'info',
        });
      } else {
        await handleCheckIn(currentUser.id);
        setIsSleepShieldActive(true);
        setToastMessage({
          text: 'Sleep Shield turned ON! Community nag reminders are safely muted.',
          type: 'success',
        });
      }
    } catch (err) {
      console.error('Failed to toggle Sleep Shield:', err);
    }
  }, [currentUser, handleCancelInBed, handleCheckIn]);

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
          setMobileTab('schedule');
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
      const [rosterRes, authRes] = await Promise.all([
        fetch('/api/members'),
        fetch('/api/auth/me'),
      ]);

      if (rosterRes.ok) {
        const json = await rosterRes.json();
        if (json.members) setMembers(json.members);
      }

      if (authRes.ok) {
        const authJson = await authRes.json();
        if (authJson.authenticated && authJson.member) {
          setCurrentUser(authJson.member);
          setClaimedMemberId(authJson.member.id);
          setStoredAuthMember(authJson.member);
          processDeepLinkAction(authJson.member);
        }
      }
    } catch (err) {
      console.warn('Foreground sync failed:', err);
    }

    // 3. Silent push subscription health-check
    syncPushSubscriptionHealth().catch((err) =>
      console.warn('Silent push sync error:', err)
    );
  }, [processDeepLinkAction]);

  // Register service worker and inspect/re-sync existing push subscription on boot
  useEffect(() => {
    if (isPushSupported()) {
      registerServiceWorker().then(() => {
        getExistingSubscription().then((sub) => {
          if (sub) {
            setIsPushEnabled(true);
          }
        });
        // Silent subscription health-check on app boot
        syncPushSubscriptionHealth().then((synced) => {
          if (synced) setIsPushEnabled(true);
        });
      });
    }
  }, []);

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

  // Community 2-Vote Strike Handler
  const handleVoteStrike = async (targetMemberId: string) => {
    try {
      setIsVotingStrike(true);
      const token = getStoredAuthToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/members/strikes', {
        method: 'POST',
        headers,
        body: JSON.stringify({ target_member_id: targetMemberId }),
      });

      const json = await res.json();
      if (!res.ok) {
        if (res.status === 401) {
          router.push('/join');
        }
        setToastMessage({ text: json.error || 'Failed to cast strike vote.', type: 'error' });
        setTimeout(() => setToastMessage(null), 4000);
        return;
      }

      if (json.strike_issued) {
        setToastMessage({
          text: '2/2 Votes Reached! Strike officially issued for tonight.',
          type: 'success',
        });
      } else {
        setToastMessage({
          text: `Vote recorded (${json.votes_count}/2). One more vote will issue a strike.`,
          type: 'info',
        });
      }
      setTimeout(() => setToastMessage(null), 4000);
      await fetchRoster();
    } catch (err) {
      console.error('Strike voting error:', err);
    } finally {
      setIsVotingStrike(false);
    }
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

    const nagNow: { member: Member; state: MemberState }[] = [];
    const windingDown: { member: Member; state: MemberState }[] = [];
    const awake: { member: Member; state: MemberState }[] = [];
    const sleeping: { member: Member; state: MemberState }[] = [];

    for (const member of displayedMembers) {
      const state = computeMemberState(member, viewerTimezone);
      switch (state.bucket) {
        case 'BEDTIME_NOW':
          nagNow.push({ member, state });
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

    // Sort: nagNow by most overdue, windingDown by closest to bedtime, awake by time until bedtime
    nagNow.sort((a, b) => b.state.diffMinutes - a.state.diffMinutes);
    windingDown.sort((a, b) => b.state.diffMinutes - a.state.diffMinutes);

    return { nagNow, windingDown, awake, sleeping };
  }, [displayedMembers, viewerTimezone, tick]);

  // Home Screen App Badging API: Sync overdue friend count to mobile PWA icon
  useEffect(() => {
    if (typeof navigator !== 'undefined' && 'setAppBadge' in navigator) {
      const overdueCount = categorized.nagNow.length;
      if (overdueCount > 0) {
        navigator.setAppBadge(overdueCount).catch(() => {});
      } else if ('clearAppBadge' in navigator) {
        navigator.clearAppBadge().catch(() => {});
      }
    }
  }, [categorized.nagNow.length]);

  const handleOpenPushModal = () => {
    setActiveModal('push');
    setMobileTab('alerts');
  };

  // If waiting for route guard session verification, show Warm Dark splash
  if (!isSessionChecked) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-night-bg text-cream-primary p-4">
        <FoxMascot state="sleeping" size={56} className="animate-pulse mb-3" />
        <h1 className="text-xl font-bold tracking-tight">Z Catchers</h1>
        <p className="text-xs text-cream-secondary mt-1">Entering the Fox Den...</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col bg-night-bg">
      <Header
        viewerTimezone={viewerTimezone}
        isPushEnabled={isPushEnabled}
        onTogglePush={handleOpenPushModal}
        isSleepShieldActive={isSleepShieldActive}
        onToggleSleepShield={handleToggleSleepShield}
        onOpenSchedule={() => {
          setActiveModal('schedule');
          setMobileTab('schedule');
        }}
        onOpenMod={() => {
          setActiveModal('mod');
          setMobileTab('mod');
        }}
        currentUser={currentUser}
        onOpenLogin={handleOpenLogin}
        onLogout={handleLogout}
      />

      <div className="w-full flex-1 max-w-7xl mx-auto px-4 sm:px-6 py-4 md:py-6 pb-36 md:pb-24">
        {/* Floating Notification Toast */}
        {toastMessage && (
          <div
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

        <PwaBanner onEnablePush={handleOpenPushModal} isPushGranted={isPushEnabled} />

        {/* Contextual Sleepy Fox Status Banner */}
        <section className="mb-6 rounded-2xl border border-night-border/80 bg-night-surface/90 p-4 shadow-lg backdrop-blur-sm sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3.5">
              {claimedMember?.is_in_bed ? (
                <FoxMascot state="sleeping" size={42} />
              ) : categorized.nagNow.length > 0 ? (
                <FoxMascot state="alert" size={42} className="animate-pulse" />
              ) : categorized.windingDown.length > 0 ? (
                <FoxMascot state="lantern" size={42} />
              ) : (
                <FoxMascot state="sleeping" size={42} />
              )}

              <div>
                {/* Dynamic personalized greeting if viewer is claimed and near bedtime */}
                {claimedMember && (claimedMember.is_in_bed || claimedMemberState?.needsWakeUpLog || claimedMemberState?.bucket === 'SLEEPING') ? (
                  <div className="flex flex-col gap-2.5">
                    <div className="flex items-center gap-3 flex-wrap">
                      <div>
                        <h2 className="text-sm font-bold tracking-wide text-status-amber sm:text-base">
                          {claimedMember.is_in_bed ? `Goodnight, ${claimedMember.discord_username}!` : `Rise and shine, ${claimedMember.discord_username}!`}
                        </h2>
                        <p className="text-xs text-cream-secondary sm:text-sm">
                          {claimedMember.is_in_bed
                            ? "You're safely tucked in. Sleep Shield active; community nags are suppressed."
                            : "Log your wake-up time to complete your sleep cycle and see duration stats."}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Primary Instant ☀️ I Woke Up Button */}
                        <button
                          type="button"
                          onClick={() => handleWakeUp(claimedMember.id, 'button')}
                          disabled={isCheckingIn}
                          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-status-amber bg-status-amber text-night-bg px-3.5 h-11 min-h-[44px] text-xs font-bold hover:bg-status-amber/90 active:scale-95 transition-all whitespace-nowrap shadow-sm"
                          title="Log wake-up right now"
                        >
                          <Sun className="h-4 w-4" />
                          <span>☀️ I Woke Up</span>
                        </button>

                        {/* Secondary Enter Time Manually Button */}
                        <button
                          type="button"
                          onClick={() => setShowHeroManualWake((prev) => !prev)}
                          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-night-border bg-night-elevated px-3 h-11 min-h-[44px] text-xs font-semibold text-cream-secondary hover:text-cream-primary hover:border-night-border/80 active:scale-95 transition-all whitespace-nowrap"
                          title="Enter exact wake-up time manually"
                        >
                          <Clock className="h-3.5 w-3.5 text-status-amber" />
                          <span>Enter Time Manually</span>
                        </button>

                        {/* Undo check-in Option (only when actively in bed) */}
                        {claimedMember.is_in_bed && (
                          <button
                            type="button"
                            onClick={() => handleCancelInBed(claimedMember.id)}
                            disabled={isCheckingIn}
                            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-status-amber/40 bg-status-amber/15 px-3 h-11 min-h-[44px] text-xs font-semibold text-status-amber hover:bg-status-amber/25 active:scale-95 transition-all whitespace-nowrap shadow-sm"
                            title="Undo check-in (returns from sleeping state to awake)"
                          >
                            <Sun className="h-4 w-4" />
                            <span>Undo check-in</span>
                          </button>
                        )}

                        {/* View My Calendar */}
                        <button
                          type="button"
                          onClick={() => handleOpenMemberProfile(claimedMember.id, 'calendar')}
                          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-night-border bg-night-elevated px-3 h-11 min-h-[44px] text-xs font-medium text-cream-muted hover:text-cream-secondary active:scale-95 transition-all whitespace-nowrap"
                          title="Open my sleep history calendar"
                        >
                          <Calendar className="h-3.5 w-3.5 text-status-amber" />
                          <span>Calendar</span>
                        </button>
                      </div>
                    </div>

                    {/* Inline Manual Time Entry Form */}
                    {showHeroManualWake && (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (!heroManualWakeTime) return;
                          handleWakeUp(claimedMember.id, 'manual', heroManualWakeTime);
                        }}
                        className="flex items-center gap-2 p-2.5 rounded-xl bg-night-elevated/80 border border-night-border/70 flex-wrap"
                      >
                        <span className="text-xs font-semibold text-cream-secondary">What time did you wake up?</span>
                        <input
                          type="time"
                          value={heroManualWakeTime}
                          onChange={(e) => setHeroManualWakeTime(e.target.value)}
                          required
                          className="rounded-lg border border-night-border bg-night-surface px-2.5 py-1.5 text-xs text-cream-primary font-mono focus:border-status-amber focus:outline-none min-h-[44px]"
                        />
                        <button
                          type="submit"
                          disabled={isCheckingIn}
                          className="h-11 min-h-[44px] px-3.5 rounded-lg bg-status-amber text-xs font-bold text-night-bg hover:bg-status-amber/90 active:scale-95 transition-all whitespace-nowrap shrink-0"
                        >
                          {isCheckingIn ? 'Saving...' : 'Save Wake Time'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowHeroManualWake(false)}
                          className="h-11 min-h-[44px] px-3 rounded-lg border border-night-border text-xs font-medium text-cream-secondary hover:text-cream-primary whitespace-nowrap shrink-0"
                        >
                          Cancel
                        </button>
                      </form>
                    )}
                  </div>
                ) : claimedMember && claimedMember.is_woke_up ? (
                  <div className="flex items-center gap-3 flex-wrap">
                    <div>
                      <h2 className="text-sm font-bold tracking-wide text-cream-primary sm:text-base">
                        Good Morning, {claimedMember.discord_username}!
                      </h2>
                      <p className="text-xs text-cream-secondary sm:text-sm">
                        You&apos;re marked as awake. Ready for today&apos;s adventures in the den!
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => handleCheckIn(claimedMember.id)}
                        disabled={isCheckingIn}
                        className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-night-border bg-night-elevated px-3.5 h-11 min-h-[44px] text-xs font-medium text-cream-secondary hover:text-cream-primary hover:border-night-border/80 active:scale-95 transition-all whitespace-nowrap shadow-sm"
                        title="Heading back to bed? Tap to silence outgoing community nag alerts."
                      >
                        <BedDouble className="h-4 w-4 text-status-amber" />
                        <span>Back to Bed</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleOpenMemberProfile(claimedMember.id, 'calendar')}
                        className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-night-border bg-night-elevated px-3.5 h-11 min-h-[44px] text-xs font-medium text-cream-secondary hover:text-cream-primary hover:border-night-border/80 active:scale-95 transition-all whitespace-nowrap shadow-sm"
                        title="View monthly sleep & wake calendar"
                      >
                        <Calendar className="h-4 w-4 text-status-amber" />
                        <span>Sleep Calendar</span>
                      </button>
                    </div>
                  </div>
                ) : claimedMember &&
                  claimedMemberState &&
                  (claimedMemberState.bucket === 'BEDTIME_NOW' ||
                    claimedMemberState.bucket === 'WINDING_DOWN' ||
                    (claimedMemberState.diffMinutes >= -180 && claimedMemberState.diffMinutes < 0)) ? (
                  <div className="flex items-center gap-3 flex-wrap">
                    <div>
                      <h2 className="text-sm font-bold tracking-wide text-status-amber sm:text-base">
                        {claimedMemberState.bucket === 'BEDTIME_NOW'
                          ? `Bedtime Hit for you, ${claimedMember.discord_username}!`
                          : `Wind-Down Time, ${claimedMember.discord_username}!`}
                      </h2>
                      <p className="text-xs text-cream-secondary sm:text-sm">
                        Heading to sleep? Tap to silence outgoing community nag alerts for tonight.
                      </p>
                    </div>
                    <button
                      onClick={() => handleCheckIn(claimedMember.id)}
                      disabled={isCheckingIn}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-status-amber px-3.5 h-11 min-h-[44px] text-xs font-bold text-night-bg shadow hover:bg-status-amber/90 active:scale-95 transition-all whitespace-nowrap"
                    >
                      <BedDouble className="h-4 w-4" />
                      <span>I&apos;m in Bed (Goodnight)</span>
                    </button>
                  </div>
                ) : (
                  <>
                    <h2 className="text-sm font-bold tracking-wide text-cream-primary sm:text-base">
                      {categorized.nagNow.length > 0
                        ? `Bedtime Alert: ${categorized.nagNow.length} friend${
                            categorized.nagNow.length > 1 ? 's' : ''
                          } hit bedtime!`
                        : categorized.windingDown.length > 0
                        ? `Winding Down: ${categorized.windingDown.length} friend${
                            categorized.windingDown.length > 1 ? 's' : ''
                          } heading to bed soon`
                        : 'The Fox Den is Peaceful'}
                    </h2>
                    <p className="text-xs text-cream-secondary sm:text-sm">
                      {categorized.nagNow.length > 0
                        ? 'Check their Discord journal threads to nag them off screens and into bed.'
                        : categorized.windingDown.length > 0
                        ? 'Say your goodnights and remind them to turn down blue light.'
                        : isSleepShieldActive
                        ? 'Your personal Sleep Shield is active. Community nag notifications are suppressed.'
                        : 'All friends are currently wide awake or resting safely in their sleep windows.'}
                    </p>
                  </>
                )}
              </div>
            </div>

            {/* Quick summary counters */}
            <div className="flex items-center gap-2 self-start rounded-xl bg-night-surface border border-night-border px-3 py-1.5 text-xs font-medium text-cream-secondary sm:self-auto">
              <span className="text-status-coral font-bold tabular-nums">
                {categorized.nagNow.length} Nag
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
              The den is peaceful and ready for your friends! Create your profile to set your local bedtime, link your Discord journal, and choose a simple 4-digit PIN.
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
            {/* 1. Bedtime Hit / Nag Now (Always top priority) */}
            <StatusBucket
              title="Nag Now"
              count={categorized.nagNow.length}
              accentColor="text-status-coral"
              icon={<ShieldAlert className="h-4 w-4 text-status-coral animate-pulse" />}
              defaultExpanded={true}
              showEmptyState={false}
            >
              {categorized.nagNow.map(({ member, state }) => (
                <MemberCard
                  key={member.id}
                  member={member}
                  state={state}
                  currentMemberId={currentUser?.id || claimedMemberId}
                  isStarred={starredMembers.includes(member.id)}
                  onToggleStar={handleToggleStar}
                  onCheckIn={handleCheckIn}
                  onCancelInBed={handleCancelInBed}
                  isCheckingIn={isCheckingIn}
                  onVoteStrike={handleVoteStrike}
                  onOpenMetastrike={handleOpenMetastrike}
                  isVotingStrike={isVotingStrike}
                  isModerator={Boolean(currentUser?.role === 'moderator' || currentUser?.is_moderator)}
                  onOpenProfile={handleOpenMemberProfile}
                  onOpenSleepCalendar={handleOpenMemberProfile}
                  onWakeUp={handleWakeUp}
                />
              ))}
            </StatusBucket>

            {/* 2. Winding Down */}
            <StatusBucket
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
                  currentMemberId={currentUser?.id || claimedMemberId}
                  isStarred={starredMembers.includes(member.id)}
                  onToggleStar={handleToggleStar}
                  onCheckIn={handleCheckIn}
                  onCancelInBed={handleCancelInBed}
                  isCheckingIn={isCheckingIn}
                  onVoteStrike={handleVoteStrike}
                  onOpenMetastrike={handleOpenMetastrike}
                  isVotingStrike={isVotingStrike}
                  isModerator={Boolean(currentUser?.role === 'moderator' || currentUser?.is_moderator)}
                  onOpenProfile={handleOpenMemberProfile}
                  onOpenSleepCalendar={handleOpenMemberProfile}
                  onWakeUp={handleWakeUp}
                />
              ))}
            </StatusBucket>

            {/* 3. Awake */}
            <StatusBucket
              title="Awake"
              count={categorized.awake.length}
              accentColor="text-cream-secondary"
              icon={<Sun className="h-4 w-4 text-cream-secondary" />}
              defaultExpanded={true}
            >
              {categorized.awake.map(({ member, state }) => (
                <MemberCard
                  key={member.id}
                  member={member}
                  state={state}
                  currentMemberId={currentUser?.id || claimedMemberId}
                  isStarred={starredMembers.includes(member.id)}
                  onToggleStar={handleToggleStar}
                  onCheckIn={handleCheckIn}
                  onCancelInBed={handleCancelInBed}
                  isCheckingIn={isCheckingIn}
                  onVoteStrike={handleVoteStrike}
                  onOpenMetastrike={handleOpenMetastrike}
                  isVotingStrike={isVotingStrike}
                  isModerator={Boolean(currentUser?.role === 'moderator' || currentUser?.is_moderator)}
                  onOpenProfile={handleOpenMemberProfile}
                  onOpenSleepCalendar={handleOpenMemberProfile}
                  onWakeUp={handleWakeUp}
                />
              ))}
            </StatusBucket>

            {/* 4. Sleeping (Sleep Shield Active) */}
            <StatusBucket
              title="Sleeping"
              count={categorized.sleeping.length}
              accentColor="text-cream-muted"
              icon={<Moon className="h-4 w-4 text-cream-muted" />}
              defaultExpanded={categorized.awake.length === 0}
              showEmptyState={true}
              emptyMessage="No members currently asleep."
            >
              {categorized.sleeping.map(({ member, state }) => (
                <MemberCard
                  key={member.id}
                  member={member}
                  state={state}
                  currentMemberId={currentUser?.id || claimedMemberId}
                  isStarred={starredMembers.includes(member.id)}
                  onToggleStar={handleToggleStar}
                  onCheckIn={handleCheckIn}
                  onCancelInBed={handleCancelInBed}
                  isCheckingIn={isCheckingIn}
                  onVoteStrike={handleVoteStrike}
                  onOpenMetastrike={handleOpenMetastrike}
                  isVotingStrike={isVotingStrike}
                  isModerator={Boolean(currentUser?.role === 'moderator' || currentUser?.is_moderator)}
                  onOpenProfile={handleOpenMemberProfile}
                  onOpenSleepCalendar={handleOpenMemberProfile}
                  onWakeUp={handleWakeUp}
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
          isSleepShieldActive={isSleepShieldActive}
          onCheckIn={handleCheckIn}
          onWakeUp={handleWakeUp}
          onCancelPending={handleCancelPending}
          isCheckingIn={isCheckingIn}
        />
      )}

      {/* Sticky Bottom Navigation (Mobile Viewports Only: < 768px) */}
      <BottomNav
        activeTab={mobileTab}
        onChangeTab={handleMobileTabChange}
        isPushEnabled={isPushEnabled}
        isModerator={currentUser?.role === 'moderator'}
      />

      {/* Self-Service My Schedule Modal */}
      <MyScheduleModal
        isOpen={activeModal === 'schedule'}
        onClose={handleCloseModal}
        members={members}
        viewerTimezone={viewerTimezone}
        onRefreshRoster={fetchRoster}
        currentUser={currentUser}
        onLogout={handleLogout}
        onOpenSleepCalendar={(mId) => setCalendarModalMemberId(mId)}
      />

      {/* Push Notification Settings & Sleep Shield Modal */}
      <PushModal
        isOpen={activeModal === 'push'}
        onClose={handleCloseModal}
        members={members}
        isPushEnabled={isPushEnabled}
        onPushStateChanged={setIsPushEnabled}
        onOpenScheduleModal={() => {
          setActiveModal('schedule');
          setMobileTab('schedule');
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
                  : 'Protected by Metastrike tonight! Strike votes disabled.',
              type: 'success',
            });
            setTimeout(() => setToastMessage(null), 4000);
          }}
        />
      )}

      {/* Interactive Member Profile, Sleep & Wake History Calendar, and Weekly Timetable Modal */}
      <SleepCalendarModal
        isOpen={Boolean(calendarModalMemberId)}
        onClose={() => setCalendarModalMemberId(null)}
        memberId={calendarModalMemberId}
        member={calendarModalMemberId ? members.find((m) => m.id === calendarModalMemberId) || null : null}
        currentUser={currentUser}
        onWakeUpUpdated={fetchRoster}
        onToggleStar={handleToggleStar}
        isStarred={calendarModalMemberId ? starredMembers.includes(calendarModalMemberId) : false}
        initialTab={calendarModalTab}
        onOpenScheduleModal={() => {
          setCalendarModalMemberId(null);
          setActiveModal('schedule');
          setMobileTab('schedule');
        }}
      />
    </main>
  );
}
