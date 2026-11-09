# Project Handoff Document: Z Catchers (`HANDOFF.md`)

> **Last Updated:** 2026-11-09T22:20:00+05:30  
> **Active Working Branch:** `krish`  
> **Target Integration Branch:** `dev`  
> **Production Branch:** `main`  
> **Build Status:** Passing (`tsc --noEmit` clean, 0 errors | Next.js production build passing)

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
   * 💤 **Asleep (Zzz):** 60 to 480 minutes (8 hours) after bedtime.
3. **Anti-Dodge Governance (48-Hour Cooldown):** To prevent members from pushing back their bedtime right before midnight to avoid being nagged, any self-service schedule change is queued in a **48-hour pending state** before taking effect. Moderators can instantly override or approve pending changes via a passcode-protected drawer.
4. **Sleep Shield Guarantee:** Awake members receive nag alerts to check on friends, but the system **never** sends notifications to anyone currently inside their personal 8-hour sleep window.

---

## 2. Technology Stack & Architecture

| Layer | Technology | Details / Notes |
|---|---|---|
| **Framework** | Next.js 15 (App Router) + React 19 | Server & Client components, App directory structure |
| **Language** | TypeScript 5.7 (Strict mode) | Strict typing across all entities and calculations |
| **Styling & Tokens** | Tailwind CSS 3.4 | Warm Dark low-blue-light palette (`#120F0D` night bg, `#1C1714` surface, `#F5EBE1` cream text) |
| **Icons** | Lucide React | Clean, minimalist icons matching dark aesthetic |
| **Timezone Math** | Luxon 3.5 | Strict IANA timezone math with DST resilience and midnight wrap-around support |
| **Database** | Supabase (PostgreSQL) | Managed tables: `members`, `push_subscriptions`, `notification_logs` |
| **Push Notifications** | Web Push API (`web-push` npm) | VAPID key pairs, multi-device support per member, service worker deep linking |
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
  * Added active badge indicators and auto-refresh on modal close.

### Phase 4: Web Push Notification Engine & 1-Minute Cron Dispatcher (Current Session)
* **Web Push Engine & Service Worker (`ZC-6` / Phase 1.5):**
  * Enhanced `public/sw.js` with `skipWaiting()`, `clients.claim()`, rich notification formatting (badge, mascot icon, vibration pattern), and `notificationclick` deep linking directly to Discord journal threads or app window.
  * Generated high-resolution PWA icons from vector SVG: `public/icons/icon-192x192.png`, `public/icons/icon-512x512.png`, `public/icons/badge-72x72.png`.
  * Implemented `src/lib/pushServer.ts` with typed error handling and auto-pruning detection for HTTP 404/410 expired subscriptions.
  * Implemented `src/lib/pushClient.ts` with VAPID ArrayBuffer conversion, service worker registration, push subscription, unsubscribe, and local storage synchronization.
  * Created Push API routes:
    * `POST /api/push/subscribe` — Links device push subscription to member profile in `push_subscriptions`.
    * `POST /api/push/unsubscribe` — Removes device endpoint from `push_subscriptions`.
    * `POST /api/push/test` — Sends real-time test notification to verify device delivery.
  * Built `src/components/PushModal.tsx` allowing community members to link their profile, configure personal/community alert preferences, view Sleep Shield status, and trigger test alerts.
  * Wired `Header.tsx`, `PwaBanner.tsx`, and mobile bottom navigation bar in `src/app/page.tsx` to automatically register the service worker on mount, inspect existing subscriptions, and open `PushModal`.
  * Updated `MyScheduleModal.tsx` to automatically store and sync claimed member ID with active push subscriptions.
