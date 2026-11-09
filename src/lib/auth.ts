import crypto from 'crypto';

const PIN_SALT = process.env.PIN_SALT || 'z_catchers_salt_2026_cozy_den';
const SESSION_SECRET = process.env.SESSION_SECRET || 'z_catchers_session_secret_2026_warm_dark';

/**
 * Hash a member's 4-digit PIN for safe database storage.
 */
export function hashPin(pin: string, salt = PIN_SALT): string {
  return crypto.createHmac('sha256', salt).update(pin.trim()).digest('hex');
}

/**
 * Verifies a provided PIN against the member's stored passcode hash.
 */
export function verifyPin(pin: string, storedHash: string | null, salt = PIN_SALT): boolean {
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
    const modPasscode = (process.env.MOD_SECRET_PASSCODE || 'cozyfox2026').trim();
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
 * Generates an HMAC-SHA256 signed session token for a member.
 * Valid for 30 days.
 */
export function createSessionToken(memberId: string): string {
  const payload = Buffer.from(
    JSON.stringify({
      memberId,
      exp: Date.now() + 1000 * 60 * 60 * 24 * 30, // 30 days
    })
  ).toString('base64url');

  const signature = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payload)
    .digest('base64url');

  return `${payload}.${signature}`;
}

/**
 * Verifies and decodes a session token. Returns null if invalid or expired.
 */
export function verifySessionToken(token: string | null | undefined): { memberId: string } | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;

  const expectedSignature = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payload)
    .digest('base64url');

  try {
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSignature);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }

    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!decoded.memberId || !decoded.exp || Date.now() > decoded.exp) {
      return null;
    }
    return { memberId: decoded.memberId };
  } catch {
    return null;
  }
}

/**
 * Extracts and verifies the member ID from the request Authorization header or Cookie.
 */
export function getRequestSessionMemberId(request: Request): string | null {
  // 1. Check Authorization header: Bearer <token>
  const authHeader = request.headers.get('authorization');
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    const session = verifySessionToken(token);
    if (session) return session.memberId;
  }

  // 2. Check Cookie header: zcatchers_session=<token>
  const cookieHeader = request.headers.get('cookie');
  if (cookieHeader) {
    const match = cookieHeader.match(/zcatchers_session=([^;]+)/);
    if (match && match[1]) {
      const session = verifySessionToken(match[1]);
      if (session) return session.memberId;
    }
  }

  return null;
}

