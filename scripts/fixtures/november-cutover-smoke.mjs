import assert from 'node:assert/strict';

export const novemberAccounts = {
  'rollover-west': '100000000000000006',
  'rollover-east': '100000000000000007',
};

export async function insertLegacyNovemberFixtures(sql) {
  const members = JSON.parse(await sql(`
    WITH inserted AS (
      INSERT INTO public.members (discord_username, discord_id, timezone, bedtime_local, journal_url,
        strike_cycle_month, strikes_used, strikes_count, metastrikes_used, metastrikes_count, is_active)
      VALUES
        ('counter-only', NULL, 'UTC', '23:00', 'https://discord.com/channels/123/456', '2026-11', 3, 3, 0, 0, false),
        ('two-strikes', NULL, 'UTC', '23:00', 'https://discord.com/channels/123/456', '2026-11', 2, 2, 0, 0, false),
        ('rollover-west', '${novemberAccounts['rollover-west']}', 'America/Los_Angeles', '23:00',
          'https://discord.com/channels/123/456', '2026-11', 2, 2, 0, 0, false),
        ('rollover-east', '${novemberAccounts['rollover-east']}', 'Asia/Tokyo', '23:00',
          'https://discord.com/channels/123/456', '2026-11', 3, 3, 2, 2, false)
      RETURNING discord_username, id
    )
    SELECT jsonb_object_agg(discord_username, id) FROM inserted`));
  await sql(`
    INSERT INTO public.nightly_strike_logs (target_member_id, sleep_cycle_date, record_type, created_at, updated_at)
    SELECT member_id, '2026-11-' || lpad(day::text, 2, '0'), 'strike',
      (timestamp '2026-11-01 23:10' AT TIME ZONE zone) + (day - 1) * interval '1 day',
      (timestamp '2026-11-01 23:10' AT TIME ZONE zone) + (day - 1) * interval '1 day'
    FROM (VALUES ('${members['two-strikes']}'::uuid, 'UTC', 1),
      ('${members['rollover-west']}', 'America/Los_Angeles', 3),
      ('${members['rollover-east']}', 'Asia/Tokyo', 6)) AS fixture(member_id, zone, total)
    CROSS JOIN LATERAL generate_series(1, total) AS day;
    INSERT INTO public.nightly_strike_logs (target_member_id, sleep_cycle_date, record_type, created_at, updated_at)
    VALUES ('${members['rollover-east']}', '2026-11-07', 'metastrike', '2026-11-07T14:00Z', '2026-11-07T14:00Z');
  `);
  return members;
}

export async function verifyNovemberPreview(sql, members) {
  const snapshot = async () => JSON.parse(await sql(`
    SELECT jsonb_agg(to_jsonb(p) ORDER BY member_name) FROM public.november_punishment_preview() AS p
      WHERE member_id IN (${Object.values(members).map(id => `'${id}'`).join(', ')})`));
  const beforeCorrection = await snapshot();
  assert.deepEqual(beforeCorrection.filter(row => ['rollover-west', 'two-strikes'].includes(row.member_name))
    .map(row => [row.member_name, row.legacy_strikes_used, row.legacy_strikes_count,
      row.verified_strikes, row.counter_discrepancy, row.thresholds.length]), [
    ['rollover-west', 2, 2, 3, true, 1],
    ['two-strikes', 2, 2, 1, true, 0],
  ]);
  const correction = `SELECT public.record_verified_november_correction('${members['two-strikes']}', '2026-11-02',
    'ci-reviewed-moderator-strike', 'fixture-moderator', 'Verified dated strike');`;
  const correctionId = await sql(correction);
  assert.match(correctionId, /^[0-9a-f-]{36}$/);
  assert.equal(await sql(correction), correctionId);
  await sql(`
    UPDATE public.nightly_strike_logs SET replacement_until = clock_timestamp() + interval '3 hours'
      WHERE target_member_id = '${members['rollover-east']}' AND sleep_cycle_date = '2026-11-06';
  `);
  const preview = await snapshot();
  assert.deepEqual(preview.map(row => [
    row.member_name, row.verified_strikes, row.counter_discrepancy, row.used_passes,
    row.thresholds.map(item => item.status),
  ]), [
    ['counter-only', 0, true, 0, []],
    ['rollover-east', 6, true, 2, ['awaiting_assignment', 'pending']],
    ['rollover-west', 3, true, 0, ['awaiting_assignment']],
    ['two-strikes', 2, false, 0, []],
  ]);
  assert.deepEqual(preview.find(row => row.member_name === 'two-strikes').verified_rows
    .map(row => [row.cycle_date, row.source_type]), [['2026-11-01', 'nightly'], ['2026-11-02', 'moderator']]);
  assert.equal(await sql('SELECT count(*) FROM public.punishments'), '0');
  assert.equal(await sql('SELECT count(*) FROM public.punishment_actions'), '0');
  assert.equal(await sql('SELECT (activated_at IS NULL AND NOT screens_visible)::text FROM public.punishment_rollout'), 'true');
  assert.deepEqual(await snapshot(), preview);
  console.log('Verified inactive November preview, both production counter mismatches, a retryable dated correction, and preserved passes.');
  return preview;
}

