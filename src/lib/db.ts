import { createClient } from '@supabase/supabase-js';

// Polyfill minimal WebSocket for headless environments without native WebSocket (e.g. Node < 22)
if (typeof globalThis.WebSocket === 'undefined') {
  class DummyWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    readyState = 3;
    close() {}
    addEventListener() {}
    removeEventListener() {}
    send() {}
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).WebSocket = DummyWebSocket;
}

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

export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface DailySchedule {
  bedtime: string;   // "HH:mm" 24-hour format (e.g., "23:30" or "01:00")
  wake_time: string; // "HH:mm" 24-hour format (e.g., "07:30")
}

export type WeeklySchedule = Record<DayKey, DailySchedule>;

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
  weekly_schedule?: WeeklySchedule | null;
  pending_bedtime_local: string | null;
  pending_wake_time_local: string | null;
  pending_timezone: string | null;
  pending_weekend_bedtime_local?: string | null;
  pending_weekend_wake_time_local?: string | null;
  pending_weekly_schedule?: WeeklySchedule | null;
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
  last_woke_up_at?: string | null; // ISO timestamp of most recent wake-up
  last_wake_cycle_date?: string | null; // "YYYY-MM-DD" representing the latest logged wake cycle
  created_at: string;
  updated_at: string;
  // Dynamic runtime properties (hydrated by /api/members)
  is_in_bed?: boolean;
  is_woke_up?: boolean;
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

export type SleepLogStatus = 'on_time' | 'late' | 'missed' | 'metastrike';

export interface SleepLog {
  id?: string;
  member_id: string;
  cycle_date: string; // "YYYY-MM-DD" in member's local IANA timezone representing the night's cycle
  timezone: string;
  target_bedtime?: string | null; // "HH:mm" scheduled bedtime for this cycle
  target_wake_time?: string | null; // "HH:mm" scheduled wake time for this cycle
  in_bed_at?: string | null; // Exact UTC timestamp when member checked in to bed
  in_bed_local_time?: string | null; // "HH:mm" in member's local timezone
  woke_up_at?: string | null; // Exact UTC timestamp when member woke up
  woke_up_local_time?: string | null; // "HH:mm" in member's local timezone
  wake_source?: 'button' | 'manual' | null;
  duration_minutes?: number | null; // Calculated total sleep duration in minutes
  status: SleepLogStatus;
  created_at?: string;
  updated_at?: string;
}

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

export interface RateLimitRow {
  key: string;
  count: number;
  window_start: string;
  expires_at: string;
}

