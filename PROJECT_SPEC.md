# Project Specification: Community Bedtime Accountability App ("Z Catchers")

> **AGENT DIRECTIVE FOR ANTIGRAVITY:**
> You are tasked with building **Z Catchers**, a dual-experience application (a lightweight mobile Progressive Web App on phones and an expansive, full-featured web dashboard on desktop browsers) for a cross-timezone Discord community that reminds members to go to sleep and alerts awake community members to "nag" them inside their dedicated Discord journal threads.
>
> **CRITICAL RULES BEFORE WRITING ANY CODE:**
>
> 1. **Strict Scope Adherence:** Build **Phase 1 (MVP)** first. Structure the database so Phase 2 and Phase 3 can be added cleanly later without destructive migrations, but do not build Phase 2/3 UI until Phase 1 is verified.
>
> 2. **Zero Timezone Hallucinations:** Never store bedtimes as static UTC timestamps or raw hour offsets (which break during Daylight Saving Time). Always store a member's bedtime as a local 24-hour time string (`HH:mm`, e.g., `"23:30"`) paired with an IANA Timezone identifier (e.g., `"America/New_York"`, `"Asia/Kolkata"`).
>
> 3. **Sleep Shield Guarantee:** Never dispatch a "nag someone else" push notification to a user who is currently inside their own sleep window (8 hours following their personal bedtime).
>
> 4. **Aesthetic & Brand Mandate:** This app is viewed late at night. Do **not** use bright white (`#FFFFFF`), harsh neon blues, or jarring light-mode defaults. Strictly enforce the **Warm Dark / Low-Blue-Light** palette and integrate the cozy, minimalist **Sleepy Fox mascot** defined in Section 3.
>
> 5. **Responsive Dual Layout:** Never constrain desktop viewports to a narrow mobile container (no global `max-w-md` or `max-w-[480px]`). Build a true responsive experience that feels native on mobile (< 768px) and expansive on desktop (≥ 768px / 1024px+) with `max-w-7xl mx-auto px-6 lg:px-8`.

## 1. Product Vision & Core Loop

Members of an international Discord community want to keep each other accountable for going to bed on time. Because everyone lives in different timezones, nobody knows what "11:30 PM" means for someone else without doing mental math.

### The Core Loop:

1. **Onboarding:** A member joins **Z Catchers**, sets their local bedtime, links their personal Discord Journal thread URL, and enables Web Push Notifications.

2. **Passive Visibility:** At any time, any member can open the app and see everyone's bedtime automatically converted into the **viewer's own local timezone**, grouped by who is about to sleep, who is currently past bedtime, who is asleep, and who is wide awake.

3. **The Trigger (Notifications):**

   * **T-Minus 30 Mins (Wind-Down):** The sleeper receives a gentle personal push notification to start winding down.

   * **T-Minus 0 Mins (Bedtime Hit / Nag Trigger):** The sleeper gets a "Go to Bed" notification, AND all **currently awake** community members get a push notification: *"It's \[Name\]'s bedtime! Go nag them in their journal."*

4. **The Action (Discord Redirect):** Tapping the notification or the member's card opens their specific Discord Journal thread directly in the Discord app so friends can tell them goodnight or nag them off their screens.

5. **Anti-Cheat Governance (48-Hour Cooldown):** To stop members from pushing their bedtime back 5 minutes before midnight to dodge nagging, any self-service schedule edit enters a **48-hour pending state** before becoming active. Moderators can add/remove members or override changes immediately.

## 2. Recommended Tech Stack (For Antigravity Execution)

Unless otherwise specified by the workspace, use this streamlined stack to minimize boilerplate and ensure reliable cron scheduling and Web Push delivery:

* **Framework:** Next.js (App Router, TypeScript) or React + Vite + Node/Express backend. *(Prefer Next.js Full-Stack for unified API routes + UI).*

* **Styling:** Tailwind CSS configured with custom warm-dark theme tokens + Lucide React icons.

