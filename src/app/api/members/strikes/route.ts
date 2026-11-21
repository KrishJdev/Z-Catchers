import { NextResponse } from 'next/server';
import { getMemberByIdSafe } from '@/lib/db';
import { resolveMemberStrikeCounts, getNightlyStrikeLog, activeStrikeLog } from '@/lib/strikes';
import { getSleepCycleDate } from '@/lib/sleepEngine';
import { DateTime } from 'luxon';
import { getRequestSession, ownsDiscordProfile } from '@/lib/auth';
import { punishmentResponse } from '@/lib/punishments';

/** The signed-in member’s current cycle and compatibility strike counters. */
export async function GET(request: Request) {
  try {
    const session = getRequestSession(request);
    if (!session?.discordId) return punishmentResponse({ error: 'Sign in with Discord.' }, 401);
    const memberId = new URL(request.url).searchParams.get('memberId') ?? session.memberId;
    if (memberId !== session.memberId) return punishmentResponse({ error: 'Only your own strikes are available here.' }, 403);

    const { data: member, error } = await getMemberByIdSafe(memberId, { requireFresh: true });
    if (error) return punishmentResponse({ error: 'Could not verify your session. Try again.' }, 503);
    if (!member || !ownsDiscordProfile(request, member)) {
      return punishmentResponse({ error: 'Sign in with the Discord account linked to this profile.' }, 403);
    }
    const nowUtc = DateTime.utc();
    const cycleDate = getSleepCycleDate(member, nowUtc);

    const counts = await resolveMemberStrikeCounts(member, nowUtc);
    const tonightLog = activeStrikeLog(await getNightlyStrikeLog(member.id, cycleDate));

    return punishmentResponse({
      member_id: member.id,
      sleep_cycle_date: cycleDate,
      strikes_used: counts.strikes_used,
      strikes_count: counts.strikes_used,
      metastrikes_used: counts.metastrikes_used,
      metastrikes_count: counts.metastrikes_used,
      strike_cycle_month: counts.strike_cycle_month,
      tonight_log: tonightLog,
      is_metastrike_active: tonightLog?.record_type === 'metastrike',
      is_strike_issued: tonightLog?.record_type === 'strike',
    });
  } catch {
    return punishmentResponse({ error: 'Strike data is currently unavailable.' }, 503);
  }
}

/**
 * POST: Peer strike voting has been disabled.
 * Strikes are now automatically issued by the 10-Minute Bedtime Strike Engine
 * if a member has not logged "In Bed" within 10 minutes past their scheduled bedtime.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const targetMemberId = body.target_member_id || body.member_id || body.targetMemberId;

    if (!targetMemberId || typeof targetMemberId !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid target_member_id.' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        error: 'Peer strike voting has been disabled. Bedtime strikes are issued automatically 10 minutes past scheduled bedtime.',
        code: 'PEER_VOTING_DISABLED',
      },
      { status: 403 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
