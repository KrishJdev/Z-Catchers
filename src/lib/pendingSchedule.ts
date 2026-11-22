import type { Member } from '@/lib/db';

export function pendingScheduleSnapshot(member: Member) {
  return {
    pending_effective_at: member.pending_effective_at ?? null,
    pending_bedtime_local: member.pending_bedtime_local ?? null,
    pending_wake_time_local: member.pending_wake_time_local ?? null,
    pending_timezone: member.pending_timezone ?? null,
    pending_weekend_bedtime_local: member.pending_weekend_bedtime_local ?? null,
    pending_weekend_wake_time_local: member.pending_weekend_wake_time_local ?? null,
    pending_weekly_schedule: member.pending_weekly_schedule ?? null,
  };
}
