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
  role TEXT NOT NULL DEFAULT 'member',      -- 'member' | 'moderator'
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

-- Members: Public read for active members (for community roster view)
DROP POLICY IF EXISTS "Public can view active members" ON members;
CREATE POLICY "Public can view active members" ON members
  FOR SELECT USING (is_active = true);

-- Members: Service role has full access for backend API operations
DROP POLICY IF EXISTS "Service role full access on members" ON members;
CREATE POLICY "Service role full access on members" ON members
  FOR ALL USING (auth.role() = 'service_role');

-- Push Subscriptions: Service role full access & public insert
DROP POLICY IF EXISTS "Service role full access on push_subscriptions" ON push_subscriptions;
CREATE POLICY "Service role full access on push_subscriptions" ON push_subscriptions
  FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Public can register push subscriptions" ON push_subscriptions;
CREATE POLICY "Public can register push subscriptions" ON push_subscriptions
  FOR INSERT WITH CHECK (true);

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
VALUES
  ('Aoi', 'aoi_jp', 'https://api.dicebear.com/7.x/bottts/svg?seed=Aoi', 'https://discord.com/channels/123456789/987654321', '23:30', '07:30', 'Asia/Tokyo', '00:30', '09:00', 'member'),
  ('SarahK', 'sarah_ny', 'https://api.dicebear.com/7.x/bottts/svg?seed=SarahK', 'https://discord.com/channels/123456789/987654322', '22:45', '06:45', 'America/New_York', '23:45', '08:30', 'member'),
  ('Marcus', 'marcus_ldn', 'https://api.dicebear.com/7.x/bottts/svg?seed=Marcus', 'https://discord.com/channels/123456789/987654323', '23:00', '07:00', 'Europe/London', NULL, NULL, 'moderator'),
  ('Arjun', 'arjun_in', 'https://api.dicebear.com/7.x/bottts/svg?seed=Arjun', 'https://discord.com/channels/123456789/987654324', '00:15', '08:00', 'Asia/Kolkata', '01:30', '09:30', 'member')
ON CONFLICT DO NOTHING;
