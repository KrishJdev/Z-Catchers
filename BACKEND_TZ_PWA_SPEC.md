# Z Catchers: Backend, Timezone & PWA Technical Reference

> **AGENT DIRECTIVE:** This document serves as the absolute technical blueprint for implementing the database models, Luxon timezone conversion engine, Sleep Shield notification guardrails, and Service Worker Web Push infrastructure for **Z Catchers**. Follow every algorithm and schema definition precisely.

---

## 1. Complete Database Schema (PostgreSQL / Supabase)

Execute these SQL statements to set up the relational tables. All timestamps must be stored in UTC (`TIMESTAMPTZ`), while local bedtimes are stored as strict `HH:mm` strings paired with IANA timezones.

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
  
  -- 48-Hour Cooldown Pending Queue
  pending_bedtime_local VARCHAR(5),
  pending_wake_time_local VARCHAR(5),
  pending_timezone TEXT,
  pending_effective_at TIMESTAMPTZ,         -- UTC timestamp when pending promotion unlocks (NOW() + 48h)
  
  -- Role & Security
  role TEXT NOT NULL DEFAULT 'member',      -- 'member' | 'moderator'
  passcode_hash TEXT,                       -- 4-digit PIN for self-service updates
  is_active BOOLEAN NOT NULL DEFAULT true,

  -- Monthly Strikes & Metastrikes Accountability System
  strikes_used INT NOT NULL DEFAULT 0 CHECK (strikes_used >= 0 AND strikes_used <= 3),
  metastrikes_used INT NOT NULL DEFAULT 0 CHECK (metastrikes_used >= 0 AND metastrikes_used <= 3),
  strike_cycle_month TEXT NOT NULL DEFAULT '2026-11', -- 'YYYY-MM' for lazy monthly reset

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

-- 4. Nightly Strike Logs Table (Community 2-Vote Strike & Metastrike Passes)
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
  bedtimeLocal: string; // "23:30"
  timezone: string;     // "America/New_York"
  journalUrl: string;
  // ... other fields
}

export type SleepBucket = 'BEDTIME_NOW' | 'WINDING_DOWN' | 'SLEEPING' | 'AWAKE';