export async function seedNovemberFixtures(sql, preview) {
  for (const { member_id: id } of preview) await sql(`SELECT public.seed_november_punishments('${id}')`);
  const thresholds = JSON.parse(await sql(`
    SELECT jsonb_agg(jsonb_build_object('id', p.id, 'member_id', p.member_id, 'threshold', p.threshold_number,
      'cycle', p.earned_cycle_date, 'deadline', p.assignable_at, 'status', p.effective_status,
      'earned_actions', (SELECT count(*) FROM public.punishment_actions a WHERE a.punishment_id = p.id
        AND action = 'earned')) ORDER BY m.discord_username, p.threshold_number)
    FROM public.punishment_task_status p JOIN public.members m ON m.id = p.member_id
    WHERE p.earned_month = '2026-11-01' AND p.member_id IN
      (${preview.map(row => `'${row.member_id}'`).join(', ')})`));
  assert.deepEqual(thresholds.map(({ id, ...threshold }) => threshold), preview.flatMap(row =>
    row.thresholds.map(item => ({
      member_id: row.member_id, threshold: item.threshold_number, cycle: item.earned_cycle_date,
      deadline: item.assignable_at, status: item.status, earned_actions: 1,
    }))));
  const passes = JSON.parse(await sql(`
    SELECT jsonb_object_agg(member_id, used) FROM public.strike_pass_months WHERE month_start = '2026-11-01'
      AND member_id IN (${preview.map(row => `'${row.member_id}'`).join(', ')})`));
  assert.deepEqual(passes, Object.fromEntries(preview.map(row => [row.member_id, row.used_passes])));
  return thresholds;
}

export async function verifyNovemberRollover(sql, members) {
  // Both zones have November work at 14:59Z. Tokyo rolls over first, then Los Angeles.
  const rows = await sql(`
    SELECT concat_ws('|', m.discord_username, to_char(boundary.at AT TIME ZONE 'UTC', 'DD HH24:MI'),
      month_start, (SELECT count(*) FROM public.verified_monthly_strikes(m, month_start)),
      public.count_open_punishments(m.id))
    FROM public.members m
    CROSS JOIN (VALUES ('2026-11-30T14:59Z'::timestamptz), ('2026-11-30T15:00Z'), ('2026-12-01T08:00Z')) boundary(at)
    CROSS JOIN LATERAL public.punishment_progress_month(m, boundary.at) AS month_start
    WHERE m.id IN ('${members['rollover-west']}', '${members['rollover-east']}')
    ORDER BY boundary.at, m.discord_username`);
  assert.equal(rows, [
    'rollover-east|30 14:59|2026-11-01|6|2',
    'rollover-west|30 14:59|2026-11-01|3|1',
    'rollover-east|30 15:00|2026-12-01|0|2',
    'rollover-west|30 15:00|2026-11-01|3|1',
    'rollover-east|01 08:00|2026-12-01|0|2',
    'rollover-west|01 08:00|2026-12-01|0|1',
  ].join('\n'));
}
