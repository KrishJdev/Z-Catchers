-- Keep the binding and preferences on one row while a browser rotates its endpoint.
ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS rotation_digest text,
  ADD COLUMN IF NOT EXISTS previous_endpoint text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_push_rotation_digest
  ON public.push_subscriptions (rotation_digest) WHERE rotation_digest IS NOT NULL;

CREATE OR REPLACE FUNCTION public.bind_push_subscription(
  p_member_id uuid, p_discord_id text, p_endpoint text, p_previous text,
  p_p256dh text, p_auth text, p_digest text, p_personal boolean,
  p_community boolean, p_user_agent text
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  binding public.push_subscriptions%ROWTYPE;
  background boolean := p_member_id IS NULL;
  legacy boolean := p_member_id IS NULL AND p_digest IS NULL;
BEGIN
  IF background AND p_previous IS NULL THEN
    RETURN jsonb_build_object('code', 'credential_required');
  END IF;

  IF background AND NOT legacy THEN
    SELECT * INTO binding FROM public.push_subscriptions
      WHERE rotation_digest = p_digest FOR UPDATE;
  ELSE
    SELECT * INTO binding FROM public.push_subscriptions
      WHERE endpoint = COALESCE(p_previous, p_endpoint) FOR UPDATE;
    IF NOT FOUND AND p_previous IS NOT NULL THEN
      -- Recover the exact retry of a rotation whose response was lost.
      SELECT * INTO binding FROM public.push_subscriptions
        WHERE endpoint = p_endpoint AND previous_endpoint = p_previous FOR UPDATE;
      IF NOT FOUND AND NOT background AND p_digest IS NOT NULL THEN
        SELECT * INTO binding FROM public.push_subscriptions
          WHERE member_id = p_member_id AND rotation_digest = p_digest FOR UPDATE;
      END IF;
    END IF;
  END IF;

  IF binding.id IS NULL AND background THEN
    RETURN jsonb_build_object('code', 'credential_required');
  END IF;
  IF legacy AND binding.rotation_digest IS NOT NULL THEN
    RETURN jsonb_build_object('code', 'credential_required');
  END IF;

  IF NOT background AND binding.id IS NOT NULL AND binding.member_id <> p_member_id THEN
    RETURN jsonb_build_object('code', 'endpoint_conflict');
  END IF;

  -- Recheck active identity while holding a lock that excludes profile deactivation.
  PERFORM 1 FROM public.members
    WHERE id = COALESCE(p_member_id, binding.member_id) AND is_active
      AND (background OR discord_id = p_discord_id)
    FOR SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('code', 'inactive_owner');
  END IF;

  IF binding.id IS NULL THEN
    IF p_previous IS NOT NULL THEN
      RETURN jsonb_build_object('code', 'stale_endpoint');
    END IF;
    INSERT INTO public.push_subscriptions (
      member_id, endpoint, p256dh_key, auth_key, notify_personal,
      notify_community, user_agent, rotation_digest
    ) VALUES (
      p_member_id, p_endpoint, p_p256dh, p_auth, COALESCE(p_personal, true),
      COALESCE(p_community, true), p_user_agent, p_digest
    ) RETURNING * INTO binding;
  ELSIF p_previous IS NOT NULL AND binding.endpoint <> p_previous THEN
    IF binding.previous_endpoint IS DISTINCT FROM p_previous
       OR binding.endpoint <> p_endpoint OR binding.p256dh_key <> p_p256dh
       OR binding.auth_key <> p_auth THEN
      IF NOT background AND p_digest IS NOT NULL AND binding.rotation_digest = p_digest THEN
        RETURN jsonb_build_object('code', 'stale_endpoint', 'confirmed_endpoint', binding.endpoint);
      END IF;
      RETURN jsonb_build_object('code', 'stale_endpoint');
    END IF;
    -- A signed-in worker can also provision its credential after a legacy rotation.
    IF NOT background AND p_digest IS NOT NULL AND binding.rotation_digest IS DISTINCT FROM p_digest THEN
      UPDATE public.push_subscriptions SET rotation_digest = p_digest
        WHERE id = binding.id RETURNING * INTO binding;
    END IF;
  ELSE
    IF background AND binding.endpoint = p_endpoint
       AND (binding.p256dh_key <> p_p256dh OR binding.auth_key <> p_auth) THEN
      RETURN jsonb_build_object('code', 'stale_endpoint');
    END IF;
    UPDATE public.push_subscriptions SET
      previous_endpoint = CASE WHEN endpoint <> p_endpoint THEN endpoint ELSE previous_endpoint END,
      endpoint = p_endpoint,
      p256dh_key = p_p256dh,
      auth_key = p_auth,
      notify_personal = CASE WHEN background THEN notify_personal ELSE COALESCE(p_personal, notify_personal) END,
      notify_community = CASE WHEN background THEN notify_community ELSE COALESCE(p_community, notify_community) END,
      user_agent = COALESCE(p_user_agent, user_agent),
      rotation_digest = COALESCE(p_digest, rotation_digest)
    WHERE id = binding.id RETURNING * INTO binding;
  END IF;

  RETURN jsonb_build_object(
    'code', CASE WHEN legacy THEN 'legacy_rotation' ELSE 'ok' END,
    'notify_personal', binding.notify_personal,
    'notify_community', binding.notify_community
  );
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('code', 'endpoint_conflict');
END;
$$;

REVOKE ALL ON FUNCTION public.bind_push_subscription(uuid, text, text, text, text, text, text, boolean, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bind_push_subscription(uuid, text, text, text, text, text, text, boolean, boolean, text)
  TO service_role;
