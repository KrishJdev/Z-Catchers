-- Enable roster strike corrections and shared calendar history independently of punishment visibility.
BEGIN;

-- Preserve the actual legacy balance month even if the member later changes timezone.
ALTER TABLE public.nightly_strike_logs ADD COLUMN IF NOT EXISTS legacy_strike_charge_month date;

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
  month_start := public.punishment_progress_month(m, greatest(p_now, clock_timestamp()));
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
  adjusting_strikes boolean := p_strikes IS NOT NULL;
  previous_passes integer;
  item record;
BEGIN
  SELECT activated_at INTO STRICT activation FROM public.punishment_rollout WHERE singleton FOR SHARE;
  SELECT * INTO STRICT m FROM public.members WHERE id = p_member_id FOR NO KEY UPDATE;
  now_at := clock_timestamp();
  local_day := (now_at AT TIME ZONE public.strike_member_zone(CASE WHEN m.pending_effective_at <= now_at
    THEN COALESCE(NULLIF(m.pending_timezone, ''), m.timezone) ELSE m.timezone END))::date;
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
    IF adjusting_strikes AND p_strikes > 3 THEN
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
  statement_at timestamptz := statement_timestamp();
  target_month date;
  action_name text := 'add_strike';
  snapshot jsonb;
BEGIN
  SELECT activated_at INTO STRICT activation FROM public.punishment_rollout WHERE singleton FOR SHARE;
  SELECT * INTO STRICT m FROM public.members WHERE id = p_member_id FOR NO KEY UPDATE;
  now_at := clock_timestamp();
  IF p_cycle IS NULL OR p_cycle < date '2026-11-01'
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
  IF p_cycle > (statement_at AT TIME ZONE public.strike_member_zone(CASE WHEN m.pending_effective_at <= statement_at
      THEN COALESCE(NULLIF(m.pending_timezone, ''), m.timezone) ELSE m.timezone END))::date THEN
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'A dated strike correction requires a valid date, reference, actor and reason.';
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
    PERFORM public.project_member_strikes(m, public.punishment_progress_month(m, now_at));
  END IF;
  RETURN correction_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_strike_month(m public.members, p_month date)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  now_at timestamptz := statement_timestamp();
  zone text := public.strike_member_zone(
    CASE WHEN m.pending_effective_at <= now_at
      THEN COALESCE(NULLIF(m.pending_timezone, ''), m.timezone) ELSE m.timezone END);
  local_day date := (now_at AT TIME ZONE zone)::date;
  current_month date := date_trunc('month', local_day::timestamp)::date;
  selected_month date := COALESCE(p_month, current_month);
  sources jsonb;
  rollout public.punishment_rollout;
BEGIN
  IF selected_month < date '2026-11-01' OR selected_month > current_month
    OR extract(day FROM selected_month) <> 1 THEN
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'Choose an available strike month.';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('source_id', s.source_id, 'source_type', s.source_type,
    'cycle_date', s.cycle_date, 'reason', COALESCE(c.reason, n.reason))
    ORDER BY s.cycle_date DESC, s.qualified_at DESC, s.source_id), '[]')
    INTO sources
    FROM public.verified_monthly_strikes(m, selected_month) AS s
    LEFT JOIN public.strike_moderator_corrections AS c ON s.source_type = 'moderator' AND c.id = s.source_id
    LEFT JOIN public.nightly_strike_logs AS n ON s.source_type = 'nightly' AND n.id = s.source_id;

  SELECT * INTO STRICT rollout FROM public.punishment_rollout WHERE singleton;
  RETURN jsonb_build_object('month', to_char(selected_month, 'YYYY-MM'),
    'current_month', to_char(current_month, 'YYYY-MM'), 'latest_cycle_date', local_day,
    'verified_strikes', sources, 'strikes_used', jsonb_array_length(sources),
    'current_strikes_used', CASE
      WHEN rollout.activated_at IS NOT NULL AND selected_month = current_month THEN jsonb_array_length(sources)
      WHEN m.strike_cycle_month = to_char(current_month, 'YYYY-MM') THEN greatest(m.strikes_used, m.strikes_count)
      ELSE 0 END,
    'open_count', CASE WHEN rollout.screens_visible THEN public.count_open_punishments(m.id) END);
END;
$$;

