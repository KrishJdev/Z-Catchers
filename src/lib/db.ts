import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Browser & public queries (respects RLS)
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Server-only administrative client (bypasses RLS for cron, cooldown promotion, admin overrides)
export const supabaseAdmin = supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  : supabase;

export interface Member {
  id: string;
  discord_username: string;
  discord_handle: string | null;
  avatar_url: string | null;
  journal_url: string;
  bedtime_local: string; // "HH:mm", e.g. "23:30"
  wake_time_local: string; // "HH:mm", default "07:00"
  timezone: string; // IANA timezone, e.g. "America/New_York"
  pending_bedtime_local: string | null;
  pending_wake_time_local: string | null;
  pending_timezone: string | null;
  pending_effective_at: string | null; // ISO timestamp
  role: 'member' | 'moderator';
  passcode_hash: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // Dynamic runtime properties (hydrated by /api/members)
  is_in_bed?: boolean;
  streak_days?: number;
  nag_assists_count?: number;
}

export interface PushSubscriptionRecord {
  id: string;
  member_id: string;
  endpoint: string;
  p256dh_key: string;
  auth_key: string;
  notify_personal: boolean;
  notify_community: boolean;
  user_agent: string | null;
  created_at: string;
}

export interface NotificationLog {
  id: string;
  member_id: string;
  notification_type: 'WIND_DOWN_30M' | 'BEDTIME_HIT' | 'IN_BED_EARLY';
  local_date: string; // "YYYY-MM-DD"
  dispatched_at: string;
}
