-- Some deployed databases predate the durable dispatcher lock and nightly ledger.
CREATE TABLE IF NOT EXISTS public.cron_locks (
  lock_key text PRIMARY KEY,
  locked_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_cron_locks_expires_at ON public.cron_locks (expires_at);
ALTER TABLE public.cron_locks ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cron_locks TO service_role;

CREATE TABLE IF NOT EXISTS public.nightly_strike_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  sleep_cycle_date text NOT NULL,
  record_type text NOT NULL CHECK (record_type IN ('pending_vote', 'strike', 'metastrike')),
  voter_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (target_member_id, sleep_cycle_date)
);
ALTER TABLE public.nightly_strike_logs ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nightly_strike_logs TO service_role;

-- Older member schemas may have just one name for each monthly counter.
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS strikes_used integer NOT NULL DEFAULT 0 CHECK (strikes_used BETWEEN 0 AND 3),
  ADD COLUMN IF NOT EXISTS strikes_count integer NOT NULL DEFAULT 0 CHECK (strikes_count BETWEEN 0 AND 3),
  ADD COLUMN IF NOT EXISTS metastrikes_used integer NOT NULL DEFAULT 0 CHECK (metastrikes_used BETWEEN 0 AND 3),
  ADD COLUMN IF NOT EXISTS metastrikes_count integer NOT NULL DEFAULT 0 CHECK (metastrikes_count BETWEEN 0 AND 3);

-- The roster API projects public member fields. Subscription writes require authentication.
DROP POLICY IF EXISTS "Public can view active members" ON public.members;
DROP POLICY IF EXISTS "Public can register push subscriptions" ON public.push_subscriptions;

-- Commit the nightly record and both counter aliases in one transaction.
-- A stale caller must re-read the member and the cycle before trying again.
CREATE OR REPLACE FUNCTION public.apply_nightly_strike(
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
REVOKE ALL ON FUNCTION public.apply_nightly_strike(uuid,text,text,text,text,text,timestamptz,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_nightly_strike(uuid,text,text,text,text,text,timestamptz,timestamptz) TO service_role;

-- Claim one manual nag per sender, target, stage and 15-minute interval.
CREATE OR REPLACE FUNCTION public.claim_manual_nag(
  p_member_id uuid, p_type text, p_cycle date, p_now timestamptz
) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  previous_at timestamptz;
BEGIN
  INSERT INTO public.notification_logs(member_id, notification_type, local_date, dispatched_at)
    VALUES (p_member_id, p_type, p_cycle, p_now)
    ON CONFLICT (member_id, notification_type, local_date) DO UPDATE
    SET dispatched_at = excluded.dispatched_at
    WHERE notification_logs.dispatched_at <= p_now - interval '15 minutes';
  IF FOUND THEN RETURN 0; END IF;

  SELECT dispatched_at INTO previous_at FROM public.notification_logs
    WHERE member_id = p_member_id AND notification_type = p_type AND local_date = p_cycle;
  RETURN greatest(1, ceil(extract(epoch FROM previous_at + interval '15 minutes' - p_now))::integer);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_manual_nag(uuid,text,date,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_manual_nag(uuid,text,date,timestamptz) TO service_role;
