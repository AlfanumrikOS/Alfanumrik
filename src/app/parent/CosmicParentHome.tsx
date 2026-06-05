'use client';

/**
 * CosmicParentHome — the cosmic (ff_cosmic_redesign_v1 ON) composition of the
 * parent "corner" home, faithful to the CEO-approved prototype
 * (alfa_design_src/24_*.js ParentScreen) but wired to REAL parent-portal data
 * only.
 *
 * This component is rendered ONLY when useCosmicTheme().cosmicEnabled is true
 * (page.tsx switches between this and the legacy <Dashboard> DOM). When the
 * flag is OFF the parent home keeps its legacy DOM untouched, so flag-OFF is
 * byte-identical to today.
 *
 * Display-only. No scoring (P1), XP (P2), progress, or mastery logic lives
 * here — every number is a server value passed in as a prop / fetched verbatim.
 * ProgressBar renders server values; bars never recompute a score.
 *
 * The parent role automatically gets the warm peach/mint palette because
 * CosmicThemeProvider writes html[data-role="parent"] (guardian→parent via
 * roleToCosmicRole) and globals.css defines that palette. So --violet here is
 * peach, --cyan is mint, --saffron is amber — no role colors are hardcoded.
 *
 * Faithful elements composed from the cosmic primitives:
 *   - Header: "Parent's corner" + "<Child>'s week" + child avatar/grade chip
 *   - Weekly summary CardElev: 3 KPIs (time studied, topics mastered, goal days)
 *     + weekly bar chart (bars + goal-line marker, active days glow in accent)
 *   - Subject progress: list of rows each with a ProgressBar + mastery %
 *   - "Needs help" coral-tinted card (derived from the real weakest signal)
 *   - "Teacher note" card (latest real teacher↔parent message; omitted if none)
 *
 * Data provenance (REAL only — no prototype LEARN_DATA mocks):
 *   - childName / grade : selected child (StudentSession + dash.student)
 *   - time studied      : dash.stats.minutes (server)
 *   - topics mastered   : dash.bktMastery.levels.mastered (server BKT count)
 *   - goal days         : dash.weekSummary.activeDays out of 7 (server)
 *   - weekly bars       : dash.dailyActivity[] (quizzes per day, server)
 *   - subject progress  : perfScores[] (subject + overall_score, server)
 *   - needs help        : derived from the lowest real perfScore / inactivity —
 *                         never the prototype's fabricated "Social Studies"
 *   - teacher note      : latest /api/parent/messages thread preview (server),
 *                         guardian-mode only; omitted entirely when absent
 *
 * P7 (bilingual): every visible string branches on isHi. Technical terms (XP,
 * CBSE) are not translated. Hindi parity references alfa_design_src/39_*.js
 * (parents_corner / weekly_summary / time_studied / topics_mastered /
 * needs_help) and the legacy parent page's existing Hindi strings.
 */

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { CardElev, ProgressBar } from '@/components/cosmic';
import type { StudentSession } from './_components/parent-session';

const t = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

// Subject → Hindi label map (mirrors the legacy parent page).
const SUBJECT_HI: Record<string, string> = {
  math: 'गणित',
  maths: 'गणित',
  science: 'विज्ञान',
  english: 'अंग्रेज़ी',
  hindi: 'हिंदी',
  social: 'सामाजिक विज्ञान',
  sst: 'सामाजिक विज्ञान',
  evs: 'पर्यावरण',
  physics: 'भौतिकी',
  chemistry: 'रसायन',
  biology: 'जीवविज्ञान',
};

// Deterministic accent for a subject row, drawn from the role palette tokens so
// the parent peach/mint/amber identity drives the colors (no hardcoded brand).
const SUBJECT_ACCENTS = ['var(--violet)', 'var(--cyan)', 'var(--saffron)', 'var(--pink)'];

interface DashboardStats {
  xp: number;
  streak: number;
  accuracy: number;
  totalQuizzes: number;
  minutes: number;
  totalChats: number;
  avgScore: number;
}
interface WeeklyDay {
  quizzes: number;
  active: boolean;
  label: string;
}
interface WeekSummary {
  quizzes: number;
  avgScore: number;
  activeDays: number;
}
interface BktMastery {
  levels: Record<string, number>;
  total: number;
}
interface PerfScoreRow {
  subject: string;
  overall_score: number;
  level_name: string;
}

