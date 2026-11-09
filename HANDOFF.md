# Project Handoff Document: Z Catchers (`HANDOFF.md`)

> **Last Updated:** 2026-11-10T02:00:00+05:30  
> **Active Working Branch:** `krish`  
> **Target Integration Branch:** `dev`  
> **Production Branch:** `main`  
> **Latest Commit:** `49fea68`  
> **Build Status:** Passing (`tsc --noEmit` clean, 0 errors | Next.js production build passing with 21 routes | All auth, security, E2E & GMT privacy tests passing)

---

## 1. Executive Summary & Project Purpose

**Z Catchers** is a dual-experience application (lightweight mobile Progressive Web App on phones and expansive web dashboard on desktop) built for a cross-timezone Discord community. 

### The Problem Solved:
In an international Discord server with members spanning US, Europe, India, and Australia, members want to hold each other accountable for going to sleep on time. Because everyone is in different timezones, nobody knows when "11:30 PM" occurs for another person without mental math.

### The Core Loop:
1. **Self-Service / Onboarding:** Members register/claim their profile, set their bedtime in their own local time (24h format), set a 4-digit PIN, and provide their dedicated Discord Journal thread link.
2. **Dynamic Dashboard:** Community members open the app and see everyone's bedtime automatically converted into the **viewer's local timezone**, categorized into 4 live buckets:
   * 🚨 **Nag Now! (Bedtime Hit):** Within 0 to 60 minutes after their bedtime. Awake friends are prompted to open their Discord journal and nag them to sleep.
   * 🌙 **Winding Down:** Within 60 minutes before bedtime. Cozy wind-down state.
   * ☀️ **Wide Awake:** Daytime or well before wind-down.
   * 💤 **Asleep (Zzz):** 60 to 480 minutes (8 hours) after bedtime, or early check-in.
3. **Anti-Dodge Governance (48-Hour Cooldown):** To prevent members from pushing back their bedtime right before midnight to avoid being nagged, any self-service schedule change is queued in a **48-hour pending state** before taking effect. Moderators can instantly override or approve pending changes via a passcode-protected drawer.
4. **Sleep Shield Guarantee & Early Check-In ("I'm In Bed" Safe Button):**
   * Members heading to bed early can tap `"I'm in Bed"` to safely silence outgoing community nag notifications and personal bedtime alarms for that night.
   * Awake members receive nag alerts to check on friends, but the system **never** sends notifications to anyone currently inside their personal 8-hour sleep window or who has safely checked in.
5. **Sleep Consistency Streaks & Mascot Badges:** Consistent on-time bedtimes unlock celebratory Sleepy Fox milestone badges (Cozy Kit 🥉, Dream Fox 🥈, Night Guardian 🥇, Grand Slumber Fox 👑).
6. **Buddy Watchlist System:** Members can star their closest friends (`⭐`) to filter the den down to their core accountability circle.
7. **Automated Discord Channel Webhooks & Morning Slumber Digests:** Automated rich embeds dispatch directly into the community Discord channel at bedtime with sleep streaks, local times, and direct journal links, plus morning recap digests celebrating streak champions.
8. **"Nagged!" Community Assist Counter:** Live count of how many friends tapped into Discord to nag each sleeper tonight (`"👥 3 friends checked in tonight 🦊"`).

---

## 2. Technology Stack & Architecture

| Layer | Technology | Details / Notes |
|---|---|---|
| **Framework** | Next.js 15 (App Router) + React 19 | Server & Client components, App directory structure |
| **Language** | TypeScript 5.7 (Strict mode) | Strict typing across all entities, calculations, and state machines |
| **Styling & Tokens** | Tailwind CSS 3.4 | Warm Dark low-blue-light palette (`#120F0D` night bg, `#1C1714` surface, `#F5EBE1` cream text) |
| **Icons** | Lucide React | Clean, minimalist icons matching dark aesthetic |
| **Timezone Math** | Luxon 3.5 | Strict IANA timezone math with DST resilience and midnight wrap-around support |
| **Database** | Supabase (PostgreSQL) | Managed tables: `members`, `push_subscriptions`, `notification_logs` |
| **Push Notifications** | Web Push API (`web-push` npm) | VAPID key pairs, multi-device support per member, service worker deep linking |
| **Discord Webhooks** | Discord Incoming Webhooks API | Rich embeds with Warm Dark color tokens, Sleep Shield notices, journal thread deep links |
| **Deployment & Cron** | Vercel Cron (`vercel.json`) | 1-minute automated trigger targeting `/api/cron/dispatch-notifications` |
| **Issue Tracking** | Jira Software Cloud & GitHub | Project key `ZC`, two-way syncing and transition scripts |

