import crypto from 'crypto';
import type { NextResponse } from 'next/server';
import type { Member } from '@/lib/db';

export const SESSION_COOKIE_NAME = 'zcatchers_session';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 90; // 90 days

/**
 * Payload contained in signed HMAC-SHA256 session tokens.
 */
export interface SessionPayload {
  memberId: string;
  discordId?: string | null;
  isModerator: boolean;
  exp: number;
}

/**
 * Payload contained in signed Discord claim tokens during first-time onboarding.
 */
export interface ClaimTokenPayload {
  discordId: string;
  discordUsername: string;
  avatarUrl: string | null;
  isModerator: boolean;
  suggestedMemberId?: string | null;
  exp: number;
}

/**
 * Retrieves the cryptographic salt used for PIN hashing from the PIN_SALT environment variable.
 * Throws in production if missing; falls back to dev salt in development mode.
 *
 * @returns Secret salt string
 */
export function getPinSalt(): string {
  const isProd = process.env.NODE_ENV === 'production';
  const salt = process.env.PIN_SALT;
  if (!salt) {
    if (isProd) {
      throw new Error('PIN_SALT environment variable is required in production.');
    }
    return 'z_catchers_salt_dev_only';
  }
  return salt;
}

/**
 * Retrieves the secret used for signing session tokens from SESSION_SECRET environment variable.
 * Throws in production if missing; falls back to dev secret in development mode.
 *
 * @returns Secret session string
 */
export function getSessionSecret(): string {
  const isProd = process.env.NODE_ENV === 'production';
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    if (isProd) {
      throw new Error('SESSION_SECRET environment variable is required in production.');
    }
    return 'z_catchers_session_secret_dev_only';
  }
  return secret;
}

/**
 * Hash a member's 4-digit PIN for safe database storage.
 * @deprecated Legacy PIN helper maintained for backward compatibility.
 */
export function hashPin(pin: string, salt?: string): string {
  const activeSalt = salt || getPinSalt();
  return crypto.createHmac('sha256', activeSalt).update(pin.trim()).digest('hex');
}

/**
 * Verifies a provided PIN against the member's stored passcode hash.
 * @deprecated Legacy PIN helper maintained for backward compatibility.
 */
export function verifyPin(pin: string, storedHash: string | null, salt?: string): boolean {
  if (!pin || !storedHash) return false;
  try {
    const computed = hashPin(pin, salt);
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(storedHash));
  } catch {
    return false;
  }
}

/**
 * Verifies the master Moderator Secret Passcode using timing-safe comparison.
 */
export function verifyModPasscode(passcode: string | null | undefined): boolean {
  if (!passcode) return false;
  try {
    const defaultPasscode = process.env.NODE_ENV === 'production' ? null : 'cozyfox2026';
    const modPasscode = (process.env.MOD_SECRET_PASSCODE || defaultPasscode)?.trim();
    if (!modPasscode) {
      console.warn('MOD_SECRET_PASSCODE is not set in production. Mod access disabled.');
      return false;
    }
    const input = passcode.trim();

    // Hash with sha256 to ensure equal length buffers and prevent timing attacks
    const expectedHash = crypto.createHash('sha256').update(modPasscode).digest();
    const actualHash = crypto.createHash('sha256').update(input).digest();

    return crypto.timingSafeEqual(expectedHash, actualHash);
  } catch {
    return false;
  }
}

/**
 * Checks whether a Discord Snowflake ID is registered in MOD_DISCORD_IDS.
 *
 * @param discordId - Discord snowflake ID
 * @returns True if ID is listed as moderator
 */
export function isModDiscordId(discordId: string | null | undefined): boolean {
  if (!discordId) return false;
  const modIdsStr = process.env.MOD_DISCORD_IDS || '';
  const modIds = modIdsStr
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return modIds.includes(discordId.trim());
}

/**
 * Resolves the canonical application base URL for OAuth callbacks and redirects.
 *
 * @param request - Incoming HTTP request
 * @returns Canonical base URL string (without trailing slash)
 */
export function getAppBaseUrl(request: Request): string {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (envUrl && !envUrl.includes('placeholder') && !envUrl.includes('your-production-domain')) {
    return envUrl.replace(/\/+$/, '');
  }
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') || 'http';
  if (host) {
    return `${proto}://${host}`;
  }
  return 'http://localhost:3000';
}

/**
 * Generates an HMAC-SHA256 signed session token for a member.
 * Supports legacy memberId string or modern session payload object.
 * Valid for 90 days by default (rolling renewal).
 *
 * @param data - Member ID string or session configuration object
 * @param maxAgeDays - Expiration in days (default: 90)
 * @returns Signed session token string
 */
export function createSessionToken(
  data: string | { memberId: string; discordId?: string | null; isModerator?: boolean },
  maxAgeDays: number = 90
): string {
  const secret = getSessionSecret();
  const payloadObj: SessionPayload =
    typeof data === 'string'
      ? {
          memberId: data,
          discordId: null,
          isModerator: false,
          exp: Date.now() + 1000 * 60 * 60 * 24 * maxAgeDays,
        }
      : {
          memberId: data.memberId,
          discordId: data.discordId ?? null,
          isModerator: Boolean(data.isModerator),
          exp: Date.now() + 1000 * 60 * 60 * 24 * maxAgeDays,
        };

  const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');

  return `${payload}.${signature}`;
}

/**
 * Verifies and decodes a session token. Returns null if invalid or expired.
 * Handles both modern SessionPayload and legacy tokens.
 *
 * @param token - Bearer or cookie session token
 * @returns Decoded session payload or null
 */
