import { getRequestSession } from '@/lib/auth';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/db';
import { punishmentResponse, punishmentRpcResponse, PUNISHMENTS_UNAVAILABLE } from '@/lib/punishments';

export async function GET(request: Request) {
  const session = getRequestSession(request);
  if (!session?.discordId) return punishmentResponse({ error: 'Sign in with Discord.' }, 401);

  const memberId = new URL(request.url).searchParams.get('memberId');
  if (memberId !== null && memberId !== session.memberId) {
    return punishmentResponse({ error: 'Only your own punishments are available here.' }, 403);
  }
  if (!isSupabaseConfigured) return punishmentResponse({ error: PUNISHMENTS_UNAVAILABLE }, 503);

  const { data, error } = await supabaseAdmin.rpc('get_member_punishments', {
    p_member_id: session.memberId,
    p_discord_id: session.discordId,
    p_details: true,
  });
  return punishmentRpcResponse(data, error);
}
