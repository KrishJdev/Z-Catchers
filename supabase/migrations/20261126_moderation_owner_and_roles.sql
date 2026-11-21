-- Store the sole verified owner and audit moderator assignments.
BEGIN;

ALTER TABLE public.members
  DROP CONSTRAINT IF EXISTS members_allowed_role,
  DROP CONSTRAINT IF EXISTS members_owner_active_discord;
ALTER TABLE public.members
  ADD CONSTRAINT members_allowed_role CHECK (role IN ('member', 'moderator', 'owner')),
  ADD CONSTRAINT members_owner_active_discord CHECK (
    role <> 'owner' OR (is_active IS TRUE AND discord_id IS NOT NULL AND discord_id ~ '^[0-9]+$')
  );

CREATE UNIQUE INDEX IF NOT EXISTS members_single_owner
  ON public.members (role) WHERE role = 'owner';

-- Also protect the owner from roster writes issued by older deployments.
CREATE OR REPLACE FUNCTION public.protect_moderation_owner()
RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = 'PT403', MESSAGE = 'The owner account is protected.';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW.is_active IS DISTINCT FROM OLD.is_active
     OR NEW.discord_id IS DISTINCT FROM OLD.discord_id THEN
    RAISE EXCEPTION USING ERRCODE = 'PT403', MESSAGE = 'The owner account is protected.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_moderation_owner ON public.members;
CREATE TRIGGER protect_moderation_owner
  BEFORE UPDATE OF id, role, is_active, discord_id OR DELETE ON public.members
  FOR EACH ROW WHEN (OLD.role = 'owner')
  EXECUTE FUNCTION public.protect_moderation_owner();

-- Keep the historical IDs even if a roster member is subsequently deleted.
CREATE TABLE IF NOT EXISTS public.moderator_role_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_member_id uuid NOT NULL,
  target_member_id uuid NOT NULL,
  old_role text NOT NULL CHECK (old_role IN ('member', 'moderator')),
  new_role text NOT NULL CHECK (new_role IN ('member', 'moderator') AND new_role <> old_role),
  changed_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CHECK (actor_member_id <> target_member_id)
);

ALTER TABLE public.moderator_role_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.moderator_role_changes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.moderator_role_changes TO service_role;

CREATE OR REPLACE FUNCTION public.set_moderator(
  p_actor_id uuid, p_actor_discord_id text, p_target_id uuid, p_expected_role text, p_new_role text
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  target public.members%ROWTYPE;
BEGIN
  -- Keep the verified identity and role stable until the target change commits.
  PERFORM 1 FROM public.members
    WHERE id = p_actor_id AND discord_id = p_actor_discord_id AND is_active AND role = 'owner'
    FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PT403', MESSAGE = 'An active, linked owner session is required.';
  END IF;

  IF p_actor_id = p_target_id THEN
    RAISE EXCEPTION USING ERRCODE = 'PT403', MESSAGE = 'The owner account is protected.';
  END IF;
  IF p_expected_role IS NULL OR p_new_role IS NULL
     OR p_expected_role NOT IN ('member', 'moderator')
     OR p_new_role NOT IN ('member', 'moderator')
     OR p_expected_role = p_new_role THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'Choose a transition between member and moderator.';
  END IF;

  SELECT * INTO target FROM public.members WHERE id = p_target_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PT404', MESSAGE = 'Member not found.';
  END IF;
  IF target.role = 'owner' THEN
    RAISE EXCEPTION USING ERRCODE = 'PT403', MESSAGE = 'The owner account is protected.';
  END IF;
  IF target.role <> p_expected_role THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'The member role changed. Refresh the roster and try again.';
  END IF;
  IF p_new_role = 'moderator' AND
     (NOT target.is_active OR target.discord_id IS NULL OR target.discord_id !~ '^[0-9]+$') THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Only active, Discord-linked members can become moderators.';
  END IF;

  UPDATE public.members
    SET role = p_new_role, is_moderator = (p_new_role = 'moderator'), updated_at = statement_timestamp()
    WHERE id = target.id;
  INSERT INTO public.moderator_role_changes (actor_member_id, target_member_id, old_role, new_role)
    VALUES (p_actor_id, target.id, target.role, p_new_role);
  RETURN p_new_role;
END;
$$;

REVOKE ALL ON FUNCTION public.set_moderator(uuid,text,uuid,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_moderator(uuid,text,uuid,text,text) TO service_role;

COMMIT;
