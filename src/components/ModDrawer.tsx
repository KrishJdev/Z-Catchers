'use client';

function DiscordIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.893.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}


import { ModeratorPunishmentQueue } from '@/components/ModeratorPunishmentQueue';
import { ModeratorMetastrikeQueue } from '@/components/ModeratorMetastrikeQueue';
import { ModeratorStrikeReview } from '@/components/ModeratorStrikeReview';
import { ResponsiveDialog } from '@/components/ResponsiveDialog';
import { RosterRoleAction, type ModeratorRoleChange } from '@/components/RosterRoleAction';
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { FoxMascot } from './FoxMascot';
import type { Member, ModerationRosterMember } from '@/lib/db';
import { getScheduleForDay } from '@/lib/sleepEngine';
import { ModeratorScheduleComparison } from './ModeratorScheduleComparison';
import { queueNotice } from './ModeratorQueueState';
import { pendingScheduleSnapshot } from '@/lib/pendingSchedule';
import { isDemoSeedMember } from '@/lib/demoSeed';
import { DateTime } from 'luxon';
import {
  X,
  Shield,
  ArrowLeft,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  Sparkles,
  Zap,
  UserCheck,
  RefreshCw,
  Search,
  Trash2,
  Power,
  Edit2,
  ChevronRight,
  Radio,
  Send,
} from 'lucide-react';

const DISCORD_JOURNAL_REGEX = /^https:\/\/(ptb\.|canary\.)?discord\.com\/channels\/\d+\/\d+(\/\d+)?$/;
const DISCORD_WEBHOOK_REGEX = /^https:\/\/(ptb\.|canary\.)?discord\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/;
const TIME_FORMAT_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

import { COMMON_IANA_TIMEZONES, GMT_OFFSETS, toValidLuxonZone, DayKey, DailySchedule, WeeklySchedule, DAY_KEYS } from '@/lib/timezone';
import { TimezoneSelect } from '@/components/TimezoneSelect';

const DAY_LABELS: Record<DayKey, { short: string; full: string }> = {
  mon: { short: 'Mon', full: 'Monday' },
  tue: { short: 'Tue', full: 'Tuesday' },
  wed: { short: 'Wed', full: 'Wednesday' },
  thu: { short: 'Thu', full: 'Thursday' },
  fri: { short: 'Fri', full: 'Friday' },
  sat: { short: 'Sat', full: 'Saturday' },
  sun: { short: 'Sun', full: 'Sunday' },
};

const moderationTabs = [
  ['pending', 'Approvals'],
  ['roster', 'Roster'],
  ['punishments', 'Punishments'],
  ['metastrikes', 'Metastrikes'],
] as const;
const secondaryButton = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-night-border px-3 py-1.5 text-sm font-semibold text-cream-primary hover:bg-night-elevated focus-visible:outline focus-visible:outline-status-amber disabled:opacity-50';
const primaryButton = 'inline-flex min-h-[44px] items-center justify-center rounded-lg bg-status-amber px-3 py-1.5 text-sm font-bold text-night-bg focus-visible:outline focus-visible:outline-status-amber disabled:opacity-50';
type MemberAction = 'active' | 'clear' | 'wake';

const memberRoleLabel = (member: Member) => member.role === 'owner' ? 'Owner' : member.role === 'moderator' ? 'Moderator' : 'Member';
const strikeTotal = (member: Member) => Math.max(member.strikes_used ?? 0, member.strikes_count ?? 0);
const passTotal = (member: Member) => Math.max(member.metastrikes_used ?? 0, member.metastrikes_count ?? 0);

