-- ==============================================================================
-- Migration: Add weekly_schedule & pending_weekly_schedule to members table
-- Run this in the Supabase Dashboard -> SQL Editor (or via CLI)
-- ==============================================================================

-- 1. Add weekly schedule columns to members
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS weekly_schedule JSONB;
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS pending_weekly_schedule JSONB;

-- 2. Add weekend schedule columns if not already present
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS weekend_bedtime_local VARCHAR(5);
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS weekend_wake_time_local VARCHAR(5);
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS pending_weekend_bedtime_local VARCHAR(5);
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS pending_weekend_wake_time_local VARCHAR(5);

-- 3. Add strikes, metastrikes, and notification state tracking columns if absent
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS strikes_used INT NOT NULL DEFAULT 0;
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS metastrikes_used INT NOT NULL DEFAULT 0;
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS strikes_count INT NOT NULL DEFAULT 0;
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS metastrikes_count INT NOT NULL DEFAULT 0;
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS strike_cycle_month TEXT NOT NULL DEFAULT '2026-11';
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS last_notified_stage TEXT;
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS last_notified_cycle_date TEXT;
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS last_woke_up_at TIMESTAMPTZ;
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS last_wake_cycle_date TEXT;

-- 4. Backfill existing members from their current weekday and weekend columns
UPDATE public.members
SET weekly_schedule = jsonb_build_object(
  'mon', jsonb_build_object('bedtime', bedtime_local, 'wake_time', wake_time_local),
  'tue', jsonb_build_object('bedtime', bedtime_local, 'wake_time', wake_time_local),
  'wed', jsonb_build_object('bedtime', bedtime_local, 'wake_time', wake_time_local),
  'thu', jsonb_build_object('bedtime', bedtime_local, 'wake_time', wake_time_local),
  'fri', jsonb_build_object('bedtime', COALESCE(weekend_bedtime_local, bedtime_local), 'wake_time', COALESCE(weekend_wake_time_local, wake_time_local)),
  'sat', jsonb_build_object('bedtime', COALESCE(weekend_bedtime_local, bedtime_local), 'wake_time', COALESCE(weekend_wake_time_local, wake_time_local)),
  'sun', jsonb_build_object('bedtime', bedtime_local, 'wake_time', wake_time_local)
)
WHERE weekly_schedule IS NULL;

-- 5. Backfill pending schedules for members with active cooldown
UPDATE public.members
SET pending_weekly_schedule = jsonb_build_object(
  'mon', jsonb_build_object('bedtime', COALESCE(pending_bedtime_local, bedtime_local), 'wake_time', COALESCE(pending_wake_time_local, wake_time_local)),
  'tue', jsonb_build_object('bedtime', COALESCE(pending_bedtime_local, bedtime_local), 'wake_time', COALESCE(pending_wake_time_local, wake_time_local)),
  'wed', jsonb_build_object('bedtime', COALESCE(pending_bedtime_local, bedtime_local), 'wake_time', COALESCE(pending_wake_time_local, wake_time_local)),
  'thu', jsonb_build_object('bedtime', COALESCE(pending_bedtime_local, bedtime_local), 'wake_time', COALESCE(pending_wake_time_local, wake_time_local)),
  'fri', jsonb_build_object('bedtime', COALESCE(pending_weekend_bedtime_local, pending_bedtime_local, weekend_bedtime_local, bedtime_local), 'wake_time', COALESCE(pending_weekend_wake_time_local, pending_wake_time_local, weekend_wake_time_local, wake_time_local)),
  'sat', jsonb_build_object('bedtime', COALESCE(pending_weekend_bedtime_local, pending_bedtime_local, weekend_bedtime_local, bedtime_local), 'wake_time', COALESCE(pending_weekend_wake_time_local, pending_wake_time_local, weekend_wake_time_local, wake_time_local)),
  'sun', jsonb_build_object('bedtime', COALESCE(pending_bedtime_local, bedtime_local), 'wake_time', COALESCE(pending_wake_time_local, wake_time_local))
)
WHERE pending_effective_at IS NOT NULL AND pending_weekly_schedule IS NULL;

-- 6. Reload Supabase PostgREST schema cache
NOTIFY pgrst, 'reload schema';
