'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Header } from '@/components/Header';
import { PwaBanner } from '@/components/PwaBanner';
import { StatusBucket } from '@/components/StatusBucket';
import { MemberCard } from '@/components/MemberCard';
import { FoxMascot } from '@/components/FoxMascot';
import { MyScheduleModal } from '@/components/MyScheduleModal';
import { ModDrawer } from '@/components/ModDrawer';
import { PushModal } from '@/components/PushModal';
import { LoginModal } from '@/components/LoginModal';
import { computeMemberState, MemberState } from '@/lib/sleepEngine';
import {
  registerServiceWorker,
  getExistingSubscription,
  isPushSupported,
  getStoredMemberId,
  getStoredAuthMember,
  setStoredAuthMember,
  getStoredAuthToken,
} from '@/lib/pushClient';
import type { Member } from '@/lib/db';
import {
  ShieldAlert,
  Sparkles,
  Sun,
  Moon,
  Home,
  Clock,
  Shield,
  RefreshCw,
  Bell,
  Star,
  Users,
  KeyRound,
  User,
} from 'lucide-react';

const STORAGE_KEY_STARRED = 'zcatchers_starred_members';

export default function HomePage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewerTimezone, setViewerTimezone] = useState<string>('UTC');
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

  // Dialog / Modal states: 'schedule' | 'mod' | 'push' | null
  const [activeModal, setActiveModal] = useState<'schedule' | 'mod' | 'push' | 'login' | null>(null);

  // Detect viewer's local timezone
  useEffect(() => {
    try {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (detected) setViewerTimezone(detected);
    } catch {
      setViewerTimezone('UTC');
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

  // Check auth session on mount
  useEffect(() => {
    const cached = getStoredAuthMember<Member>();
    if (cached) {
      setCurrentUser(cached);
      setClaimedMemberId(cached.id);
    }

    fetch('/api/auth/me')
      .then((res) => res.json())
      .then((data) => {
        if (data.authenticated && data.member) {
          setCurrentUser(data.member);
          setClaimedMemberId(data.member.id);
          setStoredAuthMember(data.member);
        }
      })
      .catch((err) => console.warn('Auth check error:', err));
  }, []);

  // Register service worker and inspect existing push subscription
  useEffect(() => {
    if (isPushSupported()) {
      registerServiceWorker().then(() => {
        getExistingSubscription().then((sub) => {
          if (sub) {
            setIsPushEnabled(true);
          }
        });
      });
    }
  }, []);

  // Fetch roster
  const fetchRoster = useCallback(async () => {
    try {
      const res = await fetch('/api/members');
      if (res.ok) {
        const json = await res.json();
        if (json.members) setMembers(json.members);
      }
    } catch (err) {
      console.error('Failed to load roster:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRoster();
  }, [fetchRoster]);

  // Self-refreshing interval every 30s to advance countdowns and periodically sync roster
  useEffect(() => {
    const tickInterval = setInterval(() => {
      setTick((prev) => prev + 1);
    }, 30000);

    // Periodic 60s roster sync to reflect buddy check-ins and bedtime shifts
    const rosterInterval = setInterval(() => {
      fetchRoster();
    }, 60000);

    // Instant sync on window focus or tab visibility resume
    const handleFocus = () => {
      setTick((prev) => prev + 1);
      fetchRoster();
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        handleFocus();
      }
    });

    return () => {
      clearInterval(tickInterval);
      clearInterval(rosterInterval);
      window.removeEventListener('focus', handleFocus);
    };
  }, [fetchRoster]);

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

  // "I'm in Bed" Check-In Safe Button handler
  const handleCheckIn = async (memberId: string) => {
    try {
      setIsCheckingIn(true);
      const token = getStoredAuthToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/members/in-bed', {
        method: 'POST',
        headers,
        body: JSON.stringify({ memberId, action: 'check_in' }),
      });
      if (res.ok) {
        await fetchRoster();
      } else if (res.status === 401) {
        setActiveModal('login');
      }
    } catch (err) {
      console.error('Failed to check in:', err);
    } finally {
      setIsCheckingIn(false);
    }
  };

  // Cancel "I'm in Bed" check-in handler
  const handleCancelInBed = async (memberId: string) => {
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
        await fetchRoster();
      } else if (res.status === 401) {
        setActiveModal('login');
      }
    } catch (err) {
      console.error('Failed to cancel check-in:', err);
    } finally {
      setIsCheckingIn(false);
    }
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

  const handleOpenPushModal = () => {
    setActiveModal('push');
  };

  return (
    <main className="flex min-h-screen flex-col bg-night-bg">
      <Header
        viewerTimezone={viewerTimezone}
        isPushEnabled={isPushEnabled}
        onTogglePush={handleOpenPushModal}
        isSleepShieldActive={isSleepShieldActive}
        onToggleSleepShield={() => setIsSleepShieldActive((prev) => !prev)}
        onOpenSchedule={() => setActiveModal('schedule')}
        onOpenMod={() => setActiveModal('mod')}
        currentUser={currentUser}
        onOpenLogin={() => setActiveModal('login')}
      />

      <div className="w-full flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 md:py-6 pb-28 md:pb-12">
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
                {claimedMember && claimedMember.is_in_bed ? (
                  <div className="flex items-center gap-3 flex-wrap">
                    <div>
                      <h2 className="text-sm font-bold tracking-wide text-status-sage sm:text-base">
                        Goodnight, {claimedMember.discord_username}! 🌙
                      </h2>
                      <p className="text-xs text-cream-secondary sm:text-sm">
                        You&apos;re safely tucked in. Sleep Shield active; community nags are suppressed.
                      </p>
                    </div>
                    <button
                      onClick={() => handleCancelInBed(claimedMember.id)}
                      disabled={isCheckingIn}
                      className="text-xs text-cream-muted underline hover:text-cream-secondary"
                    >
                      Undo
                    </button>
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
                      className="inline-flex items-center gap-1.5 rounded-xl bg-status-amber px-3.5 py-1.5 text-xs font-bold text-night-bg shadow hover:bg-status-amber/90 active:scale-95 transition-all"
                    >
                      <span>🛏️ I&apos;m in Bed (Goodnight)</span>
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
            <div className="flex items-center gap-2 self-start rounded-xl bg-night-elevated px-3 py-1.5 text-xs font-medium text-cream-secondary sm:self-auto">
              <span className="text-status-coral font-bold tabular-nums">
                {categorized.nagNow.length} Nag
              </span>
              <span>•</span>
              <span className="text-status-amber font-bold tabular-nums">
                {categorized.windingDown.length} Wind
              </span>
              <span>•</span>
              <span className="text-status-slumber font-bold tabular-nums">
                {categorized.sleeping.length} Asleep
              </span>
            </div>
          </div>
        </section>

        {/* Buddy Filter & Quick Navigation Bar */}
        <div className="mb-4 flex items-center justify-between flex-wrap gap-2.5">
          <div className="flex items-center rounded-xl bg-night-surface p-1 border border-night-border/80">
            <button
              onClick={() => setBuddyFilter('all')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${
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
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${
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

          {!claimedMember && (
            <button
              onClick={() => setActiveModal('schedule')}
              className="text-xs text-status-amber hover:underline flex items-center gap-1 font-medium"
            >
              <span>Claim your profile to track streaks & check in</span>
              <span>→</span>
            </button>
          )}
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
        ) : (
          <>
            {/* 1. Bedtime Hit / Nag Now (Always top priority) */}
            <StatusBucket
              title="Nag Now (Bedtime Hit)"
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
                />
              ))}
            </StatusBucket>

            {/* 2. Winding Down */}
            <StatusBucket
              title="Winding Down Soon"
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
                />
              ))}
            </StatusBucket>

            {/* 3. Awake */}
            <StatusBucket
              title="Awake"
              count={categorized.awake.length}
              accentColor="text-status-sage"
              icon={<Sun className="h-4 w-4 text-status-sage" />}
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
                />
              ))}
            </StatusBucket>

            {/* 4. Sleeping (Sleep Shield Active) */}
            <StatusBucket
              title="Sleeping (Shield Active)"
              count={categorized.sleeping.length}
              accentColor="text-status-slumber"
              icon={<Moon className="h-4 w-4 text-status-slumber" />}
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
                />
              ))}
            </StatusBucket>
          </>
        )}
      </div>

      {/* Sticky Bottom Navigation (Mobile Viewports Only: < 768px) */}
      <nav className="fixed inset-x-0 bottom-0 z-40 mx-auto flex h-16 w-full items-center justify-around border-t border-night-border bg-night-surface/95 px-6 backdrop-blur-md pb-[env(safe-area-inset-bottom)] md:hidden">
        <button
          className="flex flex-col items-center gap-1 text-status-amber"
          title="Roster"
        >
          <Home className="h-5 w-5" />
          <span className="text-[10px] font-medium">Roster</span>
        </button>

        <button
          onClick={() => setActiveModal('schedule')}
          className="flex flex-col items-center gap-1 text-cream-muted transition-colors hover:text-cream-secondary"
          title="My Bedtime"
        >
          <Clock className="h-5 w-5" />
          <span className="text-[10px] font-medium">My Time</span>
        </button>

        <button
          onClick={() => setActiveModal('push')}
          className={`flex flex-col items-center gap-1 transition-colors ${
            isPushEnabled ? 'text-status-sage' : 'text-cream-muted hover:text-cream-secondary'
          }`}
          title="Bedtime Alerts"
        >
          <Bell className="h-5 w-5" />
          <span className="text-[10px] font-medium">Alerts</span>
        </button>

        <button
          onClick={() => setActiveModal('mod')}
          className="flex flex-col items-center gap-1 text-cream-muted transition-colors hover:text-cream-secondary"
          title="Moderator Drawer"
        >
          <Shield className="h-5 w-5" />
          <span className="text-[10px] font-medium">Mod</span>
        </button>
      </nav>

      {/* Self-Service My Schedule Modal (Phase 1.4 & Check-In) */}
      <MyScheduleModal
        isOpen={activeModal === 'schedule'}
        onClose={() => setActiveModal(null)}
        members={members}
        viewerTimezone={viewerTimezone}
        onRefreshRoster={fetchRoster}
        currentUser={currentUser}
      />

      {/* Push Notification Settings & Sleep Shield Modal (Phase 1.5 & 1.6) */}
      <PushModal
        isOpen={activeModal === 'push'}
        onClose={() => setActiveModal(null)}
        members={members}
        isPushEnabled={isPushEnabled}
        onPushStateChanged={setIsPushEnabled}
        onOpenScheduleModal={() => setActiveModal('schedule')}
        currentUser={currentUser}
        onOpenLogin={() => setActiveModal('login')}
      />

      {/* Member PIN Login & Profile Claiming Modal (ZC-13) */}
      <LoginModal
        isOpen={activeModal === 'login'}
        onClose={() => setActiveModal(null)}
        members={members}
        currentUser={currentUser}
        onLoginSuccess={(member) => {
          setCurrentUser(member);
          setClaimedMemberId(member.id);
          fetchRoster();
        }}
        onLogout={() => {
          setCurrentUser(null);
          setClaimedMemberId(null);
          fetchRoster();
        }}
      />

      {/* Passcode-Protected Moderator Drawer (Phase 2) */}
      <ModDrawer
        isOpen={activeModal === 'mod'}
        onClose={() => setActiveModal(null)}
        viewerTimezone={viewerTimezone}
        onRosterChanged={fetchRoster}
      />
    </main>
  );
}
