-- Expose the punishment workflow through service-role-only RPCs.
BEGIN;

CREATE OR REPLACE FUNCTION public.require_punishment_visibility()
RETURNS void LANGUAGE plpgsql STABLE SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT FROM public.punishment_rollout WHERE singleton AND screens_visible) THEN
    RAISE SQLSTATE 'PT503' USING MESSAGE = 'Punishments are currently unavailable.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.count_open_punishments(p_member_id uuid)
RETURNS integer LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT count(*)::integer FROM public.punishments
  WHERE member_id = p_member_id AND status IN ('pending', 'awaiting_assignment', 'assigned');
$$;

CREATE OR REPLACE FUNCTION public.get_member_punishments(p_member_id uuid, p_discord_id text, p_details boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m public.members%ROWTYPE;
  local_month date;
  total integer;
  passes integer;
  open_items jsonb;
  history jsonb;
  open_count integer;
BEGIN
  SELECT * INTO m FROM public.members WHERE id = p_member_id AND discord_id = p_discord_id AND is_active;
  IF NOT FOUND THEN
    RAISE SQLSTATE 'PT403' USING MESSAGE = 'Sign in with the Discord account linked to this profile.';
  END IF;
  PERFORM public.require_punishment_visibility();
  open_count := public.count_open_punishments(m.id);
  IF NOT p_details THEN RETURN jsonb_build_object('open_count', open_count); END IF;

  local_month := date_trunc('month', statement_timestamp() AT TIME ZONE public.strike_member_zone(m.timezone))::date;
  SELECT count(*) INTO total FROM public.verified_monthly_strikes(m, local_month);
  SELECT COALESCE(
    (SELECT used FROM public.strike_pass_months WHERE member_id = m.id AND strike_pass_months.month_start = local_month),
    public.legacy_strike_passes(m, local_month)
  ) INTO passes;

  SELECT
    COALESCE(jsonb_agg(to_jsonb(p) - 'effective_status' || jsonb_build_object('status', p.effective_status)
      ORDER BY earned_cycle_date, threshold_number, id) FILTER (WHERE p.status IN ('pending','awaiting_assignment','assigned')), '[]'),
    COALESCE(jsonb_agg(to_jsonb(p) - 'effective_status' ORDER BY completed_at DESC, id)
      FILTER (WHERE p.status = 'completed'), '[]')
    INTO open_items, history
  FROM public.punishment_task_status AS p WHERE p.member_id = m.id AND p.status <> 'canceled';

  RETURN jsonb_build_object('member_id', m.id, 'month', to_char(local_month, 'YYYY-MM'),
    'strikes_used', total, 'metastrikes_used', passes, 'strikes_toward_next', total % 3, 'strikes_per_punishment', 3,
    'open_count', open_count, 'open_items', open_items, 'history', history);
END;
$$;

-- Read one case with its correction sources, or one status section of the work queue.
CREATE OR REPLACE FUNCTION public.get_moderator_punishments(p_id uuid, p_status text, p_offset integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m public.members%ROWTYPE;
  item public.punishment_task_status%ROWTYPE;
  items jsonb;
  strikes jsonb;
BEGIN
  PERFORM public.require_punishment_visibility();
  IF p_id IS NOT NULL THEN
    SELECT * INTO item FROM public.punishment_task_status WHERE id = p_id;
    IF NOT FOUND THEN RAISE SQLSTATE 'PT404' USING MESSAGE = 'Punishment not found.'; END IF;
    SELECT * INTO STRICT m FROM public.members WHERE id = item.member_id;
    SELECT COALESCE(jsonb_agg(s ORDER BY cycle_date, qualified_at, source_id), '[]')
      INTO strikes FROM public.verified_monthly_strikes(m, item.earned_month) AS s;
    RETURN jsonb_build_object('item', to_jsonb(item) - 'effective_status'
        || jsonb_build_object('status', item.effective_status, 'member_name', m.discord_username),
      'open_count', public.count_open_punishments(m.id), 'verified_strikes', strikes);
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('awaiting_assignment', 'assigned', 'pending')
    OR p_offset IS NULL OR p_offset < 0 OR p_offset > 2147483597 THEN
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'Invalid punishment queue filter.';
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(p) - 'effective_status'
    || jsonb_build_object('status', p.effective_status) ORDER BY earned_cycle_date, id), '[]') INTO items
  FROM (
    SELECT p.*, member.discord_username AS member_name FROM public.punishment_task_status AS p
    JOIN public.members AS member ON member.id = p.member_id WHERE p.effective_status = p_status
    ORDER BY p.earned_cycle_date, p.id LIMIT 51 OFFSET p_offset
  ) AS p;
  RETURN CASE WHEN jsonb_array_length(items) > 50
    THEN jsonb_build_object('items', items - 50, 'next_offset', p_offset + 50)
    ELSE jsonb_build_object('items', items, 'next_offset', NULL) END;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_dated_strike_correction(
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
  target_month date;
  action_name text := 'add_strike';
  snapshot jsonb;
BEGIN
  SELECT activated_at INTO STRICT activation FROM public.punishment_rollout WHERE singleton FOR SHARE;
  SELECT * INTO STRICT m FROM public.members WHERE id = p_member_id FOR NO KEY UPDATE;
  now_at := clock_timestamp();
  IF p_cycle IS NULL OR p_cycle < date '2026-11-01'
    OR p_cycle > (now_at AT TIME ZONE public.strike_member_zone(m.timezone))::date
    OR nullif(btrim(p_evidence_key), '') IS NULL OR nullif(btrim(p_actor), '') IS NULL
    OR nullif(btrim(p_reason), '') IS NULL THEN
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'A dated strike correction requires a valid date, reference, actor and reason.';
  END IF;
  target_month := date_trunc('month', p_cycle::timestamp)::date;
  SELECT * INTO prior FROM public.strike_moderator_corrections WHERE evidence_key = p_evidence_key;
  IF FOUND THEN
    IF (prior.member_id, prior.cycle_date, prior.source_id, prior.actor, prior.reason)
      IS DISTINCT FROM (p_member_id, p_cycle, p_void_source, p_actor, p_reason) THEN
      RAISE SQLSTATE 'PT409' USING MESSAGE = 'This evidence reference already records a different correction.';
    END IF;
    RETURN prior.id;
  END IF;
  IF p_void_source IS NOT NULL THEN
    SELECT * INTO source_record FROM public.verified_monthly_strikes(m, target_month)
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
    PERFORM public.reconcile_punishments(m, target_month, now_at, p_actor);
    PERFORM public.project_member_strikes(m, date_trunc('month', now_at AT TIME ZONE public.strike_member_zone(m.timezone))::date);
  END IF;
  RETURN correction_id;
END;
$$;

-- The launch import keeps its November-only contract and shares the audit/reconciliation path.
CREATE OR REPLACE FUNCTION public.record_verified_november_correction(
  p_member_id uuid, p_cycle date, p_evidence_key text, p_actor text, p_reason text, p_void_source uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_cycle IS NULL OR p_cycle < date '2026-11-01' OR p_cycle >= date '2026-12-01' THEN
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'A documented November correction requires a November cycle date.';
  END IF;
  RETURN public.record_dated_strike_correction(p_member_id, p_cycle, p_evidence_key, p_actor, p_reason, p_void_source);
END;
$$;

-- One transaction for the existing task state machine and dated corrections.
CREATE OR REPLACE FUNCTION public.update_punishment(
  p_id uuid, p_action text, p_actor text, p_title text DEFAULT NULL, p_instructions text DEFAULT NULL,
  p_cycle date DEFAULT NULL, p_source uuid DEFAULT NULL, p_reason text DEFAULT NULL, p_request_id uuid DEFAULT NULL
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
      OR (item.title, item.instructions) IS DISTINCT FROM (nullif(btrim(p_title), ''), nullif(btrim(p_instructions), '')) THEN
      PERFORM public.manage_punishment_task(p_id, p_action, p_actor, p_title, p_instructions);
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

REVOKE ALL ON FUNCTION public.require_punishment_visibility(), public.count_open_punishments(uuid),
  public.record_dated_strike_correction(uuid,date,text,text,text,uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_member_punishments(uuid,text,boolean),
  public.get_moderator_punishments(uuid,text,integer), public.update_punishment(uuid,text,text,text,text,date,uuid,text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_member_punishments(uuid,text,boolean),
  public.get_moderator_punishments(uuid,text,integer), public.update_punishment(uuid,text,text,text,text,date,uuid,text,uuid)
  TO service_role;

COMMIT;