---

## 3. Git Branching Model & Workflow

Per repository protocol established in `AGENT_RULES.md` and commit history:
* **Active Working Branch:** `krish`
  * All active feature development, edits, testing, and commits occur directly on this branch.
* **Target Integration Branch:** `dev`
  * Default repository branch on GitHub. Pull Requests from `krish` target `dev`.
* **Production Branch:** `main`
  * Tagged releases and production deployments.

---

## 4. Chronological Implementation History

### Phase 1: Foundation & Scaffold
* **Commit `4b980d6` / `e92a56b`:** Initialized project specifications (`PROJECT_SPEC.md`), design token system (`DESIGN_SYSTEM.md`), backend architecture and database schema (`BACKEND_TZ_PWA_SPEC.md`), and agent rules (`AGENT_RULES.md`).
* **Commit `a7d7d29`:** Scaffolded Next.js 15 PWA foundation with Supabase client (`src/lib/db.ts`), Luxon sleep engine (`src/lib/sleepEngine.ts`), and warm-dark Tailwind configuration.
* **Commit `733ea23`:** Completed initial UI scaffold with Sleepy Fox mascot (`src/components/FoxMascot.tsx`), responsive layout shell, documentation hierarchy, and Jira workflow integration.
* **Commit `d61583f`:** Formalized Git branching protocol (`krish` as active working branch, `dev` as target).

### Phase 2: Jira Integration & Schedule Cooldown Logic
* **Commit `f4a696c` / `bd9f0f9` / `ba2fee7`:** Configured and debugged GitHub Actions Jira transition scripts (`.github/workflows/jira-transition.yml`, `scripts/transition-jira-issue.mjs`) tracking ZC issues.
* **Commit `46025db` (Milestone 4 - Part 1 / Jira ZC-5):**
  * Built `src/components/MyScheduleModal.tsx` supporting desktop centered dialog and mobile bottom sheet.
  * Implemented PIN claiming & verification flow (first-time PIN claim vs returning member edit).
  * Built 48-hour cooldown anti-dodge mechanism: schedule updates set `pending_bedtime_local`, `pending_timezone`, and `pending_effective_at = now + 48 hours`.
  * Added instant update for Discord Journal URL (not subject to cooldown).
  * Added Discord Journal URL regex validation (`https://discord.com/channels/...`).
  * Created API endpoints:
    * `POST /api/members/update-schedule` — Validates PIN and enqueues 48h pending change.
    * `POST /api/members/cancel-pending` — Allows member to withdraw their pending change before 48h expires.
  * Added test script `scripts/test-schedule-cooldown.mjs` verifying cooldown promotion and cancellation logic.

### Phase 3: Moderation Drawer & Backend Admin Controls
* **Commit `18fa314`:** Transitioned Jira issues ZC-9 and ZC-10 to "In Progress".
* **Commit `a3fc7fa` (Milestone 4 - Part 2 / Jira ZC-10):**
  * Created moderator backend API routes in `src/app/api/mod/route.ts` and `src/app/api/mod/members/route.ts`.
  * Secured via `MOD_SECRET_PASSCODE` header / payload check with `src/lib/auth.ts`.
  * Actions implemented: `approve_pending`, `reject_pending`, `create_member`, `update_member`, `delete_member`, `reset_pin`.
* **Commit `d66de1f` (Jira ZC-9):**
  * Built `src/components/ModDrawer.tsx` (over 1,200 lines of fully typed responsive UI):
    * Passcode lock screen with error shake and persistence in session.
    * Pending Cooldown Approvals tab: reviews pending bedtime/timezone diffs with countdown pill and one-click "Approve Now" or "Reject".
    * Roster Management tab: search, filter active/inactive, inline edit, delete confirmation dialog, PIN reset.
    * "Add Member" modal with timezone selector and bedtime picker.
* **Commit `4339402`:**
  * Integrated `ModDrawer` and `MyScheduleModal` into main dashboard `src/app/page.tsx`.
  * Linked desktop top Header command bar buttons (`"My Schedule"`, `"Mod Panel"`) and mobile bottom navigation tabs (`"My Time"`, `"Mod"`) directly to open the respective modals.

