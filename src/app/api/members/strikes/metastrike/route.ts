import { NextResponse } from 'next/server';
import { Member, getMemberByIdSafe } from '@/lib/db';
import { authorizeProfileAction } from '@/lib/moderation';
import {
  activeStrikeLog,
  useProactiveMetastrike,
  convertStrikeToMetastrike,
  getRecentEligibleStrikeLog,
} from '@/lib/strikes';
import { getSleepCycleDate } from '@/lib/sleepEngine';
import { DateTime } from 'luxon';

/**
 * POST /api/members/strikes/metastrike
 *
 * Allows a member or moderator to use an excused Metastrike pass:
 * 1. Proactive (Tonight): Claims a pass for tonight with an optional excuse reason ("Monthly Battle", "Family", etc.)
 * 2. Retroactive: Replaces a recorded strike before the next scheduled bedtime.
 *
 * @param request - Incoming HTTP request with member ID, action, reason, and auth credentials
 * @returns JSON response containing action result and updated strike counts
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const {
      member_id,
      action = 'proactive',
      reason,
      sleep_cycle_date,
    } = body;

    if (!member_id || typeof member_id !== 'string') {
      return NextResponse.json({ error: 'Missing member_id.' }, { status: 400 });
    }

    // Fetch target member
    const { data: rawMember, error: memberErr } = await getMemberByIdSafe(member_id, { requireFresh: true });

    if (memberErr || !rawMember) {
      return NextResponse.json({ error: 'Member not found.' }, { status: 404 });
    }

    const member = rawMember as Member;
    const moderator = await authorizeProfileAction(request, member);
    if (moderator instanceof Response) return moderator;

    const nowUtc = DateTime.utc();
    const cycleDate = getSleepCycleDate(member, nowUtc);

    if (action === 'convert_retroactive') {
      let targetCycleDate =
        typeof sleep_cycle_date === 'string' && sleep_cycle_date.trim()
          ? sleep_cycle_date.trim()
          : undefined;
      if (!targetCycleDate) {
        const eligibleStrike = await getRecentEligibleStrikeLog(member.id, nowUtc, member);
        targetCycleDate = eligibleStrike ? eligibleStrike.sleep_cycle_date : cycleDate;
      }

      const result = await convertStrikeToMetastrike(
        member,
        reason || (moderator ? 'Moderator Retroactive Excuse' : 'Converted from Strike'),
        targetCycleDate,
        nowUtc,
        moderator ?? undefined
      );

      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: result.status ?? (result.reason === 'stale_strike_cycle_month' ? 409 : 400) });
      }

      return NextResponse.json({
        success: true,
        action: 'convert_retroactive',
        member_id: member.id,
        sleep_cycle_date: targetCycleDate,
        log: activeStrikeLog(result.log),
        strikes_used: result.strikesUsed,
        strikes_count: result.strikesUsed,
        metastrikes_used: result.metastrikesUsed,
        metastrikes_count: result.metastrikesUsed,
      });
    }

    // Default: Proactive Metastrike pass for tonight
    const result = await useProactiveMetastrike(
      member,
      reason || (moderator ? 'Moderator Excused Pass' : 'Excused Night'),
      cycleDate,
      nowUtc,
      moderator ?? undefined
    );

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status ?? (result.reason === 'stale_strike_cycle_month' ? 409 : 400) });
    }

    return NextResponse.json({
      success: true,
      action: result.strikesUsed !== undefined ? 'convert_retroactive' : 'proactive',
      member_id: member.id,
      sleep_cycle_date: cycleDate,
      log: activeStrikeLog(result.log),
      strikes_used: result.strikesUsed,
      strikes_count: result.strikesUsed,
      metastrikes_used: result.metastrikesUsed,
      metastrikes_count: result.metastrikesUsed,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
