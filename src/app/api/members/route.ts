import { NextResponse } from 'next/server';
import {
  supabase,
  supabaseAdmin,
  Member,
  fetchAllNotificationLogs,
  updateMemberSafe,
  hydrateMemberWeekendHours,
} from '@/lib/db';
import { checkCooldownPromotion, calculateSleepStreak, getSleepCycleDate } from '@/lib/sleepEngine';
import { sanitizeMember, getRequestSessionMemberId } from '@/lib/auth';
import { toValidLuxonZone, isValidTimezone, formatGmtOffset } from '@/lib/timezone';
import {
  resolveMemberStrikeCounts,
  getNightlyStrikeLogsBatch,
  getStrikeLogKey,
  getRecentEligibleStrikeLogsBatch,
  getMonthlyStrikeCountsBatch,
} from '@/lib/strikes';
import { DateTime } from 'luxon';

const DISCORD_JOURNAL_REGEX = /^https:\/\/(ptb\.|canary\.)?discord\.com\/channels\/\d+\/\d+(\/\d+)?$/;
const TIME_FORMAT_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * GET: Fetch community roster with hydrated sleep states, streaks, assists, and strike statuses.
 * Uses batched queries for member strike logs and parallel count resolution.
 *
 * @param request - Incoming HTTP request with optional session token
 * @returns JSON response containing list of processed active members
 */
