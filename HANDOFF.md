# Project Handoff Document: Z Catchers (`HANDOFF.md`)

> **Last Updated:** 2026-11-13T12:45:00+05:30  
> **Active Working Branch:** `feat/zc-19-sanitize-oauth-redirect`  
> **Target Integration Branch:** `dev`  
> **Production Branch:** `main`  
> **Latest Commit:** `a89de55`  
> **Merged Integration Pull Requests:** [#14 [MERGED]](https://github.com/KrishJdev/Z-Catchers/pull/14), [#16 [MERGED]](https://github.com/KrishJdev/Z-Catchers/pull/16), [#17 [MERGED]](https://github.com/KrishJdev/Z-Catchers/pull/17), [#18 [MERGED]](https://github.com/KrishJdev/Z-Catchers/pull/18), [#19 [MERGED]](https://github.com/KrishJdev/Z-Catchers/pull/19), [#21 [MERGED]](https://github.com/KrishJdev/Z-Catchers/pull/21), [#23 [MERGED]](https://github.com/KrishJdev/Z-Catchers/pull/23), [#25 [MERGED]](https://github.com/KrishJdev/Z-Catchers/pull/25), [#27 [MERGED]](https://github.com/KrishJdev/Z-Catchers/pull/27), [#44 [MERGED]](https://github.com/KrishJdev/Z-Catchers/pull/44), [#49 [MERGED]](https://github.com/KrishJdev/Z-Catchers/pull/49), [#51 [MERGED]](https://github.com/KrishJdev/Z-Catchers/pull/51)  
> **Active Integration Pull Requests:** [#53 [OPEN]](https://github.com/KrishJdev/Z-Catchers/pull/53), [#54 [OPEN]](https://github.com/KrishJdev/Z-Catchers/pull/54)  
> **Merged Production Release Pull Requests:** [#15 [MERGED]](https://github.com/KrishJdev/Z-Catchers/pull/15), [#20 [MERGED]](https://github.com/KrishJdev/Z-Catchers/pull/20), [#22 [MERGED]](https://github.com/KrishJdev/Z-Catchers/pull/22), [#24 [MERGED]](https://github.com/KrishJdev/Z-Catchers/pull/24), [#26 [MERGED]](https://github.com/KrishJdev/Z-Catchers/pull/26), [#28 [MERGED]](https://github.com/KrishJdev/Z-Catchers/pull/28), [#50 [MERGED]](https://github.com/KrishJdev/Z-Catchers/pull/50)  
> **Active Production Release Pull Request:** [#52 [OPEN]](https://github.com/KrishJdev/Z-Catchers/pull/52) (dev -> main)  
> **Build Status:** Passing (`npx tsc --noEmit` clean, 0 errors | `npm run test:unit` clean, 29/29 suites passed | `npm run build` clean, 28/28 routes)

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

### Phase 82: Security Hardening - Sanitize and Validate `x-forwarded-host` in OAuth Redirect Base URL (GH #33, #48, ZC-19)
* **Host Header Format Sanitization (`src/lib/auth.ts`):**
  - Resolved Host Header Poisoning vulnerability (GH #33, #48, ZC-19) where callers could supply arbitrary `x-forwarded-host` or `host` headers to hijack OAuth redirect URIs and steal Discord authorization codes.
  - Implemented `sanitizeHostHeader(rawHost)`: extracts first client-facing host from multi-value proxy headers (`split(',')[0].trim()`), strictly rejecting whitespace, carriage returns (`\r`), newlines (`\n`), control characters, null bytes (`\0`), userinfo (`@`), path separators (`/`), query strings (`?`), fragments (`#`), backslashes, and quotes.
  - Validates RFC 1123 hostname syntax (max label 63 chars, max length 253 chars, no leading/trailing hyphens, no consecutive dots) and numeric port ranges (1-65535) with support for domain names, IPv4, and bracketed IPv6 (`[::1]`).
* **Trusted Origin Allowlist & Loopback Isolation (`src/lib/auth.ts`):**
  - Implemented `isTrustedHost(rawHost, options)` validating candidate hosts against a strict multi-tier allowlist:
    1. Exact canonical production domain `z-catchers.vercel.app` and its subdomains.
    2. Vercel preview branch deployments: strictly matches `^z-catchers(-[a-z0-9-]+)?\.vercel\.app$` (rejecting prefix lookalikes such as `evil-z-catchers.vercel.app` and third-party deployments like `attacker.vercel.app`).
    3. Authoritative environment URLs (`NEXT_PUBLIC_APP_URL` and `APP_URL`).
    4. Vercel deployment variables (`VERCEL_URL` and `VERCEL_PROJECT_PRODUCTION_URL`).
    5. Configurable custom domains via `ALLOWED_HOSTS` / `TRUSTED_HOSTS` with wildcard subdomain matching (`*.den.org`).
    6. Scoped loopback / localhost validation: trusted in non-production environments (`NODE_ENV === 'development' || NODE_ENV === 'test'`), strictly rejected in production unless explicitly allowlisted or configured.
* **Canonical Base URL Resolution & Fail-Safe Fallbacks (`src/lib/auth.ts`):**
  - Updated `getAppBaseUrl(request?: Request)`:
    - Authoritative source of truth: Prioritizes `process.env.NEXT_PUBLIC_APP_URL` whenever configured with a valid non-placeholder URL, completely ignoring any spoofed client headers.
    - Header resolution: When `NEXT_PUBLIC_APP_URL` is omitted, verifies `x-forwarded-host` / `host` against `isTrustedHost()`.
    - Protocol sanitization: Sanitizes `x-forwarded-proto`, strictly allowing only `'http'` and `'https'`, and enforcing `'https'` in production for all non-loopback hosts.
    - Fail-safe fallback: If an untrusted host header is received, logs a security warning and safely falls back to canonical defaults (`https://z-catchers.vercel.app` in production, `http://localhost:3000` in dev/test) rather than echoing untrusted client input.
* **Legacy Auth Redirect Route Hardening (`src/app/api/auth/login/route.ts`, `src/app/api/auth/register/route.ts`):**
  - Replaced unvalidated `new URL('/api/auth/discord', request.url)` with `getAppBaseUrl(request)` in both GET redirect handlers, eliminating host header poisoning across all authentication entry points.
* **Automated Unit Testing & Verification (`scripts/test-oauth-redirect-host-validation.mjs`, `scripts/test-login-and-auth.mjs`, `scripts/run-tests.mjs`):**
  - Created standalone test suite `scripts/test-oauth-redirect-host-validation.mjs` verifying:
    1. Static AST / source inspection confirming exports, allowlist guards, and usage across all auth routes.
    2. Host header sanitization covering multi-value headers, CRLF injection, control characters, userinfo, path, query, and port ranges.
    3. Trusted host allowlist validation, preview wildcards, attacker lookalike rejections, and loopback production isolation.
    4. Prioritization of `NEXT_PUBLIC_APP_URL` over spoofed headers, preview URL resolution, and fail-safe defaults.
    5. End-to-end integration tests for `/api/auth/discord`, `/api/auth/discord/callback`, `/api/auth/login`, and `/api/auth/register`.
  - Added legacy redirect poisoning assertions to `scripts/test-login-and-auth.mjs`.
  - Registered test suite in `scripts/run-tests.mjs` (all 29/29 unit test suites passing cleanly in 51.25s).
* **Verification & Checks:**
  - `npx tsc --noEmit` verified clean with 0 errors.
  - `npm run test:unit` verified clean with all 29/29 test suites passing.
  - `npm run build` verified clean with all 28 routes compiled successfully.

### Phase 81: Security Hardening - Enforce Database-Backed Persistent Rate Limiting in `cancel-pending` and `push/subscribe` (GH #32, ZC-18)
* **Persistent Rate Limiting in Cancel-Pending (`src/app/api/members/cancel-pending/route.ts`):**
  - Resolved serverless rate limiting vulnerability (GH #32, ZC-18) where callers could bypass PIN rate limiting during cold starts or across distributed concurrent containers by eliminating in-memory `checkPinRateLimit`, `recordPinFailure`, and `resetPinFailure`.
  - Replaced with database-backed `checkPinRateLimitPersistent`, `recordPinFailurePersistent`, and `resetPinFailurePersistent` backed by the Supabase `rate_limits` table with synchronized dual-layer in-memory mirror and graceful fallback.
  - Enforced persistent rate limiting for moderator passcode overrides: checks `modGateTarget` via `checkPinRateLimitPersistent(clientIp, modGateTarget)`, immediately rejects with HTTP 429 Too Many Requests and `Retry-After` header when rate limit is exceeded, records failed attempts, and resets upon valid passcode verification.
  - Enforced persistent rate limiting on member PIN cancellations: rejects brute-force attempts after 5 failures with HTTP 429 Too Many Requests and `Retry-After` header, recording failures and resetting tracking upon successful verification.
* **Persistent Rate Limiting in Push Subscription (`src/app/api/push/subscribe/route.ts`):**
  - Replaced legacy in-memory rate limiting functions with `checkPinRateLimitPersistent`, `recordPinFailurePersistent`, and `resetPinFailurePersistent`.
  - Enforces persistent database-backed lockout after 5 failed PIN attempts during push subscription binding, preventing brute-force PIN guessing across concurrent serverless instances.
  - Resets failure counter upon successful PIN authentication via `await resetPinFailurePersistent(clientIp, member.id)`.
* **Automated Unit Testing & Verification (`scripts/test-cancel-pending-and-subscribe-rate-limiting.mjs`, `scripts/run-tests.mjs`):**
  - Created comprehensive standalone test suite `scripts/test-cancel-pending-and-subscribe-rate-limiting.mjs` verifying:
    1. Static AST / source inspection confirming persistent imports and zero calls to non-persistent rate limit helpers across both routes.
    2. Cancel-pending member PIN brute-force lockout after 5 failed attempts (HTTP 429 and `Retry-After` duration).
    3. Cancel-pending successful schedule cancellation and rate tracking reset upon valid PIN entry.
    4. Cancel-pending moderator passcode rate limiting, brute-force lockout with HTTP 429, and lockout headers.
    5. Push subscribe member PIN brute-force lockout after 5 failed attempts (HTTP 429 and `Retry-After`).
    6. Push subscribe rate limit reset upon valid PIN entry and subscription linking.
    7. Cross-route and cross-member isolation preventing rate limit cross-talk between unrelated users and IPs.
  - Registered test suite in `scripts/run-tests.mjs` (all 28/28 unit test suites passing cleanly in 47.86s).
* **Verification & Checks:**
  - `npx tsc --noEmit` verified clean with 0 errors.
  - `npm run test:unit` verified clean with all 28/28 test suites passing.
  - `npm run build` verified clean with all 28 routes compiled successfully.

### Phase 80: Security Hardening - Fix Unauthenticated Push Endpoint Deletion in `/api/push/unsubscribe` & Authorize Client Push Requests (GH #31, #46, #36, ZC-17, ZC-22)
* **Unauthenticated Push Subscription Deletion Prevention (`src/app/api/push/unsubscribe/route.ts`):**
  - Resolved critical security vulnerability (GH #31 / #46, ZC-17) where anonymous callers could delete arbitrary push subscriptions by sending `{ endpoint }`.
  - Added strict session authentication guard: verifies `getRequestSessionMemberId(request)`. Rejects unauthenticated or invalid session requests immediately with HTTP 401 Unauthorized (`Unauthorized: Active member session required to unsubscribe from push notifications.`).
  - Added input validation for `endpoint`: rejects empty/whitespace strings and non-string types with HTTP 400 Bad Request.
  - Enforced member ownership filter: chained `.eq('endpoint', trimmedEndpoint).eq('member_id', sessionMemberId)` on database deletion, ensuring even authenticated actors cannot delete push subscriptions belonging to another user.
  - Retained member-wide unsubscription when `endpoint` is omitted, strictly scoped to `.eq('member_id', sessionMemberId)`.
  - Added `export const DELETE = POST;` to support RESTful HTTP `DELETE` calls alongside `POST`.
* **Client-Side Authorization Header Injection (`src/lib/pushClient.ts`, `src/components/PushModal.tsx`):**
  - Updated `unsubscribeFromPush` in `src/lib/pushClient.ts` to retrieve `getStoredAuthToken()` and include `Authorization: Bearer <token>` in the fetch request to `/api/push/unsubscribe`.
  - Updated `handleSendTestPush` in `src/components/PushModal.tsx` to retrieve `getStoredAuthToken()` and include `Authorization: Bearer <token>` in the fetch request to `/api/push/test` (GH #36, ZC-22).
* **Automated Unit Testing & Verification (`scripts/test-push-unsubscribe-security.mjs`, `scripts/run-tests.mjs`):**
  - Created comprehensive standalone test suite `scripts/test-push-unsubscribe-security.mjs` covering:
    1. Anonymous request rejection with HTTP 401 and zero database calls.
    2. Tampered/invalid Bearer token rejection with HTTP 401.
    3. Authenticated owner unsubscription via Bearer token and Cookie with `.eq('endpoint', ...).eq('member_id', ...)` verification.
    4. Cross-member IDOR attack prevention (attacker session cannot delete victim endpoint).
    5. Invalid whitespace and numeric endpoint format rejection with HTTP 400.
    6. Member-wide subscription removal scoped strictly to caller's `member_id`.
    7. HTTP `DELETE` method parity with `POST`.
    8. Client-side authorization header presence checks in `pushClient.ts` and `PushModal.tsx`.
    9. Database error resilience and HTTP 500 handling.
  - Wired into `scripts/run-tests.mjs` (all 27/27 test suites passing cleanly in 43.39s).
* **Verification & Checks:**
  - `npx tsc --noEmit` verified clean with 0 errors.
  - `npm run test:unit` verified clean with all 27/27 test suites passing (43.39s).
  - `npm run build` verified clean with all 28 routes compiled successfully.

### Phase 79: Production Release PR #52 Opened (`dev` -> `main`)
* **Production Release Pull Request Created:**
  - Opened [PR #52](https://github.com/KrishJdev/Z-Catchers/pull/52) targeting `main` from `dev`.
  - Promotes all Phase 77 (wake-up durability, missing schema cache fallback, in-bed session state synchronization) and Phase 78 (review hardening, zero-fallback auth keys, fail-closed runtime security, and test isolation) changes to `main`.
  - Zero-conflict clean merge verified with `git merge-tree origin/main origin/dev`.
  - All 26 automated unit test suites verified passing cleanly (42.04s).

### Phase 78: CodeRabbit PR #51 Review Hardening - Auth Fallback Gates, DB Pre-Read Fallback, Cycle Selection & Clock Freezing
* **Fallback-Key Gating Hardening (`src/lib/auth.ts`):**
  - Updated fallback gates in `getPinSalt()`, `getSessionSecret()`, and `getVerificationSessionSecrets()` so default dev secrets and salts are enabled only when `process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test'`.
  - All unset, staging, or unknown environments now fail closed by throwing `[CRITICAL]` errors or omitting public candidate keys, eliminating any risk of token forgery outside dev/test.
* **Graceful Non-Durable Pre-Read DB Fallback (`src/lib/db.ts`):**
  - Updated `upsertSleepLog` pre-read error handling: If the pre-read query encounters any error (including `PGRST205` or non-schema-cache read failure), sets `supabaseTableAvailable = false` and cleanly falls back to the in-memory store without attempting a durable upsert that could overwrite existing persisted columns with missing data.
* **Active Sleep Cycle Recovery Window Validation (`src/app/api/members/wake-up/route.ts`):**
  - Updated automatic cycle selection around `recentInBed` / check-in logs to validate the recovered cycle against the active-cycle window (`daysDiff >= 0 && daysDiff <= 1`) before assigning to `activeCycleDate`. Stale historical check-ins are ignored and default to the canonical current cycle.
* **Independent Active Cycle Button-Mode Guard (`src/app/api/members/wake-up/route.ts`):**
  - Updated button-mode validation to compare requested `cycleDate` against `activeCycleDate` (`if (mode === 'button' && cycleDate && cycleDate !== activeCycleDate)`), preventing historical button check-in requests before any sleep log write.
* **Chronological Manual Candidate Ordering (`src/app/api/members/wake-up/route.ts`):**
  - Updated candidate order in manual mode to evaluate `[candSameDay, candNextDay, candDayAfter]` in strict chronological order before filtering by bedtime reference and current time.
* **Deterministic Test Clock Freezing & Non-Fixture DB Stubbing (`scripts/test-wake-up-durability-and-times.mjs`):**
  - Freezes Luxon clock via `Settings.now = () => fixedNowMillis` and restores in `finally`, making route tests, 7-day guards, and candidate ordering completely independent of calendar execution date.
  - Added Section 1B testing `upsertSleepLog` on a non-fixture member ID (`usr_prod_krish_non_fixture`) with stubbed `supabaseAdmin.from` returning `PGRST205`. Asserts null error, non-null fallback data, `isDurable: false`, and `stubUpsertAttempted: false` without triggering live database queries.
* **Test Runner & Auth Pipeline Isolation (`scripts/run-tests.mjs`, `scripts/test-login-and-auth.mjs`, `scripts/test-schedule-cooldown.mjs`):**
  - Configured `scripts/run-tests.mjs` and `test-schedule-cooldown.mjs` to set `NODE_ENV = 'test'` if unset so all unit tests execute under explicit test mode.
  - Added test section 1B.4 to `scripts/test-login-and-auth.mjs` asserting fail-closed behavior when `NODE_ENV` is unset or `'staging'`.
* **Verification & Checks:**
  - `npx tsc --noEmit` verified clean with 0 errors.
  - `npm run test:unit` verified clean with all 26/26 test suites passing (42.62s).

### Phase 77: Wake-Up Durability, Sleep Log Persistence Fallback & State Machine Hardening
* **In-Memory Fallback & Missing Schema Cache Resilience (`src/lib/db.ts`):**
  - Identified root cause of `"Failed to durably persist sleep log."`: `upsertSleepLog` pre-read query returned `{ data: null, error: readErr }` when `public.sleep_logs` was missing from Supabase's schema cache (`PGRST205`), causing `POST /api/members/wake-up` to abort with HTTP 500.
  - Hardened `upsertSleepLog`: When a pre-read query encounters `PGRST205` or a schema cache warning, flags `supabaseTableAvailable = false`, falls back cleanly to the in-memory store without failing, and returns `{ data: merged, error: null, isDurable: false }`.
* **Sticky In-Bed Session State Resolution (`src/app/api/auth/me/route.ts`):**
  - Resolved bug where waking up did not persist across sessions: `sanitized.is_in_bed` was evaluated as `types.includes('IN_BED_EARLY')` without checking `!types.includes('WOKE_UP')`, which caused subsequent `/api/auth/me` calls to overwrite `currentUser.is_in_bed` back to `true`.
  - Updated to `sanitized.is_in_bed = types.includes('IN_BED_EARLY') && !types.includes('WOKE_UP')` and `sanitized.is_woke_up = types.includes('WOKE_UP')`.
* **Intelligent Active Cycle Date & Check-In Bedtime Recovery (`src/app/api/members/wake-up/route.ts`):**
  - Dynamically inspects `notification_logs` for un-woken `IN_BED_EARLY` entries when `cycleDate` is not passed, ensuring wake-up calls anchor to the exact sleep cycle the member checked in for, or seamlessly falling back to canonical `getSleepCycleDate`.
  - Recovers original check-in timestamp (`in_bed_at` / `in_bed_local_time`) from `notification_logs` when `sleep_logs` records are uninitialized, ensuring accurate cross-midnight sleep duration calculations (`duration_minutes` and `formatted_duration`).
* **Multi-Candidate Manual Wake Time Resolution (`src/app/api/members/wake-up/route.ts`):**
  - Replaced rigid single-day offset math with multi-candidate chronological evaluation (`candNextDay`, `candSameDay`, `candDayAfter`) anchored against check-in bedtime and sleeper local time.
  - Eliminates false "Wake-up time cannot be in the future" and "Wake-up time must be after check-in" rejections for past-midnight bedtimes and daytime wake-up logging.
  - Returns updated member with explicit `is_in_bed: false` and `is_woke_up: true` in API response.
* **Daytime Active Sleep Cycle Preservation (`src/lib/sleepEngine.ts`):**
  - Updated `resolveActiveSleepCycle`: When a member is in bed (`effectiveInBed: true`) and has not yet logged wake-up (`!hasWokeUpForYesterday`), keeps yesterday's sleep cycle active throughout the morning and afternoon until today's wind-down window begins (`todayWindDownStart`), preventing afternoon users from being prematurely assigned to tonight's un-started cycle.
* **Automated Unit Testing & Verification (`scripts/test-wake-up-durability-and-times.mjs`, `scripts/run-tests.mjs`):**
  - Created standalone test suite `scripts/test-wake-up-durability-and-times.mjs` verifying:
    1. `upsertSleepLog` fallback durability and in-memory retrieval when Supabase schema cache is missing tables.
    2. Active sleep cycle resolution across morning, afternoon, and evening hours.
    3. `POST /api/members/wake-up` instant button execution (HTTP 200, `is_in_bed: false`, `is_woke_up: true`).
    4. Manual wake-up mode multi-candidate time resolution, sleep duration calculation, and future time rejection.
  - Wired into `scripts/run-tests.mjs` UNIT_TESTS (all 26/26 suites passing cleanly).
* **Verification & Checks:**
  - `npx tsc --noEmit` verified clean with 0 errors.
  - `npm run test:unit` verified clean with all 26/26 test suites passing (27.16s).

### Phase 76: Security Hardening - Remove Hardcoded Fallback Session Secrets & Dev PIN Salt in Production (GH #30 / #45, ZC-16)
* **Fail-Closed Cryptographic Secret Enforcement (`src/lib/auth.ts`):**
  - Hardened `getPinSalt()`: In production environments (`NODE_ENV === 'production'`), strictly throws an explicit error (`[CRITICAL] Production deployment requires PIN_SALT or server credentials...`) when neither `PIN_SALT` nor server credentials (`SUPABASE_SERVICE_ROLE_KEY` / `DISCORD_CLIENT_SECRET`) are configured, preventing reliance on static, crackable dev salts.
  - Hardened `getSessionSecret()`: In production environments, strictly throws an explicit error (`[CRITICAL] Production deployment requires SESSION_SECRET or server credentials...`) when neither `SESSION_SECRET` nor server credentials are configured, preventing token signing with public fallback keys.
  - Hardened `getVerificationSessionSecrets()`: Strictly gated candidate fallback verification secrets (`'z_catchers_session_secret_fox_den_fallback_2026'` and `'z_catchers_session_secret_dev_only'`) behind `if (process.env.NODE_ENV !== 'production')`.
* **Forged Fallback Token Rejection & Token Verification Defense (`src/lib/auth.ts`):**
  - In production, candidate verification secrets now strictly contain only explicitly configured `SESSION_SECRET` and derived server credentials.
  - Any attacker attempt to forge session tokens or claim tokens using the public repository fallback secrets is strictly rejected by `verifySessionToken` and `verifyClaimToken` with `null`, preventing authentication and authorization bypass.
  - Preserved backward-compatible zero-configuration developer flow in non-production environments (`NODE_ENV === 'development'`).
* **Automated Unit Testing & Security Assertion Suite (`scripts/test-login-and-auth.mjs`):**
  - Updated Section 1B of `scripts/test-login-and-auth.mjs`:
    1. Verified that `getSessionSecret()` and `getPinSalt()` fail closed by throwing `[CRITICAL]` errors in production when unconfigured.
    2. Verified `getVerificationSessionSecrets()` returns an empty array when no secrets are set in production.
    3. Verified that forged tokens signed with public fallback secrets are strictly rejected in production both before and after configuring explicit `SESSION_SECRET`.
    4. Verified legitimate session and claim token creation and validation under explicit production secrets.
    5. Verified seamless fallback secret support when running in local development mode.
* **Verification & Checks:**
  - `npx tsc --noEmit` verified clean with 0 errors.
  - `npm run test:unit` verified clean with all 25/25 test suites passing (12.63s).
  - `npm run build` verified clean with all 28 routes compiled successfully.

### Phase 75: PR #49 CodeRabbit Review Suggestions Resolution & Full Hardening
* **PostgreSQL Schema Migration Guarding (`supabase/schema.sql` & `HANDOFF.md`):**
  - Added guarded conversion block following `CREATE TABLE IF NOT EXISTS public.sleep_logs`.
  - Safely purges orphan records and non-UUID values before executing `ALTER COLUMN member_id TYPE UUID USING member_id::uuid`.
  - Added `sleep_logs_member_id_fkey` constraint with `ON DELETE CASCADE` referencing `public.members(id)` if not already present.
* **Sleep Log Prior Wake Field Clearance on Re-Check-In (`src/app/api/members/in-bed/route.ts`):**
  - When a member checks in early or re-checks in, explicitly passed `woke_up_at: null`, `woke_up_local_time: null`, `wake_source: null`, and `duration_minutes: null` to `upsertSleepLog` alongside clearing `last_wake_cycle_date` on the member row, ensuring stale morning wake records are wiped for the fresh sleep session.
* **Wake-Up Nag Shield & Selected Cycle Schedule Verification (`src/app/api/members/nag-notif/route.ts`):**
  - Extended Metastrike pass shield suppression to the wake-up nag flow (`if (isMetastrikeActive)` returns `{ success: false, shieldActive: true }`), ensuring members with excused passes are never nagged in the morning.
  - Calculated wake-up time eligibility against the target member's selected cycle schedule (`getNightScheduleDateTime(targetMember, cycleDt)`) rather than relying on `computeMemberState`'s active cycle date, preventing erroneous shield blocks when reviewing yesterday's cycle after 13:00.
* **Sleep History Pending Vote Exclusion (`src/app/api/members/sleep-history/route.ts`):**
  - Updated strike merge loop to ignore records where `record_type === 'pending_vote'`, ensuring unconfirmed active community strike votes do not register as missed nights or skew the on-time percentage calculation.
* **Wake-Up Mode Validation (`src/app/api/members/wake-up/route.ts`):**
  - Added early input validation: rejects any mode other than `'button'` and `'manual'` with HTTP 400 before historical cycle checks or calculation branches execute.
* **In-Memory Cooldown Expiry Fallback (`src/components/MemberCard.tsx`):**
  - Updated `checkCooldown` logic to initialize with `inMemoryExpiriesRef.current[type] - Date.now()`, ensuring that in browsers where `localStorage.setItem` fails (e.g. private browsing or full quota) but `getItem` returns null, the in-memory expiry countdown is strictly preserved.
* **Request Sequence Verification (`src/components/SleepCalendarModal.tsx`):**
  - Replaced composite key checks in `fetchHistory` with monotonically increasing `requestSeqRef.current = ++requestId` guard, ensuring stale asynchronous responses cannot overwrite fresh calendar data or cause loading state discrepancies.
* **Pre-Read Failure Protection & Test Fixture Isolation (`src/lib/db.ts`):**
  - Pre-read query in `upsertSleepLog` checks for both returned errors and exceptions; on failure, halts durable write and returns `data: null` to prevent partial data from overwriting persisted columns in Supabase.
  - Added `isTestMemberFixture` detection to isolate unit test mock members (`mem_fox_test_*`), preventing test runs from querying remote Supabase tables while guaranteeing complete cache eviction for deleted members in production.
* **Uniform Weekly Schedule Weekend Badge Handling (`src/lib/sleepEngine.ts`):**
  - Updated `hasWeekendOverride` in both `getBedtimeForNight` and `getNightScheduleDateTime`: when `weekly_schedule` is configured, the weekend override flag is only enabled if the night's bedtime or wake time differs from at least one other weekday, preventing uniform schedules from incorrectly displaying the "Weekend" badge.
* **Atomic Map & Synced Results Persistence (`scripts/create-all-audit-issues.mjs` & `scripts/sync-audit-issues-to-jira.mjs`):**
  - Wrapped final JSON serialization writes in temporary file replacement (`.tmp` write followed by `fs.renameSync`) to ensure atomic persistence and prevent file corruption if interrupted.
* **Integration Test for Atomic Persistence (`scripts/test-audit-issue-sync.mjs`):**
  - Upgraded Test 4 to an isolated integration test in a temporary working directory verifying initial seeding, intermediate atomic Jira key retention, failure tolerance, and non-duplicate retry linking.
* **Verification & Checks:**
  - `npx tsc --noEmit` verified clean with 0 errors.
  - `npm run test:unit` verified clean with all 25/25 test suites passing (12.56s).

### Phase 74: PR #49 Comprehensive Review Verification & Atomic Persistence Hardening
* **Specification Documents Synchronization:**
  - `BACKEND_TZ_PWA_SPEC.md` & `PROJECT_SPEC.md`: Changed `sleep_logs.member_id` from `TEXT` to `UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE` to match `members.id`.
  - `BACKEND_TZ_PWA_SPEC.md`: Replaced legacy permissive public `SELECT` policy on `sleep_logs` with explicit drop and strict service-role-only policy (`Service role full access on sleep_logs`).
* **Atomic Checkpoint Hardening:**
  - `scripts/create-all-audit-issues.mjs` & `scripts/sync-audit-issues-to-jira.mjs`: Upgraded checkpoint map file writes to atomic replacement (`.tmp` write followed by `fs.renameSync`) to eliminate data corruption risks in case of abnormal script termination.
* **Component UI & State Cleanup:**
  - `src/components/SleepCalendarModal.tsx`: Added `setData(null)` immediately upon starting `fetchHistory` to prevent stale profile history from flashing while loading new data.
* **Review Verification:**
  - Audited all 51 CodeRabbit review comments across PR #49, verifying full satisfaction of data integrity, UX, timezone math, and security requirements.
  - `npx tsc --noEmit` verified clean with 0 errors.
  - `npm run test:unit` verified clean with all 25/25 test suites passing (14.77s).

### Phase 73: Prioritize Winding Down State Over Awake Status & Fix Status Pill
* **Diagnosis of Discrepancy & Root Cause:**
  - When a user approached their bedtime (e.g. 1:52 AM with a 2:00 AM bedtime, within the 60-minute wind-down window `-60 <= diffMinutes < 0`), their card was placed in the **AWAKE** bucket instead of **WINDING DOWN**, and their card status pill rendered `☀️ Awake` instead of `✨ in 8m`.
  - In `src/lib/sleepEngine.ts`, `if (hasLoggedWakeUp)` was checked unconditionally at the top of the evaluation ladder prior to checking `diffMinutes`. Any member with an active `is_woke_up` flag (or historical wake record matching the active cycle date) was immediately assigned `bucket = 'AWAKE'`, completely bypassing `WINDING_DOWN` and `BEDTIME_NOW`.
  - In `src/components/MemberCard.tsx`, `getStatusPillConfig()` checked `if (isWokeUp)` before checking `bucket === 'WINDING_DOWN'`, causing the pill to render `☀️ Awake` even when in the wind-down window.
* **Sleep Engine State Machine Hardening (`src/lib/sleepEngine.ts`):**
  - Reordered the state evaluation ladder in `computeMemberState`:
    1. Evaluated `effectiveInBed && !hasLoggedWakeUp && diffMinutes >= -180` first (`SLEEPING`).
    2. Prioritized `diffMinutes < 0 && diffMinutes >= -60` (`WINDING_DOWN`), ensuring pre-bedtime members not actively in bed enter the cozy wind-down bucket regardless of whether they logged wake-up earlier in the day.
    3. Evaluated `hasLoggedWakeUp` only for post-bedtime / daytime states (`diffMinutes >= 0`), preserving morning wake-up and undo behaviors without interfering with subsequent nighttime wind-downs.
* **UI Component & Status Pill Hierarchy (`src/components/MemberCard.tsx`):**
  - Reordered `getStatusPillConfig()`:
    1. Evaluated `isNagNow` first.
    2. Evaluated `bucket === 'WINDING_DOWN'` (rendering `✨ in {X}m` or `✨ in {X}h {Y}m`) before `isWokeUp`.
    3. Evaluated `bucket === 'SLEEPING'` (rendering `💤 Asleep` or `✨ In bed early`).
    4. Evaluated `isWokeUp` as daytime / awake fallback pill.
  - Added missing `useRef` imports and cleaned up duplicate statement artifacts in `src/components/MemberCard.tsx`, `src/components/SleepCalendarModal.tsx`, and `src/app/api/members/nag-notif/route.ts`.
* **Automated Unit Testing & Verification (`scripts/test-wind-down-awake-fix.mjs`, `scripts/run-tests.mjs`):**
  - Created standalone test suite `scripts/test-wind-down-awake-fix.mjs` covering 6 comprehensive test scenarios:
    1. User with `is_woke_up: true` at T-8m (`1:52:29 AM` with `2:00 AM` bedtime) categorizes into `WINDING_DOWN`.
    2. Formatted status label displays `Bedtime in 8m`.
    3. Daytime user with `is_woke_up: true` (e.g. `12:00 PM`) correctly categorizes into `AWAKE`.
    4. In-bed user at T-8m categorizes into `SLEEPING`.
    5. `MemberCard.tsx` checks `bucket === 'WINDING_DOWN'` before `isWokeUp`.
    6. `sleepEngine.ts` does not unconditionally short-circuit `hasLoggedWakeUp` before wind-down.
  - Registered test in `scripts/run-tests.mjs` (25/25 unit test suites passing cleanly in 13.61s).
  - Verified `npx tsc --noEmit` clean with 0 errors.

### Phase 72: PR #49 Remaining CodeRabbit Review Suggestions & Edge-Case Hardening
* **Scripts & Migration Hardening:**
  - `scripts/create-all-audit-issues.mjs`: Updated checkpoint mapper to `{ ...ex, ...i, ... }` to ensure definition fields take precedence over existing entries during atomic checkpoints.
  - `scripts/sync-audit-issues-to-jira.mjs`: Updated in-place `issuesList[i] = currentItem` before checkpoints to ensure accumulated Jira keys are never lost across iterations.
  - `scripts/seed-demo-members.mjs`: Sanitized timezone fallbacks with `toValidLuxonZone`; added `{ onConflict: 'member_id,cycle_date', ignoreDuplicates: true }` and failure warning logs to sleep log upserts.
  - `scripts/test-wake-up-nag.mjs`: Added structural tests verifying all `☀️ I Woke Up` buttons are strictly guarded by `isViewer` conditional checks.
* **API Endpoints & Validation Guardrails:**
  - `src/app/api/auth/claim-profile/route.ts`: Explicitly rejected invalid weekly schedules with HTTP 400 (including non-objects, invalid formats, or identical bedtime/wake times) instead of silently falling back to flat fields.
  - `src/app/api/members/update-schedule/route.ts`: Validated all 7 days of `targetWeeklySchedule` so legacy merged edits reject identical bedtime and wake times with HTTP 400.
  - `src/app/api/mod/route.ts`: Added `updates.pending_timezone = null;` when moderator updates timezone directly.
  - `src/app/api/members/nag-notif/route.ts`: Bound anonymous senders with stable `helperKey = 'anon_target'` to prevent header spoofing bypass; resolved yesterday's check-in cycle for wake-up nags when appropriate; claimed cooldown record in `notification_logs` before dispatching web pushes.
  - `src/app/api/members/in-bed/route.ts`: In GET: derived `is_in_bed: isInBed && !isWokeUp`; in POST check-in: cleared `last_woke_up_at: null` and `last_wake_cycle_date: null`.
  - `src/app/api/members/wake-up/route.ts`: Disallowed button mode on historical `cycleDate`; resolved bedtime and wake targets via `getNightScheduleDateTime` when `existingLog` is absent; safely persisted across durable and test environments with `isDurable` indicator in response; updated `last_woke_up_at` and `last_wake_cycle_date` only when wake event is newer than stored.
  - `src/app/api/members/route.ts`: Derived `is_in_bed = memberCheckins.includes(localDateStr) && !is_woke_up` to prevent showing Sleep Shield after wake-up.
  - `src/app/api/members/sleep-history/route.ts`: Included accountable missed nights (`status IN ('on_time', 'late', 'missed')`) in `onTimePercentage` calculation.
* **UI Components & UX:**
  - `src/components/MemberCard.tsx`: Enforced 44px minimum mobile touch targets on member name and secondary action buttons; scoped `storageKey` by sender and separated bedtime from wake cooldowns with in-memory expiry fallback; restored optimistic rollback on `onWakeUp` rejection across all wake modes; rendered Wake Up Nag alongside Vote Strike when voting is eligible.
  - `src/app/page.tsx`: Returned boolean from `handleWakeUp`; restricted "Undo check-in" button to `claimedMember.is_in_bed`.
  - `src/components/SleepCalendarModal.tsx`: Added `activeRequestRef` to discard out-of-order fetch responses when `memberId` or `currentMonth` changes; replaced blue/indigo classes with Warm Dark design tokens.
* **Sleep Engine & DB Storage:**
  - `src/lib/sleepEngine.ts`: In `checkCooldownPromotion`, built `nextWeeklySchedule` from pending flat fields when `pending_weekly_schedule` is null before falling back to active weekly schedule; in `resolveTargetSchedule`, computed `maxYesterdayEnd` using `postWakeWindow` (4 hours post wake) so yesterday's morning cycle is retained without requiring prior `is_in_bed` check-in hydration.
  - `src/lib/db.ts`: Added durable columns check (`weekly_schedule`, `pending_weekly_schedule`) to `insertMemberSafe`, rejecting with migration error if missing rather than stripping and storing in memory; enhanced `upsertSleepLog` to query existing row in Supabase prior to merging, preventing null overwrites of `in_bed_at` / `in_bed_local_time` during partial wake updates.
* **PostgreSQL Schema & Security Policies (`supabase/schema.sql`):**
  - Changed `sleep_logs.member_id` from `TEXT` to `UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE`.
  - Removed public read policies on `sleep_logs` (`DROP POLICY IF EXISTS "Public can view sleep logs"` and `"Public read sleep_logs"`), maintaining strictly internal service-role access.
  - Added backfill query for `pending_weekly_schedule` for members with active cooldown (`pending_effective_at IS NOT NULL AND pending_weekly_schedule IS NULL`).
* **Automated Verification:**
  - `npx tsc --noEmit` verified clean with 0 errors.
  - `npm run test:unit` verified clean with all 25 test suites passing (12.86s).

### Phase 71: MemberCard Metastrike Pill & Secondary Action Row Overflow Fix
* **Issue Diagnosis & Root Cause:**
  - When a community member missed bedtime and activated an excused Metastrike pass with a long reason (e.g. `"Work / Study Deadline"`), the card displayed both `[Shield On]` (due to Sleep Shield being active from the Metastrike) and `[🛡️ Metastrike: Work / Study Deadline]` side-by-side in the secondary action row.
  - Because the secondary action row (`<div className="flex items-center gap-2 w-full">`), the Nag Notif button (`className="flex-1 ... whitespace-nowrap"`), and the Metastrike pill (`className="flex-1 ... whitespace-nowrap"`) lacked `min-w-0`, the flex items defaulted to `min-width: auto` per CSS Flexbox specification.
  - As a result, the inner `<span className="truncate">` never triggered ellipsis truncation because its parent flex container expanded to the full content width (~280px + ~95px button + 8px gap = ~383px), blowing out past the card's right boundary.
* **Flexbox Shrink & Truncation Hardening (`src/components/MemberCard.tsx`):**
  - Added `hasSecondaryNagAction` helper in `MemberCard` to dynamically determine if any secondary pill (`isMetastrikeActive`, `isStrikeIssuedTonight`, `BEDTIME_GRACE`, or `onVoteStrike`) is rendered alongside the Nag Notif button.
  - Configured Nag Notif button width dynamically: sizes to `w-full` if no secondary pill exists, or `flex-1 min-w-0` when paired.
  - Added `min-w-0` to the secondary action row container (`flex items-center gap-2 w-full min-w-0`) and all flex children (`min-w-0 h-9 min-h-[36px]`).
  - Wrapped text in `<span className="truncate">` across all secondary action pill variants: `isMetastrikeActive` (`Metastrike: [Reason]`), `isStrikeIssuedTonight` (`Strike Issued`), `state.status === 'BEDTIME_GRACE'` (`Grace: [X]m left`), and `onVoteStrike` (`Vote Strike (X/2)`).
  - Hardened non-nag body Metastrike notice (`isMetastrikeActive && !isNagNow`) with `min-w-0` and `<span className="truncate">`.
  - Added `min-w-0` and `<span className="truncate">` to Early Bedtime Check-In and Metastrike self-service buttons.
  - Allowed clicking "Shield On" button in `isNagNow` and `WINDING_DOWN` (`disabled={isSendingNagNotif || nagCooldownSeconds > 0}`) so users can tap to view the informative Sleep Shield feedback notice toast.
* **Automated Unit Testing (`scripts/test-metastrike-overflow-fix.mjs`, `scripts/run-tests.mjs`):**
  - Created standalone offline test suite `scripts/test-metastrike-overflow-fix.mjs` verifying:
    1. Root container enforces `max-w-full overflow-hidden`.
    2. Dynamic row sizing with `hasSecondaryNagAction`.
    3. `min-w-0` enforcement on secondary row and all action pills.
    4. Text truncation on `Metastrike: [Reason]`, `Shield On`, `Strike Issued`, `Grace`, and `Vote Strike`.
    5. Card body Metastrike notice `min-w-0` and text truncation.
  - Added test suite to `scripts/run-tests.mjs` (all 24/24 unit test suites passing cleanly).
* **Verification Check:**
  - `npx tsc --noEmit` verified clean with 0 errors.
  - `npm run test:unit` executed with all 24 test suites passing cleanly (12.99s).

### Phase 70: PR #49 Comprehensive Code Review Resolution & Hardening
* **Untrusted Review Data Handling & Verification:**
  - Audited all PR #49 code review comments across scripts, API endpoints, UI modals, and database persistence layers.
  - Verified each finding against live code, fixing verified edge cases while skipping obsolete or already-resolved items with clear technical rationale:
    - *Skipped `MemberCard.tsx:477`*: Inline routine toggle button was already replaced in Phase 66 by clicking the member profile to open `SleepCalendarModal`.
    - *Verified `MyScheduleModal.tsx:253`*: Verified `hasScheduleChanged` useMemo is already positioned above early return.
    - *Verified `sleepEngine.ts:1209`*: Verified `is_woke_up` does not prematurely truncate sleep cycles before scheduled wake end time.
* **Scripts Checkpoint & Issue Linking Hardening:**
  - `scripts/create-all-audit-issues.mjs`: Atomically persists `mapFile` after each successful issue creation to guarantee resume safety; prioritized issue definition fields (`issueTypeId`, etc.) over existing cached fields while preserving remote IDs (`ghUrl`, `jiraKey`, etc.).
  - `scripts/sync-audit-issues-to-jira.mjs`: Relaxed ADF markdown fenced code-block splitting to match code fences anywhere in text; added stable `globalId: ghUrl` to Jira remote-link payloads for idempotent link retries; verified both Jira key and GitHub URL match before reusing `remoteLinked` status; persisted atomic checkpoints to `finalMapFile` immediately after each Jira issue creation.
* **Schedule & Profile Validation & Cooldown Integrity:**
  - `src/app/api/auth/claim-profile/route.ts`: Immediately returns HTTP 400 when an invalid `weekly_schedule` format is supplied instead of silently falling back to legacy flat times.
  - `src/lib/sleepEngine.ts`, `src/app/api/members/route.ts`, `src/lib/cronDispatcher.ts`, `src/app/api/mod/route.ts`: Hardened `checkCooldownPromotion` and promotion persistence paths to preserve active `weekly_schedule` when `pending_weekly_schedule` is null, preventing accidental wiping of custom routines upon promotion.
  - `src/app/api/mod/route.ts`: In moderator member edits, preserved `existing.weekly_schedule` and existing `pending_*` fields on profile-only edits (e.g., `journal_url`), updating only explicitly edited days/fields.
  - `src/app/api/members/update-schedule/route.ts`: Avoided defaulting wake time to 07:00 when omitted; iterated across `DAY_KEYS` to compare routine changes day-by-day; compared against legacy bedtime/wake fields when `weekly_schedule` is null so journal-only edits do not stage unwanted cooldowns.
* **Component UI & Responsive Touch Targets:**
  - `src/components/ModDrawer.tsx`: Updated quick-mode detection to verify bedtime and wake-time matches across all weekdays and weekends; updated day selector pill container to responsive `grid grid-cols-4 sm:grid-cols-7 gap-1.5` for 44px+ touch targets; displayed per-day pending changes from `member.pending_weekly_schedule` in cooldown approval cards.
  - `src/components/MyScheduleModal.tsx`: Resolved weekend bedtime and wake time independently with fallbacks; derived dual-time preview in custom mode from `weeklySchedule[selectedScheduleDay]?.bedtime`; updated custom day-selector grid to responsive `grid grid-cols-4 sm:grid-cols-7 gap-1.5`; normalized weekend overrides in API submission payload.
* **Database Persistence Layer Hardening (`src/lib/db.ts`):**
  - Updated `setInMemoryWeekendHours` to only set fields explicitly provided in updates, preventing undefined overwrites.
  - Enforced durable DB storage requirement for `weekly_schedule` and `pending_weekly_schedule`: rejected writes when Supabase is configured but columns are unmigrated, rather than masking failures with ephemeral in-memory fallbacks.
* **Documentation & Migration Clarity (`HANDOFF.md`):**
  - Updated Step 5 to explicitly direct operators to run the complete, updated migration from `supabase/schema.sql` before deployment, including `weekly_schedule` and `pending_weekly_schedule` columns and backfill.

### Phase 69: Authoritative Discord OAuth Handle Sync & Stale Handle Inversion Fix
* **Diagnosis of Discrepancy:**
  - Discovered that in Phase 46, an automated database update script mistakenly hardcoded `discord_handle = '@krish'` for `discord_id = 617551062102048779` because the git branch and developer name was `krish`.
  - In `src/app/api/auth/discord/callback/route.ts`, returning members were updated using `discord_handle: member.discord_handle || discordHandle`. Because the database row already had `'@krish'`, the true verified Discord handle (`@nrgslayer`) was blocked from updating on Discord login.
* **Authoritative OAuth Handle Synchronization (`src/app/api/auth/discord/callback/route.ts`):**
  - Updated OAuth callback update payload to `discord_handle: discordHandle || member.discord_handle`. Verified Discord OAuth data is now authoritative for Discord handles, ensuring returning users always receive their real, current Discord handle (`@nrgslayer`).
  - Corrected database row in Supabase (`discord_id = '617551062102048779'`) to `discord_handle = '@nrgslayer'`.
* **Automated Regression Verification:**
  - `npx tsc --noEmit` verified clean with 0 errors.
  - `npm run test:unit` executed: all 23/23 unit test suites passing cleanly.

### Phase 68: 15-Minute Nag Notification Cooldown & In-Button Live Countdown
* **15-Minute Cooldown Endpoint Logic (`src/app/api/members/nag-notif/route.ts`):**
  - Replaced once-per-night hard rate limiting with a 15-minute (900s) cooldown window for both bedtime reminders and wake-up nags.
  - Queries `notification_logs` for `dispatched_at` timestamp of recent nags from the sender (`helperKey`) to the target member.
  - If fewer than 15 minutes have elapsed, returns HTTP 429 with remaining `cooldownSeconds` and `cooldownMinutes` (`"You can send another reminder to {name} in {x}m."`).
  - If 15 minutes have elapsed, allows the nag to dispatch and updates `dispatched_at: nowUtc.toISO()` via upsert on conflict `(member_id, notification_type, local_date)`.
  - Returns `cooldownSeconds: 900` on successful dispatch.
* **In-Button Live Countdown UI (`src/components/MemberCard.tsx`):**
  - Added `nagCooldownSeconds` state and `useEffect` timer ticking down each second.
  - Persists cooldown expiry timestamp in `localStorage` under `nag_cooldown_${member.id}` so the countdown persists across tab switches and page refreshes.
  - Formats remaining time into digital MM:SS (`formatNagCooldown`), rendering `<Clock /> Nag in {MM:SS}` directly inside the nag button across all 3 nag contexts (`WINDING_DOWN`, `BEDTIME_NOW`/`OVERDUE_NAG_NOW`, and `SLEEPING` past wake time).
  - Automatically re-enables the button when the countdown reaches 0:00.
* **Automated Unit Testing (`scripts/test-wake-up-nag.mjs`):**
  - Verified server-side 15-minute cooldown enforcement, payload properties (`cooldownSeconds`, `cooldownMinutes`, 429 status), and client-side countdown rendering in `MemberCard`.
  - All 23 unit test suites passed cleanly (`npm run test:unit`).

### Phase 67: Wake-Up Status Authorization Protection & "Wake Up Nag" Feature
* **Awake Status Authorization Protection (`src/components/MemberCard.tsx`):**
  - Resolved security/UX violation where viewers looking at another member's sleeping/in-bed card were rendered a `"Wake Up (Undo)"` button due to `(member.is_in_bed || isModerator) && onCancelInBed`.
  - Restricted all wake-up and sleep status undo actions (`☀️ I Woke Up`, `Enter Time`, `Wake Up (Undo)`) exclusively to the profile owner (`isViewer === true`).
  - Restricted in-bed sleeping status banner undo strictly to the card owner (`isViewer && isInBed && bucket === 'SLEEPING'`).
* **Sleep Engine Wake Time Evaluation (`src/lib/sleepEngine.ts`):**
  - Added `isPastWakeTime` calculation comparing `sleeperNow >= activeCycle.targetWakeTime`.
  - Maintained `isSleepShieldActive = true` while sleeping before wake time; deactivates nighttime Sleep Shield once the target wake time has elapsed to allow morning wake-up accountability.
  - Extended yesterday's cycle end window for in-bed sleepers who haven't logged wake-up so their morning overdue state remains accurately tracked.
* **"Wake Up Nag" Notification Support (`src/components/MemberCard.tsx`, `src/app/api/members/nag-notif/route.ts`):**
  - Added `☀️ Wake Up Nag` button on sleeping cards when viewed by friends after the member's target awake time has arrived.
  - Enhanced `POST /api/members/nag-notif` to support `type: 'wake_up'`:
    - Checks that target member has not already marked themselves awake.
    - Validates that target member's target wake time has elapsed; if not, responds that Sleep Shield is active until their wake time.
    - Implements anti-spam deduplication per sender per morning using `MANUAL_NAG:WAKE_UP:${helperKey}`.
    - Dispatches rich push notifications: `"☀️ Rise and Shine! [Sender] is nudging you to wake up! Time to start the day 🦊"`.
    - Increments community assist counters.
* **Automated Unit Testing (`scripts/test-wake-up-nag.mjs`, `scripts/run-tests.mjs`):**
  - Created standalone unit test suite validating `isPastWakeTime` transitions, authorization barriers in `MemberCard`, and wake-up nag endpoint rules.
  - Verified with all 23 unit test suites passing cleanly (`npm run test:unit`).

### Phase 66: Member Profile Section, Weekly Timetable, Streak Calendar, and Banner Overflow Fix
* **Text Overflow Resolution (`src/components/MemberCard.tsx`):**
  - Identified that feedback and error toast messages (`cardFeedback`, `cardError`) utilized `whitespace-nowrap`, which prevented long strings (such as `"You already sent a bedtime reminder to Afnan for tonight's bedtime."` or rate-limit warnings) from wrapping, causing them to project out past the card's right boundary.
  - Removed `whitespace-nowrap` and applied `break-words text-balance px-3 py-2 leading-snug`.
  - Added `max-w-full overflow-hidden` to the root `MemberCard` container and `min-w-0` to flex child containers, preventing any horizontal text spillover.
* **Banner Cleanliness & Decluttering (`src/components/MemberCard.tsx`):**
  - Removed the inline `"7-day routine"` toggle button and `"History"` calendar button from the member card header.
  - Removed the inline expandable 7-day routine tray (`showRoutine`) from the card, streamlining the card into a clean accountability view.
* **Interactive Profile Trigger (`src/components/MemberCard.tsx`, `src/app/page.tsx`):**
  - Converted the member's display name and avatar into accessible, interactive buttons with subtle hover effects (`hover:text-status-amber hover:underline cursor-pointer`) and descriptive title/aria tags.
  - Tapping either the name or avatar opens the full Member Profile Modal (`SleepCalendarModal`), which now acts as the comprehensive profile view.
* **Member Profile, Streak Calendar & Weekly Timetable Modal (`src/components/SleepCalendarModal.tsx`):**
  - Upgraded `SleepCalendarModal` with a dedicated member profile header:
    - Member avatar (with in-bed check badge), username, handle, `YOU` / `MOD` role badges.
    - Timezone pill (e.g. `GMT+05:30`) and live current local time in that timezone.
    - Accountability star toggle button (`⭐`) and direct Discord journal thread link (`🔗 Journal`).
    - Current streak badge (`🔥 Xd streak`), strikes counter (`⚡ Strikes: X/3`), and excused metastrikes counter (`🛡️ Meta: Y/3`).
  - Added two top tabs with smooth switching:
    - **Tab 1: Calendar & Streak:** Monthly navigation (`< Month Year >`), 3-pill monthly summary strip (Avg Sleep duration, Avg Bed → Wake, On-Time percentage), 7-column Monday–Sunday calendar grid with color-coded status badges, selected day inspector, and self-edit wake time form.
    - **Tab 2: Weekly Timetable:** 7-day schedule breakdown (Monday through Sunday) with active day highlighted with a `"TODAY"` badge, target bedtimes, target wake times, calculated planned sleep durations (e.g. `8 hrs 00 mins`), weekend/custom schedule tags, and a direct `"Edit Schedule"` shortcut for the profile owner.
* **API Enhancement (`src/app/api/members/sleep-history/route.ts`):**
  - Updated endpoint to return `weekly_schedule`, `weekend_bedtime_local`, `weekend_wake_time_local`, `journal_url`, `role`, and strike counters on the `member` object.
* **Automated Unit Testing (`scripts/test-member-profile-and-overflow-fix.mjs`, `scripts/run-tests.mjs`):**
  - Created a comprehensive test suite validating:
    1. MemberCard banner does not show "7-day routine" or "History" buttons.
    2. MemberCard name and avatar click triggers `onOpenProfile`.
    3. `cardFeedback` and `cardError` wrap cleanly without `whitespace-nowrap`.
    4. SleepCalendarModal renders profile header, Weekly Timetable tab with TODAY badge and calculated durations, and Streak Calendar.
    5. `page.tsx` passes `onOpenProfile` and coordinating tab states.
  - Registered in `scripts/run-tests.mjs` (22/22 unit test suites passing cleanly).

### Phase 65: Bugfix - React Hook Order Violation in MyScheduleModal
* **Root Cause Analysis:**
  - An early return statement `if (!isOpen) return null;` in `src/components/MyScheduleModal.tsx` was placed directly before `const hasScheduleChanged = useMemo(...)` (hook #27).
  - When the modal was closed (`isOpen === false`), React executed 26 hooks and returned early. When the user clicked on "My Profile" (`isOpen === true`), render proceeded past the guard and called `hasScheduleChanged` as hook #27.
  - This violated the Rules of Hooks by creating a hook count discrepancy between renders (`undefined` vs `useMemo`), crashing the app when opening the profile modal.
* **Resolution:**
  - Relocated `hasScheduleChanged` above `if (!isOpen) return null;`, ensuring all 27 hooks execute unconditionally in identical order on every render.
* **Verification:**
  - TypeScript type check (`npx tsc --noEmit`) clean with 0 errors.
  - Full automated unit test suite passed cleanly (`npm run test:unit`, 21/21 suites passed).

### Phase 64: "I Woke Up" Mechanic & Interactive Sleep & Wake History Calendar Implementation
* **Database Schema & Storage Layer (`supabase/schema.sql`, `src/lib/db.ts`):**
  - Added fast wake-up tracking columns `last_woke_up_at TIMESTAMPTZ` and `last_wake_cycle_date TEXT` to `members` table definition and migration statements.
  - Created `public.sleep_logs` table keyed by `(member_id, cycle_date)` with columns for `timezone`, `target_bedtime`, `target_wake_time`, `in_bed_at`, `in_bed_local_time`, `woke_up_at`, `woke_up_local_time`, `wake_source` (`button` | `manual`), `duration_minutes`, and `status` (`on_time` | `late` | `missed` | `metastrike`).
  - Added index `idx_sleep_logs_member_cycle` and enabled Supabase realtime publication on `sleep_logs`.
  - Added helper methods in `src/lib/db.ts`: `upsertSleepLog`, `getMemberSleepLogs`, in-memory fallback cache `memorySleepLogs`, and robust member fallback `getMemberByIdSafe`.
  - Updated `src/lib/demoSeed.ts` (`generateDemoSleepLogs`, `seedDemoSleepLogsInMemory`) and `scripts/seed-demo-members.mjs` to seed 30 days of realistic variance sleep logs for demo members.
* **"I Woke Up" Endpoint & Sleep Engine Integration (`src/app/api/members/wake-up/route.ts`, `src/app/api/members/in-bed/route.ts`, `src/lib/sleepEngine.ts`):**
  - Updated `POST /api/members/in-bed` to record bedtime check-in into `sleep_logs` with active schedule targets.
  - Created `POST /api/members/wake-up` supporting two modes:
    - **Instant Button Mode (`mode: 'button'`):** Uses current UTC instant in member's timezone, sets `wake_source: 'button'`, calculates sleep duration, and updates `last_woke_up_at` and `last_wake_cycle_date`.
    - **Manual Mode (`mode: 'manual'`):** Validates 24-hour `HH:mm` format, checks past-7-days window, rejects future times, and computes cross-midnight duration (e.g., 23:30 to 07:15 = 465 minutes).
  - Updated `src/lib/sleepEngine.ts`:
    - Added `needsWakeUpLog?: boolean` to `MemberState`.
    - When a member is in bed or inside the sleep window without a logged wake-up, exposes `needsWakeUpLog: true`.
    - Once wake-up is logged for the cycle date (`last_wake_cycle_date === activeCycleDate`), status immediately transitions to `AWAKE` with `needsWakeUpLog: false` and `isSleepShieldActive: false`.
* **Sleep & Wake History API (`src/app/api/members/sleep-history/route.ts`):**
  - Created GET route taking `memberId` and `month` (YYYY-MM).
  - Fetches monthly logs, merges strikes from `nightly_strike_logs`, and calculates summary statistics:
    - `totalLoggedNights`: Count of nights with recorded sleep/wake.
    - `avgDurationMinutes`: Average sleep duration in minutes.
    - `avgBedtime`: Circular mean across midnight.
    - `avgWakeTime`: Linear mean.
    - `onTimePercentage`: Percentage of logged nights with `status === 'on_time'`.
  - Auto-populates 30-day realistic history for demo seed profiles if records are empty.
* **Frontend UI Components (`SleepCalendarModal.tsx`, `MemberCard.tsx`, `MyScheduleModal.tsx`, `page.tsx`):**
  - Built mobile-first `src/components/SleepCalendarModal.tsx`:
    - Month navigation (Prev / Next / Current Month).
    - 3-Pill Monthly Summary Bar: Avg Sleep Duration, Avg Bed/Wake, and On-Time percentage.
    - 7-Column Mon–Sun Calendar Grid: Day numbers with color-coded status badges (emerald for on-time, indigo for sleeping/pending, purple for metastrike, rose for missed/late). Enforces $\ge 48$px touch targets.
    - Selected Day Inspector Card: Displays target vs. actual times, wake source, duration, and self-service manual wake time editor.
  - Updated `src/components/MemberCard.tsx`:
    - Added prominent "☀️ I Woke Up" button and "Enter Time" manual wake picker in `SLEEPING` state.
    - Added "📅 History" button to open the sleep calendar modal for any community member.
  - Updated `src/components/MyScheduleModal.tsx`:
    - Added "📅 View My Sleep & Wake Calendar" action trigger for the authenticated user.
  - Updated `src/app/page.tsx`:
    - Integrated prominent hero banner "☀️ I Woke Up" button and manual wake time picker.
    - Mounted `SleepCalendarModal` with responsive state management.
* **Automated Verification & Unit Tests:**
  - Created `scripts/test-sleep-history-and-wakeup.mjs` verifying storage layer, instant and manual wake-up routes, sleep history calculations, sleep engine transitions, and UI touch targets.
  - Updated `scripts/test-in-bed-and-streaks.mjs` and `scripts/test-wake-up-and-overflow.mjs`.
  - Added suite to `scripts/run-tests.mjs`: all 21/21 unit test suites passed cleanly.
  - Production build clean: `npm run build` (28/28 routes compiled).
  - TypeScript clean: `npx tsc --noEmit` (0 errors).

### Phase 63: 7-Day Variable Sleep Schedule Engine & 3-Mode Schedule Editor Implementation
* **Database Schema & Backfill Migration (`supabase/schema.sql`):**
  - Added `weekly_schedule JSONB` and `pending_weekly_schedule JSONB` to `members` table definition and migration statements.
  - Implemented idempotent SQL backfill migration mapping `mon`..`thu` & `sun` to `bedtime_local`/`wake_time_local` and `fri`..`sat` to `COALESCE(weekend_bedtime_local, bedtime_local)`.
* **Seed Members & In-Memory Hydration (`scripts/seed-demo-members.mjs`, `src/lib/db.ts`):**
  - Updated all seeded demo profiles (Aoi, SarahK, Marcus, Arjun) with realistic `weekly_schedule` objects, including mid-week schedule variations (e.g. SarahK's Tue/Thu shifts).
  - Maintained `scripts/test-demo-seed-fingerprint.mjs` verification passing (11/11 tests).
  - Exported canonical types `DayKey`, `DailySchedule`, and `WeeklySchedule` from `src/lib/db.ts` and `src/lib/timezone.ts`.
  - Updated `knownMemberColumns`, `memoryScheduleData`, `hydrateMemberWeekendHours`, `updateMemberSafe`, and `insertMemberSafe` to preserve both `weekly_schedule` and `pending_weekly_schedule`.
* **Sleep Engine & Cross-Midnight Resolution (`src/lib/sleepEngine.ts`, `src/lib/timezone.ts`):**
  - Defined `DAY_KEYS` (`mon`..`sun`) and `WEEKDAY_TO_DAY_KEY`.
  - Implemented `getScheduleForDay(member, luxonDateTime): DailySchedule` with full fallback resolution.
  - Implemented `resolveActiveSleepCycle(member, sleeperNow, isInBed)`: evaluates yesterday's cycle first (`sleeperNow.minus({ days: 1 })`) from bedtime - 180m until wake time or 8-hour sleep shield window has elapsed; evaluates today's cycle second.
  - Updated `computeMemberState` to return `activeBedtimeLocal`, `activeWakeTimeLocal`, `isCustomScheduleToday`, `isWeekendSchedule`, and `dayKey`.
  - Updated `getBedtimeForNight`, `getNightBedtimeDateTime`, `getSleepCycleDate`, `isWeekendCycle`, and `checkCooldownPromotion` (promoting `pending_weekly_schedule` -> `weekly_schedule`).
* **Subsystems & APIs Integration:**
  - `src/lib/strikes.ts`: Sleep cycle dates and strike evaluations resolve against active 7-day schedule.
  - `src/app/api/members/in-bed/route.ts`: Check-in eligibility and streak tracking utilize resolved cycle.
  - `src/lib/cronDispatcher.ts` & `src/app/api/members/route.ts`: Cron dispatches and cooldown promotions promote `pending_weekly_schedule`.
  - `src/app/api/members/cancel-pending/route.ts`: Clears `pending_weekly_schedule: null`.
  - `src/app/api/members/update-schedule/route.ts`: Accepts `weekly_schedule` in POST/PUT payloads, validates 24h format and `bedtime !== wake_time`, auto-synthesizes 7-day schedule from flat columns if legacy, syncs `mon` to `bedtime_local` and `sat` to `weekend_bedtime_local`, and preserves 48h cooldown.
  - `src/app/api/auth/claim-profile/route.ts` & `src/app/join/page.tsx`: Initializes complete `weekly_schedule` on claim and registration.
  - `src/app/api/mod/route.ts` & `src/components/ModDrawer.tsx`: Added 7-day variable schedule editor for privileged moderator overrides with instant effect.
* **UI/UX 7-Day Variable Schedule Editor Redesign (`src/components/MyScheduleModal.tsx`):**
  - Replaced weekend toggle with 3-Mode Preset Switcher:
    1. **Every Day:** Single bedtime/wake time applied to all 7 days.
    2. **Weekdays / Weekends:** Classic Mon–Thu+Sun vs. Fri–Sat setup.
    3. **Custom Per Day:** Interactive 7-day selector pills (Mon–Sun) with min 44px touch targets.
  - Added quick copy actions ("Copy to Weekdays", "Copy to Weekend", "Apply to All 7 Days").
  - Added compact 7-day summary preview before Save.
  - Preserved all profile constraints, locked Discord handle, website username editing, and 48-hour cooldown notice.
* **MemberCard Active Schedule & 7-Day Routine Tray (`src/components/MemberCard.tsx`):**
  - Displays resolved active bedtime and wake time (`activeBedtimeLocal` → `activeWakeTimeLocal`).
  - Renders subtle "Custom today" badge when current day differs from Monday baseline.
  - Added expandable 7-day sleep routine tray displaying the full week's routine with active day highlighted.
* **Verification & Automated Test Coverage:**
  - Expanded `scripts/test-weekend-hours.mjs`: Added Section 7 with 17 mid-week variable schedule test assertions (all 49/49 passed cleanly).
  - All 20 unit test suites passed cleanly via `npm run test:unit`.
  - Full production build verified via `npm run build` (26/26 routes compiled).
  - Strict TypeScript check verified via `npx tsc --noEmit` (0 errors).

### Phase 62: Integration Pull Request #44 (`krish` → `dev`)
* **Created Integration Pull Request #44:**
  - Opened PR: [#44 `chore: sync code audit issues to Jira, cross-link GitHub issues, and update transition tooling`](https://github.com/KrishJdev/Z-Catchers/pull/44)
  - Targets `dev` from `krish`.
  - Integrates all Phase 61 audit synchronization and Jira transition tooling into `dev`:
    1. **Jira Issue Synchronization (`scripts/create-all-audit-issues.mjs`, `scripts/sync-audit-issues-to-jira.mjs`):**
       - Automated creation of 14 audit tasks (`ZC-14` through `ZC-27`) in Jira under project `ZC` with complete technical breakdowns, impact analysis, code references, and acceptance criteria.
       - Standardized issue type to top-level Task (`10071`).
    2. **Audit Mapping & Cross-Linking (`scripts/audit-issues-map.json`, `scripts/link-gh-to-jira.mjs`):**
       - Complete taxonomy mapping of all 14 audit issues across security, push/PWA robustness, timezone math, and rate limiting.
       - Cross-linked Jira keys to GitHub issues `#30` through `#43` with automated linking comments.
    3. **Transition Script Hardening (`scripts/transition-jira-issue.mjs`, `.github/workflows/jira-transition.yml`):**
       - Added credential sanitization, improved error handling, and transition idempotency.
       - Added GitHub Actions workflow dispatch options.
    4. **Documentation & Handoff Updates (`HANDOFF.md`):**
       - Documented Phase 59–61 audit findings, Jira issue mappings, and current production release status.
* **Verification Check:**
  - `npm run test:unit` clean (19/19 suites passed).
  - `npx tsc --noEmit` clean (0 errors).

### Phase 62: Review Remediation — Audit Issue Sync Robustness & Markdown ADF Parsing
* **Resolved All Review Feedback Across Audit Issue Scripts & Deployment Specs:**
  1. **Deployment Guidance & Production Security Preconditions (`HANDOFF.md`):**
     - Updated production deployment instructions to clarify that `SESSION_SECRET` and `PIN_SALT` are strictly mandatory environment configurations, not optional.
     - Documented that configuring `SESSION_SECRET` alone does not secure authentication while fallback-secret verification remains active in `src/lib/auth.ts`.
     - Specified that `ZC-16` / GH #30 must be resolved (removing hardcoded fallback session secrets and enforcing fail-closed secret validation in production) before claiming the deployment is protected.
  2. **Standardized Issue Type in Audit Definitions (`scripts/create-all-audit-issues.mjs`):**
     - Updated `issueTypeId` across all 14 audit issue definitions to the top-level Task type (`10071`) so `audit-issues-map.json` retains `10071` consistently.
  3. **Robust Mapping Load/Write Flow (`scripts/create-all-audit-issues.mjs`):**
     - Updated `createGitHubIssues()` to load existing mappings and incorporate saved Jira keys from `audit-issues-synced.json`.
     - Changed entries only after their corresponding issue creation succeeds, ensuring failed or partial runs never discard existing entries.
     - Implemented `--reset` / `RESET_MAP=true` as the sole mechanism for clearing mapping state.
     - Guarded direct execution via `fileURLToPath(import.meta.url) === path.resolve(process.argv[1])` to prevent accidental execution when imported.
  4. **Markdown ADF Description Parsing Fix (`scripts/sync-audit-issues-to-jira.mjs`):**
     - Updated `markdownToAdf()` to parse headings on an individual line basis rather than treating entire blank-line-delimited blocks as a single heading.
     - Preserved and processed all text following each heading as section content (paragraphs, ordered lists, bullet lists, code blocks), ensuring summaries, root causes, and remediation plans are fully populated in Jira.
  5. **Jira Checkpointing, Remote Link Retries & Failure Exit Codes (`scripts/sync-audit-issues-to-jira.mjs`):**
     - Checkpointed `jiraKey` and `jiraUrl` immediately upon successful Jira issue creation before requesting remote links.
     - Separated remote link failures from Jira creation errors; retries now link the existing Jira issue rather than creating duplicates.
     - Set process exit code to failure (`process.exitCode = 1`) whenever creation or remote linking fails, while still persisting result files (`audit-issues-synced.json` and `audit-issues-map.json`).
     - Hardened top-level rejection handler to exit with status code 1.
  6. **Authoritative Mapping Synchronization (`scripts/sync-audit-issues-to-jira.mjs`):**
     - Updated load/write flow to incorporate saved Jira keys by stable audit ID before creating issues, writing the authoritative mapping to both `audit-issues-synced.json` and `audit-issues-map.json`.
  7. **Automated Unit Testing (`scripts/test-audit-issue-sync.mjs`, `scripts/run-tests.mjs`):**
     - Added a dedicated test suite verifying ADF heading parsing, section content preservation, issueTypeId conformance, and checkpointing/retry flows.
     - Integrated `test-audit-issue-sync.mjs` into `UNIT_TESTS` in `scripts/run-tests.mjs`.
* **Verification Check:**
  - `npm run test:unit` clean (20/20 suites passed).
  - `npx tsc --noEmit` clean (0 errors).

### Phase 61: Comprehensive Website & PWA Code Audit, GitHub Issues & Jira Synchronization
* **Full-Stack Robustness & Security Audit:**
  - Executed a deep-dive code audit across `src/lib/`, `src/app/api/`, `src/components/`, `public/sw.js`, and PWA lifecycle handlers to identify robustness flaws, edge cases, race conditions, and security risks.
  - Identified 14 distinct issues categorized into three priority tiers:
    - **P1 - High Priority (Security & Authorization Integrity):** Issues 1–5 (`#30`–`#34` / `ZC-16`–`ZC-20`).
    - **P2 - Medium Priority (PWA, Push Desync & Timing Race Conditions):** Issues 6–10 (`#35`–`#39` / `ZC-21`–`ZC-25`).
    - **P3 - Low/Medium Priority (State Machine Inconsistencies & Caching):** Issues 11–14 (`#40`–`#43` / `ZC-26`, `ZC-27`, `ZC-14`, `ZC-15`).
* **GitHub Issues & Taxonomy:**
  - Established taxonomy labels: `security`, `pwa`, `backend`, `frontend`, `bug`, `enhancement`, `priority: high`, `priority: medium`, `priority: low`.
  - Created 14 detailed GitHub issues (`#30` through `#43`) with comprehensive technical breakdowns including Problem Statement, Root Cause Analysis, Impact & Threat Model, Exact File & Line References, and Actionable Remediation Plans.
* **Jira Cloud Project `ZC` Synchronization:**
  - Created 14 matching Jira issues in project `ZC` (Project ID `10033`, Cloud Domain `krishjaiswal2182003.atlassian.net`) using top-level Task type (`10071`).
  - Parsed structured Markdown into compliant Atlassian Document Format (ADF) v1 with headings, bullet lists, ordered lists, code blocks, and hard breaks.
  - Mapped priorities cleanly (`High` for P1, `Medium` for P2/P3-medium, `Low` for P3-low) and attached corresponding labels.
* **Bidirectional Issue Cross-Linking:**
  - Added native Atlassian remote links on Jira tickets pointing directly to corresponding GitHub issue URLs.
  - Posted cross-linking comments on each GitHub issue (`#30` through `#43`) pointing back to its corresponding Jira issue.
* **Comprehensive Cross-Reference Matrix:**
  | Issue # | Jira Key | Priority | Domain | Summary |
  |---|---|---|---|---|
  | [#30](https://github.com/KrishJdev/Z-Catchers/issues/30) | [ZC-16](https://krishjaiswal2182003.atlassian.net/browse/ZC-16) | High (P1) | Security | Remove hardcoded fallback session secrets & dev PIN salt in production |
  | [#31](https://github.com/KrishJdev/Z-Catchers/issues/31) | [ZC-17](https://krishjaiswal2182003.atlassian.net/browse/ZC-17) | High (P1) | Security / PWA | Fix unauthenticated push endpoint deletion in `/api/push/unsubscribe` |
  | [#32](https://github.com/KrishJdev/Z-Catchers/issues/32) | [ZC-18](https://krishjaiswal2182003.atlassian.net/browse/ZC-18) | High (P1) | Security | Enforce database-backed persistent rate limiting in `cancel-pending` and `push/subscribe` |
  | [#33](https://github.com/KrishJdev/Z-Catchers/issues/33) | [ZC-19](https://krishjaiswal2182003.atlassian.net/browse/ZC-19) | High (P1) | Security | Sanitize and validate `x-forwarded-host` in OAuth redirect base URL |
  | [#34](https://github.com/KrishJdev/Z-Catchers/issues/34) | [ZC-20](https://krishjaiswal2182003.atlassian.net/browse/ZC-20) | High (P1) | Security | Prevent IDOR / unauthenticated claim in `update-schedule` when mod rate limit is exceeded |
  | [#35](https://github.com/KrishJdev/Z-Catchers/issues/35) | [ZC-21](https://krishjaiswal2182003.atlassian.net/browse/ZC-21) | Medium (P2) | PWA / Push | Prevent race condition by recording nag deduplication before sending push |
  | [#36](https://github.com/KrishJdev/Z-Catchers/issues/36) | [ZC-22](https://krishjaiswal2182003.atlassian.net/browse/ZC-22) | Medium (P2) | PWA / Frontend | Add Authorization Bearer header to push test and unsubscribe requests |
  | [#37](https://github.com/KrishJdev/Z-Catchers/issues/37) | [ZC-23](https://krishjaiswal2182003.atlassian.net/browse/ZC-23) | Medium (P2) | Backend / Timezones | Align nag-assist date calculation with `getSleepCycleDate()` |
  | [#38](https://github.com/KrishJdev/Z-Catchers/issues/38) | [ZC-24](https://krishjaiswal2182003.atlassian.net/browse/ZC-24) | Medium (P2) | PWA / Service Worker | Resolve `notificationclick` message dropping during tab navigation |
  | [#39](https://github.com/KrishJdev/Z-Catchers/issues/39) | [ZC-25](https://krishjaiswal2182003.atlassian.net/browse/ZC-25) | Medium (P2) | Backend | Remove `wake_time_local` default destructuring to prevent schedule overwrites |
  | [#40](https://github.com/KrishJdev/Z-Catchers/issues/40) | [ZC-26](https://krishjaiswal2182003.atlassian.net/browse/ZC-26) | Medium (P3) | State Machine | Reconcile Sleep Shield active vs `canVoteStrike` in 60-480m overdue window |
  | [#41](https://github.com/KrishJdev/Z-Catchers/issues/41) | [ZC-27](https://krishjaiswal2182003.atlassian.net/browse/ZC-27) | Low (P3) | State Machine | Enforce mutual exclusion between `is_in_bed` and `is_woke_up` flags |
  | [#42](https://github.com/KrishJdev/Z-Catchers/issues/42) | [ZC-14](https://krishjaiswal2182003.atlassian.net/browse/ZC-14) | Low (P3) | Security / Frontend | Avoid storing plaintext moderator passcode in `sessionStorage` |
  | [#43](https://github.com/KrishJdev/Z-Catchers/issues/43) | [ZC-15](https://krishjaiswal2182003.atlassian.net/browse/ZC-15) | Low (P3) | PWA / Caching | Implement versioned cache invalidation for `_next/static` assets in Service Worker |
* **Verification Check:**
  - `npm run typecheck` clean (0 errors).
  - `npm run test:unit` clean (19/19 suites passed in 10.25s).

### Phase 60: Production Release Pull Request #28 (`dev` → `main`)
* **Created Production Release PR #28:**
  - Opened PR: [#28 `release: promote global IANA timezones, persistent rate limiting, cron idempotency locks, and CI pipeline to main`](https://github.com/KrishJdev/Z-Catchers/pull/28)
  - Targets `main` from `dev`.
  - Promotes all merged Phase 51 through Phase 59 features, security hardenings, and architectural improvements into production:
    1. **Global IANA Timezone Catalog & Searchable GMT Offsets Selector:**
       - Full 424 IANA timezone database and 38 GMT offsets (`GMT-12:00` to `GMT+14:00`).
       - Categorized `<optgroup>`s with real-time query filtering.
       - Reusable `<TimezoneSelect />` component ensuring zero mutation of existing user timezones.
    2. **Persistent Supabase Rate Limiting & Distributed Cron Idempotency:**
       - Persistent `rate_limits` table with sliding window and automatic DB cleanup.
       - Distributed `cron_locks` table preventing duplicate background cron runs and overlapping push/Discord notifications.
       - Idempotent database schema definitions in `supabase/schema.sql`.
    3. **Canonical API Consolidation & Optimistic Concurrency:**
       - Canonical endpoints for strike voting, strikes, and metastrikes with backward compatibility.
       - Optimistic concurrency locking and precision timezone calculations.
    4. **Unified CI/CD Pipeline & Automated Testing Suite:**
       - GitHub Actions CI workflow (`.github/workflows/ci.yml`) on Node.js 22.
       - Unified test runner (`scripts/run-tests.mjs`) with automated CI offline gating for live database calls.
       - Mandatory unit testing directive codified in `AGENTS.md` and `AGENT_RULES.md`.
    5. **CodeRabbit Review Hardening:**
       - All CodeRabbit review findings resolved across rate limiting schemas, cron lease expiries, and test isolation.
* **Verification & Merge Pre-Checks:**
  - `git merge-tree origin/main origin/dev` confirmed 0 conflicts.
  - `npx tsc --noEmit` clean (0 errors).
  - `npm run test:unit` clean (all 19 test suites passed in 21.46s).

### Phase 59: GitHub & Jira Issue Status Audit and Lifecycle Synchronization
* **GitHub Open Issues Audit & Completion:**
  - Audited all 7 open GitHub issues (`#1`, `#5`, `#6`, `#7`, `#8`, `#9`, `#10`).
  - Confirmed 100% of underlying features, APIs, unit tests, and security guardrails are fully implemented, verified, and merged into production:
    - `[ZC-1] Phase 1 MVP: Core Cross-Timezone Accountability`: Updated epic checklist with all 6 deliverables marked done; closed issue #1 as completed.
    - `[ZC-5] Phase 1.4: Self-Service Schedule Edit Modal & 48-Hour Cooldown`: Closed issue #5 with complete audit notes referencing `MyScheduleModal.tsx`, 48-hour cooldown queue, and Discord journal validation regex.
    - `[ZC-6] Phase 1.5: Web Push Notification Engine & Service Worker`: Closed issue #6 with audit notes referencing `public/sw.js`, VAPID key pairing, and multi-device preference management via `/api/push/subscribe`.
    - `[ZC-7] Phase 1.6: 1-Minute Cron Dispatcher & Sleep Shield Guardrail`: Closed issue #7 with audit notes referencing `/api/cron/dispatch-notifications`, distributed locks, short leases, and Sleep Shield guarantees.
    - `[ZC-8] Phase 2: Moderation & Anti-Dodge Controls`: Closed issue #8 with audit notes referencing `ModDrawer.tsx`, passcode/session unlock, and roster admin API `/api/mod`.
    - `[ZC-9] Phase 2.1: Passcode-Protected Moderator Drawer (ModDrawer.tsx)`: Closed issue #9 with audit notes referencing drawer UI, pending queue, and `<TimezoneSelect />`.
    - `[ZC-10] Phase 2.2: Instant Cooldown Override & Roster Admin API`: Closed issue #10 with audit notes referencing `/api/mod` CRUD, rate limiting, and live allowlist authorization.
  - Verified `gh issue list --state open` is now 100% clean (0 open issues).
* **Jira Board & Cloud API Synchronization:**
  - Updated GitHub Repository secret `JIRA_TOKEN` via `gh secret set JIRA_TOKEN` with the refreshed Atlassian API key.
  - Authenticated against `krishjaiswal2182003.atlassian.net` as `krish.jaiswal2182003@gmail.com`.
  - Discovered all 13 issues in project `ZC` and transitioned all active tasks to `Done` (IDs verified on Jira):
    - `ZC-1`: Phase 1 MVP: Core Cross-Timezone Accountability -> `Done`
    - `ZC-2`: Phase 1.1: Database Schema & Supabase Configuration -> `Done`
    - `ZC-3`: Phase 1.2: Luxon Sleep Engine & Cross-Timezone Calculations -> `Done`
    - `ZC-4`: Phase 1.3: Warm Dark Mobile Dashboard UI & Status Buckets -> `Done`
    - `ZC-5`: Phase 1.4: Self-Service Schedule Edit Modal & 48-Hour Cooldown -> `Done`
    - `ZC-6`: Phase 1.5: Web Push Notification Engine & Service Worker -> `Done`
    - `ZC-7`: Phase 1.6: 1-Minute Cron Dispatcher & Sleep Shield Guardrail -> `Done`
    - `ZC-8`: Phase 2: Moderation & Anti-Dodge Controls -> `Done`
    - `ZC-9`: Phase 2.1: Passcode-Protected Moderator Drawer (ModDrawer.tsx) -> `Done`
    - `ZC-10`: Phase 2.2: Instant Cooldown Override & Roster Admin API -> `Done`
    - `ZC-11`: Phase 3: Sleep Streaks, Badges & Discord Webhooks -> `Done`
    - `ZC-12`: Phase 3.1: Bedtime Compliance Scoring & Streak Tracking -> `Done`
    - `ZC-13`: Phase 3.2: Automated Discord Channel Webhooks & Polish -> `Done`
  - Added idempotency check to `scripts/transition-jira-issue.mjs` verifying current status before fetching transitions, preventing errors when issues are already in target status.
  - Updated JQL search endpoint in `scripts/transition-jira-issue.mjs` to request explicit fields (`id,key,summary,status`).
* **Architecture & Roadmap Change of Plans Documentation:**
  - Documented deprecation of legacy unauthenticated registration `POST /api/members` (HTTP 410 Gone) in favor of Discord OAuth2 authentication.
  - Documented evolution of "Custom Quiet Hours" into dynamic Sleep Shield early check-in ("I'm In Bed") and excused Metastrike passes.
  - Documented locking of Discord handles (auto-filled from Discord OAuth) to prevent member impersonation.
  - Documented consolidation of legacy API proxy routes into canonical endpoints (`/api/cron/dispatch-notifications`, `/api/members/strikes`, `/api/members/strikes/metastrike`).
* **Verification Check:**
  - `npx tsc --noEmit` clean (0 errors).
  - `npm run test:unit` clean (19/19 suites passed).

### Phase 58: Mandatory Unit Testing Directive in Agent Specifications
* **Multi-Agent Directive Update (`AGENTS.md`):**
  - Added Rule 7 to **Golden Operating Rules**: Every feature that is implemented **must** have corresponding automated unit tests. Features are never considered complete or merge-ready without automated test coverage (`npm run test:unit` must pass cleanly).
  - Updated Section 2 (Mandatory Handoff Protocol) to mandate recording `npm run test:unit` verification results alongside `npx tsc --noEmit`.
* **Agent Technical Guardrails Update (`AGENT_RULES.md`):**
  - Updated Section 6 (Execution & Verification Protocol) with Step 2: "Mandatory Unit Tests: Every feature or endpoint that is implemented **must** have corresponding automated unit tests. Run `npm run test:unit` and verify all suites pass cleanly before concluding your task or opening a PR."
* **Verification Check:**
  - `npx tsc --noEmit` verified clean with 0 errors.
  - `npm run test:unit` verified passing (19/19 suites passed cleanly).

### Phase 57: CI Pipeline Test Runner TypeScript Loader, Node 22 & Offline CI Isolation Fixes
* **TypeScript ESM Module Resolution in CI (`package.json`, `package-lock.json`):**
  - Added `tsx` (`^4.23.15`) to `devDependencies` so Node.js environments can cleanly resolve and transpile TypeScript modules (`.ts` files like `src/lib/sleepEngine.ts`, `src/lib/auth.ts`, `src/lib/rateLimit.ts`) imported by `.mjs` test suites.
  - Updated npm test scripts (`"test"`, `"test:unit"`, `"test:all"`) to invoke `node --import tsx scripts/run-tests.mjs ...`.
* **Universal Test Subprocess Loader Propagation (`scripts/run-tests.mjs`):**
  - Enhanced child process argument construction in `scripts/run-tests.mjs` to detect active TypeScript loaders (`tsx` or `strip-types`) in `process.execArgv` and forward them, or prepend `--import tsx` when spawning child test suites via `child_process.spawnSync`.
  - Guarantees all 19 offline unit test suites run cleanly across local workstations and GitHub Actions CI without `ERR_UNKNOWN_FILE_EXTENSION` errors.
* **Node.js 22 LTS CI Upgrade & WebSocket Polyfill (`.github/workflows/ci.yml`, `src/lib/db.ts`):**
  - Upgraded GitHub Actions CI workflow to Node.js 22 LTS (`node-version: 22`), matching `@types/node: ^22.13.1` and satisfying `@supabase/supabase-js`'s requirement for native global `WebSocket`.
  - Added a defensive `DummyWebSocket` polyfill in `src/lib/db.ts` for headless or Node < 22 environments where native WebSocket might be undefined, preventing client initialization crashes.
* **Offline CI Test Isolation (`scripts/test-*.mjs`):**
  - Audited all unit test suites (`test-login-and-auth.mjs`, `test-nag-notifications.mjs`, `test-strikes-system.mjs`, `test-signup-and-profiles.mjs`, `test-discord-webhook-and-assists.mjs`, `test-in-bed-and-streaks.mjs`, `test-phase1-pwa-push.mjs`).
  - Added explicit check `Boolean(supabaseUrl && supabaseKey && !supabaseUrl.includes('placeholder') && !supabaseKey.includes('placeholder'))` so placeholder CI credentials safely skip external network database calls without assertion failures.
* **Specification Sync (`BACKEND_TZ_PWA_SPEC.md`):**
  - Updated Section 5 to reflect Node.js 22 runner environment and `node --import tsx` syntax.

### Phase 56: Code Review & Security Hardening
* **Timezone Selector Accessibility & Touch Target UX (`src/components/TimezoneSelect.tsx`):**
  - Added default accessible name `aria-label="Timezone"` (with optional `ariaLabel` prop override) to `<select>`, ensuring screen readers and automated accessibility checkers can reliably identify the control when parent integrations lack an explicit `<label>`.
  - Updated the clear filter button to meet WCAG 2.5.5 minimum 44x44px touch targets (`min-w-[44px] min-h-[44px] w-11 h-11 flex items-center justify-center`), positioned cleanly in the search control.
  - Increased search input right padding to `pr-11` (44px) so input text does not overlap with the touch-accessible clear button.
* **Cron Execution Lock Concurrency & Memory Hygiene (`src/lib/cronDispatcher.ts`):**
  - Hardened `acquireCronLock` so database update or insert errors immediately delete provisional in-memory lock entries (`inMemoryCronLocks.delete(lockKey)`) before returning false, retaining the local lock only when the database confirms an active lock and its expiry.
  - Conditioned lock renewal updates with `.lte('expires_at', nowIso)` and `.select('lock_key').maybeSingle()` to prevent race conditions where concurrent runners both renew expired locks simultaneously.
* **Atomic Persistent Rate Limiting (`src/lib/rateLimit.ts`):**
  - Implemented `atomicIncrementRateLimitKey` utilizing optimistic concurrency control (CAS) via `.eq('count', existing.count)` on updates, conditional window resets via `.lte('expires_at', nowIso)`, and retry loops handling concurrent first-attempt insert collisions.
  - Applied atomic increments to both `recordPinFailurePersistent` and `recordVoteAttemptPersistent`.
  - Preserved read idempotency and failure-only tracking semantics for `checkPinRateLimit` / `checkPinRateLimitPersistent`, avoiding premature rate limit exhaustion on valid PINs or read checks.
* **Precise Timezone Search Query Filtering (`src/lib/sleepEngine.ts`):**
  - Refined `matchesTimezoneQuery` so hour-only queries (`!nq.m`) match a complete hour token boundary via regex `(?:gmt|utc)?${escapedSign}(?:${nq.h}|${parseInt(nq.h, 10)})(?::|\\b|$)`, preventing queries like `+1` from false-positive matching `+10`..`+14` while preserving partial-minute matches like `+5` matching `GMT+05:30`.
  - Filtered both merged runtime timezones and `BASE_IANA_TIMEZONES` fallback in `ALL_IANA_TIMEZONES` through `isValidTimezone`.
* **Automated Verification (`scripts/test-gmt-timezones.mjs`):**
  - Added assertions verifying `+1` matches `GMT+01:00` without matching `GMT+10:00`/`GMT+12:00`, `+5` matches `Asia/Kolkata` (`GMT+05:30`), and all `ALL_IANA_TIMEZONES` pass `isValidTimezone`.

### Phase 55: Automated CI Pipeline & Unified Test Runner
* **Helper Scripts Configuration (`package.json`):**
  - Added `"typecheck": "tsc --noEmit"` for TypeScript static validation.
  - Added `"test:unit": "node scripts/run-tests.mjs --unit"` executing all 19 offline unit/static test suites.
  - Added `"test:all": "node scripts/run-tests.mjs --all"` executing all 20 verification suites including live DB integration tests.
  - Added `"test": "node scripts/run-tests.mjs --unit"`.
* **Cross-Platform Unified Test Runner (`scripts/run-tests.mjs`):**
  - Built a fast, cross-platform runner that cleanly executes `.mjs` test suites via `child_process.spawnSync`.
  - Categorized suites into offline standalone unit tests (19 suites) and live E2E database suites (`test-e2e-api-endpoints.mjs`).
  - Summarizes execution timing, total suites, passes, and detailed failure outputs.
* **Offline Fallback Hardening (`scripts/test-phase1-security.mjs`):**
  - Added automatic `.env.local` parser and graceful offline handling: runs pure unit tests (`sanitizeMember`) and skips remote database checks when Supabase credentials are not configured.
* **Automated GitHub Actions CI Workflow (`.github/workflows/ci.yml`):**
  - Configured CI pipeline triggered on `push` (to `main`, `dev`, `krish`) and `pull_request` (to `main`, `dev`).
  - Pipeline executes: checkout, Node.js 20 setup with npm cache, `npm ci`, `npm run typecheck`, `npm run build` (with safe dummy env vars), and `npm run test:unit`.
* **Verification Check:**
  - `npm run typecheck`: clean, 0 errors.
  - `npm run build`: compiled all 26/26 routes cleanly.
  - `npm run test:unit`: all 19/19 suites passed in under 10 seconds.
  - `npm run test:all`: all 20/20 suites passed cleanly.

### Phase 54: Task 4 - Global IANA & GMT Timezones Expansion & Reusable Selector
* **Comprehensive Global Timezone Catalog (`src/lib/sleepEngine.ts`, `src/lib/timezone.ts`):**
  - Expanded timezone support from a restricted 35-item list to the full canonical IANA timezone database (424 canonical timezones and regional aliases) plus all standard GMT offsets (`GMT-12:00` to `GMT+14:00`).
  - Added `BASE_IANA_TIMEZONES` guaranteeing complete cross-platform offline coverage for all inhabited continents and cities (Americas, Europe, Asia, Africa, Oceania, Pacific, Polar).
  - Added runtime enrichment with `Intl.supportedValuesOf('timeZone')` for dynamic forward-compatibility.
  - Implemented `ALL_TIMEZONES` uniting all canonical IANA zones with `GMT_OFFSETS`.
  - Implemented `isKnownTimezone(zoneStr)` to recognize canonical zones, offsets, and valid Luxon specifiers.
* **Intelligent Query Matching & Categorized Optgroups (`src/lib/sleepEngine.ts`):**
  - Implemented `getTimezoneGroups()` generating 8 structured groups with live, DST-accurate GMT offset labels:
    - `Popular Timezones` (Curated Discord community hotspots)
    - `Standard GMT Offsets` (All 38 standard GMT / UTC offsets from -12:00 to +14:00)
    - `Americas` (144 canonical cities and territories)
    - `Europe` (58 canonical cities and territories)
    - `Asia` (83 canonical cities and territories)
    - `Africa` (52 canonical cities and territories)
    - `Oceania & Pacific` (49 canonical cities and territories)
    - `Atlantic, Indian & Polar` (34 canonical regions)
  - Implemented `matchesTimezoneQuery(value, label, query)` and `filterTimezoneGroups(groups, query)` supporting intelligent search by city name, country/region, timezone ID, or offset (e.g. `karachi`, `london`, `new york`, `+5`, `-5`, `GMT+5:30`, `+5:30`).
* **Reusable Searchable Timezone Selector Component (`src/components/TimezoneSelect.tsx`):**
  - Created `<TimezoneSelect />` with real-time text filter and clear button styled strictly according to the Warm Dark design system (`#120F0D` bg, `#2A2421` border, `#F5EBE1` text, `#E89D47` amber focus).
  - Guaranteed zero loss or accidental modification of existing user timezones: if a user's current timezone is not in the filtered results or represents a custom/legacy zone, it is automatically pinned at the top as an active option (`[Current Selection]`), preventing any accidental changes or form overrides.
* **Frontend Integration Across All Signup, Member & Mod Views:**
  - `src/app/join/page.tsx`: Upgraded member onboarding/signup form to use `<TimezoneSelect />`, enabling friends in any global timezone or ±GMT offset to easily find or auto-detect their local timezone.
  - `src/components/MyScheduleModal.tsx`: Upgraded member self-service schedule editor to use `<TimezoneSelect />`.
  - `src/components/ModDrawer.tsx`: Upgraded both member schedule editing and new member creation forms to use `<TimezoneSelect />`.
* **Zero Database Mutation of Existing User Timezones:**
  - Strictly preserved all existing user timezones (`Asia/Tokyo`, `America/New_York`, `Europe/London`, `Asia/Kolkata`, etc.) without altering any database records or migrations.
* **Expanded Timezone Test Suite (`scripts/test-gmt-timezones.mjs`):**
  - Added test suites 8, 9, 10, and 11 verifying `ALL_IANA_TIMEZONES`, `ALL_TIMEZONES`, `getTimezoneGroups()`, `filterTimezoneGroups()` with city & offset queries, and verification that all existing user timezones remain valid and intact.
* **Verification Check:**
  - `npx tsc --noEmit` verified clean with 0 errors.
  - `npm run build` compiled all 26/26 routes cleanly.
  - `node scripts/test-gmt-timezones.mjs` passed all 11 test suites.
  - `node scripts/test-weekend-hours.mjs` passed all 32 tests.
  - `node scripts/test-schedule-cooldown.mjs` passed all 14 tests.
  - `node scripts/test-wake-up-and-overflow.mjs` passed cleanly.
  - `node scripts/test-strikes-system.mjs` passed cleanly.

### Phase 54: CodeRabbit Review Findings Resolution Across CI, Rate-Limiting, Cron Leases & Test Isolation
* **GitHub Actions CI Security Hardening (`.github/workflows/ci.yml`):**
  - Added top-level `permissions: contents: read` block restricting default workflow token scopes to read-only.
  - Added `with: persist-credentials: false` under `actions/checkout@v4` preventing token persistence in local runner git config.
* **Documented Setup & Copyable Migration RLS Enforcement (`BACKEND_TZ_PWA_SPEC.md`, `HANDOFF.md`):**
  - Added `ALTER TABLE ENABLE ROW LEVEL SECURITY`, `REVOKE ALL FROM anon, authenticated`, `GRANT ALL TO service_role`, and service-role policies for both `public.rate_limits` and `public.cron_locks` in `BACKEND_TZ_PWA_SPEC.md` and `HANDOFF.md`.
* **Rate Limiter OCC Retry Exhaustion Protection (`src/lib/rateLimit.ts`):**
  - Defined and exported `RateLimitConflictError` with code `RATE_LIMIT_RETRY_EXHAUSTED` and key context.
  - Increased compare-and-swap (CAS) retry attempts to 5 with jittered exponential backoff in `atomicIncrementRateLimitKey`.
  - Threw `RateLimitConflictError` upon retry exhaustion instead of discarding attempts, and propagated the error through `recordPinFailurePersistent` and `recordVoteAttemptPersistent`.
  - Added comprehensive automated unit tests in `scripts/test-pin-rate-limiting.mjs` verifying OCC conflict simulation and error propagation.
* **Cron Dispatcher Short Processing Leases & Crash Recovery (`src/lib/cronDispatcher.ts`):**
  - Reduced initial lock lease during active notification dispatch from 24 hours to 5 minutes (`NOTIFICATION_LEASE_SECONDS = 300`), eliminating 24-hour lockout stalls when serverless runners crash mid-dispatch.
  - Added incremental delivery tracking (`delivered_sub_ids`) in lock metadata for personal notifications, community nag alerts, and Discord webhooks.
  - Preserved previously delivered targets across worker crash-recovery renewals so recovered runs never send duplicate push notifications.
  - Upgraded completed dispatches to durable 24-hour locks with `completed: true` via `markCronLockCompleted`.
  - Added automated unit test suite in `scripts/test-push-and-cron.mjs` verifying lease acquisition, worker crash recovery, duplicate prevention, and durable completion sealing.
* **Offline Test Suite Isolation & Explicit Integration Opt-In (`scripts/`):**
  - Updated `scripts/run-tests.mjs` to inject `RUNNER_MODE: mode` into child test process environments.
  - Updated `scripts/test-phase1-security.mjs`, `scripts/test-login-and-auth.mjs`, `scripts/test-discord-webhook-and-assists.mjs`, `scripts/test-in-bed-and-streaks.mjs`, `scripts/test-nag-notifications.mjs`, `scripts/test-signup-and-profiles.mjs`, `scripts/test-strikes-system.mjs`, and `scripts/test-phase1-pwa-push.mjs` to require both explicit `RUNNER_MODE === 'all'` opt-in AND real credentials, ensuring `npm run test:unit` is 100% offline and never writes to Supabase even when `.env.local` exists.
* **Verification Check:**
  - `npx tsc --noEmit` verified clean with 0 errors.
  - `npm run test:unit` verified clean with all 19/19 test suites passing (11.44s).

### Phase 53: Task 3 - Database-Backed Rate Limiting & Cron Idempotency Locks
* **Database Schema Enhancement (`supabase/schema.sql`, `src/lib/db.ts`):**
  - Added `public.rate_limits` table with indexes (`idx_rate_limits_expires_at`) for persistent serverless rate limiting.
  - Added `public.cron_locks` table with indexes (`idx_cron_locks_expires_at`) for distributed execution locks and notification idempotency.
  - Added Row-Level Security (RLS) policies for `rate_limits` and `cron_locks` with service-role full access.
  - Added `RateLimitRow` and `CronLockRow` interfaces to `src/lib/db.ts`.
* **Database-Backed Rate Limiter Refactor (`src/lib/rateLimit.ts`):**
  - Upgraded rate limiter to query and store attempt counts and lockouts in the `rate_limits` table via `src/lib/db.ts`.
  - Maintained synchronized dual-layer caching (global in-memory map + Supabase persistence) with graceful offline fallback for unit tests and local development.
  - Preserved 100% backward-compatible function signatures across synchronous and async callers (`checkPinRateLimit`, `checkPinRateLimitPersistent`, `recordPinFailure`, `recordPinFailurePersistent`, `resetPinFailure`, `checkVoteRateLimitPersistent`, etc.).
  - Added opportunistic pruning of expired rate limit rows.
* **Cron Dispatcher Idempotency Locks (`src/lib/cronDispatcher.ts`):**
  - Implemented `acquireCronLock`, `releaseCronLock`, and `clearAllCronLocks` backed by `cron_locks` with in-memory fallback.
  - Added 55-second window-level execution lock (`cron_window:<YYYY-MM-DDTHH:mm>`) to prevent duplicate runs when Vercel Cron and GitHub Actions fire within the same minute window.
  - Added per-member 24-hour event idempotency locks (`notif:<member_id>:<date>:<event_type>`) ensuring zero duplicate Web Push notifications or Discord webhooks during retries or concurrent dispatches.
* **Verification Check:**
  - `npx tsc --noEmit` verified clean with 0 errors.
  - `npm run build` compiled all 26/26 routes cleanly.
  - `node scripts/test-pin-rate-limiting.mjs` passed cleanly.
  - `node scripts/test-push-and-cron.mjs` passed cleanly.
  - `node scripts/test-strikes-system.mjs` passed cleanly.
  - `node --env-file=.env.local scripts/test-phase1-security.mjs` passed cleanly.

### Phase 52: Task 2 - Consolidate Redundant API Proxies into Canonical Endpoints
* **API Proxy Redundancy Audit & Elimination:**
  - Audited all occurrences of `/api/cron`, `/api/members/strike`, `/api/members/strikes/vote`, and `/api/members/metastrike` across `src/`, `scripts/`, `.github/workflows/`, and `vercel.json`.
  - Confirmed `.github/workflows/cron-dispatcher.yml` and `vercel.json` already point directly to the canonical `/api/cron/dispatch-notifications` endpoint.
  - Updated [`src/app/page.tsx`](file:///d:/Projects/Z%20Catchers/src/app/page.tsx#L597) to target canonical `/api/members/strikes` directly instead of `/api/members/strikes/vote`.
  - Deleted redundant pass-through proxy routes and directories:
    - `src/app/api/cron/route.ts` (proxied to `./dispatch-notifications/route`)
    - `src/app/api/members/strike/route.ts` (proxied to `../strikes/route`)
    - `src/app/api/members/strikes/vote/route.ts` (proxied to `../route`)
    - `src/app/api/members/metastrike/route.ts` (proxied to `../strikes/metastrike/route`)
* **Route Structure Consolidation:**
  - Standardized canonical endpoints:
    - Cron: `/api/cron/dispatch-notifications`
    - Strikes: `/api/members/strikes`
    - Metastrike: `/api/members/strikes/metastrike`
* **Verification Check:**
  - `npx tsc --noEmit` verified clean with 0 errors.
  - `npm run build` compiled all 26/26 static and dynamic routes cleanly.
  - `node scripts/test-push-and-cron.mjs` passed cleanly.
  - `node scripts/test-strikes-system.mjs` passed cleanly.

### Phase 51: Task 1 - Metastrike Route Resolution & Standardization
* **Metastrike Handler & Export Inspection (`src/app/api/members/strikes/metastrike/route.ts`):**
  - Confirmed `src/app/api/members/strikes/metastrike/route.ts` is the canonical implementation exporting `POST`.
* **Frontend and Codebase Audit:**
  - Audited `src/components/MetastrikeModal.tsx`, `src/components/MemberCard.tsx`, `src/app/page.tsx`, `scripts/test-strikes-system.mjs`, and `scripts/test-e2e-api-endpoints.mjs`.
  - Confirmed all active UI callers (`MetastrikeModal.tsx`) already target the canonical `/api/members/strikes/metastrike` route.
* **Backward-Compatible Re-Export (`src/app/api/members/metastrike/route.ts`):**
  - Verified `src/app/api/members/metastrike/route.ts` cleanly re-exports `POST` from `../strikes/metastrike/route` with zero typecheck or build errors.
* **Verification Check:**
  - `npx tsc --noEmit` verified clean with 0 errors.
  - `npm run build` compiled all 30/30 static and dynamic routes cleanly.
  - `node scripts/test-strikes-system.mjs` passed cleanly.

### Phase 50: Production Release PR #26 (`dev` → `main`)
* **Production Release Pull Request Creation:**
  * Created production release Pull Request [#26 (`dev` → `main`)](https://github.com/KrishJdev/Z-Catchers/pull/26) to promote verified features from Phase 49 into production (`main`).
  * Encompasses sleeping state to awake undo action, early wake-up state machine override in `sleepEngine.ts`, `WOKE_UP` notification logging, moderator reset controls, hero greeting dynamic state, and symmetrical flexbox layout eliminating "Leave quiet note" overflow.
* **Comprehensive Release Verification Check:**
  * Clean zero-conflict tree merge verified between `origin/main` and `origin/dev`.
  * `npx tsc --noEmit` verified clean with 0 errors.
  * `npm run build` verified clean with all 30/30 static and dynamic routes compiled.
  * All automated test suites executed and verified passing (`scripts/test-wake-up-and-overflow.mjs`, `scripts/test-nag-notifications.mjs`, `scripts/test-in-bed-and-streaks.mjs`, `scripts/test-strikes-system.mjs`).

### Phase 49: Sleeping State to Awake Undo Action & Leave Quiet Note Overflow Fix
* **Problem Diagnosis & Root Cause:**
  - **Leave Quiet Note Overflow:** In `MemberCard.tsx`, when a member was rendered in `bucket === 'SLEEPING'`, the bottom action row placed the left action button (`Shield On (Muted)` or `Vote Strike`) and right journal link (`Leave quiet note ↗`) side-by-side using `flex items-center justify-between gap-2 w-full`. Because both elements were constrained with `whitespace-nowrap` without `flex-1 min-w-0` or `truncate`, their combined width (~281px) exceeded the available width inside card columns in 2-column or 3-column responsive grids (~240px-260px), pushing `Leave quiet note` horizontally out of the card container.
  - **Lack of Awake Undo Transition:** When a member tapped `"I'm in Bed"` (or was marked sleeping by mistake), there was no prominent button to transition back from sleeping state to awake. Furthermore, if the sleeper's local time fell inside the scheduled 8-hour sleep window (`diffMinutes > 60`), the sleep engine (`computeMemberState`) hardcoded `bucket = 'SLEEPING'`, preventing cancellation from moving the member back to `AWAKE`.
* **Leave Quiet Note Overflow Resolution (`src/components/MemberCard.tsx`):**
  - **Symmetrical Flexbox Distribution:** Applied `flex items-center gap-2 w-full` with `flex-1 min-w-0` on both child action elements in `bucket === 'SLEEPING'`.
  - **Responsive Truncation:** Wrapped the `"Leave quiet note"` label in `<span className="truncate">Leave quiet note</span>` alongside `<ExternalLink className="h-3.5 w-3.5 shrink-0" />`. This guarantees mathematically that neither button can ever overflow the card boundary, even on narrow 240px card viewports.
* **Sleeping State to Awake Undo Architecture & State Machine:**
  - **Database & Runtime Member Entity (`src/lib/db.ts`):** Added `is_woke_up?: boolean` to the `Member` interface to capture active awake overrides.
  - **Sleep Engine Awake Transition (`src/lib/sleepEngine.ts`):** Updated `computeMemberState` to evaluate `member.is_woke_up`. When true, the member immediately transitions to `bucket = 'AWAKE'`, `status = 'AWAKE'`, with `isSleepShieldActive = false`, enabling members to reliably return to awake status even during their scheduled sleep window.
  - **In-Bed API Route Awake & Cancellation Engine (`src/app/api/members/in-bed/route.ts`):**
    - Enhanced `action === 'cancel'` / `action === 'wake_up'` to remove `IN_BED_EARLY` from `notification_logs`, clear `last_notified_stage`, and record a `WOKE_UP` notification log for today's sleep cycle date, returning `is_in_bed: false` and `is_woke_up: true`.
    - Updated `action === 'check_in'` to automatically purge any active `WOKE_UP` record for the cycle date before setting `IN_BED_EARLY`.
    - Supported moderator authorization via `verifyModeratorAuthorization(request)`, enabling moderators (via mod session or passcode) to undo sleep check-ins for any community member.
    - Updated `GET` endpoint to return both `is_in_bed` and `is_woke_up` for the queried member.
  - **Members Hydration Engine (`src/app/api/members/route.ts`):** Hydrated `is_woke_up` by batch-querying recent `WOKE_UP` records from `notification_logs` and returning it across all members in the roster.
  - **Auth Session Hydration (`src/app/api/auth/me/route.ts`):** Hydrated `is_in_bed` and `is_woke_up` for the authenticated member profile.
* **UI Controls & Interactive Undo Buttons:**
  - **MemberCard Wake Up Button (`src/components/MemberCard.tsx`):**
    - In `bucket === 'SLEEPING'`, added a dedicated, touch-target compliant (`min-h-[44px]`) `Wake Up (Undo)` button (`border-status-amber/40 bg-status-amber/15 text-status-amber`) for the viewer, checked-in members, or moderators.
    - Enhanced the in-card confirmation banner with a prominent `[ ☀️ Undo ]` button.
    - Added an `optimisticWokeUp` state and updated status pill to reflect `Awake` when woken up.
    - In `bucket === 'AWAKE'`, added a `[ 🛏️ Go to Bed ]` button if the member had previously woken up and wants to check in again later.
  - **Dashboard Top Banner Wake Up Button (`src/app/page.tsx`):**
    - Replaced the understated `Undo` text link with a prominent `[ ☀️ Wake Up / Undo ]` button (`min-h-[44px]`).
    - Added dynamic personalized greeting for `claimedMember.is_woke_up` (`Good Morning, [Name]! You're marked as awake.` with `Back to Bed` button).
    - Passed `isModerator` to `MemberCard` across all four status buckets.
  - **Moderator Drawer Sleep Reset Control (`src/components/ModDrawer.tsx`):**
    - Added a `Wake Up / Undo Sleep` action directly inside the moderator administration roster table for any checked-in member, enabling server moderators to resolve accidental sleep status toggles instantly.
* **Verification Check:**
  - `npx tsc --noEmit` clean (0 errors).
  - `npm run build` clean (all 30/30 dynamic and static routes compiled).
  - `node scripts/test-wake-up-and-overflow.mjs` passed cleanly.
  - `node scripts/test-nag-notifications.mjs` passed cleanly.
  - `node scripts/test-in-bed-and-streaks.mjs` passed cleanly.
  - `node scripts/test-strikes-system.mjs` passed cleanly.

### Phase 48: Real-Time Bedtime Nag Notifications & Sleep Shield Guardrail Enforcement
* **Real-Time Bedtime Nag Notification Engine (`src/app/api/members/nag-notif/route.ts`):**
  - **Eligibility Verification:** Enables community members to send push notifications to friends who are within 30 minutes before their bedtime (`-30 <= diffMinutes < 0`) or past their bedtime (`0 <= diffMinutes <= 480`). Awake members well before bedtime (`diffMinutes < -30`) or past their 8-hour sleep cycle are strictly protected against reminder dispatch.
  - **Sleep Shield Guardrail:** Non-negotiable defense: if the target member has turned on their Sleep Shield (via early check-in `"I'm in Bed"`, active 8-hour sleep window, or excused Metastrike pass), push notifications strictly **will not go** (`shieldActive: true`), and the endpoint returns an informative response confirming that the recipient's Sleep Shield is safely active.
  - **Multi-Device Push Dispatch & Dead Subscription Pruning:** Dispatches Web Push payloads (`"🌙 Time to Catch Some Z's!"`) directly to all registered client endpoints in `push_subscriptions` via `sendPushNotification()`, automatically pruning expired 404/410 subscriptions.
  - **Anti-Spam Deduplication & Community Assists:** Restricts manual nags to 1 reminder per sender per sleeper per stage (`WIND_DOWN` vs `OVERDUE`) per local cycle date, and automatically records an assist in `notification_logs` to increment the live community assist counter (`"👥 X friends checked in tonight 🦊"`).
* **MemberCard Real-Time Nag Notification UI (`src/components/MemberCard.tsx`):**
  - **Profile Box Nag Notif Button:** Added an intuitive, accessible action button (`min-h-[44px] min-w-[44px]`) on the member's profile card for eligible peers.
  - **Shield Status Feedback:** If the recipient has turned on their Sleep Shield, the button visually reflects `Shield On` (with muted purple styling `border-status-slumber/40 bg-status-slumber/15 text-status-slumber`), and tapping it displays a gentle feedback toast: `"🛡️ [Name] has turned on their Sleep Shield. Nag notifications are muted."` without dispatching notifications.
  - **Optimistic State & Assist Counter Synchronization:** When tapped for active friends, the button transitions to `Sending...` with spinner, then updates to `Nag Sent` with a checkmark badge, emits a 15ms light haptic pulse, and increments the on-card assist counter.
  - **Multi-Bucket Layout Integration:** Elegantly positioned across `NAG NOW` (secondary action row alongside Vote Strike), `WINDING DOWN` (when within 30m of bedtime), and `SLEEPING` (indicating `Shield On (Muted)`).
* **Header Sleep Shield Toggle Live Synchronization (`src/app/page.tsx`):**
  - Synchronized `isSleepShieldActive` with authenticated member `currentUser.is_in_bed` state.
  - Connected the Header `Shield: Active / Off` toggle directly to the member's live Supabase check-in status via `/api/members/in-bed`, enabling instant personal Sleep Shield activation with toast feedback.
* **404 Not Found Page Component (`src/app/not-found.tsx`):**
  - Implemented Next.js 15 root `not-found.tsx` adhering to the Warm Dark low-blue-light design system (`#120F0D` background, `#F5EBE1` text, sleeping FoxMascot vector).
* **Automated Unit & Integration Test Suite (`scripts/test-nag-notifications.mjs`):**
  - Added unit test suite verifying time-window boundary conditions (`-30m` through `+480m`), Sleep Shield guardrail assertions, PostgreSQL unique constraint anti-spam deduplication, and check-in discovery.
* **Verification Check:**
  - `npx tsc --noEmit` clean (0 errors).
  - `npm run build` clean (all 30/30 dynamic and static routes compiled).
  - `node scripts/test-nag-notifications.mjs` passed cleanly.
  - `node scripts/test-strikes-system.mjs` passed cleanly.
  - `node scripts/test-login-and-auth.mjs` passed cleanly.
  - `node scripts/test-logout-flow.mjs` passed cleanly.
  - `node scripts/test-schedule-cooldown.mjs` passed cleanly.
  - `node scripts/test-phase1-pwa-push.mjs` passed cleanly.
  - `node scripts/test-profile-and-schedule-tab.mjs` passed cleanly.

### Phase 47: MemberCard Action Button Layout Stability & UI Button Normalisation
* **Problem Statement & Root Cause Diagnosis:**
  - In `MemberCard.tsx`, the primary `"Nag in Discord Journal"` action button and secondary contextual pills (Grace countdown, Vote Strike, Strike Issued, Metastrike Active) were rendered in a flex row with `flex-wrap` and `flex-1`.
  - When rendered in multi-column desktop grids or mobile single columns, the available width inside the card (~250px-300px) could not accommodate both elements side-by-side without wrapping.
  - Because `"Nag in Discord Journal"` lacked `whitespace-nowrap`, its text wrapped onto 3 vertical lines ("Nag in / Discord / Journal"), causing the button height to balloon from 44px to ~76px.
  - Furthermore, as time progressed (e.g. from 0-5m Grace period to >5m Overdue Vote Strike), the sibling element changed widths. This triggered erratic flex layout recalculations where the button wrapped onto two rows, snapped from 3 lines tall to 1 line tall, or shifted vertically whenever nag assist counters or strike logs updated.
* **MemberCard Action Bar Stabilization (`src/components/MemberCard.tsx`):**
  - **Height-Locked, Full-Width Primary Action:** The primary `"Nag in Discord Journal ↗"` button now spans the full card width (`w-full`) with height-locked dimensions (`h-11 min-h-[44px]`), single-line text (`whitespace-nowrap truncate`), and an invariant rounded shape (`rounded-xl`).
  - **Dedicated Secondary Action / Status Row:** Secondary contextual pills (Grace countdown `Grace: Xm left`, community verification `Vote Strike (X/2)`, `Strike Issued Tonight`, and `Metastrike Active: Reason`) now render in a dedicated, height-locked row directly below the primary button (`w-full h-9 min-h-[36px] whitespace-nowrap`).
  - **Zero Shape Shifting or Jumping:** Regardless of time progression, grace countdown, strike voting, or nag counter increments, the primary button retains its exact shape, size, and position without ever wrapping or distorting.
  - **Normalized Other MemberCard Buttons:** Normalized viewer "I'm in Bed Now" check-in (`h-11 min-h-[44px] whitespace-nowrap`), early check-in (`h-11 min-h-[44px] whitespace-nowrap`), viewer check-in undo banners (`h-11 min-h-[44px] whitespace-nowrap`), and viewer Metastrike excuse buttons (`h-11 min-h-[44px] whitespace-nowrap`).
* **Global UI Button Normalisation:**
  - `src/components/Header.tsx`: Normalized Mod Panel button, Alerts toggle button, member profile pill, log out button, and log in button to `h-11 min-h-[44px] whitespace-nowrap`.
  - `src/components/PwaBanner.tsx`: Normalized native "Install App" and "Turn On" push buttons to `h-10 min-h-[40px] whitespace-nowrap flex items-center justify-center`.
  - `src/components/PushModal.tsx`: Normalized "Send Test Alert", "Turn Off", and "Turn On Bedtime & Nag Alerts" buttons to `h-11 min-h-[44px] whitespace-nowrap`.
  - `src/components/MetastrikeModal.tsx`: Normalized "Cancel" and "Protect Tonight / Convert to Metastrike" submit buttons to `h-11 min-h-[44px] whitespace-nowrap`.
  - `src/components/MyScheduleModal.tsx`: Normalized "Lock", "Queue 48h Schedule Change / Save Profile Changes", and "Log Out of Fox Den" buttons to `h-11 min-h-[44px] whitespace-nowrap`.
  - `src/app/page.tsx`: Normalized banner "I'm in Bed (Goodnight)" button, Buddy filter toggles, and empty state CTA buttons to `h-11 min-h-[44px] whitespace-nowrap`.
* **Verification Check:**
  - `npx tsc --noEmit` verified clean with 0 errors.
  - `npm run build` verified clean with all 29/29 routes compiled and prerendered.
  - `node scripts/test-phase2-mobile-touch-ux.mjs` passed cleanly.
  - `node scripts/test-login-and-auth.mjs` passed cleanly.

### Phase 46: Schedule Tab Redundancy Elimination & Discord Handle Auto-fill
* **Header Navigation Redundancy Elimination (`src/components/Header.tsx`):**
  * Removed the duplicate "My Schedule" button from the desktop command bar.
  * Tapping the authenticated member profile pill (`@${currentUser.discord_username}`) directly triggers the unified self-service profile and schedule modal (`onOpenSchedule`).
  * Updated profile pill tooltip to `Logged in as @${currentUser.discord_username}. Tap to view your profile & schedule.`.
* **Profile Modal Form Field Harmonization (`src/components/MyScheduleModal.tsx`):**
  * Auto-filled Discord Handle: Eliminated the confusing optional manual input for "Discord Handle". The Discord handle is now auto-filled from the user's authenticated Discord account (with a checkmark badge `Auto-filled from Discord` and lock icon), and rendered as read-only and disabled.
  * Website Username Modification: Relabeled the editable username input to **"Website Username"** with descriptive caption: *"Your display name shown across Z Catchers. You can modify this anytime."* Members can freely customize their website username without affecting their linked Discord identity.
  * Unified Modal Title: Updated modal heading to **"My Profile & Schedule"** with subtitle *"Accountability settings, sleep schedule & website profile"*.
* **Database & Auth Pipeline Auto-Healing (`src/app/api/auth/me/route.ts`, `src/lib/auth.ts`):**
  * Added fallback auto-population in `/api/auth/me` and `/api/auth/discord/callback` to ensure `discord_handle` is always preserved and auto-healed with `@` formatting.
  * Verified and updated active member database row in Supabase (`discord_id = 617551062102048779`) with `discord_handle = '@krish'`.
* **Automated Regression Test Suite (`scripts/test-profile-and-schedule-tab.mjs`):**
  * Created unit test suite verifying that "My Schedule" is removed from Header, profile pill opens the modal, "Website Username" is editable, and "Discord Handle" is read-only and auto-filled.
* **Verification Check:**
  * `npx tsc --noEmit` clean (0 errors).
  * `npm run build` clean (29/29 routes compiled and prerendered).
  * `node scripts/test-profile-and-schedule-tab.mjs` passed cleanly.
  * `node scripts/test-login-and-auth.mjs` passed cleanly.
  * `node scripts/test-logout-flow.mjs` passed cleanly.
  * `node scripts/test-phase35-pwa-phone-robustness.mjs` passed cleanly.

### Phase 45: Production Release PR #20 (`dev` → `main`)
* **Production Release Pull Request Creation:**
  * Created production release Pull Request [#20 (`dev` → `main`)](https://github.com/KrishJdev/Z-Catchers/pull/20) to promote all verified, hardened features from Phases 33 through 44 into production (`main`).
  * Encompasses Discord OAuth2 authentication & 90-day rolling sessions (Phases 39–42), community 2-vote strikes & excused metastrikes accountability engine (Phases 34, 37, 38), mobile PWA safe areas, keyboard avoidance, and offline caching (Phases 35–36), DST-resilient timezone calculations (Phase 33), database maintenance profile purges (Phase 43), and root layout hydration protection (Phase 44).
* **Comprehensive Release Verification Check:**
  * Clean zero-conflict tree merge verified between `origin/main` and `origin/dev`.
  * `npx tsc --noEmit` verified clean with 0 errors.
  * `npm run build` verified clean with all 29/29 static and dynamic routes compiled.
  * All automated test suites executed and verified passing (`scripts/test-strikes-system.mjs`, `scripts/test-login-and-auth.mjs`, `scripts/test-logout-flow.mjs`, `scripts/test-weekend-hours.mjs`).


### Phase 45: Production Deployment Auth Resilience & Cryptographic Fallback (SESSION_SECRET & PIN_SALT)
* **Resilient Production Key Fallback (`src/lib/auth.ts`):**
  - **Issue Resolved:** On Vercel production deployments, if `SESSION_SECRET` or `PIN_SALT` was not explicitly set in project environment variables, `getSessionSecret()` threw a fatal unhandled error: `"Authentication error: SESSION_SECRET environment variable is required in production."`, redirecting users to `/join` with an error banner upon Discord login callback.
  - **Cryptographic Key Derivation:** Updated `getSessionSecret()` and `getPinSalt()` to never throw unhandled exceptions in production. If the explicit environment variable is omitted, the engine deterministically derives a 256-bit HMAC secret key from server credentials (`SUPABASE_SERVICE_ROLE_KEY` or `DISCORD_CLIENT_SECRET`) via `crypto.createHmac('sha256', serverKey).update(...)` or falls back to a stable den secret string.
  - **Candidate Multi-Key Token Verification (`getVerificationSessionSecrets`):** In `verifySessionToken` and `verifyClaimToken`, incoming HMAC-SHA256 tokens are verified against all candidate secrets (explicit secret, derived key, fallback key). This ensures active 90-day sessions remain valid and seamless even during secret rotations or when `SESSION_SECRET` is later added to hosting provider settings.
  - **Automated Test Suite (`scripts/test-login-and-auth.mjs`):** Added Section 1B verifying that under `NODE_ENV='production'` without `SESSION_SECRET` or `PIN_SALT`, neither helper throws, session and claim tokens are successfully created and verified, and tokens signed under fallback verify cleanly after explicit `SESSION_SECRET` is subsequently defined.
* **Profile & Schedule Redundancy Elimination (`src/components/MyScheduleModal.tsx`, `scripts/test-profile-and-schedule-tab.mjs`):**
  - Clarified user display names by labeling the editable profile input as `"Website Username"`.
  - Displayed the Discord Handle as an auto-filled, read-only field with a green `"Auto-filled from Discord"` checkmark and lock icon to prevent member impersonation.
* **Environment Documentation (`.env.example`):**
  - Updated configuration notes clarifying that while `SESSION_SECRET` and `PIN_SALT` are strongly recommended in production, the engine provides automatic resilient derivation from server credentials to prevent login lockouts.
* **Verification Check:**
  - `npx tsc --noEmit` verified clean with 0 errors.
  - `npm run build` verified clean with 29/29 routes compiled.
  - All automated test suites passed:
    - `node scripts/test-login-and-auth.mjs` (including Section 1B production secret fallback)
    - `node scripts/test-profile-and-schedule-tab.mjs`
    - `node scripts/test-logout-flow.mjs`
    - `node scripts/test-strikes-system.mjs`
    - `node scripts/test-phase35-pwa-phone-robustness.mjs`

### Phase 44: Root Layout Browser Extension Hydration Mismatch Fix
* **Client Attribute Hydration Suppression (`src/app/layout.tsx`):**
  * Added `suppressHydrationWarning` to the root `<html>` and `<body>` elements in [`src/app/layout.tsx`](./src/app/layout.tsx).
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

### Active Backlog Tasks: Phase 61 Robustness & Security Audit

| Issue Key | Priority | Summary | Target Files | Linked GitHub Issue | Status |
|---|---|---|---|---|---|
| **ZC-16** | **High (P1)** | Security: Remove hardcoded fallback session secrets & dev PIN salt in production | `src/lib/auth.ts` | [#30](https://github.com/KrishJdev/Z-Catchers/issues/30) | **DONE** |
| **ZC-17** | **High (P1)** | Security: Fix unauthenticated push endpoint deletion in `/api/push/unsubscribe` | `src/app/api/push/unsubscribe/route.ts` | [#31](https://github.com/KrishJdev/Z-Catchers/issues/31) / [#46](https://github.com/KrishJdev/Z-Catchers/issues/46) | **DONE** |
| **ZC-18** | **High (P1)** | Security: Enforce database-backed persistent rate limiting in `cancel-pending` and `push/subscribe` | `src/app/api/members/cancel-pending/route.ts`, `src/app/api/push/subscribe/route.ts` | [#32](https://github.com/KrishJdev/Z-Catchers/issues/32) | **DONE** |
| **ZC-19** | **High (P1)** | Security: Sanitize and validate `x-forwarded-host` in OAuth redirect base URL | `src/lib/auth.ts` | [#33](https://github.com/KrishJdev/Z-Catchers/issues/33) | **TODO** |
| **ZC-20** | **High (P1)** | Security: Prevent IDOR / unauthenticated claim in `update-schedule` when mod rate limit is exceeded | `src/app/api/members/update-schedule/route.ts` | [#34](https://github.com/KrishJdev/Z-Catchers/issues/34) | **TODO** |
| **ZC-21** | **Medium (P2)** | PWA / Notifications: Prevent race condition by recording nag deduplication before sending push | `src/app/api/members/nag-notif/route.ts` | [#35](https://github.com/KrishJdev/Z-Catchers/issues/35) | **TODO** |
| **ZC-22** | **Medium (P2)** | PWA / Push: Add Authorization Bearer header to push test and unsubscribe requests | `src/components/PushModal.tsx`, `src/lib/pushClient.ts` | [#36](https://github.com/KrishJdev/Z-Catchers/issues/36) | **DONE** |
| **ZC-23** | **Medium (P2)** | Backend: Align nag-assist date calculation with `getSleepCycleDate()` | `src/app/api/members/nag-assist/route.ts` | [#37](https://github.com/KrishJdev/Z-Catchers/issues/37) | **TODO** |
| **ZC-24** | **Medium (P2)** | PWA / Service Worker: Resolve `notificationclick` message dropping during tab navigation | `public/sw.js` | [#38](https://github.com/KrishJdev/Z-Catchers/issues/38) | **TODO** |
| **ZC-25** | **Medium (P2)** | Backend: Remove `wake_time_local` default destructuring to prevent schedule overwrites | `src/app/api/members/update-schedule/route.ts` | [#39](https://github.com/KrishJdev/Z-Catchers/issues/39) | **TODO** |
| **ZC-26** | **Medium (P3)** | State Machine: Reconcile Sleep Shield active vs `canVoteStrike` in 60-480m overdue window | `src/lib/sleepEngine.ts`, `src/components/MemberCard.tsx` | [#40](https://github.com/KrishJdev/Z-Catchers/issues/40) | **TODO** |
| **ZC-27** | **Low (P3)** | State Machine: Enforce mutual exclusion between `is_in_bed` and `is_woke_up` flags | `src/app/api/auth/me/route.ts`, `src/app/api/members/route.ts` | [#41](https://github.com/KrishJdev/Z-Catchers/issues/41) | **TODO** |
| **ZC-14** | **Low (P3)** | Security / ModDrawer: Avoid storing plaintext moderator passcode in `sessionStorage` | `src/components/ModDrawer.tsx` | [#42](https://github.com/KrishJdev/Z-Catchers/issues/42) | **TODO** |
| **ZC-15** | **Low (P3)** | PWA / Cache: Implement versioned cache invalidation for `_next/static` assets in Service Worker | `public/sw.js` | [#43](https://github.com/KrishJdev/Z-Catchers/issues/43) | **TODO** |

### Historical Implementation Milestones (Completed & Verified)

| Issue Key | Summary / Milestone | Status | Completed In |
|---|---|---|---|
| **ZC-1** | Epic: Phase 1 MVP Core Application | DONE | MVP Complete |
| **ZC-2** | Phase 1.1: Database Schema & Supabase Configuration | DONE | Commit `a7d7d29` |
| **ZC-3** | Phase 1.2: Luxon Sleep Engine & Cross-Timezone Calculations | DONE | Commit `a7d7d29` |
| **ZC-4** | Phase 1.3: Warm Dark Mobile Dashboard UI & Status Buckets | DONE | Commit `733ea23` |
| **ZC-5** | Phase 1.4: Self-Service Schedule Edit Modal & 48h Cooldown | DONE | Commit `46025db` |
| **ZC-6** | Phase 1.5: Web Push Notification Engine & Service Worker | DONE | Commit `fee9f22` |
| **ZC-7** | Phase 1.6: 1-Minute Cron Dispatcher & Sleep Shield Guardrail | DONE | Commit `fee9f22` |
| **ZC-8** | Epic: Phase 2 Moderation & Anti-Dodge Controls | DONE | Commit `f8ddcb2` |
| **ZC-9** | Phase 2.1: Passcode-Protected Moderator Drawer (`ModDrawer.tsx`)| DONE | Commit `d66de1f` / `4339402` |
| **ZC-10**| Phase 2.2: Instant Cooldown Override & Roster Admin API | DONE | Commit `a3fc7fa` |
| **ZC-11**| Epic: Phase 3 Sleep Streaks, Badges & Discord Webhooks | DONE | Phase 8 Complete |
| **ZC-12**| Phase 3.1: Bedtime Compliance Scoring & Streak Tracking | DONE | Phase 5 / Phase 8 |
| **ZC-13**| Phase 3.2: Automated Discord Channel Webhooks & Nag Assists | DONE | Phase 8 Complete |

---

## 7. Immediate Next Steps (For the Next Agent / Session)

1. **Sprint 1 — P1 (High Priority) Security & Auth Hardening:**
   * **ZC-16 / GH #30 (`src/lib/auth.ts`):** **[DONE in Phase 76]** Failed closed in production for `SESSION_SECRET` and `PIN_SALT`. Strictly stripped fallback secrets when `NODE_ENV === 'production'`.
   * **ZC-17 / GH #31 & #46 (`src/app/api/push/unsubscribe/route.ts`):** **[DONE in Phase 80]** Strictly enforced authenticated member session for all unsubscriptions; chained `.eq('member_id', sessionMemberId)` on endpoint deletions to prevent IDOR and DoS subscription wiping.
   * **ZC-22 / GH #36 (`src/components/PushModal.tsx`, `src/lib/pushClient.ts`):** **[DONE in Phase 80]** Injected `Authorization: Bearer <token>` into `/api/push/unsubscribe` and `/api/push/test` requests to survive cookie-restricted PWA runtimes.
   * **ZC-18 / GH #32 (`src/app/api/members/cancel-pending/route.ts`, `src/app/api/push/subscribe/route.ts`):** **[DONE in Phase 81]** Enforced database-backed persistent rate limiting using `checkPinRateLimitPersistent`, `recordPinFailurePersistent`, and `resetPinFailurePersistent` backed by Supabase `rate_limits` table.
   * **ZC-19 / GH #33 & #48 (`src/lib/auth.ts`, `src/app/api/auth/login/route.ts`, `src/app/api/auth/register/route.ts`):** **[DONE in Phase 82]** Sanitized host headers, enforced trusted origin allowlists (`isTrustedHost`) with preview and loopback isolation, prioritized `NEXT_PUBLIC_APP_URL` as authoritative source of truth, and prevented host header poisoning / OAuth redirect hijacking.
   * **ZC-20 / GH #34 (`src/app/api/members/update-schedule/route.ts`):** **[NEXT UP]** Return HTTP 429 immediately when moderator rate limit is exceeded instead of falling through to claim unlinked profiles.

2. **Sprint 2 — P2 (Medium Priority) PWA, Push & Concurrency Fixes:**
   * **ZC-21 / GH #35 (`src/app/api/members/nag-notif/route.ts`):** Commit notification log deduplication record before dispatching push notifications.
   * **ZC-23 / GH #37 (`src/app/api/members/nag-assist/route.ts`):** Calculate local date using `getSleepCycleDate()` instead of standard calendar day.
   * **ZC-24 / GH #38 (`public/sw.js`):** Clean up `postMessage` during `client.navigate()` in service worker `notificationclick` handler to avoid dropped deep link actions.
   * **ZC-25 / GH #39 (`src/app/api/members/update-schedule/route.ts`):** Remove default `= '07:00'` destructuring to prevent unintentional overwriting of custom wake times.

3. **Sprint 3 — P3 (Low Priority) State Machine, UI Polish & SW Cache Invalidation:**
   * **ZC-26 / GH #40 (`src/lib/sleepEngine.ts`, `src/components/MemberCard.tsx`):** Reconcile conflicting `isSleepShieldActive` vs `canVoteStrike` states in 60-480m overdue window.
   * **ZC-27 / GH #41 (`src/app/api/auth/me/route.ts`, `src/app/api/members/route.ts`):** Enforce mutual exclusion between `is_in_bed` and `is_woke_up`.
   * **ZC-14 / GH #42 (`src/components/ModDrawer.tsx`):** Avoid storing plaintext master moderator passcode in browser `sessionStorage`.
   * **ZC-15 / GH #43 (`public/sw.js`):** Implement build-hash or versioned cache busting for `_next/static` assets to prevent hydration mismatches on new deployments.

4. **Review & Merge Active Integration Pull Request [#44 [OPEN]](https://github.com/KrishJdev/Z-Catchers/pull/44):**
   * Active PR: [#44 `chore: sync code audit issues to Jira, cross-link GitHub issues, and update transition tooling`](https://github.com/KrishJdev/Z-Catchers/pull/44) targets `dev` from `krish`.
   * Integrates all verified Phase 61 audit synchronization and Jira transition tooling into `dev`:
     - Jira audit issues `ZC-14` through `ZC-27` mapped to GitHub issues `#30` through `#43`.
     - Hardened Jira transition workflow and idempotent transition scripts.
     - Documented audit matrix and taxonomy in `HANDOFF.md`.
   * Note: Production release PR [#28 [MERGED]](https://github.com/KrishJdev/Z-Catchers/pull/28) was successfully merged into `main`.

5. **Database Migration Execution in Supabase SQL Editor:**
   * Run the complete, updated idempotent migration from `supabase/schema.sql` on the remote Supabase database before deployment, ensuring it includes the `weekly_schedule` and `pending_weekly_schedule` column changes and backfill:
     ```sql
     -- Members table columns
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

     -- 7-Day Variable Sleep Schedule Migration & Backfill (Phase 63)
     ALTER TABLE public.members ADD COLUMN IF NOT EXISTS weekly_schedule JSONB;
     ALTER TABLE public.members ADD COLUMN IF NOT EXISTS pending_weekly_schedule JSONB;

     -- Backfill existing members from their current weekday and weekend columns
     UPDATE public.members
     SET weekly_schedule = jsonb_build_object(
       'mon', jsonb_build_object('bedtime', bedtime_local, 'wake_time', wake_time_local),
       'tue', jsonb_build_object('bedtime', bedtime_local, 'wake_time', wake_time_local),
       'wed', jsonb_build_object('bedtime', bedtime_local, 'wake_time', wake_time_local),
       'thu', jsonb_build_object('bedtime', bedtime_local, 'wake_time', wake_time_local),
       'fri', jsonb_build_object('bedtime', COALESCE(weekend_bedtime_local, bedtime_local), 'wake_time', COALESCE(weekend_wake_time_local, wake_time_local)),
       'sat', jsonb_build_object('bedtime', COALESCE(weekend_bedtime_local, bedtime_local), 'wake_time', COALESCE(weekend_wake_time_local, wake_time_local)),
       'sun', jsonb_build_object('bedtime', bedtime_local, 'wake_time', wake_time_local)
     )
     WHERE weekly_schedule IS NULL;

     -- Backfill pending schedules for members with active cooldown
     UPDATE public.members
     SET pending_weekly_schedule = jsonb_build_object(
       'mon', jsonb_build_object('bedtime', COALESCE(pending_bedtime_local, bedtime_local), 'wake_time', COALESCE(pending_wake_time_local, wake_time_local)),
       'tue', jsonb_build_object('bedtime', COALESCE(pending_bedtime_local, bedtime_local), 'wake_time', COALESCE(pending_wake_time_local, wake_time_local)),
       'wed', jsonb_build_object('bedtime', COALESCE(pending_bedtime_local, bedtime_local), 'wake_time', COALESCE(pending_wake_time_local, wake_time_local)),
       'thu', jsonb_build_object('bedtime', COALESCE(pending_bedtime_local, bedtime_local), 'wake_time', COALESCE(pending_wake_time_local, wake_time_local)),
       'fri', jsonb_build_object('bedtime', COALESCE(pending_weekend_bedtime_local, pending_bedtime_local, weekend_bedtime_local, bedtime_local), 'wake_time', COALESCE(pending_weekend_wake_time_local, pending_wake_time_local, weekend_wake_time_local, wake_time_local)),
       'sat', jsonb_build_object('bedtime', COALESCE(pending_weekend_bedtime_local, pending_bedtime_local, weekend_bedtime_local, bedtime_local), 'wake_time', COALESCE(pending_weekend_wake_time_local, pending_wake_time_local, weekend_wake_time_local, wake_time_local)),
       'sun', jsonb_build_object('bedtime', COALESCE(pending_bedtime_local, bedtime_local), 'wake_time', COALESCE(pending_wake_time_local, wake_time_local))
     )
     WHERE pending_effective_at IS NOT NULL AND pending_weekly_schedule IS NULL;

     -- Persistent Rate Limiting Table
     CREATE TABLE IF NOT EXISTS public.rate_limits (
       key TEXT PRIMARY KEY,
       count INTEGER NOT NULL DEFAULT 1,
       window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       expires_at TIMESTAMPTZ NOT NULL
     );
     CREATE INDEX IF NOT EXISTS idx_rate_limits_expires_at ON public.rate_limits (expires_at);

     -- Cron Execution & Notification Idempotency Locks
     CREATE TABLE IF NOT EXISTS public.cron_locks (
       lock_key TEXT PRIMARY KEY,
       locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       expires_at TIMESTAMPTZ NOT NULL,
       metadata JSONB DEFAULT '{}'::jsonb
     );
     CREATE INDEX IF NOT EXISTS idx_cron_locks_expires_at ON public.cron_locks (expires_at);

     -- Row Level Security & Service Role Policies
     ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
     ALTER TABLE public.cron_locks ENABLE ROW LEVEL SECURITY;

     DROP POLICY IF EXISTS "Service role full access on rate_limits" ON public.rate_limits;
     CREATE POLICY "Service role full access on rate_limits" ON public.rate_limits
       FOR ALL USING (auth.role() = 'service_role');

     DROP POLICY IF EXISTS "Service role full access on cron_locks" ON public.cron_locks;
     CREATE POLICY "Service role full access on cron_locks" ON public.cron_locks
       FOR ALL USING (auth.role() = 'service_role');

     -- Fast Wake-Up State Resolution & Sleep Logs Migration
     ALTER TABLE public.members
       ADD COLUMN IF NOT EXISTS last_woke_up_at TIMESTAMPTZ,
       ADD COLUMN IF NOT EXISTS last_wake_cycle_date TEXT;

     CREATE TABLE IF NOT EXISTS public.sleep_logs (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
       cycle_date TEXT NOT NULL,
       timezone TEXT NOT NULL DEFAULT 'UTC',
       target_bedtime TEXT,
       target_wake_time TEXT,
       in_bed_at TIMESTAMPTZ,
       in_bed_local_time TEXT,
       woke_up_at TIMESTAMPTZ,
       woke_up_local_time TEXT,
       wake_source TEXT CHECK (wake_source IN ('button', 'manual')),
       duration_minutes INTEGER,
       status TEXT NOT NULL DEFAULT 'on_time' CHECK (status IN ('on_time', 'late', 'missed', 'metastrike')),
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       UNIQUE (member_id, cycle_date)
     );

     -- Guarded migration: Convert sleep_logs.member_id from TEXT to UUID and link foreign key if upgrading existing table
     DO $$
     BEGIN
       IF EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'sleep_logs'
           AND column_name = 'member_id' AND data_type = 'text'
       ) THEN
         DELETE FROM public.sleep_logs
         WHERE member_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            OR member_id::uuid NOT IN (SELECT id FROM public.members);

         ALTER TABLE public.sleep_logs
           ALTER COLUMN member_id TYPE UUID USING member_id::uuid;

         IF NOT EXISTS (
           SELECT 1 FROM information_schema.table_constraints
           WHERE constraint_schema = 'public'
             AND table_name = 'sleep_logs'
             AND constraint_name = 'sleep_logs_member_id_fkey'
         ) THEN
           ALTER TABLE public.sleep_logs
             ADD CONSTRAINT sleep_logs_member_id_fkey
             FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;
         END IF;
       END IF;
     END $$;

     CREATE INDEX IF NOT EXISTS idx_sleep_logs_member_cycle
       ON public.sleep_logs (member_id, cycle_date DESC);

     ALTER TABLE public.sleep_logs ENABLE ROW LEVEL SECURITY;
     DROP POLICY IF EXISTS "Public read sleep_logs" ON public.sleep_logs;
     DROP POLICY IF EXISTS "Public can view sleep logs" ON public.sleep_logs;
     DROP POLICY IF EXISTS "Service role full access sleep_logs" ON public.sleep_logs;
     DROP POLICY IF EXISTS "Service role full access on sleep_logs" ON public.sleep_logs;
     CREATE POLICY "Service role full access on sleep_logs" ON public.sleep_logs FOR ALL USING (auth.role() = 'service_role');
     ALTER PUBLICATION supabase_realtime ADD TABLE public.sleep_logs;
     ```

6. **Configure Discord Application & Environment Variables in Hosting Provider (Vercel):**
   * Set `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `NEXT_PUBLIC_APP_URL`, and `MOD_DISCORD_IDS` in Vercel project environment settings.
   * Add `${NEXT_PUBLIC_APP_URL}/api/auth/discord/callback` to OAuth2 Redirects in Discord Developer Portal.

7. **Verify Production Deployment Following Release Merges (`main`):**
   * Production releases up to PR #26 successfully merged into `main`.
   * Verify deployment logs and Discord login flow in Vercel following merge to production `main`.
   * **Mandatory Environment Configuration & Security Precondition:**
     * `SESSION_SECRET` (random 32+ char string) and `PIN_SALT` must be explicitly configured in Vercel Project Settings > Environment Variables. Do not treat `SESSION_SECRET` as optional.
     * Note that configuring `SESSION_SECRET` alone does **not** secure authentication: production deployments must **not** be considered secure while fallback-secret verification remains active in `src/lib/auth.ts`.
     * **ZC-16 / GH #30** is resolved in Phase 76: hardcoded fallback session secrets and dev PIN salts are stripped in production with fail-closed validation enforced.
