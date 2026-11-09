import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin, Member } from '@/lib/db';
import { checkCooldownPromotion } from '@/lib/sleepEngine';

const DISCORD_JOURNAL_REGEX = /^https:\/\/(ptb\.|canary\.)?discord\.com\/channels\/\d+\/\d+(\/\d+)?$/;

export async function GET() {
  try {
    const { data: members, error } = await supabase
      .from('members')
      .select('*')
      .eq('is_active', true)
      .order('discord_username', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Process self-healing cooldown promotions
    const processedMembers: Member[] = [];
    for (const member of (members as Member[]) || []) {
      const { promoted, activeMember } = checkCooldownPromotion(member);
      if (promoted) {
        // Update DB in background with supabaseAdmin
        await supabaseAdmin
          .from('members')
          .update({
            bedtime_local: activeMember.bedtime_local,
            wake_time_local: activeMember.wake_time_local,
            timezone: activeMember.timezone,
            pending_bedtime_local: null,
            pending_wake_time_local: null,
            pending_timezone: null,
            pending_effective_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', member.id);
      }
      processedMembers.push(activeMember);
    }

    return NextResponse.json({ members: processedMembers });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      discord_username,
      discord_handle,
      journal_url,
      bedtime_local,
      wake_time_local = '07:00',
      timezone,
    } = body;

    if (!discord_username || !journal_url || !bedtime_local || !timezone) {
      return NextResponse.json(
        { error: 'Missing required fields (username, journal_url, bedtime, timezone)' },
        { status: 400 }
      );
    }

    if (!DISCORD_JOURNAL_REGEX.test(journal_url)) {
      return NextResponse.json(
        { error: 'Invalid Discord journal thread URL. Must match https://discord.com/channels/...' },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from('members')
      .insert({
        discord_username,
        discord_handle: discord_handle || null,
        journal_url,
        bedtime_local,
        wake_time_local,
        timezone,
        role: 'member',
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ member: data }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
