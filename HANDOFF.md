# Project Handoff Document: Z Catchers (`HANDOFF.md`)

> **Last Updated:** 2026-11-09T23:25:00+05:30  
> **Active Working Branch:** `krish`  
> **Target Integration Branch:** `dev`  
> **Production Branch:** `main`  
> **Latest Commit:** `d324d2b`  
> **Build Status:** Passing (`tsc --noEmit` clean, 0 errors | Next.js production build passing with 18 routes)

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
  * Actions implemented:
    * `approve_pending` — Immediately promotes a pending schedule bypass cooldown.
    * `reject_pending` — Discards a pending schedule change.
    * `create_member` — Moderator adds a new member with name, timezone, bedtime, wake time, and Discord URL.
    * `update_member` — Moderator updates any field directly with immediate effect.
    * `delete_member` — Moderator removes member from active roster.
    * `reset_pin` — Moderator clears or overrides a forgotten 4-digit PIN.
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
* **Sleep Consistency Streaks & Mascot Badges (`ZC-11` / Phase 3.1):**
  * Implemented pure `calculateSleepStreak(checkinDates, sleeperNow)` in `src/lib/sleepEngine.ts` calculating consecutive check-in days.
  * Implemented `getStreakMilestoneBadge()` awarding visual mascot badges:
    * 👑 30-Day Master: Grand Slumber Fox
    * 🥇 14-Day Guard: Night Guardian Fox
    * 🥈 7-Day Dreamer: Dream Weaver Fox
    * 🥉 3-Day Cozy: Cozy Den Kit
    * 🔥 1-Day: First Snooze
  * Displayed badge and streak pill on `MemberCard.tsx` and inside `MyScheduleModal.tsx`.
* **Selective Buddy Watchlist System (Phase 2):**
  * Added star toggle (`⭐`) to every member card, persisting starred members in localStorage.
  * Added dashboard filter pill: `"All Den (N)"` vs `"Starred Buddies (M)"`.
* **Vercel Cron Deployment (`vercel.json`):**
  * Added `vercel.json` configuring 1-minute cron trigger to `/api/cron/dispatch-notifications`.
* **Verification Suite (`scripts/test-in-bed-and-streaks.mjs`):**
  * Unit tested streak counting across contiguous dates, gap dates, and today/yesterday boundaries.
  * Verified state machine transitions from `WINDING_DOWN` / `BEDTIME_NOW` to `SLEEPING` on early check-in.
  * Live tested Supabase database idempotency for `IN_BED_EARLY`.

### Phase 6: CodeRabbit AI Code Review Integration (Commit `d06d81f`)
* **CodeRabbit Configuration (`.coderabbit.yaml`):**
  * Configured `.coderabbit.yaml` adhering to CodeRabbit v2 schema (`https://coderabbit.ai/integrations/schema.v2.json`).
  * Set up automated code review triggers on PRs targeting `dev`, `main`, and `krish` branches.
  * Embedded non-negotiable architectural commandments (`AGENT_RULES.md`) directly into `path_instructions`:
    * `src/lib/sleepEngine.ts`: Luxon `DateTime` only, no native JS `getTimezoneOffset()`, midnight wrap-around safety.
    * `src/app/api/members/**`: 48-Hour Cooldown queue enforcement, 4-digit PIN authentication, Discord journal URL regex validation.
    * `src/app/api/mod/**`: `MOD_SECRET_PASSCODE` authorization checks.
    * `src/app/api/cron/**`: Sleep Shield guarantee (never ping sleeping members), idempotency via `notification_logs`.
    * `src/components/**`: Warm Dark low-blue-light design system (`#120F0D`, `#1C1714`, `#F5EBE1`), responsive dual-layout (mobile stack + desktop grid).
    * `src/lib/pushServer.ts`: VAPID security & dead token handling.
  * Enabled static analysis tools: `github-checks`, `gitleaks` (Betterleaks secret detection), `dotenvLint`, `markdownlint`, `reactDoctor` (React correctness & a11y), and `osvScanner` (vulnerability scanning).
  * Connected Jira knowledge base (`project_keys: ["ZC"]`) and coding guidelines scanner for `AGENTS.md`, `AGENT_RULES.md`, `DESIGN_SYSTEM.md`, `BACKEND_TZ_PWA_SPEC.md`, and `PROJECT_SPEC.md`.

