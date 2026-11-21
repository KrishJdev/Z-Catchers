-- Bind staff writes to the signed Discord actor and the live target in one transaction.
BEGIN;

DROP FUNCTION IF EXISTS public.reserve_moderator_passcode_attempt(text, timestamptz);

CREATE TABLE IF NOT EXISTS public.moderation_actions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid NOT NULL,
  target_id uuid,
  action text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
ALTER TABLE public.moderation_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.moderation_actions FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.lock_moderation_actor(p_actor_id uuid, p_actor_discord_id text, p_owner_only boolean)
RETURNS text LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  actor_role text;
BEGIN
  SELECT role INTO actor_role FROM public.members
    WHERE id = p_actor_id AND discord_id = p_actor_discord_id AND is_active FOR SHARE;
  IF actor_role IS NULL OR actor_role NOT IN ('owner', 'moderator') OR (p_owner_only AND actor_role <> 'owner') THEN
    RAISE SQLSTATE 'PT403' USING MESSAGE = 'Your staff access has changed.';
  END IF;
  RETURN actor_role;
END;
$$;

CREATE OR REPLACE FUNCTION public.lock_moderation_target(
  p_actor_id uuid, p_actor_discord_id text, p_target_id uuid, p_owner_only boolean DEFAULT false
) RETURNS public.members LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  actor_role text;
  target public.members;
BEGIN
  actor_role := public.lock_moderation_actor(p_actor_id, p_actor_discord_id, p_owner_only);
  IF p_target_id = p_actor_id THEN
    RAISE SQLSTATE 'PT403' USING MESSAGE = 'Use self-service for your own profile.';
  END IF;
  SELECT * INTO target FROM public.members WHERE id = p_target_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE SQLSTATE 'PT404' USING MESSAGE = 'Member not found.';
  END IF;
  IF target.role = 'owner' OR (actor_role = 'moderator' AND target.role <> 'member') THEN
    RAISE SQLSTATE 'PT403' USING MESSAGE = 'You cannot manage this profile.';
  END IF;
  RETURN target;
END;
$$;

