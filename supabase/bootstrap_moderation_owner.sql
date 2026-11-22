-- Operator only. Fill these constants in a private copy using the reviewed rollout inventory.
-- Apply the moderation owner migration before running this transaction.
BEGIN;

LOCK TABLE public.members IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  owner_id constant uuid := NULL;
  owner_discord_id constant text := NULL;
  -- Approved allowlist-only moderators, each with {"member_id":"<uuid>","discord_id":"<snowflake>"}.
  approved_moderators constant jsonb := '[]';
  approved record;
BEGIN
  IF owner_id IS NULL OR owner_discord_id IS NULL OR owner_discord_id !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'Supply the verified owner member UUID and Discord ID.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.members WHERE role = 'owner' AND id <> owner_id) THEN
    RAISE EXCEPTION 'A different owner already exists.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.members WHERE id = owner_id AND discord_id = owner_discord_id AND is_active
  ) THEN
    RAISE EXCEPTION 'No active profile matches the verified owner identity.';
  END IF;
  -- A previous successful transaction already applied the initial assignments.
  IF EXISTS (SELECT 1 FROM public.members WHERE id = owner_id AND role = 'owner') THEN
    RETURN;
  END IF;

  UPDATE public.members
    SET role = 'owner', is_moderator = true, updated_at = statement_timestamp()
    WHERE id = owner_id;

  FOR approved IN
    SELECT * FROM jsonb_to_recordset(approved_moderators) AS a(member_id uuid, discord_id text)
  LOOP
    IF approved.member_id IS NULL OR approved.member_id = owner_id
       OR approved.discord_id IS NULL OR approved.discord_id !~ '^[0-9]+$'
       OR NOT EXISTS (
         SELECT 1 FROM public.members
           WHERE id = approved.member_id AND discord_id = approved.discord_id AND is_active
       ) THEN
      RAISE EXCEPTION 'An approved moderator does not match an eligible active profile.';
    END IF;

    UPDATE public.members
      SET role = 'moderator', is_moderator = true, updated_at = statement_timestamp()
      WHERE id = approved.member_id AND role = 'member';
  END LOOP;
END;
$$;

COMMIT;
