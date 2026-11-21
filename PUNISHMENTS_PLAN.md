# Z Catchers Punishments Implementation Plan

**Target release:** November 2026

Create a separate punishment at every third valid strike in a member’s local calendar month. Moderators assign and complete individual tasks. Use verified November strikes for the first release so members can earn punishments this month.

## Rules and month-end behavior

- Strikes 3, 6, and 9 each create one punishment. Record one automatic strike per missed sleep cycle, including cycles after the third strike.
- Use Luxon to attribute strikes to the member’s local sleep-cycle date. A November 30 bedtime belongs to November even if dispatch runs on December 1. Store the cycle date so a later timezone change preserves its month.
- Count a new punishment as open immediately and show it as **Pending** while its qualifying strikes can still be replaced with a Metastrike. Once the existing replacement window closes, show **Awaiting assignment**. A valid replacement or moderator correction cancels any open punishment whose threshold is no longer met. Keep the three monthly Metastrikes under the existing rules.
- Reset progress toward the next punishment on the first day of each local month. Carry all open punishments forward with their original tasks and dates, including pending and unassigned items.
- Completing an assigned task lowers the open count by one and moves that task to history. Later strike corrections preserve completed tasks. If the member earns a canceled threshold again in the same month, reuse its record.

**Example.** Seven November strikes earn two punishments and leave one strike toward the next threshold. After completing one task, the member starts December with one open punishment and zero December strikes. Three December strikes add a second open punishment.

## November 2026 launch policy

Seed verified November strikes from `nightly_strike_logs` and documented, dated moderator corrections. Two valid strikes give `2 of 3` progress. Three earn one punishment, subject to the remaining Metastrike window. Preserve the member’s used Metastrikes and existing history.

Use the member’s stored local sleep-cycle date for month attribution. At activation, use verified records for pre-launch cycles and flag discrepancies with old counters for moderator review. For new automatic strikes, compare the cycle’s normal strike cutoff to the activation timestamp. This prevents cron catch-up from charging for unrecorded pre-launch misses. Run the preview, activation, and seed in the order specified in Phases 5 and 6.

## Mobile navigation and member screens

### Roster and bottom navigation

- Use **Roster · My Sleep** in the mobile bottom bar. Add **Mod** for signed-in moderators. Keep the pinned nightly check-in and wake-up actions on the roster.
- Use the header for the profile avatar and an adjacent bell. The bell opens the existing notification settings and shows the device’s push status.

### Profile

- Open a compact signed-in sheet for **Edit profile**, **Sleep schedule**, and **Sign out**. Show the active bedtime and wake time near the schedule row. Open the full schedule editor from that row and show any pending change with its effective time.
- Bind the sheet to the signed-in member. Remove the profile selector, **Join Roster** tab, and duplicate nightly check-in card from the signed-in sheet. Use Discord sign-in and onboarding through `/join`.

### My Sleep

- Replace **My Time** with a personal dashboard for the existing sleep calendar and streaks, monthly strike progress, and punishments. Put **Punishments** here and link the member’s own `2 open` roster badge directly to the task list.
- Show the monthly strike total and a three-step meter labeled `1 of 3 toward your next punishment`. List open items oldest first and put completed history below. Rows show their status, earned date, and task title and instructions once assigned.
- Use single-column bottom sheets on phones and dialogs on desktop, with Warm Dark colors, 44 px tap targets, and the Sleepy Fox in the empty state. Load task details through authenticated reads for the member and authorized moderators.

### Moderator

- Open the existing drawer from the **Mod** bottom tab. Use effective moderator status from the authenticated session, covering database-role moderators and moderators configured by Discord ID. Apply server-side moderator authorization to every operation.
- Add **Punishments** to the drawer. Lead with **Needs assignment**, with assigned work below it. Show each member name, earned date, and status.
- Let mods assign a short task title and optional instructions, edit the task, and mark it complete. Record the action, time, and moderator identity when the existing authorization supplies one.
- Keep the assignment form short. Example tasks include writing a two-line wind-down plan or posting a short journal check-in.

## Website cleanup

### Discord onboarding and member PINs

The owner confirmed that all current members joined through Discord. Use `/join` as the only onboarding entry point and bind new profiles to the verified Discord ID. Returning members sign in to their existing linked profile.

- Remove **Add Member** from the Mod drawer and retire its manual creation action. Remove the old claim selector, claim API branch, and prototype PIN setup and reset controls. Preserve the Discord new-profile path currently served by the onboarding endpoint.
- Remove member-PIN and first-time claim fallbacks from schedule edits, pending-change cancellation, check-in, wake-up, Metastrikes, and foreground push enrollment and sync. Require the signed-in Discord account to own the profile for these member actions. Keep server-side moderator authorization and the existing requirements for overriding the 48-hour schedule cooldown. Support sessionless background rotation of an existing device subscription using the device credential in Phase 1.
- Remove the unused login modal and update old links and copy. Review consumers of the deprecated login and registration endpoints before retiring compatibility redirects. Route any redirects that are still needed through `/join`.

