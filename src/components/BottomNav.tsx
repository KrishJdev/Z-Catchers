'use client';

import React from 'react';
import { Home, Moon, Shield } from 'lucide-react';

export type MobileNavTab = 'roster' | 'sleep' | 'mod';

export function BottomNav({ activeTab, onChangeTab, isModerator = false }: {
  activeTab: MobileNavTab;
  onChangeTab: (tab: MobileNavTab) => void;
  isModerator?: boolean;
}) {
  const tabs = [
    { id: 'roster', label: 'Roster', icon: Home },
    { id: 'sleep', label: 'My Sleep', icon: Moon },
    ...(isModerator ? [{ id: 'mod', label: 'Mod', icon: Shield } as const] : []),
  ] as const;

  return (
    <nav
      className={`grid ${isModerator ? 'grid-cols-3' : 'grid-cols-2'} h-16 items-center gap-2 border-t border-night-border px-2 md:hidden`}
      aria-label="Mobile navigation"
    >
      {tabs.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          aria-current={activeTab === id ? 'page' : undefined}
          aria-haspopup={id === 'roster' ? undefined : 'dialog'}
          onClick={() => {
            navigator.vibrate?.(10);
            onChangeTab(id);
          }}
          className={`flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-0.5 rounded-lg text-xs focus-visible:ring-2 focus-visible:ring-status-amber ${activeTab === id ? 'bg-status-amber/10 font-semibold text-status-amber' : 'text-cream-secondary hover:text-cream-primary'}`}
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
          {label}
        </button>
      ))}
    </nav>
  );
}
