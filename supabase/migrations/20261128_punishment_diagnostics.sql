-- Distinguish the closed screen gate and add an operator-only rolling ledger check.
BEGIN;

CREATE OR REPLACE FUNCTION public.require_punishment_visibility()
RETURNS void LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  visible boolean;
BEGIN
  SELECT screens_visible INTO STRICT visible FROM public.punishment_rollout WHERE singleton;
  IF NOT visible THEN
    RAISE SQLSTATE 'PT503' USING MESSAGE = 'Punishments are closed for now.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.recent_punishment_ledger_issues(p_as_of timestamptz DEFAULT statement_timestamp())
RETURNS TABLE (member_id uuid, earned_month date, threshold_number integer, punishment_id uuid, issue text)
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT FROM public.punishment_rollout WHERE singleton AND activated_at <= p_as_of) THEN
    RAISE SQLSTATE 'PT409' USING MESSAGE = 'The punishment ledger is inactive at the audit time.';
  END IF;

  -- p_as_of selects local months from the current snapshot. The fixed-month audit checks live deadlines.
  RETURN QUERY
  WITH member_months AS MATERIALIZED (
    SELECT m.id, month.start_on
    FROM public.members AS m
    CROSS JOIN LATERAL (SELECT public.punishment_progress_month(m, p_as_of) AS local_month) AS progress
    CROSS JOIN LATERAL (VALUES (progress.local_month), ((progress.local_month - interval '1 month')::date)) AS month(start_on)
    WHERE month.start_on >= date '2026-11-01'
  ), months AS (
    SELECT DISTINCT scope.start_on FROM member_months AS scope
  ), findings AS MATERIALIZED (
    SELECT month.start_on, finding.*
    FROM months AS month
    CROSS JOIN LATERAL public.punishment_ledger_issues(month.start_on) AS finding
  )
  SELECT finding.member_id, finding.start_on, finding.threshold_number, finding.punishment_id,
    CASE WHEN finding.issue = 'invalid_earned_action_count' THEN
      CASE WHEN EXISTS (SELECT FROM public.punishment_actions AS a
                         WHERE a.punishment_id = finding.punishment_id AND a.action = 'earned')
        THEN 'duplicate_earned_actions' ELSE 'missing_earned_action' END
      ELSE finding.issue END
  FROM findings AS finding
  JOIN member_months AS scope ON scope.id = finding.member_id AND scope.start_on = finding.start_on;
END;
$$;

REVOKE ALL ON FUNCTION public.recent_punishment_ledger_issues(timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
