import { NextResponse } from 'next/server';
import { verifyModPasscode, getRequestSessionMemberId } from '@/lib/auth';
import { supabaseAdmin, Member } from '@/lib/db';
import {
  validateDiscordWebhookUrl,
  getDiscordWebhookUrl,
  sendTestDiscordWebhook,
  sendMorningDigestDiscordWebhook,
} from '@/lib/discordWebhook';

async function isAuthorizedMod(request: Request, bodyPasscode?: string): Promise<boolean> {
  // 1. Check direct passcode header or body
  const headerPasscode = request.headers.get('x-mod-passcode');
  const passcode = headerPasscode || bodyPasscode;
  if (passcode && verifyModPasscode(passcode)) {
    return true;
  }

  // 2. Check authenticated session for moderator role
  const sessionMemberId = getRequestSessionMemberId(request);
  if (sessionMemberId) {
    const { data: member } = await supabaseAdmin
      .from('members')
      .select('role, is_active')
      .eq('id', sessionMemberId)
      .single();

    if (member && member.is_active && member.role === 'moderator') {
      return true;
    }
  }

  return false;
}

export async function GET(request: Request) {
  try {
    const isAuthed = await isAuthorizedMod(request);
    if (!isAuthed) {
      return NextResponse.json({ error: 'Unauthorized moderator access' }, { status: 401 });
    }

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

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { passcode, action, webhook_url } = body;

    const isAuthed = await isAuthorizedMod(request, passcode);
    if (!isAuthed) {
      return NextResponse.json({ error: 'Unauthorized moderator access' }, { status: 401 });
    }

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
