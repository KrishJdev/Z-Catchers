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
