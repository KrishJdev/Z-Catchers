-- ==============================================================================
-- Z Catchers: Supabase PostgreSQL Schema & Security Policies
-- ==============================================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Members Table (Profiles, Schedules, and 48-Hour Cooldown State Machine)
CREATE TABLE IF NOT EXISTS members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_id TEXT UNIQUE,                   -- Discord Snowflake User ID (OAuth2 identify scope)
  discord_username TEXT NOT NULL,
  discord_handle TEXT,
  avatar_url TEXT,
  journal_url TEXT NOT NULL,
  
  -- Active Schedule (Always evaluated in local time + IANA zone)
  bedtime_local VARCHAR(5) NOT NULL,        -- Format: "HH:mm" (e.g., "23:30") - Weekday schedule (Sun-Thu nights)
  wake_time_local VARCHAR(5) NOT NULL DEFAULT '07:00',
  timezone TEXT NOT NULL,                   -- IANA string (e.g., "America/New_York", "Asia/Kolkata")
  
  -- Weekend Schedule (Optional: Friday & Saturday nights)
  weekend_bedtime_local VARCHAR(5),         -- Format: "HH:mm" (e.g., "00:30")
  weekend_wake_time_local VARCHAR(5),       -- Format: "HH:mm" (e.g., "09:00")
  
  -- 7-Day Variable Sleep Schedule (JSONB: { mon: { bedtime, wake_time }, ... })
  weekly_schedule JSONB,
  
  -- 48-Hour Cooldown Pending Queue
  pending_bedtime_local VARCHAR(5),
  pending_wake_time_local VARCHAR(5),
  pending_timezone TEXT,
  pending_weekend_bedtime_local VARCHAR(5),
  pending_weekend_wake_time_local VARCHAR(5),
  pending_weekly_schedule JSONB,
  pending_effective_at TIMESTAMPTZ,         -- UTC timestamp when pending promotion unlocks (NOW() + 48h)
  
  -- Role & Security
  role TEXT NOT NULL DEFAULT 'member',      -- 'member' | 'moderator' | 'owner'
  is_moderator BOOLEAN NOT NULL DEFAULT FALSE, -- Flag identifying server moderators
  onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE, -- True once initial schedule and journal are setup
  passcode_hash TEXT,                       -- Legacy hashed 4-digit PIN (nullable, deprecated for OAuth)
  is_active BOOLEAN NOT NULL DEFAULT true,

  -- Monthly Strikes & Metastrikes Accountability System
  strikes_used INT NOT NULL DEFAULT 0 CHECK (strikes_used >= 0 AND strikes_used <= 3),
  metastrikes_used INT NOT NULL DEFAULT 0 CHECK (metastrikes_used >= 0 AND metastrikes_used <= 3),
  strikes_count INT NOT NULL DEFAULT 0 CHECK (strikes_count >= 0 AND strikes_count <= 3),
  metastrikes_count INT NOT NULL DEFAULT 0 CHECK (metastrikes_count >= 0 AND metastrikes_count <= 3),
  strike_cycle_month TEXT NOT NULL DEFAULT '2026-11', -- 'YYYY-MM' for lazy monthly reset

  -- Idempotent Notification Dispatcher Tracking (Rolling lookback & jitter protection)
  last_notified_stage TEXT,                 -- 'WIND_DOWN_30M' | 'BEDTIME_HIT' | 'IN_BED_EARLY' | NULL
  last_notified_cycle_date TEXT,            -- Canonical sleep cycle date 'YYYY-MM-DD'
  last_woke_up_at TIMESTAMPTZ,              -- Exact UTC timestamp when member woke up for fast sleepEngine state resolution
  last_wake_cycle_date TEXT,                -- 'YYYY-MM-DD' representing the latest logged wake cycle date

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Migration support for existing deployments
ALTER TABLE members ADD COLUMN IF NOT EXISTS discord_id TEXT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS is_moderator BOOLEAN DEFAULT FALSE;
ALTER TABLE members ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT FALSE;
ALTER TABLE members ALTER COLUMN passcode_hash DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'members_discord_id_key') THEN
    ALTER TABLE members ADD CONSTRAINT members_discord_id_key UNIQUE (discord_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_members_discord_id ON members(discord_id);
ALTER TABLE members ADD COLUMN IF NOT EXISTS weekend_bedtime_local VARCHAR(5);
ALTER TABLE members ADD COLUMN IF NOT EXISTS weekend_wake_time_local VARCHAR(5);
ALTER TABLE members ADD COLUMN IF NOT EXISTS pending_weekend_bedtime_local VARCHAR(5);
ALTER TABLE members ADD COLUMN IF NOT EXISTS pending_weekend_wake_time_local VARCHAR(5);
ALTER TABLE members ADD COLUMN IF NOT EXISTS strikes_used INT NOT NULL DEFAULT 0;
ALTER TABLE members ADD COLUMN IF NOT EXISTS metastrikes_used INT NOT NULL DEFAULT 0;
ALTER TABLE members ADD COLUMN IF NOT EXISTS strikes_count INT NOT NULL DEFAULT 0;
ALTER TABLE members ADD COLUMN IF NOT EXISTS metastrikes_count INT NOT NULL DEFAULT 0;
ALTER TABLE members ADD COLUMN IF NOT EXISTS strike_cycle_month TEXT NOT NULL DEFAULT '2026-11';
ALTER TABLE members ADD COLUMN IF NOT EXISTS last_notified_stage TEXT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS last_notified_cycle_date TEXT;
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS weekly_schedule JSONB;
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS pending_weekly_schedule JSONB;
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS last_woke_up_at TIMESTAMPTZ;
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS last_wake_cycle_date TEXT;

-- Backfill existing members from their current weekday and weekend columns
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

-- Backfill pending schedules for members with active cooldown
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

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_strikes_used_range') THEN
    ALTER TABLE members ADD CONSTRAINT check_strikes_used_range CHECK (strikes_used >= 0 AND strikes_used <= 3);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_metastrikes_used_range') THEN
    ALTER TABLE members ADD CONSTRAINT check_metastrikes_used_range CHECK (metastrikes_used >= 0 AND metastrikes_used <= 3);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_strikes_count_range') THEN
    ALTER TABLE members ADD CONSTRAINT check_strikes_count_range CHECK (strikes_count >= 0 AND strikes_count <= 3);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_metastrikes_count_range') THEN
    ALTER TABLE members ADD CONSTRAINT check_metastrikes_count_range CHECK (metastrikes_count >= 0 AND metastrikes_count <= 3);
  END IF;
END $$;

-- 2. Push Subscriptions Table (Supports multi-device per member: unique endpoint per device)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh_key TEXT NOT NULL,
  auth_key TEXT NOT NULL,
  notify_personal BOOLEAN NOT NULL DEFAULT true,
  notify_community BOOLEAN NOT NULL DEFAULT true,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure unique constraint on endpoint for idempotent multi-device upserting
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'push_subscriptions_endpoint_key') THEN
    ALTER TABLE push_subscriptions ADD CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint);
  END IF;
END $$;

-- 3. Notification Logs Table (Idempotency guard against duplicate cron dispatches)
CREATE TABLE IF NOT EXISTS notification_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,          -- 'WIND_DOWN_30M' | 'BEDTIME_HIT' | 'IN_BED_EARLY'
  local_date DATE NOT NULL,                 -- Sleeper's local date (YYYY-MM-DD)
  dispatched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(member_id, notification_type, local_date)
);

-- 4. Nightly Strike Logs Table (Community 2-Vote Strike & Metastrike Passes)
CREATE TABLE IF NOT EXISTS nightly_strike_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  sleep_cycle_date TEXT NOT NULL,           -- Target member's local cycle date "YYYY-MM-DD"
  record_type TEXT NOT NULL CHECK (record_type IN ('pending_vote', 'strike', 'metastrike')),
  voter_ids JSONB NOT NULL DEFAULT '[]'::jsonb, -- Array of member IDs / tokens to enforce unique voters
  reason TEXT,                              -- Optional short note for Metastrikes (e.g. "Monthly Battle", "Birthday", "Family Event")
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(target_member_id, sleep_cycle_date)
);

-- 5. Rate Limit Entries Table (Serverless-persistent brute-force protection across ephemeral instances)
CREATE TABLE IF NOT EXISTS rate_limit_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,                -- E.g. "ip:1.2.3.4", "target:member-uuid", or "ip_target:1.2.3.4:member-uuid"
  ip_address TEXT,
  target_member_id TEXT,
  attempts INT NOT NULL DEFAULT 1,
  reset_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Persistent Rate Limiting Table (Standardized serverless API/PIN sliding window rate limiter)
CREATE TABLE IF NOT EXISTS public.rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 1,
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- 7. Cron Execution & Notification Idempotency Locks (Guarantees single runner per dispatch window)
CREATE TABLE IF NOT EXISTS public.cron_locks (
  lock_key TEXT PRIMARY KEY,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- 8. Sleep & Wake History Logs per Member and Sleep Cycle Date
CREATE TABLE IF NOT EXISTS public.sleep_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  cycle_date TEXT NOT NULL, -- "YYYY-MM-DD" in member's local IANA timezone representing the night's cycle
  timezone TEXT NOT NULL DEFAULT 'UTC',
  target_bedtime TEXT,      -- "HH:mm" scheduled bedtime for this cycle
  target_wake_time TEXT,    -- "HH:mm" scheduled wake time for this cycle
  in_bed_at TIMESTAMPTZ,    -- Exact UTC timestamp when member checked in to bed
  in_bed_local_time TEXT,   -- "HH:mm" in member's local timezone
  woke_up_at TIMESTAMPTZ,   -- Exact UTC timestamp when member woke up
  woke_up_local_time TEXT,  -- "HH:mm" in member's local timezone
  wake_source TEXT CHECK (wake_source IN ('button', 'manual')),
  duration_minutes INTEGER, -- Calculated total sleep duration in minutes
  status TEXT NOT NULL DEFAULT 'on_time' CHECK (status IN ('on_time', 'late', 'missed', 'metastrike')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (member_id, cycle_date)
);

-- Guarded migration: Convert sleep_logs.member_id from TEXT to UUID and link foreign key if upgrading existing table
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sleep_logs'
      AND column_name = 'member_id' AND data_type = 'text'
  ) THEN
    -- Delete orphan or non-UUID records before conversion to avoid migration failures
    DELETE FROM public.sleep_logs
    WHERE member_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR member_id::uuid NOT IN (SELECT id FROM public.members);

    ALTER TABLE public.sleep_logs
      ALTER COLUMN member_id TYPE UUID USING member_id::uuid;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_schema = 'public'
        AND table_name = 'sleep_logs'
        AND constraint_name = 'sleep_logs_member_id_fkey'
    ) THEN
      ALTER TABLE public.sleep_logs
        ADD CONSTRAINT sleep_logs_member_id_fkey
        FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;
    END IF;
  END IF;
END $$;

-- Indexes for high-performance cron lookups & timezone queries
CREATE INDEX IF NOT EXISTS idx_members_active ON members(is_active);
CREATE INDEX IF NOT EXISTS idx_members_pending ON members(pending_effective_at) WHERE pending_effective_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_members_last_notified ON members(last_notified_cycle_date, last_notified_stage);
CREATE INDEX IF NOT EXISTS idx_push_endpoint ON push_subscriptions(endpoint);
CREATE INDEX IF NOT EXISTS idx_push_member_id ON push_subscriptions(member_id);
CREATE INDEX IF NOT EXISTS idx_notification_logs_lookup ON notification_logs(member_id, notification_type, local_date);
CREATE INDEX IF NOT EXISTS idx_nightly_strike_logs_target ON nightly_strike_logs(target_member_id, sleep_cycle_date);
CREATE INDEX IF NOT EXISTS idx_rate_limit_entries_key_reset ON rate_limit_entries(key, reset_at);
CREATE INDEX IF NOT EXISTS idx_rate_limit_target_ip ON rate_limit_entries(target_member_id, ip_address);
CREATE INDEX IF NOT EXISTS idx_rate_limits_expires_at ON public.rate_limits (expires_at);
CREATE INDEX IF NOT EXISTS idx_cron_locks_expires_at ON public.cron_locks (expires_at);
CREATE INDEX IF NOT EXISTS idx_cron_locks_pending_strike_alerts ON public.cron_locks (lock_key)
  WHERE metadata->>'stage' = 'AUTO_BEDTIME_STRIKE' AND metadata->>'state' = 'processing';
CREATE INDEX IF NOT EXISTS idx_sleep_logs_member_cycle ON public.sleep_logs (member_id, cycle_date DESC);

-- Enable Realtime if supabase_realtime publication is used
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sleep_logs;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- ==============================================================================
-- Row Level Security (RLS) Policies
-- ==============================================================================
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE nightly_strike_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limit_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cron_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sleep_logs ENABLE ROW LEVEL SECURITY;

-- Only the roster API projects safe member fields.
DROP POLICY IF EXISTS "Public can view active members" ON members;


-- Members: Service role has full access for backend API operations
DROP POLICY IF EXISTS "Service role full access on members" ON members;
CREATE POLICY "Service role full access on members" ON members
  FOR ALL USING (auth.role() = 'service_role');

-- Push subscriptions are bound to a member by the authenticated API.
DROP POLICY IF EXISTS "Service role full access on push_subscriptions" ON push_subscriptions;
CREATE POLICY "Service role full access on push_subscriptions" ON push_subscriptions
  FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Public can register push subscriptions" ON push_subscriptions;


-- Notification Logs: Service role only (internal to notification dispatcher)
DROP POLICY IF EXISTS "Service role full access on notification_logs" ON notification_logs;
CREATE POLICY "Service role full access on notification_logs" ON notification_logs
  FOR ALL USING (auth.role() = 'service_role');

-- Nightly Strike Logs: Public read for community verification & transparency
DROP POLICY IF EXISTS "Public can view nightly strike logs" ON nightly_strike_logs;
CREATE POLICY "Public can view nightly strike logs" ON nightly_strike_logs
  FOR SELECT USING (true);

-- Nightly Strike Logs: Service role full access for backend API operations
DROP POLICY IF EXISTS "Service role full access on nightly_strike_logs" ON nightly_strike_logs;
CREATE POLICY "Service role full access on nightly_strike_logs" ON nightly_strike_logs
  FOR ALL USING (auth.role() = 'service_role');

-- Rate Limit Entries: Service role full access (strictly internal backend security)
DROP POLICY IF EXISTS "Service role full access on rate_limit_entries" ON rate_limit_entries;
CREATE POLICY "Service role full access on rate_limit_entries" ON rate_limit_entries
  FOR ALL USING (auth.role() = 'service_role');

-- Rate Limits: Service role full access (internal backend security)
DROP POLICY IF EXISTS "Service role full access on rate_limits" ON public.rate_limits;
CREATE POLICY "Service role full access on rate_limits" ON public.rate_limits
  FOR ALL USING (auth.role() = 'service_role');

-- Cron Locks: Service role full access (internal backend dispatcher)
DROP POLICY IF EXISTS "Service role full access on cron_locks" ON public.cron_locks;
CREATE POLICY "Service role full access on cron_locks" ON public.cron_locks
  FOR ALL USING (auth.role() = 'service_role');

-- Sleep Logs: Service role full access (strictly internal backend service role; community access via authenticated API routes)
DROP POLICY IF EXISTS "Public can view sleep logs" ON public.sleep_logs;
DROP POLICY IF EXISTS "Public read sleep_logs" ON public.sleep_logs;
DROP POLICY IF EXISTS "Service role full access on sleep_logs" ON public.sleep_logs;
CREATE POLICY "Service role full access on sleep_logs" ON public.sleep_logs
  FOR ALL USING (auth.role() = 'service_role');

-- ==============================================================================
-- Automated Monthly Strike Reset Procedure
-- ==============================================================================
CREATE OR REPLACE FUNCTION reset_monthly_strikes()
RETURNS void AS $$
BEGIN
  UPDATE members
  SET strikes_used = 0,
      strikes_count = 0,
      metastrikes_used = 0,
      metastrikes_count = 0,
      strike_cycle_month = to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM'),
      updated_at = NOW()
  WHERE strike_cycle_month != to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM');