export interface CronLockRow {
  lock_key: string;
  locked_at: string;
  expires_at: string;
  metadata?: Record<string, unknown>;
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
 * In-memory fallback cache for weekend hours & 7-day weekly schedules when columns are not yet migrated in Supabase
 */
export interface InMemoryScheduleData {
  weekend_bedtime_local?: string | null;
  weekend_wake_time_local?: string | null;
  pending_weekend_bedtime_local?: string | null;
  pending_weekend_wake_time_local?: string | null;
  weekly_schedule?: WeeklySchedule | null;
  pending_weekly_schedule?: WeeklySchedule | null;
}

const globalForScheduleData = globalThis as unknown as {
  __memoryScheduleData?: Map<string, InMemoryScheduleData>;
};
const memoryScheduleData =
  globalForScheduleData.__memoryScheduleData || new Map<string, InMemoryScheduleData>();
globalForScheduleData.__memoryScheduleData = memoryScheduleData;

/**
 * Retrieves in-memory schedule data for a member (used in testing or pre-migration fallbacks).
 *
 * @param memberId - Target member UUID
 * @returns Cached schedule data or undefined
 */
export function getInMemoryWeekendHours(memberId: string): InMemoryScheduleData | undefined {
  return memoryScheduleData.get(memberId);
}

/**
 * Clears in-memory schedule data for all members (used in testing).
 */
export function clearInMemoryWeekendHours(): void {
  memoryScheduleData.clear();
}

/**
 * Stores in-memory schedule data for a member.
 *
 * @param memberId - Target member UUID
 * @param hours - Schedule definitions
 */
export function setInMemoryWeekendHours(memberId: string, hours: InMemoryScheduleData): void {
  const current = memoryScheduleData.get(memberId) || {};
  const merged: InMemoryScheduleData = { ...current };
  if ('weekend_bedtime_local' in hours) merged.weekend_bedtime_local = hours.weekend_bedtime_local;
  if ('weekend_wake_time_local' in hours) merged.weekend_wake_time_local = hours.weekend_wake_time_local;
  if ('pending_weekend_bedtime_local' in hours) merged.pending_weekend_bedtime_local = hours.pending_weekend_bedtime_local;
  if ('pending_weekend_wake_time_local' in hours) merged.pending_weekend_wake_time_local = hours.pending_weekend_wake_time_local;
  if ('weekly_schedule' in hours) merged.weekly_schedule = hours.weekly_schedule;
  if ('pending_weekly_schedule' in hours) merged.pending_weekly_schedule = hours.pending_weekly_schedule;
  memoryScheduleData.set(memberId, merged);
}

/**
 * Hydrates a Member object with in-memory schedule hours & weekly_schedule if absent from database columns.
 *
 * @param member - Target member entity
 * @returns Hydrated member entity
 */
export function hydrateMemberWeekendHours(member: Member): Member {
  const fallback = memoryScheduleData.get(member.id);
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
    pending_weekend_bedtime_local:
      member.pending_weekend_bedtime_local !== undefined
        ? member.pending_weekend_bedtime_local
        : fallback.pending_weekend_bedtime_local,
    pending_weekend_wake_time_local:
      member.pending_weekend_wake_time_local !== undefined
        ? member.pending_weekend_wake_time_local
        : fallback.pending_weekend_wake_time_local,
    weekly_schedule:
      member.weekly_schedule !== undefined && member.weekly_schedule !== null
        ? member.weekly_schedule
        : fallback.weekly_schedule ?? null,
    pending_weekly_schedule:
      member.pending_weekly_schedule !== undefined && member.pending_weekly_schedule !== null
        ? member.pending_weekly_schedule
        : fallback.pending_weekly_schedule ?? null,
  };
}

/**
 * Cached set of column names that actually exist on the 'members' table in Supabase.
 */
let knownMemberColumns: Set<string> | null = null;
let lastColumnCheck = 0;
const COLUMN_CACHE_TTL_MS = 30000;

export function clearKnownMemberColumns(): void {
  knownMemberColumns = null;
  lastColumnCheck = 0;
}

/**
 * Queries Supabase to detect existing column names on the members table to prevent insert/update errors.
 *
 * @returns Set of detected column names
 */
