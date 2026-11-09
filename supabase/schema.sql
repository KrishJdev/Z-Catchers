-- ==============================================================================
-- Z Catchers: Supabase PostgreSQL Schema & Security Policies
-- ==============================================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Members Table (Profiles, Schedules, and 48-Hour Cooldown State Machine)
CREATE TABLE IF NOT EXISTS members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_username TEXT NOT NULL,
  discord_handle TEXT,
  avatar_url TEXT,
  journal_url TEXT NOT NULL,
  
  -- Active Schedule (Always evaluated in local time + IANA zone)
  bedtime_local VARCHAR(5) NOT NULL,        -- Format: "HH:mm" (e.g., "23:30")
  wake_time_local VARCHAR(5) NOT NULL DEFAULT '07:00',
  timezone TEXT NOT NULL,                   -- IANA string (e.g., "America/New_York", "Asia/Kolkata")
  
  -- 48-Hour Cooldown Pending Queue
  pending_bedtime_local VARCHAR(5),
  pending_wake_time_local VARCHAR(5),
  pending_timezone TEXT,
  pending_effective_at TIMESTAMPTZ,         -- UTC timestamp when pending promotion unlocks (NOW() + 48h)
  
  -- Role & Security
  role TEXT NOT NULL DEFAULT 'member',      -- 'member' | 'moderator'
  passcode_hash TEXT,                       -- Hashed 4-digit PIN for self-service updates
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Push Subscriptions Table (Supports multi-device per member)
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

-- 3. Notification Logs Table (Idempotency guard against duplicate cron dispatches)
CREATE TABLE IF NOT EXISTS notification_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,          -- 'WIND_DOWN_30M' | 'BEDTIME_HIT'
  local_date DATE NOT NULL,                 -- Sleeper's local date (YYYY-MM-DD)
  dispatched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(member_id, notification_type, local_date)
);

-- Indexes for high-performance cron lookups & timezone queries
CREATE INDEX IF NOT EXISTS idx_members_active ON members(is_active);
CREATE INDEX IF NOT EXISTS idx_members_pending ON members(pending_effective_at) WHERE pending_effective_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_push_member_id ON push_subscriptions(member_id);
CREATE INDEX IF NOT EXISTS idx_notification_logs_lookup ON notification_logs(member_id, notification_type, local_date);

-- ==============================================================================
-- Row Level Security (RLS) Policies
-- ==============================================================================
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_logs ENABLE ROW LEVEL SECURITY;

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

-- ==============================================================================
-- Seed Initial Demo Members (Cross-Timezone Community)
-- ==============================================================================
INSERT INTO members (discord_username, discord_handle, avatar_url, journal_url, bedtime_local, wake_time_local, timezone, role)
VALUES
  ('Aoi', 'aoi_jp', 'https://api.dicebear.com/7.x/bottts/svg?seed=Aoi', 'https://discord.com/channels/123456789/987654321', '23:30', '07:30', 'Asia/Tokyo', 'member'),
  ('SarahK', 'sarah_ny', 'https://api.dicebear.com/7.x/bottts/svg?seed=SarahK', 'https://discord.com/channels/123456789/987654322', '22:45', '06:45', 'America/New_York', 'member'),
  ('Marcus', 'marcus_ldn', 'https://api.dicebear.com/7.x/bottts/svg?seed=Marcus', 'https://discord.com/channels/123456789/987654323', '23:00', '07:00', 'Europe/London', 'moderator'),
  ('Arjun', 'arjun_in', 'https://api.dicebear.com/7.x/bottts/svg?seed=Arjun', 'https://discord.com/channels/123456789/987654324', '00:15', '08:00', 'Asia/Kolkata', 'member')
ON CONFLICT DO NOTHING;
