import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db';
import { getRequestSessionMemberId, verifyPin } from '@/lib/auth';
import {
  getClientIp,
  checkPinRateLimitPersistent,
  recordPinFailurePersistent,
  resetPinFailurePersistent,
} from '@/lib/rateLimit';

/**
 * POST: Register or rotate a Web Push subscription endpoint linked to an authenticated member.
 * Preserves existing notification preferences when omitted from health sync calls.
 *
 * @param request - Incoming HTTP request containing push subscription and credentials
 * @returns JSON response with linked subscription record
 */
export async function POST(request: Request) {
  try {
    const sessionMemberId = getRequestSessionMemberId(request);
    const body = await request.json();
    const {
      member_id,
      pin,
      subscription,
      old_endpoint,
      notify_personal,
      notify_community,
      user_agent,
    } = body;

    if (!subscription || !subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
      return NextResponse.json(
        { error: 'Invalid push subscription payload. Missing endpoint or encryption keys.' },
        { status: 400 }
      );
    }

    // Determine target member ID: Prefer authenticated session member ID
    let effectiveMemberId = sessionMemberId || member_id;
    let isRotationRecovery = false;

    // Background pushsubscriptionchange recovery: if old_endpoint is provided and matches an existing subscription,
    // recover the linked member_id without requiring active user credentials
    if (!effectiveMemberId && old_endpoint) {
      const { data: oldSub } = await supabaseAdmin
        .from('push_subscriptions')
        .select('member_id')
        .eq('endpoint', old_endpoint)
        .maybeSingle();

      if (oldSub) {
        effectiveMemberId = oldSub.member_id;
        isRotationRecovery = true;
      }
    }

    if (!effectiveMemberId) {
      return NextResponse.json(
        {
          error:
            'A logged-in member profile is required to link push notifications and calculate your Sleep Shield window.',
          code: 'MEMBER_REQUIRED',
        },
        { status: 400 }
      );
    }

    // If both session and body member_id provided, ensure no cross-profile impersonation
    if (sessionMemberId && member_id && sessionMemberId !== member_id) {
      return NextResponse.json(
        {
          error: 'Unauthorized. You cannot bind push notifications to another member profile.',
          code: 'FORBIDDEN',
        },
        { status: 403 }
      );
    }

    // Verify member exists in database
    const { data: member, error: memberErr } = await supabaseAdmin
      .from('members')
      .select('id, discord_username, timezone, passcode_hash')
      .eq('id', effectiveMemberId)
      .eq('is_active', true)
      .single();

    if (memberErr || !member) {
      return NextResponse.json(
        { error: 'Member not found or inactive.' },
        { status: 404 }
      );
    }

    // Security Gate:
    // Must be authenticated via session, valid PIN, or verified background rotation recovery
    const isSessionMatch = Boolean(sessionMemberId && sessionMemberId === member.id);
    let isPinMatch = false;

    if (!isSessionMatch && !isRotationRecovery) {
      if (pin !== undefined && pin !== null) {
        if (typeof pin !== 'string') {
          return NextResponse.json({ error: 'PIN must be a string.' }, { status: 400 });
        }
        const clientIp = getClientIp(request);
        const rateCheck = await checkPinRateLimitPersistent(clientIp, member.id);
        if (!rateCheck.allowed) {
          return NextResponse.json(
            {
              error: `Too many failed attempts. Please wait ${rateCheck.retryAfterSeconds} seconds before trying again.`,
            },
            {
              status: 429,
              headers: { 'Retry-After': String(rateCheck.retryAfterSeconds) },
            }
          );
        }

        const cleanPin = pin.trim();
        if (member.passcode_hash && verifyPin(cleanPin, member.passcode_hash)) {
          isPinMatch = true;
          await resetPinFailurePersistent(clientIp, member.id);
        } else {
          await recordPinFailurePersistent(clientIp, member.id);
        }
      }
    }

    if (!isSessionMatch && !isPinMatch && !isRotationRecovery) {
      return NextResponse.json(
        {
          error: 'Authentication required. Please log in or provide your 4-digit PIN to link push notifications.',
          code: 'UNAUTHORIZED',
        },
        { status: 401 }
      );
    }

    // If an old endpoint was rotated, capture its preferences before pruning (scoped to member.id)
    let oldSubPrefs: { notify_personal?: boolean; notify_community?: boolean } | null = null;
    if (old_endpoint && old_endpoint !== subscription.endpoint) {
      const { data: oldData } = await supabaseAdmin
        .from('push_subscriptions')
        .select('notify_personal, notify_community')
        .eq('endpoint', old_endpoint)
        .eq('member_id', member.id)
        .maybeSingle();

      if (oldData) {
        oldSubPrefs = oldData;
      }

      await supabaseAdmin
        .from('push_subscriptions')
        .delete()
        .eq('endpoint', old_endpoint)
        .eq('member_id', member.id);
    }

    // Preserve existing preferences when omitted in request (e.g. background health sync or endpoint rotation)
    let existingSub: { notify_personal?: boolean; notify_community?: boolean } | null = null;
    if (
      notify_personal === undefined ||
      notify_personal === null ||
      notify_community === undefined ||
      notify_community === null
    ) {
      const { data } = await supabaseAdmin
        .from('push_subscriptions')
        .select('notify_personal, notify_community')
        .eq('endpoint', subscription.endpoint)
        .maybeSingle();
      if (data) {
        existingSub = data;
      } else if (oldSubPrefs) {
        existingSub = oldSubPrefs;
      }
    }

    const finalNotifyPersonal =
      notify_personal !== undefined && notify_personal !== null
        ? Boolean(notify_personal)
        : (existingSub?.notify_personal ?? true);

    const finalNotifyCommunity =
      notify_community !== undefined && notify_community !== null
        ? Boolean(notify_community)
        : (existingSub?.notify_community ?? true);

    // Upsert subscription uniquely by endpoint tied to member_id.
    // This allows a single member to maintain separate rows for mobile PWA and desktop simultaneously.
    const { data: subData, error: subErr } = await supabaseAdmin
      .from('push_subscriptions')
      .upsert(
        {
          member_id: member.id,
          endpoint: subscription.endpoint,
          p256dh_key: subscription.keys.p256dh,
          auth_key: subscription.keys.auth,
          notify_personal: finalNotifyPersonal,
          notify_community: finalNotifyCommunity,
          user_agent: user_agent || null,
        },
        { onConflict: 'endpoint' }
      )
      .select()
      .single();

    if (subErr) {
      console.error('Failed to upsert push subscription:', subErr);
      return NextResponse.json({ error: subErr.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: `Push subscription linked to ${member.discord_username}`,
      subscription: subData,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
