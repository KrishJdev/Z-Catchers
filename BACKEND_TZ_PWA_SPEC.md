# Z Catchers: Backend, Timezone & PWA Technical Reference

> **AGENT DIRECTIVE:** This document serves as the absolute technical blueprint for implementing the database models, Luxon timezone conversion engine, Sleep Shield notification guardrails, and Service Worker Web Push infrastructure for **Z Catchers**. Follow every algorithm and schema definition precisely.

---

## 1. Complete Database Schema (PostgreSQL / Supabase)

Use the current schema for new installations and the versioned migrations when upgrading. The excerpts below describe the data model. Timestamps use `TIMESTAMPTZ`. Local bedtimes use strict `HH:mm` strings paired with IANA timezones. [Installation schema](./supabase/schema.sql) · [Migrations](./supabase/migrations/)

```sql
-- 1. Members Table (Profiles, Schedules, and 48-Hour Cooldown State Machine)
CREATE TABLE members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_username TEXT NOT NULL,
  discord_handle TEXT,
  avatar_url TEXT,
  journal_url TEXT NOT NULL,
  
  -- Active Schedule (Always evaluated in local time + IANA zone)
  bedtime_local VARCHAR(5) NOT NULL,        -- Format: "HH:mm" (e.g., "23:30")
  wake_time_local VARCHAR(5) NOT NULL DEFAULT '07:00',
  timezone TEXT NOT NULL,                   -- IANA string (e.g., "America/New_York", "Asia/Kolkata")
  weekly_schedule JSONB,                    -- 7-Day Variable Schedule: { mon: {bedtime, wake_time}, ..., sun: {bedtime, wake_time} }
  
  -- 48-Hour Cooldown Pending Queue
  pending_bedtime_local VARCHAR(5),
  pending_wake_time_local VARCHAR(5),
  pending_timezone TEXT,
  pending_weekly_schedule JSONB,            -- Pending 7-day variable schedule awaiting cooldown expiration
  pending_effective_at TIMESTAMPTZ,         -- UTC timestamp when pending promotion unlocks (NOW() + 48h)
  
  -- Role & Security
  role TEXT NOT NULL DEFAULT 'member',      -- 'member' | 'moderator' | 'owner'
  passcode_hash TEXT,                       -- 4-digit PIN for self-service updates
  is_active BOOLEAN NOT NULL DEFAULT true,

  -- Monthly Strikes & Metastrikes Accountability System
  strikes_used INT NOT NULL DEFAULT 0 CHECK (strikes_used >= 0),
  metastrikes_used INT NOT NULL DEFAULT 0 CHECK (metastrikes_used >= 0 AND metastrikes_used <= 3),
  strike_cycle_month TEXT NOT NULL DEFAULT '2026-11', -- 'YYYY-MM' for lazy monthly reset

  -- Fast Wake-Up State Resolution
  last_woke_up_at TIMESTAMPTZ,              -- Exact UTC timestamp of most recent wake-up
  last_wake_cycle_date TEXT,                -- 'YYYY-MM-DD' in member's local timezone of latest logged wake cycle

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Push Subscriptions Table (Supports multi-device per member)
CREATE TABLE push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh_key TEXT NOT NULL,
  auth_key TEXT NOT NULL,
  notify_personal BOOLEAN NOT NULL DEFAULT true,
  notify_community BOOLEAN NOT NULL DEFAULT true,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Notification Logs Table (Idempotency guard against duplicate cron dispatches)
CREATE TABLE notification_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,          -- 'WIND_DOWN_30M' | 'BEDTIME_HIT' | 'IN_BED_EARLY'
  local_date DATE NOT NULL,                 -- Sleeper's local date (YYYY-MM-DD)
  dispatched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(member_id, notification_type, local_date)
);

-- 4. Nightly Strike Logs Table (Automatic Strikes & Metastrike Passes)
CREATE TABLE nightly_strike_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  sleep_cycle_date TEXT NOT NULL,           -- Target member's local cycle date "YYYY-MM-DD"
  record_type TEXT NOT NULL CHECK (record_type IN ('pending_vote', 'strike', 'metastrike')),
  voter_ids JSONB NOT NULL DEFAULT '[]'::jsonb, -- Array of member IDs / tokens to enforce unique voters
  reason TEXT,                              -- Optional short note for Metastrikes (e.g. "Monthly Battle", "Birthday", "Family")
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(target_member_id, sleep_cycle_date)
);

-- 5. Rate Limits Table (Serverless-persistent sliding window rate limiting)
CREATE TABLE public.rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 1,
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_rate_limits_expires_at ON public.rate_limits (expires_at);
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rate_limits FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rate_limits TO service_role;
CREATE POLICY "Service role full access on rate_limits" ON public.rate_limits
  FOR ALL USING (auth.role() = 'service_role');

-- 6. Cron Locks Table (Cron execution locks & notification event idempotency)
CREATE TABLE public.cron_locks (
  lock_key TEXT PRIMARY KEY,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb
);
CREATE INDEX idx_cron_locks_expires_at ON public.cron_locks (expires_at);
ALTER TABLE public.cron_locks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cron_locks FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cron_locks TO service_role;
CREATE POLICY "Service role full access on cron_locks" ON public.cron_locks
  FOR ALL USING (auth.role() = 'service_role');

-- 7. Sleep Logs Table (Historical Sleep & Wake Duration Records)
CREATE TABLE IF NOT EXISTS public.sleep_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  cycle_date TEXT NOT NULL, -- "YYYY-MM-DD" in member's local IANA timezone representing the night's cycle
  timezone TEXT NOT NULL DEFAULT 'UTC',
  target_bedtime TEXT,      -- "HH:mm" scheduled bedtime for this cycle
  target_wake_time TEXT,    -- "HH:mm" scheduled wake time for this cycle
  in_bed_at TIMESTAMPTZ,    -- Exact UTC timestamp when member checked in to bed
  in_bed_local_time TEXT,   -- "HH:mm" in member's local timezone
  woke_up_at TIMESTAMPTZ,   -- Exact UTC timestamp when member woke up
  woke_up_local_time TEXT,  -- "HH:mm" in member's local timezone
  wake_source TEXT CHECK (wake_source IN ('button', 'manual')),
  duration_minutes INTEGER, -- Calculated total sleep duration in minutes
  status TEXT NOT NULL DEFAULT 'on_time' CHECK (status IN ('on_time', 'late', 'missed', 'metastrike')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (member_id, cycle_date)
);
CREATE INDEX IF NOT EXISTS idx_sleep_logs_member_cycle ON public.sleep_logs (member_id, cycle_date DESC);
ALTER TABLE public.sleep_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read sleep_logs" ON public.sleep_logs;
DROP POLICY IF EXISTS "Public can view sleep logs" ON public.sleep_logs;
CREATE POLICY "Service role full access on sleep_logs" ON public.sleep_logs FOR ALL USING (auth.role() = 'service_role');
```

