# November punishments cutover checklist

Use the [dispatcher smoke test](scripts/test-dispatcher-ci.mjs) to rehearse recovery on disposable Supabase. The role-only application shipped in [PR #110](https://github.com/KrishJdev/Z-Catchers/pull/110). Verify the production deployment against the [moderation rollout](MODERATION_ROLLOUT_CHECKLIST.md) before continuing the existing November cutover. Any application fix ships through a separate `dev` → `main` release PR after validation. Keep member-level evidence and backup metadata in a restricted operator record. Record the release commit, verification links, UTC activation time, and aggregate results in [HANDOFF.md](HANDOFF.md).

## Apply and preview

1. Match the Vercel production deployment and its Supabase project ref to the project open in Supabase. Record the deployment URL, project ref, migration status, and an available restore point for that project. Pause live changes if no restorable backup is available. When migration history is empty, verify the installed schema and routines against the release before deciding which migrations are pending. Apply only pending migrations through the project's Supabase migration process.

   | Order | Migration |
   | --- | --- |
   | Prerequisites | `20261113_add_weekly_schedule.sql`, `20261118_sleep_logs_member_uuid.sql`, `20261119_dispatch_accountability.sql`, `20261120_cron_stage_completion.sql`, `20261121_push_subscription_rotation.sql` |
   | 1 | `20261122_punishment_strike_ledger.sql` |
   | 2 | `20261123_punishment_task_apis.sql` |
   | 3 | `20261124_guard_active_wake.sql` |
   | 4 | `20261125_verify_punishment_cutover.sql` |
   | 5 | `20261126_moderation_owner_and_roles.sql` |
   | 6 | `20261127_moderation_live_roles.sql` |

2. On the first cutover, expect `activated_at = NULL`, `screens_visible = false`, and zero task and action rows. Confirm Vercel is serving a role-only release and verify the active, Discord-linked Owner and intended Moderators. With the flags still in place, verify a returning Discord sign-in and confirm HTTP 503 for the member's punishment list and both staff roles' queue requests. Check that `zcatchers-dispatch` is active and targeting this deployment. To install the job for a disposable target, use [schedule_dispatch.sql](supabase/schedule_dispatch.sql) with the matching Vault values.

   ```sql
   SELECT activated_at, screens_visible FROM public.punishment_rollout WHERE singleton;
   SELECT (SELECT count(*) FROM public.punishments) AS tasks,
          (SELECT count(*) FROM public.punishment_actions) AS actions;
   SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'zcatchers-dispatch';
   ```

3. Time the read-only preview and audit as a database operator and save the results in the restricted release notes. Before activation, expect the audit to report any eligible tasks that still need seeding. Check the dated evidence behind each discrepancy. A legacy counter alone provides no basis for a correction.

   ```sql
   SELECT * FROM public.november_punishment_preview() ORDER BY member_id;
   SELECT issue, count(*) FROM public.punishment_ledger_issues() GROUP BY issue ORDER BY issue;
   ```

   - To add a missing strike backed by dated evidence, call `public.record_verified_november_correction(member_id, cycle_date, evidence_key, actor, reason)` once per verified reference.
   - For a documented removal, match the member, cycle date, and source ID in the preview. Call the same function with that ID as the named sixth argument, `p_void_source => source_id`. It deletes a matching nightly strike and saves a copy in the correction audit, or records a `void_adjustment` for a moderator-added strike.

   Refresh the preview after recording any corrections. Capture each member's verified source IDs, expected thresholds, and November pass balance before activation. Record the aggregate number of verified strikes, discrepancies, expected tasks, and used passes.

   | Rehearsal fixture | Verified November strikes | Legacy counter | Expected task records |
   | --- | ---: | ---: | --- |
   | Counter only | 0 | 3 | 0. There is no dated evidence. |
   | Nightly record and documented correction | 2 | 2 | 0, with two strikes toward the next task. |
   | Los Angeles | 3 | 2 | 1 awaiting assignment based on the three dated strikes. |
   | Tokyo | 6 | 3 | 2, one awaiting assignment and one pending behind a replacement window. Preserve both used Metastrikes. |

4. Send `GET /api/cron/dispatch-notifications?dry_run=true` on the target deployment with `Authorization: Bearer <CRON_SECRET>`. Expect HTTP 200, `success: true`, and no database changes or notifications. The dry run lists candidates before the writer's activation check. In the rehearsal it reports two candidates. After activation only the candidate with a normal strike cutoff at or after activation is charged.

## Activate, seed, and verify

1. Set the timestamp once in the database. Expect one returned row. Save the returned timestamp and keep screens hidden. For a resumed rollout, read back the existing timestamp and continue from the last verified step.

   ```sql
   UPDATE public.punishment_rollout
   SET activated_at = clock_timestamp()
   WHERE singleton AND activated_at IS NULL AND NOT screens_visible
   RETURNING activated_at, screens_visible;
   ```

2. With the scheduler active, run one transaction per member ID returned by the preview. In the SQL Editor, generate the statements below and run them individually. With `psql`, use `\gexec` in place of the final semicolon to execute each statement with autocommit and `ON_ERROR_STOP` enabled. The seed holds the same per-member lock as live dispatch, archives the November pass balance, and projects the member's current local month. Retry a failed or interrupted pass with the same member IDs.

   ```sql
   SELECT format('SELECT public.seed_november_punishments(%L::uuid);', member_id)
   FROM public.november_punishment_preview()
   ORDER BY member_id;
   ```

3. Recheck the member list and rerun the preview. Compare source IDs and cycle dates with the saved snapshot. Explain changes using live ledger writes or documented corrections. Compare the saved pass balances with `strike_pass_months` for November and account for any genuine pass writes. Run the read-only ledger check from the Supabase SQL Editor as a database operator. It reports missing or incorrect tasks, mismatched dates on unassigned tasks, invalid earned-action counts, and missing archived November pass balances for members present at activation. Expect zero rows.

   ```sql
   SELECT * FROM public.punishment_ledger_issues()
   ORDER BY member_id, threshold_number, issue;

   SELECT p.member_id, p.id, p.threshold_number, p.earned_cycle_date, p.assignable_at,
          p.effective_status, count(a.id) FILTER (WHERE a.action = 'earned') AS earned_actions
   FROM public.punishment_task_status p
   LEFT JOIN public.punishment_actions a ON a.punishment_id = p.id
   WHERE p.earned_month = date '2026-11-01'
   GROUP BY p.member_id, p.id, p.threshold_number, p.earned_cycle_date, p.assignable_at, p.effective_status
   ORDER BY p.member_id, p.threshold_number;

   SELECT member_id, used FROM public.strike_pass_months WHERE month_start = date '2026-11-01'
   ORDER BY member_id;
   ```

   Run a second seed pass and check that identical ledger inputs preserve task IDs, pass balances, and earned-action counts. The four rehearsal fixtures yield three tasks and three `earned` actions. The scheduler records the separately verified eligible live strike and skips the pre-launch miss.

4. Check scheduled requests as described below. When a genuine eligible strike occurs, verify its persisted `replacement_until`, its cycle date, and the absence of duplicate strikes or backfilled pre-activation misses. Once the preview and live checks agree, run the visibility function from the Supabase SQL Editor as a database operator. It waits for any in-flight strike or seed transaction, checks the latest ledger and tasks, and returns the existing activation timestamp on success. HTTP 503 continues for the screens if the initial visibility check fails. Investigate reported issues, then retry.

   ```sql
   SELECT public.show_verified_november_punishments();
   ```

## Verify the live release

1. For the minute job, check at least three consecutive scheduled calls. Compare the Cron job history with Vercel requests for `/api/cron/dispatch-notifications` and inspect the corresponding HTTP responses in `net._http_response`. A successful Cron job means it queued the request. The endpoint response must be HTTP 200 with `success: true` and an empty `details.errors` array. Verify an eligible writer result on a live cycle and review logs for failed writes or duplicate attempts.

   ```sql
   SELECT run.start_time, run.end_time, run.status, run.return_message
   FROM cron.job_run_details AS run JOIN cron.job AS job USING (jobid)
   WHERE job.jobname = 'zcatchers-dispatch'
   ORDER BY run.start_time DESC LIMIT 10;

   SELECT id, status_code, timed_out, error_msg, created
   FROM net._http_response ORDER BY id DESC LIMIT 20;
   ```

2. Use a controlled account to confirm Discord sign-in, My Sleep, task history, and the private roster badge. Compare the member's open count with pending, awaiting-assignment, and assigned records across all months. Verify all three Punishments queue sections with the database Owner and a database Moderator. The Owner can manage eligible Moderator and Member tasks, and Moderators can manage eligible Member tasks. Verify that staff cannot act on themselves or the Owner and that a Member cannot open the queue or another member's tasks. Use an approved qualifying task for any live assignment or completion test. Record its audit action and updated count.
3. Recheck the ledger during the first live cycles and after the first assignments. At rollover, verify that the new month starts at zero where there are no new strikes and that open November tasks carry over. Confirm the +10-minute cutoff, open check-in protection, eight-hour Sleep Shield, and 15-minute pre-bedtime quiet period. Record which checks used controlled live accounts, a subscribed physical device, or disposable fixtures and an encrypted push relay. Track any deferred checks separately.
4. In the handoff, record the release commit, migration status, backup reference, activation timestamp, seed and audit totals, verification links, and unresolved checks.

## Recovery

- Before activation, leave the writer inactive and screens hidden. Correct or revert the compatible app if necessary and retain the additive migrations.
- After activation, hide the screens and pause manual seeding while investigating. Keep the active writer, strike capture, and task history. The timestamp is immutable. Deploy only builds that support the active ledger and uncapped strikes.

   ```sql
   UPDATE public.punishment_rollout SET screens_visible = false WHERE singleton;
   ```

- Run `punishment_ledger_issues()` for November and pass the first day of any other affected month, such as `punishment_ledger_issues(date '2026-12-01')`. Review the affected member's dated ledger and task actions. Record evidence-backed corrections using the dated correction workflow. For November, rerun the idempotent seed for each affected member after the cause is fixed. For another affected month, the dated-correction function reconciles the month in the correction transaction. If the ledger is already correct and only derived task records need repair, use the reconciler for the affected member and month in a single transaction.

   ```sql
   DO $$
   DECLARE
     affected_member public.members%ROWTYPE;
     repair_month date := date '2026-12-01';
   BEGIN
     PERFORM FROM public.punishment_rollout WHERE singleton AND activated_at IS NOT NULL FOR SHARE;
     IF NOT FOUND THEN RAISE EXCEPTION 'The strike ledger must be active'; END IF;
     SELECT * INTO STRICT affected_member FROM public.members
     WHERE id = '<affected member UUID>'::uuid FOR NO KEY UPDATE;
     PERFORM public.reconcile_punishments(affected_member, repair_month, clock_timestamp(), 'release-operator');
   END;
   $$;
   ```

- Recheck every affected month and the scheduled dispatcher. If action history is inconsistent, review the existing audit with the release owner before restoring visibility. Use `show_verified_november_punishments()` to reopen the screens and repeat the member and moderator checks.
