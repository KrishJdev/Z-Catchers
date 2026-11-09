'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Header } from '@/components/Header';
import { PwaBanner } from '@/components/PwaBanner';
import { StatusBucket } from '@/components/StatusBucket';
import { MemberCard } from '@/components/MemberCard';
import { FoxMascot } from '@/components/FoxMascot';
import { MyScheduleModal } from '@/components/MyScheduleModal';
import { ModDrawer } from '@/components/ModDrawer';
import { computeMemberState, MemberState } from '@/lib/sleepEngine';
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
  X,
  ExternalLink,
} from 'lucide-react';

export default function HomePage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewerTimezone, setViewerTimezone] = useState<string>('UTC');
  const [isPushEnabled, setIsPushEnabled] = useState(false);
  const [isSleepShieldActive, setIsSleepShieldActive] = useState(false);
  const [tick, setTick] = useState(0);

  // Dialog / Modal states
  const [activeModal, setActiveModal] = useState<'schedule' | 'mod' | null>(null);

  // Detect viewer's local timezone
  useEffect(() => {
    try {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (detected) setViewerTimezone(detected);
    } catch {
      setViewerTimezone('UTC');
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

  // Self-refreshing interval every 30s to advance countdowns without layout thrashing
  useEffect(() => {
    const interval = setInterval(() => {
      setTick((prev) => prev + 1);
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  // Categorize members into buckets based on viewer timezone & current clock
  const categorized = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _forceRecompute = tick;

    const nagNow: { member: Member; state: MemberState }[] = [];
    const windingDown: { member: Member; state: MemberState }[] = [];
    const awake: { member: Member; state: MemberState }[] = [];
    const sleeping: { member: Member; state: MemberState }[] = [];

    for (const member of members) {
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
  }, [members, viewerTimezone, tick]);

  const handleEnablePush = async () => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      try {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
          setIsPushEnabled(true);
        }
      } catch (err) {
        console.error('Error requesting push permission:', err);
      }
    }
  };

  return (
    <main className="flex min-h-screen flex-col bg-night-bg">
      <Header
        viewerTimezone={viewerTimezone}
        isPushEnabled={isPushEnabled}
        onTogglePush={handleEnablePush}
        isSleepShieldActive={isSleepShieldActive}
        onToggleSleepShield={() => setIsSleepShieldActive((prev) => !prev)}
        onOpenSchedule={() => setActiveModal('schedule')}
        onOpenMod={() => setActiveModal('mod')}
      />

      <div className="w-full flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 md:py-6 pb-28 md:pb-12">
        <PwaBanner onEnablePush={handleEnablePush} isPushGranted={isPushEnabled} />

        {/* Contextual Sleepy Fox Status Banner */}
        <section className="mb-6 rounded-2xl border border-night-border/80 bg-night-surface/90 p-4 shadow-lg backdrop-blur-sm sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3.5">
              {categorized.nagNow.length > 0 ? (
                <FoxMascot state="alert" size={42} className="animate-pulse" />
              ) : categorized.windingDown.length > 0 ? (
                <FoxMascot state="lantern" size={42} />
              ) : (
                <FoxMascot state="sleeping" size={42} />
              )}
              <div>
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

        {loading ? (
          <div className="flex min-h-[300px] flex-col items-center justify-center gap-3 text-cream-muted">
            <RefreshCw className="h-6 w-6 animate-spin text-status-amber" />
            <p className="text-xs">Gathering community foxes from across timezones...</p>
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
                <MemberCard key={member.id} member={member} state={state} />
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
                <MemberCard key={member.id} member={member} state={state} />
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
                <MemberCard key={member.id} member={member} state={state} />
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
                <MemberCard key={member.id} member={member} state={state} />
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
          onClick={() => setActiveModal('mod')}
          className="flex flex-col items-center gap-1 text-cream-muted transition-colors hover:text-cream-secondary"
          title="Moderator Drawer"
        >
          <Shield className="h-5 w-5" />
          <span className="text-[10px] font-medium">Mod</span>
        </button>
      </nav>

      {/* Self-Service My Schedule Modal (Phase 1.4) */}
      <MyScheduleModal
        isOpen={activeModal === 'schedule'}
        onClose={() => setActiveModal(null)}
        members={members}
        viewerTimezone={viewerTimezone}
        onRefreshRoster={fetchRoster}
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