export function computeMemberState(member: MemberSchedule, viewerTz: string, nowUtc = DateTime.utc()) {
  // 1. Parse sleeper's local bedtime today in their IANA zone
  const [hours, minutes] = member.bedtimeLocal.split(':').map(Number);
  const sleeperNow = nowUtc.setZone(member.timezone);
  
  let bedtimeToday = sleeperNow.set({ hour: hours, minute: minutes, second: 0, millisecond: 0 });
  
  // Handle midnight boundary wrap: construct yesterday, today, and tomorrow instances to find the closest one
  const bedtimeYesterday = bedtimeToday.minus({ days: 1 });
  const bedtimeTomorrow = bedtimeToday.plus({ days: 1 });
  
  const candidates = [bedtimeYesterday, bedtimeToday, bedtimeTomorrow];
  // Find the bedtime instance closest to current time
  let targetBedtime = candidates.reduce((closest, curr) => 
    Math.abs(curr.diff(sleeperNow, 'minutes').minutes) < Math.abs(closest.diff(sleeperNow, 'minutes').minutes) ? curr : closest
  );

  const diffMinutes = sleeperNow.diff(targetBedtime, 'minutes').minutes; // negative = before bedtime, positive = after bedtime

  let bucket: SleepBucket = 'AWAKE';
  let statusText = '';
  let isSleepShieldActive = false;

  if (diffMinutes >= 0 && diffMinutes <= 60) {
    bucket = 'BEDTIME_NOW';
    statusText = `Bedtime hit ${Math.floor(diffMinutes)}m ago — Nag them!`;
  } else if (diffMinutes < 0 && diffMinutes >= -60) {
    bucket = 'WINDING_DOWN';
    statusText = `Bedtime in ${Math.abs(Math.floor(diffMinutes))}m`;
  } else if (diffMinutes > 60 && diffMinutes <= 480) { // 8 hour sleep shield window
    bucket = 'SLEEPING';
    statusText = `Catching Z's (Asleep)`;
    isSleepShieldActive = true;
  } else {
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

The accountability system ensures members adhere to their bedtimes with community oversight while accommodating valid life events.

#### 1. Core Accountability Rules
* **Strikes (Max 3 per calendar month):** Issued when a member is more than 5 minutes past their scheduled bedtime without an excused pass.
* **Metastrikes (Max 3 per calendar month):** Excused passes for unexpected or important events (e.g. Monthly Battle, Family Event, Birthday Celebration, Health Emergency).
* **Automatic Lazy Monthly Reset:** Both `strikes_used` and `metastrikes_used` reset to 0 used (3 remaining each) on the 1st of every calendar month. Stored in `members.strike_cycle_month` (`YYYY-MM`) and evaluated lazily whenever a profile is read or updated via `checkMonthlyStrikeReset()`.
* **Zero Auto-Strikes Guarantee:** Sleep check-ins occur in Discord journal threads. The system **never** auto-assigns strikes based on app inactivity. It strictly enforces a **2-Vote Community Verification system** paired with self-service Metastrike passes.

#### 2. Timezone & 5-Minute Grace Window State Machine
* **`BEDTIME_GRACE` ($0 \le \text{diffMinutes} \le 5$):**
  * Status text: `"Grace Period: Xm left"`.
  * Strike voting is strictly locked (`canVoteStrike = false`).
* **`OVERDUE_NAG_NOW` ($\text{diffMinutes} > 5$ up to 480 minutes):**
  * Status text: `"Bedtime hit Xm ago — Nag them!"`.
  * Strike voting is unlocked (`canVoteStrike = true`), provided the member has not checked in early via `"I'm in Bed"` and has not activated a Metastrike for tonight.

#### 3. Community 2-Vote Strike Workflow
* Any authenticated member (except the target member) can vote on a member in status `OVERDUE_NAG_NOW`.
* Each voter can only vote once per target per `sleep_cycle_date`.
* **Vote 1:** Record type stays `'pending_vote'`, voter ID recorded in `voter_ids` JSON array, card displays `"Vote Strike (1/2)"`.
* **Vote 2:** Record type automatically transitions to `'strike'`, target's `strikes_used` increments by 1 (capped at 3), card locks to `"Strike Issued Tonight"`.

#### 4. Proactive & Retroactive Metastrike (Excuse Pass) Workflows
* **Proactive Metastrike:** Member taps `"Use Metastrike Tonight"` on their own card and selects or types a reason. Consumes 1 Metastrike (`metastrikes_used + 1`), sets `record_type = 'metastrike'` for tonight's `sleep_cycle_date`, and locks out all community strike votes with a `"Protected by Metastrike: [Reason]"` shield badge.
* **Retroactive 24-Hour Swap:** If a member receives a 2-vote Strike within the last 24 hours while away, they can tap `"Convert to Metastrike"` (if `metastrikes_used < 3`). This decrements `strikes_used` by 1, increments `metastrikes_used` by 1, and updates the nightly log's `record_type` from `'strike'` to `'metastrike'`.

#### 5. Moderator Override & Nightly Log Administration
* Authenticated moderators using `MOD_SECRET_PASSCODE` can manually increment or decrement any member's `strikes_used` and `metastrikes_used` (bounded within $[0, 3]$).
* Moderators can clear accidental strike votes or nightly logs via `POST /api/mod` with action `clear_strike_log`.

#### 6. REST API Endpoints for Strikes
* `POST /api/members/strikes/vote`: Casts a community strike vote (enforces non-self and uniqueness).
* `POST /api/members/strikes/metastrike`: Activates a proactive pass or performs a 24-hour retroactive swap.
* `GET /api/members/strikes`: Retrieves strike counts and tonight's active log for a member.
* `POST /api/mod`: Handles `adjust_strikes` and `clear_strike_log` moderator actions.

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

### 3.2 Notification Dispatcher Logic (Cron Endpoint)
When the background cron job runs every minute, it enforces the **Sleep Shield**:

1. Find all active members $M$ whose local time matches either **T-Minus 30 minutes** or **T-Minus 0 minutes**.
2. **Personal Notification:** Send wind-down or bedtime hit push to $M$.
3. **Community Nag Notification:** 
   * Query all members $C \neq M$ where `notify_community = true`.
   * Evaluate $C$'s sleep state using Algorithm 2.2.
   * **GUARDRAIL:** If $C$'s `isSleepShieldActive` is `true`, **exclude $C$ from the recipient list**.
   * Dispatch push alert to remaining awake members containing $M$'s `journal_url`.

---

## 4. Discord Journal Validation
All user-submitted journal links must be validated against this strict regex before saving to the database:
```regex
^https:\/\/(ptb\.|canary\.)?discord\.com\/channels\/\d+\/\d+(\/\d+)?$
```