### Phase 4: Web Push Notification Engine & 1-Minute Cron Dispatcher
* **Commit `fee9f22` / `223da1d` (ZC-6, ZC-7):**
  * Enhanced `public/sw.js` with `skipWaiting()`, `clients.claim()`, rich notification formatting (badge, mascot icon, vibration pattern), and `notificationclick` deep linking directly to Discord journal threads.
  * Implemented `src/lib/pushServer.ts` and `src/lib/pushClient.ts` with VAPID subscription and auto-pruning.
  * Built `src/components/PushModal.tsx` for alert preferences and Sleep Shield status inspection.
  * Built 1-minute cron notification dispatcher in `src/lib/cronDispatcher.ts` and `/api/cron/dispatch-notifications`.

### Phase 5: "I'm In Bed" Safe Button, Sleep Streaks, Buddy Watchlist & Vercel Cron (Commit `f8ddcb2`)
* **"I'm In Bed" Safe Button & Anti-Spam Check-In (`ZC-8` / Phase 2):**
  * Created `POST /api/members/in-bed` and `GET /api/members/in-bed`:
    * Enables one-tap check-in marking member `is_in_bed: true` for their local timezone date (`IN_BED_EARLY` in `notification_logs`).
    * Supports cancellation / undoing check-in (`action: 'cancel'`).
  * Updated `src/lib/cronDispatcher.ts`:
    * When member has checked in early via "I'm in Bed", personal wind-down & bedtime notifications are suppressed.
    * Outgoing community nag push notifications to friends are **strictly suppressed** (anti-spam guarantee).
  * Updated `src/lib/sleepEngine.ts`:
    * `computeMemberState()` accepts `isInBed`. Early check-in immediately moves member into `SLEEPING` bucket with Sleep Shield active.
* **Sleep Consistency Streaks & Mascot Badges (`ZC-12` / Phase 3.1):**
  * Implemented pure `calculateSleepStreak(checkinDates, sleeperNow)` in `src/lib/sleepEngine.ts` calculating consecutive check-in days.
  * Implemented `getStreakMilestoneBadge()` awarding visual mascot badges (Grand Slumber Fox 👑, Night Guardian Fox 🥇, Dream Weaver Fox 🥈, Cozy Den Kit 🥉, First Snooze 🔥).
  * Displayed badge and streak pill on `MemberCard.tsx` and inside `MyScheduleModal.tsx`.
* **Selective Buddy Watchlist System (Phase 2):**
  * Added star toggle (`⭐`) to every member card, persisting starred members in localStorage.
  * Added dashboard filter pill: `"All Den (N)"` vs `"Starred Buddies (M)"`.
* **Vercel Cron Deployment (`vercel.json`):**
  * Added `vercel.json` configuring 1-minute cron trigger to `/api/cron/dispatch-notifications`.

### Phase 6: CodeRabbit AI Code Review Integration (Commit `d06d81f`)
* Configured `.coderabbit.yaml` adhering to CodeRabbit v2 schema with path instructions for sleep engine, cooldowns, and design tokens.

### Phase 7: Simple Member PIN Login & Profile Session Binding (`ZC-13`)
* **HMAC-SHA256 Session Engine (`src/lib/auth.ts`):** 30-day cryptographically signed sessions.
* **Auth Endpoints:** `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`.
* **Push Subscription Security Enforcement:** Bound push endpoints strictly to authenticated session profiles.
* **Warm Dark Login Modal (`src/components/LoginModal.tsx`):** Profile selection, claim, PIN entry, and logout.

### Phase 8: Automated Discord Channel Webhooks & "Nagged!" Assist Counter (`ZC-11` / `ZC-12` / `ZC-13`)
* **Automated Discord Channel Webhook Engine (`src/lib/discordWebhook.ts`):**
  * Regex validation for incoming Discord Webhooks (`^https:\/\/(ptb\.|canary\.)?discord\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$`).
  * Warm Dark embed color tokens: `#E07A5F` (Coral Nag: `14711391`), `#F4A261` (Amber Cozy: `16032353`), `#81B29A` (Sage Rest: `8500122`), `#3D405B` (Slumber Night: `4014171`).
  * `sendBedtimeDiscordWebhook`: Dispatches rich embeds at bedtime hit with local bedtime, streak days, streak medal, Sleep Shield status, and direct Discord journal thread link.
  * `sendMorningDigestDiscordWebhook`: Dispatches morning wake-up slumber recap ranking top streak champions and safe check-ins.
  * `sendTestDiscordWebhook`: Instant test dispatch verifying webhook connectivity.
