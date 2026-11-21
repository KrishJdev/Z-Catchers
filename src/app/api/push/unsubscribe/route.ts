import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getRequestSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/db';

export async function POST(request: Request) {
  const session = getRequestSession(request);
  if (!session?.discordId) {
    return NextResponse.json({ error: 'Sign in with Discord to unlink this device.' }, { status: 401 });
  }

  const rawBody = await request.text().catch(() => null);
  let body;
  try {
    body = rawBody === null ? null : rawBody.trim() ? JSON.parse(rawBody) : {};
  } catch {
    body = null;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid unlink request.' }, { status: 400 });
  }
  if (body.member_id != null && body.member_id !== session.memberId) {
    return NextResponse.json({ error: 'This device can only be unlinked by its signed-in owner.' }, { status: 403 });
  }

  const endpoint = body.endpoint ?? new URL(request.url).searchParams.get('endpoint');
  const credential = body.rotation_credential;
  if ((endpoint != null && (typeof endpoint !== 'string' || !endpoint.trim())) ||
      (credential != null && (typeof credential !== 'string' || !/^[a-f0-9]{64}$/.test(credential)))) {
    return NextResponse.json({ error: 'Invalid endpoint or rotation credential.' }, { status: 400 });
  }

  const { data: owner, error: ownerError } = await supabaseAdmin.from('members')
    .select('id').eq('id', session.memberId).eq('discord_id', session.discordId).eq('is_active', true).maybeSingle();
  if (ownerError) {
    return NextResponse.json({ error: 'Could not verify the signed-in profile. Try again.' }, { status: 503 });
  }
  if (!owner) {
    return NextResponse.json({ error: 'An active Discord profile is required.' }, { status: 403 });
  }

  const remove = () => supabaseAdmin.from('push_subscriptions').delete().eq('member_id', session.memberId);
  let result;
  if (credential) {
    const digest = createHash('sha256').update(credential).digest('hex');
    result = await remove().eq('rotation_digest', digest).select('id');
    // An incomplete provisioning attempt can still be linked under the previous endpoint.
    if (!result.error && result.data?.length === 0 && endpoint) {
      result = await remove().eq('endpoint', endpoint.trim());
    }
  } else {
    result = await (endpoint ? remove().eq('endpoint', endpoint.trim()) : remove());
  }

  if (result.error) {
    console.warn('[push-unlink]', 'storage_error');
    return NextResponse.json({ error: 'Could not unlink notifications. Try again.' }, { status: 503 });
  }
  return NextResponse.json({ success: true });
}

export const DELETE = POST;