---

## 2. Timezone Math & Sleep Engine (`src/lib/sleepEngine.ts`)

Antigravity must implement these helper functions using `luxon` to prevent manual offset calculation errors.

### 2.1 Self-Healing 48-Hour Cooldown Promotion
Whenever a member record is fetched or evaluated by an API route:
1. Check if `pending_effective_at` is not null.
2. If `DateTime.utc() >= DateTime.fromISO(member.pending_effective_at)`:
   * Promote `pending_bedtime_local` -> `bedtime_local`, `pending_timezone` -> `timezone`.
   * Clear all `pending_*` columns and update `updated_at = NOW()`.
3. Otherwise, retain active columns and expose `pendingEffectiveAt` to the frontend for countdown displays.

### 2.2 Status Bucket & Cross-Timezone Conversion Algorithm
Given a member's active schedule and a viewer's IANA timezone (`viewerTimezone`):

```typescript
import { DateTime } from 'luxon';

export interface MemberSchedule {
  id: string;
  discordUsername: string;
  bedtimeLocal: string;     // "23:30"
  wakeTimeLocal?: string;   // "07:00"
  timezone: string;         // "America/New_York"
  journalUrl: string;
  isInBed?: boolean;        // Active in-bed flag
  isWokeUp?: boolean;       // Active woke-up flag
  // ... other fields
}

export type SleepBucket = 'BEDTIME_NOW' | 'OVERDUE' | 'OVERDUE_BEDTIME' | 'WINDING_DOWN' | 'SLEEPING' | 'AWAKE';

export function computeMemberState(
  member: MemberSchedule,
  viewerTz: string,
  nowUtc = DateTime.utc(),
  isInBedOverride?: boolean
) {
  // 1. Manual-Only State Transitions & Rules:
  // - "Asleep" (SLEEPING) is entered STRICTLY when the member clicks "I'm in Bed" (effectiveInBed === true).
  // - "Awake" (AWAKE) is entered STRICTLY when the member clicks "Wake Up" (hasLoggedWakeUp === true), or
  //   via the Fallback Rule: if an unchecked-in member exceeds their scheduled wake-up time, they transition
  //   directly from Overdue to AWAKE, leaving the missed bedtime penalized.
  // - Members do NOT automatically transition to SLEEPING or AWAKE based on elapsed time alone.
  // - Unchecked-in members drop into the "Overdue / Past Bedtime" bucket the exact moment their scheduled
  //   bedtime passes (currentLocalTime >= scheduledBedtime, diffMinutes >= 0).
  // - The 10-minute automated strike fires at diffMinutes >= 10, but the member stays in Overdue until
  //   checking in or reaching their scheduled wake time.

  // 1. Parse sleeper's local bedtime and wake time in their IANA zone
  const [bHours, bMinutes] = member.bedtimeLocal.split(':').map(Number);
  const wakeTime = member.wakeTimeLocal || '07:00';
  const [wHours, wMinutes] = wakeTime.split(':').map(Number);
  const sleeperNow = nowUtc.setZone(member.timezone);
  
  let bedtimeToday = sleeperNow.set({ hour: bHours, minute: bMinutes, second: 0, millisecond: 0 });
  
  // Handle midnight boundary wrap: construct yesterday, today, and tomorrow instances to find the closest one
  const bedtimeYesterday = bedtimeToday.minus({ days: 1 });
  const bedtimeTomorrow = bedtimeToday.plus({ days: 1 });
  
  const candidates = [bedtimeYesterday, bedtimeToday, bedtimeTomorrow];
  // Find the bedtime instance closest to current time
  let targetBedtime = candidates.reduce((closest, curr) => 
    Math.abs(curr.diff(sleeperNow, 'minutes').minutes) < Math.abs(closest.diff(sleeperNow, 'minutes').minutes) ? curr : closest
  );

  const diffMinutes = sleeperNow.diff(targetBedtime, 'minutes').minutes; // negative = before bedtime, positive = after bedtime

  // Derive target wake time relative to target bedtime
  let targetWakeTime = targetBedtime.set({ hour: wHours, minute: wMinutes, second: 0, millisecond: 0 });
  if (targetWakeTime <= targetBedtime) {
    targetWakeTime = targetWakeTime.plus({ days: 1 });
  }

  // Derive check-in and wake-up status from member fields before evaluating buckets
  const effectiveInBed = isInBedOverride !== undefined ? isInBedOverride : Boolean(member.isInBed);
  const hasLoggedWakeUp = Boolean(member.isWokeUp);
  const isPastWakeTime = sleeperNow >= targetWakeTime;

  let bucket: SleepBucket = 'AWAKE';
  let statusText = '';
  let isSleepShieldActive = false;

  if (effectiveInBed && !hasLoggedWakeUp) {
    // Explicit in-bed click via /api/members/in-bed
    bucket = 'SLEEPING';
    isSleepShieldActive = !isPastWakeTime;
    statusText = isPastWakeTime ? `In Bed • Past Wake Time (${wakeTime})` : 'Catching Z\'s (Asleep)';
  } else if (diffMinutes < 0 && diffMinutes >= -60) {
    bucket = 'WINDING_DOWN';
    statusText = `Bedtime in ${Math.abs(Math.floor(diffMinutes))}m`;
  } else if (diffMinutes >= 0 && !isPastWakeTime) {
    // Overdue / Past Bedtime section (from minute 0 onward until in-bed or scheduled wake)
    bucket = 'BEDTIME_NOW'; // UI maps to 'Overdue / Past Bedtime' section
    statusText = diffMinutes <= 5 ? `Grace Period: ${Math.max(0, 5 - Math.floor(diffMinutes))}m left` : `Bedtime hit ${Math.floor(diffMinutes)}m ago — Nag them!`;
  } else {
    // Fallback Rule: unchecked-in member past scheduled wake time transitions directly to AWAKE
    bucket = 'AWAKE';
    const nextBedtime = diffMinutes < 0 ? targetBedtime : bedtimeTomorrow;
    const hoursUntil = Math.floor(nextBedtime.diff(sleeperNow, 'hours').hours);
    statusText = `Awake • Bedtime in ${hoursUntil}h`;
  }

  // 2. Convert sleeper's next bedtime into viewer's local timezone for clean display
  const viewerBedtime = targetBedtime.setZone(viewerTz);
  const formattedViewerTime = viewerBedtime.toFormat('h:mm a');
  const formattedSleeperTime = targetBedtime.toFormat('h:mm a');

  return {
    bucket,
    statusText,
    isSleepShieldActive,
    formattedViewerTime,
    formattedSleeperTime,
    diffMinutes
  };
}
```

