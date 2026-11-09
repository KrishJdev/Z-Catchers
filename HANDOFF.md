# Project Handoff Document: Z Catchers (`HANDOFF.md`)

> **Last Updated:** 2026-11-09T22:05:00+05:30  
> **Active Working Branch:** `krish`  
> **Target Integration Branch:** `dev`  
> **Production Branch:** `main`  
> **Latest Commit:** `e919117`  
> **Build Status:** Passing (`tsc --noEmit` clean, 0 errors)

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
| **Push Notifications** | Web Push API (`web-push` npm) | VAPID key pairs, multi-device support per member |
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

### Phase 4: Handoff Protocol & Agent Directives Setup
* **Current Session:**
  * Verified that no handoff file was previously maintained in the repository.
  * Created comprehensive `HANDOFF.md` capturing the entire project evolution from scaffold to current state.
  * Added Section 8 ("Mandatory Handoff Protocol") to [`AGENT_RULES.md`](./AGENT_RULES.md).
  * Created [`AGENTS.md`](./AGENTS.md) establishing core agent operating guidelines, non-negotiable technical constraints, and mandatory post-task handoff record-keeping.

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
├── scripts/
│   ├── create-and-sync-issues.mjs      # Creates ZC-1 to ZC-12 issues in Jira
│   ├── test-schedule-cooldown.mjs      # Verification tests for 48h cooldown logic
│   └── transition-jira-issue.mjs       # Script invoked by GitHub Action to transition issues
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── members/
│   │   │   │   ├── route.ts            # GET roster (with auto 48h promotion), POST member
│   │   │   │   ├── cancel-pending/     # POST cancel pending schedule change
│   │   │   │   └── update-schedule/    # POST request schedule change (48h queue)
│   │   │   └── mod/
│   │   │       ├── route.ts            # Moderator action dispatcher (approve, reject, pin reset)
│   │   │       └── members/route.ts    # Moderator member CRUD
│   │   ├── globals.css                 # Warm dark theme CSS variables & Tailwind directives
│   │   ├── layout.tsx                  # Root layout with warm dark bg, metadata, PWA links
│   │   └── page.tsx                    # Responsive dashboard (Desktop grid + Mobile PWA)
│   ├── components/
│   │   ├── FoxMascot.tsx               # Minimalist Sleepy Fox mascot vector states
│   │   ├── Header.tsx                  # Top desktop command bar & mobile top bar
│   │   ├── MemberCard.tsx              # Dual-timezone member card with countdown & nag button
│   │   ├── ModDrawer.tsx               # Moderator bottom sheet / dialog with passcode lock
│   │   ├── MyScheduleModal.tsx         # Self-service edit modal with PIN verification
│   │   ├── PwaBanner.tsx               # iOS/Android PWA install instructions & push gate
│   │   └── StatusBucket.tsx            # Bucket container (Nag Now, Winding Down, Awake, Sleeping)
│   └── lib/
│       ├── auth.ts                     # Moderator passcode & PIN hashing/verification
│       ├── db.ts                       # Supabase client & TypeScript data models
│       ├── pushServer.ts               # Web Push VAPID helper functions
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
| **ZC-1** | Epic: Phase 1 MVP Core Application | IN PROGRESS | Ongoing |
| **ZC-2** | Phase 1.1: Database Schema & Supabase Configuration | DONE | Commit `a7d7d29` |
| **ZC-3** | Phase 1.2: Luxon Sleep Engine & Cross-Timezone Calculations | DONE | Commit `a7d7d29` |
| **ZC-4** | Phase 1.3: Warm Dark Mobile Dashboard UI & Status Buckets | DONE | Commit `733ea23` |
| **ZC-5** | Phase 1.4: Self-Service Schedule Edit Modal & 48h Cooldown | DONE | Commit `46025db` |
| **ZC-6** | Phase 1.5: Web Push Notification Engine & Service Worker | **TODO** | *Next Priority* |
| **ZC-7** | Phase 1.6: 1-Minute Cron Dispatcher & Sleep Shield Guardrail | **TODO** | *Next Priority* |
| **ZC-8** | Epic: Phase 2 Moderation & Anti-Dodge Controls | IN PROGRESS | Ongoing |
| **ZC-9** | Phase 2.1: Passcode-Protected Moderator Drawer (`ModDrawer.tsx`)| DONE | Commit `d66de1f` / `4339402` |
| **ZC-10**| Phase 2.2: Instant Cooldown Override & Roster Admin API | DONE | Commit `a3fc7fa` |
| **ZC-11**| Epic: Phase 3 Sleep Streaks, Badges & Discord Webhooks | TODO | Phase 3 |

---

## 7. Immediate Next Steps (For the Next Agent / Session)

The next upcoming milestone is **Phase 1.5 & Phase 1.6: Web Push Notification Engine & Cron Dispatcher**:

1. **Jira Issue ZC-6 (Phase 1.5: Web Push Notification Engine & Service Worker):**
   * Register service worker in `public/sw.js`.
   * Add push notification event listener to `sw.js` handling payload title, body, mascot badge/icon, and `notificationclick` deep-linking to the Discord journal URL.
   * Configure `/api/push/subscribe` and `/api/push/test` using `src/lib/pushServer.ts` and VAPID keys.
   * Connect `PwaBanner.tsx` and the notification bell in `Header.tsx` to the browser's `Notification.requestPermission()` and service worker push subscription.
2. **Jira Issue ZC-7 (Phase 1.6: 1-Minute Cron Dispatcher & Sleep Shield Guardrail):**
   * Create `/api/cron/dispatch-notifications/route.ts`.
   * Implement Algorithm 5.3 from `PROJECT_SPEC.md` and `BACKEND_TZ_PWA_SPEC.md`:
     * Query all members whose local time is at $T-30$ (wind down) or $T-0$ (bedtime hit).
     * Check `notification_logs` for `(member_id, notification_type, local_date)` to ensure strict idempotency.
     * When $T-0$ hits, notify awake members to nag the sleeper.
     * **Enforce Sleep Shield:** Strictly verify `isSleepShieldActive` is `false` for any recipient before delivering a notification.
3. **Verification:**
   * Run `npx tsc --noEmit` to confirm zero type errors.
   * Update `HANDOFF.md` and transition Jira issues upon completion.

---

## 8. Non-Negotiable Guardrails Summary (Reminder for Future Agents)

* **Branch:** Always commit to `krish`. Do not push directly to `main` or `dev`.
* **Date Math:** Always use `luxon`. Never use native JS `new Date().getTimezoneOffset()`.
* **Cooldown:** Regular members can NEVER immediately change their schedule. Changes take 48 hours. Only moderator passcode bypasses this.
* **Sleep Shield:** Never notify a user who is within 8 hours after their bedtime.
* **Discord URLs:** Must match `^https:\/\/(ptb\.|canary\.)?discord\.com\/channels\/\d+\/\d+(\/\d+)?$`.
* **Handoff:** Update `HANDOFF.md` at the conclusion of every turn/task.