CREATE OR REPLACE FUNCTION public.moderate_roster_member(
  p_actor_id uuid, p_actor_discord_id text, p_target_id uuid, p_action text,
  p_updates jsonb DEFAULT '{}', p_expected_updated_at timestamptz DEFAULT NULL,
  p_expected_pending jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m public.members;
  reviewed public.members;
  edited public.members;
BEGIN
  m := public.lock_moderation_target(p_actor_id, p_actor_discord_id, p_target_id,
    p_action IN ('toggle_active', 'delete_member'));
  IF p_action = 'delete_member' THEN
    DELETE FROM public.members WHERE id = m.id;
  ELSIF p_action = 'toggle_active' THEN
    UPDATE public.members SET is_active = (p_updates->>'is_active')::boolean,
      updated_at = statement_timestamp() WHERE id = m.id RETURNING * INTO m;
  ELSIF p_action IN ('approve_cooldown', 'cancel_cooldown') THEN
    IF p_action = 'approve_cooldown' OR p_expected_pending IS NOT NULL THEN
      reviewed := jsonb_populate_record(NULL::public.members, p_expected_pending);
      IF (p_action = 'approve_cooldown' AND m.pending_effective_at IS NULL) OR
        ROW(m.pending_effective_at, m.pending_bedtime_local, m.pending_wake_time_local, m.pending_timezone,
          m.pending_weekend_bedtime_local, m.pending_weekend_wake_time_local, m.pending_weekly_schedule)
        IS DISTINCT FROM
        ROW(reviewed.pending_effective_at, reviewed.pending_bedtime_local, reviewed.pending_wake_time_local,
          reviewed.pending_timezone, reviewed.pending_weekend_bedtime_local, reviewed.pending_weekend_wake_time_local,
          reviewed.pending_weekly_schedule)
      THEN
        RAISE SQLSTATE 'PT409' USING MESSAGE = 'The pending schedule changed. Refresh and review it again.';
      END IF;
    END IF;
    IF p_action = 'approve_cooldown' THEN
      m.bedtime_local := COALESCE(m.pending_bedtime_local, m.bedtime_local);
      m.wake_time_local := COALESCE(m.pending_wake_time_local, m.wake_time_local);
      m.timezone := COALESCE(m.pending_timezone, m.timezone);
      m.weekend_bedtime_local := m.pending_weekend_bedtime_local;
      m.weekend_wake_time_local := m.pending_weekend_wake_time_local;
      m.weekly_schedule := COALESCE(m.pending_weekly_schedule, m.weekly_schedule);
    END IF;
    UPDATE public.members SET bedtime_local = m.bedtime_local, wake_time_local = m.wake_time_local,
      timezone = m.timezone, weekend_bedtime_local = m.weekend_bedtime_local,
      weekend_wake_time_local = m.weekend_wake_time_local, weekly_schedule = m.weekly_schedule,
      pending_bedtime_local = NULL, pending_wake_time_local = NULL, pending_timezone = NULL,
      pending_weekend_bedtime_local = NULL, pending_weekend_wake_time_local = NULL,
      pending_weekly_schedule = NULL, pending_effective_at = NULL, updated_at = statement_timestamp()
      WHERE id = m.id RETURNING * INTO m;
  ELSIF p_action IN ('edit_member', 'edit_schedule') THEN
    IF m.updated_at IS DISTINCT FROM p_expected_updated_at THEN
      RAISE SQLSTATE 'PT409' USING MESSAGE = 'The profile changed. Refresh the roster and try again.';
    END IF;
    edited := jsonb_populate_record(m, CASE WHEN p_action = 'edit_schedule' THEN p_updates
      ELSE p_updates - ARRAY['bedtime_local', 'wake_time_local', 'timezone', 'weekend_bedtime_local',
        'weekend_wake_time_local', 'weekly_schedule', 'pending_bedtime_local', 'pending_wake_time_local',
        'pending_timezone', 'pending_weekend_bedtime_local', 'pending_weekend_wake_time_local',
        'pending_weekly_schedule', 'pending_effective_at'] END);
    UPDATE public.members SET discord_username = edited.discord_username, discord_handle = edited.discord_handle,
      journal_url = edited.journal_url, bedtime_local = edited.bedtime_local, wake_time_local = edited.wake_time_local,
      timezone = edited.timezone, weekend_bedtime_local = edited.weekend_bedtime_local,
      weekend_wake_time_local = edited.weekend_wake_time_local, weekly_schedule = edited.weekly_schedule,
      pending_bedtime_local = edited.pending_bedtime_local, pending_wake_time_local = edited.pending_wake_time_local,
      pending_timezone = edited.pending_timezone, pending_weekend_bedtime_local = edited.pending_weekend_bedtime_local,
      pending_weekend_wake_time_local = edited.pending_weekend_wake_time_local, pending_weekly_schedule = edited.pending_weekly_schedule,
      pending_effective_at = edited.pending_effective_at, updated_at = statement_timestamp()
      WHERE id = m.id RETURNING * INTO m;
  ELSE
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'Unknown roster action.';
  END IF;

  INSERT INTO public.moderation_actions(actor_id, target_id, action) VALUES (p_actor_id, p_target_id, p_action);
  RETURN to_jsonb(m);
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_moderation_demo_members(
  p_actor_id uuid, p_actor_discord_id text, p_profiles jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  purged jsonb;
BEGIN
  PERFORM public.lock_moderation_actor(p_actor_id, p_actor_discord_id, true);
  WITH removed AS (
    DELETE FROM public.members AS m
    USING jsonb_to_recordset(p_profiles) AS demo(id uuid, discord_username text, discord_handle text, journal_url text)
    WHERE m.id = demo.id AND m.role <> 'owner' AND m.discord_id IS NULL
      AND (m.discord_username, m.discord_handle, m.journal_url)
        IS NOT DISTINCT FROM (demo.discord_username, demo.discord_handle, demo.journal_url)
    RETURNING m.id, m.discord_username
  ), audited AS (
    INSERT INTO public.moderation_actions(actor_id, target_id, action)
      SELECT p_actor_id, id, 'purge_seed_member' FROM removed
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(removed)), '[]'::jsonb) INTO purged FROM removed;
  RETURN purged;
END;
$$;

CREATE OR REPLACE FUNCTION public.read_moderation_punishments(
  p_actor_id uuid, p_actor_discord_id text, p_id uuid, p_status text, p_offset integer
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor_role text;
  target public.members;
  items jsonb;
BEGIN
  SELECT role INTO actor_role FROM public.members
    WHERE id = p_actor_id AND discord_id = p_actor_discord_id AND is_active;
  IF actor_role IS NULL OR actor_role NOT IN ('owner', 'moderator') THEN
    RAISE SQLSTATE 'PT403' USING MESSAGE = 'Your staff access has changed.';
  END IF;
  PERFORM public.require_punishment_visibility();
  IF p_id IS NOT NULL THEN
    SELECT m.* INTO target FROM public.members AS m
      JOIN public.punishment_task_status AS p ON p.member_id = m.id WHERE p.id = p_id;
    IF NOT FOUND THEN RAISE SQLSTATE 'PT404' USING MESSAGE = 'Punishment not found.'; END IF;
    IF target.id = p_actor_id OR target.role = 'owner' OR (actor_role = 'moderator' AND target.role <> 'member') THEN
      RAISE SQLSTATE 'PT403' USING MESSAGE = 'You cannot manage this profile.';
    END IF;
    RETURN public.get_moderator_punishments(p_id, p_status, p_offset);
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('awaiting_assignment', 'assigned', 'pending')
    OR p_offset IS NULL OR p_offset < 0 OR p_offset > 2147483597 THEN
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'Invalid punishment queue filter.';
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(p) - 'effective_status'
    || jsonb_build_object('status', p.effective_status) ORDER BY earned_cycle_date, id), '[]') INTO items
  FROM (
    SELECT p.*, m.discord_username AS member_name FROM public.punishment_task_status AS p
      JOIN public.members AS m ON m.id = p.member_id
      WHERE p.effective_status = p_status AND m.id <> p_actor_id
        AND (m.role = 'member' OR (actor_role = 'owner' AND m.role = 'moderator'))
      ORDER BY p.earned_cycle_date, p.id LIMIT 51 OFFSET p_offset
  ) AS p;
  RETURN CASE WHEN jsonb_array_length(items) > 50
    THEN jsonb_build_object('items', items - 50, 'next_offset', p_offset + 50)
    ELSE jsonb_build_object('items', items, 'next_offset', NULL) END;
