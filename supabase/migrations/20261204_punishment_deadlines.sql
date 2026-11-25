-- Add completion deadlines and charge instant replacements to the sleep cycle's month.
BEGIN;

ALTER TABLE public.punishments ADD COLUMN IF NOT EXISTS due_at timestamptz;

CREATE OR REPLACE FUNCTION public.strike_member_zone(value text, postgres_offset boolean)
RETURNS text LANGUAGE sql STABLE SET search_path = '' AS $$
  -- PostgreSQL's POSIX zone names use the opposite sign from member-facing GMT offsets.
  SELECT CASE WHEN parts IS NOT NULL THEN
    'GMT' || CASE WHEN (parts[1] = '+') = postgres_offset THEN '-' ELSE '+' END
      || lpad(parts[2], 2, '0') || ':' || COALESCE(parts[3], '00')
    ELSE COALESCE((SELECT name FROM pg_timezone_names WHERE name = btrim(value)), 'UTC') END
  FROM regexp_match(btrim(value), '^(?:GMT|UTC)?([+-])(0?[0-9]|1[0-4])(?::?([0-5][0-9]))?$', 'i') AS offsets(parts);
$$;

CREATE OR REPLACE FUNCTION public.strike_member_zone(value text)
RETURNS text LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT public.strike_member_zone(value, true);
$$;

CREATE OR REPLACE FUNCTION public.punishment_member_zone(
  m public.members, now_at timestamptz, postgres_offset boolean DEFAULT false
) RETURNS text LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT public.strike_member_zone(CASE WHEN m.pending_effective_at <= now_at
    THEN COALESCE(NULLIF(m.pending_timezone, ''), m.timezone) ELSE m.timezone END, postgres_offset);
$$;

CREATE OR REPLACE FUNCTION public.punishment_progress_month(m public.members, now_at timestamptz)
RETURNS date LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT date_trunc('month', now_at AT TIME ZONE public.punishment_member_zone(m, now_at, true))::date;
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
        title = NULL, instructions = NULL, assigned_at = NULL, due_at = NULL, canceled_at = NULL
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

CREATE OR REPLACE VIEW public.punishment_task_status AS
  SELECT p.id, p.member_id, p.earned_month, p.threshold_number, p.earned_cycle_date, p.qualified_at,
    p.assignable_at, p.status, p.title, p.instructions, p.assigned_at, p.completed_at, p.canceled_at, CASE
    WHEN rollout.reviewed_metastrikes_required AND p.status IN ('pending', 'awaiting_assignment')
      THEN CASE WHEN hold.active THEN 'pending' ELSE 'awaiting_assignment' END
    WHEN p.status = 'pending' AND p.assignable_at <= statement_timestamp() THEN 'awaiting_assignment'
    ELSE p.status END AS effective_status,
    hold.active AS metastrike_hold, p.due_at,
    public.punishment_member_zone(m, statement_timestamp()) AS member_timezone
  FROM public.punishments p JOIN public.members m ON m.id = p.member_id
  JOIN public.punishment_rollout rollout ON rollout.singleton
  CROSS JOIN LATERAL (SELECT CASE WHEN rollout.reviewed_metastrikes_required
    AND p.status IN ('pending', 'awaiting_assignment', 'assigned')
    THEN public.metastrike_task_held(p, m, statement_timestamp(),
      rollout.metastrike_requests_open AND rollout.screens_visible AND p.status <> 'assigned')
    ELSE false END AS active) hold;

