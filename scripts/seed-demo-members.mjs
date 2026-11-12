import { createClient } from '@supabase/supabase-js';
import { DateTime } from 'luxon';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Supabase credentials missing in environment.');
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

const DEMO_MEMBERS = [
  {
    discord_username: 'Aoi',
    discord_handle: 'aoi_jp',
    avatar_url: 'https://api.dicebear.com/7.x/bottts/svg?seed=Aoi',
    journal_url: 'https://discord.com/channels/123456789/987654321',
    bedtime_local: '23:30',
    wake_time_local: '07:30',
    timezone: 'GMT+09:00',
    weekend_bedtime_local: '00:30',
    weekend_wake_time_local: '09:00',
    role: 'member',
    weekly_schedule: {
      mon: { bedtime: '23:30', wake_time: '07:30' },
      tue: { bedtime: '23:30', wake_time: '07:30' },
      wed: { bedtime: '23:30', wake_time: '07:30' },
      thu: { bedtime: '23:30', wake_time: '07:30' },
      fri: { bedtime: '00:30', wake_time: '09:00' },
      sat: { bedtime: '00:30', wake_time: '09:00' },
      sun: { bedtime: '23:30', wake_time: '07:30' },
    },
  },
  {
    discord_username: 'SarahK',
    discord_handle: 'sarah_ny',
    avatar_url: 'https://api.dicebear.com/7.x/bottts/svg?seed=SarahK',
    journal_url: 'https://discord.com/channels/123456789/987654322',
    bedtime_local: '22:45',
    wake_time_local: '06:45',
    timezone: 'GMT-05:00',
    weekend_bedtime_local: '23:45',
    weekend_wake_time_local: '08:30',
    role: 'member',
    // SarahK has varied mid-week schedule shifts: Tuesday & Thursday late evening routine
    weekly_schedule: {
      mon: { bedtime: '22:45', wake_time: '06:45' },
      tue: { bedtime: '23:15', wake_time: '07:15' },
      wed: { bedtime: '22:45', wake_time: '06:45' },
      thu: { bedtime: '23:30', wake_time: '07:30' },
      fri: { bedtime: '23:45', wake_time: '08:30' },
      sat: { bedtime: '23:45', wake_time: '08:30' },
      sun: { bedtime: '22:45', wake_time: '06:45' },
    },
  },
  {
    discord_username: 'Marcus',
    discord_handle: 'marcus_ldn',
    avatar_url: 'https://api.dicebear.com/7.x/bottts/svg?seed=Marcus',
    journal_url: 'https://discord.com/channels/123456789/987654323',
    bedtime_local: '23:00',
    wake_time_local: '07:00',
    timezone: 'GMT+00:00',
    weekend_bedtime_local: null,
    weekend_wake_time_local: null,
    role: 'moderator',
    weekly_schedule: {
      mon: { bedtime: '23:00', wake_time: '07:00' },
      tue: { bedtime: '23:00', wake_time: '07:00' },
      wed: { bedtime: '23:00', wake_time: '07:00' },
      thu: { bedtime: '23:00', wake_time: '07:00' },
      fri: { bedtime: '23:00', wake_time: '07:00' },
      sat: { bedtime: '23:00', wake_time: '07:00' },
      sun: { bedtime: '23:00', wake_time: '07:00' },
    },
  },
  {
    discord_username: 'Arjun',
    discord_handle: 'arjun_in',
    avatar_url: 'https://api.dicebear.com/7.x/bottts/svg?seed=Arjun',
    journal_url: 'https://discord.com/channels/123456789/987654324',
    bedtime_local: '00:15',
    wake_time_local: '08:00',
    timezone: 'GMT+05:30',
    weekend_bedtime_local: '01:30',
    weekend_wake_time_local: '09:30',
    role: 'member',
    weekly_schedule: {
      mon: { bedtime: '00:15', wake_time: '08:00' },
      tue: { bedtime: '00:15', wake_time: '08:00' },
      wed: { bedtime: '00:15', wake_time: '08:00' },
      thu: { bedtime: '00:15', wake_time: '08:00' },
      fri: { bedtime: '01:30', wake_time: '09:30' },
      sat: { bedtime: '01:30', wake_time: '09:30' },
      sun: { bedtime: '00:15', wake_time: '08:00' },
    },
  },
];

