-- Review and correct dated strikes from the roster independently of punishment tasks.
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

  RETURN jsonb_build_object('month', to_char(selected_month, 'YYYY-MM'),
    'current_month', to_char(current_month, 'YYYY-MM'), 'latest_cycle_date', local_day,
    'verified_strikes', sources, 'strikes_used', jsonb_array_length(sources),
    'open_count', public.count_open_punishments(m.id));
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
  SELECT * INTO target FROM public.members WHERE id = p_member_id;
  IF NOT FOUND THEN RAISE SQLSTATE 'PT404' USING MESSAGE = 'Member not found.'; END IF;
  IF target.id = p_actor_id OR target.role = 'owner' OR (actor_role = 'moderator' AND target.role <> 'member') THEN
    RAISE SQLSTATE 'PT403' USING MESSAGE = 'You cannot manage this profile.';
  END IF;
  PERFORM public.require_punishment_visibility();
  RETURN public.staff_strike_month(target, p_month);
END;
$$;

CREATE OR REPLACE FUNCTION public.moderate_dated_strike(
  p_actor_id uuid, p_actor_discord_id text, p_member_id uuid, p_action text,
  p_cycle date, p_source uuid, p_reason text, p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  target public.members;
  correction_id uuid;
  evidence text := 'roster:' || p_request_id;
BEGIN
  IF p_cycle IS NULL OR p_request_id IS NULL OR p_action IS NULL
    OR p_action NOT IN ('add_strike', 'remove_strike')
    OR (p_action = 'remove_strike') <> (p_source IS NOT NULL)
    OR nullif(btrim(p_reason), '') IS NULL OR length(btrim(p_reason)) > 500 THEN
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'Enter a cycle date, reason and request ID. Removal requires a strike source.';
  END IF;

  PERFORM FROM public.punishment_rollout WHERE singleton FOR SHARE;
  target := public.lock_moderation_target(p_actor_id, p_actor_discord_id, p_member_id);
  PERFORM public.require_punishment_visibility();

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
  RETURN public.staff_strike_month(target, date_trunc('month', p_cycle::timestamp)::date)
    || jsonb_build_object('success', true, 'correction_id', correction_id);
END;
$$;

-- Preserve pass balance edits for older clients. Strike counters now require
-- dated evidence even if an older app instance sends a generic edit.
CREATE OR REPLACE FUNCTION public.moderate_strike_counts(
  p_actor_id uuid, p_actor_discord_id text, p_member_id uuid, p_strikes integer, p_passes integer, p_relative boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM FROM public.punishment_rollout WHERE singleton FOR SHARE;
  PERFORM public.lock_moderation_target(p_actor_id, p_actor_discord_id, p_member_id, true);
  IF p_strikes IS NOT NULL AND (p_relative IS DISTINCT FROM true OR p_strikes <> 0) THEN
    RAISE SQLSTATE 'PT409' USING MESSAGE = 'Use Review strikes to make a dated strike correction.';
  END IF;
  RETURN public.adjust_member_strikes(p_member_id, NULL, p_passes, p_relative,
    p_actor_id::text, 'Moderator pass balance correction');
END;
$$;

CREATE OR REPLACE FUNCTION public.moderate_nightly_strike(
  p_actor_id uuid, p_actor_discord_id text, p_member_id uuid, p_cycle text, p_month text,
  p_previous_type text, p_type text, p_reason text, p_now timestamptz, p_month_start timestamptz,
  p_strike_cutoff timestamptz, p_replacement_until timestamptz, p_schedule_revision integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  target public.members;
BEGIN
  IF p_type IS NULL OR p_type NOT IN ('clear', 'metastrike') THEN
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'Unsupported staff strike action.';
  END IF;
  PERFORM FROM public.punishment_rollout WHERE singleton FOR SHARE;
  target := public.lock_moderation_target(p_actor_id, p_actor_discord_id, p_member_id, p_type = 'clear');
  IF p_type = 'clear' AND p_previous_type IS DISTINCT FROM 'metastrike' THEN
    RAISE SQLSTATE 'PT409' USING MESSAGE = 'Use Review strikes to remove a dated strike.';
  END IF;
  IF p_type = 'metastrike' AND NOT target.is_active THEN
    RAISE SQLSTATE 'PT403' USING MESSAGE = 'This profile is inactive.';
  END IF;
  RETURN public.apply_nightly_strike(p_member_id, p_cycle, p_month, p_previous_type, p_type,
    p_reason, p_now, p_month_start, p_strike_cutoff, p_replacement_until, p_actor_id::text, p_schedule_revision);
END;
$$;

REVOKE ALL ON FUNCTION public.staff_strike_month(public.members,date),
  public.adjust_member_strikes(uuid,integer,integer,boolean,text,text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.read_moderation_strike_month(uuid,text,uuid,date),
  public.moderate_dated_strike(uuid,text,uuid,text,date,uuid,text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_moderation_strike_month(uuid,text,uuid,date),
  public.moderate_dated_strike(uuid,text,uuid,text,date,uuid,text,uuid) TO service_role;

COMMIT;
