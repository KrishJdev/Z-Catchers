import { NextResponse } from 'next/server';
import { verifyModeratorSession, isSameOriginMutation } from '@/lib/auth';
import { staffIdentity, staffWriteError } from '@/lib/moderation';
import { supabaseAdmin, Member } from '@/lib/db';
import {
  validateDiscordWebhookUrl,
  getDiscordWebhookUrl,
  sendTestDiscordWebhook,
  sendMorningDigestDiscordWebhook,
} from '@/lib/discordWebhook';

/**
 * GET: Retrieve Discord community webhook configuration status with masked token.
 * Requires the signed-in Owner.
 *
 * @param request - Incoming HTTP request with a linked Discord session
 * @returns JSON response with configuration status and masked webhook URL
 */
export async function GET(request: Request) {
  try {
    const auth = await verifyModeratorSession(request);
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status });
    if (auth.actor.role !== 'owner') return NextResponse.json({ error: 'Owner access is required.' }, { status: 403 });

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
 * Requires the signed-in Owner.
 *
 * @param request - Incoming HTTP request with the webhook action
 * @returns JSON response confirming webhook action result
 */
export async function POST(request: Request) {
  try {
    if (!isSameOriginMutation(request)) {
      return NextResponse.json({ error: 'Use a same-origin request.' }, { status: 403 });
    }
    const auth = await verifyModeratorSession(request);
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status });
    if (auth.actor.role !== 'owner') return NextResponse.json({ error: 'Owner access is required.' }, { status: 403 });

    const { action, webhook_url } = await request.json().catch(() => ({}));
    const audit = () => supabaseAdmin.rpc('record_moderation_webhook_action', {
      ...staffIdentity(auth.actor), p_action: action,
    });

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

      const { error: auditError } = await audit();
      if (auditError) return staffWriteError(auditError);

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

      const { error: auditError } = await audit();
      if (auditError) return staffWriteError(auditError);

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
