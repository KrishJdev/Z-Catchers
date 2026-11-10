'use client';

import React from 'react';
import { Home, Clock, Bell, Shield } from 'lucide-react';

export type MobileNavTab = 'roster' | 'schedule' | 'alerts' | 'mod';

interface BottomNavProps {
  activeTab: MobileNavTab;
  onChangeTab: (tab: MobileNavTab) => void;
  isPushEnabled?: boolean;
  isModerator?: boolean;
}

export function BottomNav({
  activeTab,
  onChangeTab,
  isPushEnabled = false,
  isModerator = false,
}: BottomNavProps) {
  const tabs = [
    {
      id: 'roster' as const,
      label: 'Roster',
      icon: Home,
    },
    {
      id: 'schedule' as const,
      label: 'My Time',
      icon: Clock,
    },
    {
      id: 'alerts' as const,
      label: 'Alerts',
      icon: Bell,
      indicator: isPushEnabled,
    },
    ...(isModerator
      ? [
          {
            id: 'mod' as const,
            label: 'Mod',
            icon: Shield,
          },
        ]
      : []),
  ];

  const gridColsClass = isModerator ? 'grid-cols-4' : 'grid-cols-3';

  return (
    <nav
      className={`fixed inset-x-0 bottom-0 z-40 mx-auto grid ${gridColsClass} h-16 w-full items-center bg-[#1C1714]/95 backdrop-blur-md border-t border-[#332B24] px-2 pb-[env(safe-area-inset-bottom)] md:hidden`}
      aria-label="Mobile Navigation Bar"
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;

        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
                try {
                  navigator.vibrate(10);
                } catch {
                  // Ignore vibration errors
                }
              }
              onChangeTab(tab.id);
            }}
            className={`flex flex-col items-center justify-center gap-1 min-h-[44px] min-w-[44px] py-1 transition-colors ${
              isActive
                ? 'text-[#F4A261] font-semibold'
                : 'text-[#73675C] hover:text-[#B0A295]'
            }`}
          >
            <div className="relative">
              <Icon className="h-5 w-5" />
              {tab.id === 'alerts' && isPushEnabled && (
                <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-[#6B9E78] ring-2 ring-[#1C1714]" />
              )}
            </div>
            <span className="text-[10px] tracking-tight">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
