import type { ActiveNightlyStrikeLog, Member } from '@/lib/db';

export function rosterStrikeLog(log?: ActiveNightlyStrikeLog | null) {
  if (log == null) return log;
  const { reason: _reason, ...publicLog } = log;
  return publicLog;
}

export function withoutMetastrikeReasons(member: Member & { metastrike_reason?: unknown }): Member {
  const { metastrike_reason: _legacyReason, ...rest } = member;
  return {
    ...rest,
    ...(rest.tonight_strike_log !== undefined && { tonight_strike_log: rosterStrikeLog(rest.tonight_strike_log) }),
    ...(rest.convertible_strike_log !== undefined && { convertible_strike_log: rosterStrikeLog(rest.convertible_strike_log) }),
  };
}
