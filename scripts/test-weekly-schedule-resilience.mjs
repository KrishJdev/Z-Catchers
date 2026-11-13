import assert from 'assert';
import { DateTime, Settings } from 'luxon';

// Ensure mock Supabase configuration is present prior to importing db.ts
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder')) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://mock-test-db.supabase.co';
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key-test-schedule-resilience';
}

const {
  updateMemberSafe,
  insertMemberSafe,
  getMemberByIdSafe,
  hydrateMemberWeekendHours,
  setInMemoryWeekendHours,
  getInMemoryWeekendHours,
  clearInMemoryWeekendHours,
  setInMemoryMember,
  clearInMemoryMembers,
  clearKnownMemberColumns,
  getExistingMemberColumns,
  supabaseAdmin,
  isSupabaseConfigured,
} = await import('../src/lib/db.ts');

const {
  checkCooldownPromotion,
} = await import('../src/lib/sleepEngine.ts');

console.log('🧪 Starting Weekly Schedule Schema Resilience Verification...\n');

let failed = false;
function testAssert(condition, message) {
  if (condition) {
    console.log(`✅ PASSED: ${message}`);
  } else {
    console.error(`❌ FAILED: ${message}`);
    failed = true;
  }
}

async function run() {
  try {
    clearInMemoryMembers();
    clearInMemoryWeekendHours();
    clearKnownMemberColumns();

    testAssert(isSupabaseConfigured === true, 'Supabase is configured for testing environment');

    // --------------------------------------------------------------------------
    // 1. Missing weekly_schedule column in database does NOT reject updates
    // --------------------------------------------------------------------------
    console.log('\n--- 1. Missing Column Schema Resilience in updateMemberSafe ---');

    const testMemberId = 'mem_resilience_test_01';
    const initialMember = {
      id: testMemberId,
      discord_username: 'ScheduleTester',
      discord_handle: 'scheduletester',
      avatar_url: null,
      journal_url: 'https://discord.com/channels/123/456',
      bedtime_local: '23:00',
      wake_time_local: '07:00',
      timezone: 'Asia/Kolkata',
      role: 'member',
      passcode_hash: null,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    setInMemoryMember(initialMember);

    // Mock supabaseAdmin.from to simulate a database missing weekly_schedule & pending_weekly_schedule
    const originalFrom = supabaseAdmin.from;
    const legacyColumns = [
      'id',
      'discord_username',
      'discord_handle',
      'avatar_url',
      'journal_url',
      'bedtime_local',
      'wake_time_local',
      'timezone',
      'pending_bedtime_local',
      'pending_wake_time_local',
      'pending_timezone',
      'pending_effective_at',
      'role',
      'passcode_hash',
      'is_active',
      'created_at',
      'updated_at',
    ];

    let postgrestUpdatedFields = null;

    supabaseAdmin.from = (table) => {
      if (table === 'members') {
        return {
          select: () => ({
            limit: async () => {
              // Return row with only legacy columns (no weekly_schedule)
              const row = {};
              for (const col of legacyColumns) {
                row[col] = initialMember[col] ?? null;
              }
              return { data: [row], error: null };
            },
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  ...initialMember,
                  ...(postgrestUpdatedFields || {}),
                },
                error: null,
              }),
            }),
          }),
          update: (fields) => {
            postgrestUpdatedFields = fields;
            return {
              eq: (col, val) => ({
                is: () => ({
                  select: () => ({
                    maybeSingle: async () => ({
                      data: {
                        ...initialMember,
                        id: val,
                        ...fields,
                      },
                      error: null,
                    }),
                  }),
                }),
                select: () => ({
                  maybeSingle: async () => ({
                    data: {
                      ...initialMember,
                      id: val,
                      ...fields,
                    },
                    error: null,
                  }),
                }),
              }),
            };
          },
          insert: (fields) => ({
            select: () => ({
              single: async () => ({
                data: {
                  ...fields,
                  id: fields.id || 'mem_inserted_01',
                },
                error: null,
              }),
            }),
          }),
        };
      }
      return originalFrom.call(supabaseAdmin, table);
    };

    // Force detection of legacy columns
    clearKnownMemberColumns();
    const detectedCols = await getExistingMemberColumns(true);
    testAssert(!detectedCols.has('weekly_schedule'), 'Detected columns do NOT contain weekly_schedule');
    testAssert(!detectedCols.has('pending_weekly_schedule'), 'Detected columns do NOT contain pending_weekly_schedule');

    const sampleWeeklySchedule = {
      mon: { bedtime: '22:30', wake_time: '06:30' },
      tue: { bedtime: '22:30', wake_time: '06:30' },
      wed: { bedtime: '22:30', wake_time: '06:30' },
      thu: { bedtime: '22:30', wake_time: '06:30' },
      fri: { bedtime: '00:00', wake_time: '08:30' },
      sat: { bedtime: '01:00', wake_time: '09:00' },
      sun: { bedtime: '22:30', wake_time: '06:30' },
    };

    // Attempt updating member with pending_weekly_schedule & weekly_schedule
    const { data: updatedMember, error: updateErr } = await updateMemberSafe(testMemberId, {
      pending_bedtime_local: '22:30',
      pending_wake_time_local: '06:30',
      pending_timezone: 'Asia/Kolkata',
      pending_weekly_schedule: sampleWeeklySchedule,
      pending_effective_at: DateTime.utc().plus({ hours: 48 }).toISO(),
    });

    testAssert(updateErr === null, 'updateMemberSafe succeeds without error when columns are absent');
    testAssert(updatedMember !== null, 'updateMemberSafe returns non-null member');
    testAssert(
      updatedMember?.pending_weekly_schedule?.fri?.bedtime === '00:00',
      'Hydrated member preserves pending_weekly_schedule fri bedtime in memory'
    );
    testAssert(
      updatedMember?.pending_weekly_schedule?.sat?.bedtime === '01:00',
      'Hydrated member preserves pending_weekly_schedule sat bedtime in memory'
    );
    testAssert(
      postgrestUpdatedFields && !('pending_weekly_schedule' in postgrestUpdatedFields),
      'PostgREST payload was cleanly sanitized to avoid schema mismatch errors'
    );

    // --------------------------------------------------------------------------
    // 2. getMemberByIdSafe hydrates in-memory weekly_schedule
    // --------------------------------------------------------------------------
    console.log('\n--- 2. getMemberByIdSafe Hydration Verification ---');

    const { data: fetchedMember, error: fetchErr } = await getMemberByIdSafe(testMemberId);
    testAssert(fetchErr === null, 'getMemberByIdSafe succeeds without error');
    testAssert(
      fetchedMember?.pending_weekly_schedule?.sat?.bedtime === '01:00',
      'getMemberByIdSafe properly hydrates pending_weekly_schedule from in-memory fallback'
    );

    // --------------------------------------------------------------------------
    // 3. insertMemberSafe resilience when weekly_schedule is absent
    // --------------------------------------------------------------------------
    console.log('\n--- 3. insertMemberSafe Resilience Verification ---');

    const newMemberPayload = {
      id: 'mem_resilience_new_user',
      discord_username: 'NewJoiner',
      bedtime_local: '23:30',
      wake_time_local: '07:30',
      timezone: 'America/New_York',
      weekly_schedule: sampleWeeklySchedule,
    };

    const { data: insertedMember, error: insertErr } = await insertMemberSafe(newMemberPayload);
    testAssert(insertErr === null, 'insertMemberSafe succeeds without error when columns are absent');
    testAssert(insertedMember !== null, 'insertMemberSafe returns non-null member');
    testAssert(
      insertedMember?.weekly_schedule?.sat?.wake_time === '09:00',
      'insertMemberSafe hydrates weekly_schedule on inserted member'
    );

    // --------------------------------------------------------------------------
    // 4. Cooldown Promotion with in-memory weekly schedule
    // --------------------------------------------------------------------------
    console.log('\n--- 4. Cooldown Promotion Resilience ---');

    const expiredPendingTime = DateTime.utc().minus({ hours: 1 }).toISO();
    const memberPendingPromotion = {
      ...initialMember,
      id: 'mem_resilience_promo_01',
      pending_bedtime_local: '22:30',
      pending_wake_time_local: '06:30',
      pending_effective_at: expiredPendingTime,
    };

    setInMemoryWeekendHours('mem_resilience_promo_01', {
      pending_weekly_schedule: sampleWeeklySchedule,
    });

    const hydratedPromoMember = hydrateMemberWeekendHours(memberPendingPromotion);
    testAssert(
      hydratedPromoMember.pending_weekly_schedule !== null,
      'Member is properly hydrated with pending_weekly_schedule before promotion'
    );

    const { promoted, activeMember } = checkCooldownPromotion(hydratedPromoMember, DateTime.utc());
    testAssert(promoted === true, 'Cooldown is marked as promoted when effective_at is in past');
    testAssert(
      activeMember.weekly_schedule?.sat?.bedtime === '01:00',
      'activeMember promoted weekly_schedule inherits from pending_weekly_schedule'
    );
    testAssert(
      activeMember.pending_weekly_schedule === null,
      'activeMember pending_weekly_schedule is cleared after promotion'
    );

    // Test promotion persistence through updateMemberSafe
    const { data: persistedPromo, error: promoErr } = await updateMemberSafe('mem_resilience_promo_01', {
      bedtime_local: activeMember.bedtime_local,
      wake_time_local: activeMember.wake_time_local,
      weekly_schedule: activeMember.weekly_schedule,
      pending_weekly_schedule: null,
      pending_effective_at: null,
    });

    testAssert(promoErr === null, 'updateMemberSafe persists promoted schedule without error');
    testAssert(
      persistedPromo?.weekly_schedule?.sat?.bedtime === '01:00',
      'Promoted weekly_schedule is active and retained in memory'
    );
    testAssert(
      persistedPromo?.pending_weekly_schedule === null,
      'Pending weekly schedule remains null after promotion'
    );

    // --------------------------------------------------------------------------
    // 5. Schema Cache Dynamic Refresh & Auto-Recovery
    // --------------------------------------------------------------------------
    console.log('\n--- 5. Dynamic Column Detection & Auto-Recovery ---');

    // Simulate user running migration in Supabase SQL editor
    legacyColumns.push('weekly_schedule');
    legacyColumns.push('pending_weekly_schedule');

    clearKnownMemberColumns();
    const refreshedCols = await getExistingMemberColumns(true);
    testAssert(refreshedCols.has('weekly_schedule'), 'clearKnownMemberColumns picks up freshly added weekly_schedule column');
    testAssert(refreshedCols.has('pending_weekly_schedule'), 'clearKnownMemberColumns picks up freshly added pending_weekly_schedule column');

    // Now updates with weekly_schedule will be retained in PostgREST payload
    postgrestUpdatedFields = null;
    await updateMemberSafe(testMemberId, {
      weekly_schedule: sampleWeeklySchedule,
    });

    testAssert(
      postgrestUpdatedFields && 'weekly_schedule' in postgrestUpdatedFields,
      'PostgREST payload includes weekly_schedule now that column is detected in DB'
    );

    // --------------------------------------------------------------------------
    // 6. Pending Weekend Hydration Fallbacks (Preserve null and undefined)
    // --------------------------------------------------------------------------
    console.log('\n--- 6. Pending Weekend Hydration Fallbacks ---');

    clearInMemoryWeekendHours();
    const targetMember = {
      id: 'mem_hydration_test_01',
      discord_username: 'HydrationTester',
      discord_handle: 'hydrationtester',
      avatar_url: null,
      journal_url: 'https://discord.com/channels/123/456',
      bedtime_local: '23:00',
      wake_time_local: '07:00',
      timezone: 'UTC',
      role: 'member',
      passcode_hash: null,
      is_active: true,
      pending_bedtime_local: null,
      pending_wake_time_local: null,
      pending_timezone: null,
      pending_effective_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Case A: Absent from both sources -> preserves undefined
    setInMemoryWeekendHours('mem_hydration_test_01', {});
    const hydratedAbsent = hydrateMemberWeekendHours({ ...targetMember });
    testAssert(
      hydratedAbsent.pending_weekend_bedtime_local === undefined,
      'Absent from both sources preserves undefined for pending_weekend_bedtime_local'
    );
    testAssert(
      hydratedAbsent.pending_weekend_wake_time_local === undefined,
      'Absent from both sources preserves undefined for pending_weekend_wake_time_local'
    );

    // Case B: Explicit null on member -> preserves explicit null over fallback
    setInMemoryWeekendHours('mem_hydration_test_01', {
      pending_weekend_bedtime_local: '00:00',
      pending_weekend_wake_time_local: '08:00',
    });
    const hydratedExplicitNull = hydrateMemberWeekendHours({
      ...targetMember,
      pending_weekend_bedtime_local: null,
      pending_weekend_wake_time_local: null,
    });
    testAssert(
      hydratedExplicitNull.pending_weekend_bedtime_local === null,
      'Explicit null on member is preserved over fallback value'
    );
    testAssert(
      hydratedExplicitNull.pending_weekend_wake_time_local === null,
      'Explicit null on member is preserved over fallback value for wake time'
    );

    // Case C: Member undefined, fallback has value -> fallback used
    const hydratedFallback = hydrateMemberWeekendHours({ ...targetMember });
    testAssert(
      hydratedFallback.pending_weekend_bedtime_local === '00:00',
      'Fallback value is used when member has undefined'
    );

    // --------------------------------------------------------------------------
    // 7. Failed or Unmatched DB Updates Do NOT Mutate in-memory cache
    // --------------------------------------------------------------------------
    console.log('\n--- 7. Isolated Cache State on Failed / Zero-Row Updates ---');

    clearInMemoryWeekendHours();
    const nonExistentId = 'mem_ghost_non_existent';

    // Mock an update that returns null data (e.g. matching no rows)
    const prevUpdateMock = supabaseAdmin.from;
    supabaseAdmin.from = () => ({
      update: () => ({
        eq: () => ({
          select: () => ({
            maybeSingle: async () => ({
              data: null,
              error: null,
            }),
          }),
        }),
      }),
    });

    const failedResult = await updateMemberSafe(nonExistentId, {
      weekly_schedule: sampleWeeklySchedule,
    });

    testAssert(failedResult.data === null, 'Update for non-existent row returns data: null');
    const ghostFallback = getInMemoryWeekendHours(nonExistentId);
    testAssert(
      !ghostFallback || Object.keys(ghostFallback).length === 0,
      'Failed or 0-row DB update does NOT populate in-memory schedule cache'
    );

    supabaseAdmin.from = prevUpdateMock;

    // Restore original supabaseAdmin.from
    supabaseAdmin.from = originalFrom;

  } catch (err) {
    console.error('Unexpected exception during resilience verification:', err);
    failed = true;
  }

  if (failed) {
    console.error('\n❌ Weekly Schedule Schema Resilience Verification FAILED');
    process.exit(1);
  } else {
    console.log('\n🎉 Weekly Schedule Schema Resilience Verification PASSED! 🦊💤');
    process.exit(0);
  }
}

run();
