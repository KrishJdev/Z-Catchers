import { NextResponse } from 'next/server';
import { canModerateTarget, isSameOriginMutation, ownsDiscordProfile, verifyModeratorSession, type StaffActor } from '@/lib/auth';
import type { Member } from '@/lib/db';

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
