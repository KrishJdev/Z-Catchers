-- Install the ledger without activating the writer or seeding any punishments.
BEGIN;

ALTER TABLE public.members
  DROP CONSTRAINT IF EXISTS members_strikes_used_check,
  DROP CONSTRAINT IF EXISTS members_strikes_count_check,
  DROP CONSTRAINT IF EXISTS check_strikes_used_range,
  DROP CONSTRAINT IF EXISTS check_strikes_count_range;
ALTER TABLE public.members
  ADD CONSTRAINT check_strikes_used_range CHECK (strikes_used >= 0),
  ADD CONSTRAINT check_strikes_count_range CHECK (strikes_count >= 0);

ALTER TABLE public.members ADD COLUMN IF NOT EXISTS strike_schedule_revision integer NOT NULL DEFAULT 0;

-- Fence cron's Luxon schedule calculation against a concurrent schedule edit.
CREATE OR REPLACE FUNCTION public.bump_strike_schedule_revision()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.strike_schedule_revision := OLD.strike_schedule_revision + 1;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS bump_strike_schedule_revision ON public.members;
CREATE TRIGGER bump_strike_schedule_revision BEFORE UPDATE ON public.members FOR EACH ROW
  WHEN ((NEW.timezone, NEW.bedtime_local, NEW.wake_time_local, NEW.weekend_bedtime_local,
    NEW.weekend_wake_time_local, NEW.weekly_schedule, NEW.pending_effective_at) IS DISTINCT FROM
    (OLD.timezone, OLD.bedtime_local, OLD.wake_time_local, OLD.weekend_bedtime_local,
    OLD.weekend_wake_time_local, OLD.weekly_schedule, OLD.pending_effective_at))
  EXECUTE FUNCTION public.bump_strike_schedule_revision();

ALTER TABLE public.nightly_strike_logs
  ADD COLUMN IF NOT EXISTS replacement_until timestamptz,
  ADD COLUMN IF NOT EXISTS pass_used_on date;

CREATE TABLE IF NOT EXISTS public.punishment_rollout (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  activated_at timestamptz,
  screens_visible boolean NOT NULL DEFAULT false CHECK (NOT screens_visible OR activated_at IS NOT NULL)
);
INSERT INTO public.punishment_rollout DEFAULT VALUES ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.strike_moderator_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  cycle_date date NOT NULL,
  action text NOT NULL CHECK (action IN ('add_strike', 'void_adjustment', 'clear_nightly',
    'set_passes', 'legacy_set_counts', 'moderator_pass')),
  source_id uuid,
  evidence_key text UNIQUE,
  actor text,
  reason text NOT NULL,
  details jsonb,
  recorded_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_strike_corrections_member_date
  ON public.strike_moderator_corrections(member_id, cycle_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_strike_corrections_void
  ON public.strike_moderator_corrections(source_id) WHERE action = 'void_adjustment';

CREATE TABLE IF NOT EXISTS public.strike_pass_months (
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  month_start date NOT NULL CHECK (extract(day FROM month_start) = 1),
  used integer NOT NULL CHECK (used BETWEEN 0 AND 3),
  PRIMARY KEY (member_id, month_start)
);

CREATE TABLE IF NOT EXISTS public.punishments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  earned_month date NOT NULL CHECK (extract(day FROM earned_month) = 1),
  threshold_number integer NOT NULL CHECK (threshold_number > 0),
  earned_cycle_date date NOT NULL,
  qualified_at timestamptz NOT NULL,
  assignable_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'awaiting_assignment', 'assigned', 'completed', 'canceled')),
  title text,
  instructions text,
  assigned_at timestamptz,
  completed_at timestamptz,
  canceled_at timestamptz,
  UNIQUE (member_id, earned_month, threshold_number)
);
CREATE INDEX IF NOT EXISTS idx_punishments_open ON public.punishments(member_id, earned_cycle_date)
  WHERE status IN ('pending', 'awaiting_assignment', 'assigned');

CREATE TABLE IF NOT EXISTS public.punishment_actions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  punishment_id uuid NOT NULL REFERENCES public.punishments(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('earned', 'reopened', 'canceled', 'assigned', 'edited', 'completed')),
  actor text,
  occurred_at timestamptz NOT NULL,
  details jsonb
);
CREATE INDEX IF NOT EXISTS idx_punishment_actions_item ON public.punishment_actions(punishment_id, id);

ALTER TABLE public.punishment_rollout ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.strike_moderator_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.strike_pass_months ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.punishments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.punishment_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.punishment_rollout, public.strike_moderator_corrections, public.strike_pass_months,
  public.punishments, public.punishment_actions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.punishment_rollout, public.strike_moderator_corrections, public.strike_pass_months,
  public.punishments, public.punishment_actions TO service_role;

-- The launch timestamp is set once by the database operator. Visibility can be toggled independently.
CREATE OR REPLACE FUNCTION public.keep_strike_activation()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'The rollout row cannot be deleted.'; END IF;
  IF OLD.activated_at IS NOT NULL AND NEW.activated_at IS DISTINCT FROM OLD.activated_at THEN
    RAISE EXCEPTION 'The strike ledger activation timestamp cannot be changed.';
  END IF;
  IF NEW.activated_at > clock_timestamp() THEN RAISE EXCEPTION 'Activation cannot be in the future.'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS keep_strike_activation ON public.punishment_rollout;
CREATE TRIGGER keep_strike_activation BEFORE UPDATE OR DELETE ON public.punishment_rollout
  FOR EACH ROW EXECUTE FUNCTION public.keep_strike_activation();

-- Serialize direct check-in/wake evidence writes with the strike transaction.
-- The strike writer reads these rows without locking them, avoiding inverse row lock order.
CREATE OR REPLACE FUNCTION public.lock_member_for_sleep_evidence()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  target uuid;
  stage text;
