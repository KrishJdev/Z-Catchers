import { NextResponse } from 'next/server';
import { supabaseAdmin, Member } from '@/lib/db';
import { getRequestSessionMemberId } from '@/lib/auth';
import { DateTime } from 'luxon';
import { computeMemberState, getSleepCycleDate, toValidLuxonZone } from '@/lib/sleepEngine';
import { sendPushNotification } from '@/lib/pushServer';
import crypto from 'crypto';

/**
 * Request body for manual nag notifications.
 */
interface NagNotifRequestBody {
  target_member_id: string;
  type?: 'bedtime' | 'wake_up';
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
    const { target_member_id, type = 'bedtime' } = body;
    const isWakeUpNag = type === 'wake_up';

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
    let helperKey: string;

    if (sessionMemberId) {
      const { data: senderMember } = await supabaseAdmin
        .from('members')
        .select('discord_username')
        .eq('id', sessionMemberId)
        .single();

      if (senderMember?.discord_username) {
        senderName = senderMember.discord_username;
      }
      helperKey = `user_${sessionMemberId}`;
    } else {
      // Enforce a stable target-wide cooldown for unauthenticated senders, independent of client-controlled headers
      helperKey = 'anon_target';
    }

    // 3. Compute target member's current sleep cycle & status using Luxon
    const nowUtc = DateTime.utc();
    let cycleDate = getSleepCycleDate(targetMember, nowUtc);

    // If this is a wake-up nag, resolve whether yesterday's check-in cycle is the applicable one
    if (isWakeUpNag) {
      const sleeperNow = nowUtc.setZone(toValidLuxonZone(targetMember.timezone));
      const yesterdayDate = sleeperNow.minus({ days: 1 }).toISODate()!;
      const { data: yCheckin } = await supabaseAdmin
        .from('notification_logs')
        .select('id')
        .eq('member_id', targetMember.id)
        .eq('notification_type', 'IN_BED_EARLY')
        .eq('local_date', yesterdayDate)
        .maybeSingle();

      const { data: yWakeLog } = await supabaseAdmin
        .from('notification_logs')
        .select('id')
        .eq('member_id', targetMember.id)
        .eq('notification_type', 'WOKE_UP')
        .eq('local_date', yesterdayDate)
        .maybeSingle();

      if (yCheckin && !yWakeLog) {
        cycleDate = yesterdayDate;
      }
    }

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

    let nagLogType = '';
    let pushTitle = '';
    let pushBody = '';
    let pushTag = '';

