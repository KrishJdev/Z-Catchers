import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Browser & public queries (respects RLS)
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Server-only administrative client (bypasses RLS for cron, cooldown promotion, admin overrides)
export const isSupabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder') &&
  supabaseServiceKey
);

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
  discord_id?: string | null;
  discord_username: string;
  discord_handle: string | null;
  avatar_url: string | null;
  journal_url: string;
  bedtime_local: string; // "HH:mm", e.g. "23:30" (Weekday: Sunday-Thursday nights)
  wake_time_local: string; // "HH:mm", default "07:00"
  timezone: string; // IANA timezone, e.g. "America/New_York"
  weekend_bedtime_local?: string | null; // "HH:mm" for Friday & Saturday nights (optional)
  weekend_wake_time_local?: string | null; // "HH:mm" for weekend mornings (optional)
  pending_bedtime_local: string | null;
  pending_wake_time_local: string | null;
  pending_timezone: string | null;
  pending_weekend_bedtime_local?: string | null;
  pending_weekend_wake_time_local?: string | null;
  pending_effective_at: string | null; // ISO timestamp
  role: 'member' | 'moderator';
  is_moderator?: boolean;
  onboarding_completed?: boolean;
  passcode_hash?: string | null;
  has_pin?: boolean;
  is_active: boolean;
  // Monthly Strikes & Metastrikes Accountability System
  strikes_used?: number; // 0 to 3
  metastrikes_used?: number; // 0 to 3
  strikes_count?: number; // Alias 0 to 3
  metastrikes_count?: number; // Alias 0 to 3
  strike_cycle_month?: string; // "YYYY-MM"
  last_notified_stage?: string | null;
  last_notified_cycle_date?: string | null;
  created_at: string;
  updated_at: string;
  // Dynamic runtime properties (hydrated by /api/members)
  is_in_bed?: boolean;
  streak_days?: number;
  nag_assists_count?: number;
  tonight_strike_log?: NightlyStrikeLog | null;
  convertible_strike_log?: NightlyStrikeLog | null;
  can_vote_strike?: boolean;
  has_voted_strike?: boolean;
  is_metastrike_active?: boolean;
  metastrike_reason?: string | null;
}

export type StrikeRecordType = 'pending_vote' | 'strike' | 'metastrike';

export interface NightlyStrikeLog {
  id: string;
  target_member_id: string;
  sleep_cycle_date: string; // 'YYYY-MM-DD' in member's timezone
  record_type: StrikeRecordType;
  voter_ids: string[];
  reason?: string | null;
  created_at: string;
  updated_at?: string;
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
  notification_type: 'WIND_DOWN_30M' | 'BEDTIME_HIT' | 'IN_BED_EARLY' | string;
  local_date: string; // "YYYY-MM-DD"
  dispatched_at: string;
}

export interface RateLimitRecord {
  id: string;
  key: string;
  ip_address?: string | null;
  target_member_id?: string | null;
  attempts: number;
  reset_at: string;
  created_at: string;
  updated_at: string;
}

/**
 * Safely fetches all rows matching a query despite PostgREST's default 1000-row cap,
 * paging through results using .range(from, to).
 */
export async function fetchAllNotificationLogs<T = any>(
  builderFn: (query: any) => any,
  pageSize = 1000
): Promise<{ data: T[]; error: any }> {
  let page = 0;
  const allRows: T[] = [];

  while (true) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const baseQuery = supabaseAdmin.from('notification_logs');
    const query = builderFn(baseQuery).order('id', { ascending: true }).range(from, to);

    const { data, error } = (await query) as { data: T[] | null; error: any };
    if (error) {
      return { data: allRows, error };
    }
    if (!data || data.length === 0) {
      break;
    }
    allRows.push(...data);
    if (data.length < pageSize) {
      break;
    }
    page++;
  }

  return { data: allRows, error: null };
}

/**
 * In-memory fallback cache for weekend hours when columns are not yet migrated in Supabase
 */
