import { NextResponse } from 'next/server';
import { supabaseAdmin, Member } from '@/lib/db';
import { getRequestSessionMemberId } from '@/lib/auth';
import { DateTime } from 'luxon';
import { computeMemberState, getSleepCycleDate } from '@/lib/sleepEngine';
import { sendPushNotification } from '@/lib/pushServer';
import crypto from 'crypto';

/**
 * Request body for manual nag notifications.
 */
interface NagNotifRequestBody {
  target_member_id: string;
}

/**
 * POST /api/members/nag-notif
 *
 * Allows any community member to send a real-time bedtime reminder push notification
 * to a friend who is:
 * 1. Within 30 minutes before their bedtime (-30 <= diffMinutes < 0), OR
 * 2. Past their bedtime (0 <= diffMinutes <= 480).
 *
 * NON-NEGOTIABLE GUARDRAIL:
 * If the target member has turned on their Sleep Shield (early check-in via Safe Button,
 * active 8-hour sleep window, or excused Metastrike pass), the notification STRICTLY
 * WILL NOT GO, and the response informs the sender that the shield is active.
 *
 * @param request - Incoming HTTP request with target_member_id in JSON payload
 * @returns JSON response indicating delivery status or shield suppression
 */
export async function POST(request: Request) {
  try {
    const body: NagNotifRequestBody = await request.json().catch(() => ({}));
    const { target_member_id } = body;

    if (!target_member_id || typeof target_member_id !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid required field: target_member_id' },
        { status: 400 }
      );
    }

    // 1. Fetch target member from database
    const { data: rawTarget, error: targetErr } = await supabaseAdmin
      .from('members')
      .select('*')
      .eq('id', target_member_id)
      .eq('is_active', true)
      .single();

    if (targetErr || !rawTarget) {
      return NextResponse.json(
        { error: 'Target member not found or is currently inactive.' },
        { status: 404 }
      );
    }

    const targetMember = rawTarget as Member;

    // 2. Identify sender (session or anonymous hash) & prevent self-nagging
    const sessionMemberId = getRequestSessionMemberId(request);
    if (sessionMemberId && sessionMemberId === targetMember.id) {
      return NextResponse.json(
        { error: 'You cannot send a nag notification to yourself.' },
        { status: 400 }
      );
    }

    let senderName = 'A friend in Z Catchers';
    let helperKey = sessionMemberId ? `user_${sessionMemberId}` : null;

    if (sessionMemberId) {
      const { data: senderMember } = await supabaseAdmin
        .from('members')
        .select('discord_username')
        .eq('id', sessionMemberId)
        .single();

      if (senderMember?.discord_username) {
        senderName = senderMember.discord_username;
      }
    } else {
      const userAgent = request.headers.get('user-agent') || 'unknown';
      const ip =
        request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
        request.headers.get('x-real-ip') ||
        'anonymous';
      const seed = `${ip}:${userAgent}`;
      const anonHash = crypto.createHash('sha256').update(seed).digest('hex').substring(0, 16);
      helperKey = `anon_${anonHash}`;
    }

    // 3. Compute target member's current sleep cycle & status using Luxon
    const nowUtc = DateTime.utc();
    const cycleDate = getSleepCycleDate(targetMember, nowUtc);

    // Query tonight's check-in (Safe Button) status
    const { data: inBedLog } = await supabaseAdmin
      .from('notification_logs')
      .select('id')
      .eq('member_id', targetMember.id)
      .eq('notification_type', 'IN_BED_EARLY')
      .eq('local_date', cycleDate)
      .maybeSingle();

    const isInBed = Boolean(inBedLog);

    // Compute active member state
    const targetState = computeMemberState(targetMember, targetMember.timezone, nowUtc, isInBed);

    // Query tonight's Metastrike pass status
    const { data: metastrikeLog } = await supabaseAdmin
      .from('nightly_strike_logs')
      .select('id, record_type')
      .eq('target_member_id', targetMember.id)
      .eq('sleep_cycle_date', cycleDate)
      .eq('record_type', 'metastrike')
      .maybeSingle();

    const isMetastrikeActive = Boolean(metastrikeLog);

    // 4. CRITICAL SLEEP SHIELD GUARDRAIL:
    // If shield is active, NEVER send notifications and notify sender that shield is on.
    const isShieldOn = Boolean(
      isInBed ||
      targetState.isSleepShieldActive ||
      targetState.bucket === 'SLEEPING' ||
      isMetastrikeActive
    );

    if (isShieldOn) {
      return NextResponse.json({
        success: false,
        shieldActive: true,
        message: `${targetMember.discord_username} has turned on their Sleep Shield. Nag notifications are muted.`,
      });
    }

    // 5. Time window eligibility check:
    // Must be past bedtime (0 <= diffMinutes <= 480) OR within 30m before bedtime (-30 <= diffMinutes < 0)
    const isEligibleWindow = targetState.diffMinutes >= -30 && targetState.diffMinutes <= 480;
    if (!isEligibleWindow) {
      return NextResponse.json(
        {
          success: false,
          shieldActive: false,
          error: `Nag reminders can only be sent within 30 minutes before bedtime or after bedtime.`,
        },
        { status: 400 }
      );
    }

    // 6. Anti-spam deduplication per sender per stage (WIND_DOWN vs OVERDUE)
    const stage = targetState.diffMinutes < 0 ? 'WIND_DOWN' : 'OVERDUE';
    const nagLogType = `MANUAL_NAG:${stage}:${helperKey}`;

    const { data: existingNagLog } = await supabaseAdmin
      .from('notification_logs')
      .select('id')
      .eq('member_id', targetMember.id)
      .eq('notification_type', nagLogType)
      .eq('local_date', cycleDate)
      .maybeSingle();

    if (existingNagLog) {
      return NextResponse.json(
        {
          success: false,
          shieldActive: false,
          rateLimited: true,
          message: `You already sent a bedtime reminder to ${targetMember.discord_username} for tonight's ${
            stage === 'WIND_DOWN' ? 'wind-down' : 'bedtime'
          }.`,
        },
        { status: 429 }
      );
    }

    // 7. Retrieve active push subscriptions for target member
    const { data: subscriptions, error: subsErr } = await supabaseAdmin
      .from('push_subscriptions')
      .select('*')
      .eq('member_id', targetMember.id);

    if (subsErr) {
      console.error('[NagNotif] Failed to fetch subscriptions:', subsErr);
    }

    const activeSubs = subscriptions || [];
    let delivered = 0;
    let failed = 0;
    const deadEndpoints: string[] = [];

    // 8. Dispatch Web Push notification to registered devices
    const pushTitle = stage === 'WIND_DOWN' ? '🌙 Winding Down Reminder' : "⏰ Time to Catch Some Z's!";
    const pushBody =
      stage === 'WIND_DOWN'
        ? `${senderName} says goodnight! 30 minutes until bedtime — time to dim blue light.`
        : `${senderName} is reminding you to sleep! Tap to check in at your Discord journal.`;

    for (const sub of activeSubs) {
      const pushResult = await sendPushNotification(
        {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh_key,
            auth: sub.auth_key,
          },
        },
        {
          title: pushTitle,
          body: pushBody,
          url: targetMember.journal_url || '/',
          tag: `nag-remind-${targetMember.id}`,
        }
      );

      if (pushResult.success) {
        delivered++;
      } else {
        failed++;
        if (pushResult.statusCode === 404 || pushResult.statusCode === 410) {
          deadEndpoints.push(sub.endpoint);
        }
      }
    }

    // Clean up pruned dead subscriptions
    if (deadEndpoints.length > 0) {
      await supabaseAdmin.from('push_subscriptions').delete().in('endpoint', deadEndpoints);
    }

    // 9. Record nag log for deduplication
    await supabaseAdmin.from('notification_logs').insert({
      member_id: targetMember.id,
      notification_type: nagLogType,
      local_date: cycleDate,
      dispatched_at: nowUtc.toISO(),
    });

    // 10. Record Nag Assist counter increment
    const assistType = `NAG_ASSIST:${helperKey}`;
    await supabaseAdmin.from('notification_logs').upsert(
      {
        member_id: targetMember.id,
        notification_type: assistType,
        local_date: cycleDate,
        dispatched_at: nowUtc.toISO(),
      },
      { onConflict: 'member_id,notification_type,local_date' }
    );

    // Query refreshed total assists count
    const { count: totalAssists } = await supabaseAdmin
      .from('notification_logs')
      .select('id', { count: 'exact' })
      .eq('member_id', targetMember.id)
      .like('notification_type', 'NAG_ASSIST:%')
      .eq('local_date', cycleDate);

    const hasDevices = activeSubs.length > 0;
    return NextResponse.json({
      success: true,
      shieldActive: false,
      deliveredCount: delivered,
      failedCount: failed,
      totalAssists: totalAssists || 1,
      message:
        delivered > 0
          ? `Bedtime reminder sent to ${targetMember.discord_username}!`
          : hasDevices
          ? `Bedtime reminder dispatched to ${targetMember.discord_username}'s devices.`
          : `Reminder recorded! (${targetMember.discord_username} hasn't enabled browser push notifications yet).`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error processing nag notification';
    console.error('[NagNotif] Error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
