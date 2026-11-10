import { NextResponse } from 'next/server';
import { supabaseAdmin, Member } from '@/lib/db';
import { resolveMemberStrikeCounts, getNightlyStrikeLog } from '@/lib/strikes';
import { getSleepCycleDate } from '@/lib/sleepEngine';
import { DateTime } from 'luxon';

/**
 * GET /api/members/strikes?memberId=...
 *
 * Retrieves current month strike counts and tonight's strike log for a member.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const memberId = searchParams.get('memberId');

    if (!memberId) {
      return NextResponse.json(
        { error: 'Missing memberId query parameter.' },
        { status: 400 }
      );
    }

    const { data: rawMember, error: memberErr } = await supabaseAdmin
      .from('members')
      .select('*')
      .eq('id', memberId)
      .single();

    if (memberErr || !rawMember) {
      return NextResponse.json({ error: 'Member not found.' }, { status: 404 });
    }

    const member = rawMember as Member;
    const nowUtc = DateTime.utc();
    const cycleDate = getSleepCycleDate(member, nowUtc);

    const counts = await resolveMemberStrikeCounts(member, nowUtc);
    const tonightLog = await getNightlyStrikeLog(member.id, cycleDate);

    return NextResponse.json({
      member_id: member.id,
      sleep_cycle_date: cycleDate,
      strikes_used: counts.strikes_used,
      metastrikes_used: counts.metastrikes_used,
      strike_cycle_month: counts.strike_cycle_month,
      tonight_log: tonightLog,
      is_metastrike_active: tonightLog?.record_type === 'metastrike',
      is_strike_issued: tonightLog?.record_type === 'strike',
      pending_votes: tonightLog?.record_type === 'pending_vote' ? tonightLog.voter_ids.length : 0,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
