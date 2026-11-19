import { NextResponse } from 'next/server';
import { supabaseAdmin, Member } from '@/lib/db';
import { getRequestSessionMemberId } from '@/lib/auth';
import { DateTime } from 'luxon';
import { computeMemberState, getNightScheduleDateTime, getSleepCycleDate, toValidLuxonZone } from '@/lib/sleepEngine';
import { pushTtlBefore, sendPushNotification } from '@/lib/pushServer';

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
    const { data: inBedLog, error: checkInError } = await supabaseAdmin
      .from('notification_logs')
      .select('id')
      .eq('member_id', targetMember.id)
      .eq('notification_type', 'IN_BED_EARLY')
      .eq('local_date', cycleDate)
      .maybeSingle();

    const { data: wokeUpLog, error: wakeError } = await supabaseAdmin
      .from('notification_logs')
      .select('id')
      .eq('member_id', targetMember.id)
      .eq('notification_type', 'WOKE_UP')
      .eq('local_date', cycleDate)
      .maybeSingle();

    const { data: sleepLog, error: sleepError } = await supabaseAdmin.from('sleep_logs')
      .select('in_bed_at,woke_up_at').eq('member_id', targetMember.id).eq('cycle_date', cycleDate).maybeSingle();
    if (sleepError || checkInError || wakeError) {
      return NextResponse.json({ error: 'Could not verify the member’s sleep status.' }, { status: 503 });
    }
    const isInBed = Boolean(inBedLog || sleepLog?.in_bed_at ||
      (targetMember.last_notified_stage === 'IN_BED_EARLY' && targetMember.last_notified_cycle_date === cycleDate)) &&
      !sleepLog?.woke_up_at && !wokeUpLog && !Boolean(targetMember.last_wake_cycle_date === cycleDate);

    // Compute active member state
    const targetState = computeMemberState(targetMember, targetMember.timezone, nowUtc, isInBed);

    // Query tonight's Metastrike pass status
    const { data: metastrikeLog, error: passError } = await supabaseAdmin
      .from('nightly_strike_logs')
      .select('id, record_type')
      .eq('target_member_id', targetMember.id)
      .eq('sleep_cycle_date', cycleDate)
      .eq('record_type', 'metastrike')
      .maybeSingle();

    if (passError) return NextResponse.json({ error: 'Could not verify the Metastrike pass.' }, { status: 503 });
    const isMetastrikeActive = Boolean(metastrikeLog);

    let nagLogType = '';
    let pushTitle = '';
    let pushBody = '';
    let pushTag = '';
    let pushDeadline: DateTime | undefined;

    if (isWakeUpNag) {
      // WAKE UP NAG LOGIC:
      // A. Check if target member has already marked themselves awake
      const activeSleepCycleDate = getSleepCycleDate(targetMember, nowUtc);
      const hasLoggedWakeUp = Boolean(
        (targetMember.last_wake_cycle_date && targetMember.last_wake_cycle_date === cycleDate) ||
        (targetMember.is_woke_up && cycleDate === activeSleepCycleDate) ||
        targetState.hasLoggedWakeUp
      );

      if (hasLoggedWakeUp) {
        return NextResponse.json(
          { success: false, error: `${targetMember.discord_username} is already awake!` },
          { status: 400 }
        );
      }

      // B. Excused Metastrike pass strictly suppresses community nag reminders
      if (isMetastrikeActive) {
        return NextResponse.json({
          success: false,
          shieldActive: true,
          message: `${targetMember.discord_username} has an active Metastrike pass. Nag notifications are muted.`,
        });
      }

      // C. Must be past target member's awake time for the selected sleep cycle
      const sleeperZone = toValidLuxonZone(targetMember.timezone);
      const sleeperNow = nowUtc.setZone(sleeperZone);
      const cycleDt = DateTime.fromISO(cycleDate, { zone: sleeperZone }).startOf('day');
      const selectedNightSchedule = getNightScheduleDateTime(targetMember, cycleDt);
      const isPastWakeTimeForCycle = sleeperNow >= selectedNightSchedule.wakeDateTime;

      if (!isPastWakeTimeForCycle) {
        return NextResponse.json({
          success: false,
          shieldActive: true,
          message: `${targetMember.discord_username}'s Sleep Shield is active until their wake time (${selectedNightSchedule.wakeTimeStr || '07:00'}). Nag notifications are muted.`,
        });
      }

      // D. 15-minute anti-spam cooldown per sender for wake-up nag
      nagLogType = `MANUAL_NAG:WAKE_UP:${helperKey}`;
      pushTitle = '☀️ Rise and Shine!';
      pushBody = `${senderName} is nudging you to wake up! Time to start the day 🦊`;
      pushTag = `nag-wakeup-${targetMember.id}`;
    } else {
      // BEDTIME NAG LOGIC:
      // 4A. Target member has already completed their sleep cycle and woken up for tonight's cycle:
      const hasCompletedTonightSleep = Boolean(
        wokeUpLog || sleepLog?.woke_up_at ||
        targetMember.last_wake_cycle_date === cycleDate
      );
      if (hasCompletedTonightSleep) {
        return NextResponse.json(
          {
            success: false,
            shieldActive: false,
            error: `${targetMember.discord_username} has already completed their sleep cycle for tonight!`,
          },
          { status: 400 }
        );
      }

      // 4B. CRITICAL SLEEP SHIELD GUARDRAIL:
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
      const night = DateTime.fromISO(cycleDate, { zone: toValidLuxonZone(targetMember.timezone) });
      const bedtime = getNightScheduleDateTime(targetMember, night).bedtimeDateTime;
      pushDeadline = stage === 'WIND_DOWN' ? bedtime : bedtime.plus({ hours: 8 });

      pushTitle = stage === 'WIND_DOWN' ? '🌙 Winding Down Reminder' : "⏰ Time to Catch Some Z's!";
      pushBody =
        stage === 'WIND_DOWN'
          ? `${senderName} says goodnight! 30 minutes until bedtime — time to dim blue light.`
          : `${senderName} is reminding you to sleep! Tap to check in at your Discord journal.`;
      pushTag = `nag-remind-${targetMember.id}`;
    }

    // 7. Atomically claim cooldown before dispatching push notification
    const { data: cooldownSeconds, error: claimErr } = await supabaseAdmin.rpc('claim_manual_nag', {
      p_member_id: targetMember.id, p_type: nagLogType, p_cycle: cycleDate, p_now: nowUtc.toISO(),
    });
    if (!claimErr && cooldownSeconds > 0) {
      return NextResponse.json({
        success: false, rateLimited: true, cooldownSeconds, cooldownMinutes: Math.ceil(cooldownSeconds / 60),
        message: `You can send another reminder in ${Math.ceil(cooldownSeconds / 60)}m.`,
      }, { status: 429 });
    }

    if (claimErr) {
      console.error('[NagNotif] Failed to claim cooldown log:', claimErr.message);
      return NextResponse.json(
        { success: false, error: 'Could not claim cooldown lock. Please try again.' },
        { status: 500 }
      );
    }

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
      const ttl = pushDeadline ? pushTtlBefore(pushDeadline, DateTime.utc(), 120) : 120;
      if (ttl < 1) break;
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
        },
        ttl
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

    if (subsErr || (activeSubs.length > 0 && delivered === 0)) {
      await supabaseAdmin.from('notification_logs').delete()
        .eq('member_id', targetMember.id).eq('notification_type', nagLogType)
        .eq('local_date', cycleDate).eq('dispatched_at', nowUtc.toISO());
      return NextResponse.json({ success: false, error: 'Could not deliver the reminder. Please retry.' }, { status: 503 });
    }

    // Record Nag Assist counter increment
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
