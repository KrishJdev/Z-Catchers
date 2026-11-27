'use client';

import React, { useEffect, useId, useRef } from 'react';
import type { Member } from '@/lib/db';
import { formatDiscordHandle } from './ModerationMemberName';

export type ModeratorRoleChange = {
  member_id: string;
  expected_role: 'member' | 'moderator';
  new_role: 'member' | 'moderator';
};

export function RosterRoleAction({ member, isOwner, confirming, busy, onToggle, onConfirm }: {
  member: Member;
  isOwner: boolean;
  confirming: boolean;
  busy: boolean;
  onToggle: () => void;
  onConfirm: (change: ModeratorRoleChange) => void;
}) {
  const confirmationId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirming) cancel.current?.focus();
  }, [confirming]);
  const role = member.role;
  if (!isOwner || role === 'owner') return null;
  if (role === 'member' && (!member.is_active || !/^[0-9]+$/.test(member.discord_id ?? ''))) return null;

  const granting = role === 'member';
  const label = granting ? 'Make moderator' : 'Remove moderator';
  const account = formatDiscordHandle(member.discord_handle) ?? member.discord_id;
  return (
    <div>
      <button
        ref={trigger}
        type="button"
        aria-label={`${label} for ${member.discord_username}`}
        aria-expanded={confirming}
        aria-controls={confirming ? confirmationId : undefined}
        disabled={busy}
        onClick={onToggle}
        className="min-h-[44px] rounded-lg border border-night-border px-3 text-sm font-semibold text-cream-primary hover:bg-night-border focus-visible:outline focus-visible:outline-status-amber disabled:opacity-50"
      >
        {label}
      </button>
      {confirming && (
        <div id={confirmationId} className="mt-2 rounded-lg border border-night-border bg-night-bg p-3 text-sm">
          <p className="break-words text-cream-primary">
            {granting ? 'Make' : 'Remove moderator access for'} <strong>{member.discord_username}</strong>
            {account && <span className="text-cream-secondary"> ({account})</span>}
            {granting ? ' a moderator?' : '?'}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => onConfirm({
                member_id: member.id,
                expected_role: role,
                new_role: granting ? 'moderator' : 'member',
              })}
              className="min-h-[44px] rounded-lg bg-status-amber px-3 font-bold text-night-bg hover:bg-status-amber/90 disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Confirm'}
            </button>
            <button
              ref={cancel}
              type="button"
              disabled={busy}
              onClick={() => { onToggle(); trigger.current?.focus(); }}
              className="min-h-[44px] rounded-lg px-3 font-semibold text-cream-secondary hover:bg-night-elevated disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