### 2.3 Monthly Strikes & Metastrikes Accountability System Engine

The accountability system ensures members adhere to their bedtimes with automated evaluation while accommodating valid life events through metastrike passes.

#### 1. Core Accountability Rules
* **Automated 10-Minute Bedtime Strike Engine:** Automatically issues 1 normal strike if an active member has not logged "In Bed" within 10 minutes past their scheduled bedtime (`currentLocalTime >= scheduledBedtime + 10 minutes`). Evaluated per member according to their active daily or weekly timetable in their local timezone.
* **Scope Restriction:** Strikes apply strictly to missed bedtimes. Wake-up actions in `/api/members/wake-up` must never trigger strikes.
* **Peer Strike Voting Removed:** Manual peer strike voting has been removed and disabled (`POST /api/members/strikes` returns 403 `PEER_VOTING_DISABLED`). Regular members cannot vote to strike others.
* **Strike thresholds:** Every third verified strike in a member’s local calendar month earns a distinct punishment. Automatic strikes continue beyond three.
* **Metastrikes (Max 3 per calendar month):** Excused passes for unexpected or important events (e.g. Monthly Battle, Family Event, Birthday Celebration, Health Emergency).
* **Monthly rollover:** Strike progress and Metastrike usage use the member’s local calendar month. The stored sleep-cycle date determines the strike month. Open tasks carry over. Progress reads use the pending timezone once its existing cooldown expires.

