export const PUNISHMENT_ROLLOUT_CLOSED = 'PUNISHMENT_ROLLOUT_CLOSED';
export const PUNISHMENT_SERVICE_UNAVAILABLE = 'PUNISHMENT_SERVICE_UNAVAILABLE';

export type PunishmentReadFailure = 'closed' | 'unavailable' | 'sign-in' | 'forbidden';

export async function readPunishmentFailure(response: Response): Promise<PunishmentReadFailure> {
  if (response.status === 401) return 'sign-in';
  if (response.status === 403) return 'forbidden';
  if (response.status === 503) {
    const body = await response.json().catch(() => null);
    if (body?.code === PUNISHMENT_ROLLOUT_CLOSED) return 'closed';
  }
  return 'unavailable';
}