* **1-Minute Cron Dispatcher Integration (`src/lib/cronDispatcher.ts`):**
  * Added Dispatch C: Automatically triggers Discord bedtime webhook for each sleeper when their bedtime hits (unless checked in early).
  * Idempotency guarantee through `notification_logs`.
* **Moderator Webhook Management Drawer (`src/components/ModDrawer.tsx`):**
  * Added 4th tab: `"Discord Webhook"` with live environment connection status, masked URL preview, custom override input, "Send Test Bedtime Embed", and "Post Morning Digest Now" buttons.
  * Created `src/app/api/mod/webhook/route.ts` with moderator passcode & role authentication.
* **"Nagged!" Community Assist Counter:**
  * Created `POST /api/members/nag-assist` and `GET /api/members/nag-assist`.
  * Enforces helper deduplication per sleeper per local date via `notification_logs` constraint (`NAG_ASSIST:<helper>`).
  * Added `nag_assists_count` hydration in `GET /api/members`.
  * Added live assist counter badge on `BEDTIME_NOW` cards (`"👥 X friends checked in tonight 🦊"`).
  * Added optimistic UI assist recording and micro-feedback when community members click "Nag in Discord Journal".
* **Verification Suite (`scripts/test-discord-webhook-and-assists.mjs`):**
  * Validated Discord URL regex (standard, canary, ptb, rejected invalid).
  * Validated embed colors and Sleep Shield branding.
  * Live Supabase database test for nag assist logging, helper deduplication, and count aggregation.

---

### Phase 9: Weekend Sleep Hours (Friday & Saturday Nights)
* **Custom Weekend Sleep Hours Engine (`src/lib/sleepEngine.ts`):**
  * Added `weekend_bedtime_local` and `weekend_wake_time_local` to support distinct sleep hours for Friday nights and Saturday nights.
  * Added helper functions `isWeekendNight(dt)` (Luxon weekday 5 = Friday, 6 = Saturday) and `getBedtimeForNight(member, dt)`.
  * `getNightBedtimeDateTime`: Seamlessly handles both before-midnight (e.g. `23:45`) and after-midnight (e.g. `01:30` AM into Saturday/Sunday morning) bedtimes.
  * `computeMemberState`: Dynamically identifies the closest candidate bedtime across weekdays vs weekend nights, populates `isWeekendSchedule`, and adjusts `formattedSleeperTime` / `formattedViewerTime`.
  * `checkCooldownPromotion`: Promotes `pending_weekend_bedtime_local` and `pending_weekend_wake_time_local` when the 48-hour cooldown expires.
* **Database & Migration (`src/lib/db.ts`, `supabase/schema.sql`):**
  * Extended `Member` interface and PostgreSQL schema with `weekend_bedtime_local`, `weekend_wake_time_local`, `pending_weekend_bedtime_local`, and `pending_weekend_wake_time_local`.
* **API Endpoints:**
  * `POST /api/members/update-schedule`: Detects changes to weekend schedule; enqueues into 48-hour pending cooldown for regular members; allows immediate moderator override.
  * `POST /api/members/cancel-pending`: Clears pending weekend changes.
  * `GET` & `POST /api/members`: Supports weekend fields in creation and background promotion.
  * `POST /api/mod`: Moderator drawer actions (`approve_pending`, `cancel_cooldown`, `edit_member`, `add_member`) fully support weekend hours.
  * `GET /api/auth/me` & `POST /api/auth/login`: Hydrates authenticated member session with weekend hours.
* **Notification & Webhook Dispatchers (`src/lib/cronDispatcher.ts`, `src/lib/discordWebhook.ts`):**
  * Push alerts and Discord webhook announcements dynamically use that night's effective local bedtime (`state.formattedSleeperTime`).
* **Warm Dark UI Components:**
  * `MyScheduleModal.tsx`: Added Weekend Hours toggle switch and 24h bedtime/wake time inputs with Sleepy Fox helper hint for both Claim/Edit and New Member tabs.
  * `MemberCard.tsx`: Displays `🌙 Weekend` badge when a member is actively on their Friday/Saturday night schedule.
  * `ModDrawer.tsx`: Displays pending weekend diffs in Cooldown Approvals tab, adds weekend controls to Edit & Add Member modals, and shows `🌙 Fri/Sat` pill on Roster cards.