END;
$$ LANGUAGE plpgsql;

-- ==============================================================================
-- Seed Initial Demo Members (Cross-Timezone Community)
-- ==============================================================================
INSERT INTO members (discord_username, discord_handle, avatar_url, journal_url, bedtime_local, wake_time_local, timezone, weekend_bedtime_local, weekend_wake_time_local, role)
SELECT seed.* FROM (VALUES
  ('Aoi', 'aoi_jp', 'https://api.dicebear.com/7.x/bottts/svg?seed=Aoi', 'https://discord.com/channels/123456789/987654321', '23:30', '07:30', 'Asia/Tokyo', '00:30', '09:00', 'member'),
  ('SarahK', 'sarah_ny', 'https://api.dicebear.com/7.x/bottts/svg?seed=SarahK', 'https://discord.com/channels/123456789/987654322', '22:45', '06:45', 'America/New_York', '23:45', '08:30', 'member'),
  ('Marcus', 'marcus_ldn', 'https://api.dicebear.com/7.x/bottts/svg?seed=Marcus', 'https://discord.com/channels/123456789/987654323', '23:00', '07:00', 'Europe/London', NULL, NULL, 'moderator'),
  ('Arjun', 'arjun_in', 'https://api.dicebear.com/7.x/bottts/svg?seed=Arjun', 'https://discord.com/channels/123456789/987654324', '00:15', '08:00', 'Asia/Kolkata', '01:30', '09:30', 'member')
) AS seed (discord_username, discord_handle, avatar_url, journal_url, bedtime_local, wake_time_local, timezone, weekend_bedtime_local, weekend_wake_time_local, role)
WHERE NOT EXISTS (SELECT FROM members existing WHERE existing.journal_url = seed.journal_url)
ON CONFLICT DO NOTHING;

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
  IF p_month < m.strike_cycle_month THEN
    RAISE SQLSTATE 'PT409' USING MESSAGE = 'The strike month advanced. Refresh the member and retry.';
  END IF;
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

