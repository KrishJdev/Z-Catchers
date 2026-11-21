# November punishments cutover checklist

Use the [Phase 5 dispatcher smoke test](scripts/test-dispatcher-ci.mjs) for the disposable rehearsal. Run the production sequence only in [Phase 6](PUNISHMENTS_PLAN.md#phase-6--release-verify-and-recover). Record the target, release commit, backup reference, activation timestamp, preview, seed results, and verification in the handoff.

## Apply and preview

1. Confirm the deployment and database are paired and that the database has a restorable backup. Apply only pending migrations in chronological order through the project's Supabase migration process. For an existing database, check these prerequisites and apply any that are missing before the punishment migrations.

   | Order | Migration |
   | --- | --- |
   | Prerequisites | `20261113_add_weekly_schedule.sql`, `20261118_sleep_logs_member_uuid.sql`, `20261119_dispatch_accountability.sql`, `20261120_cron_stage_completion.sql`, `20261121_push_subscription_rotation.sql` |
   | 1 | `20261122_punishment_strike_ledger.sql` |
   | 2 | `20261123_punishment_task_apis.sql` |
   | 3 | `20261124_guard_active_wake.sql` |

2. On the first cutover, expect `activated_at = NULL`, `screens_visible = false`, and zero task and action rows. Deploy the compatible build with those flags in place. Verify member sign-in and the existing `zcatchers-dispatch` scheduler. To install the job for a disposable target, configure the deployment origin and cron secret in Vault and apply [schedule_dispatch.sql](supabase/schedule_dispatch.sql). Include the Vault automation bypass secret if the preview requires it.

   ```sql
   SELECT activated_at, screens_visible FROM public.punishment_rollout WHERE singleton;
   SELECT (SELECT count(*) FROM public.punishments) AS tasks,
          (SELECT count(*) FROM public.punishment_actions) AS actions;
   ```

3. Save the read-only preview in the operator's restricted release notes. Check the dated evidence behind each discrepancy. If a documented correction is missing, use `public.record_verified_november_correction(member_id, cycle_date, evidence_key, actor, reason[, source_id])` once per verified reference, then refresh the preview. A legacy counter alone provides no basis for a correction.

   ```sql
   SELECT * FROM public.november_punishment_preview() ORDER BY member_id;
   ```

   | Rehearsal fixture | Verified November strikes | Legacy counter | Expected task records |
   | --- | ---: | ---: | --- |
   | Counter only | 0 | 3 | 0. There is no dated evidence. |
   | Nightly record and documented correction | 2 | 2 | 0, with two strikes toward the next task. |
   | Los Angeles | 3 | 3 | 1 awaiting assignment. |
   | Tokyo | 6 | 3 | 2, one awaiting assignment and one pending behind a replacement window. Preserve both used Metastrikes. |

4. Send `GET /api/cron/dispatch-notifications?dry_run=true` on the target deployment with `Authorization: Bearer <CRON_SECRET>`. Expect HTTP 200, `success: true`, and no database changes or notifications. The dry run lists candidates before the writer's activation check. In the rehearsal it reports two candidates. After activation only the candidate with a normal strike cutoff at or after activation is charged.

## Activate, seed, and verify

1. Set the timestamp once in the database. Expect one returned row. Save the returned timestamp and keep screens hidden.

   ```sql
   UPDATE public.punishment_rollout
   SET activated_at = clock_timestamp()
   WHERE singleton AND activated_at IS NULL AND NOT screens_visible
   RETURNING activated_at, screens_visible;
   ```

2. With the scheduler active, run one transaction per member ID returned by the preview. Recheck the member list for newly verified November rows. The seed uses the same per-member lock as live dispatch and projects the counters for the member's current local month.

   ```sql
   SELECT public.seed_november_punishments('<member UUID>'::uuid);
   ```

3. Run the preview again and compare verified source IDs, dates, task thresholds, replacement deadlines, and pass balances. Account for documented corrections or live ledger entries that appeared after the prior preview. Inspect the stored tasks and audit rows. In the untouched rehearsal fixtures, expect three task rows, three `earned` actions, and unchanged task IDs and actions after a second seed pass. The scheduler adds one separately verified live strike and leaves the pre-launch miss unrecorded.

   ```sql
   SELECT p.member_id, p.id, p.threshold_number, p.earned_cycle_date, p.assignable_at,
          p.effective_status, count(a.id) FILTER (WHERE a.action = 'earned') AS earned_actions
   FROM public.punishment_task_status p
   LEFT JOIN public.punishment_actions a ON a.punishment_id = p.id
   WHERE p.earned_month = date '2026-11-01'
   GROUP BY p.member_id, p.id, p.threshold_number, p.earned_cycle_date, p.assignable_at, p.effective_status
   ORDER BY p.member_id, p.threshold_number;
   ```

4. Check that the scheduled endpoint returns consecutive HTTP 200 responses with no dispatcher errors. Confirm the new writer has persisted `replacement_until` on an eligible live strike and that the pre-launch cutoff was respected. Once the counts agree, turn on visibility.

   ```sql
   UPDATE public.punishment_rollout
   SET screens_visible = true
   WHERE singleton AND activated_at IS NOT NULL
   RETURNING activated_at, screens_visible;
   ```

5. Verify a regular member's My Sleep and roster badge, a database-role moderator, and a configured Discord-ID moderator. At month change, verify zero new-month progress and completion of an unfinished November task. Verify the +10-minute cutoff, an open check-in, a completed sleep cycle within eight hours of bedtime, and the 15-minute pre-bedtime community quiet period. Confirm notification receipt on a subscribed device if running the live-device check. Record which checks used Discord fixtures and the encrypted push relay and which used live accounts or a device.

## Recovery

- Before activation, leave the writer inactive and screens hidden. Correct or revert the compatible app if necessary and retain the additive migrations.
- After activation, hide the screens and pause manual seeding while investigating. Keep the active writer, strike capture, and task history. The timestamp is immutable. Deploy only builds that support the active ledger and uncapped strikes. Reconcile November from verified dated rows and corrections with the idempotent seed. Inspect other affected months using the dated ledger and task audit before restoring visibility.

   ```sql
   UPDATE public.punishment_rollout SET screens_visible = false WHERE singleton;
   ```