#### 2. Timezone & 10-Minute Cutoff State Machine
* **`BEDTIME_GRACE` ($0 \le \text{diffMinutes} \le 5$):**
  * Status text: `"Grace Period: Xm left"`. Member drops into "Overdue / Past Bedtime" section immediately at minute 0.
* **`OVERDUE_NAG_NOW` ($\text{diffMinutes} > 5$):**
  * Status text: `"Bedtime hit Xm ago — Nag them!"`.
  * If $\text{diffMinutes} \ge 10$, the Automated Bedtime Strike Engine issues 1 normal strike unless the member has checked into bed or applied a Metastrike for this sleep cycle.
  * **Overdue Bucket Retention:** The member remains in the "Overdue / Past Bedtime" section after receiving the strike until they either explicitly log "I'm in Bed" (which transitions them to `SLEEPING`) or their scheduled wake-up time passes (which transitions them directly to `AWAKE` via the fallback rule).
  * **Idempotency:** Automatic strikes are tracked via `AUTO_BEDTIME_STRIKE` in `notification_logs` and `nightly_strike_logs`, ensuring at most 1 automatic strike per sleep cycle across repeated cron passes.

The Supabase service role calls `apply_nightly_strike` to change a nightly record and its monthly counters in one transaction. The function locks the member, checks the expected record type and rechecks durable check-in evidence before issuing a strike. A failed write leaves the cycle available for retry.

#### 3. Metastrike Prevention & Pre-Next-Bedtime Replacement Workflows
* **Proactive Metastrike (Applied before +10m Cutoff):** Member taps `"Use Metastrike Tonight"` on their own card and selects or types a reason. Consumes 1 Metastrike (`metastrikes_used + 1`), sets `record_type = 'metastrike'` for tonight's `sleep_cycle_date`, and locks the cycle against automatic normal strikes with a `"Protected by Metastrike: [Reason]"` shield badge.
* **Pre-Next-Bedtime Replacement Window:** If a member receives an automatic normal strike at +10 minutes, they can apply a Metastrike at any point—all the way until their next scheduled bedtime (`currentLocalTime < nextScheduledBedtime`), including the next morning or afternoon. Doing so decrements `strikes_used` by 1, increments `metastrikes_used` by 1, and updates the nightly log's `record_type` from `'strike'` to `'metastrike'`. Once the next scheduled bedtime arrives, this replacement window expires.

