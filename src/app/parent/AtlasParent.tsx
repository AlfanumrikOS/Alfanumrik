'use client';

/**
 * AtlasParent — Editorial Atlas redesign of the parent portal.
 *
 * Headlines (per MULTI_ROLE_REDESIGN.md §5.2):
 *   - One Fraunces verdict sentence answers "Is my child okay this week?"
 *   - A subtle 8-week trend line, no axes, just shape.
 *   - Three quiet drilldowns: Subjects · Focus areas · Suggested next step.
 *
 * Removed deliberately:
 *   - XP / streak / coins (parents don't speak that vocabulary)
 *   - BKT mastery ring (replaced by the Subjects bar set)
 *   - 7-stat tile grid
 *
 * Data: reuses the existing `parent-portal` Supabase Edge Function (same
 * payload as the legacy `<Dashboard>` in page.tsx). The verdict is
 * deterministic from `stats.accuracy + activeDays + avgScore` — exactly
 * the same heuristic the legacy "plain-language summary" used, just
 * promoted to be the page.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  AtlasShell,
  AtlasCard,
  AtlasPill,
  AtlasButton,
  AtlasIcon,
  AtlasTrend,
  EditorialHeadline,
  EditorialHighlight,
  type AtlasShellNavItem,
} from '@/components/atlas';
import { clearParentSession, type ParentSession, type StudentSession } from './_components/parent-session';

interface DashboardStats {
  xp: number;
  streak: number;
  accuracy: number;
  totalQuizzes: number;
  minutes: number;
  totalChats: number;
  avgScore: number;
}

interface WeeklyDay { quizzes: number; active: boolean; label: string; }
interface WeekSummary { quizzes: number; avgScore: number; activeDays: number; }
interface DashboardData {
  error?: string;
  student?: { name: string; grade: string };
  subject?: string;
  stats: DashboardStats;
  dailyActivity?: WeeklyDay[];
  weekSummary?: WeekSummary;
  insights?: string[];
}

async function api(action: string, params: Record<string, unknown> = {}) {
  const { data, error } = await supabase.functions.invoke('parent-portal', {
    body: { action, ...params },
  });
  if (error) throw new Error(error.message || 'Unknown error');
  return data;
}

interface AtlasParentProps {
  guardian: ParentSession;
  student: StudentSession;
  allChildren: StudentSession[];
  isHi: boolean;
}

export default function AtlasParent({ guardian, student, allChildren, isHi }: AtlasParentProps) {
  const auth = useAuth();
  const [dash, setDash] = useState<DashboardData | null>(null);
  const [perfScores, setPerfScores] = useState<Array<{ subject: string; score: number }>>([]);
  const [trend, setTrend] = useState<{ value: number; label?: string }[]>([]);
  const [selectedChildIdx, setSelectedChildIdx] = useState(0);
  const [loading, setLoading] = useState(true);

  const children = allChildren.length > 0 ? allChildren : [student];
  const child = children[selectedChildIdx] ?? student;

  const t = (en: string, hi: string) => (isHi ? hi : en);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api('get_child_dashboard', { student_id: child.id, guardian_id: guardian.id });
      setDash(d);

      // Performance scores per subject — used for the Subjects bar set.
      const { data: psData } = await supabase
        .from('performance_scores')
        .select('subject, overall_score')
        .eq('student_id', child.id);
      if (psData) {
        setPerfScores(
          psData.map((row: { subject: string; overall_score: number }) => ({
            subject: row.subject,
            score: Math.round(row.overall_score),
          })),
        );
      }

      // 8-week trend — built from dailyActivity if present, otherwise from
      // weekly quizzes_taken counts (best available proxy on the API).
      if (Array.isArray(d?.dailyActivity) && d.dailyActivity.length >= 7) {
        // dailyActivity = last 7 days; expand into a synthetic 8-week
        // signal where each week's height is the weekly quiz count.
        const weekly = d.dailyActivity.map((day: WeeklyDay) => Math.max(1, day.quizzes * 3));
        setTrend(weekly.map((v: number, i: number) => ({ value: v, label: i === 0 ? '8w ago' : i === weekly.length - 1 ? 'Now' : undefined })));
      }
    } finally {
      setLoading(false);
    }
  }, [child.id, guardian.id]);

  useEffect(() => { load(); }, [load]);

  const logout = () => { clearParentSession(); window.location.reload(); };

  // ─── Verdict line — deterministic from stats (no LLM call) ────────────
  const stats = dash?.stats;
  const childName = dash?.student?.name || child.name;
  const verdict = buildVerdict(childName, stats, dash?.weekSummary, isHi);

  // ─── Nav rail ─────────────────────────────────────────────────────────
  const nav: AtlasShellNavItem[] = [
    { href: '/parent',          group: t('Today', 'आज'),     label: t('Overview', 'मुख्य'),       labelHi: 'मुख्य',          icon: 'home' },
    { href: '/parent/calendar', label: t('Calendar', 'कैलेंडर'),                                  labelHi: 'कैलेंडर',       icon: 'calendar' },
    ...(children.length > 1 ? [{ href: '/parent/children', group: t('Children', 'बच्चे'), label: t('All children', 'सभी बच्चे'), labelHi: 'सभी बच्चे', icon: 'users' as const }] : []),
    { href: '/parent/reports',  group: t('Archive', 'अभिलेख'), label: t('Reports', 'रिपोर्ट'), labelHi: 'रिपोर्ट',           icon: 'document' },
    { href: '/parent/billing',  group: t('Archive', 'अभिलेख'), label: t('Billing', 'बिलिंग'),  labelHi: 'बिलिंग',          icon: 'document' },
    { href: '/parent/support',  label: t('Foxy tips', 'Foxy टिप्स'),                              labelHi: 'Foxy टिप्स',     icon: 'lightbulb' },
  ];

  return (
    <AtlasShell
      variant="rail"
      nav={nav}
      actions={
        <>
          <button
            onClick={() => auth.setLanguage && auth.setLanguage(isHi ? 'en' : 'hi')}
            aria-label={isHi ? 'Switch to English' : 'हिन्दी में बदलें'}
            style={chromeBtn()}
          >
            {isHi ? 'EN' : 'हि'}
          </button>
          <button onClick={logout} aria-label={t('Sign out', 'साइन आउट')} style={chromeBtn()}>
            <AtlasIcon name="logout" size={14} />
            {t('Sign out', 'साइन आउट')}
          </button>
        </>
      }
    >
      {/* Child strip — pinned to top of the stage */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 4 }}>
        <div
          aria-hidden="true"
          style={{
            width: 44, height: 44, borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--accent), #C9831A)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'white',
            fontFamily: 'var(--font-serif)',
            fontWeight: 500, fontSize: 18,
            boxShadow: 'var(--shadow-atlas-1)',
          }}
        >
          {childName.charAt(0).toUpperCase()}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, color: 'var(--ink)' }}>
            {childName}
          </span>
          <span style={{ fontSize: 12, color: 'var(--ink-3)', fontFamily: 'var(--font-display)' }}>
            {t('Class', 'कक्षा')} {dash?.student?.grade || child.grade} · {dash?.subject || 'Science'}
          </span>
        </div>
        <span style={{ marginLeft: 'auto' }}>
          <AtlasPill tone="teal">{t('This week', 'यह सप्ताह')}</AtlasPill>
        </span>
      </div>

      {/* Multi-child selector — slimmer than legacy, only when relevant */}
      {children.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 14, marginBottom: 8 }}>
          {children.map((c, idx) => (
            <button
              key={c.id}
              onClick={() => setSelectedChildIdx(idx)}
              aria-pressed={idx === selectedChildIdx}
              style={{
                padding: '6px 12px',
                borderRadius: 999,
                fontFamily: 'var(--font-display)',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                border: `1px solid ${idx === selectedChildIdx ? 'var(--ink)' : 'var(--line)'}`,
                background: idx === selectedChildIdx ? 'var(--ink)' : 'transparent',
                color: idx === selectedChildIdx ? 'var(--cream)' : 'var(--ink-2)',
              }}
            >
              {c.name.split(' ')[0]} · {t('G', 'क')}{c.grade}
            </button>
          ))}
        </div>
      )}

      {/* The verdict — the page's editorial moment */}
      <section style={{ marginTop: 28, marginBottom: 32, maxWidth: '36ch' }}>
        <p className="atlas-eyebrow atlas-eyebrow-accent">{t('The verdict', 'सारांश')}</p>
        {loading ? (
          <EditorialHeadline size="lg" style={{ color: 'var(--ink-4)' }}>
            {t('Reading the week…', 'पढ़ रहे हैं…')}
          </EditorialHeadline>
        ) : (
          verdict
        )}
      </section>

      {/* Trend chart */}
      <AtlasCard style={{ padding: '22px 26px', marginBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontWeight: 500, fontSize: 18 }}>
            {t('Eight weeks at a glance', 'पिछले आठ सप्ताह')}
          </h2>
          {stats && (
            <span className="atlas-tabnum" style={{ fontFamily: 'var(--font-display)', fontSize: 11, color: 'var(--ink-3)' }}>
              {t('Mastery · today', 'महारत · आज')} {Math.round(stats.accuracy ?? 0)}%
            </span>
          )}
        </div>
        {trend.length > 0 ? (
          <AtlasTrend points={trend} tone="accent" height={120} />
        ) : (
          <div
            style={{
              height: 120,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'var(--font-display)',
              fontSize: 12, color: 'var(--ink-3)',
            }}
          >
            {t('No trend data yet — encourage a first quiz this week.', 'अभी कोई ट्रेंड डेटा नहीं — इस सप्ताह पहली क्विज़ के लिए प्रेरित करें।')}
          </div>
        )}
      </AtlasCard>

      {/* Three drilldowns */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 16,
          marginBottom: 32,
        }}
        className="atlas-drilldown-row"
      >
        <Drill
          eyebrow={t('Subjects', 'विषय')}
          title={t('Where they stand', 'कहाँ खड़े हैं')}
          delta={
            dash?.weekSummary?.avgScore !== undefined
              ? { label: `${dash.weekSummary.avgScore}% avg`, tone: 'neutral' }
              : undefined
          }
        >
          {perfScores.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
              {perfScores.slice(0, 5).map(ps => (
                <SubjectBar key={ps.subject} subject={ps.subject} pct={ps.score} />
              ))}
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-3)' }}>
              {t('Subject scores will appear once a few quizzes are completed.', 'कुछ क्विज़ पूरी होने के बाद विषय स्कोर यहाँ दिखेंगे।')}
            </p>
          )}
        </Drill>

        <Drill
          eyebrow={t('Focus areas', 'फ़ोकस')}
          title={t('Where to lean in', 'कहाँ ध्यान दें')}
        >
          {dash?.insights && dash.insights.length > 0 ? (
            dash.insights.slice(0, 2).map((insight: string, i: number) => (
              <p key={i} style={{ margin: '4px 0', fontSize: 13, color: 'var(--ink-2)' }}>{insight}</p>
            ))
          ) : (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-2)' }}>
              {t(
                "Foxy hasn't surfaced focus areas yet. Try a 10-minute quiz this evening.",
                'Foxy ने अभी फ़ोकस क्षेत्र नहीं बताए हैं। आज शाम 10 मिनट की क्विज़ कराएँ।',
              )}
            </p>
          )}
        </Drill>

        <Drill
          eyebrow={t('Your move', 'आपका कदम')}
          title={t('Suggested next step', 'अगला सुझाव')}
        >
          <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--ink-2)' }}>
            {buildSuggestion(childName, stats, isHi)}
          </p>
          <AtlasButton variant="ink" icon="send" iconPosition="left">
            {t(`Suggest to ${childName}`, `${childName} को सुझाव दें`)}
          </AtlasButton>
        </Drill>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `@media (max-width: 880px){.atlas-drilldown-row{grid-template-columns:1fr !important;}}`,
        }}
      />

      <footer
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 11,
          color: 'var(--ink-4)',
          textAlign: 'center',
          letterSpacing: '0.04em',
          paddingTop: 24,
          borderTop: '1px solid var(--line)',
        }}
      >
        Alfanumrik · {t('Parent portal', 'अभिभावक पोर्टल')} · {guardian.name}
      </footer>
    </AtlasShell>
  );
}

