# Punishments, strike history, and Metastrike implementation plan

Restore the existing production punishment ledger first. Then improve diagnosis and staff corrections, add private strike history to My Sleep, and release the moderator-reviewed Metastrike workflow. The [incident findings and product decisions](PUNISHMENTS_FIX_PLAN.md) explain the requirements. The [production checklist](PUNISHMENTS_RELEASE_CHECKLIST.md) provides the recovery queries and rollback procedure.

## Feature branch workflow

1. Start **each numbered phase on its own feature branch** using the branch name below. Fetch `origin` and branch from the latest `origin/dev` after the previous phase PR has merged. An isolated worktree is useful when `krish` has local edits. Use the current `dev` tree for the live Discord-role code and migrations.
2. Open one PR into `dev` per phase. Include its checklist, test evidence, migration order if applicable, and what remains disabled. Bring the planning documents and branch rules into `dev` with Phase 0 if they have not landed yet. Keep the phase PR limited to that phase.
3. Before merging an implementation phase, run `npx tsc --noEmit`, `npm run test:unit`, and `npm run build`. Require the relevant hosted CI, and run the disposable Supabase dispatcher smoke for database, role, or scheduling changes. Check desktop and mobile for UI phases. Record the branch, PR, commit, checks and next phase in `HANDOFF.md`.
4. Release application changes through a separate `dev` → `main` PR. Keep per-phase PRs and production deployment separate. When a phase includes an operator action, use its branch for the rehearsal, runbook and evidence. Perform the separately authorized live steps after the applicable release and migration checks.

For example, start the first phase from a clean checkout in a new worktree.

```powershell
git fetch origin
git worktree add -b codex/accountability-0-recovery "../Z Catchers - accountability recovery" origin/dev
```