interface InMemoryWeekendHours {
  weekend_bedtime_local?: string | null;
  weekend_wake_time_local?: string | null;
}
const memoryWeekendHours = new Map<string, InMemoryWeekendHours>();

/**
 * Retrieves in-memory weekend schedule hours for a member (used in testing or pre-migration fallbacks).
 *
 * @param memberId - Target member UUID
 * @returns Cached weekend schedule hours or undefined
 */
export function getInMemoryWeekendHours(memberId: string): InMemoryWeekendHours | undefined {
  return memoryWeekendHours.get(memberId);
}

/**
 * Stores in-memory weekend schedule hours for a member.
 *
 * @param memberId - Target member UUID
 * @param hours - Weekend bedtime and wake time definitions
 */
export function setInMemoryWeekendHours(memberId: string, hours: InMemoryWeekendHours): void {
  const current = memoryWeekendHours.get(memberId) || {};
  memoryWeekendHours.set(memberId, { ...current, ...hours });
}

/**
 * Hydrates a Member object with in-memory weekend schedule hours if absent from database columns.
 *
 * @param member - Target member entity
 * @returns Hydrated member entity
 */
export function hydrateMemberWeekendHours(member: Member): Member {
  const fallback = memoryWeekendHours.get(member.id);
  if (!fallback) return member;
  return {
    ...member,
    weekend_bedtime_local:
      member.weekend_bedtime_local !== undefined && member.weekend_bedtime_local !== null
        ? member.weekend_bedtime_local
        : fallback.weekend_bedtime_local ?? null,
    weekend_wake_time_local:
      member.weekend_wake_time_local !== undefined && member.weekend_wake_time_local !== null
        ? member.weekend_wake_time_local
        : fallback.weekend_wake_time_local ?? null,
  };
}

/**
 * Cached set of column names that actually exist on the 'members' table in Supabase.
 */
let knownMemberColumns: Set<string> | null = null;

/**
 * Queries Supabase to detect existing column names on the members table to prevent insert/update errors.
 *
 * @returns Set of detected column names
 */
export async function getExistingMemberColumns(): Promise<Set<string>> {
  if (knownMemberColumns && knownMemberColumns.size > 0) {
    return knownMemberColumns;
  }
  try {
    const { data } = await supabaseAdmin.from('members').select('*').limit(1);
    if (data && data.length > 0) {
      knownMemberColumns = new Set(Object.keys(data[0]));
      return knownMemberColumns;
    }
  } catch (err) {
    console.warn('[db] Failed to detect live member columns:', err);
  }
  // Baseline known columns in initial migration
  return new Set([
    'id',
    'discord_id',
    'discord_username',
    'discord_handle',
    'avatar_url',
    'journal_url',
    'bedtime_local',
    'wake_time_local',
    'timezone',
    'pending_bedtime_local',
    'pending_wake_time_local',
    'pending_timezone',
    'pending_effective_at',
    'role',
    'is_moderator',
    'onboarding_completed',
    'passcode_hash',
    'is_active',
    'strikes_used',
    'strikes_count',
    'metastrikes_used',
    'metastrikes_count',
    'strike_cycle_month',
    'last_notified_stage',
    'last_notified_cycle_date',
    'created_at',
    'updated_at',
  ]);
}

/**
 * Strips fields from an update/insert payload if the target column does not exist
 * in the active Supabase schema, preventing PostgREST schema cache errors.
 */
export async function sanitizeMemberPayload<T extends Record<string, any>>(payload: T): Promise<Partial<T>> {
  const allowed = await getExistingMemberColumns();
  const clean: Record<string, any> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (allowed.has(key)) {
      clean[key] = value;
    }
  }
  return clean as Partial<T>;
}

export interface SafeUpdateOptions {
  select?: string;
  isFirstTimeClaim?: boolean;
}

/**
 * Performs a robust update on the 'members' table that automatically strips
 * any un-migrated columns and retries if PostgREST reports a schema cache mismatch.
 */
