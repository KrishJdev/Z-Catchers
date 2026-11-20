-- Keep receipts that arrived after the worker read the expired lease.
CREATE OR REPLACE FUNCTION public.renew_cron_lease(
  p_key text, p_previous_locked_at timestamptz, p_locked_at timestamptz,
  p_expires_at timestamptz, p_metadata jsonb
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  UPDATE public.cron_locks AS lease SET
    locked_at = p_locked_at,
    expires_at = p_expires_at,
    metadata = p_metadata || jsonb_build_object('delivered_sub_ids', (
      SELECT coalesce(jsonb_agg(DISTINCT receipt), '[]'::jsonb)
      FROM jsonb_array_elements(
        coalesce(lease.metadata->'delivered_sub_ids', '[]'::jsonb) ||
        coalesce(p_metadata->'delivered_sub_ids', '[]'::jsonb)
      ) AS receipts(receipt)
    ))
  WHERE lease.lock_key = p_key AND lease.locked_at = p_previous_locked_at
    AND lease.expires_at <= p_locked_at AND lease.expires_at <= clock_timestamp()
    AND lease.metadata->'completed' IS DISTINCT FROM 'true'::jsonb
  RETURNING lease.metadata;
$$;
REVOKE ALL ON FUNCTION public.renew_cron_lease(text,timestamptz,timestamptz,timestamptz,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.renew_cron_lease(text,timestamptz,timestamptz,timestamptz,jsonb) TO service_role;

-- Seal the captured lease and write its audit in the same transaction.
CREATE OR REPLACE FUNCTION public.complete_cron_stage(
  p_key text, p_locked_at timestamptz, p_metadata jsonb
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  completed_at timestamptz;
  stage text;
  cycle text;
  target_id uuid;
BEGIN
  PERFORM FROM public.cron_locks
    WHERE lock_key = p_key AND locked_at = p_locked_at FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  completed_at := clock_timestamp();

  UPDATE public.cron_locks SET
    expires_at = completed_at + interval '24 hours',
    metadata = metadata || p_metadata || jsonb_build_object(
      'completed', true, 'state', 'completed', 'completed_at', completed_at
    )
    WHERE lock_key = p_key AND locked_at = p_locked_at AND expires_at > completed_at
      AND metadata->'completed' IS DISTINCT FROM 'true'::jsonb
    RETURNING metadata->>'stage', metadata->>'local_date', (metadata->>'member_id')::uuid
    INTO stage, cycle, target_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF stage IS NULL OR stage NOT IN ('WIND_DOWN_30M', 'BEDTIME_HIT', 'AUTO_BEDTIME_STRIKE') THEN
    RAISE EXCEPTION 'Invalid notification stage.';
  END IF;

  INSERT INTO public.notification_logs(member_id, notification_type, local_date, dispatched_at)
    VALUES (target_id, stage, cycle::date, completed_at)
    ON CONFLICT (member_id, notification_type, local_date) DO NOTHING;

  IF stage <> 'AUTO_BEDTIME_STRIKE' AND p_metadata->>'delivery_outcome' = 'complete' THEN
    UPDATE public.members SET last_notified_stage = stage, last_notified_cycle_date = cycle
      WHERE id = target_id AND (
        last_notified_cycle_date IS NULL OR last_notified_cycle_date < cycle OR
        (last_notified_cycle_date = cycle AND
          last_notified_stage IS DISTINCT FROM 'IN_BED_EARLY' AND
          (stage = 'BEDTIME_HIT' OR last_notified_stage IS DISTINCT FROM 'BEDTIME_HIT'))
      );
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_cron_stage(text,timestamptz,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_cron_stage(text,timestamptz,jsonb) TO service_role;
