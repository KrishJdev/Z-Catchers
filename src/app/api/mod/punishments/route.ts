import { isSameOriginMutation, verifyModeratorSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/db';
import { punishmentDependencyResponse, punishmentResponse, punishmentRpcResponse, UUID_PATTERN } from '@/lib/punishments';
import { staffIdentity } from '@/lib/moderation';
import { DateTime } from 'luxon';

export async function GET(request: Request) {
  const auth = await verifyModeratorSession(request);
  if (!auth.authorized) {
    if (auth.status === 503) return punishmentDependencyResponse('moderator read', auth.databaseCode);
    return punishmentResponse({ error: auth.error }, auth.status);
  }

  const params = new URL(request.url).searchParams;
  const id = params.get('punishment_id');
  const status = params.get('status') ?? 'awaiting_assignment';
  const offset = params.get('offset') ?? '0';
  if ((id !== null && !UUID_PATTERN.test(id)) ||
    !['awaiting_assignment', 'assigned', 'pending'].includes(status) ||
    !/^\d{1,10}$/.test(offset) || Number(offset) > 2147483597) {
    return punishmentResponse({ error: 'Invalid punishment queue filter.' }, 400);
  }

  const { data, error } = await supabaseAdmin.rpc('read_moderation_punishments', {
    ...staffIdentity(auth.actor),
    p_id: id,
    p_status: status,
    p_offset: Number(offset),
  });
  return punishmentRpcResponse('moderator read', data, error);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!isSameOriginMutation(request)) return punishmentResponse({ error: 'Use a same-origin request.' }, 403);
  const auth = await verifyModeratorSession(request);
  if (!auth.authorized) {
    if (auth.status === 503) return punishmentDependencyResponse('moderator write', auth.databaseCode);
    return punishmentResponse({ error: auth.error }, auth.status);
  }

  if (typeof body?.punishment_id !== 'string' || !UUID_PATTERN.test(body.punishment_id) || 'member_id' in body) {
    return punishmentResponse({ error: 'Provide a punishment ID to identify the task and its member.' }, 400);
  }

  const { action, punishment_id, title, instructions, cycle_date, source_id, reason, request_id, due_at } = body;
  const args: Record<string, string | null> = { ...staffIdentity(auth.actor), p_id: punishment_id, p_action: action };
  if (action === 'assign' || action === 'edit') {
    if (typeof title !== 'string' || !title.trim() || title.trim().length > 120 ||
      (instructions != null && (typeof instructions !== 'string' || instructions.trim().length > 2000))) {
      return punishmentResponse({ error: 'Enter a task title of up to 120 characters and up to 2,000 characters of instructions.' }, 400);
    }
    args.p_title = title.trim();
    args.p_instructions = instructions?.trim() || null;
    if (due_at != null) {
      if (typeof due_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-5]):[0-5]\d)$/.test(due_at) ||
        !DateTime.fromISO(due_at, { setZone: true }).isValid) {
        return punishmentResponse({ error: 'Enter a valid completion deadline with a timezone.' }, 400);
      }
      // The deadline overload requires all argument names to be present in the RPC call.
      Object.assign(args, { p_cycle: null, p_source: null, p_reason: null, p_request_id: null, p_due_at: due_at });
    }
  } else if (action === 'add_strike' || action === 'remove_strike') {
    if (typeof cycle_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(cycle_date) ||
      !DateTime.fromISO(cycle_date, { zone: 'utc' }).isValid ||
      typeof request_id !== 'string' || !UUID_PATTERN.test(request_id) ||
      typeof reason !== 'string' || !reason.trim() || reason.trim().length > 500 ||
      (action === 'remove_strike' ? typeof source_id !== 'string' || !UUID_PATTERN.test(source_id) : source_id != null)) {
      return punishmentResponse({ error: 'Provide a cycle date, request ID, and reason. Removal requires a strike source ID.' }, 400);
    }
    args.p_cycle = cycle_date;
    args.p_source = source_id ?? null;
    args.p_reason = reason.trim();
    args.p_request_id = request_id;
  } else if (action !== 'complete') {
    return punishmentResponse({ error: 'Unknown punishment action.' }, 400);
  }

  const { data, error } = await supabaseAdmin.rpc('moderate_punishment', args);
  return punishmentRpcResponse('moderator write', data, error);
}