* **Verification Suite (`scripts/test-weekend-hours.mjs`):**
  * 20 automated tests validating day-of-week classification (Friday & Saturday vs Sun-Thu), before/after midnight crossovers, member state machine buckets, and cooldown promotion.

### Phase 10: Critical Security & Data Protection Fixes (Commit `cd2f009`)
* **Credential Stripping (`sanitizeMember` in `src/lib/auth.ts`):**
  * Stripped `passcode_hash` from `GET /api/members`, `POST /api/members`, `/api/members/update-schedule`, `/api/members/cancel-pending`, and `/api/mod`.
  * Added `has_pin?: boolean` property to `Member` interface in `src/lib/db.ts` to expose claimed status without exposing password hashes.
  * Updated UI components (`LoginModal.tsx`, `MyScheduleModal.tsx`, `ModDrawer.tsx`) to check `has_pin`.
* **Secured "I'm In Bed" Check-In (`src/app/api/members/in-bed/route.ts`):**
  * Enforced authorization gate: caller must supply matching authenticated session cookie/token OR valid 4-digit PIN.
  * Rejects unauthenticated check-in/cancellation with HTTP 401; rejects cross-user impersonation with HTTP 403.
  * Updated `handleCheckIn` and `handleCancelInBed` in `page.tsx` to automatically supply bearer auth token and prompt login on 401.
* **Secured Push Subscriptions (`src/app/api/push/subscribe/route.ts`):**
  * Strictly requires active session or verified PIN to bind push tokens to a member.
  * Fixed `PushModal.tsx`: removed arbitrary fallback that defaulted unauthenticated visitors to `members[0].id`.
* **Verification Suite (`scripts/test-phase1-security.mjs`):**
  * Added automated test suite validating credential stripping, anonymous check-in blocking, wrong PIN rejection, cross-user hijacking prevention, and valid session authorization.

### Phase 11: Production Crons & PWA Reliability (Commit `c17bd61`)
* **iOS Safari PWA Icon Fix (`src/app/layout.tsx`):**
  * Updated `apple` touch icon to point to `/icons/icon-192x192.png` instead of `.svg` so iOS Home Screen icon displays correctly.
* **Android PWA Manifest & Adaptive Icons (`public/manifest.json`):**
  * Added `"purpose": "maskable"` and `"purpose": "any"` icon entries, `"id": "/"`, `"scope": "/"`, and categories.
* **Android / Chrome `beforeinstallprompt` Install Flow (`src/components/PwaBanner.tsx`):**
  * Captured `beforeinstallprompt` event and surfaced an active "Install App" banner for Android & desktop Chrome users.
* **Service Worker Offline Caching & Shell (`public/sw.js`):**
  * Added `CACHE_NAME = 'zcatchers-v2'` pre-caching the HTML shell, icons, and manifest.
  * Added `fetch` event handler: network-first for navigation with offline fallback, cache-first for static icons, and strictly network-only for dynamic `/api/*` routes.
* **Cron Dispatcher N+1 Query Elimination (`src/lib/cronDispatcher.ts`):**
  * Batch pre-fetched all recent `IN_BED_EARLY` and dispatch records in a single query; converted `hasBeenDispatched` to an in-memory `O(1)` check. Prevents Vercel serverless 10s function timeouts.
* **Dashboard Auto-Refresh & Focus Sync (`src/app/page.tsx`):**
  * Added 60s periodic polling of `/api/members` and an instant sync on window focus / `visibilitychange` to reflect buddies' check-ins and bedtime shifts in real-time.
* **External Cron Fallback (`.github/workflows/cron-dispatcher.yml`):**
  * Created scheduled GitHub Actions runner hitting `/api/cron/dispatch-notifications` every 5 minutes as a free cron fallback for Vercel Hobby deployments.
* **Production Passcode Protection (`src/lib/auth.ts`):**
  * Disabled hardcoded `'cozyfox2026'` default passcode when `NODE_ENV === 'production'`. Requires `MOD_SECRET_PASSCODE` in production.
* **Updated Environment Template (`.env.example`):**
  * Documented `CRON_SECRET`, `DISCORD_COMMUNITY_WEBHOOK_URL`, `SESSION_SECRET`, and `PIN_SALT`.

