'use client';

import React, { useState, useEffect } from 'react';
import { FoxMascot } from './FoxMascot';
import { Member } from '@/lib/db';
import { formatGmtOffset } from '@/lib/timezone';
import {
  X,
  Bell,
  BellOff,
  CheckCircle2,
  AlertTriangle,
  Send,
  ShieldCheck,
  Moon,
  Clock,
  Sparkles,
  KeyRound,
} from 'lucide-react';
import {
  subscribeToPush,
  unsubscribeFromPush,
  getStoredMemberId,
  setStoredMemberId,
  isPushSupported,
  getNotificationPermission,
  getStoredAuthToken,
} from '@/lib/pushClient';

interface PushModalProps {
  isOpen: boolean;
  onClose: () => void;
  members: Member[];
  isPushEnabled: boolean;
  onPushStateChanged: (enabled: boolean) => void;
  onOpenScheduleModal: () => void;
  currentUser?: Member | null;
  onOpenLogin?: () => void;
}

export function PushModal({
  isOpen,
  onClose,
  members,
  isPushEnabled,
  onPushStateChanged,
  onOpenScheduleModal,
  currentUser,
  onOpenLogin,
}: PushModalProps) {
  const [selectedMemberId, setSelectedMemberId] = useState<string>('');
  const [notifyPersonal, setNotifyPersonal] = useState<boolean>(true);
  const [notifyCommunity, setNotifyCommunity] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(false);
  const [testLoading, setTestLoading] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );

  useEffect(() => {
    if (currentUser) {
      setSelectedMemberId(currentUser.id);
    } else {
      const storedId = getStoredMemberId();
      if (storedId) {
        setSelectedMemberId(storedId);
      } else {
        setSelectedMemberId('');
      }
    }
  }, [currentUser, members, isOpen]);

  if (!isOpen) return null;

  const currentMember = currentUser || members.find((m) => m.id === selectedMemberId);
  const supported = isPushSupported();
  const permission = getNotificationPermission();

  const handleEnablePush = async () => {
    if (!currentUser) {
      setFeedback({
        type: 'error',
        message: 'Please log in to your community profile so your Sleep Shield can be calculated.',
      });
      if (onOpenLogin) {
        onClose();
        onOpenLogin();
      }
      return;
    }

    const effectiveMemberId = currentUser?.id || selectedMemberId;

    setLoading(true);
    setFeedback(null);

    const result = await subscribeToPush({
      memberId: effectiveMemberId,
      notifyPersonal,
      notifyCommunity,
    });

    setLoading(false);

    if (result.success) {
      setStoredMemberId(effectiveMemberId);
      onPushStateChanged(true);
      setFeedback({
        type: 'success',
        message: `Bedtime alerts linked to ${currentMember?.discord_username || 'your profile'}!`,
      });
    } else {
      setFeedback({
        type: 'error',
        message: result.error || 'Failed to enable push notifications.',
      });
    }
  };

  const handleDisablePush = async () => {
    setLoading(true);
    setFeedback(null);

    const result = await unsubscribeFromPush();
    setLoading(false);

    if (result.success) {
      onPushStateChanged(false);
      setFeedback({
        type: 'success',
        message: 'Push alerts have been disabled on this device.',
      });
    } else {
      setFeedback({
        type: 'error',
        message: result.error || 'Failed to unsubscribe.',
      });
    }
  };

  const handleSendTestPush = async () => {
    const targetMemberId = currentUser?.id || selectedMemberId;
    if (!targetMemberId) return;

    setTestLoading(true);
    setFeedback(null);

    try {
      const authToken = getStoredAuthToken();
      const res = await fetch('/api/push/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
      });

      const data = await res.json();
      if (res.ok && data.delivered > 0) {
        setFeedback({
          type: 'success',
          message: 'Test notification sent! Check your device notifications.',
        });
      } else {
        setFeedback({
          type: 'error',
          message: data.error || 'No active device received the notification. Make sure alerts are on.',
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to send test push';
      setFeedback({ type: 'error', message: msg });
    } finally {
      setTestLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-md rounded-3xl border border-night-border bg-night-surface p-6 shadow-2xl">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-xl p-2 text-cream-muted hover:bg-night-elevated hover:text-cream-primary transition-colors"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3.5 mb-5">
          <FoxMascot state={isPushEnabled ? 'alert' : 'lantern'} size={38} />
          <div>
            <h2 className="text-lg font-bold text-cream-primary">Bedtime & Nag Alerts</h2>
            <p className="text-xs text-cream-secondary">
              Real-time Web Push notifications guarded by the Sleep Shield
            </p>
          </div>
        </div>

        {/* Feedback Alert */}
        {feedback && (
          <div
            className={`mb-4 flex items-start gap-2.5 rounded-xl border p-3 text-xs leading-relaxed ${
              feedback.type === 'success'
                ? 'border-status-sage/40 bg-status-sage/10 text-status-sage'
                : 'border-status-coral/40 bg-status-coral/10 text-status-coral'
            }`}
          >
            {feedback.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            )}
            <span>{feedback.message}</span>
          </div>
        )}

        {/* Browser Support Check */}
        {!supported && (
          <div className="mb-4 rounded-xl border border-status-coral/40 bg-status-coral/10 p-3 text-xs text-status-coral">
            ⚠️ Web Push is not supported in this browser. On iOS, install the app via <strong>Add to Home Screen</strong> first.
          </div>
        )}

        {permission === 'denied' && (
          <div className="mb-4 rounded-xl border border-status-coral/40 bg-status-coral/10 p-3 text-xs text-status-coral">
            🚫 Notification permission was blocked. Please reset site permissions in your browser address bar to receive alerts.
          </div>
        )}

        {/* Profile Linking Section */}
        <div className="space-y-4">
          {currentUser ? (
            /* Authenticated Account Card */
            <div className="rounded-2xl border border-status-amber/40 bg-night-bg p-3.5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <img
                  src={
                    currentUser.avatar_url ||
                    `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(
                      currentUser.discord_username
                    )}`
                  }
                  alt={currentUser.discord_username}
                  className="h-10 w-10 rounded-full border border-status-amber/50 bg-night-elevated"
                />
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-cream-primary">
                      @{currentUser.discord_username}
                    </span>
                    <span className="rounded bg-status-sage/20 border border-status-sage/40 px-1.5 py-0.2 text-[9px] font-semibold text-status-sage">
                      Logged In
                    </span>
                  </div>
                  <p className="text-[11px] text-cream-secondary">
                    Bedtime: {currentUser.bedtime_local} ({formatGmtOffset(currentUser.timezone)})
                  </p>
                </div>
              </div>

              {onOpenLogin && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenLogin();
                  }}
                  className="rounded-lg bg-night-elevated px-2.5 py-1 text-[11px] font-semibold text-status-amber hover:text-status-amber/80 transition-colors"
                >
                  Manage
                </button>
              )}
            </div>
          ) : (
            /* Unauthenticated Prompt */
            <div className="rounded-2xl border border-status-amber/40 bg-status-amber/10 p-3.5 space-y-2.5 text-center">
              <div className="flex items-center justify-center gap-2 text-status-amber">
                <KeyRound className="h-4 w-4" />
                <span className="text-xs font-bold">Profile Login Required</span>
              </div>
              <p className="text-[11px] text-cream-secondary leading-snug">
                Log in with your 4-digit PIN so that personal bedtime reminders and the 8-hour Sleep Shield are accurately linked to your account.
              </p>
              {onOpenLogin && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenLogin();
                  }}
                  className="w-full flex items-center justify-center gap-1.5 rounded-xl bg-status-amber py-2 text-xs font-bold text-night-bg hover:bg-status-amber/90 transition-all"
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  <span>Log In with 4-Digit PIN</span>
                </button>
              )}
            </div>
          )}

          {/* Preferences Checkboxes */}
          <div className="space-y-2.5 rounded-2xl border border-night-border bg-night-bg/60 p-3.5">
            <label className="flex items-center gap-2.5 cursor-pointer text-xs text-cream-primary">
              <input
                type="checkbox"
                checked={notifyPersonal}
                onChange={(e) => setNotifyPersonal(e.target.checked)}
                className="h-4 w-4 rounded border-night-border bg-night-surface text-status-amber accent-status-amber focus:ring-0"
              />
              <span className="flex items-center gap-1.5 font-medium">
                <Clock className="h-3.5 w-3.5 text-status-amber" />
                Personal Bedtime Reminders (T-30m and T-0m)
              </span>
            </label>

            <label className="flex items-center gap-2.5 cursor-pointer text-xs text-cream-primary">
              <input
                type="checkbox"
                checked={notifyCommunity}
                onChange={(e) => setNotifyCommunity(e.target.checked)}
                className="h-4 w-4 rounded border-night-border bg-night-surface text-status-amber accent-status-amber focus:ring-0"
              />
              <span className="flex items-center gap-1.5 font-medium">
                <Bell className="h-3.5 w-3.5 text-status-sage" />
                Community Nag Alerts (When awake friends hit bedtime)
              </span>
            </label>
          </div>

          {/* Sleep Shield Guarantee Banner */}
          <div className="flex items-center gap-2.5 rounded-xl border border-night-border bg-night-elevated/40 p-3 text-xs text-cream-secondary">
            <ShieldCheck className="h-4 w-4 shrink-0 text-status-slumber" />
            <span className="text-[11px] leading-tight">
              <strong>Sleep Shield Active:</strong> You will never receive notifications while inside your 8-hour sleep window.
            </span>
          </div>

          {/* Action Buttons */}
          <div className="pt-2 flex flex-col gap-2.5">
            {isPushEnabled ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSendTestPush}
                  disabled={testLoading}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-xl border border-status-amber/40 bg-status-amber/15 py-2.5 text-xs font-semibold text-status-amber hover:bg-status-amber/25 transition-colors disabled:opacity-50"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>{testLoading ? 'Sending Test...' : 'Send Test Alert'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleDisablePush}
                  disabled={loading}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-xl border border-night-border bg-night-surface py-2.5 text-xs font-semibold text-cream-muted hover:border-status-coral/40 hover:text-status-coral transition-colors disabled:opacity-50"
                >
                  <BellOff className="h-3.5 w-3.5" />
                  <span>Disable Alerts</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={currentUser ? handleEnablePush : () => (onOpenLogin ? onOpenLogin() : handleEnablePush())}
                disabled={loading || !supported}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-status-amber py-3 text-xs font-bold text-night-bg hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                <Bell className="h-4 w-4" />
                <span>
                  {loading
                    ? 'Activating Alerts...'
                    : currentUser
                    ? 'Turn On Bedtime Alerts'
                    : 'Log In to Turn On Alerts'}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenScheduleModal();
              }}
              className="text-center text-[11px] text-cream-muted hover:text-cream-secondary transition-colors"
            >
              Need to change your bedtime or claim your PIN? Open My Schedule ↗
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
