import type { Member } from '@/lib/db';
import { getStreakMilestoneBadge } from '@/lib/sleepEngine';

/**
 * Valid Discord incoming webhook endpoint regex.
 * Example: https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_123456
 */
export const DISCORD_WEBHOOK_REGEX =
  /^https:\/\/(ptb\.|canary\.)?discord\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/;

export function validateDiscordWebhookUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;
  return DISCORD_WEBHOOK_REGEX.test(url.trim());
}

/**
 * Resolves the active webhook URL from override or environment.
 */
export function getDiscordWebhookUrl(overrideUrl?: string | null): string | null {
  if (overrideUrl && validateDiscordWebhookUrl(overrideUrl)) {
    return overrideUrl.trim();
  }
  const envUrl = process.env.DISCORD_COMMUNITY_WEBHOOK_URL;
  if (envUrl && validateDiscordWebhookUrl(envUrl)) {
    return envUrl.trim();
  }
  return null;
}

// Warm Dark Embed Color Tokens (Decimal representations for Discord API)
export const DISCORD_EMBED_COLORS = {
  CORAL_NAG: 14711391, // #E07A5F (Bedtime Hit / Nag Window)
  AMBER_COZY: 16032353, // #F4A261 (Wind-Down / Warning)
  SAGE_REST: 8500122, // #81B29A (Morning / Goodnight / Safe In Bed)
  SLUMBER_NIGHT: 4014171, // #3D405B (Asleep / Sleep Shield Active)
};

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: DiscordEmbedField[];
  footer?: {
    text: string;
    icon_url?: string;
  };
  timestamp?: string;
  thumbnail?: {
    url: string;
  };
}

export interface DiscordWebhookPayload {
  username?: string;
  avatar_url?: string;
  content?: string;
  embeds?: DiscordEmbed[];
}

export interface WebhookSendResult {
  success: boolean;
  statusCode?: number;
  error?: string;
}

const SLEEPY_FOX_BOT_NAME = 'Sleepy Fox | Z Catchers';
const SLEEPY_FOX_AVATAR =
  'https://raw.githubusercontent.com/KrishJdev/Z-Catchers/main/public/icons/icon-192x192.png';

/**
 * Dispatches a payload to a Discord incoming webhook URL.
 */
export async function sendDiscordWebhook(
  payload: DiscordWebhookPayload,
  webhookUrl?: string | null
): Promise<WebhookSendResult> {
  const targetUrl = getDiscordWebhookUrl(webhookUrl);
  if (!targetUrl) {
    return {
      success: false,
      error: 'Discord webhook URL is not configured or failed validation regex.',
    };
  }

  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: payload.username || SLEEPY_FOX_BOT_NAME,
        avatar_url: payload.avatar_url || SLEEPY_FOX_AVATAR,
        content: payload.content,
        embeds: payload.embeds,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        statusCode: response.status,
        error: `Discord Webhook HTTP ${response.status}: ${errorText}`,
      };
    }

    return {
      success: true,
      statusCode: response.status,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown network error';
    return {
      success: false,
      error: `Network error dispatching Discord webhook: ${message}`,
    };
  }
}

/**
 * Sends a rich bedtime alert embed to the community Discord announcement channel.
 * Triggered at T-0m when a member's bedtime hits and they haven't checked into bed early.
 */
