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
  notification_type TEXT NOT NULL,          -- 'WIND_DOWN_30M' | 'BEDTIME_HIT'
  local_date DATE NOT NULL,                 -- Sleeper's local date (YYYY-MM-DD)
  dispatched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(member_id, notification_type, local_date)
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