BEGIN
  IF TG_TABLE_NAME = 'notification_logs' THEN
    stage := CASE WHEN TG_OP = 'DELETE' THEN OLD.notification_type ELSE NEW.notification_type END;
    IF stage NOT IN ('IN_BED_EARLY', 'WOKE_UP') THEN RETURN COALESCE(NEW, OLD); END IF;
  END IF;
  target := CASE WHEN TG_OP = 'DELETE' THEN OLD.member_id ELSE NEW.member_id END;
  PERFORM FROM public.members WHERE id = target FOR NO KEY UPDATE;
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS lock_member_for_sleep_evidence ON public.notification_logs;
CREATE TRIGGER lock_member_for_sleep_evidence BEFORE INSERT OR UPDATE OR DELETE ON public.notification_logs
  FOR EACH ROW EXECUTE FUNCTION public.lock_member_for_sleep_evidence();
DROP TRIGGER IF EXISTS lock_member_for_sleep_evidence ON public.sleep_logs;
CREATE TRIGGER lock_member_for_sleep_evidence BEFORE INSERT OR UPDATE OR DELETE ON public.sleep_logs
  FOR EACH ROW EXECUTE FUNCTION public.lock_member_for_sleep_evidence();

-- Leave malformed prototype dates out of the verified ledger.
CREATE OR REPLACE FUNCTION public.strike_cycle_day(value text)
RETURNS date LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = '' AS $$
BEGIN
  IF value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RETURN NULL; END IF;
  RETURN value::date;
EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.strike_member_zone(value text)
RETURNS text LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT COALESCE((SELECT name FROM pg_timezone_names WHERE name = value), 'UTC');
$$;

-- Legacy rows lack the deadline. Recover it from the member's current weekly schedule.
-- Live strikes persist the deadline supplied by the Luxon sleep engine.
CREATE OR REPLACE FUNCTION public.legacy_strike_deadline(m public.members, cycle date)
RETURNS timestamptz LANGUAGE sql STABLE SET search_path = '' AS $$
  WITH bedtimes AS (
    SELECT days.delta_day, (cycle + days.delta_day + CASE WHEN hours.bedtime < time '12:00' THEN 1 ELSE 0 END
      + hours.bedtime) AT TIME ZONE public.strike_member_zone(m.timezone) AS bedtime
    FROM generate_series(-1, 3) AS days(delta_day)
    CROSS JOIN LATERAL (
      SELECT m.weekly_schedule->(ARRAY['sun','mon','tue','wed','thu','fri','sat'])[extract(dow FROM cycle + days.delta_day)::int + 1] AS custom
    ) AS schedule
    CROSS JOIN LATERAL (
      SELECT COALESCE(
        CASE WHEN btrim(schedule.custom->>'bedtime') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
          AND btrim(schedule.custom->>'wake_time') <> '' THEN btrim(schedule.custom->>'bedtime') END,
        CASE WHEN extract(dow FROM cycle + days.delta_day) IN (5, 6)
          AND btrim(m.weekend_bedtime_local) ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN btrim(m.weekend_bedtime_local) END,
        CASE WHEN btrim(m.bedtime_local) ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN btrim(m.bedtime_local) END,
        '23:00')::time AS bedtime
    ) AS hours
  )
  SELECT min(bedtime) FROM bedtimes WHERE bedtime > (SELECT bedtime FROM bedtimes WHERE delta_day = 0);
$$;

CREATE OR REPLACE FUNCTION public.verified_monthly_strikes(m public.members, month_start date)
RETURNS TABLE (source_id uuid, source_type text, cycle_date date, qualified_at timestamptz, replacement_until timestamptz)
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT n.id, 'nightly'::text, day.cycle_date, n.updated_at,
    COALESCE(n.replacement_until, public.legacy_strike_deadline(m, day.cycle_date))
  FROM public.nightly_strike_logs AS n
  CROSS JOIN LATERAL (SELECT public.strike_cycle_day(n.sleep_cycle_date) AS cycle_date) AS day
  WHERE n.target_member_id = m.id AND n.record_type = 'strike'
    AND n.sleep_cycle_date >= to_char(month_start, 'YYYY-MM-DD')
    AND n.sleep_cycle_date < to_char(month_start + interval '1 month', 'YYYY-MM-DD')
    AND day.cycle_date >= month_start AND day.cycle_date < month_start + interval '1 month'
  UNION ALL
  SELECT c.id, 'moderator', c.cycle_date, c.recorded_at, NULL::timestamptz
  FROM public.strike_moderator_corrections AS c
  WHERE c.member_id = m.id AND c.action = 'add_strike'
    AND c.cycle_date >= month_start AND c.cycle_date < month_start + interval '1 month'
    AND NOT EXISTS (SELECT FROM public.strike_moderator_corrections AS v
      WHERE v.source_id = c.id AND v.action = 'void_adjustment');
$$;