export async function sendBedtimeDiscordWebhook(
  member: Member,
  streakDays: number = 0,
  options: { webhookUrl?: string | null; effectiveBedtime?: string } = {}
): Promise<WebhookSendResult> {
  const zoneName = member.timezone.split('/').pop()?.replace(/_/g, ' ') || member.timezone;
  const milestone = getStreakMilestoneBadge(streakDays);
  const streakText =
    streakDays > 0
      ? `${streakDays} consecutive day${streakDays === 1 ? '' : 's'} on track ${milestone?.icon || '🔥'}`
      : 'Starting fresh tonight';

  const displayBedtime = options.effectiveBedtime || member.bedtime_local;

  const embed: DiscordEmbed = {
    title: `🚨 Bedtime Alert: ${member.discord_username}`,
    description: `It's **${displayBedtime}** in **${zoneName}**! Friends in awake timezones, make sure ${member.discord_username} logs off and catches some rest. 🦊💤`,
    url: member.journal_url,
    color: DISCORD_EMBED_COLORS.CORAL_NAG,
    fields: [
      {
        name: '🛌 Bedtime (Local Time)',
        value: `\`${displayBedtime}\` (${zoneName})`,
        inline: true,
      },
      {
        name: '🔥 Sleep Streak',
        value: streakText,
        inline: true,
      },
      {
        name: '🛡️ Sleep Shield Guarantee',
        value:
          'Personal alerts muted during 8-hour sleep window. Sleeping members are never pinged.',
        inline: false,
      },
      {
        name: '🔗 Discord Journal Thread',
        value: `[Open ${member.discord_username}'s Journal Thread](${member.journal_url})`,
        inline: false,
      },
    ],
    footer: {
      text: 'Z Catchers • Protecting Cross-Timezone Community Rest 🦊',
    },
    timestamp: new Date().toISOString(),
  };

  return sendDiscordWebhook(
    {
      embeds: [embed],
    },
    options.webhookUrl
  );
}

/**
 * Sends a morning wake-up and slumber recap digest into the Discord channel.
 */
export async function sendMorningDigestDiscordWebhook(
  members: Member[],
  options: { webhookUrl?: string | null } = {}
): Promise<WebhookSendResult> {
  const sortedByStreak = [...members]
    .filter((m) => (m.streak_days || 0) > 0)
    .sort((a, b) => (b.streak_days || 0) - (a.streak_days || 0));

  const topStreaks = sortedByStreak.slice(0, 5);
  const championsText =
    topStreaks.length > 0
      ? topStreaks
          .map((m, i) => {
            const milestone = getStreakMilestoneBadge(m.streak_days || 0);
            const medal = i === 0 ? '👑' : i === 1 ? '🥈' : i === 2 ? '🥉' : '✨';
            return `${medal} **${m.discord_username}**: ${m.streak_days} days on track (${milestone?.badgeLabel || 'Streak'})`;
          })
          .join('\n')
      : 'Every fox is resting cozy! Start your streak tonight.';

  const checkedInMembers = members.filter((m) => m.is_in_bed);
  const checkedInText =
    checkedInMembers.length > 0
      ? `${checkedInMembers.length} member${checkedInMembers.length === 1 ? '' : 's'} safely checked in with the Sleep Shield last night.`
      : 'All members resting across timezones.';

  const embed: DiscordEmbed = {
    title: '☀️ Den Rise & Shine: Daily Sleep & Streak Report',
    description:
      'Good morning, foxes! Here is our cross-timezone accountability update for today.',
    color: DISCORD_EMBED_COLORS.SAGE_REST,
    fields: [
      {
        name: '🏆 Slumber Champions',
        value: championsText,
        inline: false,
      },
      {
        name: '🛏️ Sleep Shield Status',
        value: checkedInText,
        inline: false,
      },
    ],
    footer: {
      text: 'Z Catchers Sleep Engine • Keep catching those Zs 🦊💤',
    },
    timestamp: new Date().toISOString(),
  };

  return sendDiscordWebhook(
    {
      embeds: [embed],
    },
    options.webhookUrl
  );
}

/**
 * Sends a test embed to verify incoming Discord webhook integration.
 */
export async function sendTestDiscordWebhook(
  webhookUrl: string
): Promise<WebhookSendResult> {
  const embed: DiscordEmbed = {
    title: '🦊 Z Catchers Webhook Connected!',
    description:
      'This is a verification test from **Z Catchers**. Automated bedtime alerts and morning slumber digests will now safely arrive in this channel.',
    color: DISCORD_EMBED_COLORS.AMBER_COZY,
    fields: [
      {
        name: '🛡️ Sleep Shield Protection',
        value: 'Push notifications are strictly muted during each member\'s 8-hour sleep window.',
        inline: true,
      },
      {
        name: '⏳ 48-Hour Cooldown',
        value: 'Bedtime shifts enter a 48-hour pending queue to prevent bedtime dodging.',
        inline: true,
      },
    ],
    footer: {
      text: 'Sleepy Fox Mascot • Antigravity Verified',
    },
    timestamp: new Date().toISOString(),
  };

  return sendDiscordWebhook(
    {
      embeds: [embed],
    },
    webhookUrl
  );
}
