-- Install reviewed Metastrikes without enabling them.
BEGIN;

ALTER TABLE public.punishment_rollout
  ADD COLUMN IF NOT EXISTS reviewed_metastrikes_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS metastrike_requests_open boolean NOT NULL DEFAULT false;
ALTER TABLE public.nightly_strike_logs ADD COLUMN IF NOT EXISTS pass_charged_month date;

CREATE TABLE IF NOT EXISTS public.metastrike_requests (
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  cycle_date date NOT NULL,
  charge_month date GENERATED ALWAYS AS (date_trunc('month', cycle_date::timestamp)::date) STORED,
  timezone text NOT NULL,
  cutoff_at timestamptz NOT NULL,
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  submitted_at timestamptz NOT NULL,
  submitted_source_id uuid,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined', 'withdrawn', 'closed')),
  decided_at timestamptz,
  reviewer_id uuid,
  decision_reason text,
  reviewed_source_id uuid,
  pass_source_id uuid UNIQUE,
  PRIMARY KEY (member_id, id),
  UNIQUE (id),
  CHECK ((status = 'pending') = (decided_at IS NULL)),
  CHECK ((status = 'approved') = (pass_source_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_metastrike_pending_cycle
  ON public.metastrike_requests(member_id, cycle_date) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_metastrike_member_month
  ON public.metastrike_requests(member_id, charge_month);
CREATE INDEX IF NOT EXISTS idx_metastrike_staff_queue
  ON public.metastrike_requests(status, submitted_at, id);
ALTER TABLE public.metastrike_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.metastrike_requests FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.keep_strike_activation()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'The rollout row cannot be deleted.'; END IF;
  IF OLD.activated_at IS NOT NULL AND NEW.activated_at IS DISTINCT FROM OLD.activated_at THEN
    RAISE EXCEPTION 'The strike ledger activation timestamp cannot be changed.';
  END IF;
  IF NEW.activated_at > clock_timestamp() THEN RAISE EXCEPTION 'Activation cannot be in the future.'; END IF;
  IF OLD.reviewed_metastrikes_required AND NOT NEW.reviewed_metastrikes_required THEN
    RAISE EXCEPTION 'Reviewed Metastrikes cannot be disabled after cutover.';
  END IF;
  IF (NEW.reviewed_metastrikes_required AND NEW.activated_at IS NULL)
    OR (NEW.metastrike_requests_open AND NOT NEW.reviewed_metastrikes_required) THEN
    RAISE EXCEPTION 'Activate the ledger and require review before opening requests.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bump_strike_schedule_revision ON public.members;
CREATE TRIGGER bump_strike_schedule_revision BEFORE UPDATE ON public.members FOR EACH ROW
  WHEN ((NEW.timezone, NEW.bedtime_local, NEW.wake_time_local, NEW.weekend_bedtime_local,
    NEW.weekend_wake_time_local, NEW.weekly_schedule, NEW.pending_effective_at, NEW.pending_timezone,
    NEW.pending_bedtime_local, NEW.pending_wake_time_local, NEW.pending_weekend_bedtime_local,
    NEW.pending_weekend_wake_time_local, NEW.pending_weekly_schedule) IS DISTINCT FROM
    (OLD.timezone, OLD.bedtime_local, OLD.wake_time_local, OLD.weekend_bedtime_local,
    OLD.weekend_wake_time_local, OLD.weekly_schedule, OLD.pending_effective_at, OLD.pending_timezone,
    OLD.pending_bedtime_local, OLD.pending_wake_time_local, OLD.pending_weekend_bedtime_local,
    OLD.pending_weekend_wake_time_local, OLD.pending_weekly_schedule))
  EXECUTE FUNCTION public.bump_strike_schedule_revision();

CREATE OR REPLACE FUNCTION public.metastrike_reason(p_reason text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT nullif(regexp_replace(p_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
$$;

CREATE OR REPLACE FUNCTION public.metastrike_quota(m public.members, p_month date)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('month', to_char(p_month, 'YYYY-MM'), 'used', balance.used,
    'reserved', pending.total, 'remaining', greatest(0, 3 - balance.used - pending.total))
  FROM (SELECT COALESCE((SELECT used FROM public.strike_pass_months
      WHERE member_id = m.id AND month_start = p_month), public.legacy_strike_passes(m, p_month)) AS used) balance
  CROSS JOIN (SELECT count(*) AS total FROM public.metastrike_requests
    WHERE member_id = m.id AND charge_month = p_month AND status = 'pending') pending;
$$;

CREATE OR REPLACE FUNCTION public.metastrike_member_item(item public.metastrike_requests)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT to_jsonb(item) - ARRAY['member_id', 'reviewer_id', 'reviewed_source_id', 'submitted_source_id', 'pass_source_id'];
$$;

CREATE OR REPLACE FUNCTION public.get_metastrike_cycle_evidence(p_member_id uuid, p_cycle date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'checked_at', COALESCE(n.dispatched_at, s.in_bed_at),
    'checked_in', n.dispatched_at IS NOT NULL OR s.in_bed_at IS NOT NULL
      OR COALESCE(m.last_notified_stage = 'IN_BED_EARLY' AND m.last_notified_cycle_date = p_cycle::text, false),
    'woke', COALESCE(m.last_wake_cycle_date = p_cycle::text, false) OR s.woke_up_at IS NOT NULL
      OR EXISTS (SELECT FROM public.notification_logs WHERE member_id = m.id AND local_date = p_cycle
        AND notification_type = 'WOKE_UP'),
    'last_woke_up_at', m.last_woke_up_at,
    'last_wake_cycle_date', m.last_wake_cycle_date
  ) FROM public.members m
  LEFT JOIN public.notification_logs n ON n.member_id = m.id AND n.local_date = p_cycle AND n.notification_type = 'IN_BED_EARLY'
  LEFT JOIN public.sleep_logs s ON s.member_id = m.id AND s.cycle_date = p_cycle::text
  WHERE m.id = p_member_id;
$$;

CREATE OR REPLACE FUNCTION public.metastrike_check_cycle_snapshot(
  m public.members, p_context jsonb, now_at timestamptz
) RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  as_of timestamptz := (p_context->>'as_of')::timestamptz;
  zone text := CASE WHEN m.pending_effective_at <= now_at
    THEN COALESCE(NULLIF(m.pending_timezone, ''), m.timezone) ELSE m.timezone END;
BEGIN
  -- Luxon owns cycle selection. Fence its schedule and check-in inputs under the same lock as dispatch.
  IF as_of IS NULL OR as_of < now_at - interval '15 seconds' OR as_of > now_at + interval '5 seconds'
    OR p_context->>'profile_timezone' IS DISTINCT FROM zone
    OR (p_context->>'revision')::integer IS DISTINCT FROM m.strike_schedule_revision
    OR COALESCE(m.pending_effective_at <= now_at, false) IS DISTINCT FROM COALESCE(m.pending_effective_at <= as_of, false)
    OR NOT COALESCE(now_at >= (p_context->>'day_start')::timestamptz AND now_at < (p_context->>'day_end')::timestamptz, false)
    OR p_context->'evidence' IS DISTINCT FROM public.get_metastrike_cycle_evidence(m.id, (p_context->>'local_day')::date - 1) THEN
    RAISE SQLSTATE 'PT409' USING MESSAGE = 'The sleep cycle changed. Refresh and retry.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.metastrike_no_strike(m public.members, p_cycle date)
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT COALESCE((m.last_notified_stage = 'IN_BED_EARLY' AND m.last_notified_cycle_date = p_cycle::text)
    OR m.last_wake_cycle_date = p_cycle::text, false)
    OR EXISTS (SELECT FROM public.notification_logs WHERE member_id = m.id AND local_date = p_cycle
      AND notification_type IN ('IN_BED_EARLY', 'WOKE_UP'))
    OR EXISTS (SELECT FROM public.sleep_logs WHERE member_id = m.id AND cycle_date = p_cycle::text
      AND (in_bed_at IS NOT NULL OR woke_up_at IS NOT NULL))
    OR EXISTS (SELECT FROM public.strike_moderator_corrections WHERE member_id = m.id AND cycle_date = p_cycle
      AND action = 'clear_nightly')
    OR EXISTS (SELECT FROM public.cron_locks WHERE lock_key = 'notif:' || m.id || ':' || p_cycle::text || ':AUTO_BEDTIME_STRIKE'
      AND metadata->>'completed' = 'true' AND metadata->>'alert_outcome' = 'not_issued');
$$;

CREATE OR REPLACE FUNCTION public.member_metastrikes(
  p_member_id uuid, p_discord_id text, p_action text, p_id uuid DEFAULT NULL,
  p_cycle date DEFAULT NULL, p_reason text DEFAULT NULL, p_context jsonb DEFAULT NULL, p_month date DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  rollout public.punishment_rollout;
  m public.members;
  item public.metastrike_requests;
  nightly public.nightly_strike_logs;
  anchor date := (p_context->>'anchor')::date;
  now_at timestamptz;
  window_items jsonb;
  request_items jsonb;
  selected_month date;
  cutoff timestamptz;
  is_open boolean;
BEGIN
  SELECT * INTO STRICT rollout FROM public.punishment_rollout WHERE singleton FOR SHARE;
  IF p_action = 'list' THEN
    SELECT * INTO m FROM public.members WHERE id = p_member_id AND discord_id = p_discord_id AND is_active FOR SHARE;
  ELSE
    SELECT * INTO m FROM public.members WHERE id = p_member_id AND discord_id = p_discord_id AND is_active FOR NO KEY UPDATE;
  END IF;
  IF m.id IS NULL THEN RAISE SQLSTATE 'PT403' USING MESSAGE = 'Sign in with the Discord account linked to this profile.'; END IF;
  now_at := clock_timestamp();
  is_open := rollout.metastrike_requests_open AND rollout.screens_visible AND m.role <> 'owner';

  IF p_action = 'withdraw' THEN
    SELECT * INTO item FROM public.metastrike_requests WHERE member_id = m.id AND id = p_id;
    IF NOT FOUND THEN RAISE SQLSTATE 'PT404' USING MESSAGE = 'Metastrike request not found.'; END IF;
    IF item.status = 'pending' THEN
      UPDATE public.metastrike_requests SET status = 'withdrawn', decided_at = now_at
        WHERE member_id = m.id AND id = p_id RETURNING * INTO item;
    ELSIF item.status <> 'withdrawn' THEN
      RAISE SQLSTATE 'PT409' USING MESSAGE = 'This request has already been decided.';
    END IF;
    RETURN jsonb_build_object('success', true, 'item', public.metastrike_member_item(item), 'quota', public.metastrike_quota(m, item.charge_month));
  END IF;

  IF p_action = 'submit' THEN
    p_reason := public.metastrike_reason(p_reason);
    IF p_cycle IS NULL OR p_id IS NULL OR p_reason IS NULL OR length(p_reason) > 500 THEN
      RAISE SQLSTATE 'PT400' USING MESSAGE = 'Choose a sleep-cycle date and enter a reason of 1–500 characters.';
    END IF;
    SELECT * INTO item FROM public.metastrike_requests WHERE member_id = m.id AND id = p_id;
    IF FOUND THEN
      IF (item.cycle_date, item.reason) IS DISTINCT FROM (p_cycle, p_reason) THEN
        RAISE SQLSTATE 'PT409' USING MESSAGE = 'This request ID was already used with different details.';
      END IF;
      RETURN jsonb_build_object('success', true, 'item', public.metastrike_member_item(item), 'quota', public.metastrike_quota(m, item.charge_month));
    END IF;
    IF m.role = 'owner' THEN RAISE SQLSTATE 'PT403' USING MESSAGE = 'Owner requests require an authorized operator review process.'; END IF;
    IF NOT is_open THEN RAISE SQLSTATE 'PT409' USING MESSAGE = 'Metastrike requests are closed for now.'; END IF;
    PERFORM public.metastrike_check_cycle_snapshot(m, p_context, now_at);
    cutoff := (p_context->>'cutoff')::timestamptz;
    IF anchor IS NULL OR p_cycle NOT BETWEEN anchor - 3 AND anchor + 3 OR cutoff IS NULL THEN
      RAISE SQLSTATE 'PT400' USING MESSAGE = 'Choose the current sleep cycle or a date up to three cycles away.';
    END IF;
    SELECT * INTO nightly FROM public.nightly_strike_logs WHERE target_member_id = m.id AND sleep_cycle_date = p_cycle::text;
    IF nightly.record_type = 'metastrike' OR EXISTS (SELECT FROM public.metastrike_requests
      WHERE member_id = m.id AND cycle_date = p_cycle AND status = 'pending') THEN
      RAISE SQLSTATE 'PT409' USING MESSAGE = 'This sleep cycle already has a pass or a pending request.';
    END IF;
    IF nightly.record_type IS DISTINCT FROM 'strike' THEN
      IF p_cycle < anchor THEN RAISE SQLSTATE 'PT409' USING MESSAGE = 'Past cycles require a recorded nightly strike.'; END IF;
      IF public.metastrike_no_strike(m, p_cycle) OR cutoff < rollout.activated_at
        OR m.created_at > cutoff - interval '10 minutes' THEN
        RAISE SQLSTATE 'PT409' USING MESSAGE = 'This sleep cycle has no strike to excuse.';
      END IF;
    END IF;
    selected_month := date_trunc('month', p_cycle::timestamp)::date;
    IF (public.metastrike_quota(m, selected_month)->>'remaining')::integer < 1 THEN
      RAISE SQLSTATE 'PT409' USING MESSAGE = 'All three Metastrike slots are used or reserved for that month.';
    END IF;
    INSERT INTO public.metastrike_requests(member_id, id, cycle_date, timezone, cutoff_at, reason, submitted_at, submitted_source_id)
    VALUES (m.id, p_id, p_cycle, p_context->>'timezone', cutoff, p_reason, now_at,
      CASE WHEN nightly.record_type = 'strike' THEN nightly.id END)
    ON CONFLICT (id) DO NOTHING RETURNING * INTO item;
    IF NOT FOUND THEN RAISE SQLSTATE 'PT409' USING MESSAGE = 'This request ID is unavailable.'; END IF;
    RETURN jsonb_build_object('success', true, 'item', public.metastrike_member_item(item), 'quota', public.metastrike_quota(m, selected_month));
  END IF;

  IF p_action IS DISTINCT FROM 'list' OR p_month IS NULL OR extract(day FROM p_month) <> 1 THEN
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'Choose a valid Metastrike action and month.';
  END IF;
  PERFORM public.metastrike_check_cycle_snapshot(m, p_context, now_at);
  SELECT COALESCE(jsonb_agg(public.metastrike_member_item(r) ORDER BY r.submitted_at DESC, r.id), '[]')
    INTO request_items FROM public.metastrike_requests r WHERE r.member_id = m.id AND r.charge_month = p_month;
  SELECT jsonb_agg(jsonb_build_object('cycle_date', day.cycle, 'quota', quota.value,
    'unavailable_reason', CASE
      WHEN NOT is_open THEN 'submissions_closed'
      WHEN n.record_type = 'metastrike' THEN 'pass_exists'
      WHEN r.id IS NOT NULL THEN 'pending_request'
      WHEN day.cycle < anchor AND n.record_type IS DISTINCT FROM 'strike' THEN 'nightly_strike_required'
      WHEN n.record_type IS DISTINCT FROM 'strike' AND (public.metastrike_no_strike(m, day.cycle)
        OR (p_context->'cutoffs'->>day.cycle::text)::timestamptz < rollout.activated_at
        OR m.created_at > (p_context->'cutoffs'->>day.cycle::text)::timestamptz - interval '10 minutes') THEN 'no_strike'
      WHEN (quota.value->>'remaining')::integer < 1 THEN 'quota_full' END) ORDER BY day.cycle)
    INTO window_items FROM generate_series(-3, 3) days(delta)
    CROSS JOIN LATERAL (SELECT anchor + days.delta AS cycle) day
    CROSS JOIN LATERAL (SELECT public.metastrike_quota(m, date_trunc('month', day.cycle::timestamp)::date) AS value) quota
    LEFT JOIN public.nightly_strike_logs n ON n.target_member_id = m.id AND n.sleep_cycle_date = day.cycle::text
    LEFT JOIN public.metastrike_requests r ON r.member_id = m.id AND r.cycle_date = day.cycle AND r.status = 'pending';
  RETURN jsonb_build_object('items', request_items, 'choices', window_items, 'submissions_open', is_open,
    'timezone', p_context->>'timezone', 'current_cycle', anchor, 'quota', public.metastrike_quota(m, p_month));
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_metastrike_item(item public.metastrike_requests, m public.members)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT to_jsonb(item) || jsonb_build_object('member_name', m.discord_username, 'member_active', m.is_active,
    'nightly_type', n.record_type, 'strike_source_id', CASE WHEN n.record_type = 'strike' THEN n.id END,
    'no_strike_confirmed', public.metastrike_no_strike(m, item.cycle_date),
    'quota', public.metastrike_quota(m, item.charge_month))
  FROM (SELECT 1) seed LEFT JOIN public.nightly_strike_logs n
    ON n.target_member_id = m.id AND n.sleep_cycle_date = item.cycle_date::text;
$$;

CREATE OR REPLACE FUNCTION public.read_moderation_metastrikes(
  p_actor_id uuid, p_actor_discord_id text, p_id uuid DEFAULT NULL,
  p_pending boolean DEFAULT true, p_offset integer DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor_role text;
  items jsonb;
  pending_count integer;
BEGIN
  PERFORM FROM public.punishment_rollout WHERE singleton FOR SHARE;
  actor_role := public.lock_moderation_actor(p_actor_id, p_actor_discord_id, false);
  IF p_pending IS NULL OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 2147483597 THEN
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'Invalid Metastrike queue filter.';
  END IF;
  IF p_id IS NOT NULL THEN
    SELECT public.staff_metastrike_item(r, m) INTO items
    FROM public.metastrike_requests r JOIN public.members m ON m.id = r.member_id
    WHERE r.id = p_id AND m.id <> p_actor_id
      AND (m.role = 'member' OR (actor_role = 'owner' AND m.role = 'moderator'));
    IF items IS NULL THEN RAISE SQLSTATE 'PT404' USING MESSAGE = 'Metastrike request not found.'; END IF;
    RETURN jsonb_build_object('item', items);
  END IF;
  SELECT count(*) INTO pending_count
    FROM public.metastrike_requests r JOIN public.members m ON m.id = r.member_id
    WHERE r.status = 'pending' AND m.id <> p_actor_id
      AND (m.role = 'member' OR (actor_role = 'owner' AND m.role = 'moderator'));
  SELECT COALESCE(jsonb_agg(public.staff_metastrike_item(page.item, page.member)
    ORDER BY page.pending_at, page.decision_at DESC, page.id), '[]')
  INTO items FROM (
    SELECT r AS item, m AS member, CASE WHEN p_pending THEN r.submitted_at END AS pending_at,
      r.decided_at AS decision_at, r.id
    FROM public.metastrike_requests r JOIN public.members m ON m.id = r.member_id
    WHERE (r.status = 'pending') = p_pending AND m.id <> p_actor_id
      AND (m.role = 'member' OR (actor_role = 'owner' AND m.role = 'moderator'))
    ORDER BY pending_at, decision_at DESC, r.id LIMIT 51 OFFSET p_offset
  ) page;
  RETURN jsonb_build_object('items', CASE WHEN jsonb_array_length(items) > 50 THEN items - 50 ELSE items END,
    'pending_count', pending_count, 'next_offset', CASE WHEN jsonb_array_length(items) > 50 THEN p_offset + 50 END);
END;
$$;

CREATE OR REPLACE FUNCTION public.decide_metastrike(
  p_actor_id uuid, p_actor_discord_id text, p_id uuid, p_action text,
  p_source_id uuid DEFAULT NULL, p_reason text DEFAULT NULL, p_context jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m public.members;
  item public.metastrike_requests;
  nightly public.nightly_strike_logs;
  live_source uuid;
  pass_id uuid;
  now_at timestamptz;
  next_status text := 'approved';
  explanation text;
  quota jsonb;
  projection jsonb;
BEGIN
  PERFORM FROM public.punishment_rollout WHERE singleton FOR SHARE;
  PERFORM public.lock_moderation_actor(p_actor_id, p_actor_discord_id, false);
  SELECT * INTO item FROM public.metastrike_requests WHERE id = p_id;
  IF NOT FOUND THEN RAISE SQLSTATE 'PT404' USING MESSAGE = 'Metastrike request not found.'; END IF;
  m := public.lock_moderation_target(p_actor_id, p_actor_discord_id, item.member_id);
  SELECT * INTO STRICT item FROM public.metastrike_requests WHERE id = p_id;
  now_at := clock_timestamp();
  p_reason := public.metastrike_reason(p_reason);
  IF p_action IS NULL OR p_action NOT IN ('approve', 'decline')
    OR (p_action = 'decline' AND (p_reason IS NULL OR length(p_reason) > 500))
    OR (p_action = 'approve' AND p_reason IS NOT NULL) THEN
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'Declines require an explanation of 1–500 characters.';
  END IF;
  IF item.status <> 'pending' THEN
    IF item.reviewer_id = p_actor_id AND (
      (p_action = 'approve' AND item.status IN ('approved', 'closed') AND item.reviewed_source_id IS NOT DISTINCT FROM p_source_id)
      OR (p_action = 'decline' AND item.status = 'declined' AND item.decision_reason = p_reason)) THEN
      RETURN jsonb_build_object('success', true, 'item', public.staff_metastrike_item(item, m),
        'projection', CASE WHEN item.status = 'approved' THEN jsonb_build_object(
          'strikesUsed', m.strikes_used, 'metastrikesUsed', m.metastrikes_used, 'month', m.strike_cycle_month) END);
    END IF;
    RAISE SQLSTATE 'PT409' USING MESSAGE = 'This request has already been decided.';
  END IF;

  IF p_action = 'decline' THEN
    next_status := 'declined';
    explanation := p_reason;
  ELSE
    SELECT * INTO nightly FROM public.nightly_strike_logs
      WHERE target_member_id = m.id AND sleep_cycle_date = item.cycle_date::text;
    live_source := CASE WHEN nightly.record_type = 'strike' THEN nightly.id END;
    IF live_source IS DISTINCT FROM p_source_id
      OR (live_source IS NOT NULL AND item.submitted_source_id IS NOT NULL AND live_source <> item.submitted_source_id) THEN
      RAISE SQLSTATE 'PT409' USING MESSAGE = 'The nightly strike source changed. Refresh before deciding.';
    END IF;
    IF NOT m.is_active THEN
      next_status := 'closed';
      explanation := 'This profile is inactive.';
    ELSIF nightly.record_type = 'metastrike' THEN
      next_status := 'closed';
      explanation := 'This cycle already has a Metastrike.';
    ELSIF live_source IS NULL THEN
      IF public.metastrike_no_strike(m, item.cycle_date) THEN
        next_status := 'closed';
        explanation := 'This cycle has no strike to excuse.';
      ELSE
        PERFORM public.metastrike_check_cycle_snapshot(m, p_context, now_at);
        IF (p_context->>'cutoff') IS NULL OR (p_context->>'anchor') IS NULL
          OR item.cycle_date < (p_context->>'anchor')::date
          OR now_at >= least(item.cutoff_at, (p_context->>'cutoff')::timestamptz) THEN
          RAISE SQLSTATE 'PT409' USING MESSAGE = 'The dispatcher has not confirmed this cycle yet. The request is still pending.';
        END IF;
      END IF;
    END IF;
  END IF;

  IF next_status = 'approved' THEN
    PERFORM public.ensure_strike_pass_month(m, item.charge_month);
    quota := public.metastrike_quota(m, item.charge_month);
    IF (quota->>'used')::integer >= 3 OR (quota->>'used')::integer + (quota->>'reserved')::integer > 3 THEN
      RAISE SQLSTATE 'PT409' USING MESSAGE = 'This month no longer has an available Metastrike slot.';
    END IF;
    pass_id := COALESCE(nightly.id, gen_random_uuid());
  END IF;

  UPDATE public.metastrike_requests SET status = next_status, decided_at = now_at, reviewer_id = p_actor_id,
    decision_reason = explanation, reviewed_source_id = live_source, pass_source_id = pass_id
    WHERE member_id = item.member_id AND id = item.id AND status = 'pending' RETURNING * INTO STRICT item;

  IF next_status = 'approved' THEN
    UPDATE public.strike_pass_months SET used = used + 1 WHERE member_id = m.id AND month_start = item.charge_month;
    -- The shared roster still reads nightly reasons. Keep the private request reason in the request record.
    INSERT INTO public.nightly_strike_logs(id, target_member_id, sleep_cycle_date, record_type, reason,
      created_at, updated_at, pass_used_on, pass_charged_month)
    VALUES (pass_id, m.id, item.cycle_date::text, 'metastrike', 'Approved Metastrike',
      now_at, now_at, item.cycle_date, item.charge_month)
    ON CONFLICT (target_member_id, sleep_cycle_date) DO UPDATE SET record_type = 'metastrike',
      reason = excluded.reason, updated_at = excluded.updated_at, voter_ids = '[]'::jsonb,
      replacement_until = NULL, pass_used_on = excluded.pass_used_on, pass_charged_month = excluded.pass_charged_month;
    PERFORM public.reconcile_punishments(m, item.charge_month, now_at, p_actor_id::text);
    projection := public.project_member_strikes(m, public.punishment_progress_month(m, now_at));
  END IF;
  RETURN jsonb_build_object('success', true, 'item', public.staff_metastrike_item(item, m), 'projection', projection);
END;
$$;

-- Enforce review at the nightly write so both legacy RPC signatures and direct write paths are covered.
CREATE OR REPLACE FUNCTION public.require_reviewed_metastrike()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  reviewed boolean;
BEGIN
  IF NEW.record_type = 'metastrike' AND (TG_OP = 'INSERT' OR OLD.record_type <> 'metastrike') THEN
    SELECT reviewed_metastrikes_required INTO STRICT reviewed FROM public.punishment_rollout WHERE singleton FOR SHARE;
    IF reviewed AND NOT EXISTS (
      SELECT FROM public.metastrike_requests r WHERE r.pass_source_id = NEW.id AND r.member_id = NEW.target_member_id
        AND r.cycle_date::text = NEW.sleep_cycle_date AND r.status = 'approved' AND r.decided_at = NEW.updated_at
        AND r.charge_month = NEW.pass_charged_month AND r.cycle_date = NEW.pass_used_on
    ) THEN
      RAISE SQLSTATE 'PT409' USING MESSAGE = 'Metastrikes now require a reviewed request.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS require_reviewed_metastrike ON public.nightly_strike_logs;
-- AFTER INSERT/UPDATE covers the final row of an upsert, including existing nightly source IDs.
CREATE TRIGGER require_reviewed_metastrike AFTER INSERT OR UPDATE OF record_type ON public.nightly_strike_logs
  FOR EACH ROW EXECUTE FUNCTION public.require_reviewed_metastrike();

CREATE OR REPLACE FUNCTION public.metastrike_task_held(
  task public.punishments, m public.members, now_at timestamptz, include_submission_window boolean
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH local_day AS (
    SELECT (now_at AT TIME ZONE public.strike_member_zone(CASE WHEN m.pending_effective_at <= now_at
      THEN COALESCE(NULLIF(m.pending_timezone, ''), m.timezone) ELSE m.timezone END))::date AS value
  ), sources AS (
    SELECT s.*, EXISTS (SELECT FROM public.metastrike_requests r
      WHERE r.member_id = m.id AND r.cycle_date = s.cycle_date AND r.status = 'pending'
        AND (r.submitted_source_id IS NULL OR r.submitted_source_id = s.source_id)) AS has_request
    FROM public.verified_monthly_strikes(m, task.earned_month) s
  )
  SELECT count(*) >= task.threshold_number * 3
    AND count(*) - count(*) FILTER (WHERE source_type = 'nightly' AND has_request)
      - least((public.metastrike_quota(m, task.earned_month)->>'remaining')::integer,
        count(*) FILTER (WHERE source_type = 'nightly' AND NOT has_request
          AND include_submission_window AND m.is_active AND m.role <> 'owner'
          -- The Luxon anchor can still be yesterday around midnight or while a check-in is open.
          AND cycle_date >= (SELECT value - 4 FROM local_day))) < task.threshold_number * 3
  FROM sources;
$$;

CREATE OR REPLACE VIEW public.punishment_task_status AS
  SELECT p.*, CASE
    WHEN rollout.reviewed_metastrikes_required AND p.status IN ('pending', 'awaiting_assignment')
      THEN CASE WHEN hold.active THEN 'pending' ELSE 'awaiting_assignment' END
    WHEN p.status = 'pending' AND p.assignable_at <= statement_timestamp() THEN 'awaiting_assignment'
    ELSE p.status END AS effective_status,
    hold.active AS metastrike_hold
  FROM public.punishments p JOIN public.members m ON m.id = p.member_id
  JOIN public.punishment_rollout rollout ON rollout.singleton
  CROSS JOIN LATERAL (SELECT CASE WHEN rollout.reviewed_metastrikes_required
    AND p.status IN ('pending', 'awaiting_assignment', 'assigned')
    THEN public.metastrike_task_held(p, m, statement_timestamp(),
      rollout.metastrike_requests_open AND rollout.screens_visible AND p.status <> 'assigned')
    ELSE false END AS active) hold;

CREATE OR REPLACE FUNCTION public.manage_punishment_task(
  p_id uuid, p_action text, p_actor text, p_title text, p_instructions text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m public.members;
  item public.punishments;
  view_item public.punishment_task_status;
  now_at timestamptz;
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
  IF p_action = 'complete' AND view_item.status = 'completed' THEN RETURN to_jsonb(view_item) - ARRAY['effective_status', 'metastrike_hold']; END IF;
  IF view_item.metastrike_hold AND p_action IN ('assign', 'complete') THEN
    RAISE SQLSTATE 'PT409' USING MESSAGE = 'This punishment is on hold for Metastrike review.';
  END IF;
  IF p_action IN ('assign', 'edit') AND (title_value IS NULL OR length(title_value) > 120 OR length(instructions_value) > 2000) THEN
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'Enter a task title of up to 120 characters and up to 2,000 characters of instructions.';
  END IF;
  IF p_action = 'assign' AND view_item.effective_status = 'awaiting_assignment' THEN
    UPDATE public.punishments SET status = 'assigned', title = title_value, instructions = instructions_value,
      assigned_at = now_at WHERE id = p_id RETURNING * INTO item;
  ELSIF p_action = 'edit' AND view_item.status = 'assigned' THEN
    UPDATE public.punishments SET title = title_value, instructions = instructions_value WHERE id = p_id RETURNING * INTO item;
  ELSIF p_action = 'complete' AND view_item.status = 'assigned' THEN
    UPDATE public.punishments SET status = 'completed', completed_at = now_at WHERE id = p_id RETURNING * INTO item;
  ELSE
    RAISE SQLSTATE 'PT409' USING MESSAGE = 'This punishment is not in a state that permits the requested action.';
  END IF;
  INSERT INTO public.punishment_actions(punishment_id, action, actor, occurred_at, details)
    VALUES (p_id, CASE p_action WHEN 'assign' THEN 'assigned' WHEN 'edit' THEN 'edited' ELSE 'completed' END,
      p_actor, now_at, jsonb_build_object('title', item.title, 'instructions', item.instructions));
  RETURN to_jsonb(item);
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
    SELECT count(*) INTO reviewed_used FROM public.nightly_strike_logs
      WHERE target_member_id = m.id AND record_type = 'metastrike' AND pass_charged_month = affected_month;
    IF (quota->>'used')::integer < reviewed_used OR (quota->>'used')::integer + (quota->>'reserved')::integer > 3 THEN
      RAISE SQLSTATE 'PT409' USING MESSAGE = 'This correction conflicts with an approved or reserved Metastrike slot.';
    END IF;
  END IF;
  RETURN projection;
END;
$$;

REVOKE ALL ON FUNCTION public.metastrike_reason(text), public.metastrike_quota(public.members,date),
  public.metastrike_member_item(public.metastrike_requests),
  public.metastrike_check_cycle_snapshot(public.members,jsonb,timestamptz),
  public.metastrike_no_strike(public.members,date), public.staff_metastrike_item(public.metastrike_requests,public.members),
  public.metastrike_task_held(public.punishments,public.members,timestamptz,boolean), public.require_reviewed_metastrike()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.member_metastrikes(uuid,text,text,uuid,date,text,jsonb,date),
  public.read_moderation_metastrikes(uuid,text,uuid,boolean,integer), public.decide_metastrike(uuid,text,uuid,text,uuid,text,jsonb),
  public.get_metastrike_cycle_evidence(uuid,date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_metastrikes(uuid,text,text,uuid,date,text,jsonb,date),
  public.read_moderation_metastrikes(uuid,text,uuid,boolean,integer), public.decide_metastrike(uuid,text,uuid,text,uuid,text,jsonb),
  public.get_metastrike_cycle_evidence(uuid,date),
  public.metastrike_task_held(public.punishments,public.members,timestamptz,boolean) TO service_role;

COMMIT;