### Phase 12: Self-Service Profile Registration & Username PIN Authentication (Commit `75101e8`)
* **Self-Service Registration Engine (`src/app/api/members/route.ts`, `src/app/api/auth/register/route.ts`):**
  * Enables friends to directly register their own profiles with username, Discord handle, bedtime, wake time, timezone (auto-detected), Discord journal link, optional weekend sleep schedule, and 4-to-6 digit numeric PIN.
  * Enforces case-insensitive username uniqueness check (`discord_username ILIKE $1`) preventing duplicate or conflicting profiles.
  * Implements resilient insertion fallback: gracefully saves member record even if optional weekend schema columns are not yet applied in the database schema cache.
  * Generates 30-day HMAC-SHA256 session token and sets HttpOnly `zcatchers_session` cookie; returns sanitized profile and session token for immediate automatic authentication without an extra manual claim step.
* **Username-Based Authentication (`src/app/api/auth/login/route.ts`):**
  * Supports authenticating by either case-insensitive `username` or `member_id` alongside the 4-to-6 digit numeric PIN.
  * Allows first-time PIN claiming for legacy or unclaimed profiles; verifies PIN with salted SHA-256 for claimed members.
* **Pre-Seeded Data Cleanup & Admin Tools:**
  * Purged the 4 initial demo seed profiles (`Aoi`, `SarahK`, `Marcus`, `Arjun`) from the live Supabase database.
  * Added `scripts/purge-demo-members.mjs` and `scripts/seed-demo-members.mjs` for one-command maintenance.
  * Added `purge_seed_members` action in `src/app/api/mod/route.ts` and surfaced a "Purge Demo Profiles" button in `ModDrawer.tsx` with confirmation dialog.
* **Warm Dark Empty State & Onboarding UX (`src/app/page.tsx`, `src/components/LoginModal.tsx`, `src/components/Header.tsx`):**
  * Built empty den onboarding hero on `page.tsx`: when `members.length === 0`, displays a welcoming card with Sleepy Fox mascot and a 1-click CTA button `"Join Den & Create Profile"`.
  * Redesigned `LoginModal.tsx` with segmented tabs: `"Log In"` (username input or roster picker + PIN) and `"Join Den (Create Profile)"` (complete onboarding form with auto-detected timezone, live bedtime preview, and sample journal URL button).
  * Enhanced `Header.tsx`: surfaces `"Join Den"` (accent amber button) and `"Log In"` buttons when unauthenticated; displays `@username` session pill when logged in.
  * Mobile Bottom Navigation: added Join/Profile tab for direct access on mobile devices.
* **Verification & Test Suite:**
  * Created `scripts/test-signup-and-profiles.mjs` validating self-service registration, PIN hashing, case-insensitive lookup, duplicate username rejection, and session token validation.
  * Updated `test-e2e-api-endpoints.mjs`, `test-in-bed-and-streaks.mjs`, and `test-discord-webhook-and-assists.mjs` to dynamically create and clean up temporary test records, ensuring 100% test pass rates on clean/empty databases.

---

## 5. Current File Tree & Key Components