CREATE OR REPLACE FUNCTION public.read_moderation_strike_month(
  p_actor_id uuid, p_actor_discord_id text, p_member_id uuid, p_month date
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor_role text;
  target public.members;
BEGIN
  SELECT role INTO actor_role FROM public.members
    WHERE id = p_actor_id AND discord_id = p_actor_discord_id AND is_active;
  IF actor_role IS NULL OR actor_role NOT IN ('owner', 'moderator') THEN
    RAISE SQLSTATE 'PT403' USING MESSAGE = 'Your staff access has changed.';
  END IF;
  IF actor_role = 'moderator' AND p_member_id = p_actor_id THEN
    RAISE SQLSTATE 'PT403' USING MESSAGE = 'Another Moderator or the Owner can correct your strikes.';
  END IF;
  SELECT * INTO target FROM public.members WHERE id = p_member_id;
  IF NOT FOUND THEN RAISE SQLSTATE 'PT404' USING MESSAGE = 'Member not found.'; END IF;
  RETURN public.staff_strike_month(target, p_month);
END;
$$;

CREATE OR REPLACE FUNCTION public.moderate_dated_strike(
  p_actor_id uuid, p_actor_discord_id text, p_member_id uuid, p_action text,
  p_cycle date, p_source uuid, p_reason text, p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor_role text;
  locked_member_id uuid;
  target public.members;
  correction_id uuid;
  activation timestamptz;
  current_month date;
  cycle_month date := date_trunc('month', p_cycle::timestamp)::date;
  charge_month date;
  correction_action text;
  already_recorded boolean;
  reconciliation_required boolean := false;
  legacy_count integer;
  evidence text := 'roster:' || p_request_id;
BEGIN
  IF p_cycle IS NULL OR p_request_id IS NULL OR p_action IS NULL
    OR p_action NOT IN ('add_strike', 'remove_strike')
    OR (p_action = 'remove_strike') <> (p_source IS NOT NULL)
    OR nullif(btrim(p_reason), '') IS NULL OR length(btrim(p_reason)) > 500 THEN
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'Enter a cycle date, reason and request ID. Removal requires a strike source.';
  END IF;

  SELECT activated_at INTO STRICT activation FROM public.punishment_rollout WHERE singleton FOR SHARE;
  -- Take the protected Owner row first, as other staff writes do. Member and
  -- Moderator rows keep the same ID order through promotions and revocations.
  FOR locked_member_id IN
    SELECT id FROM public.members WHERE id IN (p_actor_id, p_member_id)
      ORDER BY (role = 'owner') DESC, id
  LOOP
    IF locked_member_id = p_member_id THEN
      SELECT * INTO target FROM public.members WHERE id = p_member_id FOR NO KEY UPDATE;
    END IF;
    IF locked_member_id = p_actor_id THEN
      actor_role := public.lock_moderation_actor(p_actor_id, p_actor_discord_id, false);
    END IF;
  END LOOP;
  IF actor_role IS NULL THEN
    RAISE SQLSTATE 'PT403' USING MESSAGE = 'Your staff access has changed.';
  END IF;
  IF actor_role = 'moderator' AND p_member_id = p_actor_id THEN
    RAISE SQLSTATE 'PT403' USING MESSAGE = 'Another Moderator or the Owner can correct your strikes.';
  END IF;
  IF target.id IS NULL THEN RAISE SQLSTATE 'PT404' USING MESSAGE = 'Member not found.'; END IF;
  SELECT EXISTS (SELECT FROM public.strike_moderator_corrections WHERE evidence_key = evidence)
    INTO already_recorded;

  -- Same-member retries serialize on the member lock. The unique evidence key
  -- also rejects a simultaneous reuse of the UUID on a different profile.
  BEGIN
    correction_id := public.record_dated_strike_correction(target.id, p_cycle, evidence,
      p_actor_id::text, btrim(p_reason), p_source);
  EXCEPTION WHEN unique_violation THEN
    IF EXISTS (SELECT FROM public.strike_moderator_corrections WHERE evidence_key = evidence) THEN
      RAISE SQLSTATE 'PT409' USING MESSAGE = 'This request ID already records a different correction.';
    END IF;
    RAISE;
  END;

  current_month := public.punishment_progress_month(target, statement_timestamp());
  -- The legacy dispatcher still uses the compatibility counters. Apply each
  -- correction once without deriving a balance from incomplete history.
  IF activation IS NULL AND NOT already_recorded THEN
    IF p_action = 'remove_strike' THEN
      -- Nightly charges belong to the recorded balance month, even when a
      -- timezone change temporarily moves the member's local calendar back.
      SELECT c.action, CASE WHEN c.action = 'clear_nightly' THEN
        COALESCE((c.details->>'legacy_strike_charge_month')::date,
          CASE WHEN h.issued_at IS NOT NULL AND NULLIF(h.issuance_timezone, '') IS NOT NULL THEN
            date_trunc('month', h.issued_at AT TIME ZONE public.strike_member_zone(h.issuance_timezone))::date END)
        WHEN cycle_month = current_month THEN cycle_month END
      INTO STRICT correction_action, charge_month
      FROM public.strike_moderator_corrections c
      LEFT JOIN public.nightly_strike_history h ON h.source_id = c.source_id AND h.record_type = 'strike'
      WHERE c.id = correction_id;
      IF correction_action = 'clear_nightly' AND charge_month IS NULL THEN
        UPDATE public.strike_moderator_corrections SET details = COALESCE(details, '{}'::jsonb)
          || jsonb_build_object('balance_reconciliation_required', true) WHERE id = correction_id;
      END IF;
    ELSIF cycle_month = current_month THEN
      charge_month := cycle_month;
      IF target.strike_cycle_month < to_char(current_month, 'YYYY-MM') THEN
        PERFORM public.refresh_member_strike_projection(target.id, statement_timestamp());
        SELECT * INTO target FROM public.members WHERE id = p_member_id;
      END IF;
    END IF;
    IF target.strike_cycle_month = to_char(charge_month, 'YYYY-MM') THEN
      legacy_count := greatest(0, greatest(target.strikes_used, target.strikes_count)
        + CASE WHEN p_action = 'add_strike' THEN 1 ELSE -1 END);
      UPDATE public.members SET strikes_used = legacy_count, strikes_count = legacy_count,
        updated_at = clock_timestamp() WHERE id = target.id RETURNING * INTO target;
    END IF;
  ELSIF activation IS NOT NULL AND NOT already_recorded THEN
    SELECT * INTO STRICT target FROM public.members WHERE id = p_member_id;
  END IF;

  IF p_action = 'remove_strike' THEN
    SELECT COALESCE(details @> '{"balance_reconciliation_required":true}'::jsonb, false)
      INTO STRICT reconciliation_required FROM public.strike_moderator_corrections WHERE id = correction_id;
  END IF;
  -- A retry can arrive after a timezone change makes its saved month unavailable.
  RETURN public.staff_strike_month(target, least(cycle_month, current_month))
    || jsonb_build_object('success', true, 'correction_id', correction_id,
      'balance_reconciliation_required', reconciliation_required);
END;
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
    IF passes >= 3 THEN RAISE EXCEPTION 'You have used all 3 Metastrikes for this month.'; END IF;
    passes := passes + 1;
    IF nightly.record_type = 'strike' AND nightly.updated_at >= p_month_start THEN
      strikes := greatest(0, strikes - 1);
    END IF;
  ELSIF p_type = 'clear' THEN
    IF nightly.updated_at >= p_month_start THEN
      IF nightly.record_type = 'strike' THEN strikes := greatest(0, strikes - 1); END IF;
      IF nightly.record_type = 'metastrike' THEN passes := greatest(0, passes - 1); END IF;
    END IF;
  ELSE
    RAISE EXCEPTION 'Invalid nightly record type.';
  END IF;

  IF p_type = 'clear' THEN
    DELETE FROM public.nightly_strike_logs WHERE id = nightly.id;
  ELSE
    INSERT INTO public.nightly_strike_logs (target_member_id, sleep_cycle_date, record_type, reason, created_at, updated_at,
      legacy_strike_charge_month)
      VALUES (m.id, p_cycle, p_type, p_reason, p_now, p_now,
        CASE WHEN p_type = 'strike' THEN (p_month || '-01')::date END)
      ON CONFLICT (target_member_id, sleep_cycle_date) DO UPDATE
      SET record_type = excluded.record_type, reason = excluded.reason, updated_at = excluded.updated_at,
        legacy_strike_charge_month = excluded.legacy_strike_charge_month
      RETURNING * INTO nightly;
  END IF;
  UPDATE public.members SET strikes_used = strikes, strikes_count = strikes,
    metastrikes_used = passes, metastrikes_count = passes,
    strike_cycle_month = p_month, updated_at = p_now WHERE id = m.id;
  RETURN jsonb_build_object('log', to_jsonb(nightly), 'strikesUsed', strikes, 'metastrikesUsed', passes);
END;
$$;

CREATE OR REPLACE FUNCTION public.strike_history_month(
  m public.members, p_month date
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  zone text;
  entries jsonb;
BEGIN
  IF p_month IS NULL OR extract(day FROM p_month) <> 1 THEN
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'Choose a month in YYYY-MM format.';
  END IF;

  zone := CASE WHEN m.pending_effective_at <= statement_timestamp()
    THEN COALESCE(NULLIF(m.pending_timezone, ''), m.timezone) ELSE m.timezone END;

  WITH verified AS MATERIALIZED (
    SELECT * FROM public.verified_monthly_strikes(m, p_month)
  ), monthly_entries AS (
    SELECT h.source_id, h.cycle_date, h.record_type, 'nightly'::text AS source_type,
      h.issued_at, h.issuance_timezone, NULL::timestamptz AS recorded_at,
      h.changed_at, v.replacement_until, v.source_id IS NOT NULL AS counts,
      CASE WHEN h.record_type = 'metastrike' AND h.change_type IS NULL THEN 'protected'
        WHEN h.record_type = 'metastrike' THEN 'reversed'
        WHEN v.source_id IS NOT NULL THEN 'counted'
        ELSE COALESCE(h.change_type, 'removed') END AS status,
      EXISTS (SELECT FROM public.nightly_strike_history AS strike
        WHERE strike.source_id = h.source_id AND strike.record_type = 'strike'
          AND strike.change_type = 'replaced') AS replaced_strike
    FROM public.nightly_strike_history AS h
    LEFT JOIN verified AS v ON h.record_type = 'strike'
      AND v.source_type = 'nightly' AND v.source_id = h.source_id
    WHERE h.member_id = m.id AND h.cycle_date >= p_month AND h.cycle_date < p_month + interval '1 month'

    UNION ALL

    SELECT c.id, c.cycle_date, 'strike', 'moderator', NULL, NULL, c.recorded_at,
      removal.recorded_at, NULL, v.source_id IS NOT NULL,
      CASE WHEN v.source_id IS NOT NULL THEN 'counted' ELSE 'removed' END, false
    FROM public.strike_moderator_corrections AS c
    LEFT JOIN public.strike_moderator_corrections AS removal
      ON removal.action = 'void_adjustment' AND removal.source_id = c.id
    LEFT JOIN verified AS v ON v.source_type = 'moderator' AND v.source_id = c.id
    WHERE c.member_id = m.id AND c.action = 'add_strike'
      AND c.cycle_date >= p_month AND c.cycle_date < p_month + interval '1 month'
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.cycle_date DESC,
    COALESCE(e.issued_at, e.recorded_at, e.changed_at), e.record_type DESC, e.source_id), '[]')
    INTO entries FROM monthly_entries AS e;

  RETURN jsonb_build_object('month', to_char(p_month, 'YYYY-MM'), 'timezone', zone, 'entries', entries);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_member_strike_history(
  p_member_id uuid, p_discord_id text, p_month date
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m public.members;
BEGIN
  SELECT * INTO m FROM public.members
  WHERE id = p_member_id AND discord_id = p_discord_id AND is_active;
  IF NOT FOUND THEN
    RAISE SQLSTATE 'PT403' USING MESSAGE = 'Sign in with the Discord account linked to this profile.';
  END IF;
  RETURN public.strike_history_month(m, p_month);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_profile_strike_history(
  p_viewer_id uuid, p_viewer_discord_id text, p_member_id uuid, p_month date
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  target public.members;
  history jsonb;
  entries jsonb;
BEGIN
  IF NOT EXISTS (SELECT FROM public.members
    WHERE id = p_viewer_id AND discord_id = p_viewer_discord_id AND is_active) THEN
    RAISE SQLSTATE 'PT403' USING MESSAGE = 'Sign in with the Discord account linked to your profile.';
  END IF;
  SELECT * INTO target FROM public.members WHERE id = p_member_id AND is_active;
  IF NOT FOUND THEN RAISE SQLSTATE 'PT404' USING MESSAGE = 'Member not found.'; END IF;

  history := public.strike_history_month(target, p_month);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'cycle_date', entry->'cycle_date', 'record_type', entry->'record_type', 'source_type', entry->'source_type',
    'issued_at', entry->'issued_at', 'issuance_timezone', entry->'issuance_timezone', 'recorded_at', entry->'recorded_at',
    'changed_at', entry->'changed_at', 'counts', entry->'counts', 'status', entry->'status',
    'replaced_strike', entry->'replaced_strike') ORDER BY position), '[]'::jsonb)
    INTO entries FROM jsonb_array_elements(history->'entries') WITH ORDINALITY AS items(entry, position);
  RETURN jsonb_build_object('month', history->'month', 'timezone', history->'timezone', 'entries', entries);
END;
$$;

REVOKE ALL ON FUNCTION public.strike_history_month(public.members,date) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_profile_strike_history(uuid,text,uuid,date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_profile_strike_history(uuid,text,uuid,date) TO service_role;

COMMIT;
