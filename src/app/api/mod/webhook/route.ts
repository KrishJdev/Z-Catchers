import { NextResponse } from 'next/server';
import { verifyModeratorAuthorization, getRequestSessionMemberId } from '@/lib/auth';
import {
  getClientIp,
  checkPinRateLimitPersistent,
  recordPinFailurePersistent,
  resetPinFailurePersistent,
} from '@/lib/rateLimit';
import { supabaseAdmin, Member } from '@/lib/db';
import {
  validateDiscordWebhookUrl,
  getDiscordWebhookUrl,
  sendTestDiscordWebhook,
  sendMorningDigestDiscordWebhook,
} from '@/lib/discordWebhook';

/**
 * GET: Retrieve Discord community webhook configuration status with masked token.
 * Requires moderator authorization.
 *
 * @param request - Incoming HTTP request with moderator credentials
 * @returns JSON response with configuration status and masked webhook URL
 */
export async function GET(request: Request) {
  try {
    const clientIp = getClientIp(request);
    const sessionMemberId = getRequestSessionMemberId(request);
    const modTarget = sessionMemberId ? `mod_member:${sessionMemberId}` : `mod_ip:${clientIp}`;

    const rateCheck = await checkPinRateLimitPersistent(clientIp, modTarget);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          error: `Too many failed attempts. Please wait ${rateCheck.retryAfterSeconds} seconds before trying again.`,
        },
        {
          status: 429,
          headers: { 'Retry-After': String(rateCheck.retryAfterSeconds) },
        }
      );
    }

    const authResult = await verifyModeratorAuthorization(request);
    if (!authResult.authorized) {
      await recordPinFailurePersistent(clientIp, modTarget);
      return NextResponse.json({ error: authResult.error || 'Unauthorized moderator access' }, { status: 401 });
    }

    await resetPinFailurePersistent(clientIp, modTarget);

    const envWebhook = process.env.DISCORD_COMMUNITY_WEBHOOK_URL;
    const isConfigured = Boolean(envWebhook && validateDiscordWebhookUrl(envWebhook));

    let maskedUrl: string | null = null;
    if (envWebhook && isConfigured) {
      const parts = envWebhook.split('/');
      const token = parts[parts.length - 1];
      const webhookId = parts[parts.length - 2];
      maskedUrl = `https://discord.com/api/webhooks/${webhookId}/••••••••${token.slice(-4)}`;
    }

    return NextResponse.json({
      configured: isConfigured,
      maskedUrl,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST: Send a test Discord webhook message or trigger morning digest dispatch.
 * Requires moderator authorization.
 *
 * @param request - Incoming HTTP request with moderator passcode and action
 * @returns JSON response confirming webhook action result
 */
export async function POST(request: Request) {
  try {
    const clientIp = getClientIp(request);
    const sessionMemberId = getRequestSessionMemberId(request);
    const modTarget = sessionMemberId ? `mod_member:${sessionMemberId}` : `mod_ip:${clientIp}`;

    const rateCheck = await checkPinRateLimitPersistent(clientIp, modTarget);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          error: `Too many failed attempts. Please wait ${rateCheck.retryAfterSeconds} seconds before trying again.`,
        },
        {
          status: 429,
          headers: { 'Retry-After': String(rateCheck.retryAfterSeconds) },
        }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { passcode, action, webhook_url } = body;

    const authResult = await verifyModeratorAuthorization(request, passcode);
    if (!authResult.authorized) {
      await recordPinFailurePersistent(clientIp, modTarget);
      return NextResponse.json({ error: authResult.error || 'Unauthorized moderator access' }, { status: 401 });
    }

    await resetPinFailurePersistent(clientIp, modTarget);

    if (action === 'verify') {
      const valid = validateDiscordWebhookUrl(webhook_url);
      return NextResponse.json({ valid });
    }

    if (action === 'test') {
      const targetUrl = webhook_url || getDiscordWebhookUrl();
      if (!targetUrl) {
        return NextResponse.json(
          { error: 'No valid Discord webhook URL provided or configured in environment' },
          { status: 400 }
        );
      }

      if (!validateDiscordWebhookUrl(targetUrl)) {
        return NextResponse.json(
          { error: 'Webhook URL failed Discord format validation' },
          { status: 400 }
        );
      }

      const res = await sendTestDiscordWebhook(targetUrl);
      if (!res.success) {
        return NextResponse.json({ error: res.error || 'Failed to dispatch test webhook' }, { status: 502 });
      }

      return NextResponse.json({ success: true, message: 'Test webhook sent successfully to Discord!' });
    }

    if (action === 'digest') {
      const targetUrl = webhook_url || getDiscordWebhookUrl();
      if (!targetUrl) {
        return NextResponse.json(
          { error: 'No valid Discord webhook URL provided or configured in environment' },
          { status: 400 }
        );
      }

      // Fetch active members to generate morning digest
      const { data: members } = await supabaseAdmin
        .from('members')
        .select('*')
        .eq('is_active', true);

      const res = await sendMorningDigestDiscordWebhook((members as Member[]) || [], {
        webhookUrl: targetUrl,
      });

      if (!res.success) {
        return NextResponse.json({ error: res.error || 'Failed to dispatch morning digest' }, { status: 502 });
      }

      return NextResponse.json({
        success: true,
        message: 'Morning slumber digest posted to Discord channel!',
      });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
