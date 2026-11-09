import crypto from 'crypto';

const PIN_SALT = process.env.PIN_SALT || 'z_catchers_salt_2026_cozy_den';

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
