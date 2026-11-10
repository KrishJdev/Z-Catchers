import { NextResponse } from 'next/server';
import { supabaseAdmin, Member } from '@/lib/db';
import { resolveMemberStrikeCounts, getNightlyStrikeLog, recordStrikeVote } from '@/lib/strikes';
import { getSleepCycleDate } from '@/lib/sleepEngine';
import { getRequestSessionMemberId } from '@/lib/auth';
import { getClientIp, checkPinRateLimitPersistent } from '@/lib/rateLimit';
import { DateTime } from 'luxon';

/**
 * GET /api/members/strikes?memberId=...
 *
 * Retrieves current month strike counts and tonight's strike log for a member.
 */
/**
 * GET: Retrieve a member's current sleep cycle date strike log and monthly strike counts.
 *
 * @param request - Incoming HTTP request with memberId query parameter
 * @returns JSON response with member strikes summary
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
      strikes_count: counts.strikes_used,
      metastrikes_used: counts.metastrikes_used,
      metastrikes_count: counts.metastrikes_used,
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

/**
 * POST /api/members/strikes or /api/members/strike
 *
 * Community 2-Vote Strike Verification:
 * Allows two distinct community members to verify and confirm a strike against
 * a member only after the 5-minute bedtime grace period has passed without an in-bed check-in.
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

    // Identify the voter: only an authenticated session can vote on strikes
    const sessionVoterId = getRequestSessionMemberId(request);
    if (!sessionVoterId || typeof sessionVoterId !== 'string') {
      return NextResponse.json(
        {
          error: 'Authentication required. Please log in with your profile to vote on strikes.',
          code: 'UNAUTHORIZED',
        },
        { status: 401 }
      );
    }

    // Verify session identity belongs to an existing active member
    const { data: voterMember } = await supabaseAdmin
      .from('members')
      .select('id, is_active')
      .eq('id', sessionVoterId)
      .eq('is_active', true)
      .maybeSingle();

    if (!voterMember) {
      return NextResponse.json(
        {
          error: 'Voter profile not found or inactive.',
          code: 'UNAUTHORIZED',
        },
        { status: 401 }
      );
    }

    // Voter cannot be the strike target
    if (sessionVoterId === targetMemberId) {
      return NextResponse.json(
        { error: 'You cannot vote to strike yourself.' },
        { status: 400 }
      );
    }

    const clientIp = getClientIp(request);
    const rateCheck = await checkPinRateLimitPersistent(clientIp, targetMemberId);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          error: `Too many requests. Please wait ${rateCheck.retryAfterSeconds} seconds.`,
        },
        {
          status: 429,
          headers: { 'Retry-After': String(rateCheck.retryAfterSeconds) },
        }
      );
    }

    // Fetch target member
    const { data: targetMember, error: targetErr } = await supabaseAdmin
      .from('members')
      .select('*')
      .eq('id', targetMemberId)
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
      sessionVoterId,
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
      strikes_count: result.strikesUsed,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
