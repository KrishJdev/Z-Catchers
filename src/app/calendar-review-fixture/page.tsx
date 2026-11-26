'use client';

import React, { useEffect, useState } from 'react';
import type { Member } from '@/lib/db';
import { SleepCalendarModal } from '@/components/SleepCalendarModal';

const viewer = {
  id: 'viewer', timezone: 'Asia/Kolkata', discord_username: 'Calendar tester', bedtime_local: '23:00',
  wake_time_local: '07:00', is_active: true, role: 'member',
} as Member;

export default function CalendarReviewFixture() {
  const [target, setTarget] = useState<'peer' | 'viewer' | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return (
    <main data-ready={ready}>
      <button onClick={() => setTarget('peer')}>Open by ID</button>
      <button onClick={() => setTarget('viewer')}>Open My Sleep</button>
      {target && <SleepCalendarModal key={target} isOpen memberId={target} currentUser={viewer}
        isMySleep={target === 'viewer'} onClose={() => setTarget(null)} />}
    </main>
  );
}