export async function getExistingMemberColumns(forceRefresh = false): Promise<Set<string>> {
  const now = Date.now();
  if (!forceRefresh && knownMemberColumns && knownMemberColumns.size > 0 && (now - lastColumnCheck) < COLUMN_CACHE_TTL_MS) {
    return knownMemberColumns;
  }
  try {
    const { data } = await supabaseAdmin.from('members').select('*').limit(1);
    if (data && data.length > 0) {
      knownMemberColumns = new Set(Object.keys(data[0]));
      lastColumnCheck = now;
      return knownMemberColumns;
    }
  } catch (err) {
    console.warn('[db] Failed to detect live member columns:', err);
  }
  // Baseline known columns in initial migration
  const baseline = new Set([
    'id',
    'discord_id',
    'discord_username',
    'discord_handle',
    'avatar_url',
    'journal_url',
    'bedtime_local',
    'wake_time_local',
    'timezone',
    'weekend_bedtime_local',
    'weekend_wake_time_local',
    'weekly_schedule',
    'pending_bedtime_local',
    'pending_wake_time_local',
    'pending_timezone',
    'pending_weekend_bedtime_local',
    'pending_weekend_wake_time_local',
    'pending_weekly_schedule',
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
    'last_woke_up_at',
    'last_wake_cycle_date',
    'created_at',
    'updated_at',
  ]);
  knownMemberColumns = baseline;
  lastColumnCheck = now;
  return knownMemberColumns;
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
  requireUnlinkedDiscord?: boolean;
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

  // Store weekend hours & weekly schedule updates locally to commit after successful DB update
  const scheduleUpdates: InMemoryScheduleData = {};
  if ('weekend_bedtime_local' in updates) scheduleUpdates.weekend_bedtime_local = updates.weekend_bedtime_local;
  if ('weekend_wake_time_local' in updates) scheduleUpdates.weekend_wake_time_local = updates.weekend_wake_time_local;
  if ('pending_weekend_bedtime_local' in updates) scheduleUpdates.pending_weekend_bedtime_local = updates.pending_weekend_bedtime_local;
  if ('pending_weekend_wake_time_local' in updates) scheduleUpdates.pending_weekend_wake_time_local = updates.pending_weekend_wake_time_local;
  if ('weekly_schedule' in updates) scheduleUpdates.weekly_schedule = updates.weekly_schedule;
  if ('pending_weekly_schedule' in updates) scheduleUpdates.pending_weekly_schedule = updates.pending_weekly_schedule;

  // Warn if weekly schedule columns are not yet migrated in Supabase (fallback to in-memory)
  if (isSupabaseConfigured) {
    const existingCols = await getExistingMemberColumns();
    if (
      ('weekly_schedule' in updates && !existingCols.has('weekly_schedule')) ||
      ('pending_weekly_schedule' in updates && !existingCols.has('pending_weekly_schedule'))
    ) {
      console.warn(
        `[Supabase Safe Update] Database missing durable 'weekly_schedule' or 'pending_weekly_schedule' columns. Schedule cached in memory. Run migrations from supabase/schema.sql for permanent DB storage.`
      );
    }
  }

  let cleanUpdates = await sanitizeMemberPayload(updates);

  const performUpdate = async (fields: Record<string, any>) => {
    let query = supabaseAdmin.from('members').update(fields).eq('id', memberId);
    if (options.isFirstTimeClaim) {
      query = query.is('passcode_hash', null);
    }
    if (options.requireUnlinkedDiscord) {
      query = query.is('discord_id', null);
    }
    return options.select ? query.select(options.select).maybeSingle() : query.select('*').maybeSingle();
  };

  let { data, error } = await performUpdate(cleanUpdates);

  // Auto-recovery: If PostgREST fails due to a missing column, strip it and retry immediately
  while (error && error.message && error.message.includes('column of \'members\' in the schema cache')) {
    const match = error.message.match(/Could not find the '([^']+)' column/);
    if (match && match[1] && match[1] in cleanUpdates) {
      const missingCol = match[1];
      console.warn(`[Supabase Safe Update] Column '${missingCol}' not found in Supabase schema cache; caching in memory, stripping and retrying.`);
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

  if (data) {
    if (Object.keys(scheduleUpdates).length > 0) {
      setInMemoryWeekendHours(memberId, scheduleUpdates);
    }
    const hydrated = hydrateMemberWeekendHours(data as unknown as Member);
    memoryMembers.set(memberId, hydrated);
    return { data: hydrated, error };
  } else if (!isSupabaseConfigured) {
    const existing = memoryMembers.get(memberId);
    if (existing) {
      if (Object.keys(scheduleUpdates).length > 0) {
        setInMemoryWeekendHours(memberId, scheduleUpdates);
      }
      const merged = hydrateMemberWeekendHours({ ...existing, ...cleanUpdates, id: memberId });
      memoryMembers.set(memberId, merged);
      return { data: merged, error: null };
    }
  }
  return { data: null, error };
}

/**
 * Performs a robust insert on the 'members' table that automatically strips
 * un-migrated columns and retries if PostgREST reports a schema cache mismatch.
 */
export async function insertMemberSafe(
  payload: Record<string, any>,
  select = '*'
): Promise<{ data: Member | null; error: any }> {
  // Warn if weekly schedule columns are not yet migrated in Supabase (fallback to in-memory)
  if (isSupabaseConfigured) {
    const existingCols = await getExistingMemberColumns();
    if (
      ('weekly_schedule' in payload && !existingCols.has('weekly_schedule')) ||
      ('pending_weekly_schedule' in payload && !existingCols.has('pending_weekly_schedule'))
    ) {
      console.warn(
        `[Supabase Safe Insert] Database missing durable 'weekly_schedule' or 'pending_weekly_schedule' columns. Schedule cached in memory. Run migrations from supabase/schema.sql for permanent DB storage.`
      );
    }
  }

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

  if (
    data &&
    ('weekend_bedtime_local' in payload ||
      'weekend_wake_time_local' in payload ||
      'pending_weekend_bedtime_local' in payload ||
      'pending_weekend_wake_time_local' in payload ||
      'weekly_schedule' in payload ||
      'pending_weekly_schedule' in payload)
  ) {
    const memData: InMemoryScheduleData = {};
    if ('weekend_bedtime_local' in payload) memData.weekend_bedtime_local = payload.weekend_bedtime_local;
    if ('weekend_wake_time_local' in payload) memData.weekend_wake_time_local = payload.weekend_wake_time_local;
    if ('pending_weekend_bedtime_local' in payload) memData.pending_weekend_bedtime_local = payload.pending_weekend_bedtime_local;
    if ('pending_weekend_wake_time_local' in payload) memData.pending_weekend_wake_time_local = payload.pending_weekend_wake_time_local;
    if ('weekly_schedule' in payload) memData.weekly_schedule = payload.weekly_schedule;
    if ('pending_weekly_schedule' in payload) memData.pending_weekly_schedule = payload.pending_weekly_schedule;
    setInMemoryWeekendHours((data as unknown as Member).id, memData);
  }

  const hydrated = data ? hydrateMemberWeekendHours(data as unknown as Member) : null;
  if (hydrated) {
    memoryMembers.set(hydrated.id, hydrated);
  } else if (!isSupabaseConfigured) {
    const id = cleanPayload.id || `mem_${Date.now()}`;
    const inMem = hydrateMemberWeekendHours({ ...cleanPayload, id } as Member);
    memoryMembers.set(id, inMem);
    return { data: inMem, error: null };
  }
  return { data: hydrated, error };
}

/**
 * In-memory fallback map for members (testing and offline development)
 */
const globalForMemoryMembers = globalThis as unknown as {
  __memoryMembers?: Map<string, Member>;
  __testFixtures?: Set<string>;
};
const memoryMembers =
  globalForMemoryMembers.__memoryMembers || new Map<string, Member>();
globalForMemoryMembers.__memoryMembers = memoryMembers;
const testFixtures =
  globalForMemoryMembers.__testFixtures || new Set<string>();
globalForMemoryMembers.__testFixtures = testFixtures;

export function isTestMemberFixture(memberId: string): boolean {
  return testFixtures.has(memberId) || memberId.startsWith('mem_');
}

export function getInMemoryMember(memberId: string): Member | undefined {
  return memoryMembers.get(memberId);
}

export function setInMemoryMember(member: Member): void {
  testFixtures.add(member.id);
  memoryMembers.set(member.id, hydrateMemberWeekendHours(member));
}

export function clearInMemoryMembers(): void {
  testFixtures.clear();
  memoryMembers.clear();
}

/**
 * Safely fetches a member by ID, checking live Supabase first and falling back to in-memory store.
 */
export async function getMemberByIdSafe(memberId: string): Promise<{ data: Member | null; error: any }> {
  if (isTestMemberFixture(memberId)) {
    const inMem = memoryMembers.get(memberId);
    if (inMem) {
      return { data: inMem, error: null };
    }
  }

  if (isSupabaseConfigured) {
    try {
      const { data, error } = await supabaseAdmin
        .from('members')
        .select('*')
        .eq('id', memberId)
        .maybeSingle();

      if (!error && data) {
        const hydrated = hydrateMemberWeekendHours(data as Member);
        memoryMembers.set(memberId, hydrated);
        return { data: hydrated, error: null };
      }
      if (!error) {
        memoryMembers.delete(memberId);
        return { data: null, error: new Error('Member not found') };
      }
    } catch (err: any) {
      console.warn('[db] Supabase getMemberByIdSafe exception:', err.message);
    }
  }

  const inMem = memoryMembers.get(memberId);
  if (inMem) {
    return { data: inMem, error: null };
  }
  return { data: null, error: new Error('Member not found') };
}

/**
 * In-memory fallback map for sleep_logs: key = `${member_id}:${cycle_date}`
 */
const memorySleepLogs = new Map<string, SleepLog>();

export function getSleepLogMemoryKey(memberId: string, cycleDate: string): string {
  return `${memberId}:${cycleDate}`;
}

export function setInMemorySleepLog(entry: SleepLog): void {
  const key = getSleepLogMemoryKey(entry.member_id, entry.cycle_date);
  memorySleepLogs.set(key, entry);
}

export function getInMemorySleepLogs(
  memberId?: string,
  startCycleDate?: string,
  endCycleDate?: string
): SleepLog[] {
  let list = Array.from(memorySleepLogs.values());
  if (memberId) {
    list = list.filter((l) => l.member_id === memberId);
  }
  if (startCycleDate) {
    list = list.filter((l) => l.cycle_date >= startCycleDate);
  }
  if (endCycleDate) {
    list = list.filter((l) => l.cycle_date <= endCycleDate);
  }
  return list.sort((a, b) => a.cycle_date.localeCompare(b.cycle_date));
}

export function clearInMemorySleepLogs(): void {
  memorySleepLogs.clear();
}

/**
 * Upserts a sleep log entry (keyed on member_id + cycle_date).
 * Updates both Supabase (if configured) and the in-memory fallback cache.
 */
export async function upsertSleepLog(
  entry: Partial<SleepLog> & { member_id: string; cycle_date: string }
): Promise<{ data: SleepLog | null; error: any; isDurable: boolean }> {
  const memKey = getSleepLogMemoryKey(entry.member_id, entry.cycle_date);
  let existing = memorySleepLogs.get(memKey);
  const isTestFixture = isTestMemberFixture(entry.member_id);
  let supabaseTableAvailable = true;

  if (isSupabaseConfigured && !isTestFixture) {
    try {
      const { data: dbRow, error: readErr } = await supabaseAdmin
        .from('sleep_logs')
        .select('*')
        .eq('member_id', entry.member_id)
        .eq('cycle_date', entry.cycle_date)
        .maybeSingle();
      if (readErr) {
        if (readErr.code === 'PGRST205' || readErr.message?.includes('schema cache')) {
          console.warn('[db] sleep_logs table not found in Supabase schema cache; using in-memory fallback.');
        } else {
          console.warn('[db] upsertSleepLog pre-read error; proceeding with non-durable memory fallback:', readErr.message);
        }
        supabaseTableAvailable = false;
      } else if (dbRow) {
        existing = { ...(existing || {}), ...(dbRow as SleepLog) };
      }
    } catch (err: any) {
      console.warn('[db] upsertSleepLog pre-read exception; using in-memory fallback:', err.message);
      supabaseTableAvailable = false;
    }
  }

  const nowIso = new Date().toISOString();

  const merged: SleepLog = {
    id: entry.id || existing?.id || `log-${entry.member_id}-${entry.cycle_date}`,
    member_id: entry.member_id,
    cycle_date: entry.cycle_date,
    timezone: entry.timezone || existing?.timezone || 'UTC',
    target_bedtime: entry.target_bedtime !== undefined ? entry.target_bedtime : (existing?.target_bedtime ?? null),
    target_wake_time: entry.target_wake_time !== undefined ? entry.target_wake_time : (existing?.target_wake_time ?? null),
    in_bed_at: entry.in_bed_at !== undefined ? entry.in_bed_at : (existing?.in_bed_at ?? null),
    in_bed_local_time: entry.in_bed_local_time !== undefined ? entry.in_bed_local_time : (existing?.in_bed_local_time ?? null),
    woke_up_at: entry.woke_up_at !== undefined ? entry.woke_up_at : (existing?.woke_up_at ?? null),
    woke_up_local_time: entry.woke_up_local_time !== undefined ? entry.woke_up_local_time : (existing?.woke_up_local_time ?? null),
    wake_source: entry.wake_source !== undefined ? entry.wake_source : (existing?.wake_source ?? null),
    duration_minutes: entry.duration_minutes !== undefined ? entry.duration_minutes : (existing?.duration_minutes ?? null),
    status: entry.status || existing?.status || 'on_time',
    created_at: existing?.created_at || entry.created_at || nowIso,
    updated_at: nowIso,
  };

  // Keep in-memory cache synchronized
  memorySleepLogs.set(memKey, merged);

  if (isSupabaseConfigured && !isTestFixture && supabaseTableAvailable) {
    try {
      const { data, error } = await supabaseAdmin
        .from('sleep_logs')
        .upsert(
          {
            member_id: merged.member_id,
            cycle_date: merged.cycle_date,
            timezone: merged.timezone,
            target_bedtime: merged.target_bedtime,
            target_wake_time: merged.target_wake_time,
            in_bed_at: merged.in_bed_at,
            in_bed_local_time: merged.in_bed_local_time,
            woke_up_at: merged.woke_up_at,
            woke_up_local_time: merged.woke_up_local_time,
            wake_source: merged.wake_source,
            duration_minutes: merged.duration_minutes,
            status: merged.status,
            updated_at: merged.updated_at,
          },
          { onConflict: 'member_id,cycle_date' }
        )
        .select('*')
        .maybeSingle();

      if (!error && data) {
        memorySleepLogs.set(memKey, data as SleepLog);
        return { data: data as SleepLog, error: null, isDurable: true };
      }
      if (error) {
        console.warn('[db] Supabase upsertSleepLog warning:', error.message);
        return { data: merged, error: null, isDurable: false };
      }
    } catch (err: any) {
      console.warn('[db] Supabase upsertSleepLog exception:', err.message);
      return { data: merged, error: null, isDurable: false };
    }
  }

  return { data: merged, error: null, isDurable: false };
}

/**
 * Retrieves sleep logs for a member, optionally constrained to a cycle_date range (e.g. YYYY-MM-01 to YYYY-MM-31).
 * Falls back to the in-memory store if Supabase is offline or unconfigured.
 */
export async function getMemberSleepLogs(
  memberId: string,
  startCycleDate?: string,
  endCycleDate?: string
): Promise<{ data: SleepLog[]; error: any }> {
  if (isSupabaseConfigured && !isTestMemberFixture(memberId)) {
    try {
      let query = supabaseAdmin
        .from('sleep_logs')
        .select('*')
        .eq('member_id', memberId);

      if (startCycleDate) {
        query = query.gte('cycle_date', startCycleDate);
      }
      if (endCycleDate) {
        query = query.lte('cycle_date', endCycleDate);
      }

      const { data, error } = await query.order('cycle_date', { ascending: true });
      if (!error && data) {
        for (const log of data as SleepLog[]) {
          memorySleepLogs.set(getSleepLogMemoryKey(log.member_id, log.cycle_date), log);
        }
        return { data: data as SleepLog[], error: null };
      }
      if (error) {
        console.warn('[db] Supabase getMemberSleepLogs warning:', error.message);
      }
    } catch (err: any) {
      console.warn('[db] Supabase getMemberSleepLogs exception:', err.message);
    }
  }

  const memoryData = getInMemorySleepLogs(memberId, startCycleDate, endCycleDate);
  return { data: memoryData, error: null };
}