export interface CosmicParentHomeProps {
  /** Selected child (name + grade) for the header chip. */
  student: StudentSession;
  /** Server-resolved child name (dash.student?.name) — falls back to student.name. */
  childName: string;
  /** Server-resolved grade (dash.student?.grade) — falls back to student.grade. */
  grade: string;
  isHi: boolean;
  /** Aggregate stats (server). Display only. */
  stats: DashboardStats;
  /** Per-day quiz counts for the weekly bar chart (server). */
  dailyActivity?: WeeklyDay[];
  /** This-week roll-up (server). */
  weekSummary?: WeekSummary;
  /** BKT mastery level counts (server). */
  bktMastery?: BktMastery;
  /** Performance scores per subject (server) for the progress bars. */
  perfScores: PerfScoreRow[];
  /** STEM-lab current streak (server) or null. */
  labStreak: number | null;
  /** True only in guardian mode — gates the teacher-note message fetch. */
  canFetchMessages: boolean;
  /** Manual refetch (parent header refresh button). */
  onRefresh: () => void;
  /** Logout handler from the page. */
  onLogout: () => void;
}

interface TeacherNote {
  teacherName: string;
  subject: string | null;
  preview: string;
  at: string;
}

export default function CosmicParentHome({
  student,
  childName,
  grade,
  isHi,
  stats,
  dailyActivity,
  weekSummary,
  bktMastery,
  perfScores,
  labStreak,
  canFetchMessages,
  onRefresh,
  onLogout,
}: CosmicParentHomeProps) {
  // ── Teacher note (latest real teacher↔parent message) ──────────────────────
  // Guardian-mode only (the API requires a Supabase JWT). We render the card
  // ONLY when a real message exists — never the prototype's mock note.
  const [teacherNote, setTeacherNote] = useState<TeacherNote | null>(null);
  useEffect(() => {
    if (!canFetchMessages) {
      setTeacherNote(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
        const res = await fetch('/api/parent/messages/threads?limit=1', { headers });
        if (!res.ok) {
          if (!cancelled) setTeacherNote(null);
          return;
        }
        const body = (await res.json()) as {
          threads?: Array<{
            teacher_name: string | null;
            subject: string | null;
            last_message_preview: string | null;
            last_message_sender_role: string | null;
            last_message_at: string;
          }>;
        };
        const thread = (body.threads ?? []).find(
          (th) => th.last_message_preview && th.last_message_sender_role === 'teacher',
        );
        if (cancelled) return;
        if (thread?.last_message_preview) {
          setTeacherNote({
            teacherName: thread.teacher_name || t(isHi, 'Teacher', 'शिक्षक'),
            subject: thread.subject,
            preview: thread.last_message_preview,
            at: thread.last_message_at,
          });
        } else {
          setTeacherNote(null);
        }
      } catch {
        if (!cancelled) setTeacherNote(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canFetchMessages, isHi]);

  const firstName = (childName || student.name || '').split(' ')[0] || childName;
  const minutes = stats.minutes || 0;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const topicsMastered = bktMastery?.levels?.mastered ?? 0;
  const activeDays = weekSummary?.activeDays ?? 0;

  // Weekly bars: real per-day quiz counts. Active days glow in the accent; the
  // dotted line marks the "1 quiz/day" gentle daily goal the activeDays metric
  // already counts against (no fabricated 20-min goal — we have quiz counts).
  const week = dailyActivity ?? [];
  const maxQ = Math.max(...week.map((d) => d.quizzes), 1);

  // "Needs help": the weakest real signal. Prefer the lowest perfScore subject;
  // otherwise fall back to a low-accuracy / inactivity nudge. Never fabricated.
  const sortedScores = [...perfScores].sort((a, b) => a.overall_score - b.overall_score);
  const weakest = sortedScores[0];
  const needsHelp =
    weakest && weakest.overall_score < 60
      ? {
          subject: isHi
            ? SUBJECT_HI[weakest.subject.toLowerCase()] || weakest.subject
            : weakest.subject,
          score: weakest.overall_score,
        }
      : null;
  const lowActivity = (weekSummary?.quizzes ?? 0) === 0 && activeDays === 0;

  return (
    <div
      className="cosmic-fade-up"
      style={{
        maxWidth: 600,
        margin: '0 auto',
        padding: '8px 16px 28px',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        position: 'relative',
        zIndex: 1,
      }}
    >
      {/* ── Header: Parent's corner + <Child>'s week + avatar/grade chip ────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          marginTop: 8,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 500 }}>
            {t(isHi, 'Parent corner', 'अभिभावक कोना')}
          </div>
          <h1
            className="cosmic-h-display"
            style={{ fontSize: 22, lineHeight: 1.1, marginTop: 3, color: 'var(--text)' }}
            data-testid="cosmic-parent-heading"
          >
            {isHi ? `${firstName} का सप्ताह` : `${firstName}'s week`}
          </h1>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 10px 6px 6px',
            background: 'var(--bg-card)',
            border: '1px solid var(--stroke)',
            borderRadius: 99,
            flexShrink: 0,
          }}
        >
          <div
            aria-hidden="true"
            style={{
              width: 28,
              height: 28,
              borderRadius: 99,
              background: 'linear-gradient(135deg, var(--violet), var(--violet-2))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              fontWeight: 700,
              color: '#fff',
            }}
          >
            {(firstName || '?').charAt(0).toUpperCase()}
          </div>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
            {firstName}
            {grade ? ` · ${t(isHi, 'G', 'क')}${grade}` : ''}
          </span>
        </div>
      </div>

      {/* ── Header actions (refresh / logout) — kept from the legacy home so no
          parent affordance is lost when the flag flips on. ─────────────────── */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={onRefresh}
          className="cosmic-pill-btn"
          aria-label={t(isHi, 'Refresh', 'रिफ्रेश')}
        >
          {t(isHi, 'Refresh', 'रिफ्रेश')}
        </button>
        <button
          type="button"
          onClick={onLogout}
          className="cosmic-pill-btn"
          aria-label={t(isHi, 'Logout', 'लॉग आउट')}
        >
          {t(isHi, 'Logout', 'लॉग आउट')}
        </button>
      </div>

      {/* ── Weekly summary: 3 KPIs + bar chart ─────────────────────────────── */}
      <CardElev style={{ padding: 18 }}>
        <div
          style={{
            fontSize: 12,
            color: 'var(--text-3)',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}
        >
          {t(isHi, 'This week', 'इस सप्ताह')}
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: 14,
            marginTop: 12,
          }}
        >
          <ParentKpi
            label={t(isHi, 'Time studied', 'अध्ययन समय')}
            value={hours > 0 ? `${hours}h ${mins}m` : `${mins}m`}
            color="var(--violet)"
          />
          <ParentKpi
            label={t(isHi, 'Topics mastered', 'महारत हासिल विषय')}
            value={String(topicsMastered)}
            color="var(--cyan)"
          />
          <ParentKpi
            label={t(isHi, 'Goal days', 'लक्ष्य पूर्ण')}
            value={`${activeDays}/7`}
            color="var(--saffron)"
          />
        </div>

        {/* Weekly bar chart — real quizzes/day; active days glow in accent. */}
        {week.length > 0 && (
          <>
            <div
              style={{
                marginTop: 18,
                display: 'flex',
                alignItems: 'flex-end',
                gap: 6,
                height: 110,
              }}
              role="img"
              aria-label={t(
                isHi,
                `Weekly activity: ${week.map((d) => `${d.label} ${d.quizzes}`).join(', ')}`,
                `साप्ताहिक गतिविधि: ${week.map((d) => `${d.label} ${d.quizzes}`).join(', ')}`,
              )}
            >
              {week.map((d, i) => {
                const h = Math.max(4, (d.quizzes / maxQ) * 90);
                return (
                  <div
                    key={i}
                    style={{
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <div
                      className="cosmic-tab-num"
                      style={{ fontSize: 9, color: 'var(--text-3)', fontWeight: 600 }}
                    >
                      {d.quizzes}
                    </div>
                    <div
                      style={{
                        width: '100%',
                        height: h,
                        borderRadius: 6,
                        background: d.active
                          ? 'linear-gradient(180deg, var(--violet), var(--violet-2))'
                          : 'rgba(255,255,255,0.08)',
                        boxShadow: d.active ? '0 0 12px var(--stroke-glow)' : 'none',
                        position: 'relative',
                      }}
                    >
                      {/* gentle daily-goal marker (1 quiz/day) */}
                      {maxQ > 1 && (
                        <div
                          style={{
                            position: 'absolute',
                            left: 0,
                            right: 0,
                            bottom: (1 / maxQ) * 90,
                            height: 1,
                            background: 'var(--saffron)',
                            opacity: 0.5,
                          }}
                        />
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        color: d.active ? 'var(--text-2)' : 'var(--text-3)',
                        fontWeight: 500,
                      }}
                    >
                      {d.label}
                    </div>
                  </div>
                );
              })}
            </div>
            <div
              style={{
                marginTop: 10,
                fontSize: 11,
                color: 'var(--text-3)',
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                flexWrap: 'wrap',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span
                  aria-hidden="true"
                  style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--violet)' }}
                />
                {t(isHi, 'Active day', 'सक्रिय दिन')}
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span
                  aria-hidden="true"
                  style={{ width: 8, height: 1, background: 'var(--saffron)' }}
                />
                {t(isHi, 'Daily goal', 'दैनिक लक्ष्य')}
              </span>
            </div>
          </>
        )}
      </CardElev>

      {/* ── Subject progress (real perfScores) ─────────────────────────────── */}
      {perfScores.length > 0 && (
        <>
          <div
            className="cosmic-h-display"
            style={{
              fontSize: 14,
              marginTop: 8,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              color: 'var(--text-3)',
              fontWeight: 600,
            }}
          >
            {t(isHi, 'Subject progress', 'विषयवार प्रगति')}
          </div>
          <CardElev flat style={{ padding: 4 }}>
            {perfScores.map((ps, i) => {
              const accent = SUBJECT_ACCENTS[i % SUBJECT_ACCENTS.length];
              const label = isHi
                ? SUBJECT_HI[ps.subject.toLowerCase()] || ps.subject
                : ps.subject;
              const pct = Math.max(0, Math.min(100, ps.overall_score));
              return (
                <div
                  key={ps.subject}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '12px 14px',
                    borderTop: i > 0 ? '1px solid var(--stroke)' : 'none',
                  }}
                >
                  <div
                    aria-hidden="true"
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 10,
                      background: 'var(--bg-card-2)',
                      color: accent,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: 13,
                      flexShrink: 0,
                    }}
                  >
                    {ps.subject.charAt(0).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                      {label}
                    </div>
                    <div style={{ marginTop: 6 }}>
                      <ProgressBar percent={pct} label={`${label} ${pct}%`} />
                    </div>
                  </div>
                  <div
                    className="cosmic-tab-num"
                    style={{ fontSize: 13, fontWeight: 700, color: accent }}
                  >
                    {pct}%
                  </div>
                </div>
              );
            })}
          </CardElev>
        </>
      )}

      {/* ── Needs help (coral-tinted) — derived from REAL weakest signal ───── */}
      {(needsHelp || lowActivity) && (
        <CardElev
          flat
          style={{
            padding: 16,
            background: 'linear-gradient(180deg, rgba(253,164,175,0.12), transparent)',
            borderColor: 'rgba(253,164,175,0.3)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div
              aria-hidden="true"
              style={{
                width: 32,
                height: 32,
                borderRadius: 99,
                background: 'rgba(253,164,175,0.25)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--coral)',
                flexShrink: 0,
                fontSize: 16,
              }}
            >
              {'❤'}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 11,
                  color: '#FCA5A5',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                {t(isHi, 'Needs help with', 'सहायता चाहिए')}
              </div>
              {needsHelp ? (
                <>
                  <div
                    style={{ fontSize: 13, fontWeight: 600, marginTop: 4, color: 'var(--text)' }}
                  >
                    {isHi
                      ? `${needsHelp.subject} — स्कोर ${needsHelp.score}/100`
                      : `${needsHelp.subject} — score ${needsHelp.score}/100`}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--text-3)',
                      marginTop: 4,
                      lineHeight: 1.45,
                    }}
                  >
                    {t(
                      isHi,
                      `A little extra practice in ${needsHelp.subject} can lift this score. A small nudge goes a long way.`,
                      `${needsHelp.subject} में थोड़ा अतिरिक्त अभ्यास इस स्कोर को बढ़ा सकता है। एक छोटा सा प्रोत्साहन बहुत मदद करता है।`,
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div
                    style={{ fontSize: 13, fontWeight: 600, marginTop: 4, color: 'var(--text)' }}
                  >
                    {t(
                      isHi,
                      `${firstName} hasn't been active this week`,
                      `${firstName} इस सप्ताह सक्रिय नहीं रहा है`,
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--text-3)',
                      marginTop: 4,
                      lineHeight: 1.45,
                    }}
                  >
                    {t(
                      isHi,
                      'A gentle reminder to practice can help build the daily habit.',
                      'अभ्यास के लिए एक कोमल अनुस्मारक दैनिक आदत बनाने में मदद कर सकता है।',
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </CardElev>
      )}

      {/* ── Teacher note — latest REAL teacher message; omitted when none ───── */}
      {teacherNote && (
        <CardElev flat style={{ padding: 14, display: 'flex', gap: 12 }}>
          <div
            aria-hidden="true"
            style={{
              width: 32,
              height: 32,
              borderRadius: 99,
              background: 'linear-gradient(135deg, var(--cyan), var(--violet))',
              flexShrink: 0,
            }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 500 }}>
              {teacherNote.teacherName}
              {teacherNote.subject ? ` · ${teacherNote.subject}` : ''}
            </div>
            <div
              style={{ fontSize: 13, marginTop: 4, lineHeight: 1.4, color: 'var(--text)' }}
            >
              {`“${teacherNote.preview}”`}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-4)', marginTop: 6 }}>
              {relativeTime(teacherNote.at, isHi)}
            </div>
          </div>
        </CardElev>
      )}

      {/* ── Quick nav — same routes as the legacy home (visibility preserved) ─ */}
      <div
        style={{
          display: 'flex',
          gap: 10,
          marginTop: 4,
          flexWrap: 'wrap',
          justifyContent: 'center',
        }}
      >
        <a href="/parent/children" className="cosmic-pill-btn" style={{ textDecoration: 'none' }}>
          {'\u{1F467}'} {t(isHi, 'My Children', 'मेरे बच्चे')}
        </a>
        <a href="/parent/reports" className="cosmic-pill-btn" style={{ textDecoration: 'none' }}>
          {'\u{1F4CA}'} {t(isHi, 'Reports', 'रिपोर्ट')}
        </a>
        <a
          href="/parent/reports#labs"
          className="cosmic-pill-btn"
          style={{ textDecoration: 'none' }}
          aria-label={t(isHi, 'View lab activity', 'लैब गतिविधि देखें')}
        >
          {'\u{1F52C}'} {t(isHi, 'Lab Activity', 'लैब गतिविधि')}
          {labStreak !== null && labStreak > 0 && (
            <span style={{ color: 'var(--saffron)', fontWeight: 700 }}>
              {' '}
              {'\u{1F525}'}
              {labStreak}
            </span>
          )}
        </a>
        <a href="/parent/calendar" className="cosmic-pill-btn" style={{ textDecoration: 'none' }}>
          {'\u{1F4C5}'} {t(isHi, 'Calendar', 'कैलेंडर')}
        </a>
        <a href="/parent/messages" className="cosmic-pill-btn" style={{ textDecoration: 'none' }}>
          {'✉'} {t(isHi, 'Messages', 'संदेश')}
        </a>
      </div>

      {/* Empty state — when the child has zero data, surface the same gentle
          guidance the legacy home shows (real, not fabricated). */}
      {perfScores.length === 0 &&
        (stats.totalQuizzes || 0) === 0 &&
        (stats.xp || 0) === 0 && (
          <CardElev style={{ padding: 22, textAlign: 'center' }}>
            <div aria-hidden="true" style={{ fontSize: 34, marginBottom: 10 }}>
              {'\u{1F331}'}
            </div>
            <div
              className="cosmic-h-display"
              style={{ fontSize: 16, color: 'var(--text)', marginBottom: 6 }}
            >
              {isHi
                ? `${firstName} ने अभी तक पढ़ाई शुरू नहीं की है`
                : `${firstName} hasn't started learning yet`}
            </div>
            <p
              style={{
                fontSize: 13,
                color: 'var(--text-3)',
                lineHeight: 1.5,
                maxWidth: 320,
                margin: '0 auto',
              }}
            >
              {t(
                isHi,
                "Once they take their first quiz or chat with Foxy, you'll see their progress here.",
                'जब वे अपनी पहली क्विज़ देंगे या Foxy से चैट करेंगे, तो आप यहाँ उनकी प्रगति देख सकेंगे।',
              )}
            </p>
          </CardElev>
        )}
    </div>
  );
}

function ParentKpi({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div
        className="cosmic-h-display cosmic-tab-num"
        style={{ fontSize: 22, color, lineHeight: 1 }}
      >
        {value}
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.3 }}>
        {label}
      </div>
    </div>
  );
}

/** Relative-time helper (bilingual). Mirrors the legacy messages page. */
function relativeTime(iso: string, isHi: boolean): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return iso;
  const diffMs = Date.now() - then;
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return t(isHi, 'just now', 'अभी');
  if (min < 60) return t(isHi, `${min}m ago`, `${min} मि पूर्व`);
  const hr = Math.floor(min / 60);
  if (hr < 24) return t(isHi, `${hr}h ago`, `${hr} घं पूर्व`);
  const day = Math.floor(hr / 24);
  return t(isHi, `${day}d ago`, `${day} दि पूर्व`);
}
