import { isSameOriginMutation, verifyModeratorSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/db';
import { loadMetastrikeCycleContext, metastrikeResponse } from '@/lib/metastrikes';
import { staffIdentity } from '@/lib/moderation';
import { punishmentResponse, UUID_PATTERN } from '@/lib/punishments';

export async function GET(request: Request) {
  const auth = await verifyModeratorSession(request);
  if (!auth.authorized) return punishmentResponse({ error: auth.error }, auth.status);
  const params = new URL(request.url).searchParams;
  const status = params.get('status') ?? 'pending';
  const offset = params.get('offset') ?? '0';
  const id = params.get('request_id');
  if (!['pending', 'decided'].includes(status) || !/^\d{1,10}$/.test(offset) || Number(offset) > 2147483597 ||
    (id !== null && !UUID_PATTERN.test(id))) {
    return punishmentResponse({ error: 'Invalid Metastrike queue filter.' }, 400);
  }
  const { data, error } = await supabaseAdmin.rpc('read_moderation_metastrikes', {
    ...staffIdentity(auth.actor), p_id: id, p_pending: status === 'pending', p_offset: Number(offset),
  });
  return metastrikeResponse(data, error);
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return punishmentResponse({ error: 'Use a same-origin request.' }, 403);
  const auth = await verifyModeratorSession(request);
  if (!auth.authorized) return punishmentResponse({ error: auth.error }, auth.status);
  const body = await request.json().catch(() => null);
  if (typeof body?.request_id !== 'string' || !UUID_PATTERN.test(body.request_id) ||
    'member_id' in body || !['approve', 'decline'].includes(body.action)) {
    return punishmentResponse({ error: 'Provide a request ID and a valid review action.' }, 400);
  }
  const identity = staffIdentity(auth.actor);
  const args: Record<string, unknown> = { ...identity, p_id: body.request_id, p_action: body.action };
  if (body.action === 'decline') {
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!reason || Array.from(reason).length > 500) {
      return punishmentResponse({ error: 'Enter a decline explanation of 1–500 characters.' }, 400);
    }
    args.p_reason = reason;
  } else {
    const source = body.expected_source_id;
    if (source !== null && (typeof source !== 'string' || !UUID_PATTERN.test(source))) {
      return punishmentResponse({ error: 'Provide the nightly strike source you reviewed, or null if there was none.' }, 400);
    }
    args.p_source_id = source;
    if (source === null) {
      const { data, error } = await supabaseAdmin.rpc('read_moderation_metastrikes', { ...identity, p_id: body.request_id });
      if (error || !data?.item) return metastrikeResponse(null, error);
      if (data.item.member_active) {
        const context = await loadMetastrikeCycleContext(data.item.member_id, data.item.cycle_date);
        if (context instanceof Response) return context;
        args.p_context = context;
      }
    }
  }
  const { data, error } = await supabaseAdmin.rpc('decide_metastrike', args);
  return metastrikeResponse(data, error);
}
