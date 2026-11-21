import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db';
import { getRequestSession } from '@/lib/auth';

const credentialFormat = /^[a-f0-9]{64}$/;

const failures: Record<string, { status: number; message: string }> = {
  credential_required: { status: 401, message: 'Sign in with Discord to repair alerts on this device.' },
  inactive_owner: { status: 403, message: 'This subscription requires its active Discord account.' },
  endpoint_conflict: { status: 409, message: 'This push endpoint is already linked to a device.' },
  binding_missing: { status: 409, message: 'The previous device binding expired. Retry notification setup.' },
  stale_endpoint: { status: 409, message: 'This device changed its subscription. Retry notification setup.' },
};

function endpointIsValid(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string' || endpoint.length > 2048) return false;
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const session = getRequestSession(request);
  const payload = await request.json().catch(() => null);
  const background = payload?.background === true || (!session && payload?.old_endpoint != null);
  const fail = (code: string, status: number, error: string, confirmedEndpoint?: string) => {
    if (background) console.warn('[push-rotation]', code);
    return NextResponse.json({ code, error, confirmedEndpoint }, { status });
  };

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return fail('invalid_payload', 400, 'Invalid push payload.');
  }

  const { member_id, subscription, old_endpoint, rotation_credential, notify_personal, notify_community, user_agent } = payload;
  if (!background && !session?.discordId) {
    return fail('discord_required', 401, 'Sign in with Discord to link push notifications.');
  }
  if (member_id != null && (background || member_id !== session?.memberId)) {
    return fail('wrong_account', 403, 'This device can only be linked to your own profile.');
  }
  if (!endpointIsValid(subscription?.endpoint) ||
      ![subscription.keys?.p256dh, subscription.keys?.auth].every(
        key => typeof key === 'string' && key.length > 0 && key.length <= 256) ||
      (old_endpoint != null && !endpointIsValid(old_endpoint)) ||
      (rotation_credential != null &&
        (typeof rotation_credential !== 'string' || !credentialFormat.test(rotation_credential)))) {
    return fail('invalid_payload', 400, 'Invalid push subscription or rotation credential.');
  }

  try {
    const { data, error } = await supabaseAdmin.rpc('bind_push_subscription', {
      p_member_id: background ? null : session!.memberId,
      p_discord_id: background ? null : session!.discordId,
      p_endpoint: subscription.endpoint,
      p_previous: old_endpoint ?? null,
      p_p256dh: subscription.keys.p256dh,
      p_auth: subscription.keys.auth,
      p_digest: rotation_credential ? createHash('sha256').update(rotation_credential).digest('hex') : null,
      p_personal: typeof notify_personal === 'boolean' ? notify_personal : null,
      p_community: typeof notify_community === 'boolean' ? notify_community : null,
      p_user_agent: typeof user_agent === 'string' ? user_agent.slice(0, 500) : null,
    });

    if (!error && (data?.code === 'ok' || data?.code === 'legacy_rotation')) {
      if (data.code === 'legacy_rotation') console.info('[push-rotation]', 'legacy_rotation');
      return NextResponse.json({
        success: true,
        notifyPersonal: data.notify_personal,
        notifyCommunity: data.notify_community,
      });
    }

    if (!error && Object.hasOwn(failures, data?.code)) {
      const failure = failures[data.code];
      return fail(data.code, failure.status, failure.message, background ? undefined : data.confirmed_endpoint);
    }
  } catch {
    // Database errors can contain endpoints or keys. Report only the stable reason.
  }

  return fail('storage_error', 503, 'Unable to save notification settings. Please try again.');
}