-- Keep receipts that arrived after the worker read the expired lease.
CREATE OR REPLACE FUNCTION public.renew_cron_lease(
  p_key text, p_previous_locked_at timestamptz, p_locked_at timestamptz,
  p_expires_at timestamptz, p_metadata jsonb
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  UPDATE public.cron_locks AS lease SET
    locked_at = p_locked_at,
    expires_at = p_expires_at,
    metadata = p_metadata || jsonb_build_object('delivered_sub_ids', (
      SELECT coalesce(jsonb_agg(DISTINCT receipt), '[]'::jsonb)
      FROM jsonb_array_elements(
        coalesce(lease.metadata->'delivered_sub_ids', '[]'::jsonb) ||
        coalesce(p_metadata->'delivered_sub_ids', '[]'::jsonb)
      ) AS receipts(receipt)
    ))
  WHERE lease.lock_key = p_key AND lease.locked_at = p_previous_locked_at
    AND lease.expires_at <= p_locked_at AND lease.expires_at <= clock_timestamp()
    AND lease.metadata->'completed' IS DISTINCT FROM 'true'::jsonb
  RETURNING lease.metadata;
$$;
REVOKE ALL ON FUNCTION public.renew_cron_lease(text,timestamptz,timestamptz,timestamptz,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.renew_cron_lease(text,timestamptz,timestamptz,timestamptz,jsonb) TO service_role;

-- Seal the captured lease and write its audit in the same transaction.
CREATE OR REPLACE FUNCTION public.complete_cron_stage(
  p_key text, p_locked_at timestamptz, p_metadata jsonb
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  completed_at timestamptz;
  stage text;
  cycle text;
  target_id uuid;
BEGIN
  PERFORM FROM public.cron_locks
    WHERE lock_key = p_key AND locked_at = p_locked_at FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  completed_at := clock_timestamp();

  UPDATE public.cron_locks SET
    expires_at = completed_at + interval '24 hours',
    metadata = metadata || p_metadata || jsonb_build_object(
      'completed', true, 'state', 'completed', 'completed_at', completed_at
    )
    WHERE lock_key = p_key AND locked_at = p_locked_at AND expires_at > completed_at
      AND metadata->'completed' IS DISTINCT FROM 'true'::jsonb
    RETURNING metadata->>'stage', metadata->>'local_date', (metadata->>'member_id')::uuid
    INTO stage, cycle, target_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF stage IS NULL OR stage NOT IN ('WIND_DOWN_30M', 'BEDTIME_HIT', 'AUTO_BEDTIME_STRIKE') THEN
    RAISE EXCEPTION 'Invalid notification stage.';
  END IF;

  INSERT INTO public.notification_logs(member_id, notification_type, local_date, dispatched_at)
    VALUES (target_id, stage, cycle::date, completed_at)
    ON CONFLICT (member_id, notification_type, local_date) DO NOTHING;

  IF stage <> 'AUTO_BEDTIME_STRIKE' AND p_metadata->>'delivery_outcome' = 'complete' THEN
    UPDATE public.members SET last_notified_stage = stage, last_notified_cycle_date = cycle
      WHERE id = target_id AND (
        last_notified_cycle_date IS NULL OR last_notified_cycle_date < cycle OR
        (last_notified_cycle_date = cycle AND
          last_notified_stage IS DISTINCT FROM 'IN_BED_EARLY' AND
          (stage = 'BEDTIME_HIT' OR last_notified_stage IS DISTINCT FROM 'BEDTIME_HIT'))
      );
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_cron_stage(text,timestamptz,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_cron_stage(text,timestamptz,jsonb) TO service_role;

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
      RETURN jsonb_build_object('code', 'binding_missing');
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
    IF NOT background AND (p_personal IS NOT NULL OR p_community IS NOT NULL
       OR (p_digest IS NOT NULL AND binding.rotation_digest IS DISTINCT FROM p_digest)) THEN
      UPDATE public.push_subscriptions SET
        notify_personal = COALESCE(p_personal, notify_personal),
        notify_community = COALESCE(p_community, notify_community),
        rotation_digest = COALESCE(p_digest, rotation_digest)
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

-- Reserve a master-passcode attempt atomically. A successful verification releases its slot.
CREATE OR REPLACE FUNCTION public.reserve_moderator_passcode_attempt(
  p_key text, p_release_window timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  now_at timestamptz := clock_timestamp();
  started_at timestamptz;
  expires_at_value timestamptz;
BEGIN
  IF p_release_window IS NOT NULL THEN
    UPDATE public.rate_limits SET count = count - 1
      WHERE key = p_key AND window_start = p_release_window AND count > 0;
    RETURN jsonb_build_object('released', true);
  END IF;

  INSERT INTO public.rate_limits AS limits (key, count, window_start, expires_at)
  VALUES (p_key, 1, now_at, now_at + interval '15 minutes')
  ON CONFLICT (key) DO UPDATE SET
    count = CASE WHEN limits.expires_at <= now_at THEN 1 ELSE limits.count + 1 END,
    window_start = CASE WHEN limits.expires_at <= now_at THEN now_at ELSE limits.window_start END,
    expires_at = CASE WHEN limits.expires_at <= now_at THEN now_at + interval '15 minutes' ELSE limits.expires_at END
  WHERE limits.expires_at <= now_at OR limits.count < 5
  RETURNING window_start INTO started_at;

  IF FOUND THEN
    RETURN jsonb_build_object('window_start', started_at);
  END IF;

  SELECT expires_at INTO expires_at_value FROM public.rate_limits WHERE key = p_key;
  RETURN jsonb_build_object('retry_after', greatest(1, ceil(extract(epoch FROM expires_at_value - now_at))));
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_moderator_passcode_attempt(text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_moderator_passcode_attempt(text, timestamptz)
  TO service_role;

-- Install the ledger without activating the writer or seeding any punishments.
BEGIN;

ALTER TABLE public.members
  DROP CONSTRAINT IF EXISTS members_strikes_used_check,
  DROP CONSTRAINT IF EXISTS members_strikes_count_check,
  DROP CONSTRAINT IF EXISTS check_strikes_used_range,
  DROP CONSTRAINT IF EXISTS check_strikes_count_range;
ALTER TABLE public.members
  ADD CONSTRAINT check_strikes_used_range CHECK (strikes_used >= 0),
  ADD CONSTRAINT check_strikes_count_range CHECK (strikes_count >= 0);

ALTER TABLE public.members ADD COLUMN IF NOT EXISTS strike_schedule_revision integer NOT NULL DEFAULT 0;

-- Fence cron's Luxon schedule calculation against a concurrent schedule edit.
CREATE OR REPLACE FUNCTION public.bump_strike_schedule_revision()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.strike_schedule_revision := OLD.strike_schedule_revision + 1;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS bump_strike_schedule_revision ON public.members;
CREATE TRIGGER bump_strike_schedule_revision BEFORE UPDATE ON public.members FOR EACH ROW
  WHEN ((NEW.timezone, NEW.bedtime_local, NEW.wake_time_local, NEW.weekend_bedtime_local,
    NEW.weekend_wake_time_local, NEW.weekly_schedule, NEW.pending_effective_at) IS DISTINCT FROM
    (OLD.timezone, OLD.bedtime_local, OLD.wake_time_local, OLD.weekend_bedtime_local,
    OLD.weekend_wake_time_local, OLD.weekly_schedule, OLD.pending_effective_at))
  EXECUTE FUNCTION public.bump_strike_schedule_revision();

ALTER TABLE public.nightly_strike_logs
  ADD COLUMN IF NOT EXISTS replacement_until timestamptz,
  ADD COLUMN IF NOT EXISTS pass_used_on date;

CREATE TABLE IF NOT EXISTS public.punishment_rollout (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  activated_at timestamptz,
  screens_visible boolean NOT NULL DEFAULT false CHECK (NOT screens_visible OR activated_at IS NOT NULL)
);
INSERT INTO public.punishment_rollout DEFAULT VALUES ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.strike_moderator_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  cycle_date date NOT NULL,
  action text NOT NULL CHECK (action IN ('add_strike', 'void_adjustment', 'clear_nightly',
    'set_passes', 'legacy_set_counts', 'moderator_pass')),
  source_id uuid,
  evidence_key text UNIQUE,
  actor text,
  reason text NOT NULL,
  details jsonb,
  recorded_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_strike_corrections_member_date
  ON public.strike_moderator_corrections(member_id, cycle_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_strike_corrections_void
  ON public.strike_moderator_corrections(source_id) WHERE action = 'void_adjustment';

CREATE TABLE IF NOT EXISTS public.strike_pass_months (
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  month_start date NOT NULL CHECK (extract(day FROM month_start) = 1),
  used integer NOT NULL CHECK (used BETWEEN 0 AND 3),
  PRIMARY KEY (member_id, month_start)
);

CREATE TABLE IF NOT EXISTS public.punishments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  earned_month date NOT NULL CHECK (extract(day FROM earned_month) = 1),
  threshold_number integer NOT NULL CHECK (threshold_number > 0),
  earned_cycle_date date NOT NULL,
  qualified_at timestamptz NOT NULL,
  assignable_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'awaiting_assignment', 'assigned', 'completed', 'canceled')),
  title text,
  instructions text,
  assigned_at timestamptz,
  completed_at timestamptz,
  canceled_at timestamptz,
  UNIQUE (member_id, earned_month, threshold_number)
);
CREATE INDEX IF NOT EXISTS idx_punishments_open ON public.punishments(member_id, earned_cycle_date)
  WHERE status IN ('pending', 'awaiting_assignment', 'assigned');

CREATE TABLE IF NOT EXISTS public.punishment_actions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  punishment_id uuid NOT NULL REFERENCES public.punishments(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('earned', 'reopened', 'canceled', 'assigned', 'edited', 'completed')),
  actor text,
  occurred_at timestamptz NOT NULL,
  details jsonb
);
CREATE INDEX IF NOT EXISTS idx_punishment_actions_item ON public.punishment_actions(punishment_id, id);

ALTER TABLE public.punishment_rollout ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.strike_moderator_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.strike_pass_months ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.punishments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.punishment_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.punishment_rollout, public.strike_moderator_corrections, public.strike_pass_months,
  public.punishments, public.punishment_actions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.punishment_rollout, public.strike_moderator_corrections, public.strike_pass_months,
  public.punishments, public.punishment_actions TO service_role;

-- The launch timestamp is set once by the database operator. Visibility can be toggled independently.
CREATE OR REPLACE FUNCTION public.keep_strike_activation()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'The rollout row cannot be deleted.'; END IF;
  IF OLD.activated_at IS NOT NULL AND NEW.activated_at IS DISTINCT FROM OLD.activated_at THEN
    RAISE EXCEPTION 'The strike ledger activation timestamp cannot be changed.';
  END IF;
  IF NEW.activated_at > clock_timestamp() THEN RAISE EXCEPTION 'Activation cannot be in the future.'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS keep_strike_activation ON public.punishment_rollout;
CREATE TRIGGER keep_strike_activation BEFORE UPDATE OR DELETE ON public.punishment_rollout
  FOR EACH ROW EXECUTE FUNCTION public.keep_strike_activation();

-- Serialize direct check-in/wake evidence writes with the strike transaction.
-- The strike writer reads these rows without locking them, avoiding inverse row lock order.
CREATE OR REPLACE FUNCTION public.lock_member_for_sleep_evidence()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  target uuid;
  stage text;
BEGIN
  IF TG_TABLE_NAME = 'notification_logs' THEN
    stage := CASE WHEN TG_OP = 'DELETE' THEN OLD.notification_type ELSE NEW.notification_type END;
    IF stage NOT IN ('IN_BED_EARLY', 'WOKE_UP') THEN RETURN COALESCE(NEW, OLD); END IF;
  END IF;
  target := CASE WHEN TG_OP = 'DELETE' THEN OLD.member_id ELSE NEW.member_id END;
  PERFORM FROM public.members WHERE id = target FOR NO KEY UPDATE;
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS lock_member_for_sleep_evidence ON public.notification_logs;
CREATE TRIGGER lock_member_for_sleep_evidence BEFORE INSERT OR UPDATE OR DELETE ON public.notification_logs
  FOR EACH ROW EXECUTE FUNCTION public.lock_member_for_sleep_evidence();
DROP TRIGGER IF EXISTS lock_member_for_sleep_evidence ON public.sleep_logs;
CREATE TRIGGER lock_member_for_sleep_evidence BEFORE INSERT OR UPDATE OR DELETE ON public.sleep_logs
  FOR EACH ROW EXECUTE FUNCTION public.lock_member_for_sleep_evidence();

-- Leave malformed prototype dates out of the verified ledger.
CREATE OR REPLACE FUNCTION public.strike_cycle_day(value text)
RETURNS date LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = '' AS $$
BEGIN
  IF value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RETURN NULL; END IF;
  RETURN value::date;
EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.strike_member_zone(value text)
RETURNS text LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT COALESCE((SELECT name FROM pg_timezone_names WHERE name = value), 'UTC');
$$;

-- Legacy rows lack the deadline. Recover it from the member's current weekly schedule.
-- Live strikes persist the deadline supplied by the Luxon sleep engine.
CREATE OR REPLACE FUNCTION public.legacy_strike_deadline(m public.members, cycle date)
RETURNS timestamptz LANGUAGE sql STABLE SET search_path = '' AS $$
  WITH bedtimes AS (
    SELECT days.delta_day, (cycle + days.delta_day + CASE WHEN hours.bedtime < time '12:00' THEN 1 ELSE 0 END
      + hours.bedtime) AT TIME ZONE public.strike_member_zone(m.timezone) AS bedtime
    FROM generate_series(-1, 3) AS days(delta_day)
    CROSS JOIN LATERAL (
      SELECT m.weekly_schedule->(ARRAY['sun','mon','tue','wed','thu','fri','sat'])[extract(dow FROM cycle + days.delta_day)::int + 1] AS custom
    ) AS schedule
    CROSS JOIN LATERAL (
      SELECT COALESCE(
        CASE WHEN btrim(schedule.custom->>'bedtime') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
          AND btrim(schedule.custom->>'wake_time') <> '' THEN btrim(schedule.custom->>'bedtime') END,
        CASE WHEN extract(dow FROM cycle + days.delta_day) IN (5, 6)
          AND btrim(m.weekend_bedtime_local) ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN btrim(m.weekend_bedtime_local) END,
        CASE WHEN btrim(m.bedtime_local) ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN btrim(m.bedtime_local) END,
        '23:00')::time AS bedtime
    ) AS hours
  )
  SELECT min(bedtime) FROM bedtimes WHERE bedtime > (SELECT bedtime FROM bedtimes WHERE delta_day = 0);
$$;

CREATE OR REPLACE FUNCTION public.verified_monthly_strikes(m public.members, month_start date)
RETURNS TABLE (source_id uuid, source_type text, cycle_date date, qualified_at timestamptz, replacement_until timestamptz)
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT n.id, 'nightly'::text, day.cycle_date, n.updated_at,
    COALESCE(n.replacement_until, public.legacy_strike_deadline(m, day.cycle_date))
  FROM public.nightly_strike_logs AS n
  CROSS JOIN LATERAL (SELECT public.strike_cycle_day(n.sleep_cycle_date) AS cycle_date) AS day
  WHERE n.target_member_id = m.id AND n.record_type = 'strike'
    AND n.sleep_cycle_date >= to_char(month_start, 'YYYY-MM-DD')
    AND n.sleep_cycle_date < to_char(month_start + interval '1 month', 'YYYY-MM-DD')
    AND day.cycle_date >= month_start AND day.cycle_date < month_start + interval '1 month'
  UNION ALL
  SELECT c.id, 'moderator', c.cycle_date, c.recorded_at, NULL::timestamptz
  FROM public.strike_moderator_corrections AS c
  WHERE c.member_id = m.id AND c.action = 'add_strike'
    AND c.cycle_date >= month_start AND c.cycle_date < month_start + interval '1 month'
    AND NOT EXISTS (SELECT FROM public.strike_moderator_corrections AS v
      WHERE v.source_id = c.id AND v.action = 'void_adjustment');
$$;

CREATE OR REPLACE FUNCTION public.earned_punishment_thresholds(m public.members, month_start date)
RETURNS TABLE (threshold_number integer, earned_cycle_date date, qualified_at timestamptz, assignable_at timestamptz)
LANGUAGE sql STABLE SET search_path = '' AS $$
  -- Rank dates to show which cycle earned a threshold. Independently rank
  -- deadlines to find when enough strikes can no longer be replaced.
  WITH ranked AS (
    SELECT s.*,
      row_number() OVER (ORDER BY cycle_date, qualified_at, source_id) AS earned_rank,
      row_number() OVER (ORDER BY replacement_until NULLS FIRST, source_id) AS stable_rank,
      max(qualified_at) OVER (ORDER BY cycle_date, qualified_at, source_id ROWS UNBOUNDED PRECEDING) AS qualified
    FROM public.verified_monthly_strikes(m, month_start) AS s
  )
  SELECT (e.earned_rank / 3)::integer, e.cycle_date, e.qualified,
    greatest(e.qualified, d.replacement_until)
  FROM ranked AS e JOIN ranked AS d ON d.stable_rank = e.earned_rank
  WHERE e.earned_rank % 3 = 0;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_punishments(
  m public.members, month_start date, now_at timestamptz, actor text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  threshold record;
  item public.punishments%ROWTYPE;
  next_status text;
BEGIN
  IF month_start < date '2026-11-01' THEN RETURN; END IF;
  -- Snapshot deadlines for verified historical rows on their first reconciliation.
  UPDATE public.nightly_strike_logs AS n SET replacement_until = s.replacement_until
    FROM public.verified_monthly_strikes(m, month_start) AS s
    WHERE s.source_type = 'nightly' AND n.id = s.source_id AND n.replacement_until IS NULL;

  FOR threshold IN SELECT * FROM public.earned_punishment_thresholds(m, month_start) ORDER BY threshold_number
  LOOP
    next_status := CASE WHEN threshold.assignable_at > now_at THEN 'pending' ELSE 'awaiting_assignment' END;
    SELECT * INTO item FROM public.punishments
      WHERE member_id = m.id AND earned_month = month_start AND threshold_number = threshold.threshold_number;
    IF NOT FOUND THEN
      INSERT INTO public.punishments(member_id, earned_month, threshold_number, earned_cycle_date,
        qualified_at, assignable_at, status)
      VALUES (m.id, month_start, threshold.threshold_number, threshold.earned_cycle_date,
        threshold.qualified_at, threshold.assignable_at, next_status)
      RETURNING * INTO item;
      INSERT INTO public.punishment_actions(punishment_id, action, actor, occurred_at)
        VALUES (item.id, 'earned', actor, now_at);
    ELSIF item.status = 'canceled' THEN
      UPDATE public.punishments SET status = next_status, earned_cycle_date = threshold.earned_cycle_date,
        qualified_at = threshold.qualified_at, assignable_at = threshold.assignable_at,
        title = NULL, instructions = NULL, assigned_at = NULL, canceled_at = NULL
        WHERE id = item.id;
      INSERT INTO public.punishment_actions(punishment_id, action, actor, occurred_at)
        VALUES (item.id, 'reopened', actor, now_at);
    ELSIF item.status IN ('pending', 'awaiting_assignment') THEN
      UPDATE public.punishments SET status = next_status, earned_cycle_date = threshold.earned_cycle_date,
        qualified_at = threshold.qualified_at, assignable_at = threshold.assignable_at
        WHERE id = item.id AND (status, earned_cycle_date, qualified_at, assignable_at) IS DISTINCT FROM
          (next_status, threshold.earned_cycle_date, threshold.qualified_at, threshold.assignable_at);
    END IF;
  END LOOP;

  WITH canceled AS (
    UPDATE public.punishments AS p SET status = 'canceled', canceled_at = now_at
    WHERE p.member_id = m.id AND p.earned_month = month_start
      AND p.status IN ('pending', 'awaiting_assignment', 'assigned')
      AND p.threshold_number > (SELECT count(*) / 3 FROM public.verified_monthly_strikes(m, month_start))
    RETURNING p.id
  )
  INSERT INTO public.punishment_actions(punishment_id, action, actor, occurred_at)
    SELECT id, 'canceled', actor, now_at FROM canceled;
END;
$$;

-- Use the same read-only fallback when previewing and initializing the pass balance.
CREATE OR REPLACE FUNCTION public.legacy_strike_passes(m public.members, month_start date)
RETURNS integer LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE WHEN m.strike_cycle_month IS NULL OR m.strike_cycle_month = to_char(month_start, 'YYYY-MM')
    THEN greatest(m.metastrikes_used, m.metastrikes_count)
    ELSE (
      SELECT least(3, count(*))::integer
      FROM public.nightly_strike_logs AS n
      CROSS JOIN LATERAL (SELECT COALESCE(n.pass_used_on,
        (n.updated_at AT TIME ZONE public.strike_member_zone(m.timezone))::date) AS used_on) AS day
      WHERE n.target_member_id = m.id AND n.record_type = 'metastrike'
        AND day.used_on >= month_start AND day.used_on < month_start + interval '1 month'
    ) END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_strike_pass_month(m public.members, month_start date)
RETURNS integer LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  total integer;
BEGIN
  SELECT used INTO total FROM public.strike_pass_months WHERE member_id = m.id AND strike_pass_months.month_start = $2;
  IF FOUND THEN RETURN total; END IF;
  total := public.legacy_strike_passes(m, month_start);
  INSERT INTO public.strike_pass_months VALUES (m.id, month_start, total);
  RETURN total;
END;
$$;

-- Archive the outgoing balance for every writer, including legacy callers and inactive rollover.
CREATE OR REPLACE FUNCTION public.archive_outgoing_strike_passes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  previous_month date := public.strike_cycle_day(OLD.strike_cycle_month || '-01');
BEGIN
  IF previous_month IS NOT NULL THEN
    PERFORM public.ensure_strike_pass_month(OLD, previous_month);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS archive_outgoing_strike_passes ON public.members;
CREATE TRIGGER archive_outgoing_strike_passes BEFORE UPDATE OF strike_cycle_month ON public.members
  FOR EACH ROW WHEN (OLD.strike_cycle_month IS DISTINCT FROM NEW.strike_cycle_month)
  EXECUTE FUNCTION public.archive_outgoing_strike_passes();

CREATE OR REPLACE FUNCTION public.project_member_strikes(m public.members, month_start date)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  total integer;
  passes integer;
  month_label text := to_char(month_start, 'YYYY-MM');
BEGIN
  SELECT count(*) INTO total FROM public.verified_monthly_strikes(m, month_start);
  passes := public.ensure_strike_pass_month(m, month_start);
  UPDATE public.members SET strikes_used = total, strikes_count = total,
    metastrikes_used = passes, metastrikes_count = passes, strike_cycle_month = month_label
    WHERE id = m.id AND (strikes_used, strikes_count, metastrikes_used, metastrikes_count, strike_cycle_month)
      IS DISTINCT FROM (total, total, passes, passes, month_label);
  RETURN jsonb_build_object('strikesUsed', total, 'metastrikesUsed', passes, 'month', month_label,
    'reset', m.strike_cycle_month IS DISTINCT FROM month_label);
END;
$$;

-- Keep the installed legacy function behind both entry points until activation.
DO $$
BEGIN
  IF to_regprocedure('public.apply_legacy_nightly_strike(uuid,text,text,text,text,text,timestamptz,timestamptz)') IS NULL THEN
    ALTER FUNCTION public.apply_nightly_strike(uuid,text,text,text,text,text,timestamptz,timestamptz)
      RENAME TO apply_legacy_nightly_strike;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_nightly_strike(
  p_member_id uuid, p_cycle text, p_month text, p_previous_type text,
  p_type text, p_reason text, p_now timestamptz, p_month_start timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM FROM public.punishment_rollout WHERE singleton FOR SHARE;
  IF (SELECT activated_at FROM public.punishment_rollout WHERE singleton) IS NOT NULL THEN
    RAISE SQLSTATE 'PT409' USING MESSAGE = 'The strike writer has been upgraded. Deploy the compatible app.';
  END IF;
  RETURN public.apply_legacy_nightly_strike(p_member_id, p_cycle, p_month, p_previous_type,
    p_type, p_reason, p_now, p_month_start);
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_nightly_strike(
  p_member_id uuid, p_cycle text, p_month text, p_previous_type text, p_type text,
  p_reason text, p_now timestamptz, p_month_start timestamptz,
  p_strike_cutoff timestamptz, p_replacement_until timestamptz, p_moderator text, p_schedule_revision integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  activation timestamptz;
  m public.members%ROWTYPE;
  nightly public.nightly_strike_logs%ROWTYPE;
  cycle date := public.strike_cycle_day(p_cycle);
  local_day date;
  current_month date;
  cycle_month date;
  pass_month date;
  passes integer;
  projection jsonb;
  now_at timestamptz;
BEGIN
  SELECT activated_at INTO STRICT activation FROM public.punishment_rollout WHERE singleton FOR SHARE;
  IF activation IS NULL THEN
    projection := public.apply_legacy_nightly_strike(p_member_id, p_cycle, p_month, p_previous_type,
      p_type, p_reason, p_now, p_month_start);
    IF p_type = 'metastrike' THEN
      SELECT * INTO STRICT m FROM public.members WHERE id = p_member_id;
      UPDATE public.nightly_strike_logs SET pass_used_on = (p_now AT TIME ZONE public.strike_member_zone(m.timezone))::date
        WHERE target_member_id = p_member_id AND sleep_cycle_date = p_cycle;
    END IF;
    IF (p_type = 'clear' OR (p_type = 'metastrike' AND p_moderator IS NOT NULL)) AND cycle IS NOT NULL THEN
      INSERT INTO public.strike_moderator_corrections(member_id, cycle_date, action, actor, reason, details, recorded_at)
        VALUES (p_member_id, cycle, CASE WHEN p_type = 'clear' THEN 'clear_nightly' ELSE 'moderator_pass' END,
          p_moderator, p_reason, projection->'log', p_now);
    END IF;
    RETURN projection;
  END IF;
  IF cycle IS NULL THEN RAISE SQLSTATE 'PT400' USING MESSAGE = 'Invalid sleep cycle date.'; END IF;
  SELECT * INTO STRICT m FROM public.members WHERE id = p_member_id FOR NO KEY UPDATE;
  now_at := greatest(p_now, clock_timestamp());
  local_day := (now_at AT TIME ZONE public.strike_member_zone(m.timezone))::date;
  current_month := date_trunc('month', local_day::timestamp)::date;
  cycle_month := date_trunc('month', cycle::timestamp)::date;
  SELECT * INTO nightly FROM public.nightly_strike_logs WHERE target_member_id = m.id AND sleep_cycle_date = p_cycle;
  IF p_type = 'strike' AND nightly.record_type IN ('strike', 'metastrike') THEN
    RETURN jsonb_build_object('reason', CASE WHEN nightly.record_type = 'strike' THEN 'already_issued' ELSE 'metastrike_active' END,
      'log', to_jsonb(nightly));
  END IF;
  IF p_type = 'clear' AND nightly.id IS NULL THEN RETURN '{}'::jsonb; END IF;
  IF nightly.record_type IS DISTINCT FROM p_previous_type THEN
    RAISE SQLSTATE 'PT409' USING MESSAGE = 'The nightly record changed. Refresh and retry.';
  END IF;

  IF p_type = 'strike' THEN
    IF m.strike_schedule_revision IS DISTINCT FROM p_schedule_revision OR m.pending_effective_at <= now_at THEN
      RAISE SQLSTATE 'PT409' USING MESSAGE = 'The sleep schedule changed. Re-evaluate the cycle with the current schedule.';
    END IF;
    IF cycle_month < date '2026-11-01' OR p_strike_cutoff < activation THEN
      RETURN jsonb_build_object('reason', 'cycle_before_activation');
    END IF;
    IF p_strike_cutoff IS NULL OR p_strike_cutoff > p_now OR p_replacement_until IS NULL THEN
      RAISE SQLSTATE 'PT400' USING MESSAGE = 'The strike cutoff or replacement deadline is invalid.';
    END IF;
    IF EXISTS (SELECT FROM public.strike_moderator_corrections
      WHERE member_id = m.id AND cycle_date = cycle AND action = 'clear_nightly') THEN
      RETURN jsonb_build_object('reason', 'moderator_cleared');
    END IF;
    IF NOT m.is_active OR (m.last_notified_stage = 'IN_BED_EARLY' AND m.last_notified_cycle_date = p_cycle)
       OR m.last_wake_cycle_date = p_cycle
       OR EXISTS (SELECT FROM public.notification_logs WHERE member_id = m.id
         AND local_date = cycle AND notification_type IN ('IN_BED_EARLY', 'WOKE_UP'))
       OR EXISTS (SELECT FROM public.sleep_logs WHERE member_id = m.id
         AND cycle_date = p_cycle AND (in_bed_at IS NOT NULL OR woke_up_at IS NOT NULL)) THEN
      RETURN jsonb_build_object('reason', 'already_checked_in');
    END IF;
  ELSIF p_type = 'metastrike' THEN
    IF nightly.record_type = 'strike' AND p_moderator IS NULL AND now_at >=
      COALESCE(nightly.replacement_until, public.legacy_strike_deadline(m, cycle)) THEN
      RAISE SQLSTATE 'PT400' USING MESSAGE = 'The window to replace this strike with a Metastrike has expired.';
    END IF;
    IF nightly.record_type = 'metastrike' THEN
      RAISE SQLSTATE 'PT400' USING MESSAGE = 'This cycle already has a pass.';
    END IF;
    passes := public.ensure_strike_pass_month(m, current_month);
    IF passes >= 3 THEN RAISE SQLSTATE 'PT400' USING MESSAGE = 'You have used all 3 Metastrikes for this month.'; END IF;
    UPDATE public.strike_pass_months SET used = passes + 1 WHERE member_id = m.id AND month_start = current_month;
    IF p_moderator IS NOT NULL THEN
      INSERT INTO public.strike_moderator_corrections(member_id, cycle_date, action, actor, reason, details, recorded_at)
        VALUES (m.id, cycle, 'moderator_pass', p_moderator, p_reason, to_jsonb(nightly), now_at);
    END IF;
  ELSIF p_type = 'clear' THEN
    IF nullif(btrim(p_moderator), '') IS NULL THEN
      RAISE SQLSTATE 'PT400' USING MESSAGE = 'Moderator identity is required to clear the nightly record.';
    END IF;
    IF nightly.record_type = 'metastrike' THEN
      pass_month := date_trunc('month', COALESCE(nightly.pass_used_on,
        (nightly.updated_at AT TIME ZONE public.strike_member_zone(m.timezone))::date)::timestamp)::date;
      passes := public.ensure_strike_pass_month(m, pass_month);
      UPDATE public.strike_pass_months SET used = greatest(passes - 1, 0)
        WHERE member_id = m.id AND month_start = pass_month;
    END IF;
    INSERT INTO public.strike_moderator_corrections(member_id, cycle_date, action, source_id, actor, reason, details, recorded_at)
      VALUES (m.id, cycle, 'clear_nightly', nightly.id, p_moderator, p_reason, to_jsonb(nightly), now_at);
  ELSE
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'Invalid nightly record type.';
  END IF;

  IF p_type = 'clear' THEN
    DELETE FROM public.nightly_strike_logs WHERE id = nightly.id;
  ELSE
    INSERT INTO public.nightly_strike_logs(target_member_id, sleep_cycle_date, record_type, reason, created_at, updated_at,
      replacement_until, pass_used_on)
    VALUES (m.id, p_cycle, p_type, p_reason, now_at, now_at,
      CASE WHEN p_type = 'strike' THEN p_replacement_until END,
      CASE WHEN p_type = 'metastrike' THEN local_day END)
    ON CONFLICT (target_member_id, sleep_cycle_date) DO UPDATE SET record_type = excluded.record_type,
      reason = excluded.reason, updated_at = excluded.updated_at, voter_ids = '[]'::jsonb,
      replacement_until = excluded.replacement_until, pass_used_on = excluded.pass_used_on
    RETURNING * INTO nightly;
  END IF;

  PERFORM public.reconcile_punishments(m, cycle_month, now_at, p_moderator);
  projection := public.project_member_strikes(m, current_month);
  RETURN projection || jsonb_build_object('log', CASE WHEN p_type <> 'clear' THEN to_jsonb(nightly) END,
    'cycleStrikesUsed', (SELECT count(*) FROM public.verified_monthly_strikes(m, cycle_month)));
END;
$$;

-- Refresh the compatibility projection only under the same lock as its writers.
CREATE OR REPLACE FUNCTION public.refresh_member_strike_projection(p_member_id uuid, p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  activation timestamptz;
  m public.members%ROWTYPE;
  month_start date;
  month_label text;
BEGIN
  SELECT activated_at INTO STRICT activation FROM public.punishment_rollout WHERE singleton FOR SHARE;
  SELECT * INTO STRICT m FROM public.members WHERE id = p_member_id FOR NO KEY UPDATE;
  month_start := date_trunc('month', greatest(p_now, clock_timestamp()) AT TIME ZONE public.strike_member_zone(m.timezone))::date;
  IF activation IS NOT NULL THEN RETURN public.project_member_strikes(m, month_start); END IF;
  month_label := to_char(month_start, 'YYYY-MM');
  IF m.strike_cycle_month < month_label THEN
    UPDATE public.members SET strikes_used = 0, strikes_count = 0, metastrikes_used = 0, metastrikes_count = 0,
      strike_cycle_month = month_label WHERE id = m.id;
    RETURN jsonb_build_object('strikesUsed', 0, 'metastrikesUsed', 0, 'month', month_label, 'reset', true);
  END IF;
  RETURN jsonb_build_object('strikesUsed', greatest(m.strikes_used, m.strikes_count),
    'metastrikesUsed', greatest(m.metastrikes_used, m.metastrikes_count),
    'month', COALESCE(m.strike_cycle_month, month_label), 'reset', false);
END;
$$;

-- Retain the compatibility entry point for legacy callers. The UTC bulk reset
-- could move a member into the wrong month. Reads and writes now roll forward per member.
CREATE OR REPLACE FUNCTION public.reset_monthly_strikes()
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$ BEGIN RETURN; END; $$;

CREATE OR REPLACE FUNCTION public.adjust_member_strikes(
  p_member_id uuid, p_strikes integer, p_passes integer, p_relative boolean, p_actor text, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  activation timestamptz;
  m public.members%ROWTYPE;
  now_at timestamptz;
  local_day date;
  target_month date;
  month_label text;
  total integer;
  previous_passes integer;
  item record;
BEGIN
  SELECT activated_at INTO STRICT activation FROM public.punishment_rollout WHERE singleton FOR SHARE;
  SELECT * INTO STRICT m FROM public.members WHERE id = p_member_id FOR NO KEY UPDATE;
  now_at := clock_timestamp();
  local_day := (now_at AT TIME ZONE public.strike_member_zone(m.timezone))::date;
  target_month := date_trunc('month', local_day::timestamp)::date;
  month_label := to_char(target_month, 'YYYY-MM');
  IF p_relative IS NULL OR (p_strikes IS NULL AND p_passes IS NULL)
    OR (p_relative AND (abs(p_strikes::bigint) > 1 OR abs(p_passes::bigint) > 1))
    OR (NOT p_relative AND (p_strikes < 0 OR p_passes NOT BETWEEN 0 AND 3))
    OR nullif(btrim(p_actor), '') IS NULL OR nullif(btrim(p_reason), '') IS NULL THEN
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'Invalid strike correction.';
  END IF;

  IF activation IS NULL THEN
    IF m.strike_cycle_month > month_label THEN
      RAISE SQLSTATE 'PT409' USING MESSAGE = 'The strike month advanced. Refresh and retry.';
    END IF;
    total := CASE WHEN m.strike_cycle_month = month_label THEN greatest(m.strikes_used, m.strikes_count) ELSE 0 END;
    previous_passes := CASE WHEN m.strike_cycle_month = month_label
      THEN greatest(m.metastrikes_used, m.metastrikes_count) ELSE 0 END;
    p_strikes := CASE WHEN p_relative THEN greatest(0, total + COALESCE(p_strikes, 0)) ELSE COALESCE(p_strikes, total) END;
    p_passes := CASE WHEN p_relative THEN greatest(0, least(3, previous_passes + COALESCE(p_passes, 0)))
      ELSE COALESCE(p_passes, previous_passes) END;
    IF p_strikes > 3 THEN
      RAISE SQLSTATE 'PT400' USING MESSAGE = 'The strike ledger is inactive. At most three strikes can be recorded.';
    END IF;
    INSERT INTO public.strike_moderator_corrections(member_id, cycle_date, action, actor, reason, details, recorded_at)
      VALUES (m.id, local_day, 'legacy_set_counts', p_actor, p_reason,
        jsonb_build_object('previousMonth', m.strike_cycle_month,
          'previousStrikes', greatest(m.strikes_used, m.strikes_count),
          'previousPasses', greatest(m.metastrikes_used, m.metastrikes_count),
          'strikes', p_strikes, 'passes', p_passes), now_at);
    UPDATE public.members SET strikes_used = p_strikes, strikes_count = p_strikes,
      metastrikes_used = p_passes, metastrikes_count = p_passes,
      strike_cycle_month = month_label, updated_at = now_at WHERE id = m.id;
    RETURN jsonb_build_object('strikesUsed', p_strikes, 'metastrikesUsed', p_passes, 'month', month_label);
  END IF;

  SELECT count(*) INTO total FROM public.verified_monthly_strikes(m, target_month);
  previous_passes := public.ensure_strike_pass_month(m, target_month);
  p_strikes := CASE WHEN p_relative THEN greatest(0, total + COALESCE(p_strikes, 0)) ELSE COALESCE(p_strikes, total) END;
  p_passes := CASE WHEN p_relative THEN greatest(0, least(3, previous_passes + COALESCE(p_passes, 0)))
    ELSE COALESCE(p_passes, previous_passes) END;
  IF p_strikes - total > 31 THEN
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'A single correction can add at most 31 strike records.';
  END IF;
  INSERT INTO public.strike_moderator_corrections(member_id, cycle_date, action, actor, reason, recorded_at)
    SELECT m.id, local_day, 'add_strike', p_actor, p_reason, now_at
    FROM generate_series(1, p_strikes - total);
  FOR item IN
    SELECT * FROM public.verified_monthly_strikes(m, target_month)
    ORDER BY cycle_date DESC, qualified_at DESC, source_id
    LIMIT greatest(0, total - p_strikes)
  LOOP
    IF item.source_type = 'nightly' THEN
      INSERT INTO public.strike_moderator_corrections(member_id, cycle_date, action, source_id, actor, reason, details, recorded_at)
        SELECT m.id, item.cycle_date, 'clear_nightly', n.id, p_actor, p_reason, to_jsonb(n), now_at
        FROM public.nightly_strike_logs AS n WHERE n.id = item.source_id;
      DELETE FROM public.nightly_strike_logs WHERE id = item.source_id;
    ELSE
      INSERT INTO public.strike_moderator_corrections(member_id, cycle_date, action, source_id, actor, reason, recorded_at)
        VALUES (m.id, item.cycle_date, 'void_adjustment', item.source_id, p_actor, p_reason, now_at);
    END IF;
  END LOOP;

  IF previous_passes <> p_passes THEN
    UPDATE public.strike_pass_months SET used = p_passes
      WHERE member_id = m.id AND strike_pass_months.month_start = target_month;
    INSERT INTO public.strike_moderator_corrections(member_id, cycle_date, action, actor, reason, details, recorded_at)
      VALUES (m.id, local_day, 'set_passes', p_actor, p_reason,
        jsonb_build_object('previousPasses', previous_passes, 'passes', p_passes), now_at);
  END IF;
  PERFORM public.reconcile_punishments(m, target_month, now_at, p_actor);
  RETURN public.project_member_strikes(m, target_month);
END;
$$;

-- Import one documented November correction. An exact retry reuses its evidence key.
-- An operator must supply the dated evidence explicitly. Legacy aggregate changes are audit only.
CREATE OR REPLACE FUNCTION public.record_verified_november_correction(
  p_member_id uuid, p_cycle date, p_evidence_key text, p_actor text, p_reason text,
  p_void_source uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  activation timestamptz;
  m public.members%ROWTYPE;
  prior public.strike_moderator_corrections%ROWTYPE;
  source_record record;
  correction_id uuid;
  now_at timestamptz;
  action_name text := 'add_strike';
  snapshot jsonb;
BEGIN
  SELECT activated_at INTO STRICT activation FROM public.punishment_rollout WHERE singleton FOR SHARE;
  SELECT * INTO STRICT m FROM public.members WHERE id = p_member_id FOR NO KEY UPDATE;
  now_at := clock_timestamp();
  IF p_cycle IS NULL OR p_cycle < date '2026-11-01' OR p_cycle >= date '2026-12-01'
    OR p_cycle > (now_at AT TIME ZONE public.strike_member_zone(m.timezone))::date
    OR nullif(btrim(p_evidence_key), '') IS NULL OR nullif(btrim(p_actor), '') IS NULL
    OR nullif(btrim(p_reason), '') IS NULL THEN
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'A documented November correction requires a date, reference, actor and reason.';
  END IF;
  SELECT * INTO prior FROM public.strike_moderator_corrections WHERE evidence_key = p_evidence_key;
  IF FOUND THEN
    IF (prior.member_id, prior.cycle_date, prior.source_id, prior.actor, prior.reason)
      IS DISTINCT FROM (p_member_id, p_cycle, p_void_source, p_actor, p_reason) THEN
      RAISE SQLSTATE 'PT409' USING MESSAGE = 'This evidence reference already records a different correction.';
    END IF;
    RETURN prior.id;
  END IF;
  IF p_void_source IS NOT NULL THEN
    SELECT * INTO source_record FROM public.verified_monthly_strikes(m, date '2026-11-01')
      WHERE source_id = p_void_source AND cycle_date = p_cycle;
    IF NOT FOUND THEN RAISE SQLSTATE 'PT400' USING MESSAGE = 'No valid strike matches the correction.'; END IF;
    IF source_record.source_type = 'nightly' THEN
      action_name := 'clear_nightly';
      DELETE FROM public.nightly_strike_logs AS n WHERE n.id = p_void_source RETURNING to_jsonb(n) INTO snapshot;
    ELSE
      action_name := 'void_adjustment';
    END IF;
  END IF;
  INSERT INTO public.strike_moderator_corrections(member_id, cycle_date, action, source_id, evidence_key, actor, reason, details, recorded_at)
    VALUES (m.id, p_cycle, action_name, p_void_source, p_evidence_key, p_actor, p_reason, snapshot, now_at)
    RETURNING id INTO correction_id;
  IF activation IS NOT NULL THEN
    PERFORM public.reconcile_punishments(m, date '2026-11-01', now_at, p_actor);
    PERFORM public.project_member_strikes(m, date_trunc('month', now_at AT TIME ZONE public.strike_member_zone(m.timezone))::date);
  END IF;
  RETURN correction_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.november_punishment_preview()
RETURNS TABLE (member_id uuid, member_name text, verified_rows jsonb, verified_strikes bigint,
  counter_month text, legacy_strikes_used integer, legacy_strikes_count integer, counter_discrepancy boolean,
  used_passes integer, thresholds jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT m.id, m.discord_username, ledger.rows, ledger.total,
    m.strike_cycle_month, m.strikes_used, m.strikes_count,
    CASE WHEN m.strike_cycle_month = '2026-11' THEN
      m.strikes_used <> ledger.total OR m.strikes_count <> ledger.total
    ELSE NULL END,
    COALESCE(passes.used, public.legacy_strike_passes(m, date '2026-11-01')),
    thresholds.rows
  FROM public.members AS m
  LEFT JOIN public.strike_pass_months AS passes ON passes.member_id = m.id AND passes.month_start = date '2026-11-01'
  CROSS JOIN LATERAL (
    SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.cycle_date, s.qualified_at, s.source_id), '[]'::jsonb) AS rows,
      count(*) AS total
    FROM public.verified_monthly_strikes(m, date '2026-11-01') AS s
  ) AS ledger
  CROSS JOIN LATERAL (
    SELECT COALESCE(jsonb_agg(to_jsonb(t) || jsonb_build_object('status', CASE WHEN
      t.assignable_at > statement_timestamp() THEN 'pending' ELSE 'awaiting_assignment' END)
      ORDER BY t.threshold_number), '[]'::jsonb) AS rows
    FROM public.earned_punishment_thresholds(m, date '2026-11-01') AS t
  ) AS thresholds;
$$;

CREATE OR REPLACE FUNCTION public.seed_november_punishments(p_member_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  activation timestamptz;
  m public.members%ROWTYPE;
  now_at timestamptz;
BEGIN
  SELECT activated_at INTO STRICT activation FROM public.punishment_rollout WHERE singleton FOR SHARE;
  IF activation IS NULL THEN RAISE SQLSTATE 'PT409' USING MESSAGE = 'Activate the ledger before running the November seed.'; END IF;
  SELECT * INTO STRICT m FROM public.members WHERE id = p_member_id FOR NO KEY UPDATE;
  now_at := clock_timestamp();
  PERFORM public.ensure_strike_pass_month(m, date '2026-11-01');
  PERFORM public.reconcile_punishments(m, date '2026-11-01', now_at);
  RETURN public.project_member_strikes(m, date_trunc('month', now_at AT TIME ZONE public.strike_member_zone(m.timezone))::date);
END;
$$;

-- Alert recovery may run in a later local month than the issued strike.
-- A null result indicates the app should use the compatibility counters.
CREATE OR REPLACE FUNCTION public.get_strike_cycle_total(p_member_id uuid, p_cycle text)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (SELECT count(*)::integer FROM public.verified_monthly_strikes(m,
    date_trunc('month', public.strike_cycle_day(p_cycle)::timestamp)::date))
  FROM public.members AS m CROSS JOIN public.punishment_rollout AS rollout
  WHERE m.id = p_member_id AND rollout.singleton AND rollout.activated_at IS NOT NULL;
$$;

-- A pending item becomes assignable at its deadline, even if no further strikes occur.
CREATE OR REPLACE VIEW public.punishment_task_status WITH (security_invoker = true) AS
  SELECT p.*, CASE WHEN p.status = 'pending' AND p.assignable_at <= statement_timestamp()
    THEN 'awaiting_assignment' ELSE p.status END AS effective_status
  FROM public.punishments AS p;
REVOKE ALL ON public.punishment_task_status FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.punishment_task_status TO service_role;

CREATE OR REPLACE FUNCTION public.manage_punishment_task(
  p_id uuid, p_action text, p_actor text, p_title text, p_instructions text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m public.members%ROWTYPE;
  item public.punishments%ROWTYPE;
  now_at timestamptz;
  title_value text := nullif(btrim(p_title), '');
  instructions_value text := nullif(btrim(p_instructions), '');
BEGIN
  SELECT * INTO STRICT item FROM public.punishments WHERE id = p_id;
  SELECT * INTO STRICT m FROM public.members WHERE id = item.member_id FOR NO KEY UPDATE;
  now_at := clock_timestamp();
  PERFORM public.reconcile_punishments(m, item.earned_month, now_at);
  SELECT * INTO STRICT item FROM public.punishments WHERE id = p_id;
  IF nullif(btrim(p_actor), '') IS NULL THEN RAISE SQLSTATE 'PT400' USING MESSAGE = 'Moderator identity is required.'; END IF;
  IF p_action = 'complete' AND item.status = 'completed' THEN RETURN to_jsonb(item); END IF;
  IF p_action = 'assign' AND item.status = 'awaiting_assignment' THEN
    IF title_value IS NULL OR length(title_value) > 120 OR length(instructions_value) > 2000 THEN
      RAISE SQLSTATE 'PT400' USING MESSAGE = 'Enter a task title of up to 120 characters and up to 2,000 characters of instructions.';
    END IF;
    UPDATE public.punishments SET status = 'assigned', title = title_value, instructions = instructions_value,
      assigned_at = now_at WHERE id = p_id RETURNING * INTO item;
  ELSIF p_action = 'edit' AND item.status = 'assigned' THEN
    IF title_value IS NULL OR length(title_value) > 120 OR length(instructions_value) > 2000 THEN
      RAISE SQLSTATE 'PT400' USING MESSAGE = 'Enter a task title of up to 120 characters and up to 2,000 characters of instructions.';
    END IF;
    UPDATE public.punishments SET title = title_value, instructions = instructions_value WHERE id = p_id RETURNING * INTO item;
  ELSIF p_action = 'complete' AND item.status = 'assigned' THEN
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

REVOKE ALL ON FUNCTION
  public.apply_legacy_nightly_strike(uuid,text,text,text,text,text,timestamptz,timestamptz),
  public.keep_strike_activation(), public.lock_member_for_sleep_evidence(), public.bump_strike_schedule_revision(),
  public.archive_outgoing_strike_passes(), public.legacy_strike_passes(public.members,date),
  public.strike_cycle_day(text), public.strike_member_zone(text), public.legacy_strike_deadline(public.members,date),
  public.verified_monthly_strikes(public.members,date), public.earned_punishment_thresholds(public.members,date),
  public.reconcile_punishments(public.members,date,timestamptz,text), public.ensure_strike_pass_month(public.members,date),
  public.project_member_strikes(public.members,date),
  public.record_verified_november_correction(uuid,date,text,text,text,uuid)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION
  public.apply_nightly_strike(uuid,text,text,text,text,text,timestamptz,timestamptz),
  public.apply_nightly_strike(uuid,text,text,text,text,text,timestamptz,timestamptz,timestamptz,timestamptz,text,integer),
  public.refresh_member_strike_projection(uuid,timestamptz), public.reset_monthly_strikes(),
  public.adjust_member_strikes(uuid,integer,integer,boolean,text,text),
  public.november_punishment_preview(), public.seed_november_punishments(uuid), public.get_strike_cycle_total(uuid,text),
  public.manage_punishment_task(uuid,text,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.apply_nightly_strike(uuid,text,text,text,text,text,timestamptz,timestamptz),
  public.apply_nightly_strike(uuid,text,text,text,text,text,timestamptz,timestamptz,timestamptz,timestamptz,text,integer),
  public.refresh_member_strike_projection(uuid,timestamptz), public.reset_monthly_strikes(),
  public.adjust_member_strikes(uuid,integer,integer,boolean,text,text),
  public.november_punishment_preview(), public.seed_november_punishments(uuid), public.get_strike_cycle_total(uuid,text),
  public.manage_punishment_task(uuid,text,text,text,text)
  TO service_role;

COMMIT;

-- Expose the punishment workflow through service-role-only RPCs.
BEGIN;

CREATE OR REPLACE FUNCTION public.require_punishment_visibility()
RETURNS void LANGUAGE plpgsql STABLE SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT FROM public.punishment_rollout WHERE singleton AND screens_visible) THEN
    RAISE SQLSTATE 'PT503' USING MESSAGE = 'Punishments are currently unavailable.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.count_open_punishments(p_member_id uuid)
RETURNS integer LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT count(*)::integer FROM public.punishments
  WHERE member_id = p_member_id AND status IN ('pending', 'awaiting_assignment', 'assigned');
$$;

-- Use the already-effective timezone even if the schedule writer has not promoted it yet.
CREATE OR REPLACE FUNCTION public.punishment_progress_month(m public.members, now_at timestamptz)
RETURNS date LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT date_trunc('month', now_at AT TIME ZONE public.strike_member_zone(
    CASE WHEN m.pending_effective_at <= now_at
      THEN COALESCE(NULLIF(m.pending_timezone, ''), m.timezone)
      ELSE m.timezone END
  ))::date;
$$;

CREATE OR REPLACE FUNCTION public.get_member_punishments(p_member_id uuid, p_discord_id text, p_details boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m public.members%ROWTYPE;
  local_month date;
  total integer;
  passes integer;
  open_items jsonb;
  history jsonb;
  open_count integer;
BEGIN
  SELECT * INTO m FROM public.members WHERE id = p_member_id AND discord_id = p_discord_id AND is_active;
  IF NOT FOUND THEN
    RAISE SQLSTATE 'PT403' USING MESSAGE = 'Sign in with the Discord account linked to this profile.';
  END IF;
  PERFORM public.require_punishment_visibility();
  open_count := public.count_open_punishments(m.id);
  IF NOT p_details THEN RETURN jsonb_build_object('open_count', open_count); END IF;

  local_month := public.punishment_progress_month(m, statement_timestamp());
  SELECT count(*) INTO total FROM public.verified_monthly_strikes(m, local_month);
  SELECT COALESCE(
    (SELECT used FROM public.strike_pass_months WHERE member_id = m.id AND strike_pass_months.month_start = local_month),
    public.legacy_strike_passes(m, local_month)
  ) INTO passes;

  SELECT
    COALESCE(jsonb_agg(to_jsonb(p) - 'effective_status' || jsonb_build_object('status', p.effective_status)
      ORDER BY earned_cycle_date, threshold_number, id) FILTER (WHERE p.status IN ('pending','awaiting_assignment','assigned')), '[]'),
    COALESCE(jsonb_agg(to_jsonb(p) - 'effective_status' ORDER BY completed_at DESC, id)
      FILTER (WHERE p.status = 'completed'), '[]')
    INTO open_items, history
  FROM public.punishment_task_status AS p WHERE p.member_id = m.id AND p.status <> 'canceled';

  RETURN jsonb_build_object('member_id', m.id, 'month', to_char(local_month, 'YYYY-MM'),
    'strikes_used', total, 'metastrikes_used', passes, 'strikes_toward_next', total % 3, 'strikes_per_punishment', 3,
    'open_count', open_count, 'open_items', open_items, 'history', history);
END;
$$;

-- Read one case with its correction sources, or one status section of the work queue.
CREATE OR REPLACE FUNCTION public.get_moderator_punishments(p_id uuid, p_status text, p_offset integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m public.members%ROWTYPE;
  item public.punishment_task_status%ROWTYPE;
  items jsonb;
  strikes jsonb;
BEGIN
  PERFORM public.require_punishment_visibility();
  IF p_id IS NOT NULL THEN
    SELECT * INTO item FROM public.punishment_task_status WHERE id = p_id;
    IF NOT FOUND THEN RAISE SQLSTATE 'PT404' USING MESSAGE = 'Punishment not found.'; END IF;
    SELECT * INTO STRICT m FROM public.members WHERE id = item.member_id;
    SELECT COALESCE(jsonb_agg(s ORDER BY cycle_date, qualified_at, source_id), '[]')
      INTO strikes FROM public.verified_monthly_strikes(m, item.earned_month) AS s;
    RETURN jsonb_build_object('item', to_jsonb(item) - 'effective_status'
        || jsonb_build_object('status', item.effective_status, 'member_name', m.discord_username),
      'open_count', public.count_open_punishments(m.id), 'verified_strikes', strikes);
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('awaiting_assignment', 'assigned', 'pending')
    OR p_offset IS NULL OR p_offset < 0 OR p_offset > 2147483597 THEN
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'Invalid punishment queue filter.';
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(p) - 'effective_status'
    || jsonb_build_object('status', p.effective_status) ORDER BY earned_cycle_date, id), '[]') INTO items
  FROM (
    SELECT p.*, member.discord_username AS member_name FROM public.punishment_task_status AS p
    JOIN public.members AS member ON member.id = p.member_id WHERE p.effective_status = p_status
    ORDER BY p.earned_cycle_date, p.id LIMIT 51 OFFSET p_offset
  ) AS p;
  RETURN CASE WHEN jsonb_array_length(items) > 50
    THEN jsonb_build_object('items', items - 50, 'next_offset', p_offset + 50)
    ELSE jsonb_build_object('items', items, 'next_offset', NULL) END;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_dated_strike_correction(
  p_member_id uuid, p_cycle date, p_evidence_key text, p_actor text, p_reason text,
  p_void_source uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  activation timestamptz;
  m public.members%ROWTYPE;
  prior public.strike_moderator_corrections%ROWTYPE;
  source_record record;
  correction_id uuid;
  now_at timestamptz;
  target_month date;
  action_name text := 'add_strike';
  snapshot jsonb;
BEGIN
  SELECT activated_at INTO STRICT activation FROM public.punishment_rollout WHERE singleton FOR SHARE;
  SELECT * INTO STRICT m FROM public.members WHERE id = p_member_id FOR NO KEY UPDATE;
  now_at := clock_timestamp();
  IF p_cycle IS NULL OR p_cycle < date '2026-11-01'
    OR p_cycle > (now_at AT TIME ZONE public.strike_member_zone(m.timezone))::date
    OR nullif(btrim(p_evidence_key), '') IS NULL OR nullif(btrim(p_actor), '') IS NULL
    OR nullif(btrim(p_reason), '') IS NULL THEN
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'A dated strike correction requires a valid date, reference, actor and reason.';
  END IF;
  target_month := date_trunc('month', p_cycle::timestamp)::date;
  SELECT * INTO prior FROM public.strike_moderator_corrections WHERE evidence_key = p_evidence_key;
  IF FOUND THEN
    IF (prior.member_id, prior.cycle_date, prior.source_id, prior.actor, prior.reason)
      IS DISTINCT FROM (p_member_id, p_cycle, p_void_source, p_actor, p_reason) THEN
      RAISE SQLSTATE 'PT409' USING MESSAGE = 'This evidence reference already records a different correction.';
    END IF;
    RETURN prior.id;
  END IF;
  IF p_void_source IS NOT NULL THEN
    SELECT * INTO source_record FROM public.verified_monthly_strikes(m, target_month)
      WHERE source_id = p_void_source AND cycle_date = p_cycle;
    IF NOT FOUND THEN RAISE SQLSTATE 'PT400' USING MESSAGE = 'No valid strike matches the correction.'; END IF;
    IF source_record.source_type = 'nightly' THEN
      action_name := 'clear_nightly';
      DELETE FROM public.nightly_strike_logs AS n WHERE n.id = p_void_source RETURNING to_jsonb(n) INTO snapshot;
    ELSE
      action_name := 'void_adjustment';
    END IF;
  END IF;
  INSERT INTO public.strike_moderator_corrections(member_id, cycle_date, action, source_id, evidence_key, actor, reason, details, recorded_at)
    VALUES (m.id, p_cycle, action_name, p_void_source, p_evidence_key, p_actor, p_reason, snapshot, now_at)
    RETURNING id INTO correction_id;
  IF activation IS NOT NULL THEN
    PERFORM public.reconcile_punishments(m, target_month, now_at, p_actor);
    PERFORM public.project_member_strikes(m, date_trunc('month', now_at AT TIME ZONE public.strike_member_zone(m.timezone))::date);
  END IF;
  RETURN correction_id;
END;
$$;

-- The launch import keeps its November-only contract and shares the audit/reconciliation path.
CREATE OR REPLACE FUNCTION public.record_verified_november_correction(
  p_member_id uuid, p_cycle date, p_evidence_key text, p_actor text, p_reason text, p_void_source uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_cycle IS NULL OR p_cycle < date '2026-11-01' OR p_cycle >= date '2026-12-01' THEN
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'A documented November correction requires a November cycle date.';
  END IF;
  RETURN public.record_dated_strike_correction(p_member_id, p_cycle, p_evidence_key, p_actor, p_reason, p_void_source);
END;
$$;

-- One transaction for the existing task state machine and dated corrections.
CREATE OR REPLACE FUNCTION public.update_punishment(
  p_id uuid, p_action text, p_actor text, p_title text DEFAULT NULL, p_instructions text DEFAULT NULL,
  p_cycle date DEFAULT NULL, p_source uuid DEFAULT NULL, p_reason text DEFAULT NULL, p_request_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m public.members%ROWTYPE;
  item public.punishment_task_status%ROWTYPE;
  correction_id uuid;
BEGIN
  -- Match the strike writers' rollout/member lock order. Visibility cannot
  -- change halfway through a write, and all writes for this member serialize.
  PERFORM FROM public.punishment_rollout WHERE singleton FOR SHARE;
  PERFORM public.require_punishment_visibility();
  SELECT * INTO item FROM public.punishment_task_status WHERE id = p_id;
  IF NOT FOUND THEN RAISE SQLSTATE 'PT404' USING MESSAGE = 'Punishment not found.'; END IF;
  SELECT * INTO m FROM public.members WHERE id = item.member_id FOR NO KEY UPDATE;
  SELECT * INTO item FROM public.punishment_task_status WHERE id = p_id;
  IF NOT FOUND THEN RAISE SQLSTATE 'PT404' USING MESSAGE = 'Punishment not found.'; END IF;
  IF nullif(btrim(p_actor), '') IS NULL THEN
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'Moderator identity is required.';
  END IF;

  IF p_action IN ('add_strike', 'remove_strike') THEN
    IF p_cycle IS NULL OR date_trunc('month', p_cycle::timestamp)::date <> item.earned_month
      OR p_request_id IS NULL OR (p_action = 'remove_strike') <> (p_source IS NOT NULL)
      OR nullif(btrim(p_reason), '') IS NULL OR length(p_reason) > 500 THEN
      RAISE SQLSTATE 'PT400' USING MESSAGE = 'Enter a date in the earned month, a reason, and a request ID. Removal requires a strike source.';
    END IF;
    correction_id := public.record_dated_strike_correction(m.id, p_cycle,
      'punishment:' || p_id || ':' || p_request_id, p_actor, p_reason, p_source);
  ELSIF p_action IN ('assign', 'edit', 'complete') THEN
    -- An immediate retry of the same saved assignment/edit should return the current state.
    IF item.status <> 'assigned' OR p_action = 'complete'
      OR (item.title, item.instructions) IS DISTINCT FROM (nullif(btrim(p_title), ''), nullif(btrim(p_instructions), '')) THEN
      PERFORM public.manage_punishment_task(p_id, p_action, p_actor, p_title, p_instructions);
    END IF;
  ELSE
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'Unknown punishment action.';
  END IF;
  SELECT * INTO STRICT item FROM public.punishment_task_status WHERE id = p_id;
  RETURN jsonb_build_object('success', true, 'item', to_jsonb(item) - 'effective_status'
      || jsonb_build_object('status', item.effective_status, 'member_name', m.discord_username),
    'open_count', public.count_open_punishments(m.id), 'correction_id', correction_id);
END;
$$;

REVOKE ALL ON FUNCTION public.require_punishment_visibility(), public.count_open_punishments(uuid),
  public.punishment_progress_month(public.members,timestamptz),
  public.record_dated_strike_correction(uuid,date,text,text,text,uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_member_punishments(uuid,text,boolean),
  public.get_moderator_punishments(uuid,text,integer), public.update_punishment(uuid,text,text,text,text,date,uuid,text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_member_punishments(uuid,text,boolean),
  public.get_moderator_punishments(uuid,text,integer), public.update_punishment(uuid,text,text,text,text,date,uuid,text,uuid)
  TO service_role;

COMMIT;

-- Complete a specific open check-in atomically with its history and wake marker.
BEGIN;

CREATE OR REPLACE FUNCTION public.complete_active_check_in(
  p_discord_id text, p_expected_in_bed_at timestamptz, p_entry jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  entry public.sleep_logs := jsonb_populate_record(NULL::public.sleep_logs, p_entry);
  member public.members;
  saved public.sleep_logs;
  checked_in_at timestamptz;
BEGIN
  SELECT * INTO member FROM public.members WHERE id = entry.member_id FOR UPDATE;
  IF NOT FOUND OR NOT member.is_active OR member.discord_id IS DISTINCT FROM p_discord_id THEN
    RAISE SQLSTATE 'PT403' USING MESSAGE = 'This profile is no longer available.';
  END IF;

  SELECT * INTO saved FROM public.sleep_logs
    WHERE member_id = member.id AND cycle_date = entry.cycle_date;
  SELECT dispatched_at INTO checked_in_at FROM public.notification_logs
    WHERE member_id = member.id AND local_date = entry.cycle_date::date AND notification_type = 'IN_BED_EARLY';
  checked_in_at := COALESCE(checked_in_at, saved.in_bed_at);

  IF (checked_in_at IS NULL AND NOT COALESCE(
      member.last_notified_stage = 'IN_BED_EARLY' AND member.last_notified_cycle_date = entry.cycle_date, false))
    OR (member.last_notified_stage = 'IN_BED_EARLY' AND member.last_notified_cycle_date IS DISTINCT FROM entry.cycle_date)
    OR member.last_wake_cycle_date = entry.cycle_date
    OR checked_in_at IS DISTINCT FROM p_expected_in_bed_at
    OR (saved.in_bed_at IS NOT NULL AND saved.in_bed_at IS DISTINCT FROM checked_in_at)
    OR saved.woke_up_at IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.notification_logs
      WHERE member_id = member.id AND local_date = entry.cycle_date::date AND notification_type = 'WOKE_UP')
  THEN
    RAISE SQLSTATE 'PT409' USING MESSAGE = 'This check-in changed. Refresh and try again.';
  END IF;

  INSERT INTO public.sleep_logs AS log (
    member_id, cycle_date, timezone, target_bedtime, target_wake_time, in_bed_at, in_bed_local_time,
    woke_up_at, woke_up_local_time, wake_source, duration_minutes, status
  ) VALUES (
    member.id, entry.cycle_date, entry.timezone, entry.target_bedtime, entry.target_wake_time,
    checked_in_at, entry.in_bed_local_time, entry.woke_up_at, entry.woke_up_local_time,
    entry.wake_source, entry.duration_minutes, entry.status
  )
  ON CONFLICT (member_id, cycle_date) DO UPDATE SET
    in_bed_at = EXCLUDED.in_bed_at, in_bed_local_time = EXCLUDED.in_bed_local_time,
    woke_up_at = EXCLUDED.woke_up_at, woke_up_local_time = EXCLUDED.woke_up_local_time,
    wake_source = EXCLUDED.wake_source, duration_minutes = EXCLUDED.duration_minutes,
    updated_at = statement_timestamp()
  RETURNING * INTO saved;

  UPDATE public.members SET last_woke_up_at = entry.woke_up_at, last_wake_cycle_date = entry.cycle_date,
    last_notified_stage = CASE WHEN last_notified_stage = 'IN_BED_EARLY' THEN NULL ELSE last_notified_stage END,
    updated_at = statement_timestamp()
    WHERE id = member.id RETURNING * INTO member;

  INSERT INTO public.notification_logs (member_id, notification_type, local_date)
    VALUES (member.id, 'WOKE_UP', entry.cycle_date::date);

  RETURN jsonb_build_object('member', to_jsonb(member), 'sleep_log', to_jsonb(saved));
END;
$$;

REVOKE ALL ON FUNCTION public.complete_active_check_in(text,timestamptz,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_active_check_in(text,timestamptz,jsonb) TO service_role;

COMMIT;

-- Operator-only checks and visibility gate for the November cutover.
BEGIN;

CREATE OR REPLACE FUNCTION public.punishment_ledger_issues(p_month date DEFAULT date '2026-11-01')
RETURNS TABLE (member_id uuid, threshold_number integer, punishment_id uuid, issue text)
LANGUAGE sql VOLATILE SET search_path = '' AS $$
  -- The caller may have waited on the rollout lock past a replacement deadline.
  WITH verification_time AS MATERIALIZED (
    SELECT clock_timestamp() AS checked_at
  ), expected AS (
    SELECT m.id AS member_id, t.*
    FROM public.members AS m
    CROSS JOIN LATERAL public.earned_punishment_thresholds(m, p_month) AS t
  ), stored AS (
    SELECT p.* FROM public.punishments AS p WHERE p.earned_month = p_month
  ), compared AS (
    SELECT COALESCE(e.member_id, p.member_id) AS member_id,
      COALESCE(e.threshold_number, p.threshold_number) AS threshold_number, p.id AS punishment_id,
      CASE
        WHEN p.id IS NULL THEN 'missing_task'
        WHEN e.member_id IS NOT NULL AND p.status = 'canceled' THEN 'eligible_task_canceled'
        WHEN e.member_id IS NULL AND p.status NOT IN ('completed', 'canceled') THEN 'ineligible_open_task'
        WHEN p.status IN ('pending', 'awaiting_assignment') AND
          (p.earned_cycle_date, p.qualified_at, p.assignable_at) IS DISTINCT FROM
          (e.earned_cycle_date, e.qualified_at, e.assignable_at) THEN 'unassigned_task_dates_differ'
        WHEN p.status = 'awaiting_assignment' AND p.assignable_at > (SELECT checked_at FROM verification_time)
          THEN 'task_assignable_before_deadline'
      END AS issue
    FROM expected AS e FULL JOIN stored AS p USING (member_id, threshold_number)
  )
  SELECT c.member_id, c.threshold_number, c.punishment_id, c.issue
  FROM compared AS c WHERE c.issue IS NOT NULL
  UNION ALL
  SELECT p.member_id, p.threshold_number, p.id, 'invalid_earned_action_count'
  FROM stored AS p
  WHERE (SELECT count(*) FROM public.punishment_actions AS a
    WHERE a.punishment_id = p.id AND a.action = 'earned') <> 1
  UNION ALL
  SELECT m.id, NULL::integer, NULL::uuid, 'missing_november_pass_balance'
  FROM public.members AS m
  CROSS JOIN public.punishment_rollout AS r
  WHERE p_month = date '2026-11-01' AND r.singleton AND m.created_at <= r.activated_at
    AND NOT EXISTS (SELECT FROM public.strike_pass_months AS b
      WHERE b.member_id = m.id AND b.month_start = p_month);
$$;

CREATE OR REPLACE FUNCTION public.show_verified_november_punishments()
RETURNS timestamptz LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  activation timestamptz;
BEGIN
  -- Wait for any strike or seed transaction and fence new writes until the check commits.
  SELECT activated_at INTO STRICT activation
  FROM public.punishment_rollout WHERE singleton FOR NO KEY UPDATE;
  IF activation IS NULL THEN
    RAISE SQLSTATE 'PT409' USING MESSAGE = 'Activate and seed the punishment ledger before opening screens.';
  END IF;
  IF EXISTS (SELECT FROM public.punishment_ledger_issues()) THEN
    RAISE SQLSTATE 'PT409' USING
      MESSAGE = 'November punishment verification failed.',
      HINT = 'Run public.punishment_ledger_issues() for the member and threshold discrepancies.';
  END IF;
  UPDATE public.punishment_rollout SET screens_visible = true WHERE singleton AND NOT screens_visible;
  RETURN activation;
END;
$$;

REVOKE ALL ON FUNCTION public.punishment_ledger_issues(date), public.show_verified_november_punishments()
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
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

-- Bind staff writes to the signed Discord actor and the live target in one transaction.
BEGIN;

DROP FUNCTION IF EXISTS public.reserve_moderator_passcode_attempt(text, timestamptz);

CREATE TABLE IF NOT EXISTS public.moderation_actions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid NOT NULL,
  target_id uuid,
  action text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
ALTER TABLE public.moderation_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.moderation_actions FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.lock_moderation_actor(p_actor_id uuid, p_actor_discord_id text, p_owner_only boolean)
RETURNS text LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  actor_role text;
BEGIN
  SELECT role INTO actor_role FROM public.members
    WHERE id = p_actor_id AND discord_id = p_actor_discord_id AND is_active FOR SHARE;
  IF actor_role IS NULL OR actor_role NOT IN ('owner', 'moderator') OR (p_owner_only AND actor_role <> 'owner') THEN
    RAISE SQLSTATE 'PT403' USING MESSAGE = 'Your staff access has changed.';
  END IF;
  RETURN actor_role;
END;
$$;

CREATE OR REPLACE FUNCTION public.lock_moderation_target(
  p_actor_id uuid, p_actor_discord_id text, p_target_id uuid, p_owner_only boolean DEFAULT false
) RETURNS public.members LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  actor_role text;
  target public.members;
BEGIN
  actor_role := public.lock_moderation_actor(p_actor_id, p_actor_discord_id, p_owner_only);
  IF p_target_id = p_actor_id THEN
    RAISE SQLSTATE 'PT403' USING MESSAGE = 'Use self-service for your own profile.';
  END IF;
  SELECT * INTO target FROM public.members WHERE id = p_target_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE SQLSTATE 'PT404' USING MESSAGE = 'Member not found.';
  END IF;
  IF target.role = 'owner' OR (actor_role = 'moderator' AND target.role <> 'member') THEN
    RAISE SQLSTATE 'PT403' USING MESSAGE = 'You cannot manage this profile.';
  END IF;
  RETURN target;
END;
$$;

CREATE OR REPLACE FUNCTION public.moderate_roster_member(
  p_actor_id uuid, p_actor_discord_id text, p_target_id uuid, p_action text,
  p_updates jsonb DEFAULT '{}', p_expected_updated_at timestamptz DEFAULT NULL,
  p_expected_pending jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m public.members;
  reviewed public.members;
  edited public.members;
BEGIN
  m := public.lock_moderation_target(p_actor_id, p_actor_discord_id, p_target_id,
    p_action IN ('toggle_active', 'delete_member'));
  IF p_action = 'delete_member' THEN
    DELETE FROM public.members WHERE id = m.id;
  ELSIF p_action = 'toggle_active' THEN
    UPDATE public.members SET is_active = (p_updates->>'is_active')::boolean,
      updated_at = statement_timestamp() WHERE id = m.id RETURNING * INTO m;
  ELSIF p_action IN ('approve_cooldown', 'cancel_cooldown') THEN
    IF p_action = 'approve_cooldown' OR p_expected_pending IS NOT NULL THEN
      reviewed := jsonb_populate_record(NULL::public.members, p_expected_pending);
      IF (p_action = 'approve_cooldown' AND m.pending_effective_at IS NULL) OR
        ROW(m.pending_effective_at, m.pending_bedtime_local, m.pending_wake_time_local, m.pending_timezone,
          m.pending_weekend_bedtime_local, m.pending_weekend_wake_time_local, m.pending_weekly_schedule)
        IS DISTINCT FROM
        ROW(reviewed.pending_effective_at, reviewed.pending_bedtime_local, reviewed.pending_wake_time_local,
          reviewed.pending_timezone, reviewed.pending_weekend_bedtime_local, reviewed.pending_weekend_wake_time_local,
          reviewed.pending_weekly_schedule)
      THEN
        RAISE SQLSTATE 'PT409' USING MESSAGE = 'The pending schedule changed. Refresh and review it again.';
      END IF;
    END IF;
    IF p_action = 'approve_cooldown' THEN
      m.bedtime_local := COALESCE(m.pending_bedtime_local, m.bedtime_local);
      m.wake_time_local := COALESCE(m.pending_wake_time_local, m.wake_time_local);
      m.timezone := COALESCE(m.pending_timezone, m.timezone);
      IF m.pending_weekly_schedule IS NULL AND m.weekly_schedule IS NOT NULL THEN
        -- Legacy flat requests only replace the fields they supplied.
        SELECT jsonb_object_agg(day, entry || jsonb_strip_nulls(jsonb_build_object(
          'bedtime', CASE WHEN day IN ('fri', 'sat') THEN m.pending_weekend_bedtime_local ELSE m.pending_bedtime_local END,
          'wake_time', CASE WHEN day IN ('fri', 'sat') THEN m.pending_weekend_wake_time_local ELSE m.pending_wake_time_local END
        ))) INTO m.weekly_schedule FROM jsonb_each(m.weekly_schedule) AS schedule(day, entry);
        m.weekend_bedtime_local := COALESCE(m.pending_weekend_bedtime_local, m.weekend_bedtime_local);
        m.weekend_wake_time_local := COALESCE(m.pending_weekend_wake_time_local, m.weekend_wake_time_local);
      ELSE
        m.weekend_bedtime_local := m.pending_weekend_bedtime_local;
        m.weekend_wake_time_local := m.pending_weekend_wake_time_local;
        m.weekly_schedule := m.pending_weekly_schedule;
      END IF;
    END IF;
    UPDATE public.members SET bedtime_local = m.bedtime_local, wake_time_local = m.wake_time_local,
      timezone = m.timezone, weekend_bedtime_local = m.weekend_bedtime_local,
      weekend_wake_time_local = m.weekend_wake_time_local, weekly_schedule = m.weekly_schedule,
      pending_bedtime_local = NULL, pending_wake_time_local = NULL, pending_timezone = NULL,
      pending_weekend_bedtime_local = NULL, pending_weekend_wake_time_local = NULL,
      pending_weekly_schedule = NULL, pending_effective_at = NULL, updated_at = statement_timestamp()
      WHERE id = m.id RETURNING * INTO m;
  ELSIF p_action IN ('edit_member', 'edit_schedule') THEN
    IF m.updated_at IS DISTINCT FROM p_expected_updated_at THEN
      RAISE SQLSTATE 'PT409' USING MESSAGE = 'The profile changed. Refresh the roster and try again.';
    END IF;
    edited := jsonb_populate_record(m, CASE WHEN p_action = 'edit_schedule' THEN p_updates
      ELSE p_updates - ARRAY['bedtime_local', 'wake_time_local', 'timezone', 'weekend_bedtime_local',
        'weekend_wake_time_local', 'weekly_schedule', 'pending_bedtime_local', 'pending_wake_time_local',
        'pending_timezone', 'pending_weekend_bedtime_local', 'pending_weekend_wake_time_local',
        'pending_weekly_schedule', 'pending_effective_at'] END);
    UPDATE public.members SET discord_username = edited.discord_username, discord_handle = edited.discord_handle,
      journal_url = edited.journal_url, bedtime_local = edited.bedtime_local, wake_time_local = edited.wake_time_local,
      timezone = edited.timezone, weekend_bedtime_local = edited.weekend_bedtime_local,
      weekend_wake_time_local = edited.weekend_wake_time_local, weekly_schedule = edited.weekly_schedule,
      pending_bedtime_local = edited.pending_bedtime_local, pending_wake_time_local = edited.pending_wake_time_local,
      pending_timezone = edited.pending_timezone, pending_weekend_bedtime_local = edited.pending_weekend_bedtime_local,
      pending_weekend_wake_time_local = edited.pending_weekend_wake_time_local, pending_weekly_schedule = edited.pending_weekly_schedule,
      pending_effective_at = edited.pending_effective_at, updated_at = statement_timestamp()
      WHERE id = m.id RETURNING * INTO m;
  ELSE
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'Unknown roster action.';
  END IF;

  INSERT INTO public.moderation_actions(actor_id, target_id, action) VALUES (p_actor_id, p_target_id, p_action);
  RETURN to_jsonb(m);
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_moderation_demo_members(
  p_actor_id uuid, p_actor_discord_id text, p_profiles jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  purged jsonb;
BEGIN
  PERFORM public.lock_moderation_actor(p_actor_id, p_actor_discord_id, true);
  WITH removed AS (
    DELETE FROM public.members AS m
    USING jsonb_to_recordset(p_profiles) AS demo(id uuid, discord_username text, discord_handle text, journal_url text)
    WHERE m.id = demo.id AND m.role <> 'owner' AND m.discord_id IS NULL
      AND (m.discord_username, m.discord_handle, m.journal_url)
        IS NOT DISTINCT FROM (demo.discord_username, demo.discord_handle, demo.journal_url)
    RETURNING m.id, m.discord_username
  ), audited AS (
    INSERT INTO public.moderation_actions(actor_id, target_id, action)
      SELECT p_actor_id, id, 'purge_seed_member' FROM removed
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(removed)), '[]'::jsonb) INTO purged FROM removed;
  RETURN purged;
END;
$$;

CREATE OR REPLACE FUNCTION public.read_moderation_punishments(
  p_actor_id uuid, p_actor_discord_id text, p_id uuid, p_status text, p_offset integer
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor_role text;
  target public.members;
  items jsonb;
BEGIN
  SELECT role INTO actor_role FROM public.members
    WHERE id = p_actor_id AND discord_id = p_actor_discord_id AND is_active;
  IF actor_role IS NULL OR actor_role NOT IN ('owner', 'moderator') THEN
    RAISE SQLSTATE 'PT403' USING MESSAGE = 'Your staff access has changed.';
  END IF;
  PERFORM public.require_punishment_visibility();
  IF p_id IS NOT NULL THEN
    SELECT m.* INTO target FROM public.members AS m
      JOIN public.punishment_task_status AS p ON p.member_id = m.id WHERE p.id = p_id;
    IF NOT FOUND THEN RAISE SQLSTATE 'PT404' USING MESSAGE = 'Punishment not found.'; END IF;
    IF target.id = p_actor_id OR target.role = 'owner' OR (actor_role = 'moderator' AND target.role <> 'member') THEN
      RAISE SQLSTATE 'PT403' USING MESSAGE = 'You cannot manage this profile.';
    END IF;
    RETURN public.get_moderator_punishments(p_id, p_status, p_offset);
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('awaiting_assignment', 'assigned', 'pending')
    OR p_offset IS NULL OR p_offset < 0 OR p_offset > 2147483597 THEN
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'Invalid punishment queue filter.';
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(p) - 'effective_status'
    || jsonb_build_object('status', p.effective_status) ORDER BY earned_cycle_date, id), '[]') INTO items
  FROM (
    SELECT p.*, m.discord_username AS member_name FROM public.punishment_task_status AS p
      JOIN public.members AS m ON m.id = p.member_id
      WHERE p.effective_status = p_status AND m.id <> p_actor_id
        AND (m.role = 'member' OR (actor_role = 'owner' AND m.role = 'moderator'))
      ORDER BY p.earned_cycle_date, p.id LIMIT 51 OFFSET p_offset
  ) AS p;
  RETURN CASE WHEN jsonb_array_length(items) > 50
    THEN jsonb_build_object('items', items - 50, 'next_offset', p_offset + 50)
    ELSE jsonb_build_object('items', items, 'next_offset', NULL) END;
END;
$$;

CREATE OR REPLACE FUNCTION public.moderate_punishment(
  p_actor_id uuid, p_actor_discord_id text, p_id uuid, p_action text, p_title text DEFAULT NULL,
  p_instructions text DEFAULT NULL, p_cycle date DEFAULT NULL, p_source uuid DEFAULT NULL,
  p_reason text DEFAULT NULL, p_request_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  target_id uuid;
BEGIN
  PERFORM FROM public.punishment_rollout WHERE singleton FOR SHARE;
  PERFORM public.require_punishment_visibility();
  SELECT member_id INTO target_id FROM public.punishment_task_status WHERE id = p_id;
  IF NOT FOUND THEN RAISE SQLSTATE 'PT404' USING MESSAGE = 'Punishment not found.'; END IF;
  PERFORM public.lock_moderation_target(p_actor_id, p_actor_discord_id, target_id);
  RETURN public.update_punishment(p_id, p_action, p_actor_id::text, p_title, p_instructions,
    p_cycle, p_source, p_reason, p_request_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.moderate_nightly_strike(
  p_actor_id uuid, p_actor_discord_id text, p_member_id uuid, p_cycle text, p_month text,
  p_previous_type text, p_type text, p_reason text, p_now timestamptz, p_month_start timestamptz,
  p_strike_cutoff timestamptz, p_replacement_until timestamptz, p_schedule_revision integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  target public.members;
BEGIN
  IF p_type NOT IN ('clear', 'metastrike') THEN
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'Unsupported staff strike action.';
  END IF;
  PERFORM FROM public.punishment_rollout WHERE singleton FOR SHARE;
  target := public.lock_moderation_target(p_actor_id, p_actor_discord_id, p_member_id, p_type = 'clear');
  IF p_type = 'metastrike' AND NOT target.is_active THEN
    RAISE SQLSTATE 'PT403' USING MESSAGE = 'This profile is inactive.';
  END IF;
  RETURN public.apply_nightly_strike(p_member_id, p_cycle, p_month, p_previous_type, p_type,
    p_reason, p_now, p_month_start, p_strike_cutoff, p_replacement_until, p_actor_id::text, p_schedule_revision);
END;
$$;

CREATE OR REPLACE FUNCTION public.moderate_strike_counts(
  p_actor_id uuid, p_actor_discord_id text, p_member_id uuid, p_strikes integer, p_passes integer, p_relative boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM FROM public.punishment_rollout WHERE singleton FOR SHARE;
  PERFORM public.lock_moderation_target(p_actor_id, p_actor_discord_id, p_member_id, true);
  RETURN public.adjust_member_strikes(p_member_id, p_strikes, p_passes, p_relative, p_actor_id::text, 'Moderator count correction');
END;
$$;

-- Both entry points lock and authorize the member before removing sleep evidence.
CREATE OR REPLACE FUNCTION public.cancel_sleep_check_in(p_member_id uuid, p_cycle date, p_clear_pending boolean)
RETURNS public.members LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  m public.members;
BEGIN
  DELETE FROM public.notification_logs WHERE member_id = p_member_id AND local_date = p_cycle
    AND notification_type IN ('IN_BED_EARLY', 'WOKE_UP');
  DELETE FROM public.sleep_logs WHERE member_id = p_member_id AND cycle_date = p_cycle::text;
  UPDATE public.members SET
    last_notified_stage = CASE WHEN last_notified_stage = 'IN_BED_EARLY' OR last_notified_cycle_date = p_cycle::text
      THEN NULL ELSE last_notified_stage END,
    last_notified_cycle_date = CASE WHEN last_notified_stage = 'IN_BED_EARLY' OR last_notified_cycle_date = p_cycle::text
      THEN NULL ELSE last_notified_cycle_date END,
    last_woke_up_at = CASE WHEN last_wake_cycle_date = p_cycle::text THEN NULL ELSE last_woke_up_at END,
    last_wake_cycle_date = CASE WHEN last_wake_cycle_date = p_cycle::text THEN NULL ELSE last_wake_cycle_date END,
    pending_bedtime_local = CASE WHEN p_clear_pending THEN NULL ELSE pending_bedtime_local END,
    pending_wake_time_local = CASE WHEN p_clear_pending THEN NULL ELSE pending_wake_time_local END,
    pending_timezone = CASE WHEN p_clear_pending THEN NULL ELSE pending_timezone END,
    pending_weekend_bedtime_local = CASE WHEN p_clear_pending THEN NULL ELSE pending_weekend_bedtime_local END,
    pending_weekend_wake_time_local = CASE WHEN p_clear_pending THEN NULL ELSE pending_weekend_wake_time_local END,
    pending_weekly_schedule = CASE WHEN p_clear_pending THEN NULL ELSE pending_weekly_schedule END,
    pending_effective_at = CASE WHEN p_clear_pending THEN NULL ELSE pending_effective_at END,
    updated_at = statement_timestamp()
    WHERE id = p_member_id RETURNING * INTO m;
  RETURN m;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_own_sleep_check_in(
  p_member_id uuid, p_discord_id text, p_cycle date, p_clear_pending boolean, p_expected_updated_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m public.members;
BEGIN
  SELECT * INTO m FROM public.members
    WHERE id = p_member_id AND discord_id = p_discord_id AND is_active FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE SQLSTATE 'PT403' USING MESSAGE = 'This profile is no longer available.';
  END IF;
  IF m.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE SQLSTATE 'PT409' USING MESSAGE = 'This profile changed. Refresh and try again.';
  END IF;
  RETURN to_jsonb(public.cancel_sleep_check_in(m.id, p_cycle, p_clear_pending));
END;
$$;

DROP FUNCTION IF EXISTS public.moderate_sleep(uuid,text,uuid,text,date,timestamptz,timestamptz,jsonb,boolean,timestamptz);

CREATE OR REPLACE FUNCTION public.moderate_sleep(
  p_actor_id uuid, p_actor_discord_id text, p_target_id uuid, p_action text, p_cycle date, p_now timestamptz,
  p_expected_updated_at timestamptz, p_entry jsonb DEFAULT NULL, p_guarded boolean DEFAULT false,
  p_expected_in_bed_at timestamptz DEFAULT NULL, p_expected_sleep_updated_at timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m public.members;
  saved public.sleep_logs;
  entry public.sleep_logs;
  checked_in_at timestamptz;
  receipt text;
  result jsonb;
BEGIN
  m := public.lock_moderation_target(p_actor_id, p_actor_discord_id, p_target_id);
  IF NOT m.is_active THEN
    RAISE SQLSTATE 'PT403' USING MESSAGE = 'This profile is inactive.';
  END IF;
  IF m.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE SQLSTATE 'PT409' USING MESSAGE = 'This profile changed. Refresh and try again.';
  END IF;

  IF p_guarded AND p_action = 'log_wake' THEN
    result := public.complete_active_check_in(m.discord_id, p_expected_in_bed_at,
      p_entry || jsonb_build_object('member_id', m.id, 'cycle_date', p_cycle::text));
  ELSIF p_action IN ('cancel_checkin', 'cancel_pending_and_checkin') THEN
    m := public.cancel_sleep_check_in(m.id, p_cycle, p_action = 'cancel_pending_and_checkin');
    result := jsonb_build_object('member', to_jsonb(m));
  ELSIF p_action IN ('check_in', 'wake_up', 'log_wake') THEN
    SELECT * INTO saved FROM public.sleep_logs WHERE member_id = m.id AND cycle_date = p_cycle::text;
    IF p_action = 'log_wake' THEN
      -- The route uses sleep history first and falls back to the check-in receipt.
      SELECT COALESCE(saved.in_bed_at, (
        SELECT dispatched_at FROM public.notification_logs
          WHERE member_id = m.id AND local_date = p_cycle AND notification_type = 'IN_BED_EARLY'
      )) INTO checked_in_at;
      IF saved.updated_at IS DISTINCT FROM p_expected_sleep_updated_at OR
        checked_in_at IS DISTINCT FROM p_expected_in_bed_at THEN
        RAISE SQLSTATE 'PT409' USING MESSAGE = 'The sleep evidence changed. Refresh and try again.';
      END IF;
    END IF;
    entry := jsonb_populate_record(saved, p_entry);
    INSERT INTO public.sleep_logs (
      member_id, cycle_date, timezone, target_bedtime, target_wake_time, in_bed_at, in_bed_local_time,
      woke_up_at, woke_up_local_time, wake_source, duration_minutes, status
    ) VALUES (
      m.id, p_cycle::text, m.timezone, entry.target_bedtime, entry.target_wake_time, entry.in_bed_at, entry.in_bed_local_time,
      entry.woke_up_at, entry.woke_up_local_time, entry.wake_source, entry.duration_minutes, COALESCE(entry.status, 'on_time')
    ) ON CONFLICT (member_id, cycle_date) DO UPDATE SET
      timezone = EXCLUDED.timezone, target_bedtime = EXCLUDED.target_bedtime,
      target_wake_time = EXCLUDED.target_wake_time, in_bed_at = EXCLUDED.in_bed_at, in_bed_local_time = EXCLUDED.in_bed_local_time,
      woke_up_at = EXCLUDED.woke_up_at, woke_up_local_time = EXCLUDED.woke_up_local_time, wake_source = EXCLUDED.wake_source,
      duration_minutes = EXCLUDED.duration_minutes, status = EXCLUDED.status, updated_at = statement_timestamp()
    RETURNING * INTO saved;

    receipt := CASE WHEN p_action = 'check_in' THEN 'IN_BED_EARLY' ELSE 'WOKE_UP' END;
    IF p_action <> 'log_wake' THEN
      DELETE FROM public.notification_logs WHERE member_id = m.id AND local_date = p_cycle
        AND notification_type IN ('IN_BED_EARLY', 'WOKE_UP') AND notification_type <> receipt;
    END IF;
    INSERT INTO public.notification_logs (member_id, notification_type, local_date, dispatched_at)
      VALUES (m.id, receipt, p_cycle, p_now)
      ON CONFLICT (member_id, notification_type, local_date) DO UPDATE SET dispatched_at = EXCLUDED.dispatched_at;

    UPDATE public.members SET
      last_notified_stage = CASE WHEN p_action = 'check_in' THEN receipt
        WHEN last_notified_stage = 'IN_BED_EARLY' AND last_notified_cycle_date = p_cycle::text THEN NULL
        ELSE last_notified_stage END,
      last_notified_cycle_date = CASE WHEN p_action = 'check_in' THEN p_cycle::text ELSE last_notified_cycle_date END,
      last_woke_up_at = CASE WHEN p_action = 'check_in' THEN NULL
        WHEN last_woke_up_at IS NULL OR entry.woke_up_at >= last_woke_up_at THEN entry.woke_up_at ELSE last_woke_up_at END,
      last_wake_cycle_date = CASE WHEN p_action = 'check_in' THEN NULL
        WHEN last_woke_up_at IS NULL OR entry.woke_up_at >= last_woke_up_at THEN p_cycle::text ELSE last_wake_cycle_date END,
      updated_at = statement_timestamp()
      WHERE id = m.id RETURNING * INTO m;
    result := jsonb_build_object('member', to_jsonb(m), 'sleep_log', to_jsonb(saved));
  ELSE
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'Unknown sleep correction.';
  END IF;

  INSERT INTO public.moderation_actions(actor_id, target_id, action) VALUES (p_actor_id, p_target_id, p_action);
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_moderation_webhook_action(
  p_actor_id uuid, p_actor_discord_id text, p_action text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.lock_moderation_actor(p_actor_id, p_actor_discord_id, true);
  IF p_action NOT IN ('test', 'digest') THEN
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'Unknown webhook action.';
  END IF;
  INSERT INTO public.moderation_actions(actor_id, action) VALUES (p_actor_id, 'webhook_' || p_action);
END;
$$;

REVOKE ALL ON FUNCTION public.lock_moderation_actor(uuid,text,boolean),
  public.lock_moderation_target(uuid,text,uuid,boolean), public.cancel_sleep_check_in(uuid,date,boolean)
FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.moderate_roster_member(uuid,text,uuid,text,jsonb,timestamptz,jsonb),
  public.purge_moderation_demo_members(uuid,text,jsonb),
  public.read_moderation_punishments(uuid,text,uuid,text,integer),
  public.moderate_punishment(uuid,text,uuid,text,text,text,date,uuid,text,uuid),
  public.moderate_nightly_strike(uuid,text,uuid,text,text,text,text,text,timestamptz,timestamptz,timestamptz,timestamptz,integer),
  public.moderate_strike_counts(uuid,text,uuid,integer,integer,boolean),
  public.cancel_own_sleep_check_in(uuid,text,date,boolean,timestamptz),
  public.moderate_sleep(uuid,text,uuid,text,date,timestamptz,timestamptz,jsonb,boolean,timestamptz,timestamptz),
  public.record_moderation_webhook_action(uuid,text,text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.moderate_roster_member(uuid,text,uuid,text,jsonb,timestamptz,jsonb),
  public.purge_moderation_demo_members(uuid,text,jsonb),
  public.read_moderation_punishments(uuid,text,uuid,text,integer),
  public.moderate_punishment(uuid,text,uuid,text,text,text,date,uuid,text,uuid),
  public.moderate_nightly_strike(uuid,text,uuid,text,text,text,text,text,timestamptz,timestamptz,timestamptz,timestamptz,integer),
  public.moderate_strike_counts(uuid,text,uuid,integer,integer,boolean),
  public.cancel_own_sleep_check_in(uuid,text,date,boolean,timestamptz),
  public.moderate_sleep(uuid,text,uuid,text,date,timestamptz,timestamptz,jsonb,boolean,timestamptz,timestamptz),
  public.record_moderation_webhook_action(uuid,text,text)
TO service_role;

COMMIT;

-- Distinguish the closed screen gate and add an operator-only rolling ledger check.
BEGIN;

CREATE OR REPLACE FUNCTION public.require_punishment_visibility()
RETURNS void LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  visible boolean;
BEGIN
  SELECT screens_visible INTO STRICT visible FROM public.punishment_rollout WHERE singleton;
  IF NOT visible THEN
    RAISE SQLSTATE 'PT503' USING MESSAGE = 'Punishments are closed for now.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.recent_punishment_ledger_issues(p_as_of timestamptz DEFAULT statement_timestamp())
RETURNS TABLE (member_id uuid, earned_month date, threshold_number integer, punishment_id uuid, issue text)
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT FROM public.punishment_rollout WHERE singleton AND activated_at <= p_as_of) THEN
    RAISE SQLSTATE 'PT409' USING MESSAGE = 'The punishment ledger is inactive at the audit time.';
  END IF;

  -- p_as_of selects local months from the current snapshot. The fixed-month audit checks live deadlines.
  RETURN QUERY
  WITH member_months AS MATERIALIZED (
    SELECT m.id, month.start_on
    FROM public.members AS m
    CROSS JOIN LATERAL (SELECT public.punishment_progress_month(m, p_as_of) AS local_month) AS progress
    CROSS JOIN LATERAL (VALUES (progress.local_month), ((progress.local_month - interval '1 month')::date)) AS month(start_on)
    WHERE month.start_on >= date '2026-11-01'
  ), months AS (
    SELECT DISTINCT scope.start_on FROM member_months AS scope
  ), findings AS MATERIALIZED (
    SELECT month.start_on, finding.*
    FROM months AS month
    CROSS JOIN LATERAL public.punishment_ledger_issues(month.start_on) AS finding
  )
  SELECT finding.member_id, finding.start_on, finding.threshold_number, finding.punishment_id,
    CASE WHEN finding.issue = 'invalid_earned_action_count' THEN
      CASE WHEN EXISTS (SELECT FROM public.punishment_actions AS a
                         WHERE a.punishment_id = finding.punishment_id AND a.action = 'earned')
        THEN 'duplicate_earned_actions' ELSE 'missing_earned_action' END
      ELSE finding.issue END
  FROM findings AS finding
  JOIN member_months AS scope ON scope.id = finding.member_id AND scope.start_on = finding.start_on;
END;
$$;

REVOKE ALL ON FUNCTION public.recent_punishment_ledger_issues(timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;

-- Review and correct dated strikes from the roster independently of punishment tasks.
BEGIN;

CREATE OR REPLACE FUNCTION public.staff_strike_month(m public.members, p_month date)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  now_at timestamptz := statement_timestamp();
  zone text := public.strike_member_zone(
    CASE WHEN m.pending_effective_at <= now_at
      THEN COALESCE(NULLIF(m.pending_timezone, ''), m.timezone) ELSE m.timezone END);
  local_day date := (now_at AT TIME ZONE zone)::date;
  current_month date := date_trunc('month', local_day::timestamp)::date;
  selected_month date := COALESCE(p_month, current_month);
  sources jsonb;
BEGIN
  IF selected_month < date '2026-11-01' OR selected_month > current_month
    OR extract(day FROM selected_month) <> 1 THEN
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'Choose an available strike month.';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('source_id', s.source_id, 'source_type', s.source_type,
    'cycle_date', s.cycle_date, 'reason', COALESCE(c.reason, n.reason))
    ORDER BY s.cycle_date DESC, s.qualified_at DESC, s.source_id), '[]')
    INTO sources
    FROM public.verified_monthly_strikes(m, selected_month) AS s
    LEFT JOIN public.strike_moderator_corrections AS c ON s.source_type = 'moderator' AND c.id = s.source_id
    LEFT JOIN public.nightly_strike_logs AS n ON s.source_type = 'nightly' AND n.id = s.source_id;

  RETURN jsonb_build_object('month', to_char(selected_month, 'YYYY-MM'),
    'current_month', to_char(current_month, 'YYYY-MM'), 'latest_cycle_date', local_day,
    'verified_strikes', sources, 'strikes_used', jsonb_array_length(sources),
    'open_count', public.count_open_punishments(m.id));
END;
$$;

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
  SELECT * INTO target FROM public.members WHERE id = p_member_id;
  IF NOT FOUND THEN RAISE SQLSTATE 'PT404' USING MESSAGE = 'Member not found.'; END IF;
  IF target.id = p_actor_id OR target.role = 'owner' OR (actor_role = 'moderator' AND target.role <> 'member') THEN
    RAISE SQLSTATE 'PT403' USING MESSAGE = 'You cannot manage this profile.';
  END IF;
  PERFORM public.require_punishment_visibility();
  RETURN public.staff_strike_month(target, p_month);
END;
$$;

CREATE OR REPLACE FUNCTION public.moderate_dated_strike(
  p_actor_id uuid, p_actor_discord_id text, p_member_id uuid, p_action text,
  p_cycle date, p_source uuid, p_reason text, p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
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
  target := public.lock_moderation_target(p_actor_id, p_actor_discord_id, p_member_id);
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

-- Preserve pass balance edits for older clients. Strike counters now require
-- dated evidence even if an older app instance sends a generic edit.
CREATE OR REPLACE FUNCTION public.moderate_strike_counts(
  p_actor_id uuid, p_actor_discord_id text, p_member_id uuid, p_strikes integer, p_passes integer, p_relative boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM FROM public.punishment_rollout WHERE singleton FOR SHARE;
  PERFORM public.lock_moderation_target(p_actor_id, p_actor_discord_id, p_member_id, true);
  IF p_strikes IS NOT NULL AND (p_relative IS DISTINCT FROM true OR p_strikes <> 0) THEN
    RAISE SQLSTATE 'PT409' USING MESSAGE = 'Use Review strikes to make a dated strike correction.';
  END IF;
  RETURN public.adjust_member_strikes(p_member_id, NULL, p_passes, p_relative,
    p_actor_id::text, 'Moderator pass balance correction');
END;
$$;

CREATE OR REPLACE FUNCTION public.moderate_nightly_strike(
  p_actor_id uuid, p_actor_discord_id text, p_member_id uuid, p_cycle text, p_month text,
  p_previous_type text, p_type text, p_reason text, p_now timestamptz, p_month_start timestamptz,
  p_strike_cutoff timestamptz, p_replacement_until timestamptz, p_schedule_revision integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  target public.members;
BEGIN
  IF p_type IS NULL OR p_type NOT IN ('clear', 'metastrike') THEN
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'Unsupported staff strike action.';
  END IF;
  PERFORM FROM public.punishment_rollout WHERE singleton FOR SHARE;
  target := public.lock_moderation_target(p_actor_id, p_actor_discord_id, p_member_id, p_type = 'clear');
  IF p_type = 'clear' AND p_previous_type IS DISTINCT FROM 'metastrike' THEN
    RAISE SQLSTATE 'PT409' USING MESSAGE = 'Use Review strikes to remove a dated strike.';
  END IF;
  IF p_type = 'metastrike' AND NOT target.is_active THEN
    RAISE SQLSTATE 'PT403' USING MESSAGE = 'This profile is inactive.';
  END IF;
  RETURN public.apply_nightly_strike(p_member_id, p_cycle, p_month, p_previous_type, p_type,
    p_reason, p_now, p_month_start, p_strike_cutoff, p_replacement_until, p_actor_id::text, p_schedule_revision);
END;
$$;

REVOKE ALL ON FUNCTION public.staff_strike_month(public.members,date),
  public.adjust_member_strikes(uuid,integer,integer,boolean,text,text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.read_moderation_strike_month(uuid,text,uuid,date),
  public.moderate_dated_strike(uuid,text,uuid,text,date,uuid,text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_moderation_strike_month(uuid,text,uuid,date),
  public.moderate_dated_strike(uuid,text,uuid,text,date,uuid,text,uuid) TO service_role;

COMMIT;

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

-- Enable roster strike corrections and shared calendar history independently of punishment visibility.
BEGIN;

CREATE OR REPLACE FUNCTION public.staff_strike_month(m public.members, p_month date)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  now_at timestamptz := statement_timestamp();
  zone text := public.strike_member_zone(
    CASE WHEN m.pending_effective_at <= now_at
      THEN COALESCE(NULLIF(m.pending_timezone, ''), m.timezone) ELSE m.timezone END);
  local_day date := (now_at AT TIME ZONE zone)::date;
  current_month date := date_trunc('month', local_day::timestamp)::date;
  selected_month date := COALESCE(p_month, current_month);
  sources jsonb;
  rollout public.punishment_rollout;
BEGIN
  IF selected_month < date '2026-11-01' OR selected_month > current_month
    OR extract(day FROM selected_month) <> 1 THEN
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'Choose an available strike month.';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('source_id', s.source_id, 'source_type', s.source_type,
    'cycle_date', s.cycle_date, 'reason', COALESCE(c.reason, n.reason))
    ORDER BY s.cycle_date DESC, s.qualified_at DESC, s.source_id), '[]')
    INTO sources
    FROM public.verified_monthly_strikes(m, selected_month) AS s
    LEFT JOIN public.strike_moderator_corrections AS c ON s.source_type = 'moderator' AND c.id = s.source_id
    LEFT JOIN public.nightly_strike_logs AS n ON s.source_type = 'nightly' AND n.id = s.source_id;

  SELECT * INTO STRICT rollout FROM public.punishment_rollout WHERE singleton;
  RETURN jsonb_build_object('month', to_char(selected_month, 'YYYY-MM'),
    'current_month', to_char(current_month, 'YYYY-MM'), 'latest_cycle_date', local_day,
    'verified_strikes', sources, 'strikes_used', jsonb_array_length(sources),
    'current_strikes_used', CASE
      WHEN rollout.activated_at IS NOT NULL AND selected_month = current_month THEN jsonb_array_length(sources)
      WHEN m.strike_cycle_month = to_char(current_month, 'YYYY-MM') THEN greatest(m.strikes_used, m.strikes_count)
      ELSE 0 END,
    'open_count', CASE WHEN rollout.screens_visible THEN public.count_open_punishments(m.id) END);
END;
$$;

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
  activation timestamptz;
  current_month date;
  cycle_month date := date_trunc('month', p_cycle::timestamp)::date;
  already_recorded boolean;
  legacy_count integer;
  evidence text := 'roster:' || p_request_id;
BEGIN
  IF p_cycle IS NULL OR p_request_id IS NULL OR p_action IS NULL
    OR p_action NOT IN ('add_strike', 'remove_strike')
    OR (p_action = 'remove_strike') <> (p_source IS NOT NULL)
    OR nullif(btrim(p_reason), '') IS NULL OR length(btrim(p_reason)) > 500 THEN
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'Enter a cycle date, reason and request ID. Removal requires a strike source.';
  END IF;

  SELECT activated_at INTO STRICT activation FROM public.punishment_rollout WHERE singleton FOR SHARE;
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
  SELECT EXISTS (SELECT FROM public.strike_moderator_corrections WHERE evidence_key = evidence)
    INTO already_recorded;

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

  -- The legacy dispatcher still uses the compatibility counters. Apply each
  -- current-month correction once without deriving a balance from incomplete history.
  IF activation IS NULL AND NOT already_recorded THEN
    current_month := public.punishment_progress_month(target, statement_timestamp());
    IF cycle_month = current_month THEN
      IF target.strike_cycle_month < to_char(current_month, 'YYYY-MM') THEN
        PERFORM public.refresh_member_strike_projection(target.id, statement_timestamp());
        SELECT * INTO target FROM public.members WHERE id = p_member_id;
      END IF;
      IF target.strike_cycle_month = to_char(current_month, 'YYYY-MM') THEN
        legacy_count := greatest(0, greatest(target.strikes_used, target.strikes_count)
          + CASE WHEN p_action = 'add_strike' THEN 1 ELSE -1 END);
        UPDATE public.members SET strikes_used = legacy_count, strikes_count = legacy_count,
          updated_at = clock_timestamp() WHERE id = target.id RETURNING * INTO target;
      END IF;
    END IF;
  END IF;

  RETURN public.staff_strike_month(target, cycle_month)
    || jsonb_build_object('success', true, 'correction_id', correction_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_legacy_nightly_strike(
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
  IF p_month < m.strike_cycle_month THEN
    RAISE SQLSTATE 'PT409' USING MESSAGE = 'The strike month advanced. Refresh the member and retry.';
  END IF;
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
    IF EXISTS (SELECT FROM public.strike_moderator_corrections
      WHERE member_id = m.id AND cycle_date = public.strike_cycle_day(p_cycle)
        AND action = 'clear_nightly' AND source_id IS NOT NULL) THEN
      RETURN jsonb_build_object('reason', 'moderator_cleared');
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

CREATE OR REPLACE FUNCTION public.strike_history_month(
  m public.members, p_month date
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  zone text;
  entries jsonb;
BEGIN
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

CREATE OR REPLACE FUNCTION public.get_member_strike_history(
  p_member_id uuid, p_discord_id text, p_month date
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m public.members;
BEGIN
  SELECT * INTO m FROM public.members
  WHERE id = p_member_id AND discord_id = p_discord_id AND is_active;
  IF NOT FOUND THEN
    RAISE SQLSTATE 'PT403' USING MESSAGE = 'Sign in with the Discord account linked to this profile.';
  END IF;
  RETURN public.strike_history_month(m, p_month);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_profile_strike_history(
  p_viewer_id uuid, p_viewer_discord_id text, p_member_id uuid, p_month date
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  target public.members;
  history jsonb;
  entries jsonb;
BEGIN
  IF NOT EXISTS (SELECT FROM public.members
    WHERE id = p_viewer_id AND discord_id = p_viewer_discord_id AND is_active) THEN
    RAISE SQLSTATE 'PT403' USING MESSAGE = 'Sign in with the Discord account linked to your profile.';
  END IF;
  SELECT * INTO target FROM public.members WHERE id = p_member_id AND is_active;
  IF NOT FOUND THEN RAISE SQLSTATE 'PT404' USING MESSAGE = 'Member not found.'; END IF;

  history := public.strike_history_month(target, p_month);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'cycle_date', entry->'cycle_date', 'record_type', entry->'record_type', 'source_type', entry->'source_type',
    'issued_at', entry->'issued_at', 'issuance_timezone', entry->'issuance_timezone', 'recorded_at', entry->'recorded_at',
    'changed_at', entry->'changed_at', 'counts', entry->'counts', 'status', entry->'status',
    'replaced_strike', entry->'replaced_strike') ORDER BY position), '[]'::jsonb)
    INTO entries FROM jsonb_array_elements(history->'entries') WITH ORDINALITY AS items(entry, position);
  RETURN jsonb_build_object('month', history->'month', 'timezone', history->'timezone', 'entries', entries);
END;
$$;

REVOKE ALL ON FUNCTION public.strike_history_month(public.members,date) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_profile_strike_history(uuid,text,uuid,date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_profile_strike_history(uuid,text,uuid,date) TO service_role;

COMMIT;