#### 4. Punishment records and dated corrections

Each full group of three verified strikes in the member's local calendar month earns one task. A strike is attributed to its stored sleep-cycle date even if posting crosses midnight or the member changes timezone. The ledger uses nightly strikes and dated, auditable moderator corrections. The monthly member counters serve existing callers as projections.

An open task starts as `pending` while replacement could undo its threshold. At the deadline, reads show `awaiting_assignment`. Only that state accepts a new assignment. Assigned work supports edits or completion. A correction or Metastrike that disqualifies a threshold cancels its open task. Re-earning the threshold reopens the same record, and completed work remains in history. Open tasks carry over across months.

#### 5. REST API endpoints

| Endpoint | Authorization and response |
| --- | --- |
| `GET /api/members/punishments` | Active Discord profile owner. Returns `month`, `strikes_used`, `metastrikes_used`, `strikes_toward_next`, `strikes_per_punishment`, `open_count`, `open_items` oldest first, and completed `history` newest first. An optional `memberId` must match the authenticated member. |
| `GET /api/members` | Only the viewer's own active Discord-linked row receives `open_punishment_count`. The value is an integer across all months or `null` when unavailable. Task details stay private. |
| `GET /api/mod/punishments` | Verifies a live database-role or configured Discord-ID moderator, or the rate-limited master passcode. Defaults to the `awaiting_assignment` queue. Pass `status=assigned` or `status=pending` for other sections and `offset` for the next page of up to 50. A `punishment_id` query instead returns `item`, `open_count`, and `verified_strikes` for that earned month. |
| `POST /api/mod/punishments` | Same moderator authorization. Accepts `punishment_id` and `action`. For `assign` and `edit`, supply `title` (1–120 characters) and optional `instructions` (up to 2,000). For `complete`, supply the task ID alone with the action. For `add_strike` or `remove_strike`, supply `cycle_date` in the earned month, `reason` (1–500 characters), and a UUID `request_id` reused on retry. Removal also requires a matching `source_id` from the detail read. Returns `success`, `item`, `open_count`, and `correction_id` for dated changes. |
| `GET /api/members/strikes` | Active Discord profile owner. Returns the current cycle log and compatibility counts. |
| `POST /api/members/strikes` | Compatibility endpoint returns 403 `PEER_VOTING_DISABLED` for vote requests. Legacy vote columns and rows remain in storage. |
| `POST /api/members/strikes/metastrike` | Activates a proactive pass or replaces a strike before the next scheduled bedtime for the owner or an authorized moderator. |
| `POST /api/mod` | Retains compatibility actions `adjust_strikes` and `clear_strike_log` for authorized moderators. The Metastrike balance is bounded at three. |

Apply `20261123_punishment_task_apis.sql` after the strike ledger migration. Service-role RPCs enforce ownership for member reads. The API and badge become available after `punishment_rollout.screens_visible` is enabled following activation and seed. Hidden or unavailable punishment APIs return HTTP 503. Invalid input returns 400, unknown tasks return 404, and invalid task transitions or conflicting correction retries return 409.

Moderator writes lock the same member row as the ledger and return the updated task and all-month open count from that transaction. The audit records the action time and either the verified moderator's member ID or `master_mod`. Retrying completion preserves its timestamp and audit record. Exact dated correction retries reuse the original correction.

---

## 2.5 7-Day Variable Sleep Schedule Engine & Cross-Midnight Resolution

### 1. Canonical TypeScript Schedule Types
Defined in `src/lib/sleepEngine.ts` and re-exported in `src/lib/timezone.ts`:
```typescript
export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface DailySchedule {
  bedtime: string;   // 24-hour "HH:mm" format (e.g. "23:30" or "01:00")
  wake_time: string; // 24-hour "HH:mm" format (e.g. "07:30")
}

export type WeeklySchedule = Record<DayKey, DailySchedule>;
```