### Phase 7: Simple Member PIN Login & Profile Session Binding (`ZC-13`)
* **HMAC-SHA256 Session Engine (`src/lib/auth.ts`):**
  * Built self-contained cryptographic session token generation (`createSessionToken`) and verification (`verifySessionToken`) with 30-day expiration and timing-safe signature comparison.
  * Added `getRequestSessionMemberId` reading `Authorization: Bearer <token>` or `zcatchers_session` cookie.
* **Authentication API Endpoints:**
  * `POST /api/auth/login`: Handles 4-digit PIN verification or initial account claim; issues signed session token and sets `HttpOnly` cookie.
  * `GET /api/auth/me`: Validates active cookie/bearer session and returns sanitized member profile (`has_pin`).
  * `POST /api/auth/logout`: Clears the session cookie and client tokens.
* **Push Subscription Security Enforcement (`src/app/api/push/subscribe/route.ts`):**
  * Bound Web Push endpoints directly to authenticated sessions, preventing unauthorized cross-member push subscription impersonation.
* **Warm Dark Login Modal (`src/components/LoginModal.tsx`):**
  * Built cozy dialog / sheet with Sleepy Fox mascot for member selection, PIN entry, first-time claim, account status, and logout.
* **Frontend & Navigation Integration:**
  * Added logged-in user display to desktop `Header.tsx` (`@{currentUser.discord_username}`) and mobile bottom navigation tab (`You` / `Log In`).
  * Updated `PushModal.tsx` to automatically link push alerts to authenticated profile, prompting login if unauthenticated.
  * Updated `MyScheduleModal.tsx` to pre-select authenticated user.
  * Updated `MemberCard.tsx` so `YOU` badge and "I'm in Bed" button are strictly restricted to authenticated member.
* **Verification Suite (`scripts/test-login-and-auth.mjs`):**
  * Verified PIN hashing, session creation, tampered token rejection, first-time database profile claim, login verification, and push subscription profile binding.

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
│   │   │   │   ├── route.ts            # GET roster (with streaks & checkins), POST member
│   │   │   │   ├── cancel-pending/     # POST cancel pending schedule change
│   │   │   │   ├── in-bed/
│   │   │   │   │   └── route.ts        # POST / GET "I'm in Bed" check-in & undo
│   │   │   │   └── update-schedule/    # POST request schedule change (48h queue)
│   │   │   ├── mod/
│   │   │   │   ├── route.ts            # Moderator action dispatcher (approve, reject, pin reset)
│   │   │   │   └── members/route.ts    # Moderator member CRUD
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
│   │   ├── MemberCard.tsx              # Dual-timezone member card, streak badge, "I'm in Bed" button & Star
│   │   ├── ModDrawer.tsx               # Moderator bottom sheet / dialog with passcode lock
│   │   ├── MyScheduleModal.tsx         # Self-service edit modal with check-in card & PIN verification
│   │   ├── PushModal.tsx               # Push notification preferences & Sleep Shield modal
│   │   ├── PwaBanner.tsx               # iOS/Android PWA install instructions & push gate
│   │   └── StatusBucket.tsx            # Bucket container (Nag Now, Winding Down, Awake, Sleeping)
│   └── lib/
│       ├── auth.ts                     # Moderator passcode & PIN hashing/verification
│       ├── cronDispatcher.ts           # Core cron dispatch, early check-in suppression & Sleep Shield engine
│       ├── db.ts                       # Supabase client & TypeScript data models
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
| **ZC-11**| Epic: Phase 3 Sleep Streaks, Badges & Discord Webhooks | **IN PROGRESS** | Commit `f8ddcb2` |

---

## 7. Immediate Next Steps (For the Next Agent / Session)

Phase 1 and Phase 2 are complete. Phase 3 is underway with Sleep Streaks and Milestone Badges implemented.

1. **Phase 3.2: Automated Discord Channel Webhooks (`ZC-11`):**
   * Implement automated Discord Webhook dispatches to post embeds in a designated Discord announcement channel when bedtime hits or morning wake-up digests are generated.
   * Add webhook URL configuration in `ModDrawer.tsx` or environment variables (`DISCORD_COMMUNITY_WEBHOOK_URL`).
2. **"Nagged!" Assist Counter (Phase 3):**
   * Add a counter tracking how many community members clicked "Nag in Discord Journal" for each sleeper on a given night (`"3 friends checked in tonight"`).
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
