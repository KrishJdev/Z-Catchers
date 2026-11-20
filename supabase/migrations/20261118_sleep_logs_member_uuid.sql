-- Convert the legacy sleep history key without deleting any history.
DO $$
BEGIN
  IF EXISTS (
    SELECT FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sleep_logs'
      AND column_name = 'member_id' AND data_type = 'text'
  ) THEN
    LOCK TABLE public.sleep_logs IN ACCESS EXCLUSIVE MODE;
    IF EXISTS (
      SELECT FROM public.sleep_logs AS log
      WHERE NOT EXISTS (SELECT FROM public.members AS member WHERE member.id::text = lower(log.member_id))
    ) THEN
      RAISE EXCEPTION 'Legacy sleep_logs contains invalid or orphan member IDs. Reconcile these rows before migration.';
    END IF;

    ALTER TABLE public.sleep_logs ALTER COLUMN member_id TYPE uuid USING member_id::uuid;
    IF NOT EXISTS (
      SELECT FROM pg_constraint
      WHERE conrelid = 'public.sleep_logs'::regclass AND conname = 'sleep_logs_member_id_fkey'
    ) THEN
      ALTER TABLE public.sleep_logs ADD CONSTRAINT sleep_logs_member_id_fkey
        FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;
    END IF;
  END IF;
END;
$$;
