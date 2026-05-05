'use client';

/**
 * STEM Lab Notebook (Tier 3 R13)
 * ──────────────────────────────────────────────────────────────────────────
 * Print-styled, CBSE-aligned practical journal for a single student.
 * Renders observations, data tables, conclusions, viva scores, and badges
 * across every experiment the student has completed. Used by:
 *   • Students  — print their own lab record for school submission.
 *   • Parents   — generate a hard copy for parent-teacher meetings.
 *   • Teachers  — view a student's compiled record (own enrolled students).
 *   • Admins    — view any student's record.
 *
 * Authorization is enforced entirely by RLS on `experiment_observations`,
 * `student_lab_streaks`, and `student_lab_badges` — we query with the user's
 * Supabase session (anon-key client). If RLS denies, the queries return zero
 * rows and we render a friendly "not authorized or no labs found" state
 * instead of a 5xx — per the task brief and P9.
 *
 * Privacy (P13): the notebook surfaces student name + grade + school name only.
 * No email, phone, or other PII. The document is FOR the student/parent so
 * showing their own name is acceptable; we never expose another user's PII.
 */

import { useEffect, useMemo, useState, use } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import { GUIDED_EXPERIMENTS, type ExperimentDefinition } from '@/components/stem/experiments';

// ─── Bilingual helper (P7) ────────────────────────────────────────────────
const t = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

// ─── Row shapes ────────────────────────────────────────────────────────────
interface ObservationRow {
  id: string;
  simulation_id: string;
  experiment_id: string | null;
  observation_type: 'simple' | 'guided' | string;
  observation_text: string | null;
  structured_observations: Record<string, string | number> | null;
  data_entries: Array<Record<string, string | number>> | null;
  conclusion: string | null;
  quiz_score: number | null;
  total_questions: number | null;
  time_spent_seconds: number | null;
  grade: string;
  subject: string;
  created_at: string;
}

interface StreakRow {
  current_streak: number;
  longest_streak: number;
  total_experiments: number;
  total_guided: number;
  total_viva_score: number;
  total_viva_max: number;
  total_time_seconds: number;
}

interface BadgeRow {
  id: string;
  subject: string;
  tier: 'bronze' | 'silver' | 'gold';
  earned_at: string;
  experiments_at_award: number;
}

interface StudentMeta {
  id: string;
  name: string;
  grade: string;
  school_name: string | null;
}

// ─── Built-in simulation labels (no full registry import — P10) ───────────
const SIM_LABELS: Record<string, { title: string; titleHi: string; emoji: string }> = {
  'builtin-ohms-law':       { title: "Ohm's Law Lab",        titleHi: 'ओम का नियम',           emoji: '⚡' },
  'builtin-pendulum':       { title: 'Pendulum Lab',          titleHi: 'पेंडुलम लैब',           emoji: '🕒' },
  'builtin-lens-ray':       { title: 'Lens Ray Diagrams',     titleHi: 'लेंस किरण',             emoji: '🔍' },
  'builtin-wave':           { title: 'Wave on a String',      titleHi: 'तरंग प्रयोग',           emoji: '〰️' },
  'builtin-projectile':     { title: 'Projectile Motion',     titleHi: 'प्रक्षेप्य गति',         emoji: '🎯' },
  'builtin-ph-scale':       { title: 'pH Scale Explorer',     titleHi: 'pH मापक',              emoji: '🧪' },
  'builtin-pythagoras':     { title: 'Pythagoras Theorem',    titleHi: 'पाइथागोरस प्रमेय',     emoji: '📐' },
  'builtin-fractions':      { title: 'Pizza Fraction Lab',    titleHi: 'भिन्न प्रयोग',          emoji: '🍕' },
  'builtin-newton-laws':    { title: "Newton's Laws Lab",     titleHi: 'न्यूटन के नियम',       emoji: '🍎' },
  'builtin-bohr':           { title: 'Bohr Atom Model',       titleHi: 'बोर परमाणु',            emoji: '⚛️' },
  'builtin-photosynthesis': { title: 'Photosynthesis Lab',    titleHi: 'प्रकाश संश्लेषण',       emoji: '🌱' },
  'builtin-heart':          { title: 'Human Heart Lab',       titleHi: 'मानव हृदय',            emoji: '❤️' },
  'builtin-circuit':        { title: 'Electric Circuit',      titleHi: 'विद्युत परिपथ',         emoji: '🔌' },
  'builtin-magnet':         { title: 'Magnet Field Lines',    titleHi: 'चुंबकीय क्षेत्र',       emoji: '🧲' },
  'builtin-light-reflect':  { title: 'Light Reflection',      titleHi: 'प्रकाश परावर्तन',      emoji: '💡' },
  'builtin-cell':           { title: 'Cell Structure',        titleHi: 'कोशिका संरचना',         emoji: '🧬' },
};

