-- Operator-only checks and visibility gate for the November cutover.
BEGIN;

CREATE OR REPLACE FUNCTION public.punishment_ledger_issues(p_month date DEFAULT date '2026-11-01')
RETURNS TABLE (member_id uuid, threshold_number integer, punishment_id uuid, issue text)
LANGUAGE sql STABLE SET search_path = '' AS $$
  WITH expected AS (
    SELECT m.id AS member_id, t.*
    FROM public.members AS m
    CROSS JOIN LATERAL public.earned_punishment_thresholds(m, p_month) AS t
  ), stored AS (
    SELECT p.* FROM public.punishments AS p WHERE p.earned_month = p_month
  ), compared AS (
    SELECT COALESCE(e.member_id, p.member_id) AS member_id,
      COALESCE(e.threshold_number, p.threshold_number) AS threshold_number, p.id AS punishment_id,
      CASE
        WHEN p.id IS NULL THEN 'missing_task'
        WHEN e.member_id IS NOT NULL AND p.status = 'canceled' THEN 'eligible_task_canceled'
        WHEN e.member_id IS NULL AND p.status NOT IN ('completed', 'canceled') THEN 'ineligible_open_task'
        WHEN p.status IN ('pending', 'awaiting_assignment') AND
          (p.earned_cycle_date, p.qualified_at, p.assignable_at) IS DISTINCT FROM
          (e.earned_cycle_date, e.qualified_at, e.assignable_at) THEN 'unassigned_task_dates_differ'
        WHEN p.status = 'awaiting_assignment' AND p.assignable_at > statement_timestamp()
          THEN 'task_assignable_before_deadline'
      END AS issue
    FROM expected AS e FULL JOIN stored AS p USING (member_id, threshold_number)
  )
  SELECT c.member_id, c.threshold_number, c.punishment_id, c.issue
  FROM compared AS c WHERE c.issue IS NOT NULL
  UNION ALL
  SELECT p.member_id, p.threshold_number, p.id, 'invalid_earned_action_count'
  FROM stored AS p
  WHERE (SELECT count(*) FROM public.punishment_actions AS a
    WHERE a.punishment_id = p.id AND a.action = 'earned') <> 1
  UNION ALL
  SELECT m.id, NULL::integer, NULL::uuid, 'missing_november_pass_balance'
  FROM public.members AS m
  CROSS JOIN public.punishment_rollout AS r
  WHERE p_month = date '2026-11-01' AND r.singleton AND m.created_at <= r.activated_at
    AND NOT EXISTS (SELECT FROM public.strike_pass_months AS b
      WHERE b.member_id = m.id AND b.month_start = p_month);
$$;

CREATE OR REPLACE FUNCTION public.show_verified_november_punishments()
RETURNS timestamptz LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  activation timestamptz;
BEGIN
  -- Wait for any strike or seed transaction and fence new writes until the check commits.
  SELECT activated_at INTO STRICT activation
  FROM public.punishment_rollout WHERE singleton FOR NO KEY UPDATE;
  IF activation IS NULL THEN
    RAISE SQLSTATE 'PT409' USING MESSAGE = 'Activate and seed the punishment ledger before opening screens.';
  END IF;
  IF EXISTS (SELECT FROM public.punishment_ledger_issues()) THEN
    RAISE SQLSTATE 'PT409' USING
      MESSAGE = 'November punishment verification failed.',
      HINT = 'Run public.punishment_ledger_issues() for the member and threshold discrepancies.';
  END IF;
  UPDATE public.punishment_rollout SET screens_visible = true WHERE singleton AND NOT screens_visible;
  RETURN activation;
END;
$$;

REVOKE ALL ON FUNCTION public.punishment_ledger_issues(date), public.show_verified_november_punishments()
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
