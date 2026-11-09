import { NextResponse } from 'next/server';
import { supabaseAdmin, Member } from '@/lib/db';
import { getRequestSessionMemberId } from '@/lib/auth';

export async function GET(request: Request) {
  try {
    const memberId = getRequestSessionMemberId(request);

    if (!memberId) {
      return NextResponse.json({ authenticated: false, member: null }, { status: 200 });
    }

    const { data: member, error } = await supabaseAdmin
      .from('members')
      .select('*')
      .eq('id', memberId)
      .eq('is_active', true)
      .single();

    if (error || !member) {
      return NextResponse.json({ authenticated: false, member: null }, { status: 200 });
    }

    const currentMember = member as Member;

    // Sanitize member before returning
    const sanitizedMember: Omit<Member, 'passcode_hash'> & { has_pin: boolean } = {
      id: currentMember.id,
      discord_username: currentMember.discord_username,
      discord_handle: currentMember.discord_handle,
      avatar_url: currentMember.avatar_url,
      journal_url: currentMember.journal_url,
      bedtime_local: currentMember.bedtime_local,
      wake_time_local: currentMember.wake_time_local,
      timezone: currentMember.timezone,
      pending_bedtime_local: currentMember.pending_bedtime_local,
      pending_wake_time_local: currentMember.pending_wake_time_local,
      pending_timezone: currentMember.pending_timezone,
      pending_effective_at: currentMember.pending_effective_at,
      role: currentMember.role,
      is_active: currentMember.is_active,
      created_at: currentMember.created_at,
      updated_at: currentMember.updated_at,
      has_pin: Boolean(currentMember.passcode_hash),
    };

    return NextResponse.json({
      authenticated: true,
      member: sanitizedMember,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