| Phase | Feature branch | Outcome |
| --- | --- | --- |
| [0](#phase-0--recover-production-punishments) | `codex/accountability-0-recovery` | Verified November tasks and a working production queue |
| [1](#phase-1--distinguish-errors-and-audit-the-ledger) | `codex/accountability-1-diagnostics` | Clear unavailable states and ongoing ledger checks |
| [2](#phase-2--add-dated-staff-corrections) | `codex/accountability-2-strike-corrections` | Staff can resolve dated strike discrepancies from the roster |
| [3](#phase-3--add-private-strike-history-to-my-sleep) | `codex/accountability-3-strike-history` | Members can see strike dates, original issuance, and changes |
| [4](#phase-4--implement-reviewed-metastrike-transactions) | `codex/accountability-4-metastrike-backend` | Dated requests, review, quota and punishment changes are atomic |
| [5](#phase-5--build-the-request-and-review-screens) | `codex/accountability-5-metastrike-screens` | Member date picker and staff review queue work in preview |
| [6](#phase-6--release-reviewed-metastrikes) | `codex/accountability-6-metastrike-release` | Production uses the reviewed flow with rollback rehearsed |

## Phase 0 — Recover production punishments

**Start with** `PUNISHMENTS_RELEASE_CHECKLIST.md`, `supabase/migrations/20261122_punishment_strike_ledger.sql` through `20261125_verify_punishment_cutover.sql`, the current role-only migrations, `scripts/test-november-cutover.mjs`, and the hosted dispatcher smoke.

- Recheck the production deployment, Supabase project, migration status, restorable backup, and one-minute dispatch. The investigation found activation `NULL`, screens hidden, zero tasks, and dated evidence for seven expected tasks. Use those figures as a baseline and take a fresh snapshot before the live cutover.
- Run the canonical preview and ledger audit in the operator SQL path. The Data API preview previously returned SQLSTATE `57014`. If the operator queries also stall, reproduce with production-shaped disposable data, profile the bottleneck, and review any SQL fix on this branch before applying it in production. Rehearse the current Owner and Moderator role checks and update the release checklist for the role-only deployment.
- Review the dated sources privately. Six members showing three strikes and one showing two originally had three dated strikes each. Another member showed two strikes with one source. Check the records and import supported corrections with stable evidence keys. Update the expected task count if the evidence changes. Review potential misses after the legacy cap using dated evidence for each proposed correction.
- After the authorized live release checks, activate the ledger once and seed all previewed profiles while screens stay hidden. Verify archived pass balances, run the seed twice, compare stable task IDs and earned-action counts, and require zero rows from `punishment_ledger_issues()`. Confirm a genuine new strike is written by the active ledger. Open the screens through `show_verified_november_punishments()` and verify the Owner queue, member view, private badge and task history. Preserve the activation time and history if recovery requires hiding the screens again.

**Done when** the live gate is open, every verified November threshold is accounted for, a retry adds no duplicate records, and the handoff records the live checks. If operator access or a restorable backup is unavailable, record the blocker and continue the disposable rehearsal.

## Phase 1 — Distinguish errors and audit the ledger

**Depends on** the recovered ledger. **Start with** `src/lib/punishments.ts`, the member and moderator punishment routes, `src/components/ModeratorPunishmentQueue.tsx`, `src/components/PunishmentList.tsx`, and the existing audit function.

- Return distinct error codes for a closed rollout and a failed dependency. Show a clear closed state, a retryable service error, or an empty queue as appropriate. Keep member and staff reads private with no-store responses. Log sanitized database error codes and route context.
- Extend the read-only ledger check to cover current and previous local-cycle months. Report missing and ineligible tasks, duplicated or missing earned actions, and dispatcher write failures through restricted operational output. Verify runtime on production-shaped data before scheduling. Route repairs through the locked reconciler for the affected member and month after evidence review.

**Done when** tests distinguish the three UI states and a seeded audit discrepancy is detected without changing the ledger or leaking details.

## Phase 2 — Add dated staff corrections

**Depends on** Phase 1. **Start with** `src/components/ModDrawer.tsx`, `src/app/api/mod/route.ts`, and `record_dated_strike_correction()`.

- Add a member-and-month review in the staff roster, including profiles with zero tasks. Show dated sources. Require the date, reason, and a stable request ID. A removal also requires the precise source ID. Reuse the existing transactional reconciler and live target-role checks.
- Route ordinary strike adjustments through the dated workflow. Audit corrections, return revised counts, and refresh the staff queue and member view. The Owner can correct every profile and Moderators can correct other profiles. Keep the Owner task exception for assignment, editing and completion.

**Done when** a permitted staff member can add or remove a dated strike for a member with zero punishments, a retry is safe, and the resulting threshold is created, canceled or reopened correctly. Completed history survives corrections.

## Phase 3 — Add private strike history to My Sleep

**Depends on** Phase 2. **Start with** `src/components/SleepCalendarModal.tsx`, the calendar sleep-history API, the nightly strike writer and correction records.

- Store reliable issuance and change events using the existing write transaction and source IDs. Preserve the original strike on replacement or removal. Backfill available dated evidence and mark unknown legacy issuance times explicitly. Use the same verified sources as the punishment ledger.
- Add a monthly read under `/api/members/strikes` scoped to the active linked profile. Show a separate strike marker on the sleep-cycle date, a browsable monthly list and day details with issuance date, local time, source and counting status. Keep replacement or removal visible in history. Keep detailed data out of shared profile calendars and do not treat every late or missed check-in as a strike.

**Done when** a member can find a strike in a prior month, a November 30 cycle issued December 1 stays on November 30, and tests cover legacy data, retries, replacement, removal, month rollover, timezone changes and cross-profile privacy.

## Phase 4 — Implement reviewed Metastrike transactions

**Depends on** Phase 3 and a verified active ledger. **Start with** the current Metastrike route, `src/lib/strikes.ts`, the strike ledger, and live-role moderation RPCs.

- Add durable request and decision records. Use the current sleep cycle plus the previous three and next three cycle dates. Require a dated nightly strike for a past selection, an explicit cycle date, and a trimmed reason of 1–500 characters. Use the effective timezone and existing Luxon sleep-cycle anchor. Keep accepted requests reviewable after the submission window closes.
- Enforce three passes per selected cycle's local month. Pending requests reserve one slot and neither suppress dispatch nor change strike counts. Approval consumes the slot once, and decline, withdrawal or closure without use frees it. Preserve historical charges. Persist the charged month for new passes so reversals credit the correct balance.
- Implement linked-member submit, list and withdraw operations and a role-authorized decision under `/api/mod/metastrikes`. Use the rollout/member locks and recheck the pending state, target role, quota and strike source in the same transaction. Keep accepted decisions and member-facing decline explanations in the audit. Define an authorized operator review procedure before accepting Owner requests, since staff cannot review their own.
- Before cutoff, approval protects the selected night. After a regular strike exists, approval replaces it and recalculates that sleep-cycle month, including across rollover. Wait for the dispatcher outcome if a past cycle is still settling. Close a confirmed no-strike cycle without charging a pass. Preserve the original strike event and cancel open tasks that lose eligibility. Refresh the current projection and retain completed task history.
- Hold assignment while an eligible replacement could invalidate the task. An accepted request extends the hold until resolved. For existing affected assignments, pause completion during review and preserve the saved work if the task remains eligible. Enforce these checks in the write transaction. Use a release switch that defaults to the existing behavior until the new app is ready, then enforce the reviewed write path in the database so older clients cannot bypass review.

**Done when** disposable integration tests cover the date boundaries, whitespace-only reasons, quota and authorization, approval before and after dispatch, changed sources, duplicate review, month rollover, and concurrent dispatch or correction. One approved replacement produces one charge, one decision and the correct task state.

## Phase 5 — Build the request and review screens

**Depends on** Phase 4. **Start with** `MetastrikeModal.tsx`, `ModDrawer.tsx`, `SleepCalendarModal.tsx`, and existing member-card and My Sleep entry points.

- Replace instant actions with **Request Metastrike** and a compact dated picker. Label unavailable nights and show the selected month's used, reserved and remaining slots. Require the reason with inline feedback. Show pending, approved, declined, withdrawn and closed outcomes in member history.
- Add a **Metastrikes** section to the Mod Drawer with a pending count, oldest-first queue, recent decisions, and Approve and Decline actions. Show the date, reason, submission time, applicable strike and quota. Refresh the task queue, strike counts and calendar after a decision, and display the review hold where it affects assignment or completion.
- Keep member reasons on authorized member and staff reads. Audit the existing roster fields `metastrike_reason` and `tonight_strike_log.reason` and shared `MemberCard` badges, which can display reasons. Use a generic protected label on shared views and verify the private reason never reaches the shared responses. Update `PROJECT_SPEC.md`, `BACKEND_TZ_PWA_SPEC.md` and `DESIGN_SYSTEM.md` for the new workflow.

**Done when** member submission and staff review work end to end on desktop and an installed phone PWA in preview. Verify a successful past-date approval in the member calendar and punishment queue, and test an expired session, conflicting review, lack of quota, and shared-view privacy.

## Phase 6 — Release reviewed Metastrikes

**Depends on** Phase 5. Use this phase branch for the integrated rehearsal, release checklist and evidence. Promote the verified app through a `dev` → `main` release PR.

- Rehearse the upgrade from current production data shapes on disposable Supabase. Apply the additive migrations before enabling reviewed requests. Check both the old and new code paths during rehearsal, including outstanding assignments, an old client's attempted instant write, existing passes, a cross-month request, retries and rollback.
- For the authorized live cutover, verify the deployed commit and migrations, confirm the dispatcher target and results, enable the review mode once the new app is ready, and verify old clients cannot apply instant passes. Test a controlled proactive request and an approved past strike. Confirm the audit trail, the balance for the selected month, the recalculated punishment and the member's calendar.
- Document recovery that pauses new submissions and hides a faulty UI if needed while preserving submitted requests, reviewed decisions, charges, task history and active strike capture. Keep the review requirement enforced after any requests have been accepted. Reconcile with a compatible build before reopening submission.

**Done when** the authenticated member and staff flows pass on production, dispatch remains healthy, the ledger audit reports zero unresolved issues, and `HANDOFF.md` records the release, migration, checks and live results.
