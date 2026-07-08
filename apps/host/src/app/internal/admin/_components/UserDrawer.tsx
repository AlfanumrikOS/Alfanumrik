'use client';

/**
 * UserDrawer — internal-admin user detail drawer.
 *
 * Extracted from src/app/internal/admin/page.tsx as part of the Plan 5
 * decomposition (Task 5). Behaviour preserved verbatim:
 *
 *   - Fetches `/api/internal/admin/users/:id` on mount and whenever
 *     student.id or secret changes (recent_quizzes + top_mastery panels).
 *   - Action handlers (all PATCH `/api/internal/admin/users/:id`):
 *       • suspend         — when student.is_active === true
 *       • restore         — when student.is_active === false
 *       • reset_streak
 *       • reset_xp
 *       • upgrade_plan    — Entitlement Inspector ("Set basic/premium/free"),
 *                            keeps drawer open and refreshes detail inline
 *
 *   - Visual styling rewritten in Tailwind tokens; the outer chrome now uses
 *     the shared <DetailDrawer> primitive (Plan 0 admin-ui kit), and plan
 *     chips use <StatusBadge>. `useAdminFetch(secret)` is wired in for
 *     consistency with the rest of the refactor — the action handlers
 *     intentionally use raw `fetch()` so they can read the JSON body on
 *     non-2xx responses (the hook throws and discards the body).
 */

import { useState, useEffect, useCallback } from 'react';
import DetailDrawer from '@alfanumrik/ui/admin-ui/DetailDrawer';
import { StatusBadge, type StatusBadgeVariant } from '@alfanumrik/ui/admin-ui';
import { adminHeaders } from '@alfanumrik/lib/admin-session';
import { useAdminFetch } from '../_hooks/useAdminFetch';
import type { Student } from '../_lib/internal-admin-types';

export interface UserDrawerProps {
  student: Student | null;
  secret: string;
  onClose: () => void;
  onRefresh: () => void;
}

const planVariant = (plan: string): StatusBadgeVariant => {
  if (plan === 'premium') return 'warning';
  if (plan === 'basic') return 'info';
  return 'neutral';
};

