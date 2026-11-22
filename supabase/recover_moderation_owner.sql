-- Database owner only. Pause staff writes and verify both Discord IDs out of band.
-- Fill these constants in a private copy. This re-links the existing Owner profile.
BEGIN;

SET LOCAL lock_timeout = '5s';
LOCK TABLE public.members IN ACCESS EXCLUSIVE MODE;

-- Both the trigger change and the identity change roll back on any error.
ALTER TABLE public.members DISABLE TRIGGER protect_moderation_owner;

DO $$
DECLARE
  owner_id constant uuid := NULL;
  old_discord_id constant text := NULL;
  new_discord_id constant text := NULL;
  current_discord_id text;
BEGIN
  IF owner_id IS NULL OR old_discord_id IS NULL OR new_discord_id IS NULL
     OR old_discord_id !~ '^[0-9]+$' OR new_discord_id !~ '^[0-9]+$'
     OR old_discord_id = new_discord_id THEN
    RAISE EXCEPTION 'Supply the verified owner UUID and distinct old and new Discord IDs.';
  END IF;

  SELECT discord_id INTO current_discord_id FROM public.members
    WHERE id = owner_id AND role = 'owner' AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No active owner matches the verified member UUID.';
  END IF;
  IF current_discord_id = new_discord_id THEN
    RETURN; -- Exact retry after an uncertain response.
  END IF;
  IF current_discord_id IS DISTINCT FROM old_discord_id THEN
    RAISE EXCEPTION 'The current owner Discord ID changed. Verify the owner link again.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.members WHERE discord_id = new_discord_id AND id <> owner_id) THEN
    RAISE EXCEPTION 'The replacement Discord ID is already linked to another profile.';
  END IF;

  UPDATE public.members SET discord_id = new_discord_id, updated_at = statement_timestamp()
    WHERE id = owner_id;
END;
$$;

ALTER TABLE public.members ENABLE TRIGGER protect_moderation_owner;

COMMIT;
