import { NextResponse } from 'next/server';
import { supabaseAdmin, Member, getInMemorySleepLogs } from '@/lib/db';
import {
  getRequestSession,
  createSessionToken,
  setSessionCookie,
  sanitizeMember,
  hasDatabaseModeratorRole,
} from '@/lib/auth';
import { DateTime } from 'luxon';
import { getSleepCycleDate, toValidLuxonZone } from '@/lib/sleepEngine';

/**
 * GET: Retrieve the authenticated session member's profile and perform rolling session renewal.
 * Refreshes the 90-day session cookie and synchronizes moderator status from the active database profile.
 *
 * @param request - Incoming HTTP request with session cookie or Authorization header
 * @returns JSON response with authentication status and member entity, plus renewed Set-Cookie
 */
export async function GET(request: Request) {
  try {
    const session = getRequestSession(request);

    if (!session?.discordId) {
      return NextResponse.json({ authenticated: false, member: null }, { status: 200 });
    }

    const { data: memberData, error } = await supabaseAdmin
      .from('members')
      .select('*')
      .eq('id', session.memberId)
      .eq('discord_id', session.discordId)
      .eq('is_active', true)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: 'Could not verify your session. Try again.' }, { status: 503 });
    }
    if (!memberData) {
      return NextResponse.json({ authenticated: false, member: null }, { status: 200 });
    }

    const currentMember = memberData as Member;

    const effectiveIsMod = hasDatabaseModeratorRole(currentMember.role);

    // Rolling 90-Day Session Renewal: Generate fresh token and extend expiration
    const renewedToken = createSessionToken(
      {
        memberId: currentMember.id,
        discordId: currentMember.discord_id || session.discordId || null,
        isModerator: effectiveIsMod,
      },
      90
    );

    const sanitized = sanitizeMember(currentMember);

    // Hydrate active sleep cycle in_bed and woke_up flags
    const sleeperZone = toValidLuxonZone(currentMember.timezone);
    const sleeperNow = DateTime.utc().setZone(sleeperZone);
    const yesterdayDate = sleeperNow.minus({ days: 1 }).startOf('day').toISODate()!;
    const todayDate = sleeperNow.startOf('day').toISODate()!;

    const { data: logs } = await supabaseAdmin
      .from('notification_logs')
      .select('notification_type, local_date, dispatched_at')
      .eq('member_id', currentMember.id)
      .in('local_date', [yesterdayDate, todayDate])
      .in('notification_type', ['IN_BED_EARLY', 'WOKE_UP']);

    const yesterdayTypes = (logs || [])
      .filter((l: any) => l.local_date === yesterdayDate)
      .map((l: any) => l.notification_type);
    const hasOpenYesterday =
      yesterdayTypes.includes('IN_BED_EARLY') && !yesterdayTypes.includes('WOKE_UP');

    // Hydrate active check-in timestamp before cycle resolution so stalenessLimit uses actual check-in time
    const targetCycleCandidate = hasOpenYesterday ? yesterdayDate : todayDate;
    const matchedLog = (logs || []).find(
      (l: any) => l.local_date === targetCycleCandidate && l.notification_type === 'IN_BED_EARLY'
    );
    let activeInBedAt: string | null = matchedLog?.dispatched_at || null;
    if (!activeInBedAt) {
      const memLogs = getInMemorySleepLogs(currentMember.id, yesterdayDate, todayDate);
      const matchMem = memLogs.find((m) => m.cycle_date === targetCycleCandidate && m.in_bed_at);
      if (matchMem?.in_bed_at) {
        activeInBedAt = matchMem.in_bed_at;
      }
    }

    if (activeInBedAt) {
      currentMember.in_bed_at = activeInBedAt;
      sanitized.in_bed_at = activeInBedAt;
    }

    const localDate = getSleepCycleDate(currentMember, DateTime.utc(), hasOpenYesterday || Boolean(currentMember.is_in_bed));
    const cycleTypes = (logs || [])
      .filter((l: any) => l.local_date === localDate)
      .map((l: any) => l.notification_type);

    const isWokeUp = cycleTypes.includes('WOKE_UP') || currentMember.last_wake_cycle_date === localDate;
    sanitized.is_woke_up = isWokeUp;
    const authInBedDt = currentMember.in_bed_at ? DateTime.fromISO(currentMember.in_bed_at, { zone: 'utc' }) : null;
    const authInBedMatchesCycle = Boolean(authInBedDt && authInBedDt.isValid && getSleepCycleDate(currentMember, authInBedDt, true) === localDate);

    const hasCheckinEvidence =
      cycleTypes.includes('IN_BED_EARLY') ||
      (currentMember.last_notified_stage === 'IN_BED_EARLY' && currentMember.last_notified_cycle_date === localDate) ||
      authInBedMatchesCycle ||
      (Boolean(currentMember.is_in_bed) && !currentMember.in_bed_at && !currentMember.last_notified_cycle_date);

    sanitized.is_in_bed = hasCheckinEvidence && !isWokeUp;
    if (sanitized.is_woke_up) {
      sanitized.in_bed_at = null;
    }

    const response = NextResponse.json({
      authenticated: true,
      member: sanitized,
      token: renewedToken,
    });

    // Refresh rolling 90-day HttpOnly cookie
    setSessionCookie(response, renewedToken);

    return response;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