* **Timezone & Date Math:** `luxon` or `date-fns-tz` (Mandatory—do not write manual timezone offset math using native `Date.getTimezoneOffset()`).

* **Database & Auth:** Supabase (PostgreSQL + RLS + Edge/Cron Functions) or SQLite/Prisma (if self-hosting on a single VPS).

* **Push Notifications:** Native Web Push API (`web-push` npm package using VAPID keys) + Service Worker (`public/sw.js`).

* **Cron Engine:** A 1-minute or 5-minute interval job (via node-cron, Supabase `pg_cron`, or Vercel Cron) that evaluates upcoming bedtimes and dispatches Web Push payloads.

## 3. UI/UX, Fox Mascot & "Warm Dark" Design System

The interface must feel like a calm, cozy bedside lamp—never clinical, cluttered, or stimulating. It delivers a dual-form experience: a thumb-friendly mobile PWA on smartphones and a spacious, high-visibility dashboard on desktop and tablet viewports.

### 3.1 Color Palette (Low-Blue-Light & Warm Fox Accents)

| Token Name | Hex Code | Usage | 
| ----- | ----- | ----- | 
| `bg-primary` / `night-bg` | `#120F0D` | Main background (Deep espresso/warm obsidian) | 
| `bg-surface` / `night-surface` | `#1C1714` | Member cards, headers & modals | 
| `bg-elevated` / `night-elevated` | `#26201B` | Hover states, inputs, secondary badges | 
| `border-subtle` / `night-border` | `#332B24` | Hairline card borders | 
| `text-primary` / `cream-primary` | `#F5EBE1` | Main readable text (Soft warm cream, never pure white) | 
| `text-secondary` / `cream-secondary` | `#B0A295` | Subtitles, converted timezones, secondary labels | 
| `text-muted` / `cream-muted` | `#73675C` | Sleeping member cards, disabled states | 
| `accent-amber` / `status-amber` | `#E59843` | Primary brand accent, "Winding Down" badge | 
| `accent-coral` / `status-coral` | `#D96B52` | "Bedtime Hit / Nag Now!" urgent status | 
| `accent-sage` / `status-sage` | `#6B9E78` | "Awake / Daytime" peaceful status & push active dot | 
| `accent-indigo` / `status-slumber` | `#5B6B94` | "Currently Sleeping (Zzz)" muted badge | 
| `fox-rust` | `#E07A5F` | Terracotta / warm rust orange fur for the Sleepy Fox mascot | 
| `fox-amber` | `#F4A261` | Golden amber highlight for mascot ears, tail tip & lantern glow | 

### 3.2 Dual Responsive Layout Architecture

Do **not** lock desktop viewports to a narrow mobile container. The application automatically scales:

* **Mobile View (< 768px):**
  * Single-column vertical stream optimized for one-handed operation.
  * Sticky 56px top header with the Fox logo, detected viewer timezone, and push alert bell.
  * Sticky bottom navigation bar (`h-16`, `bg-night-surface/95 backdrop-blur-md`) with `Roster`, `My Time`, and `Mod` tabs.
  * Modals render as slide-up bottom sheets (`rounded-t-3xl`).

* **Desktop & Tablet Website View (≥ 768px / 1024px+):**
  * Main container expands to `max-w-7xl mx-auto px-6 lg:px-8 py-6`.
  * **Top Header / Command Bar:** Full-width desktop navigation bar displaying:
    * Brand: Custom SVG Sleepy Fox logo + "Z Catchers" wordmark.
    * Live Status / Clock: Live local digital clock (`tabular-nums`), viewer timezone pill, and personal Sleep Shield status toggle (`🌙 Sleep Shield: Active / Inactive`).
    * Quick Actions: Direct buttons for `"My Schedule"`, `"Mod Panel"`, and `"Notification Settings"`.
  * **Status Buckets & Multi-Column Member Grid:**
    * Sections expand across the container width.
    * Member cards render inside a responsive CSS Grid: `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4`.
  * **Desktop Modals:** Centered dialog modals (`max-w-lg`) with backdrop blur (`backdrop-blur-md bg-night-bg/80`).
  * Sticky bottom navigation bar is hidden (`hidden md:hidden`).