function prettifySimId(id: string): string {
  const stripped = id.replace(/^builtin-/, '').replace(/[-_]+/g, ' ').trim();
  if (!stripped) return id;
  return stripped.replace(/\b\w/g, c => c.toUpperCase());
}

function getSimLabel(id: string, isHi: boolean): { title: string; emoji: string } {
  const known = SIM_LABELS[id];
  if (known) return { title: isHi ? known.titleHi : known.title, emoji: known.emoji };
  return { title: prettifySimId(id), emoji: '🔬' };
}

// ─── Build an experiment-id lookup once (avoids O(n*m) on every render) ───
const EXPERIMENT_INDEX: Map<string, ExperimentDefinition> = new Map(
  GUIDED_EXPERIMENTS.map(e => [e.id, e]),
);
// Also index by simulationId so simple (non-guided) sessions can fall back
// to whatever guided definition shares the simulation when none is set.
const SIM_TO_EXPERIMENT: Map<string, ExperimentDefinition> = new Map(
  GUIDED_EXPERIMENTS.map(e => [e.simulationId, e]),
);

function getExperimentDef(row: ObservationRow): ExperimentDefinition | null {
  if (row.experiment_id && EXPERIMENT_INDEX.has(row.experiment_id)) {
    return EXPERIMENT_INDEX.get(row.experiment_id) ?? null;
  }
  if (row.observation_type === 'guided' && SIM_TO_EXPERIMENT.has(row.simulation_id)) {
    return SIM_TO_EXPERIMENT.get(row.simulation_id) ?? null;
  }
  return null;
}

// ─── Date / duration helpers ──────────────────────────────────────────────
function formatDate(iso: string, isHi: boolean): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(isHi ? 'hi-IN' : 'en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatDuration(seconds: number | null, isHi: boolean): string {
  const s = Math.max(0, seconds ?? 0);
  if (s < 60) return `${s} ${t(isHi, 'sec', 'सेकंड')}`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (rem === 0) return `${m} ${t(isHi, 'min', 'मिनट')}`;
  return `${m} ${t(isHi, 'min', 'मिनट')} ${rem} ${t(isHi, 'sec', 'सेकंड')}`;
}

const TIER_EMOJI: Record<BadgeRow['tier'], string> = {
  bronze: '🥉',
  silver: '🥈',
  gold:   '🥇',
};

