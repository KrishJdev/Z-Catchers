import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      member_id,
      subscription,
      notify_personal = true,
      notify_community = true,
      user_agent,
    } = body;

    if (!subscription || !subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
      return NextResponse.json(
        { error: 'Invalid push subscription payload. Missing endpoint or encryption keys.' },
        { status: 400 }
      );
    }

    if (!member_id) {
      return NextResponse.json(
        {
          error:
            'A member profile is required to link push notifications and calculate your Sleep Shield window.',
          code: 'MEMBER_REQUIRED',
        },
        { status: 400 }
      );
    }

    // Verify member exists in database
    const { data: member, error: memberErr } = await supabaseAdmin
      .from('members')
      .select('id, discord_username, timezone')
      .eq('id', member_id)
      .eq('is_active', true)
      .single();

    if (memberErr || !member) {
      return NextResponse.json(
        { error: 'Member not found or inactive.' },
        { status: 404 }
      );
    }

    // Upsert subscription (unique on endpoint)
    const { data: subData, error: subErr } = await supabaseAdmin
      .from('push_subscriptions')
      .upsert(
        {
          member_id: member.id,
          endpoint: subscription.endpoint,
          p256dh_key: subscription.keys.p256dh,
          auth_key: subscription.keys.auth,
          notify_personal: Boolean(notify_personal),
          notify_community: Boolean(notify_community),
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
