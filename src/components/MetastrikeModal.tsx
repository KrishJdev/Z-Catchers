'use client';

import React, { useState } from 'react';
import { FoxMascot } from './FoxMascot';
import { Member } from '@/lib/db';
import { Shield, Sparkles, X, AlertTriangle, CheckCircle2 } from 'lucide-react';

interface MetastrikeModalProps {
  isOpen: boolean;
  onClose: () => void;
  member: Member;
  mode: 'proactive' | 'convert_retroactive';
  onSuccess: () => Promise<void>;
}

const PRESET_REASONS = [
  'Monthly Battle',
  'Family Event',
  'Birthday Celebration',
  'Travel / Flight',
  'Work / Study Deadline',
  'Health / Not Feeling Well',
];

/**
 * Modal dialog for activating a proactive excused pass or converting an eligible
 * recent strike to a retroactive Metastrike.
 *
 * @param props - Dialog state and action handlers
 * @returns Rendered Metastrike modal
 */
export function MetastrikeModal({
  isOpen,
  onClose,
  member,
  mode,
  onSuccess,
}: MetastrikeModalProps) {
  const [selectedReason, setSelectedReason] = useState<string>('Monthly Battle');
  const [customReason, setCustomReason] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const metastrikesUsed = member.metastrikes_used || 0;
  const remainingMetas = Math.max(0, 3 - metastrikesUsed);

  const effectiveReason = customReason.trim() || selectedReason;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/members/strikes/metastrike', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          member_id: member.id,
          action: mode === 'convert_retroactive' ? 'convert_retroactive' : 'proactive',
          sleep_cycle_date: mode === 'convert_retroactive' ? (member.convertible_strike_log?.sleep_cycle_date || member.tonight_strike_log?.sleep_cycle_date) : undefined,
          reason: effectiveReason,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to apply Metastrike.');
        setLoading(false);
        return;
      }

      await onSuccess();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-night-bg/80 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-md rounded-2xl border border-night-border bg-night-surface p-5 sm:p-6 shadow-2xl max-h-[90dvh] overflow-y-auto">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 p-1.5 text-cream-muted hover:text-cream-primary rounded-lg hover:bg-night-elevated transition-colors"
          title="Close"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Header with Sleepy Fox & Shield Icon */}
        <div className="flex items-center gap-3">
          <div className="rounded-xl border border-fox-amber/40 bg-fox-amber/15 p-2">
            <Shield className="h-6 w-6 text-fox-amber fill-fox-amber/20" />
          </div>
          <div>
            <h3 className="text-base font-bold text-cream-primary">
              {mode === 'convert_retroactive' ? 'Convert Strike to Metastrike' : 'Use Metastrike Tonight'}
            </h3>
            <p className="text-xs text-cream-secondary">
              Excused pass for unexpected or important community events
            </p>
          </div>
        </div>

        {/* Counter Pill */}
        <div className="mt-4 flex items-center justify-between rounded-xl border border-fox-amber/30 bg-fox-amber/10 px-3.5 py-2 text-xs text-fox-amber font-semibold">
          <div className="flex items-center gap-1.5">
            <FoxMascot state="lantern" size={20} />
            <span>Passes Available This Month:</span>
          </div>
          <span className="tabular-nums font-bold text-sm">{remainingMetas} / 3 left</span>
        </div>

        {error && (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-status-coral/40 bg-status-coral/10 p-3 text-xs text-status-coral">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-cream-secondary mb-1.5">
              Select or customize your excuse reason:
            </label>
            <div className="grid grid-cols-2 gap-2">
              {PRESET_REASONS.map((preset) => (
                <button
                  type="button"
                  key={preset}
                  onClick={() => {
                    setSelectedReason(preset);
                    setCustomReason('');
                  }}
                  className={`rounded-lg border px-2.5 py-2 text-left text-xs font-medium transition-all ${
                    selectedReason === preset && !customReason
                      ? 'border-fox-amber bg-fox-amber/20 text-cream-primary'
                      : 'border-night-border bg-night-elevated text-cream-secondary hover:text-cream-primary hover:border-night-border/80'
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>

            <div className="mt-2.5">
              <input
                type="text"
                placeholder="Or type custom reason (e.g. Flight delay, Birthday)..."
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                maxLength={48}
                className="w-full rounded-xl border border-night-border bg-night-elevated px-3 py-2 text-xs text-cream-primary placeholder-cream-muted focus:border-fox-amber focus:outline-none"
              />
            </div>
          </div>

          <div className="rounded-xl border border-night-border bg-night-elevated/40 p-3 text-[11px] text-cream-muted leading-relaxed">
            {mode === 'convert_retroactive' ? (
              <p>
                🔄 <strong>24-Hour Swap Guarantee:</strong> This converts tonight&apos;s 2-vote strike into an excused Metastrike pass, reducing your strike count by 1 and using 1 of your 3 monthly Metastrikes.
              </p>
            ) : (
              <p>
                🛡️ <strong>Shield Guarantee:</strong> Activating this pass puts an excused badge on your profile for tonight, disabling community strike votes so you can attend your event stress-free.
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="rounded-xl border border-night-border px-4 py-2 text-xs font-semibold text-cream-secondary hover:text-cream-primary transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || remainingMetas <= 0}
              className="flex items-center gap-1.5 rounded-xl bg-fox-amber px-4 py-2 text-xs font-bold text-night-bg shadow hover:bg-fox-amber/90 disabled:opacity-50 transition-all active:scale-95"
            >
              {loading ? (
                <span>Applying Pass...</span>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>
                    {mode === 'convert_retroactive' ? 'Convert to Metastrike' : 'Protect Tonight'}
                  </span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