export async function updateMemberSafe(
  memberId: string,
  updates: Record<string, any>,
  options: SafeUpdateOptions = {}
): Promise<{ data: Member | null; error: any }> {
  // Sync strike count aliases
  if ('strikes_used' in updates && !('strikes_count' in updates)) {
    updates.strikes_count = updates.strikes_used;
  } else if ('strikes_count' in updates && !('strikes_used' in updates)) {
    updates.strikes_used = updates.strikes_count;
  }
  if ('metastrikes_used' in updates && !('metastrikes_count' in updates)) {
    updates.metastrikes_count = updates.metastrikes_used;
  } else if ('metastrikes_count' in updates && !('metastrikes_used' in updates)) {
    updates.metastrikes_used = updates.metastrikes_count;
  }

  // Store weekend hours in memory cache in case columns do not exist in PostgreSQL
  if ('weekend_bedtime_local' in updates || 'weekend_wake_time_local' in updates) {
    setInMemoryWeekendHours(memberId, {
      weekend_bedtime_local: updates.weekend_bedtime_local,
      weekend_wake_time_local: updates.weekend_wake_time_local,
    });
  }

  let cleanUpdates = await sanitizeMemberPayload(updates);

  const performUpdate = async (fields: Record<string, any>) => {
    let query = supabaseAdmin.from('members').update(fields).eq('id', memberId);
    if (options.isFirstTimeClaim) {
      query = query.is('passcode_hash', null);
    }
    return options.select ? query.select(options.select).maybeSingle() : query.select('*').maybeSingle();
  };

  let { data, error } = await performUpdate(cleanUpdates);

  // Auto-recovery: If PostgREST fails due to a missing column, strip it and retry immediately
  while (error && error.message && error.message.includes('column of \'members\' in the schema cache')) {
    const match = error.message.match(/Could not find the '([^']+)' column/);
    if (match && match[1] && match[1] in cleanUpdates) {
      const missingCol = match[1];
      console.warn(`[Supabase Safe Update] Column '${missingCol}' not found in Supabase schema cache; stripping and retrying.`);
      if (knownMemberColumns) {
        knownMemberColumns.delete(missingCol);
      }
      delete cleanUpdates[missingCol];
      const retry = await performUpdate(cleanUpdates);
      data = retry.data;
      error = retry.error;
    } else {
      break;
    }
  }

  const hydrated = data ? hydrateMemberWeekendHours(data as unknown as Member) : null;
  return { data: hydrated, error };
}

/**
 * Performs a robust insert on the 'members' table that automatically strips
 * un-migrated columns and retries if PostgREST reports a schema cache mismatch.
 */
export async function insertMemberSafe(
  payload: Record<string, any>,
  select = '*'
): Promise<{ data: Member | null; error: any }> {
  let cleanPayload = await sanitizeMemberPayload(payload);

  const performInsert = async (fields: Record<string, any>) => {
    return supabaseAdmin.from('members').insert(fields).select(select).single();
  };

  let { data, error } = await performInsert(cleanPayload);

  while (error && error.message && error.message.includes('column of \'members\' in the schema cache')) {
    const match = error.message.match(/Could not find the '([^']+)' column/);
    if (match && match[1] && match[1] in cleanPayload) {
      const missingCol = match[1];
      console.warn(`[Supabase Safe Insert] Column '${missingCol}' not found in Supabase schema cache; stripping and retrying.`);
      if (knownMemberColumns) {
        knownMemberColumns.delete(missingCol);
      }
      delete cleanPayload[missingCol];
      const retry = await performInsert(cleanPayload);
      data = retry.data;
      error = retry.error;
    } else {
      break;
    }
  }

  if (data && ('weekend_bedtime_local' in payload || 'weekend_wake_time_local' in payload)) {
    setInMemoryWeekendHours((data as unknown as Member).id, {
      weekend_bedtime_local: payload.weekend_bedtime_local,
      weekend_wake_time_local: payload.weekend_wake_time_local,
    });
  }

  const hydrated = data ? hydrateMemberWeekendHours(data as unknown as Member) : null;
  return { data: hydrated, error };
}