END;
$$;

CREATE OR REPLACE FUNCTION public.moderate_punishment(
  p_actor_id uuid, p_actor_discord_id text, p_id uuid, p_action text, p_title text DEFAULT NULL,
  p_instructions text DEFAULT NULL, p_cycle date DEFAULT NULL, p_source uuid DEFAULT NULL,
  p_reason text DEFAULT NULL, p_request_id uuid DEFAULT NULL
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
    p_cycle, p_source, p_reason, p_request_id);
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
  IF p_type NOT IN ('clear', 'metastrike') THEN
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'Unsupported staff strike action.';
  END IF;
  PERFORM FROM public.punishment_rollout WHERE singleton FOR SHARE;
  target := public.lock_moderation_target(p_actor_id, p_actor_discord_id, p_member_id, p_type = 'clear');
  IF p_type = 'metastrike' AND NOT target.is_active THEN
    RAISE SQLSTATE 'PT403' USING MESSAGE = 'This profile is inactive.';
  END IF;
  RETURN public.apply_nightly_strike(p_member_id, p_cycle, p_month, p_previous_type, p_type,
    p_reason, p_now, p_month_start, p_strike_cutoff, p_replacement_until, p_actor_id::text, p_schedule_revision);
END;
$$;

CREATE OR REPLACE FUNCTION public.moderate_strike_counts(
  p_actor_id uuid, p_actor_discord_id text, p_member_id uuid, p_strikes integer, p_passes integer, p_relative boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM FROM public.punishment_rollout WHERE singleton FOR SHARE;
  PERFORM public.lock_moderation_target(p_actor_id, p_actor_discord_id, p_member_id, true);
  RETURN public.adjust_member_strikes(p_member_id, p_strikes, p_passes, p_relative, p_actor_id::text, 'Moderator count correction');
END;
$$;

CREATE OR REPLACE FUNCTION public.moderate_sleep(
  p_actor_id uuid, p_actor_discord_id text, p_target_id uuid, p_action text, p_cycle date, p_now timestamptz,
  p_expected_updated_at timestamptz, p_entry jsonb DEFAULT NULL, p_guarded boolean DEFAULT false,
  p_expected_in_bed_at timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m public.members;
  saved public.sleep_logs;
  entry public.sleep_logs;
  receipt text;
  result jsonb;
BEGIN
  m := public.lock_moderation_target(p_actor_id, p_actor_discord_id, p_target_id);
  IF NOT m.is_active THEN
    RAISE SQLSTATE 'PT403' USING MESSAGE = 'This profile is inactive.';
  END IF;
  IF m.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE SQLSTATE 'PT409' USING MESSAGE = 'This profile changed. Refresh and try again.';
  END IF;

  IF p_guarded AND p_action = 'log_wake' THEN
    result := public.complete_active_check_in(m.discord_id, p_expected_in_bed_at,
      p_entry || jsonb_build_object('member_id', m.id, 'cycle_date', p_cycle::text));
  ELSIF p_action IN ('cancel_checkin', 'cancel_pending_and_checkin') THEN
    DELETE FROM public.notification_logs WHERE member_id = m.id AND local_date = p_cycle
      AND notification_type IN ('IN_BED_EARLY', 'WOKE_UP');
    DELETE FROM public.sleep_logs WHERE member_id = m.id AND cycle_date = p_cycle::text;
    UPDATE public.members SET
      last_notified_stage = CASE WHEN last_notified_stage = 'IN_BED_EARLY' OR last_notified_cycle_date = p_cycle::text
        THEN NULL ELSE last_notified_stage END,
      last_notified_cycle_date = CASE WHEN last_notified_stage = 'IN_BED_EARLY' OR last_notified_cycle_date = p_cycle::text
        THEN NULL ELSE last_notified_cycle_date END,
      last_woke_up_at = CASE WHEN last_wake_cycle_date = p_cycle::text THEN NULL ELSE last_woke_up_at END,
      last_wake_cycle_date = CASE WHEN last_wake_cycle_date = p_cycle::text THEN NULL ELSE last_wake_cycle_date END,
      pending_bedtime_local = CASE WHEN p_action = 'cancel_pending_and_checkin' THEN NULL ELSE pending_bedtime_local END,
      pending_wake_time_local = CASE WHEN p_action = 'cancel_pending_and_checkin' THEN NULL ELSE pending_wake_time_local END,
      pending_timezone = CASE WHEN p_action = 'cancel_pending_and_checkin' THEN NULL ELSE pending_timezone END,
      pending_weekend_bedtime_local = CASE WHEN p_action = 'cancel_pending_and_checkin' THEN NULL ELSE pending_weekend_bedtime_local END,
      pending_weekend_wake_time_local = CASE WHEN p_action = 'cancel_pending_and_checkin' THEN NULL ELSE pending_weekend_wake_time_local END,
      pending_weekly_schedule = CASE WHEN p_action = 'cancel_pending_and_checkin' THEN NULL ELSE pending_weekly_schedule END,
      pending_effective_at = CASE WHEN p_action = 'cancel_pending_and_checkin' THEN NULL ELSE pending_effective_at END,
      updated_at = statement_timestamp()
      WHERE id = m.id RETURNING * INTO m;
    result := jsonb_build_object('member', to_jsonb(m));
  ELSIF p_action IN ('check_in', 'wake_up', 'log_wake') THEN
    SELECT * INTO saved FROM public.sleep_logs WHERE member_id = m.id AND cycle_date = p_cycle::text;
    entry := jsonb_populate_record(saved, p_entry);
    INSERT INTO public.sleep_logs (
      member_id, cycle_date, timezone, target_bedtime, target_wake_time, in_bed_at, in_bed_local_time,
      woke_up_at, woke_up_local_time, wake_source, duration_minutes, status
    ) VALUES (
      m.id, p_cycle::text, m.timezone, entry.target_bedtime, entry.target_wake_time, entry.in_bed_at, entry.in_bed_local_time,
      entry.woke_up_at, entry.woke_up_local_time, entry.wake_source, entry.duration_minutes, COALESCE(entry.status, 'on_time')
    ) ON CONFLICT (member_id, cycle_date) DO UPDATE SET
      timezone = EXCLUDED.timezone, target_bedtime = EXCLUDED.target_bedtime,
      target_wake_time = EXCLUDED.target_wake_time, in_bed_at = EXCLUDED.in_bed_at, in_bed_local_time = EXCLUDED.in_bed_local_time,
      woke_up_at = EXCLUDED.woke_up_at, woke_up_local_time = EXCLUDED.woke_up_local_time, wake_source = EXCLUDED.wake_source,
      duration_minutes = EXCLUDED.duration_minutes, status = EXCLUDED.status, updated_at = statement_timestamp()
    RETURNING * INTO saved;

    receipt := CASE WHEN p_action = 'check_in' THEN 'IN_BED_EARLY' ELSE 'WOKE_UP' END;
    IF p_action <> 'log_wake' THEN
      DELETE FROM public.notification_logs WHERE member_id = m.id AND local_date = p_cycle
        AND notification_type IN ('IN_BED_EARLY', 'WOKE_UP') AND notification_type <> receipt;
    END IF;
    INSERT INTO public.notification_logs (member_id, notification_type, local_date, dispatched_at)
      VALUES (m.id, receipt, p_cycle, p_now)
      ON CONFLICT (member_id, notification_type, local_date) DO UPDATE SET dispatched_at = EXCLUDED.dispatched_at;

    UPDATE public.members SET
      last_notified_stage = CASE WHEN p_action = 'check_in' THEN receipt
        WHEN last_notified_stage = 'IN_BED_EARLY' AND last_notified_cycle_date = p_cycle::text THEN NULL
        ELSE last_notified_stage END,
      last_notified_cycle_date = CASE WHEN p_action = 'check_in' THEN p_cycle::text ELSE last_notified_cycle_date END,
      last_woke_up_at = CASE WHEN p_action = 'check_in' THEN NULL
        WHEN last_woke_up_at IS NULL OR entry.woke_up_at >= last_woke_up_at THEN entry.woke_up_at ELSE last_woke_up_at END,
      last_wake_cycle_date = CASE WHEN p_action = 'check_in' THEN NULL
        WHEN last_woke_up_at IS NULL OR entry.woke_up_at >= last_woke_up_at THEN p_cycle::text ELSE last_wake_cycle_date END,
      updated_at = statement_timestamp()
      WHERE id = m.id RETURNING * INTO m;
    result := jsonb_build_object('member', to_jsonb(m), 'sleep_log', to_jsonb(saved));
  ELSE
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'Unknown sleep correction.';
  END IF;

  INSERT INTO public.moderation_actions(actor_id, target_id, action) VALUES (p_actor_id, p_target_id, p_action);
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_moderation_webhook_action(
  p_actor_id uuid, p_actor_discord_id text, p_action text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.lock_moderation_actor(p_actor_id, p_actor_discord_id, true);
  IF p_action NOT IN ('test', 'digest') THEN
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'Unknown webhook action.';
  END IF;
  INSERT INTO public.moderation_actions(actor_id, action) VALUES (p_actor_id, 'webhook_' || p_action);
END;
$$;

REVOKE ALL ON FUNCTION public.lock_moderation_actor(uuid,text,boolean),
  public.lock_moderation_target(uuid,text,uuid,boolean) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.moderate_roster_member(uuid,text,uuid,text,jsonb,timestamptz,jsonb),
  public.purge_moderation_demo_members(uuid,text,jsonb),
  public.read_moderation_punishments(uuid,text,uuid,text,integer),
  public.moderate_punishment(uuid,text,uuid,text,text,text,date,uuid,text,uuid),
  public.moderate_nightly_strike(uuid,text,uuid,text,text,text,text,text,timestamptz,timestamptz,timestamptz,timestamptz,integer),
  public.moderate_strike_counts(uuid,text,uuid,integer,integer,boolean),
  public.moderate_sleep(uuid,text,uuid,text,date,timestamptz,timestamptz,jsonb,boolean,timestamptz),
  public.record_moderation_webhook_action(uuid,text,text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.moderate_roster_member(uuid,text,uuid,text,jsonb,timestamptz,jsonb),
  public.purge_moderation_demo_members(uuid,text,jsonb),
  public.read_moderation_punishments(uuid,text,uuid,text,integer),
  public.moderate_punishment(uuid,text,uuid,text,text,text,date,uuid,text,uuid),
  public.moderate_nightly_strike(uuid,text,uuid,text,text,text,text,text,timestamptz,timestamptz,timestamptz,timestamptz,integer),
  public.moderate_strike_counts(uuid,text,uuid,integer,integer,boolean),
  public.moderate_sleep(uuid,text,uuid,text,date,timestamptz,timestamptz,jsonb,boolean,timestamptz),
  public.record_moderation_webhook_action(uuid,text,text)
TO service_role;

COMMIT;
