import { NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/db';

export const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export const PUNISHMENTS_UNAVAILABLE = 'Punishments are currently unavailable.';

export function punishmentResponse(body: unknown, status = 200, headers?: HeadersInit) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Cache-Control', 'private, no-store');
  return NextResponse.json(body, { status, headers: responseHeaders });
}

export function punishmentRpcResponse(data: unknown, error: { code: string; message: string } | null) {
  if (!error && data != null) return punishmentResponse(data);
  if (error && /^PT(400|403|404|409|503)$/.test(error.code)) {
    return punishmentResponse({ error: error.message }, Number(error.code.slice(2)));
  }
  if (error) console.error('[punishments] Database request failed:', error.code, error.message);
  return punishmentResponse({ error: PUNISHMENTS_UNAVAILABLE }, 503);
}

export async function getOpenPunishmentCount(memberId: string, discordId: string): Promise<number | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabaseAdmin.rpc('get_member_punishments', {
    p_member_id: memberId,
    p_discord_id: discordId,
    p_details: false,
  });
  return !error && typeof data?.open_count === 'number' ? data.open_count : null;
}
