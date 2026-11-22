import { NextResponse } from 'next/server';
import { canModerateTarget, isSameOriginMutation, ownsDiscordProfile, verifyModeratorSession, type StaffActor } from '@/lib/auth';
import { removeInMemorySleepLog, supabaseAdmin, type Member } from '@/lib/db';

export function staffIdentity(actor: StaffActor) {
  return { p_actor_id: actor.id, p_actor_discord_id: actor.discordId };
}

export function staffWriteError(error: { code?: string; message?: string } | null) {
  if (error?.code && /^PT(400|403|404|409)$/.test(error.code)) {
    return NextResponse.json({ error: error.message }, { status: Number(error.code.slice(2)) });
  }
  console.error('[moderation] Staff write failed:', error?.code);
  return NextResponse.json({ error: 'Could not save the staff action. Try again.' }, { status: 503 });
}

export async function authorizeProfileAction(request: Request, target: Member) {
  if (ownsDiscordProfile(request, target)) return null;

  const auth = await verifyModeratorSession(request);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!isSameOriginMutation(request) || !target.is_active || !canModerateTarget(auth.actor, target)) {
    return NextResponse.json({ error: 'You cannot manage this profile.' }, { status: 403 });
  }
  return auth.actor;
}

export async function cancelOwnSleepCheckIn(member: Member, cycleDate: string, clearPending: boolean) {
  const { data, error } = await supabaseAdmin.rpc('cancel_own_sleep_check_in', {
    p_member_id: member.id,
    p_discord_id: member.discord_id,
    p_cycle: cycleDate,
    p_clear_pending: clearPending,
    p_expected_updated_at: member.updated_at,
  });
  if (error || !data) {
    if (error?.code === 'PT403' || error?.code === 'PT409') {
      return NextResponse.json({ error: error.message }, { status: Number(error.code.slice(2)) });
    }
    console.error('[sleep] Check-in cancellation failed:', error?.code);
    return NextResponse.json({ error: 'Failed to clean up sleep records during cancellation.' }, { status: 500 });
  }
  removeInMemorySleepLog(member.id, cycleDate);
  return { ...data, is_in_bed: false, in_bed_at: null, is_woke_up: false } as Member;
}