### Roster and moderator tools

- Make the pinned bar the primary mobile entry point for **I’m in bed** and **I woke up**. Turn the roster banner into a short status summary and remove duplicate controls from the member’s own mobile card. Keep manual wake-time entry and label **Undo check-in** as a separate action.
- Replace the desktop Sleep Shield switch with a status indicator. The named check-in, wake-up, and undo controls should be the points where members change their sleep records.
- Use **Approvals · Roster · Punishments** as the main Mod drawer tabs. Put webhook configuration status, test delivery, and manual digest under **Advanced**. Keep the existing Discord dispatch flow available.

### Peer strike voting

- Remove the roster’s vote fields, obsolete vote state, and references to peer voting. Check callers before retiring the disabled vote endpoint and any legacy data fields. Keep nightly strike history, automatic missed-bedtime strikes, moderator corrections, and Metastrikes available to the new punishment workflow.

## Implementation phases

Complete each phase’s exit checks before starting the next phase. Keep backend contracts compatible through rollout and record test results in `HANDOFF.md`.

### Feature branches and pull requests

The owner approved one feature branch and one PR per phase for this rollout. Start Phase 0 from the latest `origin/dev`. For each later phase, wait for the previous phase PR to merge, update `origin/dev`, and create a new branch from that merged state. Open every phase PR against `dev`. Include only that phase’s changes and report its exit-check results in the PR.

| Phase | Feature branch |
| --- | --- |
| 0 · Baseline and inventory | `codex/punishments-0-baseline` |
| 1 · Discord-only authentication | `codex/punishments-1-discord-auth` |
| 2 · Strike ledger and migration | `codex/punishments-2-strike-ledger` |
| 3 · Member and moderator APIs | `codex/punishments-3-task-apis` |
| 4 · Mobile and desktop screens | `codex/punishments-4-screens` |
| 5 · Dev rehearsal | `codex/punishments-5-dev-rehearsal` |
| 6 · Production cutover | `codex/punishments-6-release` |

Use the Phase 5 PR for rehearsal changes and verify the merged `dev` build before starting Phase 6. Use the Phase 6 PR for the release checklist and any cutover tooling. Once it merges to `dev`, open the separate `dev` → `main` release PR and follow the activation steps below.

### Phase 0 · Baseline and inventory

1. Verify the working branch and preserve existing workspace edits. Run `npx tsc --noEmit`, `npm run test:unit`, and `npm run build` to establish the baseline.
2. Inventory callers of Discord onboarding, member PIN and claim paths, both moderator entry points, and every write to the strike ledger and monthly counters. Check the schema, migrations, SQL functions, dispatcher, fallback store, moderator routes, display copy, and existing tests for the old three-strike cap.
3. Record a baseline on a `dev` or disposable database with a regular Discord member, a database-role moderator, and a Discord-ID moderator. Exercise sign-in, schedule changes and cancellation, check-in, undo, wake-up, Metastrikes, and push. Check which scheduler is active and use the same dispatch path in rehearsal.

**Exit check.** The baseline passes, and the implementation has a list of all writers and legacy callers to change. Note any pre-existing failures before making changes.

### Phase 1 · Discord-only authentication and role handling

1. Preserve the Discord callback’s returning-member path and the onboarding endpoint’s new-profile path. Remove the prototype claim UI and API branch from `/join` and `src/app/api/auth/claim-profile/route.ts`. Verify that returning sign-in reuses the same member ID.
2. Remove Add Member, member PIN setup, and Reset PIN from the UI and their write actions in `src/app/api/mod/route.ts`. Replace member-PIN and first-time claim fallbacks in schedule edits, cancellation, check-in, wake-up, Metastrikes, and foreground push enrollment and sync with authenticated member ownership. Retain authorized moderator actions, including the required passcode for immediate schedule overrides.
3. Use the effective moderator status returned by `/api/auth/me` for UI entry points. Validate permissions on the server for every privileged action. Retire unused login UI and compatibility code as callers are cleared. Keep needed old login and registration redirects routed through `/join` during rollout.
4. Provision an opaque per-subscription rotation credential when a signed-in device enrolls or syncs without one. Store its digest on the server and keep the credential in device storage accessible to the service worker. With no Discord session, the worker supplies this credential to replace the endpoint and keys of the bound subscription for its active owner. Preserve notification preferences and apply the replacement atomically. Verify the expected previous endpoint, accept an exact retry of a successful replacement, and reject stale requests or an endpoint already bound to another subscription. Revoke the credential when the device is unlinked. Keep `old_endpoint` compatibility for existing subscriptions until their worker has stored and confirmed its credential. Monitor remaining legacy use before retiring endpoint-only recovery.
5. In `public/sw.js`, treat any non-2xx rotation response or network failure as a failed sync. Keep the last confirmed subscription binding with a local repair marker so the foreground notification settings can repair the same subscription under the signed-in owner and preserve its preferences. Show when sign-in or another retry is needed. Clear the marker after the server confirms the replacement. Record server-side rotation failures with a reason code for operators and keep credentials, endpoints, and encryption keys out of logs.

