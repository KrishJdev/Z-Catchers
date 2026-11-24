-- Enable roster strike corrections and shared calendar history independently of punishment visibility.
BEGIN;

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
  already_recorded boolean;
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

  -- The legacy dispatcher still uses the compatibility counters. Apply each
  -- current-month correction once without deriving a balance from incomplete history.
  IF activation IS NULL AND NOT already_recorded THEN
    current_month := public.punishment_progress_month(target, statement_timestamp());
    IF cycle_month = current_month THEN
      IF target.strike_cycle_month < to_char(current_month, 'YYYY-MM') THEN
        PERFORM public.refresh_member_strike_projection(target.id, statement_timestamp());
        SELECT * INTO target FROM public.members WHERE id = p_member_id;
      END IF;
      IF target.strike_cycle_month = to_char(current_month, 'YYYY-MM') THEN
        legacy_count := greatest(0, greatest(target.strikes_used, target.strikes_count)
          + CASE WHEN p_action = 'add_strike' THEN 1 ELSE -1 END);
        UPDATE public.members SET strikes_used = legacy_count, strikes_count = legacy_count,
          updated_at = clock_timestamp() WHERE id = target.id RETURNING * INTO target;
      END IF;
    END IF;
  END IF;

  RETURN public.staff_strike_month(target, cycle_month)
    || jsonb_build_object('success', true, 'correction_id', correction_id);
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
    INSERT INTO public.nightly_strike_logs (target_member_id, sleep_cycle_date, record_type, reason, created_at, updated_at)
      VALUES (m.id, p_cycle, p_type, p_reason, p_now, p_now)
      ON CONFLICT (target_member_id, sleep_cycle_date) DO UPDATE
      SET record_type = excluded.record_type, reason = excluded.reason, updated_at = excluded.updated_at
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