### 3.3 The "Z Catchers" Sleepy Fox Mascot

A cozy, minimalist fox mascot serves as the companion and visual anchor of Z Catchers:

* **Brand Logo & Header:** Custom SVG Fox mascot icon (warm rust `#E07A5F` and golden amber `#F4A261` with cream `#F5EBE1` details) paired with the "Z Catchers" wordmark.
* **Contextual States:**
  1. **Winding Down / Awake:** Cozy fox yawning or holding a warm glowing lantern in the hero/status banner.
  2. **Nag Now (Bedtime Hit):** Alert fox ringing a tiny bell or peeking out to prompt the community to check on their friends' Discord journals.
  3. **Sleeping / Quiet Hours:** Curled-up sleeping fox with subtle floating "Zzz" accents displayed when the viewer's own Sleep Shield is active, or when a status bucket is empty (*"Every fox in this den is fast asleep"*).
* **PWA & Notification Assets:** PWA app icons and Web Push notification badge feature the minimalist Sleepy Fox mascot silhouette and sleeping profile.

## 4. Database Schema & Data Models

### 4.1 `members` Table

```sql
CREATE TABLE members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_username TEXT NOT NULL,           -- Display name (e.g., "Alex")
  discord_handle TEXT,                      -- Optional @handle or Discord User ID
  avatar_url TEXT,                          -- Optional avatar image or warm fallback initials
  journal_url TEXT NOT NULL,                -- Deep link: https://discord.com/channels/{guild}/{thread}
  
  -- Active Schedule
  bedtime_local VARCHAR(5) NOT NULL,        -- 24-hour format "HH:mm" (e.g., "23:00")
  wake_time_local VARCHAR(5) NOT NULL DEFAULT '07:00', -- Default +8h from bedtime
  timezone TEXT NOT NULL,                   -- IANA string (e.g., "America/Chicago")
  
  -- 48-Hour Cooldown Queue (Self-Healing State Machine)
  pending_bedtime_local VARCHAR(5),         -- Nullable: New requested "HH:mm"
  pending_wake_time_local VARCHAR(5),       -- Nullable: New requested wake time
  pending_timezone TEXT,                    -- Nullable: New requested IANA string
  pending_effective_at TIMESTAMPTZ,         -- UTC timestamp when pending becomes active (now + 48h)
  
  -- Role & Meta
  role TEXT NOT NULL DEFAULT 'member',      -- 'member' | 'moderator'
  passcode_hash TEXT,                       -- Simple 4-6 digit PIN or auth token for claiming profile
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 4.2 `push_subscriptions` Table

Supports multiple devices per member (e.g., phone + desktop).

```sql
CREATE TABLE push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh_key TEXT NOT NULL,
  auth_key TEXT NOT NULL,
  notify_personal BOOLEAN NOT NULL DEFAULT true,     -- Remind me of my own bedtime
  notify_community BOOLEAN NOT NULL DEFAULT true,    -- Ping me to nag others (when I'm awake)
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 4.3 `notification_logs` Table (Idempotency Guard)

Prevents duplicate notifications if the cron job runs multiple times within the same minute window.

```sql
CREATE TABLE notification_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,          -- 'WIND_DOWN_30M' | 'BEDTIME_HIT'
  local_date DATE NOT NULL,                 -- The sleeper's local date (YYYY-MM-DD)
  dispatched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(member_id, notification_type, local_date)
);
```

## 5. Critical Business Logic & Algorithms (DO NOT IMPROVISE)

Antigravity must implement these five core helper functions cleanly in a shared utility module (`src/lib/sleepEngine.ts`).

### 5.1 Self-Healing 48-Hour Cooldown Resolution

Do not rely solely on a background job to promote pending schedules. Whenever a member record is fetched or evaluated:

1. Check if `pending_effective_at IS NOT NULL`.

2. If `current_utc_time >= pending_effective_at`:

   * Treat `pending_bedtime_local` (and `pending_timezone`) as the active schedule immediately in memory.

   * Asynchronously update the DB row to move `pending_*` values into the active columns and set `pending_* = NULL`.

3. If `current_utc_time < pending_effective_at`:

   * Continue using `bedtime_local` for all status calculations and notifications.

   * Display a subtle badge on their card: `"Schedule shifting to [Pending Time] in Xh Ym"`.

### 5.2 Cross-Timezone Conversion & Status Calculation

Given a member's `bedtime_local` (`"23:30"`), their `timezone` (`"America/New_York"`), and the current UTC instant (`now`):

1. Convert `now` into the member's local timezone using `luxon` (`DateTime.now().setZone(member.timezone)`).

2. Construct today's target bedtime in the member's timezone, plus yesterday's bedtime and tomorrow's bedtime (to handle midnight boundary wrap-arounds seamlessly).

3. Calculate the time delta in minutes from the most relevant bedtime instance:

   * **Bucket 1: `BEDTIME_NOW` (Nag Window)**

     * Condition: Current time is between `0` and `60` minutes *after* their bedtime.

     * UI Action: Rank at the very top of the page. Pulse badge: `"Bedtime hit Xm ago — Nag them!"`

   * **Bucket 2: `WINDING_DOWN`**

     * Condition: Current time is between `1` and `60` minutes *before* their bedtime.

     * UI Action: Rank second. Badge: `"Bedtime in Xm"`.

   * **Bucket 3: `SLEEPING` (Sleep Shield Active)**

     * Condition: Current time is between `61` minutes after bedtime and `480` minutes (8 hours) after bedtime (or until their `wake_time_local`).

     * UI Action: Rank at the bottom, dimmed. Badge: `"Catching Z's • Wake in Xh Ym"`.

   * **Bucket 4: `AWAKE`**

     * Condition: All other times.

     * UI Action: Sort ascending by `minutes_until_next_bedtime`.

4. **Viewer Local Time Conversion:**

   * Take the member's next `bedtime` `DateTime` object and call `.setZone(viewerTimezone).toFormat('h:mm a')`.

   * Display both: Primary text = **Viewer's Time** (e.g., `"9:00 AM your time"`), Secondary subtext = **Sleeper's Time** (`"11:30 PM their time"`).

### 5.3 The Notification Dispatcher & "Sleep Shield" Guardrail

Run a scheduled check every **1 minute** (or 5 minutes):

1. Loop through all active members. Resolve any expired 48-hour cooldowns first.

2. For each member $M$:

   * **Check 1: Is** $M$ **at T-Minus 30 Minutes (`WIND_DOWN_30M`)?**

     * Check `notification_logs` for `(M.id, 'WIND_DOWN_30M', M.local_date)`. If not sent:

     * Send Web Push to $M$'s personal subscriptions:

       * Title: `"🕯️ Z Catchers: Wind-Down Time"`

       * Body: `"30 minutes until your bedtime (${M.bedtime_local}). Start wrapping up!"`

       * URL: `M.journal_url`

     * Record in `notification_logs`.

   * **Check 2: Is** $M$ **at T-Minus 0 Minutes (`BEDTIME_HIT`)?** (Allow a 0–4 minute grace window so cron jitter never misses a trigger, protected by the unique constraint in `notification_logs`).

     * Check `notification_logs` for `(M.id, 'BEDTIME_HIT', M.local_date)`. If not sent:

     * **Dispatch A (To the Sleeper** $M$**):**

       * Title: `"🌙 Time to Catch Some Z's!"`

       * Body: `"It's ${M.bedtime_local}. Head to your Discord journal and check in for the night."`

       * URL: `M.journal_url`

     * **Dispatch B (To the Community — Filtered by Sleep Shield):**

       * Query all other active members $C \neq M$ who have `notify_community = true`.

       * **CRITICAL FILTER:** Evaluate every recipient $C$'s current status using Algorithm 5.2. If $C$ is currently in status `SLEEPING` (or within 15 minutes before their own bedtime), **SKIP** $C$. Do not wake sleeping members!

       * Send Web Push to all remaining **awake** recipients:

         * Title: `"🔔 Z Catchers Alert: ${M.discord_username}"`

         * Body: `"It's ${M.discord_username}'s bedtime! Tap to jump into their Discord journal and tell them to sleep."`

         * URL: `M.journal_url`

     * Record in `notification_logs`.

### 5.4 Discord Journal URL Validation & Deep Linking

* **Validation Rule:** Must match regex `^https:\/\/(ptb\.|canary\.)?discord\.com\/channels\/\d+\/\d+(\/\d+)?$`

* **Redirect Behavior:**

  * On member cards, provide a dedicated button: `"Nag in Journal ↗"`.

  * In the Service Worker (`sw.js`), handle the `notificationclick` event by reading `event.notification.data.url` and calling `clients.openWindow(url)`. On iOS and Android, opening a `https://discord.com/channels/...` URL via `openWindow` or `<a href="..." target="_blank" rel="noopener noreferrer">` automatically triggers Universal Links / App Links and launches the native Discord mobile app directly into that thread.

### 5.5 Authentication & Governance Model (Lightweight for MVP)

To ship ASAP without waiting on complex OAuth app verification:

* **Member Profile Claim / Edit:** Each member has a 4-digit PIN (or uses a lightweight Discord OAuth / Magic Link if preferred). Entering their PIN lets them edit their own profile and link their push subscription to their `member_id`.

* **Self-Edit Rules:**

  * Updating `journal_url` or `discord_username`: **Instant**.

  * Initial creation of `bedtime_local`: **Instant**.

  * Changing an existing `bedtime_local` or `timezone`: **Locked behind the 48-hour cooldown** (`pending_effective_at = NOW() + INTERVAL '48 hours'`). Users can cancel a pending change anytime before it takes effect.

* **Moderator Mode:**

  * Protected by a master `MOD_SECRET_PASSCODE` environment variable.

  * Moderators can:

    1. Add a new member (sets initial bedtime immediately).

    2. Remove/Deactivate a member.

    3. Edit any member's bedtime or journal link **immediately** (bypasses the 48-hour cooldown).

    4. Click `"Approve Now"` on any member's pending 48-hour change.

## 6. Phased Feature Roadmap

### Phase 1: The Lean MVP (BUILD THIS NOW)

* \[x\] Warm Dark Mode responsive PWA shell (`manifest.json`, icons, standalone display mode) branded as **Z Catchers**.

* \[x\] Timezone-synced member roster grouped into the 4 live status buckets (`Nag Now`, `Winding Down`, `Awake`, `Sleeping`).

* \[x\] Dual-time display on every card (Viewer's local time + Sleeper's local time + live relative countdown).

* \[x\] Direct Discord Journal thread deep-link button on every card.

* \[x\] Self-service schedule editing with strict **48-hour cooldown queue** and visible pending badge.

* \[x\] Moderator dashboard to add/remove members, edit URLs, and force-approve cooldowns.

* \[x\] Web Push Notification subscription flow + iOS/Android "Add to Home Screen" onboarding helper banner.

* \[x\] Automated Cron engine for 30-min Wind-Down pings and 0-min Community Nag pings with **Sleep Shield** protection.

### Phase 2: Anti-Spam & Check-In Polish (DO NOT BUILD UNTIL PHASE 1 IS LIVE)

* [x] **Member PIN Login & Profile Authentication (ZC-13):** Built a simple, secure 4-digit PIN authentication system. Devices bind Web Push notifications and Sleep Shield quiet hours strictly to verified accounts, completely eliminating unauthenticated profile selection and notification misdirection.

* \[ \] **"I'm In Bed" Safe Button:** During the 30-minute wind-down window, the sleeper can tap `"I'm heading to bed now"` in the app, which marks them as `SLEEPING` early and suppresses the outgoing community nag notification for that night.

* \[ \] **Selective Watchlists (Buddy System):** Allow users to star specific friends so they only get community nag pings for their chosen watchlist rather than the entire server.

* \[ \] **Custom Quiet Hours:** Allow users to decouple their notification quiet hours from their strict 8-hour sleep window.

* \[ \] **One-Tap "Test Push" Button:** Let users send a test push notification to their own device from the settings tab to verify their phone's OS permissions.

### Phase 3: Deep Discord Ecosystem & Gamification (FUTURE EXPANSION)

* \[ \] **Discord Bot / Webhook Integration:** Automatically post an embed inside the user's Discord journal thread when their bedtime hits (`"🚨 Bedtime Alert for @User! Someone make sure they log off."`).

* \[ \] **"Nagged!" Assist Counter:** A quick counter on the card showing how many members tapped through to check on the sleeper tonight (`"3 friends checked in tonight"`).

* \[ \] **Sleep Consistency Streaks:** Track consecutive days a member checks in on time without using schedule changes.

## 7. Step-by-Step Execution Plan for Antigravity

Follow these exact milestones in order. Verify each milestone compiles and passes logic checks before moving to the next.

### Milestone 1: Project Scaffolding & Sleep Math Engine

1. Initialize the project with TypeScript and Tailwind CSS. Configure the custom Warm Dark color palette in `tailwind.config.ts`.

2. Install `luxon` (and `@types/luxon`) for timezone math.

3. Build and unit-test `src/lib/sleepEngine.ts`:

   * Implement `resolveEffectiveSchedule(member)` (48h cooldown promotion logic).

   * Implement `computeMemberSleepState(member, viewerTimezone, nowUtc)` returning the bucket (`BEDTIME_NOW`, `WINDING_DOWN`, `SLEEPING`, `AWAKE`), minutes until/since bedtime, formatted viewer time, formatted sleeper time, and whether `isSleepShieldActive` is true.

   * Implement `validateDiscordJournalUrl(url)`.

### Milestone 2: Database Layer & API Routes

1. Set up the database schema (`members`, `push_subscriptions`, `notification_logs`) and seed it with 5 realistic mock community members across diverse timezones (`America/Los_Angeles`, `America/New_York`, `Europe/London`, `Asia/Kolkata`, `Australia/Sydney`) so the timezone buckets can be visually tested immediately.

2. Create REST/Server Action endpoints:

   * `GET /api/members` — Fetches all active members, auto-promotes any expired 48h pending schedules in the DB, and returns the list.

   * `POST /api/members/update-schedule` — Validates PIN; if member, writes to `pending_*` with `now + 48h`. If moderator passcode provided, writes directly to active columns.

   * `POST /api/mod/members` — Moderator CRUD (Add member, delete member, approve pending cooldown immediately).

### Milestone 3: Warm Dark UI, Responsive Desktop Dashboard & Sleepy Fox Mascot

1. Build the responsive layout shell with the **Z Catchers** Sleepy Fox mascot branding:
   * **Mobile (< 768px):** Single-column vertical layout with sticky bottom navigation.
   * **Desktop (≥ 768px):** Full-width command bar header with live clock, viewer timezone pill, Sleep Shield toggle, and quick-action buttons, expanding the main layout to `max-w-7xl mx-auto px-6 lg:px-8`.

2. Integrate the **Sleepy Fox mascot** into the header logo, contextual status banner (lantern / yawning when winding down, alert bell when nag now is active), and empty bucket states (*"Every fox in this den is fast asleep"*).

3. Build the `MemberCard` component showing:
   * Name, avatar, status badge, and countdown pill (`"in 42m"` or `"15m past bedtime"`).
   * Bedtime in viewer's local time (large, warm cream text) and sleeper's local time (muted subtext).
   * Pending cooldown banner if `pending_effective_at > now` (e.g., `"⏳ Changing to 11:30 PM in 31h"`).
   * Prominent `"Nag in Discord Journal ↗"` button that deep-links to `member.journal_url`.

4. Assemble the 4 status bucket sections on the main page inside a responsive CSS Grid (`grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4`) with a 30-second client-side interval timer so countdowns and buckets update live without refreshing. Support centered dialog modals on desktop and slide-up sheets on mobile.

### Milestone 4: Self-Service Profile & Moderator Drawer

1. Build the **"My Schedule"** modal/tab (centered dialog on desktop, bottom sheet on mobile) where a user selects their name, enters their PIN, updates their Discord Journal thread URL, or requests a bedtime change (with a clear warning that bedtime edits take **48 hours** to take effect).

2. Build the **"Mod Panel"** modal/tab unlocked via the Moderator Passcode, allowing instant member creation, removal, and one-click approval of pending 48-hour cooldowns.

### Milestone 5: PWA Configuration, Fox Mascot Assets & Web Push Notifications

1. Create `public/manifest.json` (`name: "Z Catchers"`, `short_name: "Z Catchers"`, `display: "standalone"`, `background_color: "#120F0D"`, `theme_color: "#120F0D"`) and register `public/sw.js`. Update app icons (`icon.svg`, `icon-512x512.png`) and push notification badges to feature the Sleepy Fox mascot.

2. Implement `public/sw.js` with `push` event listener (displaying title, body, icon, badge) and `notificationclick` listener (focusing or opening the Discord `journal_url`).

3. Create an onboarding banner that detects:

   * If on mobile iOS and *not* in standalone mode: Show a clean 2-step tooltip explaining `"Tap Share -> Add to Home Screen to enable Z Catchers bedtime alerts"`.

   * If push permission is `"default"`: Show an `"Enable Bedtime & Nag Alerts"` button that subscribes via VAPID public key and saves to `/api/push/subscribe`.

4. Build `/api/cron/dispatch-notifications` implementing Algorithm 5.3 (30m wind-down + 0m community nag filtered strictly through the Sleep Shield) and a `"Send Test Notification"` button in the UI so push delivery can be verified immediately.

### Milestone 6: Simple Member PIN Login & Profile Session Binding (ZC-13)

1. Built `src/lib/auth.ts` session management using HMAC-SHA256 signed session tokens (30-day persistence) with zero external auth dependencies.
2. Built auth REST endpoints: `POST /api/auth/login` (verifies/claims 4-digit PIN and issues HttpOnly cookie + Bearer token), `GET /api/auth/me` (restores session), and `POST /api/auth/logout`.
3. Built responsive `src/components/LoginModal.tsx` with Sleepy Fox mascot, supporting first-time profile claim and returning member PIN unlock.
4. Secured `POST /api/push/subscribe` to enforce session ownership, preventing users from subscribing their devices to another member's profile.
5. Integrated logged-in account status into desktop `Header.tsx`, mobile navigation bar, and updated `PushModal.tsx` to link push alerts directly to the authenticated user.
6. Verified with unit and live database tests in `scripts/test-login-and-auth.mjs`.

## 8. Edge Cases & QA Checklist for Antigravity

Before marking Phase 1 complete, verify the following edge cases:

* \[ \] **Midnight Wrap-Around:** If a member in London has a `00:30` bedtime and it is currently `23:50` in London, does the app accurately calculate `"Bedtime in 40m"` (`WINDING_DOWN`) rather than thinking bedtime was 23 hours ago?

* \[ \] **Daylight Saving Time (DST) Resilience:** If a viewer in `Asia/Kolkata` (no DST) looks at a member in `America/New_York` (observes DST), is the time conversion handled via IANA zones rather than a hardcoded `-5` offset?

* \[ \] **Sleep Shield Enforcement:** If User A (in IST) is currently `SLEEPING` at 3:00 AM IST, and User B's bedtime hits in EST, verify that User A receives **zero** push notifications.

* \[ \] **48-Hour Cooldown Bypass Prevention:** If a regular user submits a bedtime change API request twice in a row, does `pending_effective_at` reset to a full `48 hours` from the latest edit?

* \[ \] **Discord Link Sanitization:** Does the form reject non-Discord URLs so no one can inject arbitrary redirect links into push notifications?