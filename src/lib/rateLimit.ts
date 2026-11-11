import { supabaseAdmin, isSupabaseConfigured } from './db.ts';

/**
 * Serverless-persistent sliding window rate limiter for PIN verification, sensitive auth gates,
 * and community voting actions.
 * Backed by Supabase 'rate_limits' table with synchronized dual-layer in-memory cache and offline fallback.
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
 * Helper to get the active Supabase client if configured.
 */
function getSupabase() {
  if (isSupabaseConfigured && supabaseAdmin) {
    return supabaseAdmin;
  }
  return null;
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
 * Serverless-persistent rate limit check against Supabase 'rate_limits' table
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
      .from('rate_limits')
      .select('key, count, expires_at')
      .in('key', keys)
      .gt('expires_at', nowIso);

    if (!error && Array.isArray(data)) {
      const nowMs = Date.now();
      for (const row of data) {
        if (row.count >= maxAttempts) {
          const resetMs = new Date(row.expires_at).getTime();
          const retryAfterSeconds = Math.max(1, Math.ceil((resetMs - nowMs) / 1000));
          // Mirror to in-memory cache
          pinRateLimits.set(row.key, { attempts: row.count, resetAt: resetMs });
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
 * Serverless-persistent failure recording. Updates local memory map and Supabase rate_limits table.
 */
export async function recordPinFailurePersistent(
  ip: string,
  targetId: string,
  windowMs = 15 * 60 * 1000
): Promise<void> {
  const nowMs = Date.now();
  const resetAtMs = nowMs + windowMs;
  const resetAtIso = new Date(resetAtMs).toISOString();
  const nowIso = new Date(nowMs).toISOString();

  const keys = getRateLimitKeys(ip, targetId);
  if (keys.length === 0) return;

  // Mirror to in-memory cache first so checkPinRateLimitSync works even if Supabase is unavailable
  for (const key of keys) {
    const entry = pinRateLimits.get(key);
    if (!entry || nowMs > entry.resetAt) {
      pinRateLimits.set(key, { attempts: 1, resetAt: resetAtMs });
    } else {
      entry.attempts += 1;
    }
  }

  // Persist to Supabase rate_limits table
  try {
    const client = getSupabase();
    if (!client) return;

    for (const key of keys) {
      const { data: existing } = await client
        .from('rate_limits')
        .select('count, expires_at')
        .eq('key', key)
        .maybeSingle();

      if (existing && new Date(existing.expires_at).getTime() > nowMs) {
        await client
          .from('rate_limits')
          .update({
            count: existing.count + 1,
          })
          .eq('key', key);
      } else {
        await client.from('rate_limits').upsert(
          {
            key,
            count: 1,
            window_start: nowIso,
            expires_at: resetAtIso,
          },
          { onConflict: 'key' }
        );
      }
    }

    // Opportunistically prune expired records (5% probability)
    if (Math.random() < 0.05) {
      await client.from('rate_limits').delete().lt('expires_at', nowIso);
    }
  } catch {
    // Non-blocking in case table is temporarily unavailable
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
          .from('rate_limits')
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
      await client.from('rate_limits').delete().neq('key', '__placeholder__');
    }
  } catch {
    // Non-blocking
  }
}

/**
 * Synchronously clears in-memory rate limit caches and asynchronously purges
 * the persistent rate limit table. Primarily used in automated testing suites.
 */
export function clearAllPinRateLimits(): void {
  pinRateLimits.clear();
  clearAllPinRateLimitsPersistent().catch(() => {});
}

/**
 * Sliding window rate limit check for strike voting actions keyed to the authenticated voter.
 * Ensures strike voting attempts are isolated from shared IP and PIN failure counters.
 *
 * @param voterId - ID of authenticated voter
 * @param maxAttempts - Maximum voting attempts permitted within the window (default 10)
 * @param windowMs - Sliding rate limit window in milliseconds (default 1 minute)
 * @returns Rate limit evaluation result with allowed boolean and retryAfterSeconds
 */
export async function checkVoteRateLimitPersistent(
  voterId: string,
  maxAttempts = 10,
  windowMs = 60 * 1000
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const cleanVoterId = voterId ? voterId.trim() : '';
  if (!cleanVoterId) return { allowed: true, retryAfterSeconds: 0 };
  const key = `vote:voter:${cleanVoterId}`;

  const now = Date.now();
  const entry = pinRateLimits.get(key);
  if (entry && now < entry.resetAt) {
    if (entry.attempts >= maxAttempts) {
      const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      return { allowed: false, retryAfterSeconds };
    }
  }

  try {
    const client = getSupabase();
    if (!client) return { allowed: true, retryAfterSeconds: 0 };

    const nowIso = new Date().toISOString();
    const { data, error } = await client
      .from('rate_limits')
      .select('count, expires_at')
      .eq('key', key)
      .gt('expires_at', nowIso)
      .maybeSingle();

    if (!error && data) {
      if (data.count >= maxAttempts) {
        const resetMs = new Date(data.expires_at).getTime();
        const retryAfterSeconds = Math.max(1, Math.ceil((resetMs - now) / 1000));
        pinRateLimits.set(key, { attempts: data.count, resetAt: resetMs });
        return { allowed: false, retryAfterSeconds };
      }
    }
  } catch {
    // Graceful fallback to in-memory state
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Records a strike vote attempt against the authenticated voter's persistent rate limit counter.
 * Does not read or modify shared IP or target PIN-failure counters.
 *
 * @param voterId - ID of authenticated voter
 * @param windowMs - Sliding rate limit window in milliseconds (default 1 minute)
 */
export async function recordVoteAttemptPersistent(
  voterId: string,
  windowMs = 60 * 1000
): Promise<void> {
  const cleanVoterId = voterId ? voterId.trim() : '';
  if (!cleanVoterId) return;
  const key = `vote:voter:${cleanVoterId}`;

  const nowMs = Date.now();
  const resetAtMs = nowMs + windowMs;
  const resetAtIso = new Date(resetAtMs).toISOString();
  const nowIso = new Date(nowMs).toISOString();

  // Local memory cache
  const entry = pinRateLimits.get(key);
  if (!entry || nowMs > entry.resetAt) {
    pinRateLimits.set(key, { attempts: 1, resetAt: resetAtMs });
  } else {
    entry.attempts += 1;
  }

  // Supabase persistence in rate_limits
  try {
    const client = getSupabase();
    if (!client) return;

    const { data: existing } = await client
      .from('rate_limits')
      .select('count, expires_at')
      .eq('key', key)
      .maybeSingle();

    if (existing && new Date(existing.expires_at).getTime() > nowMs) {
      await client
        .from('rate_limits')
        .update({
          count: existing.count + 1,
        })
        .eq('key', key);
    } else {
      await client.from('rate_limits').upsert(
        {
          key,
          count: 1,
          window_start: nowIso,
          expires_at: resetAtIso,
        },
        { onConflict: 'key' }
      );
    }
  } catch {
    // Non-blocking in case table is temporarily unavailable
  }
}