CREATE OR REPLACE FUNCTION public.manage_punishment_task(
  p_id uuid, p_action text, p_actor text, p_title text, p_instructions text, p_due_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m public.members;
  item public.punishments;
  view_item public.punishment_task_status;
  now_at timestamptz;
  member_zone text;
  due_at_value timestamptz;
  title_value text := nullif(btrim(p_title), '');
  instructions_value text := nullif(btrim(p_instructions), '');
BEGIN
  PERFORM FROM public.punishment_rollout WHERE singleton FOR SHARE;
  SELECT * INTO STRICT item FROM public.punishments WHERE id = p_id;
  SELECT * INTO STRICT m FROM public.members WHERE id = item.member_id FOR NO KEY UPDATE;
  now_at := clock_timestamp();
  PERFORM public.reconcile_punishments(m, item.earned_month, now_at);
  SELECT * INTO STRICT view_item FROM public.punishment_task_status WHERE id = p_id;
  IF nullif(btrim(p_actor), '') IS NULL THEN RAISE SQLSTATE 'PT400' USING MESSAGE = 'Moderator identity is required.'; END IF;
  IF p_action = 'complete' AND view_item.status = 'completed' THEN RETURN to_jsonb(view_item) - ARRAY['effective_status', 'metastrike_hold', 'member_timezone']; END IF;
  IF view_item.metastrike_hold AND p_action IN ('assign', 'complete') THEN
    RAISE SQLSTATE 'PT409' USING MESSAGE = 'This punishment is on hold for Metastrike review.';
  END IF;
  IF p_action IN ('assign', 'edit') AND (title_value IS NULL OR length(title_value) > 120 OR length(instructions_value) > 2000) THEN
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'Enter a task title of up to 120 characters and up to 2,000 characters of instructions.';
  END IF;
  IF p_action IN ('assign', 'edit') AND p_due_at IS NOT NULL
    AND (NOT isfinite(p_due_at) OR (p_due_at <= now_at AND p_due_at IS DISTINCT FROM view_item.due_at)) THEN
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'Choose a deadline in the future.';
  END IF;
  IF p_action = 'assign' AND view_item.effective_status = 'awaiting_assignment' THEN
    member_zone := public.punishment_member_zone(m, now_at, true);
    due_at_value := COALESCE(p_due_at,
      ((now_at AT TIME ZONE member_zone) + interval '7 days') AT TIME ZONE member_zone);
    UPDATE public.punishments SET status = 'assigned', title = title_value, instructions = instructions_value,
      assigned_at = now_at, due_at = due_at_value WHERE id = p_id RETURNING * INTO item;
  ELSIF p_action = 'edit' AND view_item.status = 'assigned' THEN
    UPDATE public.punishments SET title = title_value, instructions = instructions_value,
      due_at = COALESCE(p_due_at, view_item.due_at) WHERE id = p_id RETURNING * INTO item;
  ELSIF p_action = 'complete' AND view_item.status = 'assigned' THEN
    UPDATE public.punishments SET status = 'completed', completed_at = now_at WHERE id = p_id RETURNING * INTO item;
  ELSE
    RAISE SQLSTATE 'PT409' USING MESSAGE = 'This punishment is not in a state that permits the requested action.';
  END IF;
  INSERT INTO public.punishment_actions(punishment_id, action, actor, occurred_at, details)
    VALUES (p_id, CASE p_action WHEN 'assign' THEN 'assigned' WHEN 'edit' THEN 'edited' ELSE 'completed' END,
      p_actor, now_at, jsonb_build_object('title', item.title, 'instructions', item.instructions,
        'previous_due_at', view_item.due_at, 'due_at', item.due_at));
  RETURN to_jsonb(item);
END;
$$;

CREATE OR REPLACE FUNCTION public.manage_punishment_task(
  p_id uuid, p_action text, p_actor text, p_title text, p_instructions text
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.manage_punishment_task(p_id, p_action, p_actor, p_title, p_instructions, NULL);
$$;

CREATE OR REPLACE FUNCTION public.update_punishment(
  p_id uuid, p_action text, p_actor text, p_title text, p_instructions text,
  p_cycle date, p_source uuid, p_reason text, p_request_id uuid, p_due_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m public.members%ROWTYPE;
  item public.punishment_task_status%ROWTYPE;
  correction_id uuid;
BEGIN
  -- Match the strike writers' rollout/member lock order. Visibility cannot
  -- change halfway through a write, and all writes for this member serialize.
  PERFORM FROM public.punishment_rollout WHERE singleton FOR SHARE;
  PERFORM public.require_punishment_visibility();
  SELECT * INTO item FROM public.punishment_task_status WHERE id = p_id;
  IF NOT FOUND THEN RAISE SQLSTATE 'PT404' USING MESSAGE = 'Punishment not found.'; END IF;
  SELECT * INTO m FROM public.members WHERE id = item.member_id FOR NO KEY UPDATE;
  SELECT * INTO item FROM public.punishment_task_status WHERE id = p_id;
  IF NOT FOUND THEN RAISE SQLSTATE 'PT404' USING MESSAGE = 'Punishment not found.'; END IF;
  IF nullif(btrim(p_actor), '') IS NULL THEN
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'Moderator identity is required.';
  END IF;

  IF p_action IN ('add_strike', 'remove_strike') THEN
    IF p_cycle IS NULL OR date_trunc('month', p_cycle::timestamp)::date <> item.earned_month
      OR p_request_id IS NULL OR (p_action = 'remove_strike') <> (p_source IS NOT NULL)
      OR nullif(btrim(p_reason), '') IS NULL OR length(p_reason) > 500 THEN
      RAISE SQLSTATE 'PT400' USING MESSAGE = 'Enter a date in the earned month, a reason, and a request ID. Removal requires a strike source.';
    END IF;
    correction_id := public.record_dated_strike_correction(m.id, p_cycle,
      'punishment:' || p_id || ':' || p_request_id, p_actor, p_reason, p_source);
  ELSIF p_action IN ('assign', 'edit', 'complete') THEN
    -- An immediate retry of the same saved assignment/edit should return the current state.
    IF item.status <> 'assigned' OR p_action = 'complete'
      OR (item.title, item.instructions, item.due_at) IS DISTINCT FROM
        (nullif(btrim(p_title), ''), nullif(btrim(p_instructions), ''), COALESCE(p_due_at, item.due_at)) THEN
      PERFORM public.manage_punishment_task(p_id, p_action, p_actor, p_title, p_instructions, p_due_at);
    END IF;
  ELSE
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'Unknown punishment action.';
  END IF;
  SELECT * INTO STRICT item FROM public.punishment_task_status WHERE id = p_id;
  RETURN jsonb_build_object('success', true, 'item', to_jsonb(item) - 'effective_status'
      || jsonb_build_object('status', item.effective_status, 'member_name', m.discord_username),
    'open_count', public.count_open_punishments(m.id), 'correction_id', correction_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_punishment(
  p_id uuid, p_action text, p_actor text, p_title text DEFAULT NULL, p_instructions text DEFAULT NULL,
  p_cycle date DEFAULT NULL, p_source uuid DEFAULT NULL, p_reason text DEFAULT NULL, p_request_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.update_punishment(p_id, p_action, p_actor, p_title, p_instructions,
    p_cycle, p_source, p_reason, p_request_id, NULL);
$$;

CREATE OR REPLACE FUNCTION public.moderate_punishment(
  p_actor_id uuid, p_actor_discord_id text, p_id uuid, p_action text, p_title text,
  p_instructions text, p_cycle date, p_source uuid,
  p_reason text, p_request_id uuid, p_due_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  target_id uuid;
BEGIN
  PERFORM FROM public.punishment_rollout WHERE singleton FOR SHARE;
  PERFORM public.require_punishment_visibility();
  SELECT member_id INTO target_id FROM public.punishment_task_status WHERE id = p_id;
  IF NOT FOUND THEN RAISE SQLSTATE 'PT404' USING MESSAGE = 'Punishment not found.'; END IF;
  PERFORM public.lock_moderation_target(p_actor_id, p_actor_discord_id, target_id);
  RETURN public.update_punishment(p_id, p_action, p_actor_id::text, p_title, p_instructions,
    p_cycle, p_source, p_reason, p_request_id, p_due_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.legacy_strike_passes(m public.members, month_start date)
RETURNS integer LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE WHEN m.strike_cycle_month IS NULL OR m.strike_cycle_month = to_char(month_start, 'YYYY-MM')
    THEN greatest(m.metastrikes_used, m.metastrikes_count)
    ELSE (
      SELECT least(3, count(*))::integer
      FROM public.nightly_strike_logs AS n
      CROSS JOIN LATERAL (SELECT COALESCE(n.pass_charged_month, n.pass_used_on,
        (n.updated_at AT TIME ZONE public.strike_member_zone(m.timezone))::date) AS used_on) AS day
      WHERE n.target_member_id = m.id AND n.record_type = 'metastrike'
        AND day.used_on >= month_start AND day.used_on < month_start + interval '1 month'
    ) END;
$$;

CREATE OR REPLACE FUNCTION public.apply_legacy_nightly_strike(
  p_member_id uuid, p_cycle text, p_month text, p_previous_type text,
  p_type text, p_reason text, p_now timestamptz, p_month_start timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  m public.members%ROWTYPE;
  nightly public.nightly_strike_logs%ROWTYPE;
  strikes integer := 0;
  passes integer := 0;
  current_month date := (p_month || '-01')::date;
  cycle date := public.strike_cycle_day(p_cycle);
  pass_month date;
  historical_passes integer;
BEGIN
  SELECT * INTO STRICT m FROM public.members WHERE id = p_member_id FOR UPDATE;
  IF p_month < m.strike_cycle_month THEN
    RAISE SQLSTATE 'PT409' USING MESSAGE = 'The strike month advanced. Refresh the member and retry.';
  END IF;
  SELECT * INTO nightly FROM public.nightly_strike_logs
    WHERE target_member_id = m.id AND sleep_cycle_date = p_cycle FOR UPDATE;
  IF nightly.record_type IS DISTINCT FROM p_previous_type THEN
    RAISE EXCEPTION 'The nightly record changed. Refresh and retry.';
  END IF;
  IF m.strike_cycle_month IS NULL OR m.strike_cycle_month = p_month THEN
    strikes := greatest(m.strikes_used, m.strikes_count);
    passes := greatest(m.metastrikes_used, m.metastrikes_count);
  END IF;
  IF p_type = 'strike' THEN
    IF nightly.record_type IN ('strike', 'metastrike') THEN
      RAISE EXCEPTION 'This cycle already has a strike or pass.';
    END IF;
    IF EXISTS (SELECT FROM public.strike_moderator_corrections
      WHERE member_id = m.id AND cycle_date = public.strike_cycle_day(p_cycle)
        AND action = 'clear_nightly' AND source_id IS NOT NULL) THEN
      RETURN jsonb_build_object('reason', 'moderator_cleared');
    END IF;
    IF (m.last_notified_stage = 'IN_BED_EARLY' AND m.last_notified_cycle_date = p_cycle)
       OR m.last_wake_cycle_date = p_cycle
       OR EXISTS (SELECT FROM public.notification_logs WHERE member_id = m.id
         AND local_date = p_cycle::date AND notification_type IN ('IN_BED_EARLY', 'WOKE_UP'))
       OR EXISTS (SELECT FROM public.sleep_logs WHERE member_id = m.id
         AND cycle_date = p_cycle AND (in_bed_at IS NOT NULL OR woke_up_at IS NOT NULL)) THEN
      RETURN jsonb_build_object('reason', 'already_checked_in');
    END IF;
    IF strikes >= 3 THEN RETURN jsonb_build_object('reason', 'already_at_max_strikes'); END IF;
    strikes := strikes + 1;
  ELSIF p_type = 'metastrike' THEN
    IF nightly.record_type = 'metastrike' THEN RAISE EXCEPTION 'This cycle already has a pass.'; END IF;
    pass_month := CASE WHEN nightly.record_type = 'strike' AND cycle IS NOT NULL
      THEN date_trunc('month', cycle::timestamp)::date ELSE current_month END;
    IF pass_month = current_month THEN
      IF passes >= 3 THEN RAISE SQLSTATE 'PT400' USING MESSAGE = 'You have used all 3 Metastrikes for this month.'; END IF;
      passes := passes + 1;
    ELSE
      historical_passes := public.ensure_strike_pass_month(m, pass_month);
      IF historical_passes >= 3 THEN
        RAISE SQLSTATE 'PT400' USING MESSAGE = 'You have used all 3 Metastrikes for ' || to_char(pass_month, 'FMMonth YYYY') || '.';
      END IF;
      UPDATE public.strike_pass_months SET used = historical_passes + 1
        WHERE member_id = m.id AND month_start = pass_month;
    END IF;
    IF nightly.record_type = 'strike' AND COALESCE(nightly.legacy_strike_charge_month = current_month,
      nightly.updated_at >= p_month_start) THEN
      strikes := greatest(0, strikes - 1);
    END IF;
  ELSIF p_type = 'clear' THEN
    IF nightly.record_type = 'strike' AND nightly.updated_at >= p_month_start THEN
      strikes := greatest(0, strikes - 1);
    ELSIF nightly.record_type = 'metastrike' THEN
      pass_month := COALESCE(nightly.pass_charged_month, date_trunc('month', COALESCE(nightly.pass_used_on,
        (nightly.updated_at AT TIME ZONE public.strike_member_zone(m.timezone))::date)::timestamp)::date);
      IF pass_month = current_month THEN
        passes := greatest(0, passes - 1);
      ELSIF pass_month IS NOT NULL THEN
        historical_passes := public.ensure_strike_pass_month(m, pass_month);
        UPDATE public.strike_pass_months SET used = greatest(0, historical_passes - 1)
          WHERE member_id = m.id AND month_start = pass_month;
      END IF;
    END IF;
  ELSE
    RAISE EXCEPTION 'Invalid nightly record type.';
  END IF;

  IF p_type = 'clear' THEN
    DELETE FROM public.nightly_strike_logs WHERE id = nightly.id;
  ELSE
    INSERT INTO public.nightly_strike_logs (target_member_id, sleep_cycle_date, record_type, reason, created_at, updated_at,
      legacy_strike_charge_month, pass_charged_month)
      VALUES (m.id, p_cycle, p_type, p_reason, p_now, p_now,
        CASE WHEN p_type = 'strike' THEN current_month END, pass_month)
      ON CONFLICT (target_member_id, sleep_cycle_date) DO UPDATE
      SET record_type = excluded.record_type, reason = excluded.reason, updated_at = excluded.updated_at,
        legacy_strike_charge_month = excluded.legacy_strike_charge_month,
        pass_charged_month = excluded.pass_charged_month
      RETURNING * INTO nightly;
  END IF;
  UPDATE public.members SET strikes_used = strikes, strikes_count = strikes,
    metastrikes_used = passes, metastrikes_count = passes,
    strike_cycle_month = p_month, updated_at = p_now WHERE id = m.id;
  RETURN jsonb_build_object('log', to_jsonb(nightly), 'strikesUsed', strikes, 'metastrikesUsed', passes);
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
  local_day := (now_at AT TIME ZONE public.punishment_member_zone(m, now_at, true))::date;
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
    -- A replacement uses the allowance for the sleep cycle it excuses.
    pass_month := CASE WHEN nightly.record_type = 'strike' THEN cycle_month ELSE current_month END;
    passes := public.ensure_strike_pass_month(m, pass_month);
    IF passes >= 3 THEN
      RAISE SQLSTATE 'PT400' USING MESSAGE = 'You have used all 3 Metastrikes for ' || to_char(pass_month, 'FMMonth YYYY') || '.';
    END IF;
    UPDATE public.strike_pass_months SET used = passes + 1 WHERE member_id = m.id AND month_start = pass_month;
    IF p_moderator IS NOT NULL THEN
      INSERT INTO public.strike_moderator_corrections(member_id, cycle_date, action, actor, reason, details, recorded_at)
        VALUES (m.id, cycle, 'moderator_pass', p_moderator, p_reason, to_jsonb(nightly), now_at);
    END IF;
  ELSIF p_type = 'clear' THEN
    IF nullif(btrim(p_moderator), '') IS NULL THEN
      RAISE SQLSTATE 'PT400' USING MESSAGE = 'Moderator identity is required to clear the nightly record.';
    END IF;
    IF nightly.record_type = 'metastrike' THEN
      pass_month := COALESCE(nightly.pass_charged_month, date_trunc('month', COALESCE(nightly.pass_used_on,
        (nightly.updated_at AT TIME ZONE public.strike_member_zone(m.timezone))::date)::timestamp)::date);
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
      replacement_until, pass_used_on, pass_charged_month)
    VALUES (m.id, p_cycle, p_type, p_reason, now_at, now_at,
      CASE WHEN p_type = 'strike' THEN p_replacement_until END,
      CASE WHEN p_type = 'metastrike' THEN local_day END,
      CASE WHEN p_type = 'metastrike' THEN pass_month END)
    ON CONFLICT (target_member_id, sleep_cycle_date) DO UPDATE SET record_type = excluded.record_type,
      reason = excluded.reason, updated_at = excluded.updated_at, voter_ids = '[]'::jsonb,
      replacement_until = excluded.replacement_until, pass_used_on = excluded.pass_used_on,
      pass_charged_month = excluded.pass_charged_month
    RETURNING * INTO nightly;
  END IF;

  PERFORM public.reconcile_punishments(m, cycle_month, now_at, p_moderator);
  projection := public.project_member_strikes(m, current_month);
  RETURN projection || jsonb_build_object('log', CASE WHEN p_type <> 'clear' THEN to_jsonb(nightly) END,
    'cycleStrikesUsed', (SELECT count(*) FROM public.verified_monthly_strikes(m, cycle_month)));
END;
$$;

CREATE OR REPLACE FUNCTION public.moderate_strike_counts(
  p_actor_id uuid, p_actor_discord_id text, p_member_id uuid, p_strikes integer, p_passes integer, p_relative boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m public.members;
  reviewed boolean;
  projection jsonb;
  affected_month date;
  quota jsonb;
  reviewed_used integer;
BEGIN
  SELECT reviewed_metastrikes_required INTO STRICT reviewed FROM public.punishment_rollout WHERE singleton FOR SHARE;
  m := public.lock_moderation_target(p_actor_id, p_actor_discord_id, p_member_id, true);
  IF p_strikes IS NOT NULL AND (p_relative IS DISTINCT FROM true OR p_strikes <> 0) THEN
    RAISE SQLSTATE 'PT409' USING MESSAGE = 'Use Review strikes to make a dated strike correction.';
  END IF;
  projection := public.adjust_member_strikes(p_member_id, NULL, p_passes, p_relative,
    p_actor_id::text, 'Moderator pass balance correction');
  IF reviewed THEN
    affected_month := (projection->>'month' || '-01')::date;
    quota := public.metastrike_quota(m, affected_month);
    SELECT count(*) INTO reviewed_used FROM public.nightly_strike_logs AS n
      WHERE n.target_member_id = m.id AND n.record_type = 'metastrike' AND n.pass_charged_month = affected_month
        AND EXISTS (SELECT FROM public.metastrike_requests AS r
          WHERE r.member_id = m.id AND r.pass_source_id = n.id AND r.status = 'approved');
    IF (quota->>'used')::integer < reviewed_used OR (quota->>'used')::integer + (quota->>'reserved')::integer > 3 THEN
      RAISE SQLSTATE 'PT409' USING MESSAGE = 'This correction conflicts with an approved or reserved Metastrike slot.';
    END IF;
  END IF;
  RETURN projection;
END;
$$;

REVOKE ALL ON FUNCTION public.punishment_member_zone(public.members,timestamptz,boolean),
  public.manage_punishment_task(uuid,text,text,text,text,timestamptz),
  public.update_punishment(uuid,text,text,text,text,date,uuid,text,uuid,timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.moderate_punishment(uuid,text,uuid,text,text,text,date,uuid,text,uuid,timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.moderate_punishment(uuid,text,uuid,text,text,text,date,uuid,text,uuid,timestamptz)
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
