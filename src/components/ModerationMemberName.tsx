import React from 'react';

export function formatDiscordHandle(handle?: string | null) {
  const username = handle?.trim().replace(/^@+/, '').trim();
  return username ? `@${username}` : null;
}

export function ModerationMemberName({ name, handle }: { name: string; handle?: string | null }) {
  const username = formatDiscordHandle(handle);
  return (
    <span className="[overflow-wrap:anywhere]">
      {name}
      {username && <> <span className="text-sm font-normal text-cream-secondary">{username}</span></>}
    </span>
  );
}