### 2. Daily Schedule Resolution (`getScheduleForDay`)
Resolves the active target bedtime and wake time for any given day in the member's local timezone:
1. Maps Luxon's `weekday` index (1 = Monday ... 7 = Sunday) to the corresponding `DayKey`.
2. Reads `member.weekly_schedule[dayKey]` if populated.
3. Fallback: If `dayKey` is `'fri'` or `'sat'` and `member.weekend_bedtime_local` is set, resolves weekend hours; otherwise falls back to base `bedtime_local` and `wake_time_local`.

### 3. Cross-Midnight Cycle Resolution (`resolveActiveSleepCycle`)
Evaluates the member's current sleep cycle cleanly across midnight boundaries:
1. **Yesterday's Cycle First:** Checks `sleeperNow.minus({ days: 1 })`. Resolves yesterday's cycle if `sleeperNow` falls within yesterday's active window (`yStart = bedtime - 180m` to `yEnd`):
   * **Actively Checked-In Members (`effectiveInBed && !hasWokeUp`):** An open check-in remains in `SLEEPING` past scheduled `wake_time` until an explicit "Wake Up" action is logged, or until a 16-hour staleness safety cap (capped before today's wind-down, but never earlier than `wake_time`).
   * **Woken Members (`hasWokeUp`):** Retains yesterday's cycle for a 4-hour post-wake window (or until today's wind-down), remaining `AWAKE`.
   * **Unchecked-In Members (`!effectiveInBed`):** Yesterday's cycle terminates strictly at scheduled `wake_time` (`yEnd = wakeDateTime`), transitioning overdue members directly to `AWAKE` for the daytime without ever marking them asleep.
2. **Today's Cycle Second:** Once yesterday's wake window or staleness limit has elapsed, resolves today's cycle date and target schedule via `getScheduleForDay(member, sleeperNow)`.

### 4. Backward Compatibility & Flat Column Synchronization
When saving a 7-day variable schedule via `/api/members/update-schedule` or `/api/mod`:
* `weekly_schedule.mon.bedtime` / `wake_time` are written to `bedtime_local` / `wake_time_local`.
* `weekly_schedule.sat.bedtime` / `wake_time` are written to `weekend_bedtime_local` / `weekend_wake_time_local`.
* Legacy payloads with only flat columns automatically synthesize an equivalent 7-day `weekly_schedule` object.

### 5. 3-Mode Schedule Editor (`MyScheduleModal.tsx`)
* **Every Day:** Single bedtime and wake time applied synchronously across all 7 days.
* **Weekdays / Weekends:** Mon–Thu + Sun regular hours vs. Fri–Sat weekend hours.
* **Custom Per Day:** Full 7-day editor with interactive day pills (min 44px touch targets), quick copy actions ("Copy to Weekdays", "Copy to Weekend", "Apply All 7 Days"), and a compact 7-day summary preview.

---

## 3. PWA & Web Push Notification Engine

### 3.1 Service Worker (`public/sw.js`)
Must be placed in the public directory to intercept push payloads and handle deep links.

```javascript
self.addEventListener('push', function(event) {
  if (!event.data) return;
  const data = event.data.json();
  
  const options = {
    body: data.body,
    icon: '/icons/icon-192x192.png',
    badge: '/icons/badge-72x72.png',
    vibrate: [200, 100, 200],
    data: { url: data.url }
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const targetUrl = event.notification.data.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // Check if there is already an open window, focus it and navigate
      for (let client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          return client.navigate(targetUrl);
        }
      }
      // Otherwise open a new window which triggers native Discord app deep-linking
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
```

The service worker stores the device's last confirmed push endpoint, rotation credential, and repair status in IndexedDB. It commits a new credential to device storage before submitting it with an authenticated enrollment or sync. Supabase stores only its digest. Background rotation presents the credential and expected previous endpoint. A single database update preserves the subscription ID and alert preferences, and an exact retry confirms a prior success. Existing devices can rotate with the old endpoint until their service worker provisions a credential. A failed rotation leaves the last confirmed endpoint available for signed-in repair. Unlinking deletes the subscription and its credential.

### 3.2 Notification Dispatcher Logic (Canonical Cron Endpoint: `/api/cron/dispatch-notifications`)
The one-minute Supabase job is installed separately with `supabase/schedule_dispatch.sql`. Vercel is configured for a daily run and GitHub Actions provides a best-effort fallback. Each invocation enforces the **Sleep Shield** and distributed idempotency:

1. **Window-Level Concurrency Lock:** Acquires `cron_window:<YYYY-MM-DDTHH:mm>` lock (55s TTL) in `public.cron_locks` to prevent duplicate concurrent runs between Vercel Cron and GitHub Actions fallback runners.
2. Find all active members $M$ whose local time matches either **T-Minus 30 minutes** or **T-Minus 0 minutes**.
3. **Per-Member Event Lock:** Acquires `notif:<member_id>:<date>:<event_type>` lock in `public.cron_locks` (five-minute processing lease) before sending. Record receipts for successful subscriptions, retain them on temporary failures and retry within the stage window. Complete the stage after all eligible destinations have succeeded or expired.
   The dispatcher verifies the captured lease before sending, recording a receipt, or completing the stage. Receipt writes retry under that lease. If receipt persistence fails, the stage remains pending while unrelated stages continue. Lease renewal merges known and durable receipts in the database, and stage completion and its audit commit together. If an in-flight push is accepted and the worker exits or loses its lease before persisting the receipt, a retry can still duplicate that push.
4. **Personal Notification:** Send the personal reminder in the 30 minutes before bedtime. Send bedtime and strike alerts to unchecked-in members after bedtime. An open check-in silences the device. A completed cycle remains protected for the remainder of its eight-hour quiet window.
5. **Community Nag Notification:** 
   * Query all members $C \neq M$ where `notify_community = true`.
   * Evaluate $C$'s sleep state using Algorithm 2.2.
   * **GUARDRAIL:** Exclude checked-in recipients, anyone within 15 minutes before bedtime, and members who have already slept during the current eight-hour quiet window. An overdue member who has not gone to bed remains eligible.
   * Dispatch push alert to remaining awake members containing $M$'s `journal_url`.
6. **Push TTL:** Wind-down expires at the selected bedtime. Bedtime alerts and community nags can queue for up to five minutes and expire by the end of the 30-minute recovery window. The dispatcher checks current sleep history before each community push and limits delivery to the time before the recipient’s pre-bedtime quiet period. Strike alerts can queue for up to five minutes within a 30-minute alert window after the strike is committed. A missed strike alert can retry from its ledger entry without issuing another strike. Manual nags can queue for up to two minutes, bounded by the end of the selected wind-down or overdue window when applicable.

---

## 4. Discord Journal Validation
All user-submitted journal links must be validated against this strict regex before saving to the database:
```regex
^https:\/\/(ptb\.|canary\.)?discord\.com\/channels\/\d+\/\d+(\/\d+)?$
```

---

## 5. Automated CI Pipeline & Unified Test Runner
* **GitHub Actions Pipeline (`.github/workflows/ci.yml`):**
  * Triggered on `push` to `main`, `dev`, `krish` and `pull_request` to `main`, `dev`.
  * Runs on Ubuntu with Node.js 22.
  * Steps: `npm ci` -> `npm run typecheck` -> `npm run build` -> `npm run test:unit`.
* **NPM Helper Scripts:**
  * `npm run typecheck`: Runs `tsc --noEmit` across all project files.
  * `npm run test:unit`: Runs all 21 offline unit/static test suites via `node --import tsx scripts/run-tests.mjs --unit`.
  * `npm run test:all`: Runs all 22 verification suites including live Supabase integration tests via `node --import tsx scripts/run-tests.mjs --all`.

---

## 6. "I Woke Up" & Sleep History API Endpoints

### Staff authorization and schedule writes after the moderation cutover

The [moderation rollout](MODERATION_PLAN.md) adds the `owner` role alongside `member` and `moderator`. The database enforces at most one Owner, whose row must be active and Discord-linked. Staff endpoints match the Discord session’s member ID and Discord ID to the active row and authorize using its current role. Guard the target’s role in the staff write so a concurrent promotion cannot grant access to a protected target.

