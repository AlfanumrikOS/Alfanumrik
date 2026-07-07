'use client';

/**
 * /teacher/lab-leaderboard — Class Lab Activity (Tier 3 R11).
 *
 * Heatmap-like view of which students in this teacher's classes have engaged
 * with STEM Lab simulations, with a weekly Top-3 podium and per-student
 * badge counts.
 *
 * Data: GET /api/teacher/lab-leaderboard
 *   - Auth gate is class.manage (P9)
 *   - Privacy: students.name → "Riya M." server-side (P13)
 *
 * UI states (all three required by the spec):
 *   - Loading: skeleton table with 5 pulsing rows
 *   - Empty:   "no students linked yet" + link to Class Setup
 *   - Error:   red bordered card with retry button
 *
 * Responsive (USER MANDATE):
 *   - <640px : stats stack vertically; podium = 3 stacked cards (gold first);
 *              students rendered as a card list (NO table)
 *   - ≥640px : stats in row; podium horizontal; table appears (3 cols)
 *   - ≥768px : all table columns visible
 *   - ≥1024px: wider container, more padding
 *
 * Bilingual via useAuth().isHi (P7).
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { authHeader } from '@alfanumrik/lib/api/auth-header';

// ─── Bilingual helper (P7) ────────────────────────────────────────
const tt = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

// ─── Types (mirror the API response shape) ────────────────────────
interface LeaderboardRow {
  student_id: string;
  full_name: string;
  grade: string;
  lab_streak: number;
  total_experiments: number;
  total_guided: number;
  avg_viva_pct: number | null;
  gold: number;
  silver: number;
  bronze: number;
}
interface WeeklyRow extends LeaderboardRow {
  week_experiments: number;
}
interface ClassTotals {
  students: number;
  active_this_week: number;
  total_experiments_this_week: number;
}
interface ApiResponse {
  success: boolean;
  students?: LeaderboardRow[];
  weekly_top_3?: WeeklyRow[];
  class_totals?: ClassTotals;
  error?: string;
}

type SortKey =
  | 'full_name'
  | 'lab_streak'
  | 'total_experiments'
  | 'avg_viva_pct'
  | 'badges';
type SortDir = 'asc' | 'desc';

// ─── Sort utility (badges = weighted gold*3 + silver*2 + bronze) ──
function badgeScore(r: LeaderboardRow): number {
  return r.gold * 3 + r.silver * 2 + r.bronze;
}
function sortRows(
  rows: LeaderboardRow[],
  key: SortKey,
  dir: SortDir,
): LeaderboardRow[] {
  const mul = dir === 'asc' ? 1 : -1;
  const sorted = [...rows].sort((a, b) => {
    let av: number | string;
    let bv: number | string;
    switch (key) {
      case 'full_name':
        av = a.full_name.toLowerCase();
        bv = b.full_name.toLowerCase();
        if (av < bv) return -1 * mul;
        if (av > bv) return 1 * mul;
        return 0;
      case 'lab_streak':
        av = a.lab_streak;
        bv = b.lab_streak;
        break;
      case 'total_experiments':
        av = a.total_experiments;
        bv = b.total_experiments;
        break;
      case 'avg_viva_pct':
        // Nulls sort to the end regardless of direction.
        if (a.avg_viva_pct == null && b.avg_viva_pct == null) return 0;
        if (a.avg_viva_pct == null) return 1;
        if (b.avg_viva_pct == null) return -1;
        av = a.avg_viva_pct;
        bv = b.avg_viva_pct;
        break;
      case 'badges':
        av = badgeScore(a);
        bv = badgeScore(b);
        break;
    }
    return ((av as number) - (bv as number)) * mul;
  });
  return sorted;
}

// ─── Skeleton row (loading) ───────────────────────────────────────
function SkeletonRow({ idx }: { idx: number }) {
  return (
    <div
      className="flex items-center gap-3 py-3 px-3 border-b border-on-inverse-muted animate-pulse"
      style={{ animationDelay: `${idx * 80}ms` }}
    >
      <div className="h-4 bg-surface-inverse rounded w-1/3" />
      <div className="h-4 bg-surface-inverse rounded w-12 ml-auto" />
      <div className="h-4 bg-surface-inverse rounded w-16" />
      <div className="h-4 bg-surface-inverse rounded w-12" />
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────
export default function LabLeaderboardPage() {
  const { isHi, isLoggedIn, isLoading: authLoading } = useAuth();

  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('total_experiments');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/teacher/lab-leaderboard', {
        method: 'GET',
        credentials: 'include',
        headers: { ...(await authHeader()) },
      });
      const json = (await res.json()) as ApiResponse;
      if (!res.ok || !json.success) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setData(json);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && isLoggedIn) load();
  }, [authLoading, isLoggedIn, load]);

  const filteredSorted = useMemo(() => {
    const rows = data?.students ?? [];
    const filtered = search.trim()
      ? rows.filter((r) =>
          r.full_name.toLowerCase().includes(search.trim().toLowerCase()),
        )
      : rows;
    return sortRows(filtered, sortKey, sortDir);
  }, [data?.students, search, sortKey, sortDir]);

  const totals = data?.class_totals ?? {
    students: 0,
    active_this_week: 0,
    total_experiments_this_week: 0,
  };
  const podium = data?.weekly_top_3 ?? [];

  // Sort header click handler
  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'full_name' ? 'asc' : 'desc');
    }
  };

  const sortIndicator = (key: SortKey) => {
    if (key !== sortKey) return ' ↕';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  };

  // ─── Render ──────────────────────────────────────────────────────
  return (
    <div
      className="min-h-dvh font-['Plus_Jakarta_Sans','Sora',system-ui,sans-serif]"
      style={{ background: 'var(--bg)', color: 'var(--text-1)' }}
    >
      <div className="max-w-[1100px] mx-auto px-4 sm:px-5 lg:px-8 py-5 lg:py-8 pb-24">
        {/* Header */}
        <header className="mb-5 sm:mb-6 pb-4 border-b border-on-inverse-muted">
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-on-inverse m-0">
            🔬 {tt(isHi, 'Class Lab Activity', 'कक्षा की लैब गतिविधि')}
          </h1>
          <p className="text-xs sm:text-sm text-on-inverse-muted mt-1">
            {tt(
              isHi,
              'Track which simulations your students have tried and who is on a streak this week.',
              'देखें कि आपके छात्रों ने कौन सी सिमुलेशन आज़माई हैं और इस सप्ताह कौन स्ट्रीक पर है।',
            )}
          </p>
        </header>

        {/* ─── Error state ─── */}
        {errorMsg && !loading && (
          <div className="bg-surface-inverse border border-danger rounded-xl p-4 sm:p-5 mb-4">
            <p className="text-sm text-danger font-semibold m-0">
              {tt(isHi, 'Could not load leaderboard', 'लीडरबोर्ड लोड नहीं हो सका')}
            </p>
            <p className="text-xs text-on-inverse-muted mt-1 mb-3 break-words">{errorMsg}</p>
            <button
              onClick={load}
              className="min-h-[44px] py-2 px-4 bg-primary text-on-accent rounded-lg text-sm font-semibold cursor-pointer hover:bg-primary transition-colors"
            >
              {tt(isHi, 'Retry', 'पुनः प्रयास करें')}
            </button>
          </div>
        )}

        {/* ─── Top stats — stack on mobile, row from sm: ─── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
          {[
            {
              label: tt(isHi, 'Total Students', 'कुल छात्र'),
              value: totals.students,
              accent: 'text-brand-purple',
            },
            {
              label: tt(isHi, 'Active This Week', 'इस सप्ताह सक्रिय'),
              value: totals.active_this_week,
              accent: 'text-success',
            },
            {
              label: tt(isHi, 'Experiments This Week', 'इस सप्ताह प्रयोग'),
              value: totals.total_experiments_this_week,
              accent: 'text-primary',
            },
          ].map((s, i) => (
            <div
              key={i}
              className="bg-surface-inverse border border-on-inverse-muted rounded-xl py-3 sm:py-4 px-4"
            >
              <p className="text-[12px] sm:text-[12px] text-on-inverse-muted uppercase tracking-wide m-0">
                {s.label}
              </p>
              <p className={`${s.accent} text-2xl sm:text-3xl font-bold mt-1 m-0`}>
                {loading ? '—' : s.value}
              </p>
            </div>
          ))}
        </div>

        {/* ─── Weekly Top 3 podium ─── */}
        <section className="mb-5">
          <h2 className="text-sm sm:text-base font-semibold text-on-inverse mb-3 m-0">
            {tt(isHi, 'Weekly Top 3', 'सप्ताह के टॉप 3')}
          </h2>
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-[88px] bg-surface-inverse border border-on-inverse-muted rounded-xl animate-pulse"
                  style={{ animationDelay: `${i * 80}ms` }}
                />
              ))}
            </div>
          ) : podium.length === 0 ? (
            <div className="bg-surface-inverse border border-on-inverse-muted rounded-xl p-4 text-center text-on-inverse-muted text-sm italic">
              {tt(
                isHi,
                'No experiments completed in the past 7 days.',
                'पिछले 7 दिनों में कोई प्रयोग पूरा नहीं हुआ।',
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {podium.map((s, i) => {
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉';
                const accentColor =
                  i === 0
                    ? 'color-mix(in srgb, var(--warning) 50%, transparent)'
                    : i === 1
                      ? 'color-mix(in srgb, var(--on-inverse-muted) 50%, transparent)'
                      : 'color-mix(in srgb, var(--primary) 50%, transparent)';
                return (
                  <div
                    key={s.student_id}
                    className="bg-surface-inverse border rounded-xl p-4 flex items-center gap-3"
                    style={{ borderColor: accentColor }}
                  >
                    <span className="text-3xl shrink-0" aria-hidden="true">
                      {medal}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm sm:text-base font-semibold text-on-inverse m-0 truncate">
                        {s.full_name}
                      </p>
                      <p className="text-xs text-on-inverse-muted m-0 mt-0.5">
                        {tt(isHi, 'Grade', 'कक्षा')} {s.grade}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-lg sm:text-xl font-bold text-primary m-0">
                        {s.week_experiments}
                      </p>
                      <p className="text-[12px] text-on-inverse-muted m-0 uppercase tracking-wide">
                        {tt(isHi, 'this wk', 'इस सप्ताह')}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ─── Search box ─── */}
        <div className="mb-3">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tt(isHi, 'Search by name…', 'नाम से खोजें…')}
            className="w-full min-h-[44px] py-2.5 px-4 bg-surface-inverse border border-on-inverse-muted rounded-lg text-sm text-on-inverse placeholder:text-on-inverse-muted outline-none focus:border-brand-purple transition-colors"
            aria-label={tt(isHi, 'Search students', 'छात्र खोजें')}
          />
        </div>

        {/* ─── Loading skeleton ─── */}
        {loading && !errorMsg && (
          <div className="bg-surface-inverse border border-on-inverse-muted rounded-xl overflow-hidden">
            {[0, 1, 2, 3, 4].map((i) => (
              <SkeletonRow key={i} idx={i} />
            ))}
          </div>
        )}

        {/* ─── Empty state (no students linked) ─── */}
        {!loading &&
          !errorMsg &&
          (data?.students?.length ?? 0) === 0 &&
          totals.students === 0 && (
            <div className="bg-surface-inverse border border-on-inverse-muted rounded-xl p-6 sm:p-8 text-center">
              <div className="text-5xl mb-3" aria-hidden="true">
                🏫
              </div>
              <h3 className="text-base sm:text-lg font-semibold text-on-inverse m-0 mb-2">
                {tt(
                  isHi,
                  'No students linked to your class yet',
                  'अभी तक कोई छात्र आपकी कक्षा से नहीं जुड़ा है',
                )}
              </h3>
              <p className="text-sm text-on-inverse-muted m-0 mb-4 max-w-[420px] mx-auto">
                {tt(
                  isHi,
                  'Visit Class Setup to add students. Once they start labs, their activity will appear here.',
                  'छात्रों को जोड़ने के लिए कक्षा सेटअप पर जाएं। जब वे लैब शुरू करेंगे, उनकी गतिविधि यहां दिखेगी।',
                )}
              </p>
              <Link
                href="/teacher/classes"
                className="inline-block min-h-[44px] py-2.5 px-5 bg-brand-purple text-on-accent rounded-lg text-sm font-semibold hover:bg-brand-purple transition-colors"
              >
                {tt(isHi, 'Go to Class Setup', 'कक्षा सेटअप पर जाएं')}
              </Link>
            </div>
          )}

        {/* ─── Empty state (search returned nothing) ─── */}
        {!loading &&
          !errorMsg &&
          (data?.students?.length ?? 0) > 0 &&
          filteredSorted.length === 0 && (
            <div className="bg-surface-inverse border border-on-inverse-muted rounded-xl p-5 text-center text-sm text-on-inverse-muted italic">
              {tt(isHi, 'No students match your search.', 'आपकी खोज से कोई छात्र मेल नहीं खाता।')}
            </div>
          )}

        {/* ─── Mobile: card list (<640px) ─── */}
        {!loading && !errorMsg && filteredSorted.length > 0 && (
          <div className="sm:hidden flex flex-col gap-2">
            {filteredSorted.map((r) => (
              <div
                key={r.student_id}
                className="bg-surface-inverse border border-on-inverse-muted rounded-xl p-3"
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-on-inverse m-0 truncate">
                      {r.full_name}
                    </p>
                    <p className="text-[12px] text-on-inverse-muted m-0 mt-0.5">
                      {tt(isHi, 'Grade', 'कक्षा')} {r.grade}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-base font-bold text-brand-purple m-0">
                      {r.total_experiments}
                    </p>
                    <p className="text-[12px] text-on-inverse-muted m-0 uppercase tracking-wide">
                      {tt(isHi, 'labs', 'लैब')}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-primary font-medium">
                    🔥 {r.lab_streak} {tt(isHi, 'd', 'दि')}
                  </span>
                  <span className="text-on-inverse-muted">
                    {tt(isHi, 'Viva', 'वाइवा')}:{' '}
                    {r.avg_viva_pct == null ? '—' : `${r.avg_viva_pct}%`}
                  </span>
                  <span className="text-on-inverse font-medium">
                    🥇{r.gold} 🥈{r.silver} 🥉{r.bronze}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ─── ≥sm: table (with sticky header) ─── */}
        {!loading && !errorMsg && filteredSorted.length > 0 && (
          <div className="hidden sm:block bg-surface-inverse border border-on-inverse-muted rounded-xl overflow-hidden">
            <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
              <table className="w-full text-sm border-collapse">
                <thead
                  className="sticky top-0 backdrop-blur z-10"
                  style={{
                    background:
                      'color-mix(in srgb, var(--surface-inverse) 95%, transparent)',
                  }}
                >
                  <tr>
                    <th
                      onClick={() => handleSort('full_name')}
                      className="text-left text-[12px] font-semibold text-on-inverse-muted uppercase tracking-wide px-3 py-2.5 cursor-pointer hover:text-brand-purple select-none min-h-[44px]"
                      scope="col"
                    >
                      {tt(isHi, 'Name', 'नाम')}
                      <span className="text-on-inverse-muted">{sortIndicator('full_name')}</span>
                    </th>
                    <th
                      onClick={() => handleSort('lab_streak')}
                      className="text-right text-[12px] font-semibold text-on-inverse-muted uppercase tracking-wide px-3 py-2.5 cursor-pointer hover:text-brand-purple select-none"
                      scope="col"
                    >
                      🔥 {tt(isHi, 'Streak', 'स्ट्रीक')}
                      <span className="text-on-inverse-muted">{sortIndicator('lab_streak')}</span>
                    </th>
                    <th
                      onClick={() => handleSort('total_experiments')}
                      className="text-right text-[12px] font-semibold text-on-inverse-muted uppercase tracking-wide px-3 py-2.5 cursor-pointer hover:text-brand-purple select-none"
                      scope="col"
                    >
                      {tt(isHi, 'Total Labs', 'कुल लैब')}
                      <span className="text-on-inverse-muted">
                        {sortIndicator('total_experiments')}
                      </span>
                    </th>
                    <th
                      onClick={() => handleSort('avg_viva_pct')}
                      className="hidden md:table-cell text-right text-[12px] font-semibold text-on-inverse-muted uppercase tracking-wide px-3 py-2.5 cursor-pointer hover:text-brand-purple select-none"
                      scope="col"
                    >
                      {tt(isHi, 'Avg Viva %', 'औसत वाइवा %')}
                      <span className="text-on-inverse-muted">
                        {sortIndicator('avg_viva_pct')}
                      </span>
                    </th>
                    <th
                      onClick={() => handleSort('badges')}
                      className="hidden md:table-cell text-right text-[12px] font-semibold text-on-inverse-muted uppercase tracking-wide px-3 py-2.5 cursor-pointer hover:text-brand-purple select-none"
                      scope="col"
                    >
                      {tt(isHi, 'Badges', 'बैज')}
                      <span className="text-on-inverse-muted">{sortIndicator('badges')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSorted.map((r, i) => (
                    <tr
                      key={r.student_id}
                      className={`${
                        i % 2 === 0
                          ? 'bg-surface-inverse'
                          : '[background-color:color-mix(in_srgb,var(--surface-inverse)_92%,var(--on-inverse)_8%)]'
                      } hover:[background-color:color-mix(in_srgb,var(--surface-inverse)_84%,var(--on-inverse)_12%)] transition-colors`}
                    >
                      <td className="px-3 py-3 text-on-inverse font-medium">
                        <div className="flex flex-col">
                          <span className="truncate max-w-[180px] md:max-w-none">
                            {r.full_name}
                          </span>
                          <span className="text-[12px] text-on-inverse-muted">
                            {tt(isHi, 'Grade', 'कक्षा')} {r.grade}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right text-primary font-semibold tabular-nums">
                        {r.lab_streak}
                      </td>
                      <td className="px-3 py-3 text-right text-on-inverse font-semibold tabular-nums">
                        {r.total_experiments}
                      </td>
                      <td className="hidden md:table-cell px-3 py-3 text-right text-on-inverse tabular-nums">
                        {r.avg_viva_pct == null ? '—' : `${r.avg_viva_pct}%`}
                      </td>
                      <td className="hidden md:table-cell px-3 py-3 text-right text-on-inverse font-medium whitespace-nowrap">
                        <span title={tt(isHi, 'Gold', 'गोल्ड')}>🥇{r.gold}</span>{' '}
                        <span title={tt(isHi, 'Silver', 'सिल्वर')}>🥈{r.silver}</span>{' '}
                        <span title={tt(isHi, 'Bronze', 'ब्रॉन्ज़')}>🥉{r.bronze}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Footer breadcrumb back to dashboard */}
        <div className="mt-6 text-center">
          <Link
            href="/teacher"
            className="text-xs text-on-inverse-muted hover:text-brand-purple transition-colors"
          >
            ← {tt(isHi, 'Back to Teacher Dashboard', 'शिक्षक डैशबोर्ड पर वापस')}
          </Link>
        </div>
      </div>
      
    </div>
  );
}
