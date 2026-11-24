-- Allow the Owner to correct any roster profile and Moderators to correct other profiles.
BEGIN;

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
  PERFORM public.require_punishment_visibility();
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
  evidence text := 'roster:' || p_request_id;
BEGIN
  IF p_cycle IS NULL OR p_request_id IS NULL OR p_action IS NULL
    OR p_action NOT IN ('add_strike', 'remove_strike')
    OR (p_action = 'remove_strike') <> (p_source IS NOT NULL)
    OR nullif(btrim(p_reason), '') IS NULL OR length(btrim(p_reason)) > 500 THEN
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'Enter a cycle date, reason and request ID. Removal requires a strike source.';
  END IF;

  PERFORM FROM public.punishment_rollout WHERE singleton FOR SHARE;
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

COMMIT;
