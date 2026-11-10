import { NextResponse } from 'next/server';
import { supabaseAdmin, Member } from '@/lib/db';
import { getRequestSessionMemberId } from '@/lib/auth';
import { recordStrikeVote } from '@/lib/strikes';
import { getSleepCycleDate } from '@/lib/sleepEngine';
import { DateTime } from 'luxon';

/**
 * POST /api/members/strikes/vote
 *
 * Allows an awake community member to cast a vote to issue a strike
 * on a sleeper whose bedtime is past the 5-minute grace window.
 *
 * Enforces 2-vote community verification.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { target_member_id, voter_id } = body;

    if (!target_member_id || typeof target_member_id !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid target_member_id.' },
        { status: 400 }
      );
    }

    // Identify the voter: session token takes precedence, followed by explicit voter_id
    const sessionVoterId = getRequestSessionMemberId(request);
    const activeVoterId = sessionVoterId || voter_id;

    if (!activeVoterId || typeof activeVoterId !== 'string') {
      return NextResponse.json(
        {
          error: 'Authentication required. Please log in with your profile to vote on strikes.',
          code: 'UNAUTHORIZED',
        },
        { status: 401 }
      );
    }

    // Fetch target member
    const { data: targetMember, error: targetErr } = await supabaseAdmin
      .from('members')
      .select('*')
      .eq('id', target_member_id)
      .eq('is_active', true)
      .single();

    if (targetErr || !targetMember) {
      return NextResponse.json(
        { error: 'Target member not found or inactive.' },
        { status: 404 }
      );
    }

    const nowUtc = DateTime.utc();
    const cycleDate = getSleepCycleDate(targetMember as Member, nowUtc);

    const result = await recordStrikeVote(
      targetMember as Member,
      activeVoterId,
      cycleDate,
      nowUtc
    );

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      target_member_id: targetMember.id,
      sleep_cycle_date: cycleDate,
      log: result.log,
      strike_issued: result.strikeIssued,
      votes_count: result.votesCount,
      strikes_used: result.strikesUsed,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