export function verifySessionToken(token: string | null | undefined): SessionPayload | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;

  try {
    const secret = getSessionSecret();
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('base64url');

    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSignature);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }

    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!decoded.memberId || !decoded.exp || Date.now() > decoded.exp) {
      return null;
    }
    return {
      memberId: decoded.memberId,
      discordId: decoded.discordId ?? null,
      isModerator: Boolean(decoded.isModerator),
      exp: decoded.exp,
    };
  } catch {
    return null;
  }
}

/**
 * Generates an HMAC-SHA256 signed claim token for first-time Discord logins.
 *
 * @param data - Candidate Discord profile data
 * @param validMinutes - Token validity window (default: 60 minutes)
 * @returns Signed claim token string
 */
export function createClaimToken(
  data: Omit<ClaimTokenPayload, 'exp'>,
  validMinutes: number = 60
): string {
  const secret = getSessionSecret();
  const payloadObj: ClaimTokenPayload = {
    ...data,
    exp: Date.now() + 1000 * 60 * validMinutes,
  };
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

/**
 * Verifies and decodes a signed Discord claim token.
 *
 * @param token - Claim token from query parameter or cookie
 * @returns Decoded claim payload or null
 */
export function verifyClaimToken(token: string | null | undefined): ClaimTokenPayload | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;

  try {
    const secret = getSessionSecret();
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('base64url');

    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSignature);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }

    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!decoded.discordId || !decoded.exp || Date.now() > decoded.exp) {
      return null;
    }
    return decoded as ClaimTokenPayload;
  } catch {
    return null;
  }
}

/**
 * Extracts and verifies the session payload from request Authorization header or Cookie.
 *
 * @param request - Incoming HTTP request
 * @returns Decoded SessionPayload or null
 */
export function getRequestSession(request: Request): SessionPayload | null {
  // 1. Check Authorization header: Bearer <token>
  const authHeader = request.headers.get('authorization');
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    const session = verifySessionToken(token);
    if (session) return session;
  }

  // 2. Check Cookie header: zcatchers_session=<token>
  const cookieHeader = request.headers.get('cookie');
  if (cookieHeader) {
    const match = cookieHeader.match(/zcatchers_session=([^;]+)/);
    if (match && match[1]) {
      const session = verifySessionToken(match[1]);
      if (session) return session;
    }
  }

  return null;
}

/**
 * Extracts and verifies the member ID from the request Authorization header or Cookie.
 *
 * @param request - Incoming HTTP request
 * @returns Member ID or null
 */
export function getRequestSessionMemberId(request: Request): string | null {
  const session = getRequestSession(request);
  return session?.memberId || null;
}

/**
 * Sets the long-lived zcatchers_session cookie on an HTTP response.
 * Configured with SameSite=Lax for mobile PWA OAuth redirect survival.
 *
 * @param response - Target NextResponse object
 * @param token - Signed session token
 * @param maxAge - Expiration in seconds (default: 90 days)
 */
export function setSessionCookie(
  response: NextResponse,
  token: string,
  maxAge: number = SESSION_MAX_AGE_SECONDS
): void {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge,
  });
}

/**
 * Strips sensitive authentication credentials (passcode_hash) from a Member record
 * and provides safe boolean indicators has_pin and is_moderator.
 *
 * @param member - Raw Member entity from database
 * @returns Sanitized Member object safe for client exposure
 */
export function sanitizeMember(member: Member): Member {
  const { passcode_hash, ...rest } = member;
  const isMod = Boolean(
    member.is_moderator || member.role === 'moderator' || isModDiscordId(member.discord_id)
  );
  return {
    ...rest,
    is_moderator: isMod,
    has_pin: Boolean(passcode_hash),
  };
}

export interface ModAuthResult {
  authorized: boolean;
  moderatorId?: string;
  moderatorRole?: 'master' | 'member_mod';
  error?: string;
}

/**
 * Enforces strict server-side moderator session and passcode validation.
 * Supports verified Discord moderator sessions and master passcode fallback.
 * Eliminates legacy moderator PIN requirement.
 *
 * @param request - Incoming HTTP request
 * @param passcodeFromBody - Optional master passcode from request body
 * @returns ModAuthResult indicating authorization status
 */
export async function verifyModeratorAuthorization(
  request: Request,
  passcodeFromBody?: string
): Promise<ModAuthResult> {
  // 1. Check Master Moderator Secret Passcode
  const headerPasscode = request.headers.get('x-mod-passcode');
  const candidatePasscode = (passcodeFromBody || headerPasscode)?.trim();

  if (candidatePasscode) {
    const isPasscodeMatch = verifyModPasscode(candidatePasscode);
    if (isPasscodeMatch) {
      return {
        authorized: true,
        moderatorId: 'master_mod',
        moderatorRole: 'master',
      };
    }
  }

  // 2. Check Authenticated Moderator Session Token
  const session = getRequestSession(request);
  if (session) {
    // Session token claims are used only for identity; always check live member record
    // and current moderator eligibility (including active status and live MOD_DISCORD_IDS)
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (url && key) {
        const client = createClient(url, key, { auth: { persistSession: false } });
        const { data: member } = await client
          .from('members')
          .select('id, role, is_active, discord_id, is_moderator')
          .eq('id', session.memberId)
          .single();

        if (
          member &&
          member.is_active &&
          (member.role === 'moderator' ||
            member.is_moderator === true ||
            isModDiscordId(member.discord_id))
        ) {
          return {
            authorized: true,
            moderatorId: member.id,
            moderatorRole: 'member_mod',
          };
        }
      }
    } catch {
      // Continue to unauthorized response
    }
  }

  return {
    authorized: false,
    error: 'Unauthorized: Active moderator session or master moderator secret passcode required.',
  };
}
