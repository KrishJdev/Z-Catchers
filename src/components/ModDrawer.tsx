'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { FoxMascot } from './FoxMascot';
import { Member } from '@/lib/db';
import { isDemoSeedMember } from '@/lib/demoSeed';
import { DateTime } from 'luxon';
import {
  X,
  Lock,
  Unlock,
  Shield,
  Clock,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  Sparkles,
  Zap,
  UserCheck,
  UserPlus,
  RefreshCw,
  Search,
  KeyRound,
  Trash2,
  Power,
  Edit2,
  ChevronRight,
  ShieldAlert,
  Radio,
  Send,
} from 'lucide-react';

const DISCORD_JOURNAL_REGEX = /^https:\/\/(ptb\.|canary\.)?discord\.com\/channels\/\d+\/\d+(\/\d+)?$/;
const DISCORD_WEBHOOK_REGEX = /^https:\/\/(ptb\.|canary\.)?discord\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/;
const TIME_FORMAT_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

import { COMMON_IANA_TIMEZONES, GMT_OFFSETS, formatGmtOffset, toValidLuxonZone } from '@/lib/timezone';

interface ModDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  viewerTimezone: string;
  onRosterChanged: () => Promise<void>;
}

/**
 * Moderator administration drawer.
 * Provides privileged schedule overrides, manual strike & metastrike adjustments,
 * strike log clearing, and Discord community webhook management.
 *
 * @param props - Component props with isOpen, onClose, viewerTimezone, and onRosterChanged
 * @returns React JSX slide-over drawer element
 */