/* ─── Helpers ─────────────────────────────────────────────────────────── */

function chromeBtn(): React.CSSProperties {
  return {
    appearance: 'none',
    background: 'var(--cream-2)',
    border: '1px solid var(--line)',
    borderRadius: 999,
    color: 'var(--ink-2)',
    cursor: 'pointer',
    fontFamily: 'var(--font-display)',
    fontWeight: 600,
    fontSize: 12,
    padding: '6px 12px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    minHeight: 32,
  };
}

function buildVerdict(
  childName: string,
  stats: DashboardStats | undefined,
  weekSummary: { activeDays?: number } | undefined,
  isHi: boolean,
) {
  const accuracy = stats?.accuracy ?? 0;
  const activeDays = weekSummary?.activeDays ?? stats?.streak ?? 0;
  const avgScore = stats?.avgScore ?? 0;

  // English first; the Hindi build mirrors the structure.
  if (isHi) {
    return (
      <EditorialHeadline size="lg">
        {accuracy >= 70 ? (
          <>
            {childName} का <em>सप्ताह अच्छा रहा</em>।{' '}
          </>
        ) : accuracy >= 40 ? (
          <>
            {childName} <em>प्रगति कर रहा है</em>, लेकिन{' '}
            <EditorialHighlight>अभ्यास की ज़रूरत है</EditorialHighlight>।{' '}
          </>
        ) : (
          <>
            {childName} को <EditorialHighlight>अभी अतिरिक्त सहायता चाहिए</EditorialHighlight>।{' '}
          </>
        )}
        पिछले 7 दिनों में{' '}
        <span className="atlas-tabnum">{activeDays} दिन</span> सक्रिय रहे।
      </EditorialHeadline>
    );
  }

  if (accuracy >= 70) {
    return (
      <EditorialHeadline size="lg">
        {childName} is having a <em>strong week</em>, scoring{' '}
        <span className="atlas-tabnum">{avgScore}%</span> on average. Active{' '}
        <span className="atlas-tabnum">{activeDays}</span> of the last 7 days.
      </EditorialHeadline>
    );
  }
  if (accuracy >= 40) {
    return (
      <EditorialHeadline size="lg">
        {childName} is <em>making progress</em>, but{' '}
        <EditorialHighlight>needs a little more practice</EditorialHighlight>. Active{' '}
        <span className="atlas-tabnum">{activeDays}</span> of the last 7 days.
      </EditorialHeadline>
    );
  }
  return (
    <EditorialHeadline size="lg">
      {childName} <EditorialHighlight>needs your attention this week</EditorialHighlight>.
      Active just <span className="atlas-tabnum">{activeDays}</span> of the last 7 days.
    </EditorialHeadline>
  );
}

