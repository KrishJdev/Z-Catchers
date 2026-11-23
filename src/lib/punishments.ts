import { NextResponse } from 'next/server';
import { isSupabaseConfigured, safeDatabaseErrorCode, supabaseAdmin } from '@/lib/db';
import { PUNISHMENT_ROLLOUT_CLOSED, PUNISHMENT_SERVICE_UNAVAILABLE } from '@/lib/punishmentAvailability';

export const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

type PunishmentOperation = 'member read' | 'roster count' | 'moderator read' | 'moderator write';
type DatabaseError = { code: string; message: string };

export function punishmentResponse(body: unknown, status = 200, headers?: HeadersInit) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Cache-Control', 'private, no-store');
  return NextResponse.json(body, { status, headers: responseHeaders });
}

function logPunishmentFailure(operation: PunishmentOperation, code?: string) {
  console.error('[punishments] Dependency failure', { operation, databaseCode: safeDatabaseErrorCode(code) });
}

export function punishmentDependencyResponse(operation: PunishmentOperation, code?: string) {
  logPunishmentFailure(operation, code);
  return punishmentResponse({
    code: PUNISHMENT_SERVICE_UNAVAILABLE,
    error: 'Could not reach the punishment service. Try again.',
  }, 503);
}

export function punishmentRpcResponse(operation: PunishmentOperation, data: unknown, error: DatabaseError | null) {
  if (!error && data != null) return punishmentResponse(data);
  // require_punishment_visibility is the only punishment RPC source of PT503.
  if (error?.code === 'PT503') {
    return punishmentResponse({ code: PUNISHMENT_ROLLOUT_CLOSED, error: 'Punishments are closed for now.' }, 503);
  }
  if (error && /^PT(400|403|404|409)$/.test(error.code)) {
    return punishmentResponse({ error: error.message }, Number(error.code.slice(2)));
  }
  return punishmentDependencyResponse(operation, error?.code);
}

export async function getOpenPunishmentCount(memberId: string, discordId: string): Promise<number | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabaseAdmin.rpc('get_member_punishments', {
    p_member_id: memberId,
    p_discord_id: discordId,
    p_details: false,
  });
  if (!error && typeof data?.open_count === 'number') return data.open_count;
  if (error?.code !== 'PT403' && error?.code !== 'PT503') logPunishmentFailure('roster count', error?.code);
  return null;
}
