/**
 * In-memory sliding window rate limiter for PIN verification and sensitive auth gates.
 * Protects against brute-force attacks across IP addresses and member targets.
 */

interface RateLimitEntry {
  attempts: number;
  resetAt: number;
}

// Preserve rate limit map on globalThis across Next.js module reloads and chunks
const globalForRateLimit = globalThis as unknown as {
  __pinRateLimits?: Map<string, RateLimitEntry>;
};

const pinRateLimits = globalForRateLimit.__pinRateLimits || new Map<string, RateLimitEntry>();
globalForRateLimit.__pinRateLimits = pinRateLimits;

// Purge expired entries periodically every 5 minutes
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
}

/**
 * Checks if a member/IP has exceeded the maximum allowed failed attempts.
 * Standard threshold: 5 failed attempts per 15-minute sliding window.
 */
export function checkPinRateLimit(
  ip: string,
  targetId: string,
  maxAttempts = 5,
  windowMs = 15 * 60 * 1000
): RateLimitResult {
  const now = Date.now();
  const keys: string[] = [];
  if (ip && ip.trim()) keys.push(`ip:${ip.trim()}`);
  if (targetId && targetId.trim()) keys.push(`target:${targetId.trim()}`);

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
 * Records a failed PIN verification attempt.
 */
export function recordPinFailure(
  ip: string,
  targetId: string,
  windowMs = 15 * 60 * 1000
): void {
  const now = Date.now();
  const keys: string[] = [];
  if (ip && ip.trim()) keys.push(`ip:${ip.trim()}`);
  if (targetId && targetId.trim()) keys.push(`target:${targetId.trim()}`);

  for (const key of keys) {
    const entry = pinRateLimits.get(key);
    if (!entry || now > entry.resetAt) {
      pinRateLimits.set(key, { attempts: 1, resetAt: now + windowMs });
    } else {
      entry.attempts += 1;
    }
  }
}

/**
 * Clears failed attempts upon successful verification for the target member.
 * Preserves IP failure count to prevent attackers from clearing IP rate limits with valid credentials.
 */
export function resetPinFailure(ip: string, targetId: string): void {
  if (targetId && targetId.trim()) {
    pinRateLimits.delete(`target:${targetId.trim()}`);
  }
}

/**
 * Reset all rate limit state (primarily for automated testing).
 */
export function clearAllPinRateLimits(): void {
  pinRateLimits.clear();
}