```text
d:\Projects\Z Catchers\
├── .github/
│   ├── workflows/
│   │   ├── jira-sync.yml               # Syncs GitHub events to Jira
│   │   └── jira-transition.yml         # Auto-transitions Jira issues on push
│   └── scripts/
│       └── sync-github-to-jira.mjs     # Jira remote link integration
├── public/
│   ├── icons/
│   │   ├── badge-72x72.png             # Crisp notification badge
│   │   ├── icon-192x192.png            # App & push notification icon (192x192)
│   │   ├── icon-512x512.png            # Splash & PWA icon (512x512)
│   │   └── icon.svg                    # Vector Sleepy Fox mascot icon
│   ├── manifest.json                   # PWA web manifest
│   └── sw.js                           # Service worker handling push & Discord deep linking
├── scripts/
│   ├── create-and-sync-issues.mjs      # Creates ZC-1 to ZC-12 issues in Jira
│   ├── test-discord-webhook-and-assists.mjs # Discord Webhook & Nag Assist unit & live DB tests
│   ├── test-e2e-api-endpoints.mjs      # Live DB & Sleep Shield integration tests
│   ├── test-in-bed-and-streaks.mjs     # Check-in, anti-spam & streak unit tests
│   ├── test-login-and-auth.mjs         # Member PIN login, session token & profile binding tests
│   ├── test-push-and-cron.mjs          # Push engine & cron Sleep Shield tests
│   ├── test-schedule-cooldown.mjs      # Verification tests for 48h cooldown logic
│   └── transition-jira-issue.mjs       # Script invoked by GitHub Action to transition issues
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth/
│   │   │   │   ├── login/route.ts      # POST verify/claim 4-digit PIN & issue session cookie
│   │   │   │   ├── logout/route.ts     # POST clear session cookie
│   │   │   │   └── me/route.ts         # GET current authenticated member session
│   │   │   ├── cron/
│   │   │   │   ├── route.ts            # Alias dispatcher endpoint
│   │   │   │   └── dispatch-notifications/
│   │   │   │       └── route.ts        # 1-minute cron notification dispatcher
│   │   │   ├── members/
│   │   │   │   ├── route.ts            # GET roster (with streaks, checkins & nag assists), POST member
│   │   │   │   ├── cancel-pending/     # POST cancel pending schedule change
│   │   │   │   ├── in-bed/
│   │   │   │   │   └── route.ts        # POST / GET "I'm in Bed" check-in & undo
│   │   │   │   ├── nag-assist/
│   │   │   │   │   └── route.ts        # POST / GET "Nagged!" community assist counter & deduplication
│   │   │   │   └── update-schedule/    # POST request schedule change (48h queue)
│   │   │   ├── mod/
│   │   │   │   ├── route.ts            # Moderator action dispatcher (approve, reject, pin reset)
│   │   │   │   ├── members/route.ts    # Moderator member CRUD
│   │   │   │   └── webhook/route.ts    # Moderator Discord webhook test & morning digest trigger
│   │   │   └── push/
│   │   │       ├── subscribe/route.ts  # POST link device push subscription
│   │   │       ├── test/route.ts       # POST send test alert & dead token pruning
│   │   │       └── unsubscribe/route.ts# POST remove push subscription
│   │   ├── globals.css                 # Warm dark theme CSS variables & Tailwind directives
│   │   ├── layout.tsx                  # Root layout with warm dark bg, metadata, PWA links
│   │   └── page.tsx                    # Responsive dashboard (Desktop grid + Mobile PWA)
│   ├── components/
│   │   ├── FoxMascot.tsx               # Minimalist Sleepy Fox mascot vector states
│   │   ├── Header.tsx                  # Top desktop command bar & mobile top bar
│   │   ├── LoginModal.tsx              # Member 4-digit PIN login & profile claiming modal
│   │   ├── MemberCard.tsx              # Dual-tz card, streak badge, "I'm in Bed" button, Nag assist counter & Star
│   │   ├── ModDrawer.tsx               # Moderator drawer with approvals, roster, add member, and Discord webhook
│   │   ├── MyScheduleModal.tsx         # Self-service edit modal with check-in card & PIN verification
│   │   ├── PushModal.tsx               # Push notification preferences & Sleep Shield modal
│   │   ├── PwaBanner.tsx               # iOS/Android PWA install instructions & push gate
│   │   └── StatusBucket.tsx            # Bucket container (Nag Now, Winding Down, Awake, Sleeping)
│   └── lib/
│       ├── auth.ts                     # Moderator passcode & PIN hashing/verification & sessions
│       ├── cronDispatcher.ts           # Core cron dispatch, early check-in suppression, Discord webhook & Sleep Shield
│       ├── db.ts                       # Supabase client & TypeScript data models
│       ├── discordWebhook.ts           # Discord webhook API client, embed formatters, and color tokens
│       ├── pushClient.ts               # Client-side Web Push & service worker registration
│       ├── pushServer.ts               # Web Push VAPID helper functions & error handling
│       └── sleepEngine.ts              # Luxon timezone calculations, streaks & milestone badges
├── .coderabbit.yaml                    # CodeRabbit AI code review configuration & guardrails
├── AGENT_RULES.md                      # Hard guardrails & architectural constraints for AI agents
├── AGENTS.md                           # Multi-agent directives & handoff protocol
├── BACKEND_TZ_PWA_SPEC.md              # Technical specification for backend, timezones, & PWA
├── DESIGN_SYSTEM.md                    # Visual tokens, Warm Dark palette, & mascot specs
├── HANDOFF.md                          # (This file) Complete handoff & project state log
├── PROJECT_SPEC.md                     # Master project roadmap & Jira milestone specifications
├── tailwind.config.ts                  # Tailwind configuration with warm dark colors
└── vercel.json                         # Vercel 1-minute automated cron deployment config
```

