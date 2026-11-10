import { createClient } from '@supabase/supabase-js';

// Lazy initialization of Supabase client for rate limit persistence
let cachedSupabase: any = null;
function getSupabase() {
  if (cachedSupabase) return cachedSupabase;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url && key) {
    cachedSupabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return cachedSupabase;
  }
  return null;
}

/**
 * Serverless-persistent sliding window rate limiter for PIN verification and sensitive auth gates.
 * Protects against brute-force attacks across IP addresses and member targets across ephemeral serverless instances.
 */

interface RateLimitEntry {
  attempts: number;
  resetAt: number;
}

// Preserve in-memory fallback cache on globalThis across Next.js module reloads and chunks
const globalForRateLimit = globalThis as unknown as {
  __pinRateLimits?: Map<string, RateLimitEntry>;
};

const pinRateLimits = globalForRateLimit.__pinRateLimits || new Map<string, RateLimitEntry>();
globalForRateLimit.__pinRateLimits = pinRateLimits;

// Purge expired local entries periodically every 5 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
if (typeof setInterval !== 'undefined') {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of pinRateLimits.entries()) {
      if (now > entry.resetAt) {
        pinRateLimits.delete(key);
      }
    }
  }, CLEANUP_INTERVAL_MS);
  if (timer.unref) timer.unref();
}