Phase 1 adds the same-origin `POST /api/mod` action `set_moderator` with `member_id`, `expected_role`, and `new_role`. The service-role function checks the signed actor’s live Owner role and Discord link, locks the target, and returns HTTP 409 if the expected role is stale. Promotions require an active, linked member. A successful change records the actor, target, old and new roles, and timestamp in `moderator_role_changes`. Follow the [operator checklist](MODERATION_ROLLOUT_CHECKLIST.md#phase-1-owner-bootstrap) for the initial owner assignment.

`POST /api/members/update-schedule` is the profile owner’s self-service route. Schedule changes in every role write to the 48-hour queue. Use `POST /api/mod` with `edit_schedule` for immediate schedule changes and `approve_cooldown` for early approval. Moderators can target members and the Owner can target members or moderators. Send the reviewed queue fields as `expected_pending` for approval. The staff transaction checks all fields and returns HTTP 409 when the queued schedule has changed. Staff write transactions recheck the actor and target while holding their database locks. Audit new staff actions with the signed-in member ID and retain historical `master_mod` records.

The API descriptions for legacy credentials apply until the application and database are switched in the [documented cutover order](MODERATION_ROLLOUT_CHECKLIST.md#application-and-database-cutover-order).

### 6.1 `POST /api/members/wake-up`
Allows authenticated members to log when they woke up for their active or recent sleep cycle.

* **Authentication:** Member session cookie/bearer token, 4-digit PIN matching `passcode_hash`, or server moderator passcode.
* **Modes:**
  * **Instant Button:** `{ mode: 'button' }` (or empty body). Uses current UTC instant in member's timezone, sets `wake_source: 'button'`.
  * **Manual Time Entry:** `{ mode: 'manual', wokeUpTime: 'HH:mm', cycleDate?: 'YYYY-MM-DD' }`.
* **Validation & Business Logic:**
  * `wokeUpTime` matches strict 24-hour `/^([01]\d|2[0-3]):[0-5]\d$/`.
  * Wake-up time cannot be in the future relative to current time.
  * Cycle dates restricted to past 7 days.
  * Wake-up time must be chronologically after bedtime check-in for that cycle.
* **Duration Calculation:**
  * Cross-midnight difference: `DiffInMinutes(woke_up_at, in_bed_at)` clamped between 1 and 1440 minutes.
* **Updates:**
  * Upserts `sleep_logs` record with `woke_up_at`, `woke_up_local_time`, `wake_source`, and `duration_minutes`.
  * Updates member's `last_woke_up_at` and `last_wake_cycle_date`.
  * Inserts `WOKE_UP` in `notification_logs` for backwards compatibility.
* **State Transition:**
  * `computeMemberState` immediately moves member to `AWAKE`, deactivates Sleep Shield, and clears `needsWakeUpLog`.

The pinned check-in bar supplies `expectedInBedAt` for wake-now and manual wake. The timestamp identifies the check-in that opened the flow. It can be null for a legacy open check-in with no timestamp. The active check-in RPC locks the member and commits the sleep log, member wake marker, and notification receipt in one transaction. A changed or completed check-in returns HTTP 409. Manual calendar edits still use their explicit `cycleDate`.

Apply `20261124_guard_active_wake.sql` after the punishment task API migration before deploying the Phase 4 app.

### 6.2 `GET /api/members/sleep-history`
Retrieves monthly sleep & wake logs and summary statistics for self or any community member.

* **Query Parameters:**
  * `memberId` (string, required): Target member ID.
  * `month` (string, optional): Target month formatted as `YYYY-MM` (defaults to current month in target member's timezone).
* **Response Payload:**
  ```json
  {
    "member": {
      "id": "uuid",
      "name": "Username",
      "avatar": "https://...",
      "timezone": "America/New_York",
      "bedtime": "23:30",
      "wake_time": "07:30",
      "current_streak": 7
    },
    "month": "2026-11",
    "logs": [
      {
        "cycle_date": "2026-11-10",
        "in_bed_local_time": "23:30",
        "woke_up_local_time": "07:15",
        "target_bedtime": "23:30",
        "target_wake_time": "07:30",
        "duration_minutes": 465,
        "wake_source": "manual",
        "status": "on_time"
      }
    ],
    "summary": {
      "totalLoggedNights": 22,
      "avgDurationMinutes": 458,
      "avgBedtime": "23:25",
      "avgWakeTime": "07:10",
      "onTimePercentage": 91
    }
  }
  ```
* **Summary Math:**
  * `avgBedtime`: Circular mean across midnight relative to noon offset.
  * `avgWakeTime`: Linear mean in minutes.
  * `onTimePercentage`: Percentage of logged nights with `status === 'on_time'`.
  * Demo member auto-population: If querying a demo profile with empty records, generates 30 days of realistic history on-the-fly.
