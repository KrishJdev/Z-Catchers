/**
 * Pre-seeded demo member fingerprint definitions and helper utilities.
 * Used to identify and safely purge default demo profiles (Aoi, SarahK, Marcus, Arjun)
 * without impacting real community members who share common names.
 */

export interface DemoSeedFingerprint {
  discord_username: string;
  discord_handle: string;
  journal_url: string;
  avatar_url?: string;
}

export const DEMO_SEED_FINGERPRINTS: readonly DemoSeedFingerprint[] = [
  {
    discord_username: 'Aoi',
    discord_handle: 'aoi_jp',
    journal_url: 'https://discord.com/channels/123456789/987654321',
    avatar_url: 'https://api.dicebear.com/7.x/bottts/svg?seed=Aoi',
  },
  {
    discord_username: 'SarahK',
    discord_handle: 'sarah_ny',
    journal_url: 'https://discord.com/channels/123456789/987654322',
    avatar_url: 'https://api.dicebear.com/7.x/bottts/svg?seed=SarahK',
  },
  {
    discord_username: 'Marcus',
    discord_handle: 'marcus_ldn',
    journal_url: 'https://discord.com/channels/123456789/987654323',
    avatar_url: 'https://api.dicebear.com/7.x/bottts/svg?seed=Marcus',
  },
  {
    discord_username: 'Arjun',
    discord_handle: 'arjun_in',
    journal_url: 'https://discord.com/channels/123456789/987654324',
    avatar_url: 'https://api.dicebear.com/7.x/bottts/svg?seed=Arjun',
  },
] as const;

/**
 * Checks if a member profile matches one of the pre-seeded demo member fingerprints.
 * Strictly verifies username, handle, and the dummy test journal URL to prevent false positives.
 */
export function isDemoSeedMember(member: {
  discord_username?: string | null;
  discord_handle?: string | null;
  journal_url?: string | null;
}): boolean {
  if (!member || !member.discord_username) return false;
  const username = member.discord_username.trim().toLowerCase();
  const handle = (member.discord_handle || '').trim().toLowerCase();
  const journal = (member.journal_url || '').trim();

  return DEMO_SEED_FINGERPRINTS.some(
    (seed) =>
      seed.discord_username.toLowerCase() === username &&
      seed.discord_handle.toLowerCase() === handle &&
      seed.journal_url === journal
  );
}
