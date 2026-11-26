'use client';

import React, { useState } from 'react';
import type { Member } from '@/lib/db';
import { SleepCalendarModal } from '@/components/SleepCalendarModal';

const viewer = {
  id: 'viewer', timezone: 'Asia/Kolkata', discord_username: 'Calendar tester', bedtime_local: '23:00',
  wake_time_local: '07:00', is_active: true, role: 'member',
} as Member;

export default function CalendarReviewFixture() {
  const [target, setTarget] = useState<'peer' | 'viewer' | null>(null);
  return (
    <main>
      <button onClick={() => setTarget('peer')}>Open by ID</button>
      <button onClick={() => setTarget('viewer')}>Open My Sleep</button>
      {target && <SleepCalendarModal key={target} isOpen memberId={target} currentUser={viewer}
        isMySleep={target === 'viewer'} onClose={() => setTarget(null)} />}
    </main>
  );
}