export function ModDrawer({
  isOpen,
  onClose,
  viewerTimezone,
  onRosterChanged,
}: ModDrawerProps) {
  // Passcode & auth state
  const [passcode, setPasscode] = useState('');
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [verifying, setVerifying] = useState(false);

  // Tab navigation: 'pending' | 'roster' | 'add' | 'webhook'
  const [activeTab, setActiveTab] = useState<'pending' | 'roster' | 'add' | 'webhook'>('pending');

  // Webhook Tab state
  const [webhookUrlInput, setWebhookUrlInput] = useState('');
  const [webhookConfigured, setWebhookConfigured] = useState<boolean | null>(null);
  const [maskedWebhookUrl, setMaskedWebhookUrl] = useState<string | null>(null);
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [sendingDigest, setSendingDigest] = useState(false);
  const [webhookStatusMessage, setWebhookStatusMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Moderator roster data (includes inactive and pending members)
  const [modMembers, setModMembers] = useState<Member[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Editing member state
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [editBedtime, setEditBedtime] = useState('');
  const [editWakeTime, setEditWakeTime] = useState('');
  const [editTimezone, setEditTimezone] = useState('');
  const [editWeekendBedtime, setEditWeekendBedtime] = useState('');
  const [editWeekendWakeTime, setEditWeekendWakeTime] = useState('');
  const [editJournalUrl, setEditJournalUrl] = useState('');
  const [editHandle, setEditHandle] = useState('');
  const [editRole, setEditRole] = useState<'member' | 'moderator'>('member');

  // Reset PIN modal state
  const [pinResetMember, setPinResetMember] = useState<Member | null>(null);
  const [newPinValue, setNewPinValue] = useState('');

  // New member form
  const [newUsername, setNewUsername] = useState('');
  const [newHandle, setNewHandle] = useState('');
  const [newJournalUrl, setNewJournalUrl] = useState('');
  const [newBedtime, setNewBedtime] = useState('23:00');
  const [newWakeTime, setNewWakeTime] = useState('07:00');
  const [newTimezone, setNewTimezone] = useState(viewerTimezone);
  const [newWeekendBedtime, setNewWeekendBedtime] = useState('');
  const [newWeekendWakeTime, setNewWeekendWakeTime] = useState('');
  const [newRole, setNewRole] = useState<'member' | 'moderator'>('member');
  const [newPin, setNewPin] = useState('');

  // UI status feedback
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Check sessionStorage for cached unlock state on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const cached = sessionStorage.getItem('z_catchers_mod_passcode');
      if (cached) {
        setPasscode(cached);
        setIsUnlocked(true);
      }
    }
  }, []);

  // Fetch full moderator roster
  const fetchModRoster = useCallback(async (code: string) => {
    setLoadingMembers(true);
    try {
      const res = await fetch('/api/mod', {
        headers: { 'x-mod-passcode': code },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.members) {
          setModMembers(data.members);
        }
      }
    } catch (err) {
      console.error('Failed to load moderator roster:', err);
    } finally {
      setLoadingMembers(false);
    }
  }, []);

  const fetchWebhookStatus = useCallback(async (code: string) => {
    try {
      const res = await fetch('/api/mod/webhook', {
        headers: { 'x-mod-passcode': code },
      });
      if (res.ok) {
        const data = await res.json();
        setWebhookConfigured(data.configured);
        setMaskedWebhookUrl(data.maskedUrl);
      }
    } catch (err) {
      console.error('Failed to load webhook status:', err);
    }
  }, []);

  // When unlocked and modal is open, load roster & webhook status
  useEffect(() => {
    if (isOpen && isUnlocked && passcode) {
      fetchModRoster(passcode);
      fetchWebhookStatus(passcode);
      setErrorMessage(null);
      setSuccessMessage(null);
    }
  }, [isOpen, isUnlocked, passcode, fetchModRoster, fetchWebhookStatus]);

  // Handle Passcode Unlock
  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passcode.trim()) {
      setErrorMessage('Please enter the moderator secret passcode.');
      return;
    }

    setVerifying(true);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/mod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'verify',
          mod_passcode: passcode.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || 'Invalid passcode. Access denied.');
        return;
      }

      setIsUnlocked(true);
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('z_catchers_mod_passcode', passcode.trim());
      }
      setSuccessMessage('Moderator panel unlocked!');
      await fetchModRoster(passcode.trim());
      await fetchWebhookStatus(passcode.trim());
    } catch {
      setErrorMessage('Network error while verifying passcode.');
    } finally {
      setVerifying(false);
    }
  };

  // Webhook action handlers
  const handleSendTestWebhook = async () => {
    const targetUrl = webhookUrlInput.trim();
    if (targetUrl && !DISCORD_WEBHOOK_REGEX.test(targetUrl)) {
      setWebhookStatusMessage({
        type: 'error',
        text: 'Custom URL must match: https://discord.com/api/webhooks/ID/TOKEN',
      });
      return;
    }

    setTestingWebhook(true);
    setWebhookStatusMessage(null);

    try {
      const res = await fetch('/api/mod/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'test',
          passcode,
          webhook_url: targetUrl || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setWebhookStatusMessage({
          type: 'error',
          text: data.error || 'Failed to dispatch test webhook.',
        });
      } else {
        setWebhookStatusMessage({
          type: 'success',
          text: data.message || 'Test embed sent successfully to Discord channel! 🦊',
        });
      }
    } catch {
      setWebhookStatusMessage({
        type: 'error',
        text: 'Network error communicating with webhook endpoint.',
      });
    } finally {
      setTestingWebhook(false);
    }
  };

  const handleSendMorningDigest = async () => {
    const targetUrl = webhookUrlInput.trim();
    if (targetUrl && !DISCORD_WEBHOOK_REGEX.test(targetUrl)) {
      setWebhookStatusMessage({
        type: 'error',
        text: 'Custom URL must match: https://discord.com/api/webhooks/ID/TOKEN',
      });
      return;
    }

    setSendingDigest(true);
    setWebhookStatusMessage(null);

    try {
      const res = await fetch('/api/mod/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'digest',
          passcode,
          webhook_url: targetUrl || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setWebhookStatusMessage({
          type: 'error',
          text: data.error || 'Failed to send morning digest.',
        });
      } else {
        setWebhookStatusMessage({
          type: 'success',
          text: data.message || 'Morning slumber digest posted to Discord! ☀️',
        });
      }
    } catch {
      setWebhookStatusMessage({
        type: 'error',
        text: 'Network error posting morning digest.',
      });
    } finally {
      setSendingDigest(false);
    }
  };

  // Lock / Sign out
  const handleLock = () => {
    setIsUnlocked(false);
    setPasscode('');
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('z_catchers_mod_passcode');
    }
    setEditingMember(null);
    setPinResetMember(null);
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  // Filter members with pending cooldowns
  const pendingMembers = useMemo(() => {
    return modMembers.filter((m) => !!m.pending_effective_at);
  }, [modMembers]);

  // Filter roster for search query
  const filteredRoster = useMemo(() => {
    if (!searchQuery.trim()) return modMembers;
    const q = searchQuery.toLowerCase().trim();
    return modMembers.filter(
      (m) =>
        m.discord_username.toLowerCase().includes(q) ||
        (m.discord_handle && m.discord_handle.toLowerCase().includes(q)) ||
        m.timezone.toLowerCase().includes(q)
    );
  }, [modMembers, searchQuery]);

  // Action: Approve Cooldown Immediately
  const handleApproveCooldown = async (memberId: string) => {
    setActionLoadingId(`approve-${memberId}`);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await fetch('/api/mod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'approve_cooldown',
          mod_passcode: passcode,
          member_id: memberId,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || 'Failed to approve schedule change.');
        return;
      }

      setSuccessMessage(data.message || 'Schedule approved immediately!');
      await fetchModRoster(passcode);
      await onRosterChanged();
    } catch {
      setErrorMessage('Network error approving change.');
    } finally {
      setActionLoadingId(null);
    }
  };

  // Action: Cancel Cooldown
  const handleCancelCooldown = async (memberId: string) => {
    setActionLoadingId(`cancel-${memberId}`);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await fetch('/api/mod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'cancel_cooldown',
          mod_passcode: passcode,
          member_id: memberId,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || 'Failed to cancel schedule change.');
        return;
      }

      setSuccessMessage('Pending change was rejected and cancelled.');
      await fetchModRoster(passcode);
      await onRosterChanged();
    } catch {
      setErrorMessage('Network error cancelling change.');
    } finally {
      setActionLoadingId(null);
    }
  };

  // Action: Open Edit Member
  const startEditMember = (member: Member) => {
    setEditingMember(member);
    setEditBedtime(member.bedtime_local);
    setEditWakeTime(member.wake_time_local);
    setEditTimezone(member.timezone);
    setEditWeekendBedtime(member.weekend_bedtime_local || '');
    setEditWeekendWakeTime(member.weekend_wake_time_local || '');
    setEditJournalUrl(member.journal_url);
    setEditHandle(member.discord_handle || '');
    setEditRole(member.role);
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  // Action: Save Immediate Member Edit (Bypass 48h)
  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMember) return;

    if (!TIME_FORMAT_REGEX.test(editBedtime.trim())) {
      setErrorMessage('Bedtime must be in 24h "HH:mm" format (e.g. "23:30").');
      return;
    }

    if (editWeekendBedtime.trim() && !TIME_FORMAT_REGEX.test(editWeekendBedtime.trim())) {
      setErrorMessage('Weekend bedtime must be in 24h "HH:mm" format (e.g. "00:30").');
      return;
    }

    if (editWeekendWakeTime.trim() && !TIME_FORMAT_REGEX.test(editWeekendWakeTime.trim())) {
      setErrorMessage('Weekend wake time must be in 24h "HH:mm" format (e.g. "09:00").');
      return;
    }

    if (!DISCORD_JOURNAL_REGEX.test(editJournalUrl.trim())) {
      setErrorMessage('Invalid Discord Journal URL. Format: https://discord.com/channels/{guild}/{thread}');
      return;
    }

    setActionLoadingId('save-edit');
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await fetch('/api/mod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'edit_member',
          mod_passcode: passcode,
          member_id: editingMember.id,
          bedtime_local: editBedtime.trim(),
          wake_time_local: editWakeTime.trim() || '07:00',
          timezone: editTimezone.trim(),
          weekend_bedtime_local: editWeekendBedtime.trim() || null,
          weekend_wake_time_local: editWeekendWakeTime.trim() || null,
          journal_url: editJournalUrl.trim(),
          discord_handle: editHandle.trim() || null,
          role: editRole,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || 'Failed to update member.');
        return;
      }

      setSuccessMessage(data.message || 'Member schedule updated immediately with zero cooldown!');
      setEditingMember(null);
      await fetchModRoster(passcode);
      await onRosterChanged();
    } catch {
      setErrorMessage('Network error saving edit.');
    } finally {
      setActionLoadingId(null);
    }
  };

  // Action: Moderator Adjust Strikes & Metastrikes
  const handleAdjustStrikes = async (member: Member, deltaStrikes: number, deltaMetas: number) => {
    const currentStrikes = member.strikes_used ?? 0;
    const currentMetas = member.metastrikes_used ?? 0;
    const nextStrikes = Math.max(0, Math.min(3, currentStrikes + deltaStrikes));
    const nextMetas = Math.max(0, Math.min(3, currentMetas + deltaMetas));

    setActionLoadingId(`strikes_${member.id}`);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/mod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'adjust_strikes',
          mod_passcode: passcode,
          member_id: member.id,
          strikes_used: nextStrikes,
          metastrikes_used: nextMetas,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || 'Failed to adjust strikes.');
        return;
      }

      setSuccessMessage(`Updated strikes for ${member.discord_username}: ⚡ ${nextStrikes}/3 • 🛡️ ${nextMetas}/3`);
      await fetchModRoster(passcode);
      await onRosterChanged();
      setTimeout(() => setSuccessMessage(null), 3500);
    } catch {
      setErrorMessage('Network error adjusting member strikes.');
    } finally {
      setActionLoadingId(null);
    }
  };

  // Action: Clear Nightly Strike Log (Undo accidental vote / strike)
  const handleClearNightlyLog = async (member: Member) => {
    setActionLoadingId(`clear_${member.id}`);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/mod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'clear_strike_log',
          mod_passcode: passcode,
          member_id: member.id,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || 'Failed to clear strike log.');
        return;
      }

      setSuccessMessage(`Cleared tonight's strike log & accidental votes for ${member.discord_username}.`);
      await fetchModRoster(passcode);
      await onRosterChanged();
      setTimeout(() => setSuccessMessage(null), 3500);
    } catch {
      setErrorMessage('Network error clearing strike log.');
    } finally {
      setActionLoadingId(null);
    }
  };

  // Action: Toggle Member Active Status
  const handleToggleActive = async (member: Member) => {
    const nextStatus = !member.is_active;
    setActionLoadingId(`toggle-${member.id}`);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/mod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'toggle_active',
          mod_passcode: passcode,
          member_id: member.id,
          is_active: nextStatus,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || 'Failed to change member status.');
        return;
      }

      setSuccessMessage(data.message);
      await fetchModRoster(passcode);
      await onRosterChanged();
    } catch {
      setErrorMessage('Network error updating member status.');
    } finally {
      setActionLoadingId(null);
    }
  };

  // Action: Submit PIN Reset
  const handleResetPinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pinResetMember) return;

    if (newPinValue.trim() && !/^\d{4,6}$/.test(newPinValue.trim())) {
      setErrorMessage('PIN must be 4 to 6 numeric digits (or leave blank to clear).');
      return;
    }

    setActionLoadingId('reset-pin');
    setErrorMessage(null);

    try {
      const res = await fetch('/api/mod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reset_pin',
          mod_passcode: passcode,
          member_id: pinResetMember.id,
          new_pin: newPinValue.trim() || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || 'Failed to reset PIN.');
        return;
      }

      setSuccessMessage(data.message);
      setPinResetMember(null);
      setNewPinValue('');
      await fetchModRoster(passcode);
      await onRosterChanged();
    } catch {
      setErrorMessage('Network error resetting PIN.');
    } finally {
      setActionLoadingId(null);
    }
  };

  // Action: Add New Member
  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newUsername.trim() || !newJournalUrl.trim() || !newBedtime.trim()) {
      setErrorMessage('Username, Discord Journal URL, and Bedtime are required.');
      return;
    }

    if (!DISCORD_JOURNAL_REGEX.test(newJournalUrl.trim())) {
      setErrorMessage('Invalid Discord Journal URL. Format: https://discord.com/channels/{guild}/{thread}');
      return;
    }

    if (!TIME_FORMAT_REGEX.test(newBedtime.trim())) {
      setErrorMessage('Bedtime must be in 24h "HH:mm" format (e.g. "23:00").');
      return;
    }

    if (newWeekendBedtime.trim() && !TIME_FORMAT_REGEX.test(newWeekendBedtime.trim())) {
      setErrorMessage('Weekend bedtime must be in 24h "HH:mm" format (e.g. "00:30").');
      return;
    }

    if (newWeekendWakeTime.trim() && !TIME_FORMAT_REGEX.test(newWeekendWakeTime.trim())) {
      setErrorMessage('Weekend wake time must be in 24h "HH:mm" format (e.g. "09:00").');
      return;
    }

    if (newPin.trim() && !/^\d{4,6}$/.test(newPin.trim())) {
      setErrorMessage('Initial PIN must be 4 to 6 digits (or leave blank for member to claim).');
      return;
    }

    setActionLoadingId('add-member');
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await fetch('/api/mod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add_member',
          mod_passcode: passcode,
          discord_username: newUsername.trim(),
          discord_handle: newHandle.trim() || null,
          journal_url: newJournalUrl.trim(),
          bedtime_local: newBedtime.trim(),
          wake_time_local: newWakeTime.trim() || '07:00',
          timezone: newTimezone.trim(),
          weekend_bedtime_local: newWeekendBedtime.trim() || null,
          weekend_wake_time_local: newWeekendWakeTime.trim() || null,
          role: newRole,
          pin: newPin.trim() || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || 'Failed to create member.');
        return;
      }

      setSuccessMessage(`Welcome ${data.member.discord_username}! Profile created immediately.`);
      setNewUsername('');
      setNewHandle('');
      setNewJournalUrl('');
      setNewWeekendBedtime('');
      setNewWeekendWakeTime('');
      setNewPin('');
      setActiveTab('roster');
      await fetchModRoster(passcode);
      await onRosterChanged();
    } catch {
      setErrorMessage('Network error creating member.');
    } finally {
      setActionLoadingId(null);
    }
  };

  const hasDemoMembers = useMemo(() => {
    return modMembers.some(isDemoSeedMember);
  }, [modMembers]);

  const handlePurgeDemoMembers = async () => {
    if (
      !window.confirm(
        'Are you sure you want to remove the default pre-seeded demo profiles (Aoi, SarahK, Marcus, Arjun)?'
      )
    ) {
      return;
    }
    setActionLoadingId('purge_demo');
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const res = await fetch('/api/mod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'purge_seed_members',
          mod_passcode: passcode.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || 'Failed to purge demo profiles.');
      } else {
        setSuccessMessage(data.message || 'Purged demo profiles successfully.');
        await fetchModRoster(passcode.trim());
        await onRosterChanged();
      }
    } catch {
      setErrorMessage('Network error while purging demo profiles.');
    } finally {
      setActionLoadingId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-night-bg/85 backdrop-blur-md p-0 md:items-center md:p-4">
      <div
        className="relative flex w-full max-w-2xl lg:max-w-3xl flex-col rounded-t-3xl border-t border-night-border bg-night-surface p-5 shadow-2xl max-h-[92dvh] overflow-y-auto md:rounded-2xl md:border md:p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] md:pb-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mod-panel-title"
      >
        {/* Mobile drag handle indicator */}
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-night-border md:hidden shrink-0" />

        {/* Modal Top Header */}
        <div className="flex items-center justify-between border-b border-night-border pb-4">
          <div className="flex items-center gap-3">
            <FoxMascot state="logo" size={32} />
            <div>
              <div className="flex items-center gap-2">
                <h2 id="mod-panel-title" className="text-base font-bold text-cream-primary sm:text-lg">
                  Moderator Den Controls
                </h2>
                <span className="rounded-md bg-status-coral/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-status-coral">
                  Admin
                </span>
              </div>
              <p className="text-xs text-cream-muted">
                Bypass 48-hour cooldowns, manage server roster, and reset member PINs
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isUnlocked && (
              <button
                type="button"
                onClick={handleLock}
                title="Lock moderator session"
                aria-label="Lock moderator session"
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-lg border border-night-border bg-night-elevated px-2.5 py-1 text-xs text-cream-secondary transition-colors hover:text-status-coral hover:border-status-coral/40"
              >
                <Lock className="h-3.5 w-3.5 text-cream-muted" />
                <span className="hidden sm:inline">Lock</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              title="Close moderator panel"
              aria-label="Close moderator panel"
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-1.5 text-cream-muted transition-colors hover:bg-night-elevated hover:text-cream-primary"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Status Alerts */}
        {errorMessage && (
          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-status-coral/40 bg-status-coral/10 p-3 text-xs text-status-coral">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <p className="flex-1">{errorMessage}</p>
          </div>
        )}

        {successMessage && (
          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-status-sage/40 bg-status-sage/10 p-3 text-xs text-status-sage">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <p className="flex-1">{successMessage}</p>
          </div>
        )}

        {/* Passcode Lock View */}
        {!isUnlocked ? (
          <div className="mt-6 flex flex-col items-center py-6 text-center">
            <div className="mb-4 rounded-2xl border border-status-amber/30 bg-night-elevated p-4 shadow-inner">
              <KeyRound className="h-10 w-10 text-status-amber" />
            </div>
            <h3 className="text-base font-bold text-cream-primary">
              Passcode Authorization Required
            </h3>
            <p className="mt-1.5 max-w-sm text-xs text-cream-secondary">
              Enter the moderator secret passcode configured for your server den to unlock instant schedule approvals and roster administration.
            </p>

            <form onSubmit={handleUnlock} className="mt-6 w-full max-w-sm space-y-4">
              <div>
                <input
                  type="password"
                  placeholder="Enter Moderator Passcode"
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  className="w-full rounded-xl border border-night-border bg-night-bg px-4 py-2.5 text-center text-sm font-semibold tracking-wider text-cream-primary placeholder:text-cream-muted focus:border-status-amber focus:outline-none"
                  autoFocus
                />
              </div>

              <button
                type="submit"
                disabled={verifying || !passcode}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-status-amber px-4 py-2.5 text-xs font-bold text-night-bg transition-opacity hover:opacity-95 disabled:opacity-50"
              >
                {verifying ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>Verifying...</span>
                  </>
                ) : (
                  <>
                    <Unlock className="h-4 w-4" />
                    <span>Unlock Moderator Panel</span>
                  </>
                )}
              </button>
            </form>
          </div>
        ) : (
          /* Unlocked Moderator Panel View */
          <div className="mt-4 flex flex-col">
            {/* Tab Navigation Pill Bar */}
            <div className="flex items-center gap-1 rounded-xl border border-night-border bg-night-elevated p-1 text-xs">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('pending');
                  setEditingMember(null);
                  setPinResetMember(null);
                }}
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2 font-semibold transition-all ${
                  activeTab === 'pending'
                    ? 'bg-status-amber text-night-bg shadow-sm'
                    : 'text-cream-muted hover:text-cream-primary'
                }`}
              >
                <Zap className="h-3.5 w-3.5" />
                <span>Pending Approvals</span>
                {pendingMembers.length > 0 && (
                  <span
                    className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                      activeTab === 'pending'
                        ? 'bg-night-bg text-status-amber'
                        : 'bg-status-coral text-cream-primary'
                    }`}
                  >
                    {pendingMembers.length}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveTab('roster');
                  setEditingMember(null);
                  setPinResetMember(null);
                }}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 font-semibold transition-all ${
                  activeTab === 'roster'
                    ? 'bg-status-amber text-night-bg shadow-sm'
                    : 'text-cream-muted hover:text-cream-primary'
                }`}
              >
                <UserCheck className="h-3.5 w-3.5" />
                <span>Full Roster</span>
                <span className="text-[10px] opacity-75">({modMembers.length})</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveTab('add');
                  setEditingMember(null);
                  setPinResetMember(null);
                }}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 font-semibold transition-all ${
                  activeTab === 'add'
                    ? 'bg-status-amber text-night-bg shadow-sm'
                    : 'text-cream-muted hover:text-cream-primary'
                }`}
              >
                <UserPlus className="h-3.5 w-3.5" />
                <span>Add Member</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveTab('webhook');
                  setEditingMember(null);
                  setPinResetMember(null);
                  if (passcode) fetchWebhookStatus(passcode);
                }}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 font-semibold transition-all ${
                  activeTab === 'webhook'
                    ? 'bg-status-amber text-night-bg shadow-sm'
                    : 'text-cream-muted hover:text-cream-primary'
                }`}
              >
                <Radio className="h-3.5 w-3.5" />
                <span>Discord Webhook</span>
              </button>
            </div>

            {/* Sub-View: Inline Member Editor */}
            {editingMember && (
              <div className="mt-4 rounded-2xl border border-status-amber/40 bg-night-elevated p-4">
                <div className="flex items-center justify-between border-b border-night-border pb-3">
                  <div className="flex items-center gap-2">
                    <Edit2 className="h-4 w-4 text-status-amber" />
                    <h4 className="text-sm font-bold text-cream-primary">
                      Instant Edit: {editingMember.discord_username}
                    </h4>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditingMember(null)}
                    title="Close edit form"
                    aria-label="Close edit form"
                    className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded p-1 text-cream-muted hover:text-cream-primary"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <p className="mt-2 text-xs text-status-amber">
                  ⚡ Moderator edits bypass the 48-hour cooldown and take effect immediately. Any pending cooldown request will be resolved.
                </p>

                <form onSubmit={handleSaveEdit} className="mt-4 space-y-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="text-[11px] font-semibold text-cream-muted">
                        Bedtime (24h HH:mm)
                      </label>
                      <input
                        type="time"
                        value={editBedtime}
                        onChange={(e) => setEditBedtime(e.target.value)}
                        className="mt-1 w-full rounded-xl border border-night-border bg-night-bg px-3 py-2 text-sm text-cream-primary focus:border-status-amber focus:outline-none"
                        required
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-cream-muted">
                        Wake Time (24h HH:mm)
                      </label>
                      <input
                        type="time"
                        value={editWakeTime}
                        onChange={(e) => setEditWakeTime(e.target.value)}
                        className="mt-1 w-full rounded-xl border border-night-border bg-night-bg px-3 py-2 text-sm text-cream-primary focus:border-status-amber focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Weekend Hours Grid */}
                  <div className="rounded-xl border border-night-border/70 bg-night-surface/50 p-2.5 space-y-2">
                    <span className="text-[11px] font-bold text-cream-secondary flex items-center gap-1.5">
                      <span>🌙</span>
                      <span>Weekend Hours (Friday &amp; Saturday Nights - Optional)</span>
                    </span>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="text-[10px] font-medium text-cream-muted">
                          Weekend Bedtime (24h)
                        </label>
                        <input
                          type="time"
                          value={editWeekendBedtime}
                          onChange={(e) => setEditWeekendBedtime(e.target.value)}
                          className="mt-1 w-full rounded-xl border border-night-border bg-night-bg px-3 py-1.5 text-xs text-cream-primary focus:border-status-amber focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-medium text-cream-muted">
                          Weekend Wake Time (24h)
                        </label>
                        <input
                          type="time"
                          value={editWeekendWakeTime}
                          onChange={(e) => setEditWeekendWakeTime(e.target.value)}
                          className="mt-1 w-full rounded-xl border border-night-border bg-night-bg px-3 py-1.5 text-xs text-cream-primary focus:border-status-amber focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold text-cream-muted">
                      Timezone (GMT Offset)
                    </label>
                    <select
                      value={editTimezone}
                      onChange={(e) => setEditTimezone(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-night-border bg-night-bg px-3 py-2 text-sm text-cream-primary focus:border-status-amber focus:outline-none"
                    >
                      {!COMMON_IANA_TIMEZONES.includes(editTimezone as any) && (
                        <option value={editTimezone}>{editTimezone} ({formatGmtOffset(editTimezone)})</option>
                      )}
                      {COMMON_IANA_TIMEZONES.map((tz) => (
                        <option key={tz} value={tz}>
                          {tz} ({formatGmtOffset(tz)})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold text-cream-muted">
                      Discord Journal Thread URL
                    </label>
                    <input
                      type="url"
                      value={editJournalUrl}
                      onChange={(e) => setEditJournalUrl(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-night-border bg-night-bg px-3 py-2 text-xs text-cream-primary focus:border-status-amber focus:outline-none"
                      required
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="text-[11px] font-semibold text-cream-muted">
                        Discord Handle / User ID
                      </label>
                      <input
                        type="text"
                        value={editHandle}
                        onChange={(e) => setEditHandle(e.target.value)}
                        placeholder="e.g. @marcus_ldn"
                        className="mt-1 w-full rounded-xl border border-night-border bg-night-bg px-3 py-2 text-xs text-cream-primary focus:border-status-amber focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-cream-muted">
                        Role
                      </label>
                      <select
                        value={editRole}
                        onChange={(e) => setEditRole(e.target.value as 'member' | 'moderator')}
                        className="mt-1 w-full rounded-xl border border-night-border bg-night-bg px-3 py-2 text-xs text-cream-primary focus:border-status-amber focus:outline-none"
                      >
                        <option value="member">Regular Member</option>
                        <option value="moderator">Moderator</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setEditingMember(null)}
                      className="rounded-xl border border-night-border bg-night-bg px-3 py-2 text-xs font-semibold text-cream-secondary hover:text-cream-primary"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={actionLoadingId === 'save-edit'}
                      className="flex items-center gap-1.5 rounded-xl bg-status-amber px-4 py-2 text-xs font-bold text-night-bg hover:opacity-95 disabled:opacity-50"
                    >
                      {actionLoadingId === 'save-edit' ? (
                        <>
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          <span>Saving...</span>
                        </>
                      ) : (
                        <>
                          <Zap className="h-3.5 w-3.5" />
                          <span>Save & Apply Immediately</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Sub-View: PIN Reset Modal */}
            {pinResetMember && (
              <div className="mt-4 rounded-2xl border border-status-coral/40 bg-night-elevated p-4">
                <div className="flex items-center justify-between border-b border-night-border pb-3">
                  <div className="flex items-center gap-2">
                    <KeyRound className="h-4 w-4 text-status-coral" />
                    <h4 className="text-sm font-bold text-cream-primary">
                      Manage PIN: {pinResetMember.discord_username}
                    </h4>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPinResetMember(null)}
                    title="Close PIN form"
                    aria-label="Close PIN form"
                    className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded p-1 text-cream-muted hover:text-cream-primary"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <p className="mt-2 text-xs text-cream-secondary">
                  If this member forgot their 4-digit PIN, you can assign them a new PIN or clear it completely so they can reclaim their profile.
                </p>

                <form onSubmit={handleResetPinSubmit} className="mt-4 space-y-3">
                  <div>
                    <label className="text-[11px] font-semibold text-cream-muted">
                      New 4-Digit PIN (Leave blank to clear)
                    </label>
                    <input
                      type="password"
                      maxLength={6}
                      value={newPinValue}
                      onChange={(e) => setNewPinValue(e.target.value.replace(/\D/g, ''))}
                      placeholder="e.g. 1234 (or leave empty to reset to unclaimed)"
                      className="mt-1 w-full rounded-xl border border-night-border bg-night-bg px-3 py-2 text-xs text-cream-primary focus:border-status-amber focus:outline-none"
                    />
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setPinResetMember(null)}
                      className="rounded-xl border border-night-border bg-night-bg px-3 py-2 text-xs font-semibold text-cream-secondary hover:text-cream-primary"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={actionLoadingId === 'reset-pin'}
                      className="flex items-center gap-1.5 rounded-xl bg-status-coral px-4 py-2 text-xs font-bold text-cream-primary hover:opacity-95 disabled:opacity-50"
                    >
                      {actionLoadingId === 'reset-pin' ? (
                        <>
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          <span>Updating...</span>
                        </>
                      ) : (
                        <span>{newPinValue.trim() ? 'Set New PIN' : 'Clear & Unlock PIN'}</span>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* TAB 1: PENDING COOLDOWNS QUEUE */}
            {activeTab === 'pending' && !editingMember && !pinResetMember && (
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-cream-muted">
                    Active 48-Hour Cooldown Queue ({pendingMembers.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => fetchModRoster(passcode)}
                    disabled={loadingMembers}
                    className="flex items-center gap-1 text-xs text-status-amber hover:underline"
                  >
                    <RefreshCw className={`h-3 w-3 ${loadingMembers ? 'animate-spin' : ''}`} />
                    <span>Refresh</span>
                  </button>
                </div>

                {pendingMembers.length === 0 ? (
                  <div className="flex flex-col items-center justify-center rounded-2xl border border-night-border bg-night-elevated/40 py-10 text-center">
                    <FoxMascot state="sleeping" size={54} />
                    <p className="mt-3 text-sm font-semibold text-cream-primary">
                      The Cooldown Queue is Quiet
                    </p>
                    <p className="mt-1 max-w-sm text-xs text-cream-muted">
                      No members are currently waiting in the 48-hour accountability cooldown queue. All schedules are locked and active.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {pendingMembers.map((member) => {
                      const effectiveAt = member.pending_effective_at
                        ? DateTime.fromISO(member.pending_effective_at, { zone: 'utc' })
                        : null;
                      const now = DateTime.utc();
                      const hoursLeft = effectiveAt
                        ? Math.max(0, Math.floor(effectiveAt.diff(now, 'hours').hours))
                        : 0;
                      const minsLeft = effectiveAt
                        ? Math.max(0, Math.floor(effectiveAt.diff(now, 'minutes').minutes % 60))
                        : 0;

                      return (
                        <div
                          key={member.id}
                          className="flex flex-col gap-3 rounded-2xl border border-night-border bg-night-elevated p-4 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="flex items-start gap-3">
                            <img
                              src={member.avatar_url || `https://api.dicebear.com/7.x/bottts/svg?seed=${member.discord_username}`}
                              alt={member.discord_username}
                              className="h-10 w-10 shrink-0 rounded-xl border border-night-border bg-night-surface"
                            />
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-cream-primary">
                                  {member.discord_username}
                                </span>
                                {member.discord_handle && (
                                  <span className="text-xs text-cream-muted">
                                    {member.discord_handle}
                                  </span>
                                )}
                              </div>

                              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                                <span className="text-cream-muted">
                                  Current: <strong className="text-cream-secondary">{member.bedtime_local}</strong> ({formatGmtOffset(member.timezone)})
                                  {member.weekend_bedtime_local && <span> | Weekend: <strong className="text-cream-secondary">{member.weekend_bedtime_local}</strong></span>}
                                </span>
                                <span className="text-cream-muted">→</span>
                                <span className="text-status-amber">
                                  Requested: <strong>{member.pending_bedtime_local || member.bedtime_local}</strong> ({formatGmtOffset(member.pending_timezone || member.timezone)})
                                  {member.pending_weekend_bedtime_local && <span> | Weekend: <strong className="text-status-amber">{member.pending_weekend_bedtime_local}</strong></span>}
                                </span>
                              </div>

                              <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-cream-muted">
                                <Clock className="h-3 w-3 text-status-amber" />
                                <span>
                                  Automatic promotion in{' '}
                                  <strong className="text-cream-primary">
                                    {hoursLeft}h {minsLeft}m
                                  </strong>
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Action Buttons */}
                          <div className="flex items-center gap-2 self-end sm:self-auto">
                            <button
                              type="button"
                              onClick={() => handleCancelCooldown(member.id)}
                              disabled={actionLoadingId === `cancel-${member.id}`}
                              className="rounded-xl border border-night-border bg-night-bg px-3 py-2 text-xs font-semibold text-cream-secondary transition-colors hover:border-status-coral/40 hover:text-status-coral disabled:opacity-50"
                            >
                              {actionLoadingId === `cancel-${member.id}` ? 'Cancelling...' : 'Reject'}
                            </button>

                            <button
                              type="button"
                              onClick={() => handleApproveCooldown(member.id)}
                              disabled={actionLoadingId === `approve-${member.id}`}
                              className="flex items-center gap-1.5 rounded-xl bg-status-sage px-3.5 py-2 text-xs font-bold text-night-bg transition-opacity hover:opacity-95 disabled:opacity-50"
                            >
                              {actionLoadingId === `approve-${member.id}` ? (
                                <>
                                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                  <span>Approving...</span>
                                </>
                              ) : (
                                <>
                                  <Zap className="h-3.5 w-3.5" />
                                  <span>⚡ Approve Now</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: FULL ROSTER MANAGEMENT */}
            {activeTab === 'roster' && !editingMember && !pinResetMember && (
              <div className="mt-4 space-y-3">
                {/* Pre-seeded demo profiles banner */}
                {hasDemoMembers && (
                  <div className="flex items-center justify-between rounded-xl border border-status-amber/40 bg-status-amber/10 p-3 text-xs text-status-amber">
                    <div>
                      <span className="font-bold">Pre-seeded demo profiles detected</span>
                      <p className="text-[11px] opacity-80 mt-0.5">
                        Clean the den so only your friends&apos; real profiles appear.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handlePurgeDemoMembers}
                      disabled={actionLoadingId === 'purge_demo'}
                      className="shrink-0 rounded-lg bg-status-amber px-3 py-1.5 text-xs font-bold text-night-bg hover:bg-status-amber/90 transition-all disabled:opacity-50"
                    >
                      {actionLoadingId === 'purge_demo' ? 'Purging...' : 'Purge Demo Profiles'}
                    </button>
                  </div>
                )}

                {/* Search Bar */}
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-cream-muted" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by username, handle, or timezone..."
                    className="w-full rounded-xl border border-night-border bg-night-bg pl-9 pr-4 py-2 text-xs text-cream-primary placeholder:text-cream-muted focus:border-status-amber focus:outline-none"
                  />
                </div>

                <div className="space-y-2">
                  {filteredRoster.map((member) => (
                    <div
                      key={member.id}
                      className={`flex flex-col gap-3 rounded-2xl border p-3 sm:flex-row sm:items-center sm:justify-between ${
                        member.is_active
                          ? 'border-night-border bg-night-elevated'
                          : 'border-night-border/40 bg-night-surface/60 opacity-60'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <img
                          src={member.avatar_url || `https://api.dicebear.com/7.x/bottts/svg?seed=${member.discord_username}`}
                          alt={member.discord_username}
                          className="h-9 w-9 shrink-0 rounded-xl border border-night-border bg-night-surface"
                        />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-cream-primary text-sm">
                              {member.discord_username}
                            </span>
                            {member.role === 'moderator' && (
                              <span className="rounded bg-status-amber/20 px-1.5 py-0.5 text-[9px] font-bold text-status-amber">
                                MOD
                              </span>
                            )}
                            <span
                              className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
                                member.is_active
                                  ? 'bg-status-sage/20 text-status-sage'
                                  : 'bg-night-border text-cream-muted'
                              }`}
                            >
                              {member.is_active ? 'ACTIVE' : 'DEACTIVATED'}
                            </span>
                          </div>

                          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-cream-muted">
                            <span>Bedtime: <strong className="text-cream-secondary">{member.bedtime_local}</strong></span>
                            {member.weekend_bedtime_local && (
                              <span className="rounded bg-status-amber/15 border border-status-amber/30 px-1.5 py-0.2 text-[10px] font-semibold text-status-amber">
                                🌙 Fri/Sat: {member.weekend_bedtime_local}
                              </span>
                            )}
                            <span>•</span>
                            <span>{formatGmtOffset(member.timezone)}</span>
                            <span>•</span>
                            <span className={(member.has_pin ?? Boolean(member.passcode_hash)) ? 'text-status-sage' : 'text-status-amber'}>
                              {(member.has_pin ?? Boolean(member.passcode_hash)) ? 'PIN Set' : 'Unclaimed'}
                            </span>
                          </div>

                          {/* Mod Accountability Row: Adjust Strikes & Metastrikes */}
                          <div className="mt-2 flex flex-wrap items-center gap-3 rounded-xl border border-night-border/70 bg-night-bg/50 px-2.5 py-1.5 text-[11px]">
                            {/* Strikes Adjuster */}
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-fox-rust flex items-center gap-1">
                                <Zap className="h-3 w-3 fill-fox-rust text-fox-rust" />
                                <span>Strikes:</span>
                                <strong className="tabular-nums font-bold">{member.strikes_used ?? 0}/3</strong>
                              </span>
                              <div className="flex items-center gap-0.5 ml-1">
                                <button
                                  type="button"
                                  onClick={() => handleAdjustStrikes(member, -1, 0)}
                                  disabled={actionLoadingId === `strikes_${member.id}` || (member.strikes_used ?? 0) <= 0}
                                  className="h-5 w-5 rounded bg-night-elevated text-xs font-bold text-cream-secondary hover:text-cream-primary disabled:opacity-30 border border-night-border flex items-center justify-center"
                                  title="Decrement strikes"
                                >
                                  -
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleAdjustStrikes(member, 1, 0)}
                                  disabled={actionLoadingId === `strikes_${member.id}` || (member.strikes_used ?? 0) >= 3}
                                  className="h-5 w-5 rounded bg-night-elevated text-xs font-bold text-cream-secondary hover:text-cream-primary disabled:opacity-30 border border-night-border flex items-center justify-center"
                                  title="Increment strikes"
                                >
                                  +
                                </button>
                              </div>
                            </div>

                            <span className="text-cream-muted">•</span>

                            {/* Metastrikes Adjuster */}
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-fox-amber flex items-center gap-1">
                                <Shield className="h-3 w-3 fill-fox-amber/20 text-fox-amber" />
                                <span>Meta:</span>
                                <strong className="tabular-nums font-bold">{member.metastrikes_used ?? 0}/3</strong>
                              </span>
                              <div className="flex items-center gap-0.5 ml-1">
                                <button
                                  type="button"
                                  onClick={() => handleAdjustStrikes(member, 0, -1)}
                                  disabled={actionLoadingId === `strikes_${member.id}` || (member.metastrikes_used ?? 0) <= 0}
                                  className="h-5 w-5 rounded bg-night-elevated text-xs font-bold text-cream-secondary hover:text-cream-primary disabled:opacity-30 border border-night-border flex items-center justify-center"
                                  title="Decrement metastrikes"
                                >
                                  -
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleAdjustStrikes(member, 0, 1)}
                                  disabled={actionLoadingId === `strikes_${member.id}` || (member.metastrikes_used ?? 0) >= 3}
                                  className="h-5 w-5 rounded bg-night-elevated text-xs font-bold text-cream-secondary hover:text-cream-primary disabled:opacity-30 border border-night-border flex items-center justify-center"
                                  title="Increment metastrikes"
                                >
                                  +
                                </button>
                              </div>
                            </div>

                            <span className="text-cream-muted">•</span>

                            {/* Clear Tonight's Log / Accidental Votes */}
                            <button
                              type="button"
                              onClick={() => handleClearNightlyLog(member)}
                              disabled={actionLoadingId === `clear_${member.id}`}
                              className="text-[10px] text-cream-muted hover:text-fox-rust underline transition-colors"
                              title="Clear tonight's pending votes or accidental strike"
                            >
                              Clear Tonight&apos;s Log
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Member Actions */}
                      <div className="flex items-center gap-1.5 self-end sm:self-auto">
                        <a
                          href={member.journal_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Open Discord Journal Thread"
                          aria-label={`Open Discord Journal Thread for ${member.discord_username}`}
                          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-1.5 text-cream-muted transition-colors hover:bg-night-border hover:text-cream-primary"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>

                        <button
                          type="button"
                          onClick={() => setPinResetMember(member)}
                          title="Reset or clear PIN"
                          aria-label={`Reset or clear PIN for ${member.discord_username}`}
                          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-1.5 text-cream-muted transition-colors hover:bg-night-border hover:text-status-amber"
                        >
                          <KeyRound className="h-4 w-4" />
                        </button>

                        <button
                          type="button"
                          onClick={() => startEditMember(member)}
                          title="Edit member schedule immediately"
                          aria-label={`Edit schedule for ${member.discord_username}`}
                          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-1.5 text-cream-muted transition-colors hover:bg-night-border hover:text-cream-primary"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleToggleActive(member)}
                          disabled={actionLoadingId === `toggle-${member.id}`}
                          title={member.is_active ? 'Deactivate member' : 'Reactivate member'}
                          aria-label={`${member.is_active ? 'Deactivate' : 'Reactivate'} member ${member.discord_username}`}
                          className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-1.5 transition-colors ${
                            member.is_active
                              ? 'text-cream-muted hover:bg-night-border hover:text-status-coral'
                              : 'text-status-sage hover:bg-night-border'
                          }`}
                        >
                          <Power className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}

                  {filteredRoster.length === 0 && (
                    <div className="p-6 text-center text-xs text-cream-muted">
                      No members matched your search.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 3: ADD NEW MEMBER */}
            {activeTab === 'add' && !editingMember && !pinResetMember && (
              <form onSubmit={handleAddMember} className="mt-4 space-y-3">
                <div className="rounded-xl border border-night-border bg-night-elevated p-3 text-xs text-cream-secondary">
                  💡 Members created by a moderator are active immediately with zero cooldown period.
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="text-[11px] font-semibold text-cream-muted">
                      Discord Username *
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Alex"
                      value={newUsername}
                      onChange={(e) => setNewUsername(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-night-border bg-night-bg px-3 py-2 text-xs text-cream-primary placeholder:text-cream-muted focus:border-status-amber focus:outline-none"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-cream-muted">
                      Discord Handle (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. alex_sleeps"
                      value={newHandle}
                      onChange={(e) => setNewHandle(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-night-border bg-night-bg px-3 py-2 text-xs text-cream-primary placeholder:text-cream-muted focus:border-status-amber focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-cream-muted">
                    Discord Journal Thread URL *
                  </label>
                  <input
                    type="url"
                    placeholder="https://discord.com/channels/123456789/987654321"
                    value={newJournalUrl}
                    onChange={(e) => setNewJournalUrl(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-night-border bg-night-bg px-3 py-2 text-xs text-cream-primary placeholder:text-cream-muted focus:border-status-amber focus:outline-none"
                    required
                  />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="text-[11px] font-semibold text-cream-muted">
                      Bedtime (24h HH:mm) *
                    </label>
                    <input
                      type="time"
                      value={newBedtime}
                      onChange={(e) => setNewBedtime(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-night-border bg-night-bg px-3 py-2 text-sm text-cream-primary focus:border-status-amber focus:outline-none"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-cream-muted">
                      Wake Time (24h HH:mm)
                    </label>
                    <input
                      type="time"
                      value={newWakeTime}
                      onChange={(e) => setNewWakeTime(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-night-border bg-night-bg px-3 py-2 text-sm text-cream-primary focus:border-status-amber focus:outline-none"
                    />
                  </div>
                </div>

                {/* Weekend Hours Grid */}
                <div className="rounded-xl border border-night-border/70 bg-night-surface/50 p-2.5 space-y-2">
                  <span className="text-[11px] font-bold text-cream-secondary flex items-center gap-1.5">
                    <span>🌙</span>
                    <span>Weekend Hours (Friday &amp; Saturday Nights - Optional)</span>
                  </span>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="text-[10px] font-medium text-cream-muted">
                        Weekend Bedtime (24h)
                      </label>
                      <input
                        type="time"
                        value={newWeekendBedtime}
                        onChange={(e) => setNewWeekendBedtime(e.target.value)}
                        className="mt-1 w-full rounded-xl border border-night-border bg-night-bg px-3 py-1.5 text-xs text-cream-primary focus:border-status-amber focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-medium text-cream-muted">
                        Weekend Wake Time (24h)
                      </label>
                      <input
                        type="time"
                        value={newWeekendWakeTime}
                        onChange={(e) => setNewWeekendWakeTime(e.target.value)}
                        className="mt-1 w-full rounded-xl border border-night-border bg-night-bg px-3 py-1.5 text-xs text-cream-primary focus:border-status-amber focus:outline-none"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="text-[11px] font-semibold text-cream-muted">
                      Timezone (GMT Offset) *
                    </label>
                    <select
                      value={newTimezone}
                      onChange={(e) => setNewTimezone(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-night-border bg-night-bg px-3 py-2 text-xs text-cream-primary focus:border-status-amber focus:outline-none"
                    >
                      {!COMMON_IANA_TIMEZONES.includes(newTimezone as any) && (
                        <option value={newTimezone}>{newTimezone} ({formatGmtOffset(newTimezone)})</option>
                      )}
                      {COMMON_IANA_TIMEZONES.map((tz) => (
                        <option key={tz} value={tz}>
                          {tz} ({formatGmtOffset(tz)})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold text-cream-muted">
                      Role
                    </label>
                    <select
                      value={newRole}
                      onChange={(e) => setNewRole(e.target.value as 'member' | 'moderator')}
                      className="mt-1 w-full rounded-xl border border-night-border bg-night-bg px-3 py-2 text-xs text-cream-primary focus:border-status-amber focus:outline-none"
                    >
                      <option value="member">Regular Member</option>
                      <option value="moderator">Moderator</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-cream-muted">
                    Initial 4-Digit PIN (Optional)
                  </label>
                  <input
                    type="password"
                    maxLength={6}
                    placeholder="Leave blank for member to claim on first edit"
                    value={newPin}
                    onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
                    className="mt-1 w-full rounded-xl border border-night-border bg-night-bg px-3 py-2 text-xs text-cream-primary placeholder:text-cream-muted focus:border-status-amber focus:outline-none"
                  />
                </div>

                <div className="flex justify-end pt-3">
                  <button
                    type="submit"
                    disabled={actionLoadingId === 'add-member'}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-status-amber px-4 py-2.5 text-xs font-bold text-night-bg transition-opacity hover:opacity-95 disabled:opacity-50 sm:w-auto"
                  >
                    {actionLoadingId === 'add-member' ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        <span>Creating Member...</span>
                      </>
                    ) : (
                      <>
                        <UserPlus className="h-4 w-4" />
                        <span>Create Member Profile</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}

            {/* Tab 4 View: Discord Webhook Broadcast Controls */}
            {activeTab === 'webhook' && !editingMember && !pinResetMember && (
              <div className="mt-4 space-y-4">
                <div className="rounded-2xl border border-night-border bg-night-elevated p-4">
                  <div className="flex items-start gap-3">
                    <div className="rounded-xl border border-status-amber/30 bg-night-surface p-2.5">
                      <Radio className="h-6 w-6 text-status-amber" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-sm font-bold text-cream-primary">
                        Automated Discord Channel Webhooks
                      </h3>
                      <p className="mt-1 text-xs text-cream-muted leading-relaxed">
                        Broadcasts automated bedtime alerts into your server announcement channel when a member hits their bedtime (and hasn&apos;t checked in early). Also generates morning wake-up slumber digests celebrating active sleep streaks.
                      </p>
                    </div>
                  </div>

                  {/* Webhook Configuration Status */}
                  <div className="mt-4 rounded-xl border border-night-border/80 bg-night-surface p-3.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-cream-secondary">
                        Server Environment Integration:
                      </span>
                      {webhookConfigured ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-status-sage/40 bg-status-sage/15 px-2.5 py-0.5 font-bold text-status-sage">
                          <CheckCircle2 className="h-3 w-3" />
                          <span>Connected</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-night-border bg-night-elevated px-2.5 py-0.5 font-medium text-cream-muted">
                          <span>Not in Env (Optional override below)</span>
                        </span>
                      )}
                    </div>
                    {maskedWebhookUrl && (
                      <p className="mt-2 font-mono text-[11px] text-cream-muted break-all">
                        {maskedWebhookUrl}
                      </p>
                    )}
                  </div>
                </div>

                {/* Test & Trigger Controls */}
                <div className="rounded-2xl border border-night-border bg-night-elevated p-4 space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-cream-muted">
                    Test Webhook Delivery
                  </h4>

                  <div>
                    <label className="text-[11px] font-semibold text-cream-muted">
                      Custom Webhook URL Override (Optional)
                    </label>
                    <input
                      type="url"
                      placeholder={
                        maskedWebhookUrl
                          ? 'Using server env webhook (or paste custom URL here)'
                          : 'https://discord.com/api/webhooks/...'
                      }
                      value={webhookUrlInput}
                      onChange={(e) => setWebhookUrlInput(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-night-border bg-night-bg px-3 py-2 text-xs font-mono text-cream-primary placeholder:text-cream-muted focus:border-status-amber focus:outline-none"
                    />
                    <p className="mt-1 text-[10px] text-cream-muted">
                      Must match format: <code className="text-status-amber">https://discord.com/api/webhooks/ID/TOKEN</code>
                    </p>
                  </div>

                  {webhookStatusMessage && (
                    <div
                      className={`flex items-start gap-2 rounded-xl border p-3 text-xs ${
                        webhookStatusMessage.type === 'success'
                          ? 'border-status-sage/40 bg-status-sage/10 text-status-sage'
                          : 'border-status-coral/40 bg-status-coral/10 text-status-coral'
                      }`}
                    >
                      {webhookStatusMessage.type === 'success' ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                      )}
                      <span>{webhookStatusMessage.text}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 pt-1">
                    <button
                      type="button"
                      onClick={handleSendTestWebhook}
                      disabled={testingWebhook || sendingDigest}
                      className="flex min-h-[42px] items-center justify-center gap-2 rounded-xl bg-status-amber px-3 text-xs font-bold text-night-bg transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      {testingWebhook ? (
                        <>
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          <span>Dispatching Test...</span>
                        </>
                      ) : (
                        <>
                          <Send className="h-3.5 w-3.5" />
                          <span>Send Test Bedtime Embed</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={handleSendMorningDigest}
                      disabled={testingWebhook || sendingDigest}
                      className="flex min-h-[42px] items-center justify-center gap-2 rounded-xl border border-status-sage/40 bg-status-sage/15 px-3 text-xs font-bold text-status-sage transition-colors hover:bg-status-sage/25 disabled:opacity-50"
                    >
                      {sendingDigest ? (
                        <>
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          <span>Broadcasting Digest...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-3.5 w-3.5" />
                          <span>Post Morning Digest Now</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Guardrails note */}
                <div className="rounded-xl border border-status-amber/20 bg-status-amber/5 p-3 text-xs text-cream-secondary space-y-1">
                  <div className="flex items-center gap-1.5 font-bold text-status-amber">
                    <Shield className="h-3.5 w-3.5" />
                    <span>Sleep Shield & Anti-Spam Guarantee</span>
                  </div>
                  <p className="text-[11px] text-cream-muted leading-relaxed">
                    Bedtime embeds are only dispatched for sleepers who have not checked into bed early. Personal push alerts remain strictly muted during the 8-hour sleep window.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
