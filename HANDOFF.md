# Project Handoff Document: Z Catchers (`HANDOFF.md`)

> **Last Updated:** 2026-11-11T23:05:00+05:30  
> **Active Working Branch:** `krish`  
> **Target Integration Branch:** `dev`  
> **Production Branch:** `main`  
> **Latest Commit:** cfaa4f8 (in krish)  
> **Merged Integration Pull Requests:** [#14 [MERGED]](https://github.com/KrishJdev/Z-Catchers/pull/14), [#16 [MERGED]](https://github.com/KrishJdev/Z-Catchers/pull/16), [#17 [MERGED]](https://github.com/KrishJdev/Z-Catchers/pull/17), [#18 [MERGED]](https://github.com/KrishJdev/Z-Catchers/pull/18)  
> **Active Integration Pull Request:** [#19 (krish → dev) [OPEN]](https://github.com/KrishJdev/Z-Catchers/pull/19)  
> **Active Production Release Pull Request:** [#15 (dev → main)](https://github.com/KrishJdev/Z-Catchers/pull/15)  
> **Build Status:** Passing (`tsc --noEmit` clean, 0 errors | `npm run build` clean, 29/29 routes | `node scripts/test-login-and-auth.mjs` passed | `node scripts/test-logout-flow.mjs` passed | `node scripts/test-strikes-system.mjs` passed | `node scripts/test-schedule-cooldown.mjs` passed | `node scripts/test-phase1-pwa-push.mjs` passed)

---

## 1. Executive Summary & Project Purpose

**Z Catchers** is a dual-experience application (lightweight mobile Progressive Web App on phones and expansive web dashboard on desktop) built for a cross-timezone Discord community. 

### The Problem Solved:
In an international Discord server with members spanning US, Europe, India, and Australia, members want to hold each other accountable for going to sleep on time. Because everyone is in different timezones, nobody knows when "11:30 PM" occurs for another person without mental math.

### The Core Loop:
1. **Self-Service / Onboarding (`/join`):** New members land on a standalone onboarding page where they set their bedtime in their own local time (24h format), set a 4-digit PIN, and provide their dedicated Discord Journal thread link. Returning foxes can enter their PIN or select from the den list.
2. **Dynamic Dashboard (`/`):** Community members open the app and see everyone's bedtime automatically converted into the **viewer's local timezone**, categorized into 4 live buckets:
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
9. **Monthly Strikes & Metastrikes Accountability System:** Max 3 strikes and 3 excused passes per calendar month, 5-minute grace period after bedtime, 2-vote community verification, and automatic lazy monthly rollover.

---

## 2. Technology Stack & Architecture

| Layer | Technology | Details / Notes |
|---|---|---|
| **Framework** | Next.js 15 (App Router) + React 19 | Server & Client components, App directory structure |
| **Language** | TypeScript 5.7 (Strict mode) | Strict typing across all entities, calculations, and state machines |
| **Styling & Tokens** | Tailwind CSS 3.4 | Warm Dark low-blue-light palette (`#120F0D` night bg, `#1C1714` surface, `#F5EBE1` cream text) |
| **Icons** | Lucide React | Clean, minimalist icons matching dark aesthetic |
| **Timezone Math** | Luxon 3.5 | Strict IANA timezone math with DST resilience and midnight wrap-around support |
| **Database** | Supabase (PostgreSQL) | Managed tables: `members`, `push_subscriptions`, `notification_logs`, `nightly_strike_logs` |
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
  * Pull Requests opened from `krish` target `dev`.
* **Production Branch:** `main`
  * Merged from `dev` after QA.

---

## 4. Comprehensive Task Changelog

### Phase 44: Root Layout Browser Extension Hydration Mismatch Fix
* **Client Attribute Hydration Suppression (`src/app/layout.tsx`):**
  * Added `suppressHydrationWarning` to the root `<html>` and `<body>` elements in [`src/app/layout.tsx`](file:///d:/Projects/Z%20Catchers/src/app/layout.tsx).
  * Resolved the React 19 / Next.js 15 SSR-to-client hydration mismatch error caused by third-party browser extensions (e.g. WebCRX injecting `webcrx` and `webcrx-bridged` attributes onto `<html>` before React loads).
* **Verification Check:**
  * `npx tsc --noEmit` verified clean with 0 errors.
  * `npm run build` verified clean with 29/29 routes compiled and prerendered.
  * Regression test suite passed (`node scripts/test-login-and-auth.mjs`).

### Phase 43: Website Profile Cleanup & Review Remediations (PR #18)
* **Explicit Allowlist Discovery Enforcement (`scripts/purge-old-profiles.mjs`):**
  * Restricted member discovery query to `LEGACY_MEMBER_IDS_TO_PURGE` (`Krish` and `FoxOAuth_1794391141330`), ensuring non-allowlisted community members can never reach the deletion flow.
* **Strict Verification Error Handling (`scripts/purge-old-profiles.mjs`):**
  * Hardened post-purge members count verification to fail explicitly when query errors occur or when remaining count is non-zero, preserving error context.
* **100% Docstring Coverage (`scripts/purge-old-profiles.mjs`):**
  * Added comprehensive JSDoc docstrings for `LEGACY_MEMBER_IDS_TO_PURGE`, `purgeOldProfiles`, and `run` to satisfy the docstring coverage threshold.
* **Verification Check:**
  * Clean execution with `node --env-file=.env.local scripts/purge-old-profiles.mjs` (0 members remaining verified).
  * `npx tsc --noEmit` verified clean with 0 errors.

### Phase 42: Comprehensive Follow-Up CodeRabbit Review Remediations (14/14 Threads Resolved, 27/27 Total on PR #17)
* **Live Allowlist Recheck on Profile Claiming (`src/app/api/auth/claim-profile/route.ts`):**
  * Prevented privilege escalation via cached claim token `payload.isModerator`: caller moderator privileges are now re-checked dynamically against the live `isModDiscordId(payload.discordId)` allowlist at claim time.
  * Corrected `existingLinked` query to select `id, role, is_moderator` and calculate live status rather than trusting stale token claims.
  * Added regression test in `scripts/test-login-and-auth.mjs` verifying that tokens with stale cached `isModerator: true` cannot claim moderator profiles or bypass live authorization checks.
* **Persistent Discord-Scoped Moderator Passcode Rate Limiting (`src/app/api/auth/claim-profile/route.ts`):**
  * Added persistent sliding-window rate limiting scoped to `mod_claim:${payload.discordId}` before `verifyModPasscode`, preventing brute-force attacks against master passcodes during profile claims and returning HTTP 429 when exhausted.
* **Preservation of Database Flag-Only Moderator Roles (`src/app/api/auth/discord/callback/route.ts`):**
  * Updated `isDbMod` calculation to `member.role === 'moderator' || member.is_moderator === true`, preserving database flag-only moderator assignments across Discord OAuth logins.
* **Discord-Linked Cancellation Protection & Atomic Write Guard (`src/app/api/members/cancel-pending/route.ts`):**
  * Blocked PIN cancellations on Discord-linked profiles (`!isModerator && !isSessionOwner && member.discord_id` returns HTTP 403 Forbidden).
  * Guarded cancellation updates with `{ requireUnlinkedDiscord: !isModerator && !isSessionOwner }` to prevent race conditions during concurrent profile claims.
* **Inactive Member Session Rejection (`src/app/api/members/update-schedule/route.ts`, `src/app/api/members/cancel-pending/route.ts`):**
  * Enforced active member checks (`!currentMember.is_active` / `!member.is_active` returns 403) for session owners in schedule update and pending cancellation routes, preserving moderator overrides.
* **Bounded Discord Webhook Network Requests (`src/lib/discordWebhook.ts`):**
  * Added `signal: AbortSignal.timeout(5000)` to all `sendDiscordWebhook` requests, guaranteeing that hanging or slow Discord webhook calls cleanly abort without stalling community strike confirmations.
* **Restored Persistent Rate Limiting on Moderator Webhook Endpoints (`src/app/api/mod/webhook/route.ts`):**
  * Added persistent rate limiting (`checkPinRateLimitPersistent`, `recordPinFailurePersistent`, `resetPinFailurePersistent`) before `verifyModeratorAuthorization` across both GET and POST handlers.
* **UI Moderator Passcode Entry & Label Accessibility (`src/app/join/page.tsx`):**
  * Exposed conditional master moderator passcode input field when claiming an unlinked moderator profile, submitting `mod_passcode` with the claim payload.
  * Associated Profile PIN label with input using matching `htmlFor="claim-profile-pin"` and `id="claim-profile-pin"`.
* **Design System 44px Touch Targets & Notice Cleanliness (`src/components/ModDrawer.tsx`, `src/components/MyScheduleModal.tsx`):**
  * Added `min-h-[44px]` to the session-unlock button in `ModDrawer.tsx` and the secondary `/join` onboarding link in `MyScheduleModal.tsx`.
  * Added `!isOwner` guard to the "Unclaimed Profile: Choose a 4-Digit PIN" notice in `MyScheduleModal.tsx` so verified owners without PINs are not shown inapplicable PIN-claim notices.
* **Live Discord ID Only in Moderator Authorization (`src/lib/auth.ts`):**
  * Updated `verifyModeratorAuthorization` to strictly verify live `isModDiscordId(member.discord_id)`, removing the `session.discordId` fallback.
* **Asynchronous Test Cleanup Persistence (`scripts/test-login-and-auth.mjs`):**
  * Replaced `process.exit(1)` with `process.exitCode = 1` in error/failure blocks to ensure Node executes asynchronous `finally` cleanup.
* **GitHub PR #17 Programmatic Thread Resolution:**
  * Replied to all 14 new review comments with commit references and programmatically resolved all 14 threads via GitHub GraphQL API (`resolveReviewThread`), achieving **100% resolution (27/27 total threads resolved)**.

### Phase 41: Complete CodeRabbit Review Remediations & PR #17 Update
* **Resolution of All 12 CodeRabbit Review Threads on PR #17 (`KrishJdev/Z-Catchers#17`):**
  * **Thread #1 (`/api/auth/claim-profile`):** Resolved. Verified that caller moderator privileges derive strictly from authenticated Discord identity (`payload.isModerator || isModDiscordId(...)`), moderator profile claiming strictly requires moderator authorization (`hasModAuthorization`), legacy PIN profiles enforce `verifyPin` + persistent rate limiting (`checkPinRateLimitPersistent`), and atomic claim writes prevent concurrency races via `.is('discord_id', null)`.
  * **Thread #2 (`/api/auth/discord/callback`, `/api/auth/me`, `/api/auth/claim-profile`):** Resolved. Decoupled `MOD_DISCORD_IDS` environment allowlist from database persistence. Updated `/api/auth/me` to cease writing `role: 'moderator'` on env match, cleaned up stale `is_moderator` flags when `role !== 'moderator'`, and return `effectiveIsMod` dynamically. Removing a Discord ID from `MOD_DISCORD_IDS` immediately revokes moderator privileges across all requests.
  * **Thread #3 (`/api/auth/register`):** Resolved. Confirmed HTTP 410 Gone deprecation and redirection to Discord onboarding.
  * **Thread #4 & #5 (`/api/members/update-schedule`):** Resolved. Verified session owner exemption from PIN requirements while strictly preserving the 48-hour cooldown for regular edits; enforced moderator passcode rate limiting on all failed attempts even from profile owners.
  * **Thread #6 (`/api/mod`):** Resolved / Documented. Maintained dual-authorization architecture supporting verified Discord moderator sessions (with real-time live database active member status and `MOD_DISCORD_IDS` checks) alongside master `MOD_SECRET_PASSCODE` fallback per Phase 39 specification.
  * **Thread #7 (`LoginModal.tsx`):** Resolved. Implemented full accessible modal dialog semantics (`role="dialog"`, `aria-modal="true"`, `aria-labelledby="login-modal-title"`), focus management, tab trapping, Escape key dismissal, previous focus restoration, $\ge 44\text{px}$ close touch target with `aria-label`, and Warm Dark amber styling.
  * **Thread #8 (`ModDrawer.tsx`):** Resolved. Aligned `/api/mod/webhook` with shared `verifyModeratorAuthorization` and enabled session-based drawer re-unlocking.
  * **Thread #9 & #10 (`MyScheduleModal.tsx`):** Resolved. Recomputed owner unlock state whenever modal opens (`isOpen`), and exempted session owners from required PIN input.
  * **Thread #11 (`src/lib/auth.ts`):** Resolved. Removed fast-path trust of session tokens in `verifyModeratorAuthorization`; strictly checks live Supabase database record for `is_active: true` and active `role === 'moderator' || isModDiscordId(...)` eligibility.
  * **Thread #12 (`supabase/schema.sql`):** Resolved. Corrected dollar-quote delimiters from `DO $` to `DO $$` and `END $;` to `END $$;`.
  * **Outside Diff & Minor Comments:** Verified role demotion cleans `is_moderator` flag in `/api/mod`, confirmed strike webhook dispatch on 2-vote confirmation, moved `getAppBaseUrl` to shared `@/lib/auth`, fixed `HANDOFF.md` heading reference to PR #17, and moved test suite cleanup to `finally` block with guarded deletion.
* **GitHub PR #17 Update & Thread Resolution:**
  * Added detailed resolution replies and programmatically resolved all 5 previously open review threads via GitHub GraphQL API (`resolveReviewThread`), achieving **100% resolution (12/12 threads resolved)**.
  * Pushed all 13 commits on branch `krish` to `origin/krish`.

### Phase 40: Comprehensive Code Review Remediations, Session Owner Auth & A11y (PR #17)
* **Live Moderator Authorization & Dynamic Revocation (`src/lib/auth.ts`, `src/app/api/auth/discord/callback/route.ts`):**
  * Updated `verifyModeratorAuthorization` so JWT session claims are used exclusively for identity verification (`session.memberId`). Live database lookup verifies active member status (`is_active`) and real-time eligibility (`role === 'moderator' || is_moderator || isModDiscordId(...)`), ensuring immediate revocation when permissions change.
  * In the Discord OAuth callback, dynamically computed `effectiveIsMod = isDbMod || isEnvMod` on login without mutating database `role` to `'moderator'`, keeping database role status separate and revoking env-derived access immediately if removed from `MOD_DISCORD_IDS`.
* **Atomic Profile Claiming & Rate-Limited Privilege Protection (`src/app/api/auth/claim-profile/route.ts`, `src/lib/db.ts`):**
  * In `src/lib/db.ts`, extended `updateMemberSafe` with `requireUnlinkedDiscord?: boolean` utilizing atomic `.is('discord_id', null)` filtering to prevent race conditions during concurrent claim attempts. Lost claims return HTTP 409 Conflict while database errors preserve HTTP 500 status.
  * Verified review finding at `src/app/api/auth/claim-profile/route.ts`: confirmed existing implementation enforces `requireUnlinkedDiscord: true` during claim updates, differentiates update errors (HTTP 500) from lost claims (0 rows updated returning `data: null`, HTTP 409), and added regression test in `scripts/test-login-and-auth.mjs`.
  * Sanitized unclaimed profile response in `GET /api/auth/claim-profile` to return `has_pin: Boolean(passcode_hash)` without leaking sensitive hashes or auth tokens.
  * In `POST /api/auth/claim-profile` (Option A), derived moderator status strictly from the caller's authenticated Discord identity (`callerIsMod`), requiring moderator authorization to claim a moderator profile.
  * Enforced PIN verification (`verifyMemberPasscode` + persistent rate limiter `checkPinRateLimitPersistent`) or moderator approval for claiming profiles marked `has_pin`.
* **Onboarding & Join Flow Enhancements (`src/app/join/page.tsx`, `src/app/api/members/route.ts`):**
  * Removed redundant `decodeURIComponent` in `src/app/join/page.tsx` on `useState(urlError || null)`.
  * Added `claimPin` state and secure PIN entry prompt in `/join` when claiming a profile marked `has_pin`.
  * Fully deprecated legacy registration `POST /api/members` with HTTP 410 Gone, directing client requests to Discord onboarding (`/api/auth/discord` or `/join`).
* **Session Owner Exemption for Schedule Updates & Cancellation (`src/app/api/members/update-schedule/route.ts`, `src/app/api/members/cancel-pending/route.ts`, `src/components/MyScheduleModal.tsx`):**
  * Updated `/api/members/update-schedule` to accept an authenticated session owner (`isSessionOwner`) without requiring a PIN, while strictly preserving the 48-hour cooldown for regular edits and PIN verification for non-owners.
  * Enforced that Discord-linked profiles cannot be claimed or modified by non-owners without moderator override.
  * Fixed moderator passcode failure rate limiting so invalid passcode attempts always record failures and count toward the moderator rate limit, even when attempted by the session owner.
  * Updated `/api/members/cancel-pending` to recognize the authenticated shift owner (`sessionMemberId === member.id`) to cancel pending cooldown shifts without requiring a PIN.
  * In `MyScheduleModal.tsx`, recomputed owner unlock state on `isOpen`, allowed session owners to submit profile/schedule updates and cancel pending shifts without entering a PIN, rendered a "Verified Owner Session" badge, and replaced legacy registration with a Discord onboarding card.
    * Refined the effect calling `setIsUnlocked` (lines 94–125) to watch `[isOpen, activeMember, members, selectedMemberId, tab, currentUser]` with early return on `!isOpen`. This guarantees owner/unclaimed unlock state is recomputed every time the modal opens even when active member and roster remain unchanged, preserving the `isOwner || !isClaimed` condition and eliminating redundant unlock logic in the reset effect.
* **Moderator Role Synchronization & Shared Webhook Authorization (`src/app/api/mod/route.ts`, `src/app/api/mod/webhook/route.ts`, `src/components/ModDrawer.tsx`):**
  * In `edit_member` (`/api/mod`), updated role change logic so demoting a profile to member clears its `is_moderator` database flag (`is_moderator: isTargetMod`), keeping role and flag synchronized.
  * Evaluated and verified review finding at `src/app/api/mod/route.ts` line 345: confirmed role-change logic already clears `is_moderator` flag on member demotion (`is_moderator: isTargetMod`) and preserves the flag when the role remains moderator in both `/api/mod` and `/api/auth/claim-profile`, ensuring full consistency with `verifyModeratorAuthorization`. Skipped further modifications as the issue is already resolved and verified.
  * Evaluated and skipped comment regarding enforcing `MOD_SECRET_PASSCODE` alone on GET handler: verified Discord moderator sessions are intentionally supported alongside master passcode per project spec and architecture.
  * Replaced custom auth helper in `/api/mod/webhook` with shared `verifyModeratorAuthorization`, aligning webhook authorization with drawer and mod endpoints.
  * In `ModDrawer.tsx`, recomputed `isUnlocked: true` when opening for session moderators and added "Unlock with Moderator Session" button on locked view. Verified review comment at `src/components/ModDrawer.tsx` lines 130–134: confirmed session moderators can regain access after locking via both drawer reopening (`useEffect` watching `[isOpen, isModUser]`) and session-based unlock button (`onClick={() => setIsUnlocked(true)}`), while passcode requirements remain strictly enforced for non-session moderators. Skipped changes as issue is already fully resolved and verified.
* **Warm Dark Design System & Accessibility Remediations (`src/components/LoginModal.tsx`, `src/components/Header.tsx`, `src/app/join/page.tsx`):**
  * In `LoginModal.tsx`, added accessible dialog semantics (`role="dialog"`, `aria-modal="true"`, `aria-labelledby="login-modal-title"`), focus trap, Escape key listener, and focus restoration to trigger element on close.
  * Updated close button in `LoginModal.tsx` to provide `aria-label="Close modal"` and $\ge 44\text{px}$ touch target (`min-w-[44px] min-h-[44px]`).
  * Styled OAuth button in `LoginModal.tsx` with Warm Dark amber (`bg-status-amber text-night-bg hover:brightness-110`), removing cold-blue `#5865F2`.
  * Updated Discord icon accents to `text-status-amber` across `Header.tsx`, `LoginModal.tsx`, and `join/page.tsx`.
* **Discord Webhook Dispatch for Confirmed Community Strikes (`src/app/api/members/strikes/route.ts`):**
  * Dispatched `sendStrikeDiscordWebhook` inside try/catch when a strike is confirmed by community votes, ensuring webhook delivery failure does not prevent vote recording.
  * Verified review comment at `src/lib/discordWebhook.ts` lines 301–305: confirmed `sendStrikeDiscordWebhook` is called once in `src/app/api/members/strikes/route.ts` (lines 172–182) when `result.strikeIssued` is true, safely enclosed within a try/catch block that logs delivery failures without preventing or undoing vote recording. Skipped modifications as the issue is already fully resolved in the active branch.
* **Shared OAuth Base URL & Migration Syntax Corrections (`src/app/api/auth/discord/route.ts`, `supabase/schema.sql`, `scripts/test-login-and-auth.mjs`):**
  * Moved `getAppBaseUrl` into `@/lib/auth` and reused across `/api/auth/discord` and `/api/auth/discord/callback`.
  * Corrected dollar-quote delimiters in `supabase/schema.sql` and `HANDOFF.md` from `DO $` to `DO $$` and `END $;` to `END $$;`.
  * In `scripts/test-login-and-auth.mjs`, moved Supabase cleanup into a `finally` block with guarded deletion.


### Phase 38: PR #16 Code Review Remediations, Batched Strike Queries & Docstring Coverage
* **Isolated Voter Rate Limiting (`src/app/api/members/strikes/route.ts`, `src/lib/rateLimit.ts`):**
  * Replaced the shared IP and target PIN-failure rate-limit check in the strike-voting flow with persistent voter counter `checkVoteRateLimitPersistent` and `recordVoteAttemptPersistent` keyed directly to the authenticated voter (`vote:voter:${voterId}`).
  * Removed `getClientIp` from `/api/members/strikes/route.ts` as it is no longer used, ensuring strike vote tracking neither reads nor modifies shared IP or PIN failure counters.
* **Push Subscription Endpoint Rotation Preference Fallback (`src/app/api/push/subscribe/route.ts`):**
  * Updated endpoint-rotation flow (`old_endpoint && old_endpoint !== subscription.endpoint`) to query and store the old subscription row's `notify_personal` and `notify_community` preferences before deleting it.
  * When no existing preferences are found for the new rotated endpoint, falls back to the saved old preferences so omitted flags during background health sync or device token refresh strictly preserve the member's customized notification settings.
* **Database Consistency & Concurrency Failure Guard (`src/lib/strikes.ts`):**
  * In `recordStrikeVote`, returned failure when Supabase retry loop exhausts or encounters database errors, preventing unpersisted votes from being incorrectly reported as successful.
  * Preserved in-memory fallback exclusively for unconfigured environments (unit tests) and unmigrated table schemas (Postgres error code `42P01`).
* **Row Count Precedence in `resolveMemberStrikeCounts` (`src/lib/strikes.ts`):**
  * Updated `resolveMemberStrikeCounts` so fetched database member rows take precedence over stale serverless in-memory caches (`memoryStore.memberCounts`) when Supabase is configured and the row contains count columns (`strikes_count` / `strikes_used`).
  * Preserved memoryStore fallback for unconfigured environments and offline testing suites.
* **Batched Roster Recent Strikes & Query Date Filtering (`src/lib/strikes.ts`, `src/app/api/members/route.ts`):**
  * Updated `getNightlyStrikeLogsBatch` to collect distinct requested `sleepCycleDate` values and filter Supabase queries by both `target_member_id` and `sleep_cycle_date`, preserving `requestedKeySet` filtering.
  * Implemented `getRecentEligibleStrikeLogsBatch` to query recent strikes within 24 hours in a single batched query across all roster members, grouping in memory per member with zero N+1 database roundtrips and zero monthly-reset write side-effects.
* **100% Docstring Coverage Across Codebase (`src/app/api/...`, `src/components/...`, `src/lib/...`):**
  * Authored comprehensive JSDoc docstrings for all exported and helper functions missing documentation (`/api/auth/login`, `/api/auth/logout`, `/api/auth/me`, `/api/cron/dispatch-notifications`, `/api/members/cancel-pending`, `/api/members/in-bed`, `/api/members/nag-assist`, `/api/mod/webhook`, `/api/push/test`, `BottomNav`, `FoxMascot`, `Header`, `LoginModal`, `ModDrawer`, `MyScheduleModal`, `PushModal`, `PwaBanner`, `StatusBucket`, `auth.ts`, `db.ts`, `discordWebhook.ts`, `rateLimit.ts`), completely satisfying the pre-merge check threshold.
* **Test Verification & Regression Suites (`scripts/test-strikes-system.mjs`, `scripts/test-phase1-pwa-push.mjs`):**
  * Added Section 7 tests in `test-strikes-system.mjs` verifying `getNightlyStrikeLogsBatch` cycle date filtering, `getRecentEligibleStrikeLogsBatch` 24h window filtering, and voter rate limiting isolation from PIN rate limits.
  * Added assertion in `test-phase1-pwa-push.mjs` verifying preference preservation across endpoint rotation. All test suites passed cleanly.

### Phase 38: Code Review Remediations: Scoped Preferences, Authoritative Strike Readers & Member Safe Insert
* **Member-Scoped Notification Preferences & Health Sync Isolation (`src/lib/pushClient.ts`, `scripts/test-phase1-pwa-push.mjs`):**
  * Replaced un-scoped global preference storage (`zcatchers_notify_personal`, `zcatchers_notify_community`) with member-scoped keys generated via `getMemberNotificationStorageKey(baseKey, memberId)`.
  * Added `getStoredNotificationPreferences(memberId)` and `setStoredNotificationPreferences(memberId, prefs)` helper functions.
  * In `syncPushSubscriptionHealth`, health sync now reads preferences strictly for the current signed-in member (`memberIdToUse`). If no member is signed in or no member-scoped choice exists, fields remain undefined so `/api/push/subscribe` preserves existing subscription preferences and never leaks or applies another member's stored choices across sessions.
  * Added test assertions to `scripts/test-phase1-pwa-push.mjs` verifying scoped keys and health-sync isolation.
* **Authoritative Database Strike Log Readers & Fallback Hardening (`src/lib/strikes.ts`):**
  * Updated `getNightlyStrikeLog`, `getNightlyStrikeLogsBatch`, `getRecentEligibleStrikeLog`, and `getRecentEligibleStrikeLogsBatch` so that after a successful database query, missing rows are treated as authoritative and are never filled from `memoryStore`.
  * In-memory fallbacks now execute strictly when Supabase is unconfigured or a query fails/throws.
* **Resilient Member Safe Insert Integration (`src/app/api/members/route.ts`):**
  * Replaced raw Supabase `members` insert and inline column-stripping retry block with `insertMemberSafe(insertPayload)`.
  * Preserves PostgREST schema cache adaptation (stripping only unmigrated columns) and retains automatic in-memory weekend-hours caching (`setInMemoryWeekendHours` and `hydrateMemberWeekendHours`).
* **Database-Backed Strike Batch Integration Test & Environment Auto-Loading (`scripts/test-strikes-system.mjs`, `scripts/test-signup-and-profiles.mjs`, `scripts/test-login-and-auth.mjs`):**
  * In `scripts/test-strikes-system.mjs`, added section 7D providing a separate database-backed integration test that seeds valid members with UUIDs directly into the `members` table and strike logs into `nightly_strike_logs`, verifies batched recent strike queries, and cleans up all seeded records in a `finally` block, leaving the existing test fixture intact.
  * Added `.env.local` auto-loading across `test-strikes-system.mjs`, `test-signup-and-profiles.mjs`, and `test-login-and-auth.mjs`.
* **Verification: Retroactive Metastrike Cycle Date Resolution & 24h Window (`src/app/api/members/strikes/metastrike/route.ts`, `src/lib/strikes.ts`, `src/components/MemberCard.tsx`):**
  * Verified review finding regarding retroactive strike conversion targeting the strike's cycle date rather than current `getSleepCycleDate`.
  * Confirmed that `convert_retroactive` in `src/app/api/members/strikes/metastrike/route.ts` and `src/lib/strikes.ts` already accepts client `sleep_cycle_date` and resolves via `getRecentEligibleStrikeLog`, while `MemberCard.tsx` and `GET /api/members` keep the 24-hour conversion option active across sleep cycle changes via `convertible_strike_log`. Verified passing under Test 3C in `scripts/test-strikes-system.mjs`.

### Phase 37: Automated Code Review Remediations, Security Hardening & Concurrency Protection
* **Batched Roster Database Lookups & Required Timezone (`src/app/api/members/route.ts`):**
  * Refactored `GET /api/members` to avoid sequential per-member queries: batched monthly strike count resolutions with `Promise.all` and replaced N per-member strike log queries with a single batched `getNightlyStrikeLogsBatch` query matching each member's canonical sleep cycle date.
  * In `POST /api/members`, removed server-side `detectUserTimezone()` fallback; requires non-empty IANA timezone string and returns 400 when missing. Preserves trimmed client-supplied timezone.
* **Voter Authentication Enforcement & Identity Verification (`src/app/api/members/strikes/route.ts`):**
  * Removed unauthenticated `voterId`/`voter_id` destructuring from request body. Strictly requires authenticated session member ID from `getRequestSessionMemberId(request)`.
  * Verifies session member ID belongs to an active existing member in the database, rejecting inactive or nonexistent voters with 403 Forbidden.
  * Preserved self-voting guardrail rejecting attempts to vote on oneself.
* **Moderator Passcode Failure Tracking & Flexible 24h Retroactive Window (`src/app/api/members/strikes/metastrike/route.ts`, `src/components/MemberCard.tsx`, `src/components/MetastrikeModal.tsx`):**
  * In `/api/members/strikes/metastrike`, records failed `candidatePasscode` attempts via `recordPinFailurePersistent(clientIp, member.id)` and enforces persistent sliding-window rate limiting on moderator passcode attempts.
  * In `convert_retroactive`, accepts explicit `sleep_cycle_date` payload from client or resolves most recent eligible strike within 24 hours via `getRecentEligibleStrikeLog`.
  * Updated `MemberCard.tsx` and `MetastrikeModal.tsx` so retroactive Metastrike conversion remains available within the 24-hour window even after the member's current sleep cycle rolls over to the next day.
* **Per-IP & Per-Member Scoped Moderator Rate Limiting (`src/app/api/mod/route.ts`, `src/app/api/members/update-schedule/route.ts`, `src/lib/rateLimit.ts`):**
  * Replaced shared global `'mod_admin'` and `'mod_passcode_gate'` rate limit target buckets with isolated keys scoped per client IP (`mod_ip:${ip}`) and session member (`mod_member:${sessionMemberId}`), mitigating cross-tenant DoS attacks.
  * Updated `resetPinFailurePersistent` to clear corresponding IP-scoped keys for moderator operations while preserving client IP attempt counters during regular member PIN resets to prevent brute-forcing.
  * In `/api/mod` `clear_strike_log` action, added explicit 404 response when target member is not found and validated `cycleDate` before invoking `modClearStrikeLog`.
* **Complete Low-Blue-Light Warm Dark UI Tokenization & Viewport Zoom Accessibility (`src/app/layout.tsx`, `src/components/MemberCard.tsx`, `src/components/BottomNav.tsx`, `src/components/StatusBucket.tsx`, `src/app/page.tsx`):**
  * In `src/app/layout.tsx`, updated `viewport` `maximumScale: 5` to allow low-vision users to zoom up to 500% while preserving `initialScale: 1` and preventing iOS auto-zoom on 16px inputs.
  * In `src/components/MemberCard.tsx`, `BottomNav.tsx`, `StatusBucket.tsx`, and `src/app/page.tsx`, eliminated all remaining hardcoded hex colors (`#F4A261`, `#E07A5F`, `#A89F91`, `#C8B6A6`, `#120F0D`, `#1A1412`, `#261E1A`, `#2C221E`, `#6B9E78`) across all cards, navigation bars, section headers, counters, and status badges.
  * Standardized strictly on Tailwind design system tokens: `status-amber`, `status-coral`, `status-sage`, `cream-primary`, `cream-secondary`, `cream-muted`, `night-bg`, `night-surface`, `night-elevated`, and `night-border`.
  * In `src/app/page.tsx`, updated background `/api/auth/me` session check: when server responds with `authenticated === false`, executes `clearAuthSession()`, clears `currentUser` and `claimedMemberId`, and redirects to `/join`.
* **Client & Server Push Notification Preference Persistence (`src/lib/pushClient.ts`, `src/app/api/push/subscribe/route.ts`, `scripts/test-phase1-pwa-push.mjs`):**
  * Added `STORAGE_KEY_NOTIFY_PERSONAL` and `STORAGE_KEY_NOTIFY_COMMUNITY` in `pushClient.ts` to mirror user preferences in `localStorage`.
  * In `syncPushSubscriptionHealth`, reads stored client preferences and transmits them to `/api/push/subscribe` so background/foreground health syncs preserve explicit member preferences alongside backend fallback preservation.
  * Verified review comment regarding health-sync requests omitting notification preferences: confirmed `/api/push/subscribe` queries existing preferences for the endpoint and preserves `notify_personal` and `notify_community` whenever fields are omitted or nullish, while retaining default `true` for new subscriptions.
  * Hardened null-safety defense in `/api/push/subscribe` (`undefined || null` checks for both preferences).
  * Added regression test assertion to `scripts/test-phase1-pwa-push.mjs` verifying preference preservation logic. All Phase 1 PWA tests passing.
* **Cross-Instance Concurrency, Notification Guard & Monthly Reset Sync (`src/lib/strikes.ts`):**
  * In monthly reset, replaced direct Supabase update with `updateMemberStrikeCounts(member.id, 0, 0, strike_cycle_month)` to keep in-memory store and database synchronized across both `strikes_used`/`strikes_count` and `metastrikes_used`/`metastrikes_count` alias pairs.
  * In `recordStrikeVote`, verified in-bed status against `notification_logs` for `IN_BED_EARLY` on the current `cycleDate`, ensuring subsequent `last_notified_stage` transitions cannot revoke check-in protection.
  * Implemented atomic cross-instance concurrency protection: optimistic locking and conflict retry (`23505`) on nightly strike logs, and conditional atomic update (`.lt('metastrikes_used', 3)`) on metastrike consumption.
  * Added `isSupabaseConfigured` check in `src/lib/db.ts` to cleanly fall back to in-memory store during offline test execution.
* **In-Memory Rate Limit Mirroring in `recordPinFailurePersistent` (`src/lib/rateLimit.ts`):**
  * Verified review comment regarding `recordPinFailurePersistent`: confirmed that in-memory rate-limit keys in `pinRateLimits` map are updated immediately prior to attempting best-effort Supabase writes (lines 208–215). Preserves synchronous fallback behavior for `checkPinRateLimitSync` when Supabase is unreachable or in offline mode. Verified via `node scripts/test-pin-rate-limiting.mjs` (all tests passing).
* **Production Function Test Suite & JSDoc Docstring Coverage (`scripts/test-strikes-system.mjs`):**
  * Replaced duplicated `StrikeTestEngine` class with direct imports and tests against real production functions in `src/lib/strikes.ts`. All 26 test sections passing.
  * Added comprehensive JSDoc docstrings across all modified routes, helper functions, and components to satisfy CodeRabbit pre-merge review threshold.

### Phase 36: Ubiquitous Member Log Out & Auth Session De-identification
* **Ubiquitous Log Out Access in Header Navigation (`src/components/Header.tsx`):**
  * Added `LogOut` icon button right alongside the `@username` member profile badge.
  * Formatted with Warm Dark styling (`hover:border-status-coral/40 hover:bg-status-coral/10 hover:text-status-coral`) and standard 44px min touch target.
  * Responsive layout: displays `[icon] Log Out` on desktop/tablet (`sm:`) and compact touch-friendly icon on mobile viewports.
  * Unauthenticated state polish: made "Log In" accessible across all screen sizes.
* **Dual Log Out Touchpoints in My Schedule Modal (`src/components/MyScheduleModal.tsx`):**
  * Header Log Out button: positioned directly beside the modal close (`X`) button for fast 1-tap exit.
  * Dedicated "Account & Session Management" card inside the "My Profile" tab: displays authenticated fox avatar, username, and a full-width `"Log Out of Fox Den"` button, accessible regardless of whether the profile edit form is locked or unlocked with PIN.
* **Profile Badge Quick Log Out in Alerts Modal (`src/components/PushModal.tsx`):**
  * Added a secondary Log Out action within the active user badge in `PushModal.tsx`, allowing members managing notifications to log out directly.
* **Session Cleanup Orchestration & Redirect (`src/app/page.tsx`):**
  * Implemented `handleLogout` orchestrator:
    1. Invokes `/api/auth/logout` endpoint to expire the HttpOnly `zcatchers_session` cookie.
    2. Calls `clearAuthSession()` in `src/lib/pushClient.ts` to purge `zcatchers_auth_token`, `zcatchers_auth_member`, and `zcatchers_member_id` from `localStorage`.
    3. Resets component session states (`currentUser`, `claimedMemberId`, `activeModal`).
    4. Triggers user-facing toast feedback and routes directly to `/join` onboarding.
* **Hardened Logout API Endpoint (`src/app/api/auth/logout/route.ts`):**
  * Added dual method handling (`POST` and `GET`) to eliminate 405 Method Not Allowed exceptions.
  * Hardened cookie deletion with both `maxAge: 0` and `expires: new Date(0)`.
* **Verification & Automated Test Suite (`scripts/test-logout-flow.mjs`):**
  * Created `scripts/test-logout-flow.mjs` verifying 18 automated checks across Header, Schedule modal, Push modal, page controller, API route, and cookie deletion. 18/18 checks passing.
  * `npx tsc --noEmit`: clean (0 errors).
  * `npm run build`: 26/26 routes compiled cleanly.

### Phase 35: PWA Phone Robustness, Safe Areas, Keyboard dvh & Mobile Offline Resilience
* **iOS Notch & Dynamic Island Safe-Area Clipping Fix (`src/components/Header.tsx`, `src/app/join/page.tsx`):**
  * Added `pt-[env(safe-area-inset-top,0px)]` to the sticky `<header>` container in `Header.tsx`, preventing iPhone status bar clocks, battery badges, and Dynamic Islands from overlapping the Sleepy Fox icon and "Z Catchers" brand wordmark.
  * Added top safe area spacing to `/join/page.tsx` (`pt-[calc(2rem+env(safe-area-inset-top,0px))]`).
* **Virtual Keyboard Avoidance via Dynamic Viewport Height (`dvh`):**
  * Upgraded slide-up bottom sheet containers across `PushModal.tsx`, `MyScheduleModal.tsx`, `ModDrawer.tsx`, and `MetastrikeModal.tsx` from static `vh` to `max-h-[90dvh]` / `max-h-[92dvh]`.
  * Allows bottom sheets to dynamically contract when mobile software keyboards open, ensuring input fields and submission buttons stay accessible without being pushed off-screen.
* **Warm Dark Palette Compliance in Bottom Navigation (`src/components/BottomNav.tsx`):**
  * Eliminated cool slate-blue hex tokens (`#12141c` and `#262936`).
  * Re-anchored bottom navigation to official Warm Dark tokens: `bg-[#1C1714]/95`, `border-t border-[#332B24]`, and `ring-[#1C1714]`.
* **Touch Ergonomics & Double-Tap Latency Elimination (`src/app/globals.css`):**
  * Applied `touch-action: manipulation;` across `html, body, button, a, input, select, textarea`, eliminating the standard 300ms mobile browser double-tap zoom delay for immediate button responsiveness.
  * Added `-webkit-tap-highlight-color: transparent;` to eliminate default gray/blue tap flashes.
  * Added `overscroll-behavior-y: contain;` to prevent elastic scroll bounces from flashing white browser backgrounds.
  * Added `user-select: none;` on buttons and bottom navigation to prevent accidental text selections during fast taps.
* **Interactive Push Notification Actions in Service Worker (`public/sw.js`):**
  * Added interactive lockscreen notification action buttons to `showNotification`: `"🛌 I'm in Bed"` (`in_bed`) and `"💬 Nag in Discord"` (`open_journal`).
  * Enhanced `notificationclick` to parse `event.action`, route `in_bed` directly to `/?action=in-bed`, and route `open_journal` straight to the member's Discord journal thread.
* **Expanded Web App Manifest Shortcuts (`public/manifest.json`, `src/app/page.tsx`):**
  * Added 1-tap **"My Schedule"** home screen long-press shortcut pointing to `/?action=schedule`.
  * Wired up `processDeepLinkAction` in `page.tsx` to automatically trigger `setActiveModal('schedule')`.
* **Offline Roster Caching, Connectivity Banner & App Badging API (`src/app/page.tsx`):**
  * Implemented localStorage snapshot caching (`STORAGE_KEY_CACHED_ROSTER = 'zcatchers_cached_roster'`) in `fetchRoster` to immediately hydrate the den roster during cold boots or when offline.
  * Added real-time network connectivity listeners (`online`/`offline`) with a gentle Warm Dark offline notification banner: *"You are offline • Showing cached Fox Den times"*.
  * Automated silent background roster and push health re-sync when network reconnects.
  * Integrated mobile Home Screen **App Badging API** (`navigator.setAppBadge` / `clearAppBadge`) syncing the active overdue nag count (`categorized.nagNow.length`) directly to the PWA icon.
* **Verification:**
  * Created `scripts/test-phase35-pwa-phone-robustness.mjs`: 15/15 checks passed cleanly.
  * Verified all existing test suites: `test-phase1-pwa-push.mjs` (25/25), `test-phase2-mobile-touch-ux.mjs` (28/28), `test-weekend-hours.mjs` (32/32), `test-strikes-system.mjs` (24/24).
  * `npx tsc --noEmit`: 0 errors.
  * `npm run build`: 26/26 static & dynamic pages successfully compiled.

### Phase 29: Mobile Layout Bugfixes & Standalone Onboarding Flow (`/join`)
* **Standalone Onboarding & Join Page (`src/app/join/page.tsx`):**
  * Created dedicated onboarding route `/join` with centered Sleepy Fox mascot logo (`FoxMascot state="logo" size={56}`), "Z Catchers" title, and warm subtitle: `"Cross-timezone bedtime accountability for the Fox Den"`.
  * Built two-tab switcher card (`max-w-md mx-auto`):
    1. **"New Fox (Join Den)":** Display Name, Discord Journal Thread URL (with regex verification and sample URL helper), Target Bedtime (24h), Auto-detected IANA Timezone (with GMT offset selector), and 4-digit PIN.
    2. **"Returning Fox (Enter PIN)":** Allows selecting an existing profile from the active den roster or entering username directly, plus 4-digit PIN authentication.
  * On submission, automatically saves authentication session (`setStoredAuthToken`, `setStoredAuthMember`, HttpOnly cookie) and redirects to `/`.
  * Included reverse route guard: if user already has an active session, redirects to `/` immediately.
* **Dashboard Route Guard & Join Button Cleanup (`src/app/page.tsx`):**
  * Added client-side Route Guard: checks localStorage (`getStoredAuthMember`, `getStoredAuthToken`, `getStoredMemberId`) and cookies (`/api/auth/me`). If no member profile is claimed or logged in, automatically redirects to `/join`.
  * Deleted the orange `"Join Den"` button from the top header.
  * Deleted the mid-page `"✨ Join Den: Create profile & PIN ->"` pill button.
  * Updated empty roster state CTA to redirect cleanly to `/join`.
  * Updated logout flow in `LoginModal` to redirect cleanly to `/join`.
* **Mobile Top Header Layout Crowding Fix (`src/components/Header.tsx`):**
  * Replaced rigid height with `flex items-center justify-between px-4 py-3 sm:px-6 lg:px-8 max-w-7xl`.
  * Left side: Sleepy Fox icon (`shrink-0`) + `"Z Catchers"` (`whitespace-nowrap font-bold text-lg`) with detected timezone rendered as a tiny muted subtitle directly underneath (`text-xs text-[#A89F91]`, e.g. `GMT+05:30`).
  * Removed the bulky separate mobile timezone pill.
  * Right side: Shows logged-in user's compact profile pill/avatar (`@{currentUser.discord_username}`).
  * Hidden redundant push notification bell button and key/login buttons on mobile screens (`hidden md:flex`), relying on the mobile bottom navigation bar.
* **iOS Safari Install Banner Text Formatting Fix (`src/components/PwaBanner.tsx`):**
  * Fixed broken 4-column layout caused by `flex` on the text container.
  * Converted text wrapper to standard block paragraph `<p className="text-sm leading-relaxed text-[#A89F91] mt-1">` so sentences flow naturally from left to right.
  * Formatted Share icon inline using `<span className="inline-flex items-center align-middle mx-1">` and bolded `'Add to Home Screen'` with `<strong className="text-[#F4F1EA] font-semibold">`.
* **Mobile Bottom Navigation Bar Cleanup (`src/app/page.tsx`):**
  * Configured exactly 4 evenly spaced columns using `grid grid-cols-4`: `Roster`, `My Time`, `Alerts`, and `Mod`.
  * Removed redundant 5th Join/Profile tab.
  * Maintained `md:hidden` so navigation is strictly mobile-only and hidden on desktop and `/join`.
* **Next.js Dev Indicator Overlay Disabled (`next.config.mjs`):**
  * Added `devIndicators: false` to eliminate the floating "N" badge from overlapping the bottom-left "Roster" navigation icon.
* **Type & Build Verification:**
  * Fixed typing issue in `src/lib/db.ts` (`insertMemberSafe` conversion to `(data as unknown as Member)`).
  * Created `src/app/not-found.tsx` to satisfy Next.js 15 App Router prerendering invariants.
  * `npx tsc --noEmit`: 0 errors.
  * `npm run build`: Compiled 25/25 static and dynamic pages with 0 errors.

### Phase 30: MemberCard & Status Bucket Headers Warm Dark Refactor
* **Identical Card Dimensions & Unified Skeleton (`src/components/MemberCard.tsx`):**
  * Refactored `MemberCard` to use a single unified layout with standard container `w-full p-5 rounded-2xl bg-[#1A1412] border transition-colors flex flex-col justify-between gap-4`.
  * Added fixed avatar dimensions: `w-11 h-11 rounded-full shrink-0 flex items-center justify-center` preventing flexbox squeezing into vertical ovals.
  * Unified header metadata placement: Member Name, `YOU` badge, `MOD` badge, Star button, and Streak badge are now positioned identically across all states.
  * Prevented status pill text wrapping with `whitespace-nowrap px-2.5 py-1 text-xs rounded-full inline-flex items-center gap-1.5` and shortened verbose copy to clean single-line labels (`58m overdue` / `4m grace`, `in 28m`, `in 6h 15m`, `In Bed` / `Sleeping`).
* **Unified Warm Dark Color Palette (No Cool Blue or Green):**
  * Anchored all card surfaces to `#1A1412` espresso surface.
  * **NAG NOW (Overdue / Grace):** Border `border-[#E07A5F]/40`, status pill `bg-[#E07A5F]/15 text-[#E07A5F]`.
  * **WINDING DOWN:** Border `border-[#F4A261]/30`, status pill `bg-[#F4A261]/15 text-[#F4A261]`.
  * **AWAKE:** Border `border-[#2C221E]`, status pill `bg-[#261E1A] text-[#A89F91]`.
  * **SLEEPING (Shield Active):** Border `border-[#2C221E]`, status pill `bg-[#261E1A] text-[#C8B6A6]`, rested opacity `opacity-85 hover:opacity-100`. Removed cool slate blue (`#5B6B94`) and bright green.
* **Native 3D Emoji Removal (Strict Lucide Icons):**
  * Removed all native OS emojis (`🛌`, `🛡️`, `🌙`, `🔥`, `⏳`, `🔄`, `🦊`) from buttons, badges, and status pills.
  * Replaced with dedicated `lucide-react` icons: `Flame` for streak badges, `BedDouble` for in-bed actions, `Clock` for grace and pending notices, `Shield` for metastrikes, `RefreshCw` for retroactive conversions, and `Moon` for weekend and slumber states.
* **Status Bucket Headers Unification (`src/components/StatusBucket.tsx` & `src/app/page.tsx`):**
  * Streamlined bucket titles to `"Nag Now"`, `"Winding Down"`, `"Awake"`, and `"Sleeping"`.
  * Styled collapsible bucket header with `rounded-xl border border-[#2C221E] bg-[#1A1412] px-4 py-3 hover:border-[#382C27] hover:bg-[#201917]`.
  * Updated bucket accent colors and icons to match the warm dark palette: Nag Now (`#E07A5F`), Winding Down (`#F4A261`), Awake (`#A89F91`), Sleeping (`#C8B6A6`).
  * Updated top hero banner quick counters to `#E07A5F` (Nag), `#F4A261` (Wind), and `#C8B6A6` (Asleep).
* **Verification:**
  * `npx tsc --noEmit`: 0 errors.
  * `npm run build`: 25/25 static & dynamic pages successfully generated.

### Phase 31: Mobile PWA Lifecycle, Service Worker & Multi-Device Push Reliability (Phase 1 Execution)
* **Service Worker Lifecycle & Offline Fallback Shell (`public/sw.js`):**
  * Implemented `install` and `activate` listeners calling `self.skipWaiting()` and `self.clients.claim()` for immediate client control without waiting for stale tabs to close.
  * Defined versioned static cache `z-catchers-shell-v1` pre-caching `/manifest.json`, `/icons/icon-192x192.png`, `/icons/icon-512x512.png`, `/icons/badge-72x72.png`, and `/icons/icon.svg`, and pruning legacy cache names on activate.
  * Configured network-first navigation strategy with Warm Dark Sleepy Fox offline fallback HTML response (`#120F0D` background, `#1C1714` card, embedded vector mascot, and "Reconnect" retry button) while strictly bypassing `/api/*` routes.
  * Enhanced `notificationclick` handler: matches window clients on origin, focuses existing window client, navigates or postMessages target action, or opens new window via `clients.openWindow(targetUrl)`.
  * Added `pushsubscriptionchange` listener that re-subscribes via `self.registration.pushManager.subscribe()` and POSTs the refreshed token to `/api/push/subscribe` for background token rotation recovery.
* **Web App Manifest Hardening (`public/manifest.json`):**
  * Explicitly configured `"id": "/"`, `"scope": "/"`, `"start_url": "/"`, `"display": "standalone"`, and `"orientation": "portrait"`.
  * Split icon declarations into distinct objects for `"purpose": "any"` and `"purpose": "maskable"` across 192x192 and 512x512 png assets to avoid Android launcher clipping.
  * Added 1-tap **"I'm In Bed"** shortcut pointing to `"url": "/?action=in-bed"` with `/icons/icon-192x192.png`.
* **Foreground State Sync & Deep-Link Action Handling (`src/app/page.tsx` & `src/lib/pushClient.ts`):**
  * Added `syncPushSubscriptionHealth()` in `src/lib/pushClient.ts` to silently verify and re-sync active push subscriptions with Supabase on boot and foreground resume.
  * Implemented throttled foreground sync in `src/app/page.tsx`: triggers on `visibilitychange` (when `visible`) and `window.focus`, throttled to at most once every 5 seconds. Recalculates countdown timers (`setTick`), parallel fetches `/api/members` and `/api/auth/me`, and runs silent push health checks.
  * Handled deep-link query parameter `/?action=in-bed`: if authenticated, automatically triggers check-in flow (`/api/members/in-bed`) and sanitizes URL query parameters using `window.history.replaceState`.
  * Added `message` event listener on `navigator.serviceWorker` to handle in-bed actions posted from notification clicks.
* **Cross-Platform Install Banner (`src/components/PwaBanner.tsx`):**
  * Detected standalone mode via `matchMedia('(display-mode: standalone)')` and `navigator.standalone`, immediately suppressing the banner if installed.
  * Preserved `beforeinstallprompt` event capture and install button for Chromium/Android.
  * Added Apple mobile Safari detection (iOS/iPadOS touch devices) with Warm Dark banner instructing: **Tap Share → Add to Home Screen**.
  * Persisted banner dismissals in `localStorage` (`zcatchers_pwa_banner_dismissed_at`) with a 7-day cooldown timestamp (`7 * 24 * 60 * 60 * 1000`).
* **Multi-Device Push Subscriptions & Stale Pruning (`supabase/schema.sql`, `src/app/api/push/subscribe/route.ts`, `src/app/api/push/unsubscribe/route.ts`, `src/lib/pushServer.ts`):**
  * Verified and updated `supabase/schema.sql` so push subscriptions are uniquely constrained on `endpoint`, allowing a single member to maintain concurrent subscriptions on both mobile PWA and desktop without overwriting.
  * Updated `/api/push/subscribe/route.ts` to support background token rotation recovery (`old_endpoint`) and upserting on `endpoint`.
  * Updated `/api/push/unsubscribe/route.ts` to delete only the specific `endpoint` passed in the body, falling back to all member subscriptions only if no specific endpoint is provided.
  * In `src/lib/pushServer.ts`, wrapped `webpush.sendNotification` to inspect `statusCode === 404 || statusCode === 410`, automatically pruning dead endpoints from Supabase while allowing delivery to continue to the member's remaining active devices. Added `sendPushToMemberSubscriptions` helper.
* **Verification:**
  * Created `scripts/test-phase1-pwa-push.mjs` test suite verifying all 6 phases: 25/25 checks passed.
  * `node scripts/test-push-and-cron.mjs`: all tests passed.
  * `node scripts/test-e2e-api-endpoints.mjs`: all tests passed.
  * `npx tsc --noEmit`: 0 errors.
  * `npm run build`: 25/25 static & dynamic routes compiled cleanly.

### Phase 32: Mobile Navigation, Standalone Onboarding & Touch UX (Phase 2 Execution)
* **Mobile Bottom Navigation Bar (`src/components/BottomNav.tsx`, `src/app/page.tsx`):**
  * Created dedicated `BottomNav.tsx` component fixed to the bottom of mobile viewports (`md:hidden`) with frosted Warm Dark glassmorphism styling (`bg-[#12141c]/90 backdrop-blur-md border-t border-[#262936]`).
  * Four active tabs: **Roster** (`Home`), **My Time** (`Clock`), **Alerts** (`Bell`, with indicator dot when push is enabled), and **Mod** (`Shield`, conditionally displayed only when `currentUser?.role === 'moderator'`).
  * Dynamic layout: renders 3 columns (`grid-cols-3`) for regular members and 4 columns (`grid-cols-4`) for moderators.
  * Enforced minimum $44\text{px} \times 44\text{px}$ touch targets (`min-h-[44px] min-w-[44px]`), safe area padding (`pb-[env(safe-area-inset-bottom)]`), and 10ms haptic feedback (`navigator.vibrate(10)`).
  * In `src/app/page.tsx`, integrated `BottomNav` with `mobileTab` state (`'roster' | 'schedule' | 'alerts' | 'mod'`), opening sheet modals or scrolling to top on Roster tap.
* **Mobile Slide-Up Bottom Sheet Conversions (`src/components/PushModal.tsx`, `src/components/MyScheduleModal.tsx`, `src/components/ModDrawer.tsx`):**
  * Transformed `PushModal`, `MyScheduleModal`, and `ModDrawer` into clean mobile slide-up bottom sheets (`flex items-end justify-center md:items-center rounded-t-3xl md:rounded-2xl`).
  * Added visible mobile drag handle indicator bar (`h-1.5 w-12 rounded-full bg-night-border md:hidden shrink-0`).
  * Added dynamic safe-area bottom padding (`pb-[calc(1.5rem+env(safe-area-inset-bottom))] md:pb-6`) and enforced $\ge 44\text{px}$ touch targets across all dismiss, close, tab, and action buttons.
* **Standalone Onboarding & Join Route (`src/app/join/page.tsx`, `src/components/LoginModal.tsx`):**
  * Created full standalone onboarding and login route at `/join` designed specifically for mobile screens without virtual keyboard overlap (`min-h-[100dvh]`, `p-4 sm:p-6 pb-20`).
  * Two-tab switcher: **"New Fox (Join Den)"** and **"Returning Fox (Enter PIN)"** with full timezone selection, 24h bedtime input, Discord journal validation, 4-digit PIN setup/login, and Sleepy Fox mascot branding.
  * Added light 15ms haptic pulses on submit and tab changes.
  * Updated root auth checks in `src/app/page.tsx` and 401 unauthenticated handlers across check-in and strike voting to cleanly navigate to `/join`.
  * Deprecated `src/components/LoginModal.tsx` into a lightweight redirect shim to preserve backward compatibility.
* **Viewport Safe Areas, Dynamic Height & iOS Input Zoom Fixes (`src/app/layout.tsx`, `src/app/globals.css`):**
  * Configured `viewport: { width: 'device-width', initialScale: 1, maximumScale: 1, viewportFit: 'cover' }` in `src/app/layout.tsx` to handle notched mobile displays.
  * Set root body `min-h-[100dvh]` for mobile browser viewports.
  * Enforced `--safe-area-bottom: env(safe-area-inset-bottom, 0px)` and `--safe-area-top: env(safe-area-inset-top, 0px)` in `src/app/globals.css`.
  * Enforced `font-size: 16px !important` on all `<input>`, `<select>`, and `<textarea>` elements across the project to eliminate iOS Safari and PWA viewports auto-zooming when focusing fields.
* **Optimistic UI, Touch Targets & Haptics (`src/components/MemberCard.tsx`):**
  * Added instant optimistic state transitions for **"I'm In Bed"** check-in (`optimisticInBed`) and **"Nag / Assist"** button (`localNagCount`, `hasNagged`) with light 15ms haptic feedback (`triggerHaptic(15)`).
  * Implemented automated rollback with user-facing error toast alerts if the background API mutation fails.
  * Enforced minimum $44\text{px} \times 44\text{px}$ touch target sizes (`min-h-[44px] min-w-[44px]`) across all card actions, links, and buttons.
* **Verification:**
  * Created `scripts/test-phase2-mobile-touch-ux.mjs` test suite verifying all 28 requirements: 28/28 checks passed.
  * `node scripts/test-phase1-pwa-push.mjs`: 25/25 checks passed.
  * `node scripts/test-push-and-cron.mjs`: all tests passed.
  * `node scripts/test-e2e-api-endpoints.mjs`: all tests passed.
  * `npx tsc --noEmit`: 0 errors.
  * `npm run build`: 25/25 static & dynamic routes compiled cleanly.

### Phase 34: Community Accountability Mechanics & Serverless Security (Phase 4 Execution)
* **Supabase Schema & Table Hardening (`supabase/schema.sql` & `src/lib/db.ts`):**
  * Added `strikes_count` and `metastrikes_count` alias columns to `members` table in `supabase/schema.sql` with check constraints (`0 <= count <= 3`).
  * Created persistent serverless rate limiting table `rate_limit_entries` keyed by `key` (indexed on `key + reset_at` and `target_member_id + ip_address`) with service role RLS policies.
  * Added stored PostgreSQL function `reset_monthly_strikes()` for database-level calendar month rollovers.
  * Updated TypeScript interfaces in `src/lib/db.ts` (`RateLimitRecord`, `Member.strikes_count`, `Member.metastrikes_count`) and automated alias synchronization in `updateMemberSafe`.
* **Persistent Serverless Rate Limiter (`src/lib/rateLimit.ts`):**
  * Refactored from ephemeral in-memory maps to a persistent Supabase-backed table counter keyed by `target_member_id + ip_address` across ephemeral serverless instances.
  * Implemented dual sync + async interface (`checkPinRateLimitSync`, `checkPinRateLimitPersistent`, `recordPinFailurePersistent`, `resetPinFailurePersistent`, `clearAllPinRateLimitsPersistent`).
  * Provided thenable return structure on `checkPinRateLimit` ensuring 100% backward compatibility for synchronous unit test suites and awaitable serverless runtime usage.
  * Applied persistent rate limiting to PIN login attempts in `/api/auth/login/route.ts`, schedule updates in `/api/members/update-schedule/route.ts`, in-bed check-ins in `/api/members/in-bed/route.ts`, and administrative mutations in `/api/mod/route.ts`.
* **Moderator Route Consolidation & Server-Side Security (`src/app/api/mod/*` & `src/lib/auth.ts`):**
  * Deleted redundant re-export `src/app/api/mod/members/route.ts` to eliminate duplicate and ambiguous endpoints.
  * Implemented centralized `verifyModeratorAuthorization` in `src/lib/auth.ts` enforcing strict server-side validation across all handler operations in `/api/mod/route.ts` (supporting master `MOD_SECRET_PASSCODE` and authenticated moderator sessions).
  * Audited all administrative mutations with structured audit logs.
* **Community 2-Vote Strike Verification System (`/api/members/strike`, `/api/members/strikes`, `src/lib/strikes.ts`):**
  * Enforced 2 distinct community member verification votes to confirm a strike against an overdue member.
  * Strictly locked strike voting during the 5-minute bedtime grace period (`BEDTIME_GRACE`) and blocked voting if the target member has checked into bed for tonight.
  * Created strike endpoints at `/api/members/strike` and `POST /api/members/strikes` supporting `target_member_id`, `member_id`, and `targetMemberId`.
* **24-Hour Metastrike Emergency Window & Monthly Resets (`/api/members/metastrike`, `src/lib/strikes.ts`):**
  * Created `/api/members/metastrike` enabling members or moderators to claim proactive excuse passes or convert active strikes into excused Metastrikes within a strict 24-hour window following missed bedtimes.
  * Enforced automated monthly resets via `checkMonthlyStrikeReset` and database function `reset_monthly_strikes()`.
* **Interactive UI Buttons & Status Badges (`src/components/MemberCard.tsx`):**
  * Updated `MemberCard.tsx` to support both `strikes_count` and `strikes_used` aliases.
  * Rendered interactive peer 2-vote verification buttons (`Vote Strike (0/2)`, `Voted (1/2)`, `Strike Issued`) with haptic feedback.
  * Maintained out-of-strikes warning banners, grace countdowns, and self-service Metastrike excuse triggers.
* **Verification:**
  * `npx tsc --noEmit`: 0 errors.
  * `npm run build`: 26/26 static & dynamic routes compiled cleanly.
  * All test suites passed: `test-pin-rate-limiting.mjs`, `test-phase1-security.mjs`, `test-strikes-system.mjs`, `test-in-bed-and-streaks.mjs`, `test-gmt-timezones.mjs`, `test-weekend-hours.mjs`, `test-push-and-cron.mjs`, `test-e2e-api-endpoints.mjs`, `test-login-and-auth.mjs`.

### Phase 33: DST-Aware IANA Timezones, Canonical Sleep Cycle Anchor & Idempotent Cron Dispatcher (Phase 3 Core Spec Implementation)
* **DST-Aware IANA Timezone Refactoring (`src/lib/timezone.ts` & `src/lib/sleepEngine.ts`):**
  * Transitioned all member timezone storage and sleep calculations from static GMT offsets to strict IANA timezone identifiers (e.g., `Europe/Athens`, `America/New_York`, `Asia/Kolkata`).
  * Implemented `toValidLuxonZone`, `isValidTimezone`, `COMMON_IANA_TIMEZONES`, and `detectUserTimezone()`.
  * Preserved full Luxon `Zone` instances across `getNightBedtimeDateTime` and `computeMemberState`, guaranteeing resilience against Daylight Saving Time (DST) shifts (such as EDT/EST and EEST/EET transitions).
* **Client-Side IANA Auto-Detection & Onboarding (`src/app/join/page.tsx`, `src/app/api/auth/register/route.ts`, `src/app/api/members/route.ts`, `src/app/api/members/update-schedule/route.ts`, `src/components/MyScheduleModal.tsx`, `src/components/ModDrawer.tsx`):**
  * Auto-detects client timezone via `Intl.DateTimeFormat().resolvedOptions().timeZone` during onboarding (`/join`), self-service schedule editing (`MyScheduleModal`), and profile registration routes.
  * Validates timezone strings against Luxon's valid zones (`DateTime.now().setZone(tz).isValid`) before writing to Supabase, persisting the raw IANA identifier.
  * Formatted dropdown items using `formatGmtOffset` to render clear city names and localized GMT offsets without obscuring IANA identifiers.
* **Canonical Evening Sleep Cycle Anchor (`src/lib/sleepEngine.ts`, `src/app/api/members/in-bed/route.ts`):**
  * Implemented canonical "Sleep Cycle Date" anchor in `sleepEngine.ts` defined by the local evening date the sleep window begins.
  * Formulated circular time-delta math across midnight ($\pm 12$ hours / $\pm 720$ minutes relative to target bedtime) so early check-ins before midnight and grace-period check-ins after midnight resolve to the exact same sleep cycle date.
  * Updated check-in and cancellation flows (`/api/members/in-bed`) to persist `last_notified_stage` (`'IN_BED_EARLY'` / `null`) and `last_notified_cycle_date`.
* **Weekend Night Schedule Rules (`src/lib/sleepEngine.ts`, `scripts/test-weekend-hours.mjs`):**
  * Refactored weekend schedule rules (`isWeekendNight`, `isWeekendCycle`) so that weekend bedtimes strictly anchor to Friday and Saturday *nights* (the evenings when sleep begins), rather than Saturday and Sunday mornings.
  * Expanded `scripts/test-weekend-hours.mjs` with 32 comprehensive tests verifying canonical cycle anchors across midnight and Friday/Saturday evening rules.
* **Idempotent Cron Dispatcher & Rolling 30m Lookback Window (`src/lib/cronDispatcher.ts`, `supabase/schema.sql`, `src/lib/db.ts`):**
  * Added persistent tracking columns (`last_notified_stage`, `last_notified_cycle_date`) to `members` table in `supabase/schema.sql` and `Member` interface in `src/lib/db.ts`.
  * Refactored `executeNotificationDispatcher` in `src/lib/cronDispatcher.ts` to evaluate a rolling 30-minute lookback window (`0 <= diff <= 30` for `BEDTIME_HIT`, `-30 <= diff < 0` for `WIND_DOWN_30M`), protecting against GitHub Actions cron runner queue delays and jitter.
  * Implemented double-layer idempotency (persistent member row columns + `notification_logs` unique constraint) guaranteeing at most one notification dispatch per stage per sleep cycle.
* **Verification & Test Suite Hardening:**
  * Expanded `scripts/test-gmt-timezones.mjs` with tests for strict IANA timezones, Luxon zone mapping, and DST shifts across EDT/EST and EEST/EET (all 7 sections passing).
  * Expanded `scripts/test-weekend-hours.mjs` to 32 tests verifying Friday/Saturday night anchors and circular midnight boundaries (all 32 checks passing).
  * Expanded `scripts/test-push-and-cron.mjs` with rolling 30m lookback tests simulating cron runner jitter (+12m, -20m, +45m) and persistent column idempotency (all 4 sections passing).
  * Verified `npx tsc --noEmit` (0 errors) and `npm run build` (25/25 static & dynamic routes compiled cleanly).

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
│   ├── purge-demo-members.mjs          # Purges initial seed profiles from database
│   ├── seed-demo-members.mjs           # Restores demo seed profiles
│   ├── test-demo-seed-fingerprint.mjs  # Demo profile fingerprint & safe purge tests
│   ├── test-discord-webhook-and-assists.mjs # Discord Webhook & Nag Assist unit & live DB tests
│   ├── test-e2e-api-endpoints.mjs      # Live DB & Sleep Shield integration tests
│   ├── test-gmt-timezones.mjs          # GMT/UTC label formatting and offset tests
│   ├── test-in-bed-and-streaks.mjs     # Check-in, anti-spam & streak unit tests
│   ├── test-login-and-auth.mjs         # Member PIN login, session token & profile binding tests
│   ├── test-phase1-pwa-push.mjs        # 25-check suite for SW lifecycle, manifest, and multi-device push
│   ├── test-phase1-security.mjs        # Credential stripping & Phase 1 auth tests
│   ├── test-phase2-mobile-touch-ux.mjs # 28-check suite for BottomNav, 100dvh, iOS input zoom, and touch UX
│   ├── test-phase35-pwa-phone-robustness.mjs # 15-check suite for notch insets, dvh sheets, warm tokens, badging & offline
│   ├── test-pin-rate-limiting.mjs      # Shared per-member & per-IP rate limiting tests
│   ├── test-push-and-cron.mjs          # Push engine & cron Sleep Shield tests
│   ├── test-schedule-cooldown.mjs      # Verification tests for 48h cooldown logic
│   ├── test-signup-and-profiles.mjs    # Self-service profile creation tests
│   ├── test-strikes-system.mjs         # 24-test suite for community strikes, grace period, & metastrikes
│   ├── test-weekend-hours.mjs          # Weekend night scheduling & midnight crossover tests
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
│   │   │   │   ├── route.ts            # GET roster (with strikes, streaks, checkins & nag assists), POST member
│   │   │   │   ├── cancel-pending/     # POST cancel pending schedule change
│   │   │   │   ├── in-bed/
│   │   │   │   │   └── route.ts        # POST / GET "I'm in Bed" check-in & undo
│   │   │   │   ├── nag-assist/
│   │   │   │   │   └── route.ts        # POST / GET "Nagged!" community assist counter & deduplication
│   │   │   │   ├── strikes/
│   │   │   │   │   ├── route.ts        # GET member strike counts & tonight's strike log
│   │   │   │   │   ├── metastrike/
│   │   │   │   │   │   └── route.ts    # POST proactive metastrike & 24h retroactive swap
│   │   │   │   │   └── vote/
│   │   │   │   │       └── route.ts    # POST community 2-vote strike endpoint
│   │   │   │   └── update-schedule/    # POST request schedule change (48h queue)
│   │   │   ├── mod/
│   │   │   │   ├── route.ts            # Moderator action dispatcher (approve, reject, pin reset, strike adjust, clear log)
│   │   │   │   ├── members/route.ts    # Moderator member CRUD
│   │   │   │   └── webhook/route.ts    # Moderator Discord webhook test & morning digest trigger
│   │   │   └── push/
│   │   │       ├── subscribe/route.ts  # POST link device push subscription
│   │   │       ├── test/route.ts       # POST send test alert & dead token pruning
│   │   │       └── unsubscribe/route.ts# POST remove push subscription
│   │   ├── join/
│   │   │   └── page.tsx                # Standalone Onboarding & Join Den page
│   │   ├── globals.css                 # Warm dark theme CSS variables & Tailwind directives
│   │   ├── layout.tsx                  # Root layout with warm dark bg, metadata, PWA links
│   │   ├── not-found.tsx               # Warm dark 404 handler with Sleepy Fox mascot
│   │   └── page.tsx                    # Responsive dashboard (Desktop grid + Mobile PWA)
│   ├── components/
│   │   ├── BottomNav.tsx               # Mobile frosted bottom bar with 4 active tabs & moderator badge
│   │   ├── FoxMascot.tsx               # Minimalist Sleepy Fox mascot vector states
│   │   ├── Header.tsx                  # Top desktop command bar & clean mobile top bar
│   │   ├── LoginModal.tsx              # Member 4-digit PIN login & profile claiming modal
│   │   ├── MemberCard.tsx              # Dual-tz card, accountability row, strike voting, metastrike buttons & star
│   │   ├── MetastrikeModal.tsx         # Proactive & 24h retroactive Metastrike excuse modal
│   │   ├── ModDrawer.tsx               # Moderator drawer with approvals, roster, strike controls, and Discord webhook
│   │   ├── MyScheduleModal.tsx         # Self-service edit modal with check-in card & PIN verification
│   │   ├── PushModal.tsx               # Push notification preferences & Sleep Shield modal
│   │   ├── PwaBanner.tsx               # iOS/Android PWA install instructions & push gate
│   │   └── StatusBucket.tsx            # Bucket container (Nag Now, Winding Down, Awake, Sleeping)
│   └── lib/
│       ├── auth.ts                     # Moderator passcode & PIN hashing/verification & sessions
│       ├── cronDispatcher.ts           # Core cron dispatch, early check-in suppression, Discord webhook & Sleep Shield
│       ├── db.ts                       # Supabase client & TypeScript data models (strikes, metastrikes, nightly logs)
│       ├── demoSeed.ts                 # Pre-seeded demo profile fingerprints & matching logic
│       ├── discordWebhook.ts           # Discord webhook API client, embed formatters, and color tokens
│       ├── pushClient.ts               # Client-side Web Push & service worker registration
│       ├── pushServer.ts               # Web Push VAPID helper functions & error handling
│       ├── rateLimit.ts                # Sliding-window shared per-member & per-IP PIN rate limiter
│       ├── sleepEngine.ts              # Luxon timezone calculations, grace period, strikes & streaks
│       └── strikes.ts                  # Community 2-vote, proactive pass, 24h swap, & lazy reset engine
├── .coderabbit.yaml                    # CodeRabbit AI code review configuration & guardrails
├── AGENT_RULES.md                      # Hard guardrails & architectural constraints for AI agents
├── AGENTS.md                           # Multi-agent directives & handoff protocol
├── BACKEND_TZ_PWA_SPEC.md              # Technical specification for backend, timezones, & PWA
├── DESIGN_SYSTEM.md                    # Visual tokens, Warm Dark palette, & mascot specs
├── HANDOFF.md                          # (This file) Complete handoff & project state log
├── next.config.mjs                     # Next.js configuration (devIndicators: false)
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
| **ZC-14**| Epic / Phase 4: Monthly Strikes & Metastrikes Accountability System | **DONE** | Phase 25 |
| **ZC-15**| Mobile Layout Bugfixes & Standalone Onboarding Flow (`/join`) | **DONE** | Phase 29 |
| **ZC-16**| MemberCard & Status Bucket Headers Warm Dark Refactor | **DONE** | Phase 30 |
| **ZC-17**| Phase 1: Mobile PWA Lifecycle, Service Worker & Multi-Device Push | **DONE** | Phase 31 |
| **ZC-18**| Phase 2: Mobile Navigation, Standalone Onboarding & Touch UX | **DONE** | Phase 32 |
| **ZC-19**| Phase 3: Sleep Engine, IANA Timezone Math & Idempotent Cron | **DONE** | Phase 33 |
| **ZC-20**| Phase 4: Community Accountability Mechanics & Serverless Security | **DONE** | Phase 34 |
| **ZC-21**| Phase 35: PWA Phone Robustness, Safe Areas, Keyboard dvh & Offline Resilience | **DONE** | Phase 35 |
| **ZC-22**| Phase 36: Ubiquitous Member Log Out & Auth Session De-identification | **DONE** | Commit `ac191d0` |
| **ZC-23**| Phase 37: Code Review Remediations, Security Hardening & Concurrency Protection | **DONE** | Phase 37 |
| **ZC-24**| Phase 40: Comprehensive Code Review Remediations, Session Owner Auth & A11y | **DONE** | Phase 40 |
| **ZC-25**| Phase 41: Complete CodeRabbit Review Remediations & PR #17 Update | **DONE** | Phase 41 |

---

## 7. Immediate Next Steps (For the Next Agent / Session)

1. **Database Migration Execution in Supabase SQL Editor:**
   * Run the idempotent migration block from `supabase/schema.sql` on the remote Supabase database:
     ```sql
     ALTER TABLE members ADD COLUMN IF NOT EXISTS discord_id TEXT;
     ALTER TABLE members ADD COLUMN IF NOT EXISTS is_moderator BOOLEAN DEFAULT FALSE;
     ALTER TABLE members ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT FALSE;
     ALTER TABLE members ALTER COLUMN passcode_hash DROP NOT NULL;
     DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'members_discord_id_key') THEN
         ALTER TABLE members ADD CONSTRAINT members_discord_id_key UNIQUE (discord_id);
       END IF;
     END $$;
     CREATE INDEX IF NOT EXISTS idx_members_discord_id ON members(discord_id);
     ```

2. **Configure Discord Application & Environment Variables in Hosting Provider (Vercel):**
   * Set `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `NEXT_PUBLIC_APP_URL`, and `MOD_DISCORD_IDS` in Vercel project environment settings.
   * Add `${NEXT_PUBLIC_APP_URL}/api/auth/discord/callback` to OAuth2 Redirects in Discord Developer Portal.

3. **Monitor & Review Active Pull Request #19 (`krish` → `dev`):**
   * Review link: [PR #19](https://github.com/KrishJdev/Z-Catchers/pull/19)
   * Verify all automated checks pass on branch `krish`.