**Exit check.** New and returning Discord sessions work for members and both moderator types. Unauthenticated member actions and cross-account writes fail. Regular member schedule edits still queue for 48 hours. Verify signed-in push enrollment and sync, sessionless rotation with a valid credential, and legacy device upgrade. Reject missing or revoked credentials for migrated subscriptions and attempts to take over another subscription's endpoint. Verify a rejected replacement preserves the stored binding and an exact retry confirms a replacement whose successful response was lost. Check visible repair for HTTP errors and network failures.

### Phase 2 · Strike ledger, punishment records, and migration

Start after the auth baseline in Phase 1. Implement and test the data path before exposing it in the app.

1. Add an incremental migration under `supabase/migrations` and mirror it in `supabase/schema.sql`. Create a punishment record with a unique member, earned month, and threshold number. Store status, qualification and action timestamps, assignment, and moderator action history. Limit data access to authorized server paths. Keep the new path inactive until the coordinated cutover.
2. Use dated nightly strike records and auditable dated moderator adjustments as the source of truth for punishment eligibility. Keep any monthly counters needed by existing callers synchronized as projections. Lift the regular strike cap in the data constraints, `apply_nightly_strike`, `src/lib/strikes.ts`, dispatcher, and moderator correction paths together. Review legacy reset and alias-repair logic so it can neither clamp valid strikes nor overwrite the wrong month. Keep the Metastrike allowance at three.
3. Update the strike, Metastrike conversion, and moderator correction paths to reconcile the affected month in the same transaction. Lock per member and keep one automatic strike per sleep cycle. Address races between cron, a check-in, a replacement, a correction, and the seed. Keep the month from the stored cycle date when the application evaluates an earlier cycle or a member changes timezone.
4. Create each earned threshold once. Start it as **Pending** while the qualifying strikes are replaceable. Make it assignable when the replacement window closes, and enforce that rule on the server. Cancel open records whose threshold no longer qualifies. Reuse a canceled threshold record if earned again. Preserve completed records and prevent reissuing a completed threshold in the same month.
5. Build a read-only November preview and an idempotent seed that uses the same locking and reconciliation logic as live writes. The preview reports verified rows, counter discrepancies, expected threshold records, and pending windows. Prepare a coordinated cutover with a durable activation timestamp and separate control over when the punishment screens become visible.

**Exit check.** Database tests cover strikes 3, 6, and 9, repeated and concurrent dispatch, duplicate seed runs, check-in races, and failed writes retried after rollback. Cover a November 30 cycle dispatched on December 1, a cross-month Metastrike or moderator correction, a canceled threshold earned again, completed history, and preservation of used passes. Rehearse the migration on a disposable database with existing data and verify that migration alone creates no punishments.

### Phase 3 · Member and moderator APIs

