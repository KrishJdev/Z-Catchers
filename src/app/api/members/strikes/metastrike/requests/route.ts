import { getRequestSession, isSameOriginMutation } from '@/lib/auth';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/db';
import { isMetastrikeCycle, loadMetastrikeCycleContext, METASTRIKE_MONTH, metastrikeResponse } from '@/lib/metastrikes';
import { punishmentResponse, UUID_PATTERN } from '@/lib/punishments';

export async function GET(request: Request) {
  const session = getRequestSession(request);
  if (!session?.discordId) return punishmentResponse({ error: 'Sign in with Discord.' }, 401);
  const month = new URL(request.url).searchParams.get('month');
  if (month !== null && !METASTRIKE_MONTH.test(month)) {
    return punishmentResponse({ error: 'Choose a month in YYYY-MM format.' }, 400);
  }
  const context = await loadMetastrikeCycleContext(session.memberId);
  if (context instanceof Response) return context;
  const { data, error } = await supabaseAdmin.rpc('member_metastrikes', {
    p_member_id: session.memberId,
    p_discord_id: session.discordId,
    p_action: 'list',
    p_context: context,
    p_month: (month ?? context.local_month) + '-01',
  });
  return metastrikeResponse(data, error);
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return punishmentResponse({ error: 'Use a same-origin request.' }, 403);
  const session = getRequestSession(request);
  if (!session?.discordId) return punishmentResponse({ error: 'Sign in with Discord.' }, 401);
  const body = await request.json().catch(() => null);
  if (typeof body?.request_id !== 'string' || !UUID_PATTERN.test(body.request_id) ||
    'member_id' in body || !['submit', 'withdraw'].includes(body.action)) {
    return punishmentResponse({ error: 'Provide a request ID and a valid Metastrike action.' }, 400);
  }
  const args: Record<string, unknown> = {
    p_member_id: session.memberId, p_discord_id: session.discordId, p_action: body.action, p_id: body.request_id,
  };
  if (body.action === 'submit') {
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!isMetastrikeCycle(body.cycle_date) || !reason || Array.from(reason).length > 500) {
      return punishmentResponse({ error: 'Choose a sleep-cycle date and enter a reason of 1–500 characters.' }, 400);
    }
    const context = await loadMetastrikeCycleContext(session.memberId, body.cycle_date);
    if (context instanceof Response) return context;
    args.p_cycle = body.cycle_date;
    args.p_context = context;
    args.p_reason = reason;
  }
  if (!isSupabaseConfigured) return metastrikeResponse(null, null);
  const { data, error } = await supabaseAdmin.rpc('member_metastrikes', args);
  return metastrikeResponse(data, error);
}