    if (isWakeUpNag) {
      // WAKE UP NAG LOGIC:
      // A. Check if target member has already marked themselves awake
      const hasLoggedWakeUp = Boolean(
        targetMember.is_woke_up ||
        (targetMember.last_wake_cycle_date && targetMember.last_wake_cycle_date === cycleDate) ||
        targetState.hasLoggedWakeUp
      );

      if (hasLoggedWakeUp) {
        return NextResponse.json(
          { success: false, error: `${targetMember.discord_username} is already awake!` },
          { status: 400 }
        );
      }

      // B. Must be past target member's awake time
      if (!targetState.isPastWakeTime) {
        return NextResponse.json({
          success: false,
          shieldActive: true,
          message: `${targetMember.discord_username}'s Sleep Shield is active until their wake time (${targetState.activeWakeTimeLocal || '07:00'}). Nag notifications are muted.`,
        });
      }

      // C. 15-minute anti-spam cooldown per sender for wake-up nag
      nagLogType = `MANUAL_NAG:WAKE_UP:${helperKey}`;
      const { data: existingNagLog } = await supabaseAdmin
        .from('notification_logs')
        .select('id, dispatched_at')
        .eq('member_id', targetMember.id)
        .eq('notification_type', nagLogType)
        .eq('local_date', cycleDate)
        .maybeSingle();

      if (existingNagLog && existingNagLog.dispatched_at) {
        const lastDispatched = DateTime.fromISO(existingNagLog.dispatched_at, { zone: 'utc' });
        const elapsedSeconds = nowUtc.diff(lastDispatched, 'seconds').seconds;
        const cooldownTotalSeconds = 15 * 60; // 15-minute cooldown
        if (elapsedSeconds < cooldownTotalSeconds) {
          const remainingSeconds = Math.max(1, Math.ceil(cooldownTotalSeconds - elapsedSeconds));
          const remainingMinutes = Math.ceil(remainingSeconds / 60);
          return NextResponse.json(
            {
              success: false,
              shieldActive: false,
              rateLimited: true,
              cooldownSeconds: remainingSeconds,
              cooldownMinutes: remainingMinutes,
              message: `You can send another wake-up reminder to ${targetMember.discord_username} in ${remainingMinutes}m.`,
            },
            { status: 429 }
          );
        }
      }

      pushTitle = '☀️ Rise and Shine!';
      pushBody = `${senderName} is nudging you to wake up! Time to start the day 🦊`;
      pushTag = `nag-wakeup-${targetMember.id}`;
    } else {
      // BEDTIME NAG LOGIC:
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

      // 6. 15-minute anti-spam cooldown per sender per stage (WIND_DOWN vs OVERDUE)
      const stage = targetState.diffMinutes < 0 ? 'WIND_DOWN' : 'OVERDUE';
      nagLogType = `MANUAL_NAG:${stage}:${helperKey}`;

      const { data: existingNagLog } = await supabaseAdmin
        .from('notification_logs')
        .select('id, dispatched_at')
        .eq('member_id', targetMember.id)
        .eq('notification_type', nagLogType)
        .eq('local_date', cycleDate)
        .maybeSingle();

      if (existingNagLog && existingNagLog.dispatched_at) {
        const lastDispatched = DateTime.fromISO(existingNagLog.dispatched_at, { zone: 'utc' });
        const elapsedSeconds = nowUtc.diff(lastDispatched, 'seconds').seconds;
        const cooldownTotalSeconds = 15 * 60; // 15-minute cooldown
        if (elapsedSeconds < cooldownTotalSeconds) {
          const remainingSeconds = Math.max(1, Math.ceil(cooldownTotalSeconds - elapsedSeconds));
          const remainingMinutes = Math.ceil(remainingSeconds / 60);
          return NextResponse.json(
            {
              success: false,
              shieldActive: false,
              rateLimited: true,
              cooldownSeconds: remainingSeconds,
              cooldownMinutes: remainingMinutes,
              message: `You can send another reminder to ${targetMember.discord_username} in ${remainingMinutes}m.`,
            },
            { status: 429 }
          );
        }
      }

      pushTitle = stage === 'WIND_DOWN' ? '🌙 Winding Down Reminder' : "⏰ Time to Catch Some Z's!";
      pushBody =
        stage === 'WIND_DOWN'
          ? `${senderName} says goodnight! 30 minutes until bedtime — time to dim blue light.`
          : `${senderName} is reminding you to sleep! Tap to check in at your Discord journal.`;
      pushTag = `nag-remind-${targetMember.id}`;
    }

    // 7. Atomically claim cooldown before dispatching push notification
    const { error: claimErr } = await supabaseAdmin.from('notification_logs').upsert(
      {
        member_id: targetMember.id,
        notification_type: nagLogType,
        local_date: cycleDate,
        dispatched_at: nowUtc.toISO(),
      },
      { onConflict: 'member_id,notification_type,local_date' }
    );

    if (claimErr) {
      console.error('[NagNotif] Failed to claim cooldown log:', claimErr.message);
      return NextResponse.json(
        { success: false, error: 'Could not claim cooldown lock. Please try again.' },
        { status: 500 }
      );
    }

    // 8. Record Nag Assist counter increment
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

    // 9. Retrieve active push subscriptions for target member
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

    // 10. Dispatch Web Push notification to registered devices
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
          tag: pushTag,
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

    // Query refreshed total assists count
    const { count: totalAssists } = await supabaseAdmin
      .from('notification_logs')
      .select('id', { count: 'exact' })
      .eq('member_id', targetMember.id)
      .like('notification_type', 'NAG_ASSIST:%')
      .eq('local_date', cycleDate);

    const hasDevices = activeSubs.length > 0;
    const defaultSuccessMessage = isWakeUpNag
      ? delivered > 0
        ? `Wake-up reminder sent to ${targetMember.discord_username}!`
        : hasDevices
        ? `Wake-up reminder dispatched to ${targetMember.discord_username}'s devices.`
        : `Wake-up reminder recorded! (${targetMember.discord_username} hasn't enabled browser push notifications yet).`
      : delivered > 0
      ? `Bedtime reminder sent to ${targetMember.discord_username}!`
      : hasDevices
      ? `Bedtime reminder dispatched to ${targetMember.discord_username}'s devices.`
      : `Reminder recorded! (${targetMember.discord_username} hasn't enabled browser push notifications yet).`;

    return NextResponse.json({
      success: true,
      shieldActive: false,
      deliveredCount: delivered,
      failedCount: failed,
      totalAssists: totalAssists || 1,
      cooldownSeconds: 15 * 60,
      message: defaultSuccessMessage,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error processing nag notification';
    console.error('[NagNotif] Error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