export default function UserDrawer({
  student,
  secret,
  onClose,
  onRefresh,
}: UserDrawerProps) {
  const apiFetch = useAdminFetch(secret);

  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState('');
  const [actionMsg, setActionMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Entitlement Inspector state — initialised from current plan
  const [selectedPlan, setSelectedPlan] = useState(student?.subscription_plan || 'free');
  const [planLoading, setPlanLoading] = useState(false);
  const [planMsg, setPlanMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const studentId = student?.id ?? '';

  const fetchDetail = useCallback(() => {
    if (!studentId) return;
    setLoading(true);
    apiFetch<Record<string, unknown>>(`/api/internal/admin/users/${studentId}`)
      .then((data) => setDetail(data))
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [apiFetch, studentId]);

  useEffect(() => {
    if (!studentId) return;
    fetchDetail();
    // re-fetch when student.id or secret changes (matches inline behaviour)
  }, [studentId, secret, fetchDetail]);

  // Generic action (suspend/restore/reset_streak/reset_xp) — closes drawer, refreshes list
  const doAction = async (action: string, extras?: Record<string, unknown>) => {
    if (!studentId) return;
    setActionLoading(action);
    setActionMsg(null);
    try {
      const res = await fetch(`/api/internal/admin/users/${studentId}`, {
        method: 'PATCH',
        headers: adminHeaders(secret),
        body: JSON.stringify({ action, ...extras }),
      });
      const json = await res.json();
      if (!res.ok) {
        setActionMsg({ ok: false, text: json.error || 'Action failed' });
      } else {
        onRefresh();
        onClose();
      }
    } catch {
      setActionMsg({ ok: false, text: 'Network error' });
    }
    setActionLoading('');
  };

  // Entitlement override — keeps drawer open, refreshes detail inline
  const applyPlanOverride = async () => {
    if (!studentId) return;
    setPlanLoading(true);
    setPlanMsg(null);
    try {
      const res = await fetch(`/api/internal/admin/users/${studentId}`, {
        method: 'PATCH',
        headers: adminHeaders(secret),
        body: JSON.stringify({ action: 'upgrade_plan', plan: selectedPlan }),
      });
      const json = await res.json();
      if (!res.ok) {
        setPlanMsg({ ok: false, text: json.error || 'Override failed' });
      } else {
        setPlanMsg({ ok: true, text: `Plan set to "${selectedPlan}" — override applied` });
        onRefresh(); // refresh user list in background
        fetchDetail(); // reload drawer detail
      }
    } catch {
      setPlanMsg({ ok: false, text: 'Network error' });
    }
    setPlanLoading(false);
  };

  if (!student) return null;

  const currentPlan = student.subscription_plan || 'free';
  const recentQuizzes =
    (detail?.recent_quizzes as Array<Record<string, unknown>> | undefined) ?? [];
  const topMastery =
    (detail?.top_mastery as Array<Record<string, unknown>> | undefined) ?? [];

  return (
    <DetailDrawer
      open
      onClose={onClose}
      title={student.name || 'User'}
      width={520}
    >
      {/* Header — email + current plan chip */}
      <div className="mb-5">
        <div className="text-[11px] text-muted-foreground">{student.email}</div>
        <div className="mt-1.5">
          <StatusBadge variant={planVariant(currentPlan)} label={currentPlan.toUpperCase()} />
        </div>
      </div>

      {/* Quick Stats */}
      <div className="mb-4 grid grid-cols-2 gap-3.5">
        <div className="rounded-lg border border-surface-3 bg-surface-2 p-4">
          <div className="text-lg font-bold text-warning">{student.xp_total ?? 0}</div>
          <div className="text-[10px] text-muted-foreground">XP TOTAL</div>
        </div>
        <div className="rounded-lg border border-surface-3 bg-surface-2 p-4">
          <div className="text-lg font-bold text-primary">{student.streak_days ?? 0}</div>
          <div className="text-[10px] text-muted-foreground">STREAK DAYS</div>
        </div>
      </div>

      {/* Info */}
      <div className="mb-4 rounded-lg border border-surface-3 bg-surface-2 p-4">
        {[
          ['Grade', student.grade || '—'],
          ['Board', student.board || '—'],
          ['Status', student.is_active ? 'Active' : 'Suspended'],
          ['Joined', new Date(student.created_at).toLocaleDateString()],
          ['ID', student.id],
        ].map(([k, v]) => (
          <div
            key={k}
            className="flex items-center justify-between border-b border-surface-3 py-1.5 last:border-b-0"
          >
            <span className="text-[11px] text-muted-foreground">{k}</span>
            <span
              className={`text-[11px] font-semibold ${
                k === 'ID' ? 'font-mono text-muted-foreground' : 'text-foreground'
              }`}
            >
              {v}
            </span>
          </div>
        ))}
      </div>

      {/* ── Entitlement Inspector ── */}
      <div className="mb-4 rounded-lg border border-surface-3 border-t-2 border-t-warning bg-surface-2 p-4">
        <div className="mb-3 text-[11px] font-bold uppercase tracking-wider text-warning">
          Entitlement Inspector
        </div>

        <div className="mb-2.5 flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">Current Plan</span>
          <StatusBadge variant={planVariant(currentPlan)} label={currentPlan.toUpperCase()} />
        </div>

        <div className="mb-1.5 text-[11px] text-muted-foreground">Override Plan</div>
        <div className="flex items-center gap-2">
          <select
            aria-label="Override plan"
            value={selectedPlan}
            onChange={(e) => {
              setSelectedPlan(e.target.value);
              setPlanMsg(null);
            }}
            className="flex-1 rounded-md border border-surface-3 bg-surface-1 px-3 py-1.5 text-xs font-semibold text-foreground outline-none focus:ring-1 focus:ring-warning disabled:opacity-50"
            disabled={planLoading}
          >
            <option value="free">Free</option>
            <option value="basic">Basic</option>
            <option value="premium">Premium</option>
          </select>
          <button
            onClick={applyPlanOverride}
            disabled={planLoading || selectedPlan === currentPlan}
            className={`whitespace-nowrap rounded-md px-4 py-1.5 text-xs font-bold transition ${
              selectedPlan === currentPlan
                ? 'cursor-not-allowed bg-surface-3 text-muted-foreground'
                : 'cursor-pointer bg-[color-mix(in_srgb,var(--warning)_20%,transparent)] text-warning hover:bg-[color-mix(in_srgb,var(--warning)_30%,transparent)] border border-[color-mix(in_srgb,var(--warning)_40%,transparent)]'
            } ${planLoading ? 'cursor-not-allowed opacity-70' : ''}`}
          >
            {planLoading
              ? 'Applying…'
              : selectedPlan === currentPlan
              ? 'No change'
              : `Set ${selectedPlan}`}
          </button>
        </div>

        {planMsg && (
          <div
            role="status"
            className={`mt-2.5 rounded-md border px-3 py-2 text-[11px] font-semibold ${
              planMsg.ok
                ? 'border-[color-mix(in_srgb,var(--success)_30%,transparent)] bg-[color-mix(in_srgb,var(--success)_10%,transparent)] text-success'
                : 'border-[color-mix(in_srgb,var(--danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] text-danger'
            }`}
          >
            {planMsg.ok ? '✓ ' : '✗ '}
            {planMsg.text}
          </div>
        )}

        <div className="mt-2.5 text-[10px] text-muted-foreground">
          Override takes effect immediately. No payment required. Bypasses billing system.
        </div>
      </div>

      {/* Account Actions */}
      <div className="mb-2.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        Account Actions
      </div>
      {actionMsg && (
        <div
          role="status"
          className={`mb-2.5 rounded-md px-3 py-2 text-[11px] ${
            actionMsg.ok ? 'bg-[color-mix(in_srgb,var(--success)_10%,transparent)] text-success' : 'bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] text-danger'
          }`}
        >
          {actionMsg.text}
        </div>
      )}
      <div className="mb-5 flex flex-wrap gap-2">
        {student.is_active ? (
          <button
            onClick={() => doAction('suspend')}
            disabled={!!actionLoading}
            className="rounded-md border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] px-3 py-1.5 text-[11px] font-semibold text-danger hover:bg-[color-mix(in_srgb,var(--danger)_20%,transparent)] disabled:opacity-50"
          >
            {actionLoading === 'suspend' ? '...' : '⛔ Suspend'}
          </button>
        ) : (
          <button
            onClick={() => doAction('restore')}
            disabled={!!actionLoading}
            className="rounded-md border border-[color-mix(in_srgb,var(--success)_30%,transparent)] bg-[color-mix(in_srgb,var(--success)_10%,transparent)] px-3.5 py-1.5 text-xs font-semibold text-success hover:bg-[color-mix(in_srgb,var(--success)_20%,transparent)] disabled:opacity-50"
          >
            {actionLoading === 'restore' ? '...' : '✅ Restore'}
          </button>
        )}
        <button
          onClick={() => doAction('reset_streak')}
          disabled={!!actionLoading}
          className="rounded-md border border-[color-mix(in_srgb,var(--info)_30%,transparent)] bg-[color-mix(in_srgb,var(--info)_10%,transparent)] px-3.5 py-1.5 text-xs font-semibold text-info hover:bg-[color-mix(in_srgb,var(--info)_20%,transparent)] disabled:opacity-50"
        >
          {actionLoading === 'reset_streak' ? '...' : '🔄 Reset Streak'}
        </button>
        <button
          onClick={() => doAction('reset_xp')}
          disabled={!!actionLoading}
          className="rounded-md border border-purple-400/30 bg-purple-400/10 px-3.5 py-1.5 text-xs font-semibold text-purple-400 hover:bg-purple-400/20 disabled:opacity-50"
        >
          {actionLoading === 'reset_xp' ? '...' : '🎯 Reset XP'}
        </button>
      </div>

      {/* Recent activity */}
      {loading ? (
        <div className="text-[11px] text-muted-foreground">Loading activity…</div>
      ) : detail ? (
        <>
          <div className="mb-2.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Recent Quizzes
          </div>
          <div className="mb-3.5">
            {recentQuizzes.slice(0, 5).map((q, i) => (
              <div
                key={i}
                className="flex items-center justify-between border-b border-surface-3 py-1.5 text-[11px]"
              >
                <span className="text-muted-foreground">{q.subject as string}</span>
                <span className="font-semibold text-primary">
                  {(q.score_percent as number) ?? 0}%
                </span>
              </div>
            ))}
            {recentQuizzes.length === 0 && (
              <div className="text-[11px] text-muted-foreground">No quizzes yet</div>
            )}
          </div>

          <div className="mb-2.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Top Mastery
          </div>
          <div className="mb-3.5">
            {topMastery.slice(0, 5).map((m, i) => (
              <div
                key={i}
                className="flex items-center justify-between border-b border-surface-3 py-1.5 text-[11px]"
              >
                <span className="text-muted-foreground">{m.subject as string}</span>
                <span className="font-semibold text-success">
                  {Math.round((m.mastery_score as number) ?? 0)}%
                </span>
              </div>
            ))}
            {topMastery.length === 0 && (
              <div className="text-[11px] text-muted-foreground">No mastery data</div>
            )}
          </div>
        </>
      ) : null}
    </DetailDrawer>
  );
}
