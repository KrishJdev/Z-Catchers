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

const NAG_COOLDOWN_MINUTES = 15;

async function readSleepEvidence(memberId: string, cycle: string) {
  const [logs, sleep] = await Promise.all([
    supabaseAdmin.from('notification_logs').select('notification_type')
      .eq('member_id', memberId).eq('local_date', cycle)
      .in('notification_type', ['IN_BED_EARLY', 'WOKE_UP']),
    supabaseAdmin.from('sleep_logs').select('in_bed_at,woke_up_at')
      .eq('member_id', memberId).eq('cycle_date', cycle).maybeSingle(),
  ]);
  if (logs.error || sleep.error) return null;
  return {
    checkedIn: Boolean(sleep.data?.in_bed_at || logs.data.some(row => row.notification_type === 'IN_BED_EARLY')),
    inBedAt: sleep.data?.in_bed_at,
    wokeUp: Boolean(sleep.data?.woke_up_at || logs.data.some(row => row.notification_type === 'WOKE_UP')),
  };
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

    const sessionMemberId = getRequestSessionMemberId(request);
    if (!sessionMemberId) {
      return NextResponse.json({ error: 'Sign in to send a push reminder.' }, { status: 401 });
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

    // 2. Identify sender and prevent self-nagging
    if (sessionMemberId === targetMember.id) {
      return NextResponse.json(
        { error: 'You cannot send a nag notification to yourself.' },
        { status: 400 }
      );
    }

    const { data: senderMember, error: senderError } = await supabaseAdmin.from('members')
      .select('discord_username').eq('id', sessionMemberId).eq('is_active', true).maybeSingle();
    if (senderError) {
      return NextResponse.json({ error: 'Could not verify the sender.' }, { status: 503 });
    }
    if (!senderMember) return NextResponse.json({ error: 'An active member account is required.' }, { status: 403 });
    const senderName = senderMember.discord_username || 'A friend in Z Catchers';
    const helperKey = `user_${sessionMemberId}`;

    // 3. Compute target member's current sleep cycle & status using Luxon
    const nowUtc = DateTime.utc();
    const activeSleepCycleDate = getSleepCycleDate(targetMember, nowUtc);
    let cycleDate = activeSleepCycleDate;
    let evidence = await readSleepEvidence(targetMember.id, cycleDate);

    // Durable history can keep yesterday's cycle active after the scheduled wake time.
    if (isWakeUpNag) {
      const sleeperNow = nowUtc.setZone(toValidLuxonZone(targetMember.timezone));
      const yesterdayDate = sleeperNow.minus({ days: 1 }).toISODate()!;
      if (evidence && cycleDate !== yesterdayDate && !evidence.checkedIn && !evidence.wokeUp) {
        const previous = await readSleepEvidence(targetMember.id, yesterdayDate);
        if (!previous) return NextResponse.json({ error: 'Could not verify the member’s sleep status.' }, { status: 503 });
        const wokeUp = previous.wokeUp || targetMember.last_wake_cycle_date === yesterdayDate;
        const memberWithHistory = {
          ...targetMember,
          in_bed_at: previous.inBedAt ?? targetMember.in_bed_at,
          last_wake_cycle_date: wokeUp ? yesterdayDate : targetMember.last_wake_cycle_date,
        };
        if ((previous.checkedIn || wokeUp) &&
            getSleepCycleDate(memberWithHistory, nowUtc, previous.checkedIn && !wokeUp) === yesterdayDate) {
          cycleDate = yesterdayDate;
          evidence = previous;
        }
      }
    }

    if (!evidence) {
      return NextResponse.json({ error: 'Could not verify the member’s sleep status.' }, { status: 503 });
    }
    const wokeUpThisCycle = evidence.wokeUp || targetMember.last_wake_cycle_date === cycleDate;
    const isInBed = Boolean(evidence.checkedIn ||
      (targetMember.last_notified_stage === 'IN_BED_EARLY' && targetMember.last_notified_cycle_date === cycleDate)) &&
      !wokeUpThisCycle;

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
      const hasLoggedWakeUp = Boolean(
        wokeUpThisCycle ||
        (targetState.hasLoggedWakeUp && cycleDate === getSleepCycleDate(targetMember, nowUtc, isInBed))
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
      if (wokeUpThisCycle) {
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
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const { data: released, error } = await supabaseAdmin.from('notification_logs').delete()
            .eq('member_id', targetMember.id).eq('notification_type', nagLogType)
            .eq('local_date', cycleDate).eq('dispatched_at', nowUtc.toISO())
            .select('dispatched_at').maybeSingle();
          if (!error) {
            if (released) {
              return NextResponse.json({ success: false, error: 'Could not deliver the reminder. Please retry.' }, { status: 503 });
            }
            break;
          }
        } catch {
          // Retry the same timestamp-guarded cleanup.
        }
      }
      const { data: currentClaim, error: readError } = await supabaseAdmin.from('notification_logs')
        .select('dispatched_at').eq('member_id', targetMember.id).eq('notification_type', nagLogType)
        .eq('local_date', cycleDate).maybeSingle();
      const claimedAt = currentClaim ? DateTime.fromISO(currentClaim.dispatched_at) : null;
      const uncertain = Boolean(readError || (claimedAt && !claimedAt.isValid));
      const cooldownSeconds = uncertain ? NAG_COOLDOWN_MINUTES * 60 : claimedAt?.isValid
        ? Math.max(0, Math.ceil(claimedAt.plus({ minutes: NAG_COOLDOWN_MINUTES }).diff(DateTime.utc(), 'seconds').seconds))
        : 0;
      const cooldownMinutes = Math.ceil(cooldownSeconds / 60);
      const message = uncertain ? 'Could not deliver the reminder or verify the cooldown.' : cooldownSeconds > 0
        ? `Could not deliver the reminder. Your cooldown is active for ${cooldownMinutes}m.`
        : 'Could not deliver the reminder. Please retry.';
      return NextResponse.json({
        success: false, error: message, message, rateLimited: cooldownSeconds > 0, cooldownSeconds, cooldownMinutes,
      }, { status: 503, headers: cooldownSeconds > 0 ? { 'Retry-After': String(cooldownSeconds) } : undefined });
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
      cooldownSeconds: NAG_COOLDOWN_MINUTES * 60,
      message: defaultSuccessMessage,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error processing nag notification';
    console.error('[NagNotif] Error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