* **1-Minute Cron Dispatcher & Sleep Shield Guardrail (`ZC-7` / Phase 1.6):**
  * Implemented pure dispatcher logic in `src/lib/cronDispatcher.ts`:
    * Step 1: Self-healing 48-hour schedule cooldown promotion before notification evaluation.
    * Step 2: Idempotent T-30m wind-down trigger (`WIND_DOWN_30M`) using `notification_logs`.
    * Step 3: Idempotent T-0m bedtime hit trigger (`BEDTIME_HIT`) using `notification_logs`.
    * Step 4: Personal push dispatch to the sleeper.
    * Step 5: **Strict Sleep Shield Enforcement**: Checks every peer's status in their own local timezone. If peer is asleep (`SLEEPING` bucket, 60m to 480m after bedtime) or winding down within 15m of bedtime, nag notifications are **strictly suppressed**.
    * Step 6: Automatic database pruning of dead push subscriptions (HTTP 404/410).
  * Created API endpoints `/api/cron/dispatch-notifications/route.ts` and `/api/cron/route.ts` supporting GET and POST, dry-run mode, and secret token authorization.
  * Built automated verification suites:
    * `scripts/test-push-and-cron.mjs` — Verifies minute windows, Sleep Shield suppression filtering, and 48h cooldown promotion.
    * `scripts/test-e2e-api-endpoints.mjs` — Live test against Supabase database checking member retrieval, push subscription upsert/delete, unique constraint idempotency in `notification_logs`, and live Sleep Shield calculation.

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
│   ├── test-push-and-cron.mjs          # Push engine & cron Sleep Shield tests
│   ├── test-schedule-cooldown.mjs      # Verification tests for 48h cooldown logic
│   └── transition-jira-issue.mjs       # Script invoked by GitHub Action to transition issues
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── cron/
│   │   │   │   ├── route.ts            # Alias dispatcher endpoint
│   │   │   │   └── dispatch-notifications/
│   │   │   │       └── route.ts        # 1-minute cron notification dispatcher
│   │   │   ├── members/
│   │   │   │   ├── route.ts            # GET roster (with auto 48h promotion), POST member
│   │   │   │   ├── cancel-pending/     # POST cancel pending schedule change
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
│   │   ├── MemberCard.tsx              # Dual-timezone member card with countdown & nag button
│   │   ├── ModDrawer.tsx               # Moderator bottom sheet / dialog with passcode lock
│   │   ├── MyScheduleModal.tsx         # Self-service edit modal with PIN verification
│   │   ├── PushModal.tsx               # Push notification preferences & Sleep Shield modal
│   │   ├── PwaBanner.tsx               # iOS/Android PWA install instructions & push gate
│   │   └── StatusBucket.tsx            # Bucket container (Nag Now, Winding Down, Awake, Sleeping)
│   └── lib/
│       ├── auth.ts                     # Moderator passcode & PIN hashing/verification
│       ├── cronDispatcher.ts           # Core cron dispatch & Sleep Shield engine
│       ├── db.ts                       # Supabase client & TypeScript data models
│       ├── pushClient.ts               # Client-side Web Push & service worker registration
│       ├── pushServer.ts               # Web Push VAPID helper functions & error handling
│       └── sleepEngine.ts              # Pure Luxon timezone calculations & bucket classifier
├── AGENT_RULES.md                      # Hard guardrails & architectural constraints for AI agents
├── AGENTS.md                           # Multi-agent directives & handoff protocol
├── BACKEND_TZ_PWA_SPEC.md              # Technical specification for backend, timezones, & PWA
├── DESIGN_SYSTEM.md                    # Visual tokens, Warm Dark palette, & mascot specs
├── HANDOFF.md                          # (This file) Complete handoff & project state log
├── PROJECT_SPEC.md                     # Master project roadmap & Jira milestone specifications
└── tailwind.config.ts                  # Tailwind configuration with warm dark colors
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
| **ZC-6** | Phase 1.5: Web Push Notification Engine & Service Worker | **DONE** | Current Session |
| **ZC-7** | Phase 1.6: 1-Minute Cron Dispatcher & Sleep Shield Guardrail | **DONE** | Current Session |
| **ZC-8** | Epic: Phase 2 Moderation & Anti-Dodge Controls | IN PROGRESS | Ongoing |
| **ZC-9** | Phase 2.1: Passcode-Protected Moderator Drawer (`ModDrawer.tsx`)| DONE | Commit `d66de1f` / `4339402` |
| **ZC-10**| Phase 2.2: Instant Cooldown Override & Roster Admin API | DONE | Commit `a3fc7fa` |
| **ZC-11**| Epic: Phase 3 Sleep Streaks, Badges & Discord Webhooks | TODO | Phase 3 |

---

## 7. Immediate Next Steps (For the Next Agent / Session)

Phase 1 MVP is now fully complete (ZC-1 through ZC-7, plus ZC-9 and ZC-10 from Phase 2). The next priorities for development are:

1. **Jira Issue ZC-11 (Epic: Phase 3 Sleep Streaks, Badges & Discord Webhooks):**
   * **Sleep Streaks:** Track consecutive days where bedtime was honored (check-in via Discord journal or app).
   * **Discord Webhook Notifications:** Post periodic den summaries or bedtime callouts into a designated community channel via Discord incoming webhooks.
   * **Mascot Badges:** Add visual achievement badges for 3-day, 7-day, and 30-day consistent bedtime streaks on `MemberCard.tsx`.
2. **Cron Scheduling Deployment:**
   * Configure `vercel.json` crons or an external cron caller (e.g. GitHub Actions schedule or cron-job.org) hitting `/api/cron/dispatch-notifications` every 1 minute with `CRON_SECRET`.
3. **Verification Checklist:**
   * Always verify `npx tsc --noEmit` and `npm run build` pass with 0 errors.
   * Always keep changes on branch `krish`.
   * Update `HANDOFF.md` at the conclusion of every turn/task.

---

## 8. Non-Negotiable Guardrails Summary (Reminder for Future Agents)

* **Branch:** Always commit to `krish`. Do not push directly to `main` or `dev`.
* **Date Math:** Always use `luxon`. Never use native JS `new Date().getTimezoneOffset()`.
* **Cooldown:** Regular members can NEVER immediately change their schedule. Changes take 48 hours. Only moderator passcode bypasses this.
* **Sleep Shield:** Never notify a user who is within 8 hours after their bedtime (or within 15 minutes before).
* **Discord URLs:** Must match `^https:\/\/(ptb\.|canary\.)?discord\.com\/channels\/\d+\/\d+(\/\d+)?$`.
* **Handoff:** Update `HANDOFF.md` at the conclusion of every turn/task.
