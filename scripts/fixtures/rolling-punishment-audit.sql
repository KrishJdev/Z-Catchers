-- Run only in a disposable database with an activated punishment ledger.
BEGIN;

INSERT INTO public.members(discord_username, journal_url, bedtime_local, wake_time_local, timezone)
SELECT 'Rolling audit ' || to_char(i, 'FM00'), 'https://discord.com/channels/123/456', '23:45', '07:00',
  (ARRAY['America/Los_Angeles', 'Asia/Tokyo', 'America/Los_Angeles', 'Asia/Kolkata', 'Europe/London'])[(i - 1) % 5 + 1]
FROM generate_series(1, 15) AS i;

UPDATE public.members SET pending_timezone = 'Asia/Tokyo', pending_effective_at = '2031-01-01 00:00+00'
WHERE discord_username = 'Rolling audit 03';

INSERT INTO public.nightly_strike_logs(target_member_id, sleep_cycle_date, record_type, updated_at, replacement_until)
SELECT m.id, to_char(month.start_on + day.i, 'YYYY-MM-DD'), 'strike',
  (month.start_on + day.i + time '23:55') AT TIME ZONE public.strike_member_zone(m.timezone),
  CASE WHEN day.i % 2 = 0 THEN public.legacy_strike_deadline(m, month.start_on + day.i) END
FROM public.members AS m
CROSS JOIN (VALUES (date '2030-11-01'), (date '2030-12-01'), (date '2031-01-01')) AS month(start_on)
CROSS JOIN generate_series(1, 10) AS day(i)
WHERE m.discord_username LIKE 'Rolling audit %';

WITH seeded AS (
  INSERT INTO public.punishments(member_id, earned_month, threshold_number, earned_cycle_date, qualified_at, assignable_at, status)
  SELECT m.id, month.start_on, threshold.threshold_number, threshold.earned_cycle_date,
    threshold.qualified_at, threshold.assignable_at,
    CASE WHEN threshold.assignable_at > statement_timestamp() THEN 'pending' ELSE 'awaiting_assignment' END
  FROM public.members AS m
  CROSS JOIN (VALUES (date '2030-11-01'), (date '2030-12-01'), (date '2031-01-01')) AS month(start_on)
  CROSS JOIN LATERAL public.earned_punishment_thresholds(m, month.start_on) AS threshold
  WHERE m.discord_username LIKE 'Rolling audit %'
  RETURNING id, qualified_at
)
INSERT INTO public.punishment_actions(punishment_id, action, occurred_at)
SELECT id, 'earned', qualified_at FROM seeded;

DELETE FROM public.punishments AS p USING public.members AS m
WHERE p.member_id = m.id AND p.threshold_number = 1 AND
  (m.discord_username, p.earned_month) IN (
    ('Rolling audit 02', date '2031-01-01'),
    ('Rolling audit 01', date '2031-01-01'), -- LA is still in December.
    ('Rolling audit 02', date '2030-11-01')  -- Tokyo has already moved into January.
  );

DELETE FROM public.punishment_actions AS a USING public.punishments AS p, public.members AS m
WHERE a.punishment_id = p.id AND p.member_id = m.id AND m.discord_username = 'Rolling audit 03'
  AND p.earned_month = date '2030-12-01' AND p.threshold_number = 1 AND a.action = 'earned';

INSERT INTO public.punishment_actions(punishment_id, action, occurred_at)
SELECT p.id, 'earned', p.qualified_at FROM public.punishments AS p JOIN public.members AS m ON m.id = p.member_id
WHERE m.discord_username = 'Rolling audit 03' AND p.earned_month = date '2031-01-01' AND p.threshold_number = 1;

WITH extra AS (
  INSERT INTO public.punishments(member_id, earned_month, threshold_number, earned_cycle_date, qualified_at, assignable_at, status)
  SELECT p.member_id, p.earned_month, 4, p.earned_cycle_date, p.qualified_at, p.assignable_at, 'pending'
  FROM public.punishments AS p JOIN public.members AS m ON m.id = p.member_id
  WHERE m.discord_username = 'Rolling audit 01' AND p.earned_month = date '2030-12-01' AND p.threshold_number = 3
  RETURNING id, qualified_at
)
INSERT INTO public.punishment_actions(punishment_id, action, occurred_at)
SELECT id, 'earned', qualified_at FROM extra;

CREATE TEMP TABLE rolling_audit_timing (elapsed interval);
CREATE TEMP VIEW rolling_audit_snapshot AS
SELECT jsonb_build_array(
  (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.punishments AS p),
  (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.punishment_actions AS a),
  (SELECT jsonb_agg(to_jsonb(n) ORDER BY id) FROM public.nightly_strike_logs AS n),
  (SELECT jsonb_agg(to_jsonb(r)) FROM public.punishment_rollout AS r)
) AS ledger;

DO $$
DECLARE
  before_audit jsonb := (SELECT ledger FROM rolling_audit_snapshot);
  started timestamptz := clock_timestamp();
  actual text[];
  expected text[] := ARRAY[
    'Rolling audit 01|2030-12-01|ineligible_open_task',
    'Rolling audit 02|2031-01-01|missing_task',
    'Rolling audit 03|2030-12-01|missing_earned_action',
    'Rolling audit 03|2031-01-01|duplicate_earned_actions'
  ];
BEGIN
  SELECT array_agg(concat_ws('|', m.discord_username, d.earned_month, d.issue)
    ORDER BY m.discord_username, d.earned_month, d.issue)
  INTO actual
  FROM public.recent_punishment_ledger_issues('2031-01-01 00:30+00') AS d
  JOIN public.members AS m ON m.id = d.member_id;
  INSERT INTO rolling_audit_timing VALUES (clock_timestamp() - started);
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'Unexpected rolling audit findings: %', actual;
  END IF;
  IF before_audit IS DISTINCT FROM (SELECT ledger FROM rolling_audit_snapshot) THEN
    RAISE EXCEPTION 'The rolling audit mutated the ledger.';
  END IF;
END;
$$;

SELECT 'Rolling punishment audit (15 profiles, 450 nightly rows, local month boundary) elapsed: ' || elapsed
  FROM rolling_audit_timing;

ROLLBACK;