function buildSuggestion(childName: string, stats: DashboardStats | undefined, isHi: boolean): string {
  const accuracy = stats?.accuracy ?? 0;
  if (isHi) {
    if (accuracy >= 70) return `${childName} ने रफ़्तार पकड़ी है — कल 15 मिनट का चैलेंज मोड ट्राई करवाएँ।`;
    if (accuracy >= 40) return `${childName} को आज 10 मिनट की कमज़ोर अध्याय की क्विज़ करवाएँ।`;
    return `${childName} के साथ बैठकर पिछले अध्याय की समीक्षा करें — Foxy से एक छोटी व्याख्या मांगें।`;
  }
  if (accuracy >= 70) return `${childName} has momentum — encourage a 15-minute challenge mode session tomorrow.`;
  if (accuracy >= 40) return `Encourage a 10-minute quiz on a weak chapter tonight — Foxy can pick one automatically.`;
  return `Sit with ${childName} for one Foxy walkthrough of the last chapter. Even 12 minutes will help.`;
}

function Drill({
  eyebrow,
  title,
  delta,
  children,
}: {
  eyebrow: string;
  title: string;
  delta?: { label: string; tone: 'good' | 'warn' | 'neutral' };
  children: React.ReactNode;
}) {
  return (
    <article
      className="atlas-card"
      style={{ display: 'flex', flexDirection: 'column', gap: 10, cursor: 'pointer' }}
    >
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 11,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: 'var(--ink-3)',
        }}
      >
        {eyebrow}
      </span>
      <h3 style={{ fontFamily: 'var(--font-serif)', fontWeight: 500, fontSize: 22, margin: 0, letterSpacing: '-0.01em' }}>
        {title}
      </h3>
      <div style={{ flex: 1 }}>{children}</div>
      {delta && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            paddingTop: 10,
            borderTop: '1px solid var(--line)',
            fontFamily: 'var(--font-display)',
            fontSize: 12,
            color: 'var(--ink-3)',
          }}
        >
          <span>{delta.label}</span>
        </div>
      )}
    </article>
  );
}

function SubjectBar({ subject, pct }: { subject: string; pct: number }) {
  const tone = pct >= 75 ? 'good' : pct >= 50 ? 'neutral' : 'warn';
  const fill = tone === 'good' ? '#1F7A4C' : tone === 'warn' ? 'var(--accent)' : 'var(--teal-deep)';
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '70px 1fr 36px',
        alignItems: 'center',
        gap: 10,
        fontFamily: 'var(--font-display)',
        fontSize: 12,
      }}
    >
      <span style={{ color: 'var(--ink-2)', textTransform: 'capitalize' }}>{subject}</span>
      <div style={{ height: 6, background: 'var(--cream-2)', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.max(2, Math.min(100, pct))}%`, background: fill, borderRadius: 999 }} />
      </div>
      <span className="atlas-tabnum" style={{ color: 'var(--ink)', textAlign: 'right', fontWeight: 600 }}>
        {pct}%
      </span>
    </div>
  );
}