// ─── Component ────────────────────────────────────────────────────────────
export default function LabNotebookPage({
  params,
}: {
  // Next.js 15+: params is a Promise that must be unwrapped via React.use()
  params: Promise<{ studentId: string }>;
}) {
  const { studentId } = use(params);
  const { isHi, isLoggedIn, isLoading: authLoading } = useAuth();

  const [student, setStudent] = useState<StudentMeta | null>(null);
  const [observations, setObservations] = useState<ObservationRow[]>([]);
  const [streak, setStreak] = useState<StreakRow | null>(null);
  const [badges, setBadges] = useState<BadgeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!isLoggedIn) {
      setLoading(false);
      setError('not_logged_in');
      return;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // Each query is gated by RLS using the caller's session. If the
        // caller can't see the student's rows, the query returns []/null
        // (or a permission-denied error which we treat as "no access").
        const [studentRes, obsRes, streakRes, badgeRes] = await Promise.all([
          supabase
            .from('students')
            .select('id, name, grade, school_name')
            .eq('id', studentId)
            .maybeSingle(),
          supabase
            .from('experiment_observations')
            .select('id, simulation_id, experiment_id, observation_type, observation_text, structured_observations, data_entries, conclusion, quiz_score, total_questions, time_spent_seconds, grade, subject, created_at')
            .eq('student_id', studentId)
            .order('created_at', { ascending: true }),
          supabase
            .from('student_lab_streaks')
            .select('current_streak, longest_streak, total_experiments, total_guided, total_viva_score, total_viva_max, total_time_seconds')
            .eq('student_id', studentId)
            .maybeSingle(),
          supabase
            .from('student_lab_badges')
            .select('id, subject, tier, earned_at, experiments_at_award')
            .eq('student_id', studentId)
            .order('earned_at', { ascending: true }),
        ]);

        if (cancelled) return;

        // Treat any RLS denial / not-found as "unauthorized or no labs".
        if (!studentRes.data && !obsRes.data?.length) {
          setError('no_access');
          setLoading(false);
          return;
        }

        setStudent((studentRes.data as StudentMeta | null) ?? null);
        setObservations((obsRes.data ?? []) as ObservationRow[]);
        setStreak((streakRes.data as StreakRow | null) ?? null);
        setBadges((badgeRes.data ?? []) as BadgeRow[]);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'unknown_error');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [studentId, isLoggedIn, authLoading]);

  // ─── Derived stats ─────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const total = observations.length;
    const guided = observations.filter(o => o.observation_type === 'guided').length;
    const vivaSum = observations.reduce(
      (acc, o) => {
        if (o.total_questions != null && o.total_questions > 0 && o.quiz_score != null) {
          acc.score += o.quiz_score;
          acc.max += o.total_questions;
        }
        return acc;
      },
      { score: 0, max: 0 },
    );
    const avgVivaPct = vivaSum.max > 0 ? Math.round((vivaSum.score / vivaSum.max) * 100) : null;
    const totalSeconds = observations.reduce((s, o) => s + (o.time_spent_seconds ?? 0), 0);

    let dateRange: string | null = null;
    if (observations.length > 0) {
      const first = observations[0].created_at;
      const last = observations[observations.length - 1].created_at;
      dateRange = first === last ? formatDate(first, isHi) : `${formatDate(first, isHi)} – ${formatDate(last, isHi)}`;
    }

    return {
      totalExperiments: total,
      totalGuided: guided,
      avgVivaPct,
      totalSeconds,
      dateRange,
    };
  }, [observations, isHi]);

  const handlePrint = () => {
    if (typeof window !== 'undefined') window.print();
  };

  // ─── Render: loading ───────────────────────────────────────────────────
  if (authLoading || loading) {
    return (
      <div className="lab-nb-shell">
        <div className="lab-nb-loading">
          <div className="lab-nb-loading-emoji" aria-hidden="true">📓</div>
          <p>{t(isHi, 'Loading your lab notebook…', 'आपकी लैब नोटबुक लोड हो रही है…')}</p>
        </div>
        <PrintStyles />
      </div>
    );
  }

  // ─── Render: error / no access ─────────────────────────────────────────
  if (error || !student) {
    const isAuthError = error === 'not_logged_in' || error === 'no_access';
    return (
      <div className="lab-nb-shell">
        <div className="lab-nb-empty">
          <div className="lab-nb-empty-emoji" aria-hidden="true">{isAuthError ? '🔒' : '⚠️'}</div>
          <h1>
            {isAuthError
              ? t(isHi, 'Not authorized or no labs found', 'अधिकृत नहीं या कोई लैब नहीं मिली')
              : t(isHi, 'Could not load notebook', 'नोटबुक लोड नहीं हो सकी')}
          </h1>
          <p>
            {isAuthError
              ? t(
                  isHi,
                  'You can only view a notebook for yourself, your linked child, or a student in your class.',
                  'आप केवल अपनी, अपने जुड़े बच्चे की, या अपनी कक्षा के छात्र की नोटबुक देख सकते हैं।',
                )
              : t(isHi, 'Please try again later.', 'कृपया बाद में पुनः प्रयास करें।')}
          </p>
        </div>
        <PrintStyles />
      </div>
    );
  }

  if (observations.length === 0) {
    return (
      <div className="lab-nb-shell">
        <div className="lab-nb-empty">
          <div className="lab-nb-empty-emoji" aria-hidden="true">🧪</div>
          <h1>{t(isHi, 'No experiments yet', 'अभी तक कोई प्रयोग नहीं')}</h1>
          <p>
            {t(
              isHi,
              `${student.name} has not completed any STEM experiments yet. Once they do, this notebook will fill with their observations, data, and conclusions.`,
              `${student.name} ने अभी तक कोई STEM प्रयोग पूरा नहीं किया है। एक बार जब वे करेंगे, तो यह नोटबुक उनके अवलोकन, डेटा और निष्कर्ष से भर जाएगी।`,
            )}
          </p>
        </div>
        <PrintStyles />
      </div>
    );
  }

  // ─── Render: notebook ──────────────────────────────────────────────────
  return (
    <div className="lab-nb-shell">
      {/* Print / language toolbar (hidden in print) */}
      <div className="lab-nb-toolbar no-print">
        <button type="button" onClick={handlePrint} className="lab-nb-print-btn">
          🖨️ {t(isHi, 'Print / Save as PDF', 'प्रिंट / PDF सहेजें')}
        </button>
        <span className="lab-nb-toolbar-hint">
          {t(
            isHi,
            'Tip: choose "Save as PDF" in the print dialog to download.',
            'सुझाव: डाउनलोड करने के लिए प्रिंट डायलॉग में "Save as PDF" चुनें।',
          )}
        </span>
      </div>

      {/* Cover page */}
      <section className="lab-nb-cover">
        <div className="lab-nb-cover-emblem" aria-hidden="true">🔬</div>
        <h1 className="lab-nb-cover-title">
          {t(isHi, 'STEM Lab Notebook', 'STEM लैब नोटबुक')}
        </h1>
        <p className="lab-nb-cover-subtitle">
          {t(isHi, 'CBSE Practical Record', 'CBSE प्रायोगिक अभिलेख')}
        </p>

        <dl className="lab-nb-cover-meta">
          <div>
            <dt>{t(isHi, 'Student', 'छात्र')}</dt>
            <dd>{student.name}</dd>
          </div>
          <div>
            <dt>{t(isHi, 'Grade', 'कक्षा')}</dt>
            {/* P5: grade is a string '6'..'12' */}
            <dd>{t(isHi, `Class ${student.grade}`, `कक्षा ${student.grade}`)}</dd>
          </div>
          {student.school_name && (
            <div>
              <dt>{t(isHi, 'School', 'विद्यालय')}</dt>
              <dd>{student.school_name}</dd>
            </div>
          )}
          {stats.dateRange && (
            <div>
              <dt>{t(isHi, 'Period', 'अवधि')}</dt>
              <dd>{stats.dateRange}</dd>
            </div>
          )}
          <div>
            <dt>{t(isHi, 'Generated on', 'तैयार किया गया')}</dt>
            <dd>{formatDate(new Date().toISOString(), isHi)}</dd>
          </div>
        </dl>

        <div className="lab-nb-cover-stats">
          <div className="lab-nb-stat">
            <div className="lab-nb-stat-value">{stats.totalExperiments}</div>
            <div className="lab-nb-stat-label">{t(isHi, 'Total Experiments', 'कुल प्रयोग')}</div>
          </div>
          <div className="lab-nb-stat">
            <div className="lab-nb-stat-value">{stats.totalGuided}</div>
            <div className="lab-nb-stat-label">{t(isHi, 'Guided Experiments', 'गाइडेड प्रयोग')}</div>
          </div>
          <div className="lab-nb-stat">
            <div className="lab-nb-stat-value">
              {stats.avgVivaPct === null ? '—' : `${stats.avgVivaPct}%`}
            </div>
            <div className="lab-nb-stat-label">{t(isHi, 'Avg Viva', 'औसत वाइवा')}</div>
          </div>
          {streak && (
            <div className="lab-nb-stat">
              <div className="lab-nb-stat-value">{streak.longest_streak}</div>
              <div className="lab-nb-stat-label">{t(isHi, 'Longest Streak', 'सबसे लंबी स्ट्रीक')}</div>
            </div>
          )}
        </div>

        {badges.length > 0 && (
          <div className="lab-nb-cover-badges">
            <h2>{t(isHi, 'Mastery Badges Earned', 'महारत बैज')}</h2>
            <ul>
              {badges.map(b => (
                <li key={b.id}>
                  <span aria-hidden="true">{TIER_EMOJI[b.tier]}</span>{' '}
                  <strong>{b.subject}</strong>{' '}
                  <span className="lab-nb-badge-tier">
                    {t(
                      isHi,
                      b.tier.charAt(0).toUpperCase() + b.tier.slice(1),
                      b.tier === 'bronze' ? 'कांस्य' : b.tier === 'silver' ? 'रजत' : 'स्वर्ण',
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="lab-nb-cover-signature">
          {t(isHi, 'Signature: ____________________', 'हस्ताक्षर: ____________________')}
        </p>
      </section>

      {/* Per-experiment entries */}
      {observations.map((obs, idx) => {
        const def = getExperimentDef(obs);
        const sim = getSimLabel(obs.simulation_id, isHi);
        const isGuided = obs.observation_type === 'guided';
        const title = def ? (isHi ? def.titleHi : def.title) : sim.title;
        const objective = def
          ? (isHi ? def.objectiveHi : def.objective)
          : t(isHi, `Open-ended exploration of ${sim.title}`, `${sim.title} का खुला अन्वेषण`);
        const vivaPct =
          obs.total_questions != null && obs.total_questions > 0 && obs.quiz_score != null
            ? Math.round((obs.quiz_score / obs.total_questions) * 100)
            : null;

        return (
          <section className="lab-nb-entry" key={obs.id}>
            <header className="lab-nb-entry-head">
              <div className="lab-nb-entry-num">
                {t(isHi, 'Experiment', 'प्रयोग')} {idx + 1}
              </div>
              <h2 className="lab-nb-entry-title">
                <span aria-hidden="true">{sim.emoji}</span> {title}
              </h2>
              <div className="lab-nb-entry-meta">
                <span>{def?.chapterRef ?? `${t(isHi, 'Subject', 'विषय')}: ${obs.subject}`}</span>
                <span aria-hidden="true">•</span>
                <span>{formatDate(obs.created_at, isHi)}</span>
                <span aria-hidden="true">•</span>
                <span>
                  {isGuided
                    ? t(isHi, 'Guided', 'गाइडेड')
                    : t(isHi, 'Free Exploration', 'खुला अन्वेषण')}
                </span>
              </div>
            </header>

            {/* Objective */}
            <div className="lab-nb-section">
              <h3>{t(isHi, 'Aim / Objective', 'उद्देश्य')}</h3>
              <p>{objective}</p>
            </div>

            {/* Materials (only if guided + defined) */}
            {def?.materials && def.materials.length > 0 && (
              <div className="lab-nb-section">
                <h3>{t(isHi, 'Materials Required', 'आवश्यक सामग्री')}</h3>
                <ul className="lab-nb-bullets">
                  {def.materials.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Observations */}
            <div className="lab-nb-section">
              <h3>{t(isHi, 'Observations', 'अवलोकन')}</h3>
              {obs.structured_observations && Object.keys(obs.structured_observations).length > 0 ? (
                <table className="lab-nb-table">
                  <thead>
                    <tr>
                      <th>{t(isHi, 'Field', 'क्षेत्र')}</th>
                      <th>{t(isHi, 'Value', 'मान')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(obs.structured_observations).map(([key, val], i) => {
                      // Map key to its bilingual prompt if the experiment def has it
                      const obsDef = def?.observations.find(
                        (_, j) => `obs_${j}` === key || _.prompt === key,
                      );
                      const label = obsDef
                        ? (isHi ? obsDef.promptHi : obsDef.prompt)
                        : key;
                      return (
                        <tr key={i}>
                          <td className="lab-nb-table-key">{label}</td>
                          <td>{String(val)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : obs.observation_text ? (
                <p className="lab-nb-prose">{obs.observation_text}</p>
              ) : (
                <p className="lab-nb-empty-line">
                  {t(isHi, '(No observations recorded)', '(कोई अवलोकन दर्ज नहीं)')}
                </p>
              )}
            </div>

            {/* Data table */}
            {obs.data_entries && Array.isArray(obs.data_entries) && obs.data_entries.length > 0 && (
              <div className="lab-nb-section">
                <h3>{t(isHi, 'Data Recorded', 'दर्ज डेटा')}</h3>
                <table className="lab-nb-table">
                  <thead>
                    <tr>
                      {Object.keys(obs.data_entries[0]).map(col => (
                        <th key={col}>
                          {def?.dataTable?.columns.includes(col) ? col : col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {obs.data_entries.map((row, i) => (
                      <tr key={i}>
                        {Object.values(row).map((cell, j) => (
                          <td key={j}>{String(cell)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Conclusion */}
            <div className="lab-nb-section">
              <h3>{t(isHi, 'Conclusion', 'निष्कर्ष')}</h3>
              {obs.conclusion ? (
                <p className="lab-nb-prose">{obs.conclusion}</p>
              ) : (
                <p className="lab-nb-empty-line">
                  {t(isHi, '(No conclusion written)', '(कोई निष्कर्ष नहीं लिखा गया)')}
                </p>
              )}
            </div>

            {/* Footer: viva + time */}
            <footer className="lab-nb-entry-footer">
              {vivaPct !== null && (
                <span>
                  {t(isHi, 'Viva Score', 'वाइवा स्कोर')}:{' '}
                  <strong>
                    {obs.quiz_score}/{obs.total_questions} ({vivaPct}%)
                  </strong>
                </span>
              )}
              <span>
                {t(isHi, 'Time Spent', 'समय व्यतीत')}:{' '}
                <strong>{formatDuration(obs.time_spent_seconds, isHi)}</strong>
              </span>
            </footer>
          </section>
        );
      })}

      <PrintStyles />
    </div>
  );
}

// ─── Print + responsive CSS (scoped via class prefix) ─────────────────────
function PrintStyles() {
  return (
    <style jsx global>{`
      /* Page-level reset for the notebook only */
      .lab-nb-shell {
        font-family: 'Times New Roman', Georgia, serif;
        color: #1a1a1a;
        background: #f4f1ea;
        min-height: 100vh;
        padding: 16px;
        font-size: 16px;
        line-height: 1.55;
      }

      /* Toolbar */
      .lab-nb-toolbar {
        max-width: 800px;
        margin: 0 auto 16px;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 12px;
        padding: 10px 14px;
        background: #fffdf6;
        border: 1px solid #d6c9a3;
        border-radius: 10px;
      }
      .lab-nb-print-btn {
        background: #7C3AED;
        color: #fff;
        border: none;
        padding: 10px 16px;
        font-size: 15px;
        font-weight: 700;
        border-radius: 8px;
        cursor: pointer;
        font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
      }
      .lab-nb-print-btn:hover { background: #6d28d9; }
      .lab-nb-toolbar-hint { font-size: 13px; color: #555; font-family: 'Plus Jakarta Sans', system-ui, sans-serif; }

      /* Loading + empty */
      .lab-nb-loading,
      .lab-nb-empty {
        max-width: 600px;
        margin: 60px auto;
        text-align: center;
        background: #fffdf6;
        border: 1px solid #d6c9a3;
        border-radius: 12px;
        padding: 40px 24px;
      }
      .lab-nb-loading-emoji,
      .lab-nb-empty-emoji {
        font-size: 56px;
        margin-bottom: 12px;
      }
      .lab-nb-empty h1 {
        font-size: 22px;
        margin: 0 0 10px;
      }
      .lab-nb-empty p {
        font-size: 15px;
        color: #555;
      }

      /* Cover page */
      .lab-nb-cover {
        max-width: 800px;
        margin: 0 auto 20px;
        background: #fffdf6;
        border: 1px solid #d6c9a3;
        border-radius: 12px;
        padding: 40px 28px;
        text-align: center;
      }
      .lab-nb-cover-emblem { font-size: 64px; margin-bottom: 12px; }
      .lab-nb-cover-title {
        font-size: 32px;
        margin: 0 0 6px;
        letter-spacing: 0.5px;
      }
      .lab-nb-cover-subtitle {
        font-size: 16px;
        color: #555;
        margin: 0 0 28px;
        font-style: italic;
      }
      .lab-nb-cover-meta {
        display: grid;
        grid-template-columns: 1fr;
        gap: 8px 24px;
        margin: 0 auto 24px;
        text-align: left;
        max-width: 520px;
      }
      .lab-nb-cover-meta div {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        padding: 6px 0;
        border-bottom: 1px dotted #c4b894;
      }
      .lab-nb-cover-meta dt {
        font-weight: 700;
        color: #444;
      }
      .lab-nb-cover-meta dd {
        margin: 0;
        text-align: right;
      }
      .lab-nb-cover-stats {
        display: grid;
        grid-template-columns: 1fr;
        gap: 12px;
        margin: 24px 0;
      }
      .lab-nb-stat {
        background: #f4ecd6;
        border: 1px solid #c4b894;
        border-radius: 8px;
        padding: 14px 10px;
      }
      .lab-nb-stat-value {
        font-size: 30px;
        font-weight: 700;
        color: #7C3AED;
        line-height: 1;
      }
      .lab-nb-stat-label {
        font-size: 12px;
        color: #555;
        margin-top: 6px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
      }
      .lab-nb-cover-badges {
        margin-top: 24px;
        text-align: left;
      }
      .lab-nb-cover-badges h2 {
        font-size: 18px;
        margin: 0 0 10px;
        text-align: center;
      }
      .lab-nb-cover-badges ul {
        list-style: none;
        padding: 0;
        margin: 0;
        display: grid;
        grid-template-columns: 1fr;
        gap: 6px;
      }
      .lab-nb-cover-badges li {
        background: #f4ecd6;
        padding: 8px 12px;
        border-radius: 6px;
        font-size: 14px;
      }
      .lab-nb-badge-tier {
        font-size: 12px;
        color: #666;
        margin-left: 8px;
      }
      .lab-nb-cover-signature {
        margin-top: 36px;
        font-size: 14px;
        color: #444;
        text-align: right;
      }

      /* Per-experiment entries */
      .lab-nb-entry {
        max-width: 800px;
        margin: 0 auto 20px;
        background: #fffdf6;
        border: 1px solid #d6c9a3;
        border-radius: 12px;
        padding: 28px 24px;
      }
      .lab-nb-entry-head {
        margin-bottom: 18px;
        padding-bottom: 12px;
        border-bottom: 2px solid #c4b894;
      }
      .lab-nb-entry-num {
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 1px;
        color: #7C3AED;
        font-weight: 700;
        font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
      }
      .lab-nb-entry-title {
        font-size: 22px;
        margin: 4px 0 8px;
      }
      .lab-nb-entry-meta {
        font-size: 13px;
        color: #555;
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .lab-nb-section {
        margin-bottom: 14px;
      }
      .lab-nb-section h3 {
        font-size: 15px;
        margin: 0 0 6px;
        color: #333;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
      }
      .lab-nb-prose {
        margin: 0;
        white-space: pre-wrap;
        word-wrap: break-word;
      }
      .lab-nb-bullets {
        margin: 0;
        padding-left: 22px;
      }
      .lab-nb-bullets li { margin-bottom: 2px; }
      .lab-nb-empty-line {
        margin: 0;
        font-style: italic;
        color: #888;
      }
      .lab-nb-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 14px;
      }
      .lab-nb-table th,
      .lab-nb-table td {
        border: 1px solid #c4b894;
        padding: 6px 10px;
        text-align: left;
        vertical-align: top;
      }
      .lab-nb-table th {
        background: #f4ecd6;
        font-weight: 700;
      }
      .lab-nb-table-key {
        width: 40%;
        font-weight: 600;
      }
      .lab-nb-entry-footer {
        margin-top: 14px;
        padding-top: 10px;
        border-top: 1px dashed #c4b894;
        display: flex;
        flex-wrap: wrap;
        gap: 16px;
        font-size: 13px;
        color: #444;
      }

      /* ─── Responsive (screen) ─── */
      @media (min-width: 640px) {
        .lab-nb-cover-stats {
          grid-template-columns: repeat(2, 1fr);
        }
        .lab-nb-cover-meta {
          grid-template-columns: repeat(2, 1fr);
        }
        .lab-nb-cover-badges ul {
          grid-template-columns: repeat(2, 1fr);
        }
      }
      @media (min-width: 1024px) {
        .lab-nb-cover-stats {
          grid-template-columns: repeat(4, 1fr);
        }
      }

      /* ─── Print (A4) ─── */
      @media print {
        @page {
          size: A4;
          margin: 15mm;
        }
        .no-print { display: none !important; }
        .lab-nb-shell {
          background: #fff !important;
          padding: 0;
          font-size: 12pt;
          color: #000;
        }
        .lab-nb-cover,
        .lab-nb-entry {
          background: #fff !important;
          border: none;
          border-radius: 0;
          padding: 0;
          margin: 0 0 12mm;
          max-width: 100%;
          box-shadow: none;
        }
        /* New page per experiment for clean lab-journal feel */
        .lab-nb-entry {
          page-break-before: always;
          break-before: page;
        }
        /* Avoid awkward breaks inside a section */
        .lab-nb-section,
        .lab-nb-entry-head,
        .lab-nb-entry-footer,
        .lab-nb-table {
          page-break-inside: avoid;
          break-inside: avoid;
        }
        .lab-nb-cover { page-break-after: always; break-after: page; }
        .lab-nb-stat { background: #f4f4f4 !important; border-color: #999 !important; }
        .lab-nb-table th { background: #eee !important; }
        .lab-nb-cover-badges li { background: #f4f4f4 !important; }
      }
    `}</style>
  );
}
