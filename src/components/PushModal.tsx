'use client';

import React, { useState, useEffect } from 'react';
import { FoxMascot } from './FoxMascot';
import { Member } from '@/lib/db';
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
  Copy,
  Check,
} from 'lucide-react';
import {
  subscribeToPush,
  unsubscribeFromPush,
  getStoredMemberId,
  isPushSupported,
  getNotificationPermission,
  isBraveBrowser,
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
  onLogout?: () => void;
}

/**
 * Push notifications preference configuration modal.
 * Configures personal bedtime reminders, community alerts, and Sleep Shield protections.
 *
 * @param props - Push modal properties including member profile and notification state
 * @returns React JSX modal dialog element
 */
export function PushModal({
  isOpen,
  onClose,
  members,
  isPushEnabled,
  onPushStateChanged,
  onOpenScheduleModal,
  currentUser,
  onOpenLogin,
  onLogout,
}: PushModalProps) {
  const [selectedMemberId, setSelectedMemberId] = useState<string>('');
  const [notifyPersonal, setNotifyPersonal] = useState<boolean>(true);
  const [notifyCommunity, setNotifyCommunity] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(false);
  const [testLoading, setTestLoading] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );
  const [isBrave, setIsBrave] = useState<boolean>(false);
  const [copiedBraveUrl, setCopiedBraveUrl] = useState<boolean>(false);

  useEffect(() => {
    isBraveBrowser().then(setIsBrave);
  }, []);

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

    setLoading(true);
    setFeedback(null);

    const result = await subscribeToPush({
      memberId: currentUser.id,
      notifyPersonal,
      notifyCommunity,
    });

    setLoading(false);

    if (result.success) {
      onPushStateChanged(true);
      setFeedback({
        type: 'success',
        message: 'Push notifications enabled! Your Sleep Shield and alarms are now active.',
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
        message: 'Push notifications disabled on this device.',
      });
    } else {
      setFeedback({
        type: 'error',
        message: result.error || 'Failed to disable notifications.',
      });
    }
  };

  const handleSendTestPush = async () => {
    setTestLoading(true);
    setFeedback(null);

    try {
      const res = await fetch('/api/push/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await res.json();

      if (res.ok && data.success) {
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-night-bg/85 backdrop-blur-md p-0 md:items-center md:p-4 animate-fade-in">
      <div className="relative flex w-full max-w-md flex-col rounded-t-3xl border-t border-night-border bg-night-surface p-5 shadow-2xl max-h-[90dvh] overflow-y-auto md:rounded-2xl md:border md:p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] md:pb-6">
        {/* Mobile handle indicator */}
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-night-border md:hidden shrink-0" />

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-xl p-2 text-cream-muted hover:bg-night-elevated hover:text-cream-primary transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
          aria-label="Close alerts panel"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3.5 mb-5 pr-8">
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
            className={`mb-4 flex flex-col gap-2 rounded-xl border p-3.5 text-xs leading-relaxed ${
              feedback.type === 'success'
                ? 'border-status-sage/40 bg-status-sage/10 text-status-sage'
                : 'border-status-coral/40 bg-status-coral/10 text-status-coral'
            }`}
          >
            <div className="flex items-start gap-2.5">
              {feedback.type === 'success' ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              )}
              <span className="font-medium">{feedback.message}</span>
            </div>
            {feedback.type === 'error' && (feedback.message.includes('brave://') || isBrave) && (
              <div className="mt-1 rounded-lg border border-night-border bg-night-bg/90 p-2.5 text-cream-secondary">
                <p className="font-semibold text-cream-primary mb-1">To fix this in Brave:</p>
                <ol className="list-decimal list-inside space-y-1.5 text-[11px]">
                  <li>
                    <span>Open a new tab and paste: </span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText('brave://settings/privacy');
                        setCopiedBraveUrl(true);
                        setTimeout(() => setCopiedBraveUrl(false), 2500);
                      }}
                      className="inline-flex items-center gap-1 font-mono text-status-amber bg-night-elevated px-1.5 py-0.5 rounded hover:bg-night-border transition-colors"
                      title="Click to copy brave://settings/privacy"
                    >
                      <span>brave://settings/privacy</span>
                      {copiedBraveUrl ? <Check className="h-3 w-3 text-status-sage" /> : <Copy className="h-3 w-3" />}
                    </button>
                  </li>
                  <li>Enable &ldquo;Use Google services for push messaging&rdquo;</li>
                  <li>Relaunch Brave and try again</li>
                </ol>
              </div>
            )}
          </div>
        )}

        {/* Browser Support Warning */}
        {!supported && (
          <div className="mb-4 rounded-xl border border-status-coral/40 bg-status-coral/10 p-3.5 text-xs text-status-coral flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Web Push Not Supported</p>
              <p className="text-[11px] opacity-85 mt-0.5">
                Your current browser does not support Service Worker Push Notifications. If on iOS, tap Share &rarr; Add to Home Screen first.
              </p>
            </div>
          </div>
        )}

        {/* Logged in member badge */}
        {currentUser ? (
          <div className="mb-4 flex items-center justify-between rounded-xl border border-night-border bg-night-elevated p-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-2 w-2 rounded-full bg-status-sage" />
              <div>
                <p className="text-xs font-semibold text-cream-primary">
                  @{currentUser.discord_username}
                </p>
                <p className="text-[11px] text-cream-secondary">
                  Bedtime: {currentUser.bedtime_local} • {currentUser.timezone}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  onClose();
                  onOpenScheduleModal();
                }}
                className="text-[11px] font-medium text-status-amber hover:underline min-h-[44px] flex items-center"
              >
                Edit Schedule
              </button>
              {onLogout && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onLogout();
                  }}
                  className="text-[11px] font-medium text-cream-muted hover:text-status-coral transition-colors min-h-[44px] flex items-center ml-1"
                >
                  Log Out
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="mb-4 rounded-xl border border-status-amber/40 bg-status-amber/10 p-3.5 text-xs text-cream-secondary">
            <div className="flex items-start gap-2">
              <KeyRound className="h-4 w-4 text-status-amber shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-status-amber">Log In Required for Sleep Shield</p>
                <p className="text-[11px] text-cream-secondary mt-0.5">
                  Link alerts to your community profile to silence bedtime alarms while you are sleeping.
                </p>
                {onOpenLogin && (
                  <button
                    onClick={() => {
                      onClose();
                      onOpenLogin();
                    }}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-status-amber px-3 py-1.5 text-xs font-bold text-night-bg hover:bg-status-amber/90 transition-all min-h-[44px]"
                  >
                    <span>Log In to Profile</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Notification Preferences */}
        <div className="mb-5 space-y-3">
          <label className="text-xs font-bold text-cream-primary uppercase tracking-wider block">
            Notification Preferences
          </label>

          <label className="flex items-start gap-3 rounded-xl border border-night-border bg-night-bg/60 p-3 cursor-pointer hover:bg-night-bg transition-colors min-h-[44px]">
            <input
              type="checkbox"
              checked={notifyPersonal}
              onChange={(e) => setNotifyPersonal(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-night-border bg-night-elevated text-status-amber focus:ring-0"
            />
            <div>
              <p className="text-xs font-semibold text-cream-primary flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-status-amber" />
                <span>Personal Wind-Down & Bedtime Alarms</span>
              </p>
              <p className="text-[11px] text-cream-secondary mt-0.5">
                Alerts 30m before your bedtime and the moment your bedtime hits.
              </p>
            </div>
          </label>

          <label className="flex items-start gap-3 rounded-xl border border-night-border bg-night-bg/60 p-3 cursor-pointer hover:bg-night-bg transition-colors min-h-[44px]">
            <input
              type="checkbox"
              checked={notifyCommunity}
              onChange={(e) => setNotifyCommunity(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-night-border bg-night-elevated text-status-amber focus:ring-0"
            />
            <div>
              <p className="text-xs font-semibold text-cream-primary flex items-center gap-1.5">
                <Bell className="h-3.5 w-3.5 text-status-amber" />
                <span>Community Nag Alerts</span>
              </p>
              <p className="text-[11px] text-cream-secondary mt-0.5">
                Get notified when friends are past bedtime so you can nag them in Discord.
              </p>
            </div>
          </label>
        </div>

        {/* Sleep Shield Guarantee Notice */}
        <div className="mb-5 rounded-2xl border border-night-border bg-night-bg p-3.5 text-xs text-cream-secondary">
          <div className="flex items-start gap-2.5">
            <Moon className="h-4 w-4 text-status-slumber shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-cream-primary">Sleep Shield Guarantee</p>
              <p className="text-[11px] leading-relaxed mt-0.5">
                We strictly silence outgoing community nag alerts during your personal 8-hour sleep window or whenever you tap &ldquo;I&apos;m in Bed&rdquo;.
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col gap-2.5 mt-auto">
          {isPushEnabled ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleSendTestPush}
                disabled={testLoading}
                className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-night-border bg-night-elevated px-3 text-xs font-semibold text-cream-primary hover:bg-night-border transition-colors disabled:opacity-50 h-11 min-h-[44px] whitespace-nowrap"
              >
                <Send className="h-3.5 w-3.5 text-status-amber" />
                <span>{testLoading ? 'Sending...' : 'Send Test Alert'}</span>
              </button>

              <button
                type="button"
                onClick={handleDisablePush}
                disabled={loading}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-status-coral/40 bg-status-coral/10 px-4 text-xs font-semibold text-status-coral hover:bg-status-coral/20 transition-colors disabled:opacity-50 h-11 min-h-[44px] whitespace-nowrap"
              >
                <BellOff className="h-3.5 w-3.5" />
                <span>Turn Off</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleEnablePush}
              disabled={loading || !supported}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-status-amber px-4 text-xs font-bold text-night-bg shadow-lg hover:bg-status-amber/90 transition-all disabled:opacity-50 active:scale-95 h-11 min-h-[44px] whitespace-nowrap"
            >
              <Bell className="h-4 w-4" />
              <span>{loading ? 'Registering Push...' : 'Turn On Bedtime & Nag Alerts'}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
