'use client';

import React from 'react';
import { DateTime } from 'luxon';
import { getScheduleForDay, isWeekendNight } from '@/lib/sleepEngine';
import type { Member } from '@/lib/db';
import { DAY_KEYS, type DailySchedule } from '@/lib/timezone';

const monday = DateTime.utc(2020, 1, 6);

function ScheduleTimes({ schedule }: { schedule: DailySchedule }) {
  return (
    <dl className="grid grid-cols-2 gap-x-2 text-sm tabular-nums">
      <div><dt className="text-xs text-cream-secondary">Bedtime</dt><dd>{schedule.bedtime}</dd></div>
      <div><dt className="text-xs text-cream-secondary">Wake</dt><dd>{schedule.wake_time}</dd></div>
    </dl>
  );
}

export function ModeratorScheduleComparison({ member }: { member: Member }) {
  const timezone = member.pending_timezone ?? member.timezone;
  const requestedProfile = {
    ...member,
    bedtime_local: member.pending_bedtime_local ?? member.bedtime_local,
    wake_time_local: member.pending_wake_time_local ?? member.wake_time_local,
    weekend_bedtime_local: member.pending_weekend_bedtime_local ?? null,
    weekend_wake_time_local: member.pending_weekend_wake_time_local ?? null,
    weekly_schedule: member.pending_weekly_schedule ?? null,
  };
  const days = DAY_KEYS.map((day, index) => {
    const night = monday.plus({ days: index });
    const current = getScheduleForDay(member, night);
    const legacyDay = !member.pending_weekly_schedule && member.weekly_schedule?.[day];
    const weekend = isWeekendNight(night);
    // A legacy flat request updates only supplied fields on an existing weekly schedule.
    const requested = legacyDay ? {
      bedtime: (weekend ? member.pending_weekend_bedtime_local : member.pending_bedtime_local) ?? current.bedtime,
      wake_time: (weekend ? member.pending_weekend_wake_time_local : member.pending_wake_time_local) ?? current.wake_time,
    } : getScheduleForDay(requestedProfile, night);
    return {
      name: night.setLocale('en').toFormat('ccc'),
      current,
      requested,
      changed: timezone !== member.timezone ||
        current.bedtime !== requested.bedtime || current.wake_time !== requested.wake_time,
    };
  });
  const changes = days.filter(day => day.changed);
  const visibleDays = changes.length ? changes : days;
  const groups = new Map<string, { names: string[]; current: DailySchedule; requested: DailySchedule }>();
  for (const { name, current, requested } of visibleDays) {
    const key = JSON.stringify([current, requested]);
    const group = groups.get(key);
    if (group) group.names.push(name);
    else groups.set(key, { names: [name], current, requested });
  }

  return (
    <div className="space-y-2">
      {Array.from(groups, ([key, { names, current, requested }]) => (
        <div key={key} className="border-t border-night-border pt-2">
          <p className="mb-1 text-sm font-semibold">{names.length === 7 ? 'Every night' : names.join(', ')}</p>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] gap-x-4 gap-y-2">
            <div className="min-w-0">
              <p className="text-sm font-medium">Current <span className="break-words text-xs text-cream-secondary">({member.timezone})</span></p>
              <ScheduleTimes schedule={current} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-status-amber">Requested <span className="break-words text-xs text-cream-secondary">({timezone})</span></p>
              <ScheduleTimes schedule={requested} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