1. Add authenticated reads for the member’s own strike progress, open punishment count, task list, and history. Use a targeted or batched query for the signed-in member’s roster badge. Keep assignment details out of the roster response.
2. Add moderator-only assignment, editing, completion, and dated correction actions. Tie each write to a punishment ID and allowed state transition. Record the action time and moderator identity when available. Return the updated item and count from the server so the UI can recover after a retry.
3. Derive the open count from pending, unassigned, and assigned rows across all months. Distinguish **Pending** from **Awaiting assignment** in responses. Keep unavailable data distinguishable from a verified count of zero.
4. Remove obsolete peer vote state and fields once callers are updated. Leave externally used compatibility paths and legacy persisted fields available until their consumers are accounted for. Update the [product strike rules](PROJECT_SPEC.md#56-monthly-strikes--metastrikes-accountability-engine) and [backend specification](BACKEND_TZ_PWA_SPEC.md#23-monthly-strikes--metastrikes-accountability-system-engine) with the final rules and endpoint behavior.

**Exit check.** Test member and moderator authorization, cross-account reads and writes, attempted assignment before the replacement window closes, valid edits, correction during assignment, and two concurrent completions. The open count drops once for one completed task. Automatic strikes and Metastrikes still work after the peer-voting cleanup.

### Phase 4 · Mobile and desktop screens

1. Update the header and bottom navigation. Point the bell at notification settings, the avatar at the compact Profile sheet, and **My Sleep** at the personal calendar and accountability view. Show **Mod** in the mobile bottom bar using effective moderator status. Verify that each entry opens the intended destination after a session refresh.
2. Put the month’s strike total, progress toward the next punishment, task list, and history in My Sleep. Link the member’s own roster badge directly to the task list. Use explicit pending, unassigned, assigned, completed, and unavailable states. Replace old regular strike `x/3` labels with the monthly total and a separately labeled three-step threshold.
3. Simplify the roster and Profile. Keep the pinned bar as the primary mobile check-in, wake-up, and undo entry point. Make manual wake-time entry reachable from that flow before removing duplicate actions. The pinned wake request uses the current check-in identity. Apply `20261124_guard_active_wake.sql` before deploying these screens. Show desktop Sleep Shield as status. Display pending schedule edits and their effective times in the compact Profile flow.
4. Organize the Mod drawer around **Approvals · Roster · Punishments**. Put webhook operations under **Advanced**. Surface items needing assignment first and show the result of each task action using the authoritative server response.

**Exit check.** On a narrow installed PWA, verify check-in, wake-up now, manual wake time, undo, Profile, the bell, My Sleep, the roster badge, mobile Mod access for both moderator types, and task assignment and completion. Check safe-area spacing, tap targets, focus, and text overflow. Verify desktop access and the Sleep Shield status indicator.

### Phase 5 · Rehearse the November cutover in dev

1. Run TypeScript, the complete unit suite, the production build, and the Supabase dispatcher integration smoke test. Update the smoke fixtures for the new migration and strike workflow. Test with an isolated `dev` database, test Discord accounts, and a subscribed device.
2. Run the November preview on fixtures with zero, two, three, and six valid strikes. Include a recent replaceable strike, an unrecorded pre-launch miss, and a counter that disagrees with the dated ledger. Review discrepancies using dated evidence so no punishment is created from the counter alone.
3. Apply the migration while inactive. Deploy the compatible app with the punishment screens hidden, run the authenticated dispatcher dry run, activate the new writer at a test timestamp, and run the seed twice while dispatch is active. Compare the verified inputs and outputs, accounting for genuine new strikes posted since preview. Confirm that the feature uses the new writer before exposing the screens.
4. Exercise a full member and moderator flow. Verify rollover in two member timezones, zero new-month strike progress with an unfinished prior-month task, and completion of that task. Confirm the +10-minute strike cutoff, protection after check-in, the eight-hour sleep window, the 15-minute pre-bedtime community quiet period, and delivery to the subscribed device.

**Exit check.** `dev` CI and the device checks pass. Record the exact migration and activation steps, expected row counts, verified discrepancies, and supported rollback procedure in the release checklist. Hold production activation if any check fails.

Use the [November cutover checklist](PUNISHMENTS_RELEASE_CHECKLIST.md) for the rehearsal and record any live checks deferred by the owner before Phase 6.

### Phase 6 · Release, verify, and recover

1. Confirm the production database and deployment target, required prior migrations, and a restorable backup. Apply the new migration through the supported Supabase path. Deploy the tested `dev` changes through `main` with the punishment workflow inactive and its screens hidden. Confirm the existing sign-in and cron paths still work and run the read-only November preview against production.
2. Record one activation timestamp and enable the new strike writer. Run the seed using verified November entries and the same per-member locks as dispatch. Verify the result against the preview and account for writes after the preview. Open the member and moderator screens once the seed and count checks pass.
3. Check several consecutive authenticated dispatch responses, compare strike and punishment counts with the ledger, and verify the member and moderator screens on a controlled account. Monitor dispatch failures, duplicate attempts, and assignments during the first live cycles. Record the release commit, migration, activation time, seed summary, and verification in `HANDOFF.md`.

**Exit check.** Production seed and live threshold counts agree with the ledger. Discord login, member and moderator screens, and several consecutive dispatch runs pass.

**Recovery before activation.** Keep punishment generation inactive. Revert or correct the app change as needed and retain the additive migration for the next attempt.

**Recovery after activation.** Hide the affected screens or pause new punishment generation and seeding if results diverge. Keep collecting valid strikes, keep existing task and strike records, and use the compatible writer. Avoid reverting to a version that caps strikes at three. Repair and reconcile the affected months from the dated ledger, verify the counts, and resume. Keep destructive removal of obsolete schema fields out of the release.