---

## 6. Current Status of Jira Tasks & Milestones

| Issue Key | Summary / Milestone | Status | Completed In |
|---|---|---|---|
| **ZC-1** | Epic: Phase 1 MVP Core Application | DONE | MVP Complete |
| **ZC-2** | Phase 1.1: Database Schema & Supabase Configuration | DONE | Commit `a7d7d29` |
| **ZC-3** | Phase 1.2: Luxon Sleep Engine & Cross-Timezone Calculations | DONE | Commit `a7d7d29` |
| **ZC-4** | Phase 1.3: Warm Dark Mobile Dashboard UI & Status Buckets | DONE | Commit `733ea23` |
| **ZC-5** | Phase 1.4: Self-Service Schedule Edit Modal & 48h Cooldown | DONE | Commit `46025db` |
| **ZC-6** | Phase 1.5: Web Push Notification Engine & Service Worker | DONE | Commit `fee9f22` |
| **ZC-7** | Phase 1.6: 1-Minute Cron Dispatcher & Sleep Shield Guardrail | DONE | Commit `fee9f22` |
| **ZC-8** | Epic: Phase 2 Moderation & Anti-Dodge Controls | **DONE** | Commit `f8ddcb2` |
| **ZC-9** | Phase 2.1: Passcode-Protected Moderator Drawer (`ModDrawer.tsx`)| DONE | Commit `d66de1f` / `4339402` |
| **ZC-10**| Phase 2.2: Instant Cooldown Override & Roster Admin API | DONE | Commit `a3fc7fa` |
| **ZC-13**| Phase 2.3: Simple Member PIN Login & Session Profile Binding | **DONE** | ZC-13 / Milestone 6 |
| **ZC-11**| Epic: Phase 3 Sleep Streaks, Badges & Discord Webhooks | **DONE** | Phase 8 Complete |
| **ZC-12**| Phase 3.1: Bedtime Compliance Scoring & Streak Tracking | **DONE** | Phase 5 / Phase 8 |
| **ZC-13**| Phase 3.2: Automated Discord Channel Webhooks & Nag Assists | **DONE** | Phase 8 Complete |

---

## 7. Immediate Next Steps (For the Next Agent / Session)

All core features, Phase 10 security hardening, and Phase 11 PWA reliability/crons are complete. The codebase is now ready for production deployment and user testing.

1. **Production Environment Configuration:**
   * Set required production environment variables: `DISCORD_COMMUNITY_WEBHOOK_URL`, `CRON_SECRET`, `MOD_SECRET_PASSCODE`, `SESSION_SECRET`, `PIN_SALT`.
   * Configure 1-minute cron ping (e.g. cron-job.org or GitHub Actions fallback) if deploying on Vercel Hobby.
2. **Community Roster & Friend Onboarding:**
   * Demo profiles have been purged from Supabase. Friends can now visit the app URL directly, click **"Join Den"**, input their username, local bedtime, auto-detected timezone, Discord journal thread link, and 4-digit PIN.
   * To restore demo seed profiles for staging/testing at any time, run `node --env-file=.env.local scripts/seed-demo-members.mjs`.



3. **Verification Checklist:**
   * Always verify `npx tsc --noEmit` and `npm run build` pass with 0 errors.
   * Always keep changes on branch `krish`.
   * Update `HANDOFF.md` at the conclusion of every turn/task.

---

## 8. Non-Negotiable Guardrails Summary (Reminder for Future Agents)

* **Branch:** Always commit to `krish`. Do not push directly to `main` or `dev`.
* **Date Math:** Always use `luxon`. Never use native JS `new Date().getTimezoneOffset()`.
* **Cooldown:** Regular members can NEVER immediately change their schedule. Changes take 48 hours. Only moderator passcode bypasses this.
* **Sleep Shield:** Never notify a user who is within 8 hours after their bedtime (or within 15 minutes before, or who has checked into bed early).
* **Discord URLs:** Must match `^https:\/\/(ptb\.|canary\.)?discord\.com\/channels\/\d+\/\d+(\/\d+)?$`.
* **Handoff:** Update `HANDOFF.md` at the conclusion of every turn/task.