function RosterAvatar({ member }: { member: Member }) {
  return <img src={member.avatar_url || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(member.discord_username)}`}
    alt="" className="h-9 w-9 shrink-0 rounded-full bg-night-elevated object-cover" />;
}

interface ModDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  viewerTimezone: string;
  onRosterChanged: () => Promise<void>;
  onMetastrikeReviewed: () => Promise<void>;
  currentUser?: Member | null;
  onAccessChanged?: () => void;
}

/**
 * Moderator administration drawer.
 * Provides privileged schedule overrides, dated strike corrections, Metastrike
 * balance controls, and Discord community webhook management.
 *
 * @param props - Component props with isOpen, onClose, viewerTimezone, and onRosterChanged
 * @returns React JSX slide-over drawer element
 */
export function ModDrawer({
  isOpen,
  onClose,
  viewerTimezone,
  onRosterChanged,
  onMetastrikeReviewed,
  currentUser,
  onAccessChanged,
}: ModDrawerProps) {

  // Main tabs and advanced tools
  const [activeTab, setActiveTab] = useState<'pending' | 'roster' | 'punishments' | 'metastrikes' | 'webhook'>('pending');

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
  const [modMembers, setModMembers] = useState<ModerationRosterMember[]>([]);
  const [rosterStatus, setRosterStatus] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading');
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{ action: MemberAction; member: Member } | null>(null);
  const contentPane = useRef<HTMLDivElement>(null);
  const detailPane = useRef<HTMLElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const rosterTrigger = useRef<HTMLButtonElement>(null);
  const rosterScroll = useRef(0);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [rosterRefreshFailed, setRosterRefreshFailed] = useState(false);
  const rosterRequest = useRef(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [strikeReviewMemberId, setStrikeReviewMemberId] = useState<string | null>(null);
  const [roleChangeTarget, setRoleChangeTarget] = useState<Member | null>(null);
  const [savingRoleChange, setSavingRoleChange] = useState(false);

  // Editing member state
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [editBedtime, setEditBedtime] = useState('');
  const [editWakeTime, setEditWakeTime] = useState('');
  const [editTimezone, setEditTimezone] = useState('');
  const [editWeekendBedtime, setEditWeekendBedtime] = useState('');
  const [editWeekendWakeTime, setEditWeekendWakeTime] = useState('');
  const [editJournalUrl, setEditJournalUrl] = useState('');
  const [editHandle, setEditHandle] = useState('');
  const [editWeeklySchedule, setEditWeeklySchedule] = useState<WeeklySchedule | null>(null);
  const [editScheduleMode, setEditScheduleMode] = useState<'quick' | '7day'>('quick');
  const [editSelectedDay, setEditSelectedDay] = useState<DayKey>('mon');

  // UI status feedback
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const isModUser = Boolean(currentUser?.is_moderator);

  const actorRole = currentUser?.role;
  const isOwner = isModUser && actorRole === 'owner';
  const actorId = currentUser?.id;
  const canManage = useCallback((member: Member) => isModUser && member.id !== actorId &&
    (member.role === 'member' || (isOwner && member.role === 'moderator')), [isModUser, actorId, isOwner]);
  const selectedMember = modMembers.find(member => member.id === selectedMemberId);
  const strikeReviewMember = isModUser && selectedMember?.id === strikeReviewMemberId && selectedMember.can_review_strikes
    ? selectedMember : undefined;
  const activeEditor = selectedMember && editingMember?.id === selectedMember.id &&
    editingMember.role === selectedMember.role && canManage(selectedMember) && !rosterRefreshFailed
    ? editingMember : null;

  useEffect(() => {
    try {
      sessionStorage.removeItem('z_catchers_mod_passcode');
    } catch {
      // Storage can be unavailable in private browsing.
    }
  }, []);

  // Fetch full moderator roster
  const fetchModRoster = useCallback(async (background = false) => {
    const request = ++rosterRequest.current;
    let accessDenied = false;
    setLoadingMembers(true);
    try {
      const res = await fetch('/api/mod', { cache: 'no-store' });
      if (request !== rosterRequest.current) return;
      accessDenied = res.status === 401 || res.status === 403;
      if (accessDenied) onAccessChanged?.();
      if (!res.ok) throw new Error('Could not load the moderation roster.');
      const data = await res.json();
      if (request !== rosterRequest.current) return;
      const roster: ModerationRosterMember[] = data.members;
      const actor = roster.find(member => member.id === actorId);
      if (!actor?.is_active || actor.role !== actorRole) {
        accessDenied = true;
        onAccessChanged?.();
        throw new Error('Moderation access changed.');
      }
      setModMembers(roster);
      setRosterStatus('ready');
      setRosterRefreshFailed(false);
    } catch (err) {
      if (request !== rosterRequest.current) return;
      console.error('Failed to load moderator roster:', err);
      if (background && !accessDenied) {
        setRosterRefreshFailed(true);
        return;
      }
      setRosterRefreshFailed(false);
      setRosterStatus(accessDenied ? 'denied' : 'error');
      setModMembers([]);
    } finally {
      if (request === rosterRequest.current) setLoadingMembers(false);
    }
  }, [actorId, actorRole, onAccessChanged]);

  const handleDrawerAccessChanged = useCallback(() => {
    onAccessChanged?.();
    void fetchModRoster(true);
  }, [onAccessChanged, fetchModRoster]);

  const fetchWebhookStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/mod/webhook', { cache: 'no-store' });
      if (res.status === 401 || res.status === 403) onAccessChanged?.();
      if (res.ok) {
        const data = await res.json();
        setWebhookConfigured(data.configured);
        setMaskedWebhookUrl(data.maskedUrl);
      }
    } catch (err) {
      console.error('Failed to load webhook status:', err);
    }
  }, [onAccessChanged]);

  useEffect(() => {
    setSelectedMemberId(null);
    setEditingMember(null);
    setRoleChangeTarget(null);
    setStrikeReviewMemberId(null);
    setConfirmation(null);
    setModMembers([]);
    setRosterStatus('loading');
    setRosterRefreshFailed(false);
    setErrorMessage(null);
    setSuccessMessage(null);
    if (isOpen && isModUser) void fetchModRoster();
    return () => { rosterRequest.current += 1; };
  }, [isOpen, isModUser, fetchModRoster]);

  useEffect(() => {
    if (!isOpen || !isModUser) return;
    // Return from another app or browser tab with current actor and target permissions.
    const refreshOnFocus = () => {
      if (document.visibilityState === 'visible') void fetchModRoster(true);
    };
    window.addEventListener('focus', refreshOnFocus);
    return () => window.removeEventListener('focus', refreshOnFocus);
  }, [isOpen, isModUser, fetchModRoster]);

  useEffect(() => {
    if (!isOpen || rosterStatus === 'denied') return;
    const viewport = window.visualViewport;
    const dialog = contentPane.current?.closest('dialog');
    if (!viewport || !dialog) return;
    const syncViewport = () => {
      dialog.style.setProperty('--mod-viewport-height', `${viewport.height}px`);
      dialog.style.setProperty('--mod-viewport-bottom', `${Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)}px`);
    };
    syncViewport();
    viewport.addEventListener('resize', syncViewport);
    viewport.addEventListener('scroll', syncViewport);
    return () => {
      viewport.removeEventListener('resize', syncViewport);
      viewport.removeEventListener('scroll', syncViewport);
    };
  }, [isOpen, rosterStatus]);

  useEffect(() => {
    if (!isOwner && activeTab === 'webhook') setActiveTab('pending');
    if (selectedMemberId && !selectedMember) {
      setSelectedMemberId(null);
      requestAnimationFrame(() => searchInput.current?.focus());
    }
    if (editingMember && !activeEditor) {
      setEditingMember(null);
      if (selectedMember) requestAnimationFrame(() => document.getElementById('mod-member-heading')?.focus());
    }
    if (strikeReviewMemberId && (!strikeReviewMember || rosterRefreshFailed)) {
      setStrikeReviewMemberId(null);
      if (selectedMember) requestAnimationFrame(() => document.getElementById('mod-member-heading')?.focus());
    }
    if (roleChangeTarget && (!isOwner || !selectedMember || !canManage(selectedMember) || rosterRefreshFailed ||
      selectedMember.role !== roleChangeTarget.role || selectedMember.is_active !== roleChangeTarget.is_active ||
      selectedMember.discord_id !== roleChangeTarget.discord_id)) setRoleChangeTarget(null);
    if (confirmation && (!selectedMember || !canManage(selectedMember) || rosterRefreshFailed ||
      selectedMember.role !== confirmation.member.role || selectedMember.is_active !== confirmation.member.is_active ||
      selectedMember.is_in_bed !== confirmation.member.is_in_bed ||
      selectedMember.last_notified_cycle_date !== confirmation.member.last_notified_cycle_date ||
      selectedMember.last_wake_cycle_date !== confirmation.member.last_wake_cycle_date)) setConfirmation(null);
  }, [isOwner, activeTab, selectedMemberId, selectedMember, editingMember, activeEditor, strikeReviewMemberId,
    strikeReviewMember, roleChangeTarget, canManage, rosterRefreshFailed, confirmation]);

  const handleModeratorRoleChange = async (change: ModeratorRoleChange, member: Member) => {
    setRoleChangeTarget(null);
    setSavingRoleChange(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const res = await fetch('/api/mod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_moderator', ...change }),
      });
      if (res.status === 401 || res.status === 403) onAccessChanged?.();
      const data = await res.json();
      if (!res.ok) {
        if ([401, 403, 404, 409].includes(res.status)) await fetchModRoster(true);
        setErrorMessage(data.error || 'Could not change moderator access.');
        return;
      }

      setSuccessMessage(change.new_role === 'moderator'
        ? `${member.discord_username} is now a moderator.`
        : `Removed moderator access for ${member.discord_username}.`);
      await fetchModRoster(true);
      await onRosterChanged();
    } catch {
      setErrorMessage('Could not confirm the role change. Refresh the roster before trying again.');
      setRoleChangeTarget(null);
      await fetchModRoster(true);
    } finally {
      setSavingRoleChange(false);
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

          webhook_url: targetUrl || undefined,
        }),
      });

      const data = await res.json();
      if (res.status === 401 || res.status === 403) onAccessChanged?.();
      if ([403, 404, 409].includes(res.status)) await fetchModRoster(true);
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

          webhook_url: targetUrl || undefined,
        }),
      });

      const data = await res.json();
      if (res.status === 401 || res.status === 403) onAccessChanged?.();
      if ([403, 404, 409].includes(res.status)) await fetchModRoster(true);
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

  // Filter members with pending cooldowns
  const pendingMembers = useMemo(() => {
    return modMembers.filter((m) => !!m.pending_effective_at && canManage(m));
  }, [modMembers, canManage]);

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
  const handleApproveCooldown = async (member: Member) => {
    const memberId = member.id;
    setActionLoadingId(`approve-${memberId}`);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await fetch('/api/mod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'approve_cooldown',
          expected_pending: pendingScheduleSnapshot(member),

          member_id: memberId,
        }),
      });

      const data = await res.json();
      if (res.status === 401 || res.status === 403) onAccessChanged?.();
      if ([403, 404, 409].includes(res.status)) await fetchModRoster(true);
      if (!res.ok) {
        setErrorMessage(data.error || 'Failed to approve schedule change.');
        return;
      }

      setSuccessMessage(data.message || 'Schedule approved immediately!');
      await fetchModRoster(true);
      await onRosterChanged();
    } catch {
      setErrorMessage('Network error approving change.');
    } finally {
      setActionLoadingId(null);
    }
  };

  // Action: Cancel Cooldown
  const handleCancelCooldown = async (member: Member) => {
    const memberId = member.id;
    setActionLoadingId(`cancel-${memberId}`);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await fetch('/api/mod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'cancel_cooldown',
          expected_pending: pendingScheduleSnapshot(member),

          member_id: memberId,
        }),
      });

      const data = await res.json();
      if (res.status === 401 || res.status === 403) onAccessChanged?.();
      if ([403, 404, 409].includes(res.status)) await fetchModRoster(true);
      if (!res.ok) {
        setErrorMessage(data.error || 'Failed to cancel schedule change.');
        return;
      }

      setSuccessMessage('Pending change was rejected and cancelled.');
      await fetchModRoster(true);
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
    setEditSelectedDay('mon');

    if (member.weekly_schedule) {
      setEditWeeklySchedule(JSON.parse(JSON.stringify(member.weekly_schedule)));
      // Check if it's identical across weekdays and weekends
      const s = member.weekly_schedule;
      const isSimpleWeekday =
        s.mon?.bedtime === s.tue?.bedtime &&
        s.mon?.wake_time === s.tue?.wake_time &&
        s.tue?.bedtime === s.wed?.bedtime &&
        s.tue?.wake_time === s.wed?.wake_time &&
        s.wed?.bedtime === s.thu?.bedtime &&
        s.wed?.wake_time === s.thu?.wake_time &&
        s.thu?.bedtime === s.sun?.bedtime &&
        s.thu?.wake_time === s.sun?.wake_time;
      const isSimpleWeekend =
        s.fri?.bedtime === s.sat?.bedtime &&
        s.fri?.wake_time === s.sat?.wake_time;
      setEditScheduleMode(isSimpleWeekday && isSimpleWeekend ? 'quick' : '7day');
    } else {
      const bBed = member.bedtime_local || '23:00';
      const bWake = member.wake_time_local || '07:00';
      const wBed = member.weekend_bedtime_local || bBed;
      const wWake = member.weekend_wake_time_local || bWake;
      setEditWeeklySchedule({
        mon: { bedtime: bBed, wake_time: bWake },
        tue: { bedtime: bBed, wake_time: bWake },
        wed: { bedtime: bBed, wake_time: bWake },
        thu: { bedtime: bBed, wake_time: bWake },
        fri: { bedtime: wBed, wake_time: wWake },
        sat: { bedtime: wBed, wake_time: wWake },
        sun: { bedtime: bBed, wake_time: bWake },
      });
      setEditScheduleMode('quick');
    }

    setErrorMessage(null);
    setSuccessMessage(null);
  };

  // Action: Save Immediate Member Edit (Bypass 48h)
  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeEditor || actionLoadingId) return;
    const editingMember = activeEditor;

    if (!DISCORD_JOURNAL_REGEX.test(editJournalUrl.trim())) {
      setErrorMessage('Invalid Discord Journal URL. Format: https://discord.com/channels/{guild}/{thread}');
      return;
    }

    // Determine final weekly schedule
    let finalWeeklySchedule: WeeklySchedule;
    if (editScheduleMode === '7day' && editWeeklySchedule) {
      finalWeeklySchedule = editWeeklySchedule;
    } else {
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

      const baseBed = editBedtime.trim();
      const baseWake = editWakeTime.trim() || '07:00';
      const wBed = editWeekendBedtime.trim() || baseBed;
      const wWake = editWeekendWakeTime.trim() || baseWake;
      finalWeeklySchedule = {
        mon: { bedtime: baseBed, wake_time: baseWake },
        tue: { bedtime: baseBed, wake_time: baseWake },
        wed: { bedtime: baseBed, wake_time: baseWake },
        thu: { bedtime: baseBed, wake_time: baseWake },
        fri: { bedtime: wBed, wake_time: wWake },
        sat: { bedtime: wBed, wake_time: wWake },
        sun: { bedtime: baseBed, wake_time: baseWake },
      };
    }

    // Validate every day in finalWeeklySchedule
    for (const day of DAY_KEYS) {
      const item = finalWeeklySchedule[day];
      if (!item || !TIME_FORMAT_REGEX.test(item.bedtime) || !TIME_FORMAT_REGEX.test(item.wake_time)) {
        setErrorMessage(`Schedule for ${day.toUpperCase()} must have valid 24h "HH:mm" times.`);
        return;
      }
      if (item.bedtime === item.wake_time) {
        setErrorMessage(`Bedtime and wake time cannot be identical on ${day.toUpperCase()}.`);
        return;
      }
    }

    setActionLoadingId('save-edit');
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await fetch('/api/mod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'edit_schedule',
          member_id: editingMember.id,
          expected_updated_at: editingMember.updated_at,
          bedtime_local: finalWeeklySchedule.mon.bedtime,
          wake_time_local: finalWeeklySchedule.mon.wake_time,
          timezone: editTimezone.trim(),
          weekend_bedtime_local: finalWeeklySchedule.sat.bedtime !== finalWeeklySchedule.mon.bedtime ? finalWeeklySchedule.sat.bedtime : null,
          weekend_wake_time_local: finalWeeklySchedule.sat.wake_time !== finalWeeklySchedule.mon.wake_time ? finalWeeklySchedule.sat.wake_time : null,
          weekly_schedule: finalWeeklySchedule,
          journal_url: editJournalUrl.trim(),
          discord_handle: editHandle.trim() || null,
        }),
      });

      const data = await res.json();
      if (res.status === 401 || res.status === 403) onAccessChanged?.();
      if ([403, 404].includes(res.status)) await fetchModRoster(true);
      if (res.status === 409) {
        setEditingMember(current => current === editingMember ? null : current);
        await fetchModRoster(true);
        setErrorMessage('The profile changed. Review the refreshed schedule before editing again.');
        return;
      }
      if (!res.ok) {
        setErrorMessage(data.error || 'Failed to update member.');
        return;
      }

      setSuccessMessage(data.message || 'Member schedule updated immediately with zero cooldown!');
      setEditingMember(current => current === editingMember ? null : current);
      focusControl(`edit-schedule-${editingMember.id}`);
      await fetchModRoster(true);
      await onRosterChanged();
    } catch {
      setErrorMessage('Network error saving edit.');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleAdjustPasses = async (member: Member, delta: number) => {
    setActionLoadingId(`passes_${member.id}`);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/mod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'adjust_passes',
          member_id: member.id,
          metastrike_delta: delta,
        }),
      });

      const data = await res.json();
      if (res.status === 401 || res.status === 403) onAccessChanged?.();
      if ([403, 404, 409].includes(res.status)) await fetchModRoster(true);
      if (!res.ok) {
        setErrorMessage(data.error || 'Failed to adjust the Metastrike balance.');
        return;
      }

      setSuccessMessage(`Metastrikes used by ${member.discord_username}: ${data.metastrikes_used}/3`);
      await fetchModRoster(true);
      await onRosterChanged();
      setTimeout(() => setSuccessMessage(null), 3500);
    } catch {
      setErrorMessage('Could not reach the server to adjust Metastrikes.');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleClearMetastrikeLog = async (member: Member) => {
    setActionLoadingId(`clear_${member.id}`);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/mod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'clear_metastrike_log',
          member_id: member.id,
        }),
      });

      const data = await res.json();
      if (res.status === 401 || res.status === 403) onAccessChanged?.();
      if ([403, 404, 409].includes(res.status)) await fetchModRoster(true);
      if (!res.ok) {
        setErrorMessage(data.error || 'Failed to clear the Metastrike.');
        return;
      }

      setSuccessMessage(data.message);
      await fetchModRoster(true);
      await onRosterChanged();
      setTimeout(() => setSuccessMessage(null), 3500);
    } catch {
      setErrorMessage('Could not reach the server to clear the Metastrike.');
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

          member_id: member.id,
          is_active: nextStatus,
        }),
      });

      const data = await res.json();
      if (res.status === 401 || res.status === 403) onAccessChanged?.();
      if ([403, 404, 409].includes(res.status)) await fetchModRoster(true);
      if (!res.ok) {
        setErrorMessage(data.error || 'Failed to change member status.');
        return;
      }

      setSuccessMessage(data.message);
      await fetchModRoster(true);
      await onRosterChanged();
    } catch {
      setErrorMessage('Network error updating member status.');
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

        }),
      });
      const data = await res.json();
      if (res.status === 401 || res.status === 403) onAccessChanged?.();
      if ([403, 404, 409].includes(res.status)) await fetchModRoster(true);
      if (!res.ok) {
        setErrorMessage(data.error || 'Failed to purge demo profiles.');
      } else {
        setSuccessMessage(data.message || 'Purged demo profiles successfully.');
        await fetchModRoster(true);
        await onRosterChanged();
      }
    } catch {
      setErrorMessage('Network error while purging demo profiles.');
    } finally {
      setActionLoadingId(null);
    }
  };

  function focusControl(id: string, startOfDetail = false) {
    requestAnimationFrame(() => {
      if (startOfDetail) {
        if (detailPane.current) detailPane.current.scrollTop = 0;
        if (contentPane.current) contentPane.current.scrollTop = 0;
      }
      document.getElementById(id)?.focus({ preventScroll: startOfDetail });
    });
  }

  function clearMemberForms() {
    setEditingMember(null);
    setStrikeReviewMemberId(null);
    setRoleChangeTarget(null);
    setConfirmation(null);
  }

  function changeTab(tab: typeof activeTab) {
    if (tab === activeTab) return;
    clearMemberForms();
    setSelectedMemberId(null);
    setActiveTab(tab);
    if (contentPane.current) contentPane.current.scrollTop = 0;
  }

  function openMember(member: ModerationRosterMember, trigger: HTMLButtonElement) {
    if (selectedMemberId === member.id) return;
    if (!selectedMemberId) rosterScroll.current = contentPane.current?.scrollTop ?? 0;
    rosterTrigger.current = trigger;
    clearMemberForms();
    setErrorMessage(null);
    setSuccessMessage(null);
    setSelectedMemberId(member.id);
    focusControl('mod-member-heading', true);
  }

  function backToRoster() {
    clearMemberForms();
    setSelectedMemberId(null);
    requestAnimationFrame(() => {
      if (contentPane.current) contentPane.current.scrollTop = rosterScroll.current;
      const trigger = rosterTrigger.current;
      (trigger?.isConnected ? trigger : searchInput.current)?.focus({ preventScroll: true });
    });
  }

  function refreshRoster() {
    return fetchModRoster(rosterStatus === 'ready');
  }

  async function handleUndoSleep(member: Member) {
    setActionLoadingId(`wake_${member.id}`);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const res = await fetch('/api/members/in-bed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId: member.id, action: 'cancel' }),
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) handleDrawerAccessChanged();
        if (res.status === 409 || res.status === 404) await fetchModRoster(true);
        const data = await res.json().catch(() => ({}));
        setErrorMessage(data.error || 'Failed to reset sleep status.');
        return;
      }
      setSuccessMessage(`Reset sleep status for ${member.discord_username} to Awake.`);
      await fetchModRoster(true);
      await onRosterChanged();
    } catch {
      setErrorMessage('Network error resetting sleep status.');
    } finally {
      setActionLoadingId(null);
    }
  }

  function renderMemberTools(member: ModerationRosterMember) {
    const allowed = !rosterRefreshFailed && canManage(member);
    const canManageAccount = isOwner && allowed;
    const busy = Boolean(actionLoadingId) || savingRoleChange;
    const presentTime = (bedtime: string, wake: string) => (
      <span className="tabular-nums">{bedtime} bedtime · {wake} wake</span>
    );
    const confirmAction = (action: MemberAction, label: string, prompt: string, run: () => Promise<void>) => {
      const confirming = confirmation?.action === action && confirmation.member.role === member.role && confirmation.member.is_active === member.is_active;
      const id = `mod-member-confirm-${action}`;
      return (
        <div className="space-y-2">
          <button type="button" id={`${id}-trigger`} aria-expanded={confirming} aria-controls={confirming ? id : undefined}
            disabled={busy} className={secondaryButton + ' !text-status-coral'}
            onClick={() => {
              setRoleChangeTarget(null);
              setConfirmation(confirming ? null : { action, member });
              if (!confirming) focusControl(`${id}-cancel`);
            }}>
            {label}
          </button>
          {confirming && (
            <div id={id} className="rounded-lg border border-night-border bg-night-bg p-3 text-sm">
              <p className="break-words">{prompt} <strong>{member.discord_username}</strong>?</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className={primaryButton + ' !bg-status-coral'} disabled={busy} onClick={() => {
                  setConfirmation(null);
                  focusControl('mod-member-heading');
                  void run();
                }}>Confirm</button>
                <button type="button" id={`${id}-cancel`} className={secondaryButton} onClick={() => {
                  setConfirmation(null);
                  focusControl(`${id}-trigger`);
                }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      );
    };

    return (
      <>
        <section aria-labelledby="mod-member-schedule" className="space-y-2 border-t border-night-border pt-3">
          <h4 id="mod-member-schedule" className="font-semibold">Schedule</h4>
          <p className="break-words text-sm text-cream-secondary">
            {member.weekly_schedule ? 'Weekly schedule' : presentTime(member.bedtime_local, member.wake_time_local)} · {member.timezone}
          </p>
          {member.weekly_schedule && (
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm text-cream-secondary">
              {DAY_KEYS.map((day, index) => {
                const { bedtime, wake_time } = getScheduleForDay(member, DateTime.utc(2020, 1, 6).plus({ days: index }));
                return (
                  <React.Fragment key={day}>
                    <dt>{DAY_LABELS[day].short}</dt>
                    <dd>{presentTime(bedtime, wake_time)}</dd>
                  </React.Fragment>
                );
              })}
            </dl>
          )}
          {!member.weekly_schedule && (member.weekend_bedtime_local || member.weekend_wake_time_local) && (
            <p className="text-sm text-cream-secondary">
              Fri, Sat · {presentTime(member.weekend_bedtime_local || member.bedtime_local, member.weekend_wake_time_local || member.wake_time_local)}
            </p>
          )}
          {member.pending_effective_at && <p className="text-sm text-status-amber">Schedule change pending</p>}
          <div className="flex flex-wrap gap-2">
            {allowed && (
              <button type="button" id={`edit-schedule-${member.id}`} aria-label={`Edit schedule for ${member.discord_username}`}
                className={secondaryButton} disabled={busy} onClick={() => {
                  setConfirmation(null);
                  setRoleChangeTarget(null);
                  startEditMember(member);
                  focusControl('mod-schedule-editor-heading', true);
                }}>
                <Edit2 className="h-4 w-4" aria-hidden="true" /> Edit schedule
              </button>
            )}
            {DISCORD_JOURNAL_REGEX.test(member.journal_url) && (
              <a href={member.journal_url} target="_blank" rel="noopener noreferrer" className={secondaryButton}
                aria-label={`Open Discord Journal Thread for ${member.discord_username}`}>
                Open journal <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </a>
            )}
          </div>
          {allowed && member.is_active && (member.is_in_bed || (member.last_notified_stage === 'IN_BED_EARLY' &&
            member.last_notified_cycle_date !== member.last_wake_cycle_date)) &&
            confirmAction('wake', 'Wake Up / Undo Sleep', 'Undo the sleep check-in for', () => handleUndoSleep(member))}
        </section>

        {(member.can_review_strikes || canManageAccount) && (
          <section aria-labelledby="mod-member-accountability" className="space-y-2 border-t border-night-border pt-3">
            <h4 id="mod-member-accountability" className="font-semibold">Accountability</h4>
            {member.strike_counts_unavailable ? (
              <p className="text-sm text-cream-secondary">Strike and pass counts unavailable</p>
            ) : (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-cream-secondary">
                <p>Strikes <strong className="tabular-nums text-cream-primary">{strikeTotal(member)}</strong></p>
                <div className="flex flex-wrap items-center gap-2">
                  <span>Metastrikes <strong className="tabular-nums text-cream-primary">{passTotal(member)}/3</strong></span>
                  {canManageAccount && (
                    <div className="flex gap-1">
                      <button type="button" aria-label="Decrease Metastrikes used" disabled={busy || passTotal(member) <= 0}
                        className={secondaryButton + ' min-w-[44px]'} onClick={() => void handleAdjustPasses(member, -1)}>−</button>
                      <button type="button" aria-label="Increase Metastrikes used" disabled={busy || passTotal(member) >= 3}
                        className={secondaryButton + ' min-w-[44px]'} onClick={() => void handleAdjustPasses(member, 1)}>+</button>
                    </div>
                  )}
                </div>
              </div>
            )}
            {member.can_review_strikes && !rosterRefreshFailed && (
              <button type="button" id={`review-strikes-${member.id}`} aria-label={`Edit strikes for ${member.discord_username}`}
                className={secondaryButton} disabled={busy} onClick={() => {
                  setErrorMessage(null);
                  setSuccessMessage(null);
                  setConfirmation(null);
                  setRoleChangeTarget(null);
                  setStrikeReviewMemberId(member.id);
                }}>Edit strikes</button>
            )}
            {canManageAccount && confirmAction('clear', 'Clear tonight’s Metastrike', 'Clear tonight’s Metastrike for', () => handleClearMetastrikeLog(member))}
          </section>
        )}

        <section aria-labelledby="mod-member-access" className="space-y-2 border-t border-night-border pt-3">
          <h4 id="mod-member-access" className="font-semibold">Account access</h4>
          <p className="break-words text-sm text-cream-secondary">
            {member.discord_id ? 'Discord linked' : 'Discord not linked'}{member.discord_handle && ` · @${member.discord_handle}`}
          </p>
          {canManageAccount && (
            <>
              <RosterRoleAction member={member} isOwner busy={busy}
                confirming={roleChangeTarget?.id === member.id && roleChangeTarget.role === member.role &&
                  roleChangeTarget.is_active === member.is_active && roleChangeTarget.discord_id === member.discord_id}
                onToggle={() => {
                  setConfirmation(null);
                  setRoleChangeTarget(target => target?.id === member.id ? null : member);
                }}
                onConfirm={change => { focusControl('mod-member-heading'); void handleModeratorRoleChange(change, member); }} />
              {confirmAction('active', member.is_active ? 'Deactivate member' : 'Reactivate member',
                member.is_active ? 'Deactivate' : 'Reactivate', () => handleToggleActive(member))}
            </>
          )}
        </section>
      </>
    );
  }

  if (!isOpen || !isModUser || rosterStatus === 'denied') return null;

  const scheduleEditor = activeEditor && (
    <div className="border-t border-night-border pt-3">
      <div className="flex items-center justify-between border-b border-night-border pb-3">
        <div className="flex items-center gap-2">
          <Edit2 className="h-4 w-4 text-status-amber" />
          <h4 id="mod-schedule-editor-heading" tabIndex={-1} className="break-words text-sm font-bold text-cream-primary">
            Edit schedule
          </h4>
        </div>
        <button
          type="button"
          onClick={() => { setEditingMember(null); focusControl(`edit-schedule-${activeEditor.id}`); }}
          title="Close edit form"
          aria-label="Close edit form"
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded p-1 text-cream-muted hover:text-cream-primary"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <p className="mt-2 text-xs text-status-amber">
        Changes apply immediately and resolve any pending schedule request.
      </p>

      <form onSubmit={handleSaveEdit} className="mt-4 space-y-3">
        {/* Mode Switcher: Quick Weekday/Weekend vs 7-Day Variable */}
        <div className="flex rounded-xl bg-night-surface p-1 border border-night-border">
          <button
            type="button"
            onClick={() => setEditScheduleMode('quick')}
            className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition-all min-h-[44px] ${
              editScheduleMode === 'quick'
                ? 'bg-status-amber text-night-bg shadow'
                : 'text-cream-muted hover:text-cream-secondary'
            }`}
          >
            Quick Hours
          </button>
          <button
            type="button"
            onClick={() => setEditScheduleMode('7day')}
            className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition-all min-h-[44px] ${
              editScheduleMode === '7day'
                ? 'bg-status-amber text-night-bg shadow'
                : 'text-cream-muted hover:text-cream-secondary'
            }`}
          >
            7-Day Variable Routine
          </button>
        </div>

        {editScheduleMode === 'quick' ? (
          <>
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
          </>
        ) : (
          /* 7-Day Variable Schedule Editor */
          <div className="rounded-xl border border-night-border/70 bg-night-surface/50 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-cream-secondary flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 text-status-amber" />
                <span>7-Day Custom Sleep Routine</span>
              </span>
              <span className="text-[10px] text-cream-muted">
                Tap any day to customize
              </span>
            </div>

            {/* 7-day selector pills */}
            <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5">
              {DAY_KEYS.map((day) => {
                const isSelected = editSelectedDay === day;
                const schedule = editWeeklySchedule?.[day];
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => setEditSelectedDay(day)}
                    className={`flex flex-col items-center justify-center rounded-xl p-1 text-center transition-all min-h-[44px] ${
                      isSelected
                        ? 'bg-status-amber text-night-bg font-bold shadow'
                        : 'bg-night-bg border border-night-border text-cream-secondary hover:border-status-amber/40'
                    }`}
                  >
                    <span className="text-[10px] uppercase font-semibold">
                      {DAY_LABELS[day].short}
                    </span>
                    <span className="text-[9px] tabular-nums mt-0.5 opacity-90">
                      {schedule?.bedtime || '--:--'}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Active Day Inputs */}
            {editWeeklySchedule && (
              <div className="rounded-lg border border-night-border bg-night-bg p-2.5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-cream-primary">
                    {DAY_LABELS[editSelectedDay].full} Night
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        if (!editWeeklySchedule) return;
                        const src = editWeeklySchedule[editSelectedDay];
                        setEditWeeklySchedule((prev) =>
                          prev
                            ? {
                                ...prev,
                                mon: { ...src },
                                tue: { ...src },
                                wed: { ...src },
                                thu: { ...src },
                                sun: { ...src },
                              }
                            : prev
                        );
                      }}
                      className="rounded px-1.5 py-0.5 text-[9px] font-medium text-cream-muted bg-night-surface hover:text-status-amber border border-night-border min-h-[44px]"
                    >
                      Copy to Weekdays
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!editWeeklySchedule) return;
                        const src = editWeeklySchedule[editSelectedDay];
                        setEditWeeklySchedule((prev) =>
                          prev
                            ? {
                                ...prev,
                                mon: { ...src },
                                tue: { ...src },
                                wed: { ...src },
                                thu: { ...src },
                                fri: { ...src },
                                sat: { ...src },
                                sun: { ...src },
                              }
                            : prev
                        );
                      }}
                      className="rounded px-1.5 py-0.5 text-[9px] font-medium text-cream-muted bg-night-surface hover:text-status-amber border border-night-border min-h-[44px]"
                    >
                      Apply All 7 Days
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-medium text-cream-muted">
                      Bedtime (24h)
                    </label>
                    <input
                      type="time"
                      value={editWeeklySchedule[editSelectedDay]?.bedtime || '23:00'}
                      onChange={(e) => {
                        const val = e.target.value;
                        setEditWeeklySchedule((prev) =>
                          prev
                            ? {
                                ...prev,
                                [editSelectedDay]: {
                                  ...prev[editSelectedDay],
                                  bedtime: val,
                                },
                              }
                            : prev
                        );
                      }}
                      className="mt-1 w-full rounded-lg border border-night-border bg-night-surface px-2.5 py-1.5 text-xs text-cream-primary focus:border-status-amber focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-cream-muted">
                      Wake Time (24h)
                    </label>
                    <input
                      type="time"
                      value={editWeeklySchedule[editSelectedDay]?.wake_time || '07:00'}
                      onChange={(e) => {
                        const val = e.target.value;
                        setEditWeeklySchedule((prev) =>
                          prev
                            ? {
                                ...prev,
                                [editSelectedDay]: {
                                  ...prev[editSelectedDay],
                                  wake_time: val,
                                },
                              }
                            : prev
                        );
                      }}
                      className="mt-1 w-full rounded-lg border border-night-border bg-night-surface px-2.5 py-1.5 text-xs text-cream-primary focus:border-status-amber focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* 7-Day Compact Summary Preview */}
            <div className="rounded-lg border border-night-border/50 bg-night-bg/60 p-2 text-[10px] text-cream-muted">
              <span className="font-semibold text-cream-secondary block mb-1">
                7-Day Routine Summary:
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 tabular-nums">
                {DAY_KEYS.map((k) => (
                  <span key={`preview-${k}`} className="truncate">
                    <strong className="text-cream-primary">{DAY_LABELS[k].short}:</strong>{' '}
                    {editWeeklySchedule?.[k]?.bedtime || '--'} -{' '}
                    {editWeeklySchedule?.[k]?.wake_time || '--'}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        <div>
          <label className="text-[11px] font-semibold text-cream-muted">
            Timezone (GMT Offset)
          </label>
          <TimezoneSelect
            value={editTimezone}
            onChange={setEditTimezone}
            selectClassName="mt-1 w-full rounded-xl border border-night-border bg-night-bg px-3 py-2 text-sm text-cream-primary focus:border-status-amber focus:outline-none"
          />
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

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={() => { setEditingMember(null); focusControl(`edit-schedule-${activeEditor.id}`); }}
            className="min-h-[44px] rounded-xl border border-night-border bg-night-bg px-4 py-2 text-xs font-semibold text-cream-secondary hover:text-cream-primary whitespace-nowrap transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={Boolean(actionLoadingId)}
            className="min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl bg-status-amber px-4 py-2 text-xs font-bold text-night-bg hover:opacity-95 disabled:opacity-50 whitespace-nowrap shadow-sm transition-opacity"
          >
            {actionLoadingId === 'save-edit' ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <Zap className="h-3.5 w-3.5 fill-current" />
                <span>Save & Apply Immediately</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );

  return (
    <ResponsiveDialog labelledBy="mod-panel-title" onClose={onClose}
      className="!overflow-hidden bottom-[var(--mod-viewport-bottom,0px)] md:max-w-3xl xl:max-w-5xl">
      <div className="flex h-[min(92dvh,var(--mod-viewport-height,92dvh))] min-h-0 flex-col md:h-[min(50rem,90dvh)]">
        <header className="shrink-0 border-b border-night-border px-3 pb-2 pt-2 sm:px-5">
          <div className="mx-auto mb-1 h-1.5 w-12 rounded-full bg-night-border md:hidden" aria-hidden="true" />
          <div className="flex flex-wrap items-center justify-between gap-x-2">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="shrink-0"><FoxMascot state="logo" size={28} /></span>
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <h2 id="mod-panel-title" className="text-base font-bold sm:text-lg">Mod Panel</h2>
                <span className="text-xs font-semibold text-status-coral">{isOwner ? 'Owner' : 'Moderator'}</span>
              </div>
            </div>
            <div className="flex items-center">
              {isOwner && (
                <button type="button" aria-pressed={activeTab === 'webhook'} onClick={() => {
                  changeTab('webhook');
                  void fetchWebhookStatus();
                }} className="flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-status-amber hover:bg-night-elevated focus-visible:outline focus-visible:outline-status-amber aria-pressed:bg-night-elevated">
                  <Radio className="h-3.5 w-3.5" aria-hidden="true" /> Advanced
                </button>
              )}
              <button type="button" onClick={onClose} aria-label="Close moderator panel" autoFocus
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-cream-secondary hover:bg-night-elevated focus-visible:outline focus-visible:outline-status-amber">
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
          </div>
          <nav aria-label="Moderation views" className="mt-1 grid grid-cols-4 gap-0.5 rounded-lg bg-night-bg p-0.5 text-[10px] min-[360px]:text-[11px] sm:gap-1 sm:p-1 sm:text-sm">
            {moderationTabs.map(([tab, label]) => (
              <button type="button" key={tab} aria-pressed={activeTab === tab} onClick={() => changeTab(tab)}
                className="flex min-h-[44px] min-w-0 flex-wrap items-center justify-center gap-x-1 rounded-md px-0.5 font-semibold text-cream-secondary hover:text-cream-primary focus-visible:outline focus-visible:outline-status-amber aria-pressed:bg-status-amber aria-pressed:text-night-bg">
                {label}
                {tab === 'pending' && pendingMembers.length > 0 && (
                  <span className="rounded-full bg-night-surface px-1.5 py-0.5 text-[10px] text-status-amber">{pendingMembers.length}</span>
                )}
              </button>
            ))}
          </nav>
        </header>

        {(rosterStatus === 'error' || rosterRefreshFailed || errorMessage || successMessage) && (
          <div className="shrink-0 space-y-1 border-b border-night-border px-3 py-1.5 sm:px-5">
            {(rosterStatus === 'error' || rosterRefreshFailed) && (
              <div className="flex flex-wrap items-center gap-x-2 text-sm text-status-coral">
                <p role="alert">{rosterRefreshFailed ? 'Could not refresh the roster. The balances shown may be out of date.' : 'Could not load the moderation roster.'}</p>
                <button type="button" onClick={() => void refreshRoster()} disabled={loadingMembers}
                  className={secondaryButton}>Retry roster refresh</button>
              </div>
            )}
            {errorMessage && <p role="alert" className="break-words text-sm text-status-coral">{errorMessage}</p>}
            {successMessage && <p role="status" className="break-words text-sm text-status-sage">{successMessage}</p>}
          </div>
        )}

        <div ref={contentPane}
          className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-5 md:pb-4 ${activeTab === 'roster' ? 'xl:overflow-hidden' : ''}`}>
          {activeTab === 'punishments' && (
            <section aria-labelledby="mod-punishments-heading" className="space-y-3">
              <h3 id="mod-punishments-heading" className="text-base font-bold">Punishment queue</h3>
              <ModeratorPunishmentQueue onTaskChanged={onRosterChanged} onAccessChanged={handleDrawerAccessChanged} />
            </section>
          )}
          {activeTab === 'metastrikes' && (
            <section aria-labelledby="mod-metastrikes-heading" className="space-y-3">
              <h3 id="mod-metastrikes-heading" className="text-base font-bold">Metastrike queue</h3>
              <ModeratorMetastrikeQueue key={actorId} onReviewed={() => void onMetastrikeReviewed()} onAccessChanged={handleDrawerAccessChanged} />
            </section>
          )}
          {activeTab === 'pending' && (
            <section aria-labelledby="mod-approvals-heading" className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id="mod-approvals-heading" className="text-base font-bold">Schedule approvals</h3>
                <button type="button" onClick={() => void refreshRoster()} disabled={loadingMembers || Boolean(actionLoadingId)}
                  className={secondaryButton}>
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Refresh
                </button>
              </div>
              {loadingMembers && rosterStatus === 'loading' && <p role="status" className={queueNotice}>Loading schedule approvals…</p>}
              {rosterStatus === 'ready' && pendingMembers.length === 0 && (
                <div className={queueNotice + ' flex items-center gap-3'}>
                  <FoxMascot state="sleeping" size={36} />
                  <p>No pending schedule changes.</p>
                </div>
              )}
              <ul className="space-y-3">
                {pendingMembers.map(member => {
                  const effectiveAt = DateTime.fromISO(member.pending_effective_at!, { zone: 'utc' });
                  return (
                    <li key={member.id} className="space-y-3 rounded-xl border border-night-border bg-night-elevated p-3 sm:p-4">
                      <div className="flex items-center gap-3">
                        <RosterAvatar member={member} />
                        <h4 className="min-w-0 break-words font-semibold">{member.discord_username}</h4>
                      </div>
                      <ModeratorScheduleComparison member={member} />
                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-night-border pt-2">
                        {effectiveAt.isValid && (
                          <p className="min-w-0 text-sm text-cream-secondary">
                            Takes effect <time dateTime={member.pending_effective_at!}>
                              {effectiveAt.setZone(toValidLuxonZone(viewerTimezone)).toFormat('d LLL, t')}
                            </time> <span className="break-words">({viewerTimezone})</span>
                          </p>
                        )}
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => void handleCancelCooldown(member)}
                            disabled={Boolean(actionLoadingId) || rosterRefreshFailed} className={secondaryButton + ' hover:text-status-coral'}>
                            {actionLoadingId === `cancel-${member.id}` ? 'Rejecting…' : 'Reject'}
                          </button>
                          <button type="button" onClick={() => void handleApproveCooldown(member)}
                            disabled={Boolean(actionLoadingId) || rosterRefreshFailed} className={primaryButton}>
                            {actionLoadingId === `approve-${member.id}` ? 'Approving…' : 'Approve Now'}
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {activeTab === 'roster' && (
            <div className="min-w-0 xl:grid xl:h-full xl:grid-cols-[18rem_minmax(0,1fr)] xl:divide-x xl:divide-night-border">
              <section aria-labelledby="mod-roster-heading"
                className={`${selectedMember ? 'hidden xl:block' : ''} min-w-0 space-y-3 xl:overflow-y-auto xl:overscroll-contain xl:pr-4`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 id="mod-roster-heading" className="text-base font-bold">Roster</h3>
                  <button type="button" onClick={() => void refreshRoster()} disabled={loadingMembers || Boolean(actionLoadingId)}
                    className={secondaryButton}>Refresh roster</button>
                </div>
                {isOwner && hasDemoMembers && (
                  <div className="flex flex-wrap items-center gap-2 rounded-xl border border-night-border p-3 text-sm">
                    <p className="text-cream-secondary">Demo profiles are still on the roster.</p>
                    <button type="button" onClick={() => void handlePurgeDemoMembers()}
                      disabled={Boolean(actionLoadingId)} className={secondaryButton}>
                      {actionLoadingId === 'purge_demo' ? 'Purging…' : 'Purge Demo Profiles'}
                    </button>
                  </div>
                )}
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-cream-secondary" aria-hidden="true" />
                  <input type="search" ref={searchInput} value={searchQuery} onChange={event => setSearchQuery(event.target.value)}
                    aria-label="Search roster" placeholder="Name, handle, or timezone"
                    className="min-h-[44px] w-full rounded-lg border border-night-border bg-night-bg py-2 pl-9 pr-3 text-base placeholder:text-cream-muted focus-visible:outline focus-visible:outline-status-amber" />
                </div>
                {loadingMembers && rosterStatus === 'loading' && <p role="status" className={queueNotice}>Loading members…</p>}
                {rosterStatus === 'ready' && filteredRoster.length === 0 && (
                  <p className={queueNotice}>{searchQuery.trim() ? 'No members matched your search.' : 'No members on the roster.'}</p>
                )}
                <ul className="divide-y divide-night-border">
                  {filteredRoster.map(member => (
                    <li key={member.id}>
                      <button type="button" id={`mod-roster-member-${member.id}`} aria-controls={selectedMember?.id === member.id ? 'mod-member-detail' : undefined}
                        aria-current={selectedMember?.id === member.id ? 'true' : undefined}
                        onClick={event => openMember(member, event.currentTarget)}
                        className="flex min-h-[60px] w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-night-elevated focus-visible:outline focus-visible:outline-status-amber aria-[current=true]:bg-night-elevated">
                        <RosterAvatar member={member} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold" title={member.discord_username}>{member.discord_username}</span>
                          <span className="flex flex-wrap gap-x-2 text-xs text-cream-secondary">
                            <span>{memberRoleLabel(member)}{!member.is_active && ' · Inactive'}</span>
                            {member.can_review_strikes && !member.strike_counts_unavailable && (
                              <span className="tabular-nums">{strikeTotal(member)} {strikeTotal(member) === 1 ? 'strike' : 'strikes'}</span>
                            )}
                          </span>
                        </span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-cream-secondary" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>

              {selectedMember ? (
                <section id="mod-member-detail" aria-labelledby="mod-member-heading" ref={detailPane}
                  className="min-w-0 space-y-4 xl:overflow-y-auto xl:overscroll-contain xl:pl-5">
                  <button type="button" className={secondaryButton + ' xl:hidden'} onClick={backToRoster}>
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to roster
                  </button>
                  <div className="flex items-center gap-3">
                    <RosterAvatar member={selectedMember} />
                    <div className="min-w-0">
                      <h3 id="mod-member-heading" tabIndex={-1} className="break-words text-lg font-bold focus-visible:outline-status-amber">
                        {selectedMember.discord_username}
                      </h3>
                      <p className="text-sm text-cream-secondary">
                        {memberRoleLabel(selectedMember)} · {selectedMember.is_active ? 'Active' : 'Inactive'}
                      </p>
                    </div>
                  </div>
                  {activeEditor ? scheduleEditor : strikeReviewMember && !rosterRefreshFailed ? (
                    <ModeratorStrikeReview key={`${actorRole}-${strikeReviewMember.id}-${strikeReviewMember.role}`}
                      memberId={strikeReviewMember.id} memberName={strikeReviewMember.discord_username}
                      onAccessChanged={handleDrawerAccessChanged}
                      onClose={() => {
                        setStrikeReviewMemberId(null);
                        focusControl(`review-strikes-${strikeReviewMember.id}`);
                      }}
                      onChanged={() => { void fetchModRoster(true); void onRosterChanged(); }}
                    />
                  ) : renderMemberTools(selectedMember)}
                </section>
              ) : (
                <p className="hidden px-5 py-4 text-sm text-cream-secondary xl:block">Select a member to review their schedule and account.</p>
              )}
            </div>
          )}
          {isOwner && activeTab === 'webhook' && (
            <div className="space-y-4">
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
                    className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-status-amber px-3.5 text-xs font-bold text-night-bg transition-opacity hover:opacity-90 disabled:opacity-50 whitespace-nowrap shadow-sm"
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
                    className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-status-sage/40 bg-status-sage/15 px-3.5 text-xs font-bold text-status-sage transition-colors hover:bg-status-sage/25 disabled:opacity-50 whitespace-nowrap shadow-sm"
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
      </div>
    </ResponsiveDialog>
  );
}
