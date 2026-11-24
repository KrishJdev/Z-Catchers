-- Keep private nightly strike and pass history in the same transaction as its source.
BEGIN;

-- Fence existing writers while the trigger and backfill are installed.
SELECT singleton FROM public.punishment_rollout WHERE singleton FOR UPDATE;
LOCK TABLE public.nightly_strike_logs IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE IF NOT EXISTS public.nightly_strike_history (
  source_id uuid NOT NULL,
  record_type text NOT NULL CHECK (record_type IN ('strike', 'metastrike')),
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  cycle_date date NOT NULL,
  issued_at timestamptz,
  issuance_timezone text,
  change_type text CHECK (change_type IN ('replaced', 'removed')),
  changed_at timestamptz,
  PRIMARY KEY (source_id, record_type)
);

CREATE INDEX IF NOT EXISTS idx_nightly_strike_history_month
  ON public.nightly_strike_history(member_id, cycle_date);
ALTER TABLE public.nightly_strike_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nightly_strike_history FROM PUBLIC, anon, authenticated, service_role;

-- Next.js already reads the legacy nightly rows server-side. The shared calendar
-- still gets its sleep statuses, while raw timestamps and reasons require server access.
DROP POLICY IF EXISTS "Public can view nightly strike logs" ON public.nightly_strike_logs;
REVOKE SELECT ON public.nightly_strike_logs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.nightly_strike_logs TO service_role;

CREATE OR REPLACE FUNCTION public.capture_nightly_strike_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  cycle date;
  zone text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.record_type = NEW.record_type THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN
    UPDATE public.nightly_strike_history
    SET change_type = CASE WHEN TG_OP = 'UPDATE' AND NEW.record_type = 'metastrike'
      THEN 'replaced' ELSE 'removed' END,
      changed_at = CASE WHEN TG_OP = 'UPDATE' THEN NEW.updated_at ELSE clock_timestamp() END
    WHERE source_id = OLD.id AND record_type = OLD.record_type AND change_type IS NULL;
  END IF;

  IF TG_OP <> 'DELETE' AND NEW.record_type IN ('strike', 'metastrike') THEN
    cycle := public.strike_cycle_day(NEW.sleep_cycle_date);
    IF cycle IS NULL THEN RETURN NULL; END IF;
    SELECT CASE WHEN m.pending_effective_at <= NEW.updated_at
      THEN COALESCE(NULLIF(m.pending_timezone, ''), m.timezone) ELSE m.timezone END
      INTO zone FROM public.members AS m WHERE m.id = NEW.target_member_id;

    INSERT INTO public.nightly_strike_history
      (source_id, record_type, member_id, cycle_date, issued_at, issuance_timezone)
    VALUES (NEW.id, NEW.record_type, NEW.target_member_id, cycle, NEW.updated_at, zone)
    ON CONFLICT (source_id, record_type) DO NOTHING;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.capture_nightly_strike_history()
  FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS capture_nightly_strike_history ON public.nightly_strike_logs;
CREATE TRIGGER capture_nightly_strike_history
  AFTER INSERT OR UPDATE OF record_type OR DELETE ON public.nightly_strike_logs
  FOR EACH ROW EXECUTE FUNCTION public.capture_nightly_strike_history();

-- Prefer a live source over snapshots. A legacy row's creation timestamp may
-- belong to a pending vote. Use the known writer's issuance timestamp or leave
-- it unknown. A Metastrike row alone is evidence of a pass, not of a replacement.
WITH sources AS (
  SELECT n.id AS source_id, n.record_type, n.target_member_id AS member_id,
    public.strike_cycle_day(n.sleep_cycle_date) AS cycle_date,
    CASE WHEN n.record_type = 'metastrike'
      OR n.reason = 'Automated 10-minute bedtime strike (missed bedtime check-in)' THEN n.updated_at END AS issued_at,
    NULL::text AS change_type, NULL::timestamptz AS changed_at
  FROM public.nightly_strike_logs AS n WHERE n.record_type IN ('strike', 'metastrike')

  UNION ALL

  SELECT (c.details->>'id')::uuid, c.details->>'record_type', c.member_id, c.cycle_date,
    CASE WHEN c.details->>'record_type' = 'metastrike'
      OR c.details->>'reason' = 'Automated 10-minute bedtime strike (missed bedtime check-in)'
      THEN (c.details->>'updated_at')::timestamptz END,
    CASE WHEN c.action = 'moderator_pass' THEN 'replaced' ELSE 'removed' END,
    c.recorded_at
  FROM public.strike_moderator_corrections AS c
  WHERE c.details->>'id' IS NOT NULL
    AND ((c.action = 'clear_nightly' AND c.details->>'record_type' IN ('strike', 'metastrike'))
      OR (c.action = 'moderator_pass' AND c.details->>'record_type' = 'strike'))
)
INSERT INTO public.nightly_strike_history
  (source_id, record_type, member_id, cycle_date, issued_at, change_type, changed_at)
SELECT DISTINCT ON (source_id, record_type)
  source_id, record_type, member_id, cycle_date, issued_at, change_type, changed_at
FROM sources WHERE cycle_date IS NOT NULL
ORDER BY source_id, record_type, changed_at ASC NULLS FIRST
ON CONFLICT (source_id, record_type) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_member_strike_history(
  p_member_id uuid, p_discord_id text, p_month date
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m public.members;
  zone text;
  entries jsonb;
BEGIN
  SELECT * INTO m FROM public.members
  WHERE id = p_member_id AND discord_id = p_discord_id AND is_active;
  IF NOT FOUND THEN
    RAISE SQLSTATE 'PT403' USING MESSAGE = 'Sign in with the Discord account linked to this profile.';
  END IF;
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

REVOKE ALL ON FUNCTION public.get_member_strike_history(uuid,text,date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_member_strike_history(uuid,text,date) TO service_role;

COMMIT;