CREATE OR REPLACE FUNCTION public.earned_punishment_thresholds(m public.members, month_start date)
RETURNS TABLE (threshold_number integer, earned_cycle_date date, qualified_at timestamptz, assignable_at timestamptz)
LANGUAGE sql STABLE SET search_path = '' AS $$
  -- Rank dates to show which cycle earned a threshold. Independently rank
  -- deadlines to find when enough strikes can no longer be replaced.
  WITH ranked AS (
    SELECT s.*,
      row_number() OVER (ORDER BY cycle_date, qualified_at, source_id) AS earned_rank,
      row_number() OVER (ORDER BY replacement_until NULLS FIRST, source_id) AS stable_rank,
      max(qualified_at) OVER (ORDER BY cycle_date, qualified_at, source_id ROWS UNBOUNDED PRECEDING) AS qualified
    FROM public.verified_monthly_strikes(m, month_start) AS s
  )
  SELECT (e.earned_rank / 3)::integer, e.cycle_date, e.qualified,
    greatest(e.qualified, d.replacement_until)
  FROM ranked AS e JOIN ranked AS d ON d.stable_rank = e.earned_rank
  WHERE e.earned_rank % 3 = 0;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_punishments(
  m public.members, month_start date, now_at timestamptz, actor text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  threshold record;
  item public.punishments%ROWTYPE;
  next_status text;
BEGIN
  IF month_start < date '2026-11-01' THEN RETURN; END IF;
  -- Snapshot deadlines for verified historical rows on their first reconciliation.
  UPDATE public.nightly_strike_logs AS n SET replacement_until = s.replacement_until
    FROM public.verified_monthly_strikes(m, month_start) AS s
    WHERE s.source_type = 'nightly' AND n.id = s.source_id AND n.replacement_until IS NULL;

  FOR threshold IN SELECT * FROM public.earned_punishment_thresholds(m, month_start) ORDER BY threshold_number
  LOOP
    next_status := CASE WHEN threshold.assignable_at > now_at THEN 'pending' ELSE 'awaiting_assignment' END;
    SELECT * INTO item FROM public.punishments
      WHERE member_id = m.id AND earned_month = month_start AND threshold_number = threshold.threshold_number;
    IF NOT FOUND THEN
      INSERT INTO public.punishments(member_id, earned_month, threshold_number, earned_cycle_date,
        qualified_at, assignable_at, status)
      VALUES (m.id, month_start, threshold.threshold_number, threshold.earned_cycle_date,
        threshold.qualified_at, threshold.assignable_at, next_status)
      RETURNING * INTO item;
      INSERT INTO public.punishment_actions(punishment_id, action, actor, occurred_at)
        VALUES (item.id, 'earned', actor, now_at);
    ELSIF item.status = 'canceled' THEN
      UPDATE public.punishments SET status = next_status, earned_cycle_date = threshold.earned_cycle_date,
        qualified_at = threshold.qualified_at, assignable_at = threshold.assignable_at,
        title = NULL, instructions = NULL, assigned_at = NULL, canceled_at = NULL
        WHERE id = item.id;
      INSERT INTO public.punishment_actions(punishment_id, action, actor, occurred_at)
        VALUES (item.id, 'reopened', actor, now_at);
    ELSIF item.status IN ('pending', 'awaiting_assignment') THEN
      UPDATE public.punishments SET status = next_status, earned_cycle_date = threshold.earned_cycle_date,
        qualified_at = threshold.qualified_at, assignable_at = threshold.assignable_at
        WHERE id = item.id AND (status, earned_cycle_date, qualified_at, assignable_at) IS DISTINCT FROM
          (next_status, threshold.earned_cycle_date, threshold.qualified_at, threshold.assignable_at);
    END IF;
  END LOOP;

  WITH canceled AS (
    UPDATE public.punishments AS p SET status = 'canceled', canceled_at = now_at
    WHERE p.member_id = m.id AND p.earned_month = month_start
      AND p.status IN ('pending', 'awaiting_assignment', 'assigned')
      AND p.threshold_number > (SELECT count(*) / 3 FROM public.verified_monthly_strikes(m, month_start))
    RETURNING p.id
  )
  INSERT INTO public.punishment_actions(punishment_id, action, actor, occurred_at)
    SELECT id, 'canceled', actor, now_at FROM canceled;
END;
$$;

-- Use the same read-only fallback when previewing and initializing the pass balance.
CREATE OR REPLACE FUNCTION public.legacy_strike_passes(m public.members, month_start date)
RETURNS integer LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE WHEN m.strike_cycle_month IS NULL OR m.strike_cycle_month = to_char(month_start, 'YYYY-MM')
    THEN greatest(m.metastrikes_used, m.metastrikes_count)
    ELSE (
      SELECT least(3, count(*))::integer
      FROM public.nightly_strike_logs AS n
      CROSS JOIN LATERAL (SELECT COALESCE(n.pass_used_on,
        (n.updated_at AT TIME ZONE public.strike_member_zone(m.timezone))::date) AS used_on) AS day
      WHERE n.target_member_id = m.id AND n.record_type = 'metastrike'
        AND day.used_on >= month_start AND day.used_on < month_start + interval '1 month'
    ) END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_strike_pass_month(m public.members, month_start date)
RETURNS integer LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  total integer;
BEGIN
  SELECT used INTO total FROM public.strike_pass_months WHERE member_id = m.id AND strike_pass_months.month_start = $2;
  IF FOUND THEN RETURN total; END IF;
  total := public.legacy_strike_passes(m, month_start);
  INSERT INTO public.strike_pass_months VALUES (m.id, month_start, total);
  RETURN total;
END;
$$;

-- Archive the outgoing balance for every writer, including legacy callers and inactive rollover.
CREATE OR REPLACE FUNCTION public.archive_outgoing_strike_passes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  previous_month date := public.strike_cycle_day(OLD.strike_cycle_month || '-01');
BEGIN
  IF previous_month IS NOT NULL THEN
    PERFORM public.ensure_strike_pass_month(OLD, previous_month);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS archive_outgoing_strike_passes ON public.members;
CREATE TRIGGER archive_outgoing_strike_passes BEFORE UPDATE OF strike_cycle_month ON public.members
  FOR EACH ROW WHEN (OLD.strike_cycle_month IS DISTINCT FROM NEW.strike_cycle_month)
  EXECUTE FUNCTION public.archive_outgoing_strike_passes();

CREATE OR REPLACE FUNCTION public.project_member_strikes(m public.members, month_start date)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  total integer;
  passes integer;
  month_label text := to_char(month_start, 'YYYY-MM');
BEGIN
  SELECT count(*) INTO total FROM public.verified_monthly_strikes(m, month_start);
  passes := public.ensure_strike_pass_month(m, month_start);
  UPDATE public.members SET strikes_used = total, strikes_count = total,
    metastrikes_used = passes, metastrikes_count = passes, strike_cycle_month = month_label
    WHERE id = m.id AND (strikes_used, strikes_count, metastrikes_used, metastrikes_count, strike_cycle_month)
      IS DISTINCT FROM (total, total, passes, passes, month_label);
  RETURN jsonb_build_object('strikesUsed', total, 'metastrikesUsed', passes, 'month', month_label,
    'reset', m.strike_cycle_month IS DISTINCT FROM month_label);
END;
$$;

-- Keep the installed legacy function behind both entry points until activation.
DO $$
BEGIN
  IF to_regprocedure('public.apply_legacy_nightly_strike(uuid,text,text,text,text,text,timestamptz,timestamptz)') IS NULL THEN
    ALTER FUNCTION public.apply_nightly_strike(uuid,text,text,text,text,text,timestamptz,timestamptz)
      RENAME TO apply_legacy_nightly_strike;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_nightly_strike(
  p_member_id uuid, p_cycle text, p_month text, p_previous_type text,
  p_type text, p_reason text, p_now timestamptz, p_month_start timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM FROM public.punishment_rollout WHERE singleton FOR SHARE;
  IF (SELECT activated_at FROM public.punishment_rollout WHERE singleton) IS NOT NULL THEN
    RAISE SQLSTATE 'PT409' USING MESSAGE = 'The strike writer has been upgraded. Deploy the compatible app.';
  END IF;
  RETURN public.apply_legacy_nightly_strike(p_member_id, p_cycle, p_month, p_previous_type,
    p_type, p_reason, p_now, p_month_start);
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_nightly_strike(
  p_member_id uuid, p_cycle text, p_month text, p_previous_type text, p_type text,
  p_reason text, p_now timestamptz, p_month_start timestamptz,
  p_strike_cutoff timestamptz, p_replacement_until timestamptz, p_moderator text, p_schedule_revision integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  activation timestamptz;
  m public.members%ROWTYPE;
  nightly public.nightly_strike_logs%ROWTYPE;
  cycle date := public.strike_cycle_day(p_cycle);
  local_day date;
  current_month date;
  cycle_month date;
  pass_month date;
  passes integer;
  projection jsonb;
  now_at timestamptz;
BEGIN
  SELECT activated_at INTO STRICT activation FROM public.punishment_rollout WHERE singleton FOR SHARE;
  IF activation IS NULL THEN
    projection := public.apply_legacy_nightly_strike(p_member_id, p_cycle, p_month, p_previous_type,
      p_type, p_reason, p_now, p_month_start);
    IF p_type = 'metastrike' THEN
      SELECT * INTO STRICT m FROM public.members WHERE id = p_member_id;
      UPDATE public.nightly_strike_logs SET pass_used_on = (p_now AT TIME ZONE public.strike_member_zone(m.timezone))::date
        WHERE target_member_id = p_member_id AND sleep_cycle_date = p_cycle;
    END IF;
    IF (p_type = 'clear' OR (p_type = 'metastrike' AND p_moderator IS NOT NULL)) AND cycle IS NOT NULL THEN
      INSERT INTO public.strike_moderator_corrections(member_id, cycle_date, action, actor, reason, details, recorded_at)
        VALUES (p_member_id, cycle, CASE WHEN p_type = 'clear' THEN 'clear_nightly' ELSE 'moderator_pass' END,
          p_moderator, p_reason, projection->'log', p_now);
    END IF;
    RETURN projection;
  END IF;
  IF cycle IS NULL THEN RAISE SQLSTATE 'PT400' USING MESSAGE = 'Invalid sleep cycle date.'; END IF;
  SELECT * INTO STRICT m FROM public.members WHERE id = p_member_id FOR NO KEY UPDATE;
  now_at := greatest(p_now, clock_timestamp());
  local_day := (now_at AT TIME ZONE public.strike_member_zone(m.timezone))::date;
  current_month := date_trunc('month', local_day::timestamp)::date;
  cycle_month := date_trunc('month', cycle::timestamp)::date;
  SELECT * INTO nightly FROM public.nightly_strike_logs WHERE target_member_id = m.id AND sleep_cycle_date = p_cycle;
  IF p_type = 'strike' AND nightly.record_type IN ('strike', 'metastrike') THEN
    RETURN jsonb_build_object('reason', CASE WHEN nightly.record_type = 'strike' THEN 'already_issued' ELSE 'metastrike_active' END,
      'log', to_jsonb(nightly));
  END IF;
  IF p_type = 'clear' AND nightly.id IS NULL THEN RETURN '{}'::jsonb; END IF;
  IF nightly.record_type IS DISTINCT FROM p_previous_type THEN
    RAISE SQLSTATE 'PT409' USING MESSAGE = 'The nightly record changed. Refresh and retry.';
  END IF;

  IF p_type = 'strike' THEN
    IF m.strike_schedule_revision IS DISTINCT FROM p_schedule_revision OR m.pending_effective_at <= now_at THEN
      RAISE SQLSTATE 'PT409' USING MESSAGE = 'The sleep schedule changed. Re-evaluate the cycle with the current schedule.';
    END IF;
    IF cycle_month < date '2026-11-01' OR p_strike_cutoff < activation THEN
      RETURN jsonb_build_object('reason', 'cycle_before_activation');
    END IF;
    IF p_strike_cutoff IS NULL OR p_strike_cutoff > p_now OR p_replacement_until IS NULL THEN
      RAISE SQLSTATE 'PT400' USING MESSAGE = 'The strike cutoff or replacement deadline is invalid.';
    END IF;
    IF EXISTS (SELECT FROM public.strike_moderator_corrections
      WHERE member_id = m.id AND cycle_date = cycle AND action = 'clear_nightly') THEN
      RETURN jsonb_build_object('reason', 'moderator_cleared');
    END IF;
    IF NOT m.is_active OR (m.last_notified_stage = 'IN_BED_EARLY' AND m.last_notified_cycle_date = p_cycle)
       OR m.last_wake_cycle_date = p_cycle
       OR EXISTS (SELECT FROM public.notification_logs WHERE member_id = m.id
         AND local_date = cycle AND notification_type IN ('IN_BED_EARLY', 'WOKE_UP'))
       OR EXISTS (SELECT FROM public.sleep_logs WHERE member_id = m.id
         AND cycle_date = p_cycle AND (in_bed_at IS NOT NULL OR woke_up_at IS NOT NULL)) THEN
      RETURN jsonb_build_object('reason', 'already_checked_in');
    END IF;
  ELSIF p_type = 'metastrike' THEN
    IF nightly.record_type = 'strike' AND p_moderator IS NULL AND now_at >=
      COALESCE(nightly.replacement_until, public.legacy_strike_deadline(m, cycle)) THEN
      RAISE SQLSTATE 'PT400' USING MESSAGE = 'The window to replace this strike with a Metastrike has expired.';
    END IF;
    IF nightly.record_type = 'metastrike' THEN
      RAISE SQLSTATE 'PT400' USING MESSAGE = 'This cycle already has a pass.';
    END IF;
    passes := public.ensure_strike_pass_month(m, current_month);
    IF passes >= 3 THEN RAISE SQLSTATE 'PT400' USING MESSAGE = 'You have used all 3 Metastrikes for this month.'; END IF;
    UPDATE public.strike_pass_months SET used = passes + 1 WHERE member_id = m.id AND month_start = current_month;
    IF p_moderator IS NOT NULL THEN
      INSERT INTO public.strike_moderator_corrections(member_id, cycle_date, action, actor, reason, details, recorded_at)
        VALUES (m.id, cycle, 'moderator_pass', p_moderator, p_reason, to_jsonb(nightly), now_at);
    END IF;
  ELSIF p_type = 'clear' THEN
    IF nullif(btrim(p_moderator), '') IS NULL THEN
      RAISE SQLSTATE 'PT400' USING MESSAGE = 'Moderator identity is required to clear the nightly record.';
    END IF;
    IF nightly.record_type = 'metastrike' THEN
      pass_month := date_trunc('month', COALESCE(nightly.pass_used_on,
        (nightly.updated_at AT TIME ZONE public.strike_member_zone(m.timezone))::date)::timestamp)::date;
      passes := public.ensure_strike_pass_month(m, pass_month);
      UPDATE public.strike_pass_months SET used = greatest(passes - 1, 0)
        WHERE member_id = m.id AND month_start = pass_month;
    END IF;
    INSERT INTO public.strike_moderator_corrections(member_id, cycle_date, action, source_id, actor, reason, details, recorded_at)
      VALUES (m.id, cycle, 'clear_nightly', nightly.id, p_moderator, p_reason, to_jsonb(nightly), now_at);
  ELSE
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'Invalid nightly record type.';
  END IF;

  IF p_type = 'clear' THEN
    DELETE FROM public.nightly_strike_logs WHERE id = nightly.id;
  ELSE
    INSERT INTO public.nightly_strike_logs(target_member_id, sleep_cycle_date, record_type, reason, created_at, updated_at,
      replacement_until, pass_used_on)
    VALUES (m.id, p_cycle, p_type, p_reason, now_at, now_at,
      CASE WHEN p_type = 'strike' THEN p_replacement_until END,
      CASE WHEN p_type = 'metastrike' THEN local_day END)
    ON CONFLICT (target_member_id, sleep_cycle_date) DO UPDATE SET record_type = excluded.record_type,
      reason = excluded.reason, updated_at = excluded.updated_at, voter_ids = '[]'::jsonb,
      replacement_until = excluded.replacement_until, pass_used_on = excluded.pass_used_on
    RETURNING * INTO nightly;
  END IF;

  PERFORM public.reconcile_punishments(m, cycle_month, now_at, p_moderator);
  projection := public.project_member_strikes(m, current_month);
  RETURN projection || jsonb_build_object('log', CASE WHEN p_type <> 'clear' THEN to_jsonb(nightly) END,
    'cycleStrikesUsed', (SELECT count(*) FROM public.verified_monthly_strikes(m, cycle_month)));
END;
$$;

-- Refresh the compatibility projection only under the same lock as its writers.
CREATE OR REPLACE FUNCTION public.refresh_member_strike_projection(p_member_id uuid, p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  activation timestamptz;
  m public.members%ROWTYPE;
  month_start date;
  month_label text;
BEGIN
  SELECT activated_at INTO STRICT activation FROM public.punishment_rollout WHERE singleton FOR SHARE;
  SELECT * INTO STRICT m FROM public.members WHERE id = p_member_id FOR NO KEY UPDATE;
  month_start := date_trunc('month', greatest(p_now, clock_timestamp()) AT TIME ZONE public.strike_member_zone(m.timezone))::date;
  IF activation IS NOT NULL THEN RETURN public.project_member_strikes(m, month_start); END IF;
  month_label := to_char(month_start, 'YYYY-MM');
  IF m.strike_cycle_month < month_label THEN
    UPDATE public.members SET strikes_used = 0, strikes_count = 0, metastrikes_used = 0, metastrikes_count = 0,
      strike_cycle_month = month_label WHERE id = m.id;
    RETURN jsonb_build_object('strikesUsed', 0, 'metastrikesUsed', 0, 'month', month_label, 'reset', true);
  END IF;
  RETURN jsonb_build_object('strikesUsed', greatest(m.strikes_used, m.strikes_count),
    'metastrikesUsed', greatest(m.metastrikes_used, m.metastrikes_count),
    'month', COALESCE(m.strike_cycle_month, month_label), 'reset', false);
END;
$$;

-- Retain the compatibility entry point for legacy callers. The UTC bulk reset
-- could move a member into the wrong month. Reads and writes now roll forward per member.
CREATE OR REPLACE FUNCTION public.reset_monthly_strikes()
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$ BEGIN RETURN; END; $$;

CREATE OR REPLACE FUNCTION public.adjust_member_strikes(
  p_member_id uuid, p_strikes integer, p_passes integer, p_relative boolean, p_actor text, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  activation timestamptz;
  m public.members%ROWTYPE;
  now_at timestamptz;
  local_day date;
  target_month date;
  month_label text;
  total integer;
  previous_passes integer;
  item record;
BEGIN
  SELECT activated_at INTO STRICT activation FROM public.punishment_rollout WHERE singleton FOR SHARE;
  SELECT * INTO STRICT m FROM public.members WHERE id = p_member_id FOR NO KEY UPDATE;
  now_at := clock_timestamp();
  local_day := (now_at AT TIME ZONE public.strike_member_zone(m.timezone))::date;
  target_month := date_trunc('month', local_day::timestamp)::date;
  month_label := to_char(target_month, 'YYYY-MM');
  IF p_relative IS NULL OR (p_strikes IS NULL AND p_passes IS NULL)
    OR (p_relative AND (abs(p_strikes::bigint) > 1 OR abs(p_passes::bigint) > 1))
    OR (NOT p_relative AND (p_strikes < 0 OR p_passes NOT BETWEEN 0 AND 3))
    OR nullif(btrim(p_actor), '') IS NULL OR nullif(btrim(p_reason), '') IS NULL THEN
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'Invalid strike correction.';
  END IF;

  IF activation IS NULL THEN
    IF m.strike_cycle_month > month_label THEN
      RAISE SQLSTATE 'PT409' USING MESSAGE = 'The strike month advanced. Refresh and retry.';
    END IF;
    total := CASE WHEN m.strike_cycle_month = month_label THEN greatest(m.strikes_used, m.strikes_count) ELSE 0 END;
    previous_passes := CASE WHEN m.strike_cycle_month = month_label
      THEN greatest(m.metastrikes_used, m.metastrikes_count) ELSE 0 END;
    p_strikes := CASE WHEN p_relative THEN greatest(0, total + COALESCE(p_strikes, 0)) ELSE COALESCE(p_strikes, total) END;
    p_passes := CASE WHEN p_relative THEN greatest(0, least(3, previous_passes + COALESCE(p_passes, 0)))
      ELSE COALESCE(p_passes, previous_passes) END;
    IF p_strikes > 3 THEN
      RAISE SQLSTATE 'PT400' USING MESSAGE = 'The strike ledger is inactive. At most three strikes can be recorded.';
    END IF;
    INSERT INTO public.strike_moderator_corrections(member_id, cycle_date, action, actor, reason, details, recorded_at)
      VALUES (m.id, local_day, 'legacy_set_counts', p_actor, p_reason,
        jsonb_build_object('previousMonth', m.strike_cycle_month,
          'previousStrikes', greatest(m.strikes_used, m.strikes_count),
          'previousPasses', greatest(m.metastrikes_used, m.metastrikes_count),
          'strikes', p_strikes, 'passes', p_passes), now_at);
    UPDATE public.members SET strikes_used = p_strikes, strikes_count = p_strikes,
      metastrikes_used = p_passes, metastrikes_count = p_passes,
      strike_cycle_month = month_label, updated_at = now_at WHERE id = m.id;
    RETURN jsonb_build_object('strikesUsed', p_strikes, 'metastrikesUsed', p_passes, 'month', month_label);
  END IF;

  SELECT count(*) INTO total FROM public.verified_monthly_strikes(m, target_month);
  previous_passes := public.ensure_strike_pass_month(m, target_month);
  p_strikes := CASE WHEN p_relative THEN greatest(0, total + COALESCE(p_strikes, 0)) ELSE COALESCE(p_strikes, total) END;
  p_passes := CASE WHEN p_relative THEN greatest(0, least(3, previous_passes + COALESCE(p_passes, 0)))
    ELSE COALESCE(p_passes, previous_passes) END;
  IF p_strikes - total > 31 THEN
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'A single correction can add at most 31 strike records.';
  END IF;
  INSERT INTO public.strike_moderator_corrections(member_id, cycle_date, action, actor, reason, recorded_at)
    SELECT m.id, local_day, 'add_strike', p_actor, p_reason, now_at
    FROM generate_series(1, p_strikes - total);
  FOR item IN
    SELECT * FROM public.verified_monthly_strikes(m, target_month)
    ORDER BY cycle_date DESC, qualified_at DESC, source_id
    LIMIT greatest(0, total - p_strikes)
  LOOP
    IF item.source_type = 'nightly' THEN
      INSERT INTO public.strike_moderator_corrections(member_id, cycle_date, action, source_id, actor, reason, details, recorded_at)
        SELECT m.id, item.cycle_date, 'clear_nightly', n.id, p_actor, p_reason, to_jsonb(n), now_at
        FROM public.nightly_strike_logs AS n WHERE n.id = item.source_id;
      DELETE FROM public.nightly_strike_logs WHERE id = item.source_id;
    ELSE
      INSERT INTO public.strike_moderator_corrections(member_id, cycle_date, action, source_id, actor, reason, recorded_at)
        VALUES (m.id, item.cycle_date, 'void_adjustment', item.source_id, p_actor, p_reason, now_at);
    END IF;
  END LOOP;

  IF previous_passes <> p_passes THEN
    UPDATE public.strike_pass_months SET used = p_passes
      WHERE member_id = m.id AND strike_pass_months.month_start = target_month;
    INSERT INTO public.strike_moderator_corrections(member_id, cycle_date, action, actor, reason, details, recorded_at)
      VALUES (m.id, local_day, 'set_passes', p_actor, p_reason,
        jsonb_build_object('previousPasses', previous_passes, 'passes', p_passes), now_at);
  END IF;
  PERFORM public.reconcile_punishments(m, target_month, now_at, p_actor);
  RETURN public.project_member_strikes(m, target_month);
END;
$$;

-- Import one documented November correction. An exact retry reuses its evidence key.
-- An operator must supply the dated evidence explicitly. Legacy aggregate changes are audit only.
CREATE OR REPLACE FUNCTION public.record_verified_november_correction(
  p_member_id uuid, p_cycle date, p_evidence_key text, p_actor text, p_reason text,
  p_void_source uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  activation timestamptz;
  m public.members%ROWTYPE;
  prior public.strike_moderator_corrections%ROWTYPE;
  source_record record;
  correction_id uuid;
  now_at timestamptz;
  action_name text := 'add_strike';
  snapshot jsonb;
BEGIN
  SELECT activated_at INTO STRICT activation FROM public.punishment_rollout WHERE singleton FOR SHARE;
  SELECT * INTO STRICT m FROM public.members WHERE id = p_member_id FOR NO KEY UPDATE;
  now_at := clock_timestamp();
  IF p_cycle IS NULL OR p_cycle < date '2026-11-01' OR p_cycle >= date '2026-12-01'
    OR p_cycle > (now_at AT TIME ZONE public.strike_member_zone(m.timezone))::date
    OR nullif(btrim(p_evidence_key), '') IS NULL OR nullif(btrim(p_actor), '') IS NULL
    OR nullif(btrim(p_reason), '') IS NULL THEN
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'A documented November correction requires a date, reference, actor and reason.';
  END IF;
  SELECT * INTO prior FROM public.strike_moderator_corrections WHERE evidence_key = p_evidence_key;
  IF FOUND THEN
    IF (prior.member_id, prior.cycle_date, prior.source_id, prior.actor, prior.reason)
      IS DISTINCT FROM (p_member_id, p_cycle, p_void_source, p_actor, p_reason) THEN
      RAISE SQLSTATE 'PT409' USING MESSAGE = 'This evidence reference already records a different correction.';
    END IF;
    RETURN prior.id;
  END IF;
  IF p_void_source IS NOT NULL THEN
    SELECT * INTO source_record FROM public.verified_monthly_strikes(m, date '2026-11-01')
      WHERE source_id = p_void_source AND cycle_date = p_cycle;
    IF NOT FOUND THEN RAISE SQLSTATE 'PT400' USING MESSAGE = 'No valid strike matches the correction.'; END IF;
    IF source_record.source_type = 'nightly' THEN
      action_name := 'clear_nightly';
      DELETE FROM public.nightly_strike_logs AS n WHERE n.id = p_void_source RETURNING to_jsonb(n) INTO snapshot;
    ELSE
      action_name := 'void_adjustment';
    END IF;
  END IF;
  INSERT INTO public.strike_moderator_corrections(member_id, cycle_date, action, source_id, evidence_key, actor, reason, details, recorded_at)
    VALUES (m.id, p_cycle, action_name, p_void_source, p_evidence_key, p_actor, p_reason, snapshot, now_at)
    RETURNING id INTO correction_id;
  IF activation IS NOT NULL THEN
    PERFORM public.reconcile_punishments(m, date '2026-11-01', now_at, p_actor);
    PERFORM public.project_member_strikes(m, date_trunc('month', now_at AT TIME ZONE public.strike_member_zone(m.timezone))::date);
  END IF;
  RETURN correction_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.november_punishment_preview()
RETURNS TABLE (member_id uuid, member_name text, verified_rows jsonb, verified_strikes bigint,
  counter_month text, legacy_strikes_used integer, legacy_strikes_count integer, counter_discrepancy boolean,
  used_passes integer, thresholds jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT m.id, m.discord_username, ledger.rows, ledger.total,
    m.strike_cycle_month, m.strikes_used, m.strikes_count,
    CASE WHEN m.strike_cycle_month = '2026-11' THEN
      m.strikes_used <> ledger.total OR m.strikes_count <> ledger.total
    ELSE NULL END,
    COALESCE(passes.used, public.legacy_strike_passes(m, date '2026-11-01')),
    thresholds.rows
  FROM public.members AS m
  LEFT JOIN public.strike_pass_months AS passes ON passes.member_id = m.id AND passes.month_start = date '2026-11-01'
  CROSS JOIN LATERAL (
    SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.cycle_date, s.qualified_at, s.source_id), '[]'::jsonb) AS rows,
      count(*) AS total
    FROM public.verified_monthly_strikes(m, date '2026-11-01') AS s
  ) AS ledger
  CROSS JOIN LATERAL (
    SELECT COALESCE(jsonb_agg(to_jsonb(t) || jsonb_build_object('status', CASE WHEN
      t.assignable_at > statement_timestamp() THEN 'pending' ELSE 'awaiting_assignment' END)
      ORDER BY t.threshold_number), '[]'::jsonb) AS rows
    FROM public.earned_punishment_thresholds(m, date '2026-11-01') AS t
  ) AS thresholds;
$$;

CREATE OR REPLACE FUNCTION public.seed_november_punishments(p_member_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  activation timestamptz;
  m public.members%ROWTYPE;
  now_at timestamptz;
BEGIN
  SELECT activated_at INTO STRICT activation FROM public.punishment_rollout WHERE singleton FOR SHARE;
  IF activation IS NULL THEN RAISE SQLSTATE 'PT409' USING MESSAGE = 'Activate the ledger before running the November seed.'; END IF;
  SELECT * INTO STRICT m FROM public.members WHERE id = p_member_id FOR NO KEY UPDATE;
  now_at := clock_timestamp();
  PERFORM public.ensure_strike_pass_month(m, date '2026-11-01');
  PERFORM public.reconcile_punishments(m, date '2026-11-01', now_at);
  RETURN public.project_member_strikes(m, date_trunc('month', now_at AT TIME ZONE public.strike_member_zone(m.timezone))::date);
END;
$$;

-- Alert recovery may run in a later local month than the issued strike.
-- A null result indicates the app should use the compatibility counters.
CREATE OR REPLACE FUNCTION public.get_strike_cycle_total(p_member_id uuid, p_cycle text)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (SELECT count(*)::integer FROM public.verified_monthly_strikes(m,
    date_trunc('month', public.strike_cycle_day(p_cycle)::timestamp)::date))
  FROM public.members AS m CROSS JOIN public.punishment_rollout AS rollout
  WHERE m.id = p_member_id AND rollout.singleton AND rollout.activated_at IS NOT NULL;
$$;

-- A pending item becomes assignable at its deadline, even if no further strikes occur.
CREATE OR REPLACE VIEW public.punishment_task_status WITH (security_invoker = true) AS
  SELECT p.*, CASE WHEN p.status = 'pending' AND p.assignable_at <= statement_timestamp()
    THEN 'awaiting_assignment' ELSE p.status END AS effective_status
  FROM public.punishments AS p;
REVOKE ALL ON public.punishment_task_status FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.punishment_task_status TO service_role;

CREATE OR REPLACE FUNCTION public.manage_punishment_task(
  p_id uuid, p_action text, p_actor text, p_title text, p_instructions text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m public.members%ROWTYPE;
  item public.punishments%ROWTYPE;
  now_at timestamptz;
  title_value text := nullif(btrim(p_title), '');
  instructions_value text := nullif(btrim(p_instructions), '');
BEGIN
  SELECT * INTO STRICT item FROM public.punishments WHERE id = p_id;
  SELECT * INTO STRICT m FROM public.members WHERE id = item.member_id FOR NO KEY UPDATE;
  now_at := clock_timestamp();
  PERFORM public.reconcile_punishments(m, item.earned_month, now_at);
  SELECT * INTO STRICT item FROM public.punishments WHERE id = p_id;
  IF nullif(btrim(p_actor), '') IS NULL THEN RAISE SQLSTATE 'PT400' USING MESSAGE = 'Moderator identity is required.'; END IF;
  IF p_action = 'complete' AND item.status = 'completed' THEN RETURN to_jsonb(item); END IF;
  IF p_action = 'assign' AND item.status = 'awaiting_assignment' THEN
    IF title_value IS NULL OR length(title_value) > 120 OR length(instructions_value) > 2000 THEN
      RAISE SQLSTATE 'PT400' USING MESSAGE = 'Enter a task title of up to 120 characters and up to 2,000 characters of instructions.';
    END IF;
    UPDATE public.punishments SET status = 'assigned', title = title_value, instructions = instructions_value,
      assigned_at = now_at WHERE id = p_id RETURNING * INTO item;
  ELSIF p_action = 'edit' AND item.status = 'assigned' THEN
    IF title_value IS NULL OR length(title_value) > 120 OR length(instructions_value) > 2000 THEN
      RAISE SQLSTATE 'PT400' USING MESSAGE = 'Enter a task title of up to 120 characters and up to 2,000 characters of instructions.';
    END IF;
    UPDATE public.punishments SET title = title_value, instructions = instructions_value WHERE id = p_id RETURNING * INTO item;
  ELSIF p_action = 'complete' AND item.status = 'assigned' THEN
    UPDATE public.punishments SET status = 'completed', completed_at = now_at WHERE id = p_id RETURNING * INTO item;
  ELSE
    RAISE SQLSTATE 'PT409' USING MESSAGE = 'This punishment is not in a state that permits the requested action.';
  END IF;
  INSERT INTO public.punishment_actions(punishment_id, action, actor, occurred_at, details)
    VALUES (p_id, CASE p_action WHEN 'assign' THEN 'assigned' WHEN 'edit' THEN 'edited' ELSE 'completed' END,
      p_actor, now_at, jsonb_build_object('title', item.title, 'instructions', item.instructions));
  RETURN to_jsonb(item);
END;
$$;

REVOKE ALL ON FUNCTION
  public.apply_legacy_nightly_strike(uuid,text,text,text,text,text,timestamptz,timestamptz),
  public.keep_strike_activation(), public.lock_member_for_sleep_evidence(), public.bump_strike_schedule_revision(),
  public.archive_outgoing_strike_passes(), public.legacy_strike_passes(public.members,date),
  public.strike_cycle_day(text), public.strike_member_zone(text), public.legacy_strike_deadline(public.members,date),
  public.verified_monthly_strikes(public.members,date), public.earned_punishment_thresholds(public.members,date),
  public.reconcile_punishments(public.members,date,timestamptz,text), public.ensure_strike_pass_month(public.members,date),
  public.project_member_strikes(public.members,date),
  public.record_verified_november_correction(uuid,date,text,text,text,uuid)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION
  public.apply_nightly_strike(uuid,text,text,text,text,text,timestamptz,timestamptz),
  public.apply_nightly_strike(uuid,text,text,text,text,text,timestamptz,timestamptz,timestamptz,timestamptz,text,integer),
  public.refresh_member_strike_projection(uuid,timestamptz), public.reset_monthly_strikes(),
  public.adjust_member_strikes(uuid,integer,integer,boolean,text,text),
  public.november_punishment_preview(), public.seed_november_punishments(uuid), public.get_strike_cycle_total(uuid,text),
  public.manage_punishment_task(uuid,text,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.apply_nightly_strike(uuid,text,text,text,text,text,timestamptz,timestamptz),
  public.apply_nightly_strike(uuid,text,text,text,text,text,timestamptz,timestamptz,timestamptz,timestamptz,text,integer),
  public.refresh_member_strike_projection(uuid,timestamptz), public.reset_monthly_strikes(),
  public.adjust_member_strikes(uuid,integer,integer,boolean,text,text),
  public.november_punishment_preview(), public.seed_november_punishments(uuid), public.get_strike_cycle_total(uuid,text),
  public.manage_punishment_task(uuid,text,text,text,text)
  TO service_role;

COMMIT;