/**
 * Extracts client IP from standard proxy headers or defaults safely.
 */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp.trim();
  }
  return '127.0.0.1';
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  then?<TResult1 = RateLimitResult, TResult2 = never>(
    onfulfilled?: ((value: RateLimitResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2>;
}

/**
 * Derives cache and database keys for IP and target member identifiers.
 */
export function getRateLimitKeys(ip: string, targetId: string): string[] {
  const keys: string[] = [];
  const cleanIp = ip ? ip.trim() : '';
  const cleanTarget = targetId ? targetId.trim() : '';

  if (cleanIp) keys.push(`ip:${cleanIp}`);
  if (cleanTarget) keys.push(`target:${cleanTarget}`);

  return keys;
}

/**
 * Synchronous in-memory check (ensures zero-latency and 100% compatibility with synchronous unit tests).
 */
export function checkPinRateLimitSync(
  ip: string,
  targetId: string,
  maxAttempts = 5,
  windowMs = 15 * 60 * 1000
): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const keys = getRateLimitKeys(ip, targetId);

  for (const key of keys) {
    const entry = pinRateLimits.get(key);
    if (entry && now < entry.resetAt) {
      if (entry.attempts >= maxAttempts) {
        const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
        return { allowed: false, retryAfterSeconds };
      }
    }
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Serverless-persistent rate limit check against Supabase 'rate_limit_entries' table
 * with graceful in-memory fallback.
 */
export async function checkPinRateLimitPersistent(
  ip: string,
  targetId: string,
  maxAttempts = 5,
  windowMs = 15 * 60 * 1000
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  // First check in-memory cache
  const localCheck = checkPinRateLimitSync(ip, targetId, maxAttempts, windowMs);
  if (!localCheck.allowed) {
    return localCheck;
  }

  const keys = getRateLimitKeys(ip, targetId);
  if (keys.length === 0) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  try {
    const client = getSupabase();
    if (!client) return { allowed: true, retryAfterSeconds: 0 };

    const nowIso = new Date().toISOString();
    const { data, error } = await client
      .from('rate_limit_entries')
      .select('key, attempts, reset_at')
      .in('key', keys)
      .gt('reset_at', nowIso);

    if (!error && Array.isArray(data)) {
      const nowMs = Date.now();
      for (const row of data) {
        if (row.attempts >= maxAttempts) {
          const resetMs = new Date(row.reset_at).getTime();
          const retryAfterSeconds = Math.max(1, Math.ceil((resetMs - nowMs) / 1000));
          // Mirror to in-memory cache
          pinRateLimits.set(row.key, { attempts: row.attempts, resetAt: resetMs });
          return { allowed: false, retryAfterSeconds };
        }
      }
    }
  } catch {
    // If Supabase table is unreachable, fallback to in-memory result
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Checks if a member/IP has exceeded maximum allowed failed attempts.
 * Supports both synchronous invocation (for tests) and awaitable promise invocation.
 */
export function checkPinRateLimit(
  ip: string,
  targetId: string,
  maxAttempts = 5,
  windowMs = 15 * 60 * 1000
): RateLimitResult {
  const syncResult = checkPinRateLimitSync(ip, targetId, maxAttempts, windowMs);

  const result: RateLimitResult = {
    allowed: syncResult.allowed,
    retryAfterSeconds: syncResult.retryAfterSeconds,
    then(onfulfilled, onrejected) {
      return checkPinRateLimitPersistent(ip, targetId, maxAttempts, windowMs).then(
        onfulfilled,
        onrejected
      );
    },
  };

  return result;
}

/**
 * Serverless-persistent failure recording. Updates local memory map and Supabase table.
 */
export async function recordPinFailurePersistent(
  ip: string,
  targetId: string,
  windowMs = 15 * 60 * 1000
): Promise<void> {
  const nowMs = Date.now();
  const resetAtMs = nowMs + windowMs;
  const resetAtIso = new Date(resetAtMs).toISOString();
  const cleanIp = ip ? ip.trim() : null;
  const cleanTarget = targetId ? targetId.trim() : null;

  const keys = getRateLimitKeys(ip, targetId);
  if (keys.length === 0) return;

  // Mirror to in-memory cache first so checkPinRateLimitSync works even if Supabase is unavailable
  for (const key of keys) {
    const entry = pinRateLimits.get(key);
    if (!entry || nowMs > entry.resetAt) {
      pinRateLimits.set(key, { attempts: 1, resetAt: nowMs + windowMs });
    } else {
      entry.attempts += 1;
    }
  }

  // Persist to Supabase rate_limit_entries table
  try {
    const client = getSupabase();
    if (!client) return;

    for (const key of keys) {
      const { data: existing } = await client
        .from('rate_limit_entries')
        .select('attempts, reset_at')
        .eq('key', key)
        .maybeSingle();

      if (existing && new Date(existing.reset_at).getTime() > nowMs) {
        await client
          .from('rate_limit_entries')
          .update({
            attempts: existing.attempts + 1,
            updated_at: new Date().toISOString(),
          })
          .eq('key', key);
      } else {
        await client.from('rate_limit_entries').upsert(
          {
            key,
            ip_address: cleanIp,
            target_member_id: cleanTarget,
            attempts: 1,
            reset_at: resetAtIso,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'key' }
        );
      }
    }
  } catch {
    // Non-blocking in case table is unavailable
  }
}

/**
 * Records a failed PIN verification attempt synchronously and asynchronously persists to Supabase.
 */
export function recordPinFailure(
  ip: string,
  targetId: string,
  windowMs = 15 * 60 * 1000
): void {
  // Synchronously mirrors to in-memory map before awaiting Supabase
  recordPinFailurePersistent(ip, targetId, windowMs).catch(() => {});
}

/**
 * Clears failed attempts upon successful verification for the target member and/or IP.
 * Deletes corresponding IP-scoped keys for moderator auth and target/member-scoped keys.
 */
export async function resetPinFailurePersistent(ip: string, targetId: string): Promise<void> {
  const cleanIp = ip ? ip.trim() : '';
  const cleanTarget = targetId ? targetId.trim() : '';

  if (cleanTarget) {
    pinRateLimits.delete(`target:${cleanTarget}`);
  }

  const isModOrIpScoped =
    cleanTarget.startsWith('mod') ||
    cleanTarget.startsWith('ip:') ||
    cleanTarget.includes('mod_ip') ||
    cleanTarget.includes('mod_gate') ||
    !cleanTarget;

  if (cleanIp && isModOrIpScoped) {
    pinRateLimits.delete(`ip:${cleanIp}`);
    pinRateLimits.delete(`target:mod_ip:${cleanIp}`);
    pinRateLimits.delete(`target:mod_gate_ip:${cleanIp}`);
  }

  if (cleanIp && cleanTarget) {
    pinRateLimits.delete(`pair:${cleanIp}:${cleanTarget}`);
  }

  try {
    const client = getSupabase();
    if (client) {
      const keysToDelete: string[] = [];
      if (cleanTarget) {
        keysToDelete.push(`target:${cleanTarget}`);
      }
      if (cleanIp && isModOrIpScoped) {
        keysToDelete.push(`ip:${cleanIp}`, `target:mod_ip:${cleanIp}`, `target:mod_gate_ip:${cleanIp}`);
      }
      if (keysToDelete.length > 0) {
        await client
          .from('rate_limit_entries')
          .delete()
          .in('key', keysToDelete);
      }
    }
  } catch {
    // Non-blocking
  }
}

/**
 * Clears failed attempts upon successful verification for the target member.
 */
export function resetPinFailure(ip: string, targetId: string): void {
  const cleanTarget = targetId ? targetId.trim() : '';
  if (cleanTarget) {
    pinRateLimits.delete(`target:${cleanTarget}`);
    if (ip && ip.trim()) {
      pinRateLimits.delete(`pair:${ip.trim()}:${cleanTarget}`);
    }
  }

  resetPinFailurePersistent(ip, targetId).catch(() => {});
}

/**
 * Reset all rate limit state (primarily for automated testing).
 */
export async function clearAllPinRateLimitsPersistent(): Promise<void> {
  pinRateLimits.clear();
  try {
    const client = getSupabase();
    if (client) {
      await client.from('rate_limit_entries').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    }
  } catch {
    // Non-blocking
  }
}

export function clearAllPinRateLimits(): void {
  pinRateLimits.clear();
  clearAllPinRateLimitsPersistent().catch(() => {});
}