export async function GET(request: Request) {
  try {
    const sessionMemberId = getRequestSessionMemberId(request);
    const { data: members, error } = await supabaseAdmin
      .from('members')
      .select('*')
      .eq('is_active', true)
      .order('discord_username', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const nowUtc = DateTime.utc();

    // Query recent check-ins for streak calculation and today's status (paginated to avoid PostgREST row cap)
    const sixtyDaysAgo = nowUtc.minus({ days: 60 }).toISODate() || '2026-01-01';
    const { data: inBedLogs } = await fetchAllNotificationLogs<{ member_id: string; local_date: string }>((q) =>
      q.select('member_id, local_date')
        .eq('notification_type', 'IN_BED_EARLY')
        .gte('local_date', sixtyDaysAgo)
    );

    const checkinsByMember = new Map<string, string[]>();
    for (const log of (inBedLogs || [])) {
      const dates = checkinsByMember.get(log.member_id) || [];
      dates.push(log.local_date);
      checkinsByMember.set(log.member_id, dates);
    }

    // Query recent woke-up logs to support manual awake / undo sleep transition
    const twoDaysAgo = nowUtc.minus({ days: 2 }).toISODate() || '2026-01-01';
    const { data: wokeUpLogs } = await fetchAllNotificationLogs<{ member_id: string; local_date: string }>((q) =>
      q.select('member_id, local_date')
        .eq('notification_type', 'WOKE_UP')
        .gte('local_date', twoDaysAgo)
    );

    const wokeUpSet = new Set((wokeUpLogs || []).map((l) => `${l.member_id}_${l.local_date}`));

    // Query recent nag assists for today's active count (paginated to avoid PostgREST row cap)
    const { data: nagLogs } = await fetchAllNotificationLogs<{ member_id: string; local_date: string }>((q) =>
      q.select('member_id, local_date')
        .like('notification_type', 'NAG_ASSIST:%')
        .gte('local_date', twoDaysAgo)
    );

    const nagAssistsByMemberAndDate = new Map<string, number>();
    for (const log of (nagLogs || [])) {
      const key = `${log.member_id}_${log.local_date}`;
      nagAssistsByMemberAndDate.set(key, (nagAssistsByMemberAndDate.get(key) || 0) + 1);
    }

    // Process self-healing cooldown promotions and prepare member metrics
    const memberItems: {
      hydratedMember: Member;
      localDateStr: string;
      is_in_bed: boolean;
      is_woke_up: boolean;
      streak_days: number;
      nag_assists_count: number;
    }[] = [];

    for (const member of (members as Member[]) || []) {
      const { promoted, activeMember } = checkCooldownPromotion(member, nowUtc);
      if (promoted) {
        // Update DB in background with safe column stripping
        await updateMemberSafe(member.id, {
          bedtime_local: activeMember.bedtime_local,
          wake_time_local: activeMember.wake_time_local,
          timezone: activeMember.timezone,
          weekend_bedtime_local: activeMember.weekend_bedtime_local || null,
          weekend_wake_time_local: activeMember.weekend_wake_time_local || null,
          weekly_schedule: activeMember.weekly_schedule || member.weekly_schedule || null,
          pending_bedtime_local: null,
          pending_wake_time_local: null,
          pending_timezone: null,
          pending_weekend_bedtime_local: null,
          pending_weekend_wake_time_local: null,
          pending_weekly_schedule: null,
          pending_effective_at: null,
          updated_at: nowUtc.toISO(),
        });
      }

      const hydratedMember = hydrateMemberWeekendHours(activeMember);

      // Check-in & streak computation
      const sleeperNow = nowUtc.setZone(toValidLuxonZone(hydratedMember.timezone));
      const localDateStr = getSleepCycleDate(hydratedMember, nowUtc);
      const memberCheckins = checkinsByMember.get(hydratedMember.id) || [];
      const is_woke_up = wokeUpSet.has(`${hydratedMember.id}_${localDateStr}`);
      const is_in_bed = memberCheckins.includes(localDateStr) && !is_woke_up;
      const streak_days = calculateSleepStreak(memberCheckins, sleeperNow);
      const nag_assists_count = nagAssistsByMemberAndDate.get(`${hydratedMember.id}_${localDateStr}`) || 0;

      memberItems.push({
        hydratedMember: { ...hydratedMember, is_woke_up },
        localDateStr,
        is_in_bed,
        is_woke_up,
        streak_days,
        nag_assists_count,
      });
    }

    // Batched resolution: query monthly logged strikes, nightly strike logs for tonight, and recent strikes
    const currentMonth = nowUtc.toFormat('yyyy-MM');
    const [monthlyStrikeCountsMap, strikeLogsMap, recentStrikesMap] = await Promise.all([
      getMonthlyStrikeCountsBatch(
        memberItems.map((item) => item.hydratedMember.id),
        currentMonth
      ),
      getNightlyStrikeLogsBatch(
        memberItems.map((item) => ({
          targetMemberId: item.hydratedMember.id,
          sleepCycleDate: item.localDateStr,
        }))
      ),
      getRecentEligibleStrikeLogsBatch(
        memberItems.map((item) => item.hydratedMember.id),
        nowUtc
      ),
    ]);

    const strikeInfos = await Promise.all(
      memberItems.map((item) => {
        const monthly = monthlyStrikeCountsMap.get(item.hydratedMember.id);
        return resolveMemberStrikeCounts(item.hydratedMember, nowUtc, {
          loggedStrikes: monthly?.strikes,
          loggedMetas: monthly?.metastrikes,
        });
      })
    );

    const processedMembers: Member[] = memberItems.map((item, index) => {
      const strikeInfo = strikeInfos[index];
      const logKey = getStrikeLogKey(item.hydratedMember.id, item.localDateStr);
      const tonightLog = strikeLogsMap.get(logKey) || null;
      const is_metastrike_active = tonightLog?.record_type === 'metastrike';
      const metastrike_reason = tonightLog?.reason || null;
      const has_voted_strike = Boolean(sessionMemberId && tonightLog?.voter_ids?.includes(sessionMemberId));
      const convertibleLog = recentStrikesMap.get(item.hydratedMember.id) || null;

      return {
        ...sanitizeMember(item.hydratedMember),
        is_in_bed: item.is_in_bed,
        is_woke_up: item.is_woke_up,
        streak_days: item.streak_days,
        nag_assists_count: item.nag_assists_count,
        strikes_used: strikeInfo.strikes_used,
        strikes_count: strikeInfo.strikes_used,
        metastrikes_used: strikeInfo.metastrikes_used,
        metastrikes_count: strikeInfo.metastrikes_used,
        strike_cycle_month: strikeInfo.strike_cycle_month,
        tonight_strike_log: tonightLog,
        convertible_strike_log: convertibleLog,
        is_metastrike_active,
        metastrike_reason,
        has_voted_strike,
      };
    });

    return NextResponse.json({ members: processedMembers });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST: Member registration via /api/members (Deprecated).
 * Superseded by Discord OAuth profile claim & onboarding (/api/auth/claim-profile).
 *
 * @returns 410 Gone response instructing clients to authenticate via Discord OAuth
 */
export async function POST() {
  return NextResponse.json(
    {
      error:
        'Registration via /api/members has been deprecated in favor of Discord OAuth onboarding. Please connect your Discord account via /api/auth/discord or /join.',
      deprecated: true,
      auth_url: '/api/auth/discord',
    },
    { status: 410 }
  );
}
