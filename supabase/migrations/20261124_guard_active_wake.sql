-- Complete a specific open check-in atomically with its history and wake marker.
BEGIN;

CREATE OR REPLACE FUNCTION public.complete_active_check_in(
  p_discord_id text, p_expected_in_bed_at timestamptz, p_entry jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  entry public.sleep_logs := jsonb_populate_record(NULL::public.sleep_logs, p_entry);
  member public.members;
  saved public.sleep_logs;
  checked_in_at timestamptz;
BEGIN
  SELECT * INTO member FROM public.members WHERE id = entry.member_id FOR UPDATE;
  IF NOT FOUND OR NOT member.is_active OR member.discord_id IS DISTINCT FROM p_discord_id THEN
    RAISE SQLSTATE 'PT403' USING MESSAGE = 'This profile is no longer available.';
  END IF;

  SELECT * INTO saved FROM public.sleep_logs
    WHERE member_id = member.id AND cycle_date = entry.cycle_date;
  SELECT dispatched_at INTO checked_in_at FROM public.notification_logs
    WHERE member_id = member.id AND local_date = entry.cycle_date::date AND notification_type = 'IN_BED_EARLY';
  checked_in_at := COALESCE(checked_in_at, saved.in_bed_at);

  IF (checked_in_at IS NULL AND NOT COALESCE(
      member.last_notified_stage = 'IN_BED_EARLY' AND member.last_notified_cycle_date = entry.cycle_date, false))
    OR (member.last_notified_stage = 'IN_BED_EARLY' AND member.last_notified_cycle_date IS DISTINCT FROM entry.cycle_date)
    OR member.last_wake_cycle_date = entry.cycle_date
    OR checked_in_at IS DISTINCT FROM p_expected_in_bed_at
    OR (saved.in_bed_at IS NOT NULL AND saved.in_bed_at IS DISTINCT FROM checked_in_at)
    OR saved.woke_up_at IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.notification_logs
      WHERE member_id = member.id AND local_date = entry.cycle_date::date AND notification_type = 'WOKE_UP')
  THEN
    RAISE SQLSTATE 'PT409' USING MESSAGE = 'This check-in changed. Refresh and try again.';
  END IF;

  INSERT INTO public.sleep_logs AS log (
    member_id, cycle_date, timezone, target_bedtime, target_wake_time, in_bed_at, in_bed_local_time,
    woke_up_at, woke_up_local_time, wake_source, duration_minutes, status
  ) VALUES (
    member.id, entry.cycle_date, entry.timezone, entry.target_bedtime, entry.target_wake_time,
    checked_in_at, entry.in_bed_local_time, entry.woke_up_at, entry.woke_up_local_time,
    entry.wake_source, entry.duration_minutes, entry.status
  )
  ON CONFLICT (member_id, cycle_date) DO UPDATE SET
    in_bed_at = EXCLUDED.in_bed_at, in_bed_local_time = EXCLUDED.in_bed_local_time,
    woke_up_at = EXCLUDED.woke_up_at, woke_up_local_time = EXCLUDED.woke_up_local_time,
    wake_source = EXCLUDED.wake_source, duration_minutes = EXCLUDED.duration_minutes,
    updated_at = statement_timestamp()
  RETURNING * INTO saved;

  UPDATE public.members SET last_woke_up_at = entry.woke_up_at, last_wake_cycle_date = entry.cycle_date,
    last_notified_stage = CASE WHEN last_notified_stage = 'IN_BED_EARLY' THEN NULL ELSE last_notified_stage END,
    updated_at = statement_timestamp()
    WHERE id = member.id RETURNING * INTO member;

  INSERT INTO public.notification_logs (member_id, notification_type, local_date)
    VALUES (member.id, 'WOKE_UP', entry.cycle_date::date);

  RETURN jsonb_build_object('member', to_jsonb(member), 'sleep_log', to_jsonb(saved));
END;
$$;

REVOKE ALL ON FUNCTION public.complete_active_check_in(text,timestamptz,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_active_check_in(text,timestamptz,jsonb) TO service_role;

COMMIT;