async function run() {
  console.log('🌱 Seeding demo profiles (Aoi, SarahK, Marcus, Arjun)...');
  const weekdayMap = { 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri', 6: 'sat', 7: 'sun' };

  for (const m of DEMO_MEMBERS) {
    const { data: existing } = await supabaseAdmin
      .from('members')
      .select('id')
      .eq('discord_username', m.discord_username)
      .maybeSingle();

    let memberId = existing ? existing.id : null;
    if (!existing) {
      const { data: inserted } = await supabaseAdmin
        .from('members')
        .insert(m)
        .select('id')
        .single();
      memberId = inserted ? inserted.id : null;
      console.log(`   + Added demo member: ${m.discord_username}`);
    } else {
      console.log(`   = Demo member ${m.discord_username} already exists`);
    }

    if (memberId) {
      // Seed 30 days of realistic sleep logs
      const daysCount = 30;
      const tz = m.timezone || 'UTC';
      const now = DateTime.utc().setZone(tz);

      for (let i = daysCount; i >= 1; i--) {
        const cycleDt = now.minus({ days: i }).startOf('day');
        const cycleDate = cycleDt.toISODate();
        const dayKey = weekdayMap[cycleDt.weekday] || 'mon';
        const daySchedule = m.weekly_schedule?.[dayKey] || {
          bedtime: m.bedtime_local,
          wake_time: m.wake_time_local,
        };

        const targetBedtime = daySchedule.bedtime;
        const targetWakeTime = daySchedule.wake_time;
        const [tBedH, tBedM] = targetBedtime.split(':').map(Number);
        const [tWakeH, tWakeM] = targetWakeTime.split(':').map(Number);

        let status = 'on_time';
        let bedMinuteShift = -5 + ((i * 3) % 11);
        let wakeMinuteShift = -3 + ((i * 2) % 9);

        if (i % 14 === 4) {
          status = 'late';
          bedMinuteShift = 25;
        } else if (i === 12) {
          status = 'metastrike';
        } else if (i === 19) {
          status = 'missed';
        }

        if (status === 'missed') {
          await supabaseAdmin.from('sleep_logs').upsert(
            {
              member_id: memberId,
              cycle_date: cycleDate,
              timezone: tz,
              target_bedtime: targetBedtime,
              target_wake_time: targetWakeTime,
              in_bed_at: null,
              in_bed_local_time: null,
              woke_up_at: null,
              woke_up_local_time: null,
              wake_source: null,
              duration_minutes: null,
              status: 'missed',
              updated_at: cycleDt.toUTC().toISO(),
            },
            { onConflict: 'member_id,cycle_date' }
          );
          continue;
        }

        const bedIsPastMidnight = tBedH >= 0 && tBedH < 6;
        const bedBaseDt = bedIsPastMidnight ? cycleDt.plus({ days: 1 }) : cycleDt;
        const inBedDt = bedBaseDt
          .set({ hour: tBedH, minute: tBedM, second: 0, millisecond: 0 })
          .plus({ minutes: bedMinuteShift });

        const wokeUpDt = cycleDt
          .plus({ days: 1 })
          .set({ hour: tWakeH, minute: tWakeM, second: 0, millisecond: 0 })
          .plus({ minutes: wakeMinuteShift });

        const durationMinutes = Math.max(1, Math.round(wokeUpDt.diff(inBedDt, 'minutes').minutes));

        await supabaseAdmin.from('sleep_logs').upsert(
          {
            member_id: memberId,
            cycle_date: cycleDate,
            timezone: tz,
            target_bedtime: targetBedtime,
            target_wake_time: targetWakeTime,
            in_bed_at: inBedDt.toUTC().toISO(),
            in_bed_local_time: inBedDt.toFormat('HH:mm'),
            woke_up_at: wokeUpDt.toUTC().toISO(),
            woke_up_local_time: wokeUpDt.toFormat('HH:mm'),
            wake_source: i % 3 === 0 ? 'manual' : 'button',
            duration_minutes: durationMinutes,
            status,
            updated_at: wokeUpDt.toUTC().toISO(),
          },
          { onConflict: 'member_id,cycle_date' }
        );
      }
      console.log(`   + Seeded 30 days of sleep logs for ${m.discord_username}`);
    }
  }
  console.log('✅ Demo seeding complete.');
}

run().catch(console.error);
