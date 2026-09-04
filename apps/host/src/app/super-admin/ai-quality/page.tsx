/** @license Apache-2.0 */
/**
 * /super-admin/ai-quality — Phase A.3: consolidated AI quality signal dashboard.
 *
 * Surfaces the existing AI signal surfaces (nightly Sonnet judge scores,
 * ops_events AI sources, binary + dimension feedback, coach-mode distribution)
 * so super-admin can spot quality drift + feedback signal before students do.
 *
 * Fed by /api/super-admin/ai-quality (reads from foxy_quality_scores,
 * ops_events, foxy_message_feedback, foxy_message_dimension_feedback,
 * foxy_chat_messages). Standalone page — NOT merged into foxy-quality (which
 * covers the nightly judge only) because this dashboard's value is the
 * cross-signal comparison (judge vs feedback vs ops).
 *
 * P13: never renders message text, student identifiers, or reason text.
 */
'use client';

import { useState, useEffect, useCallback } from 'react';
import AdminShell, { useAdmin } from '../_components/AdminShell';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { StatCard, AdminErrorState } from '@alfanumrik/ui/admin-ui';
import { AdminDashboardSkeleton } from '@alfanumrik/ui/Skeleton';

// Hex literal palette (matches analytics page colors).
const C = {
  text1: '#111827',
  text2: '#6B7280',
  text3: '#9CA3AF',
  accent: '#7C3AED',    // violet — AI/quality accent
  success: '#16A34A',
  warning: '#D97706',
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

// ── Data shapes ──────────────────────────────────────────────────────────────

interface JudgeData {
  totalScored30d: number;
  avgOverall: number | null;
  avgAccuracy: number | null;
  avgScaffold: number | null;
  avgAge: number | null;
  avgScope: number | null;
  rubricVersions: Record<string, number>;
  judgeModels: Record<string, number>;
}

interface OpsData {
  totalAiEvents: number;
  bySource: Record<string, number>;
  byCategory: Record<string, number>;
}

interface FeedbackData {
  total30d: number;
  thumbsUp: number;
  thumbsDown: number;
  withReason: number;
  byDimension: Record<string, { up: number; down: number }>;
}

interface MessageData {
  total30d: number;
  coachModes: Record<string, number>;
  roles: Record<string, number>;
}

interface AiQualityData {
  judge: JudgeData;
  ops: OpsData;
  feedback: FeedbackData;
  messages: MessageData;
}

// ── Page ─────────────────────────────────────────────────────────────────────

function AiQualityDashboardInner() {
  const { apiFetch } = useAdmin();
  const { isHi } = useAuth();
  const [data, setData] = useState<AiQualityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/super-admin/ai-quality');
      if (!res.ok) {
        throw new Error(isHi
          ? 'AI गुणवत्ता डैशबोर्ड लोड नहीं हो सका'
          : 'AI quality dashboard could not be loaded');
      }
      const json = (await res.json()) as { success: boolean; data: AiQualityData; error?: string };
      if (!json.success) {
        throw new Error(json.error ?? 'API error');
      }
      setData(json.data);
      setLastUpdated(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [apiFetch, isHi]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  if (loading && !data) {
    return (
      <AdminDashboardSkeleton
        label={isHi ? 'AI गुणवत्ता डैशबोर्ड लोड हो रहा है…' : 'Loading AI quality dashboard…'}
      />
    );
  }

  const emptyData: AiQualityData = {
    judge: { totalScored30d: 0, avgOverall: null, avgAccuracy: null, avgScaffold: null, avgAge: null, avgScope: null, rubricVersions: {}, judgeModels: {} },
    ops: { totalAiEvents: 0, bySource: {}, byCategory: {} },
    feedback: { total30d: 0, thumbsUp: 0, thumbsDown: 0, withReason: 0, byDimension: {} },
    messages: { total30d: 0, coachModes: {}, roles: {} },
  };

  const { judge, ops, feedback, messages } = data ?? emptyData;

  const fmt = (n: number | null) => n === null ? '—' : n.toFixed(1);
  const pct = (up: number, down: number) => {
    const total = up + down;
    if (total === 0) return '—';
    return ((up / total) * 100).toFixed(0) + '%';
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            {isHi ? 'AI गुणवत्ता डैशबोर्ड' : 'AI Quality Dashboard'}
          </h1>
          <p className="m-0 text-[13px] text-muted-foreground">
            {isHi
              ? 'रात्रि जज़ स्कोर, फ़ीडबैक, ops_events AI स्रोत और कोच-मोड वितरण — पिछले 30 दिन'
              : 'Nightly judge scores, feedback, ops_events AI sources, and coach-mode distribution — last 30 days'}
          </p>
        </div>
        <button
          onClick={fetchAll}
          disabled={loading}
          className="rounded-md border border-surface-3 bg-surface-1 px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2 disabled:opacity-50"
        >
          {loading ? '⏳' : '↻ Refresh'}
        </button>
      </div>

      {/* Error state */}
      {error && (
        <AdminErrorState onRetry={fetchAll} message={error} isHi={isHi} />
      )}

      {/* Row 1: KPI Cards */}
      <div className="mb-6 grid grid-cols-4 gap-3">
        <StatCard
          label={isHi ? 'रात्रि जज़ (30 दिन)' : 'Nightly Judge (30d)'}
          value={judge.totalScored30d}
          icon="⭐"
          accentColor={C.accent}
        />
        <StatCard
          label={isHi ? 'औसत गुणवत्ता' : 'Avg Quality'}
          value={fmt(judge.avgOverall)}
          icon="📊"
          accentColor={C.success}
        />
        <StatCard
          label={isHi ? 'सकारात्मक फ़ीडबैक (👍)' : 'Positive Feedback (👍)'}
          value={feedback.thumbsUp}
          icon="👍"
          accentColor={C.success}
        />
        <StatCard
          label={isHi ? 'नकारात्मक फ़ीडबैक (👎)' : 'Negative Feedback (👎)'}
          value={feedback.thumbsDown}
          icon="👎"
          accentColor={C.warning}
        />
      </div>

      {/* Row 2: Judge Score Breakdown */}
      <div className="mb-6">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {isHi ? 'रात्रि जज़ गुणवत्ता विवरण (30 दिन)' : 'Nightly Judge Quality Breakdown (30d)'}
        </h2>
        <div className="overflow-x-auto rounded-lg border border-surface-3">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className="border-b-2 border-surface-3 bg-surface-2 px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {isHi ? 'आयाम' : 'Dimension'}
                </th>
                <th className="border-b-2 border-surface-3 bg-surface-2 px-3.5 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {isHi ? 'औसत स्कोर (0-100)' : 'Avg Score (0-100)'}
                </th>
                <th className="border-b-2 border-surface-3 bg-surface-2 px-3.5 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {isHi ? 'जज़ मॉडल' : 'Judge Model'}
                </th>
                <th className="border-b-2 border-surface-3 bg-surface-2 px-3.5 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {isHi ? 'रूबिक संस्करण' : 'Rubric Version'}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border-b border-surface-2 px-3.5 py-2.5 text-foreground">Overall</td>
                <td className="border-b border-surface-2 px-3.5 py-2.5 text-right font-semibold">{fmt(judge.avgOverall)}</td>
                <td className="border-b border-surface-2 px-3.5 py-2.5 text-right text-muted-foreground">
                  {Object.keys(judge.judgeModels).length > 0
                    ? Object.entries(judge.judgeModels).sort((a, b) => b[1] - a[1])[0][0]
                    : '—'}
                </td>
                <td className="border-b border-surface-2 px-3.5 py-2.5 text-right text-muted-foreground">
                  {Object.keys(judge.rubricVersions).length > 0
                    ? Object.entries(judge.rubricVersions).sort((a, b) => b[1] - a[1])[0][0]
                    : '—'}
                </td>
              </tr>
              <tr>
                <td className="border-b border-surface-2 px-3.5 py-2.5 text-foreground">Accuracy</td>
                <td className="border-b border-surface-2 px-3.5 py-2.5 text-right">{fmt(judge.avgAccuracy)}</td>
                <td className="border-b border-surface-2 px-3.5 py-2.5 text-right text-muted-foreground">—</td>
                <td className="border-b border-surface-2 px-3.5 py-2.5 text-right text-muted-foreground">—</td>
              </tr>
              <tr>
                <td className="border-b border-surface-2 px-3.5 py-2.5 text-foreground">Scaffold Fidelity</td>
                <td className="border-b border-surface-2 px-3.5 py-2.5 text-right">{fmt(judge.avgScaffold)}</td>
                <td className="border-b border-surface-2 px-3.5 py-2.5 text-right text-muted-foreground">—</td>
                <td className="border-b border-surface-2 px-3.5 py-2.5 text-right text-muted-foreground">—</td>
              </tr>
              <tr>
                <td className="border-b border-surface-2 px-3.5 py-2.5 text-foreground">Age Appropriateness</td>
                <td className="border-b border-surface-2 px-3.5 py-2.5 text-right">{fmt(judge.avgAge)}</td>
                <td className="border-b border-surface-2 px-3.5 py-2.5 text-right text-muted-foreground">—</td>
                <td className="border-b border-surface-2 px-3.5 py-2.5 text-right text-muted-foreground">—</td>
              </tr>
              <tr>
                <td className="border-b border-surface-2 px-3.5 py-2.5 text-foreground">CBSE Scope</td>
                <td className="border-b border-surface-2 px-3.5 py-2.5 text-right">{fmt(judge.avgScope)}</td>
                <td className="border-b border-surface-2 px-3.5 py-2.5 text-right text-muted-foreground">—</td>
                <td className="border-b border-surface-2 px-3.5 py-2.5 text-right text-muted-foreground">—</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Row 3: Feedback Summary */}
      <div className="mb-6">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {isHi ? 'छात्र फ़ीडबैक सारांश (30 दिन)' : 'Student Feedback Summary (30d)'}
        </h2>
        <div className="overflow-x-auto rounded-lg border border-surface-3">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className="border-b-2 border-surface-3 bg-surface-2 px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {isHi ? 'प्रकार' : 'Type'}
                </th>
                <th className="border-b-2 border-surface-3 bg-surface-2 px-3.5 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {isHi ? 'कुल' : 'Total'}
                </th>
                <th className="border-b-2 border-surface-3 bg-surface-2 px-3.5 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {isHi ? 'सकारात्मक अनुपात' : 'Positive Ratio'}
                </th>
                <th className="border-b-2 border-surface-3 bg-surface-2 px-3.5 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {isHi ? 'कारण के साथ' : 'With Reason'}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border-b border-surface-2 px-3.5 py-2.5 text-foreground">
                  {isHi ? 'बाइनरी फ़ीडबैक (👎/👍)' : 'Binary Feedback (👎/👍)'}
                </td>
                <td className="border-b border-surface-2 px-3.5 py-2.5 text-right font-semibold">{feedback.total30d}</td>
                <td className="border-b border-surface-2 px-3.5 py-2.5 text-right">{pct(feedback.thumbsUp, feedback.thumbsDown)}</td>
                <td className="border-b border-surface-2 px-3.5 py-2.5 text-right">{feedback.withReason}</td>
              </tr>
              {Object.keys(feedback.byDimension).length > 0 && (
                <>
                  <tr className="bg-surface-1">
                    <td colSpan={4} className="px-3.5 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {isHi ? 'आयाम फ़ीडबैक' : 'Dimension Feedback'}
                    </td>
                  </tr>
                  {Object.entries(feedback.byDimension)
                    .sort((a, b) => (b[1].up + b[1].down) - (a[1].up + a[1].down))
                    .map(([dim, counts]) => (
                      <tr key={dim}>
                        <td className="border-b border-surface-2 px-3.5 py-2.5 text-foreground capitalize">{dim}</td>
                        <td className="border-b border-surface-2 px-3.5 py-2.5 text-right font-semibold">
                          {counts.up + counts.down}
                        </td>
                        <td className="border-b border-surface-2 px-3.5 py-2.5 text-right">
                          {pct(counts.up, counts.down)}
                        </td>
                        <td className="border-b border-surface-2 px-3.5 py-2.5 text-right text-muted-foreground">
                          {isHi
                            ? 'आयाम फ़ीडबैक में कारण फ़ील्ड अभी तक नहीं है'
                            : 'Dimension feedback has no reason field yet'}
                        </td>
                      </tr>
                    ))}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Row 4: Ops Events + Coach Mode distribution */}
      <div className="grid grid-cols-2 gap-6 mb-6">
        {/* Ops Events card */}
        <div className="rounded-lg border border-surface-3 bg-surface-1 p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {isHi ? 'ops_events AI स्रोत' : 'ops_events AI Sources'}
          </h2>
          {ops.totalAiEvents === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              {isHi
                ? 'कोई AI ops_events नहीं। Foxy ट्रैफ़िक जब तक नहीं आता, यह खाली रहता है।'
                : 'No AI ops_events yet. Stays empty until Foxy traffic arrives.'}
            </p>
          ) : (
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className="border-b border-surface-2 bg-surface-2 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Source
                  </th>
                  <th className="border-b border-surface-2 bg-surface-2 px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Count
                  </th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(ops.bySource)
                  .sort((a, b) => b[1] - a[1])
                  .map(([src, count]) => (
                    <tr key={src}>
                      <td className="border-b border-surface-2 px-3 py-2 text-foreground">{src}</td>
                      <td className="border-b border-surface-2 px-3 py-2 text-right font-semibold">{count}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Coach Mode card */}
        <div className="rounded-lg border border-surface-3 bg-surface-1 p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {isHi ? 'कोच मोड वितरण (30 दिन)' : 'Coach Mode Distribution (30d)'}
          </h2>
          {messages.total30d === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              {isHi
                ? 'कोई Foxy सहायक संदेश नहीं।'
                : 'No Foxy assistant messages yet.'}
            </p>
          ) : (
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className="border-b border-surface-2 bg-surface-2 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Mode
                  </th>
                  <th className="border-b border-surface-2 bg-surface-2 px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Count
                  </th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(messages.coachModes)
                  .sort((a, b) => b[1] - a[1])
                  .map(([mode, count]) => (
                    <tr key={mode}>
                      <td className="border-b border-surface-2 px-3 py-2 text-foreground capitalize">
                        {mode ?? '—'}
                      </td>
                      <td className="border-b border-surface-2 px-3 py-2 text-right font-semibold">{count}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Row 5: Last updated */}
      <p className="text-[11px] text-muted-foreground">
        {isHi
          ? `अंतिम अपडेट: ${lastUpdated ? timeAgo(lastUpdated) : '—'}`
          : `Last updated: ${lastUpdated ? timeAgo(lastUpdated) : '—'}`}
      </p>
    </div>
  );
}

// Gate-2 D1 (2026-09-05): this page called useAdmin() but never rendered
// <AdminShell> itself, and the shared layout.tsx doesn't either — every
// other /super-admin page self-wraps (see adaptive-loops/page.tsx). Without
// this wrapper the page throws "useAdmin must be used within AdminShell" at
// runtime; that's why it was never linked from nav despite being complete,
// documented code.
export default function AiQualityDashboard() {
  return (
    <AdminShell>
      <AiQualityDashboardInner />
    </AdminShell>
  );
}
