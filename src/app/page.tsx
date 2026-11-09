'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Header } from '@/components/Header';
import { PwaBanner } from '@/components/PwaBanner';
import { StatusBucket } from '@/components/StatusBucket';
import { MemberCard } from '@/components/MemberCard';
import { computeMemberState, MemberState } from '@/lib/sleepEngine';
import type { Member } from '@/lib/db';
import { ShieldAlert, Sparkles, Sun, Moon, Home, Clock, Shield, RefreshCw } from 'lucide-react';

export default function HomePage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewerTimezone, setViewerTimezone] = useState<string>('UTC');
  const [isPushEnabled, setIsPushEnabled] = useState(false);
  const [tick, setTick] = useState(0);

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
    <main className="flex min-h-screen flex-col">
      <Header
        viewerTimezone={viewerTimezone}
        isPushEnabled={isPushEnabled}
        onTogglePush={handleEnablePush}
      />

      <div className="flex-1 px-4 py-3">
        <PwaBanner onEnablePush={handleEnablePush} isPushGranted={isPushEnabled} />

        {loading ? (
          <div className="flex min-h-[300px] flex-col items-center justify-center gap-3 text-cream-muted">
            <RefreshCw className="h-6 w-6 animate-spin text-status-amber" />
            <p className="text-xs">Loading community schedule...</p>
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
              defaultExpanded={false}
            >
              {categorized.sleeping.map(({ member, state }) => (
                <MemberCard key={member.id} member={member} state={state} />
              ))}
            </StatusBucket>
          </>
        )}
      </div>

      {/* Sticky Bottom Navigation (Mobile ergonomics) */}
      <nav className="fixed inset-x-0 bottom-0 z-40 mx-auto flex h-16 max-w-[480px] items-center justify-around border-t border-night-border bg-night-surface/95 px-6 backdrop-blur-md pb-[env(safe-area-inset-bottom)]">
        <button
          className="flex flex-col items-center gap-1 text-status-amber"
          title="Roster"
        >
          <Home className="h-5 w-5" />
          <span className="text-[10px] font-medium">Roster</span>
        </button>

        <button
          onClick={() => alert('My Schedule modal will open here in Phase 1!')}
          className="flex flex-col items-center gap-1 text-cream-muted transition-colors hover:text-cream-secondary"
          title="My Bedtime"
        >
          <Clock className="h-5 w-5" />
          <span className="text-[10px] font-medium">My Time</span>
        </button>

        <button
          onClick={() => alert('Moderator controls drawer will open here!')}
          className="flex flex-col items-center gap-1 text-cream-muted transition-colors hover:text-cream-secondary"
          title="Moderator Drawer"
        >
          <Shield className="h-5 w-5" />
          <span className="text-[10px] font-medium">Mod</span>
        </button>
      </nav>
    </main>
  );
}
