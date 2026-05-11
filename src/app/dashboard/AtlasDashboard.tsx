'use client';

/**
 * AtlasDashboard — the Editorial Atlas redesign of the student landing.
 *
 * Renders when `ff_editorial_atlas_v1` (or `ff_editorial_atlas_student`) is on.
 * The legacy `<Dashboard>` continues to render otherwise — see page.tsx for
 * the flag gate.
 *
 * Hierarchy (matching the prototype):
 *   1. Today's mission card    — Fraunces serif headline + primary CTA.
 *   2. The Atlas chapter graph — SVG, “you are here” + 2 nearby unlocks.
 *   3. Streak + week rhythm    — calm tabular stats, never demand attention.
 *   4. This week's wins        — three latest mastery events.
 *   5. Quick actions row       — 4 compact tiles: compete, scan, revise, foxy.
 *
 * Data dependencies (already produced by the existing dashboard RPC):
 *   - `useDashboardData(studentId)` for snapshot + nextTopics + nudges.
 *   - `concept_mastery` rows for the Atlas graph node colouring.
 *
 * Below-fold gating remains lazy via dynamic import so first paint
 * stays under the P10 budget.
 */

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import {
  supabase,
  getNextTopics,
} from '@/lib/supabase';
import { useDashboardData } from '@/lib/swr';
import { useAllowedSubjects } from '@/lib/useAllowedSubjects';
import { BottomNav } from '@/components/ui';
import { DashboardSkeleton } from '@/components/Skeleton';
import {
  AtlasShell,
  AtlasCard,
  AtlasPill,
  AtlasButton,
  AtlasIcon,
  EditorialHeadline,
  EditorialHighlight,
} from '@/components/atlas';
import type { CurriculumTopic, StudentLearningProfile } from '@/lib/types';

interface AtlasChapterNode {
  number: number;
  title: string;
  status: 'mastered' | 'current' | 'upcoming';
}

export default function AtlasDashboard() {
  const router = useRouter();
  const {
    student,
    snapshot,
    isLoggedIn,
    isLoading,
    isHi,
    language,
    setLanguage,
    activeRole,
  } = useAuth();
  const { unlocked: allowedSubjects } = useAllowedSubjects();

  const [nextTopics, setNextTopics] = useState<CurriculumTopic[]>([]);
  const [profiles, setProfiles] = useState<StudentLearningProfile[]>([]);
  const [chapters, setChapters] = useState<AtlasChapterNode[]>([]);
  const [recentWins, setRecentWins] = useState<
    Array<{ id: string; title: string; sub: string }>
  >([]);
  const [last7Active, setLast7Active] = useState<boolean[]>(Array(7).fill(false));
  const [todayMastery, setTodayMastery] = useState<{ from: number; to: number } | null>(null);

  // ─── Auth + role redirects (same semantics as legacy dashboard) ────────
  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/login');
    if (!isLoading && isLoggedIn && activeRole === 'teacher')  router.replace('/teacher');
    if (!isLoading && isLoggedIn && activeRole === 'guardian') router.replace('/parent');
    if (!isLoading && isLoggedIn && activeRole === 'student' && student && !student.onboarding_completed) {
      router.replace('/onboarding');
    }
  }, [isLoading, isLoggedIn, activeRole, student, router]);

  const { data: dashData } = useDashboardData(student?.id);

  useEffect(() => {
    if (dashData) setProfiles(dashData.profiles ?? []);
  }, [dashData]);

  useEffect(() => {
    if (!student) return;
    let cancelled = false;
    (async () => {
      const next = await getNextTopics(student.id, student.preferred_subject, student.grade);
      if (!cancelled) setNextTopics(next.slice(0, 3));

      // Chapter mastery summary — used by the Atlas graph. Aggregate by
      // chapter number so the SVG shows mastered / current / upcoming.
      try {
        const { data: cmData } = await supabase
          .from('concept_mastery')
          .select('mastery_probability, curriculum_topics!inner(chapter_number, title)')
          .eq('student_id', student.id);
        if (cancelled) return;
        if (cmData && cmData.length > 0) {
          const byChapter: Record<number, { masteryTotal: number; n: number; title: string }> = {};
          for (const row of cmData as Array<{ mastery_probability: number; curriculum_topics?: { chapter_number?: number; title?: string } }>) {
            const num = row.curriculum_topics?.chapter_number;
            const title = row.curriculum_topics?.title;
            if (typeof num !== 'number' || !title) continue;
            const slot = byChapter[num] ?? (byChapter[num] = { masteryTotal: 0, n: 0, title });
            slot.masteryTotal += row.mastery_probability ?? 0;
            slot.n += 1;
          }
          const nums = Object.keys(byChapter).map(Number).sort((a, b) => a - b);
          // Determine the current chapter — the first below mastery threshold.
          const currentNum = nums.find(n => byChapter[n].masteryTotal / byChapter[n].n < 0.7) ?? nums[nums.length - 1];
          const window = nums.filter(n => Math.abs(n - currentNum) <= 2).slice(0, 6);
          setChapters(
            window.map(n => ({
              number: n,
              title: byChapter[n].title,
              status:
                byChapter[n].masteryTotal / byChapter[n].n >= 0.7
                  ? 'mastered'
                  : n === currentNum
                    ? 'current'
                    : 'upcoming',
            })),
          );
        }
      } catch { /* non-fatal */ }

      // Recent wins — last 3 mastery_changed events. Reads the Phase 2
      // unified-state projection when the student has an auth_user_id; the
      // table's RLS lets learners read their own rows. Falls back gracefully
      // (empty list) when the projection hasn't been populated yet.
      if (student.auth_user_id) {
        try {
          const { data: wins } = await supabase
            .from('learner_mastery')
            .select('subject_code, chapter_number, mastery, last_updated_at')
            .eq('auth_user_id', student.auth_user_id)
            .gte('mastery', 0.7)
            .order('last_updated_at', { ascending: false })
            .limit(3);
          if (cancelled) return;
          if (wins && wins.length > 0) {
            setRecentWins(
              wins.map((row: { subject_code: string; chapter_number: number; mastery: number }, idx) => ({
                id: `${row.subject_code}-${row.chapter_number}-${idx}`,
                title: `${capitalize(row.subject_code)} · Chapter ${row.chapter_number}`,
                sub: `Mastery reached ${Math.round((row.mastery ?? 0) * 100)}%`,
              })),
            );
          }
        } catch { /* non-fatal */ }
      }

      // Last 7 days activity — derive from quiz_sessions.created_at. Used to
      // colour the streak strip on the rhythm card.
      try {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const { data: sessions } = await supabase
          .from('quiz_sessions')
          .select('created_at')
          .eq('student_id', student.id)
          .gte('created_at', sevenDaysAgo.toISOString())
          .order('created_at', { ascending: false });
        if (cancelled) return;
        if (sessions) {
          const activeDays = new Set(sessions.map((s: { created_at: string }) => s.created_at.slice(0, 10)));
          const out: boolean[] = [];
          const today = new Date();
          for (let i = 6; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            out.push(activeDays.has(d.toISOString().slice(0, 10)));
          }
          setLast7Active(out);
        }
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, [student?.id, student?.preferred_subject, student?.grade, student?.auth_user_id]);

  // Lookup current mastery for today's topic, if available.
  useEffect(() => {
    if (!student || nextTopics.length === 0) {
      setTodayMastery(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const topic = nextTopics[0];
        const { data } = await supabase
          .from('concept_mastery')
          .select('mastery_probability')
          .eq('student_id', student.id)
          .eq('topic_id', topic.id)
          .maybeSingle();
        if (cancelled) return;
        const cur = data?.mastery_probability ?? 0.5;
        setTodayMastery({ from: Math.round(cur * 100), to: Math.min(100, Math.round((cur + 0.2) * 100)) });
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, [student?.id, nextTopics]);

  if (isLoading) return <DashboardSkeleton />;
  if (!student) return <DashboardSkeleton />;

  // ─── Derived ───────────────────────────────────────────────────────────
  const todaysTopic: CurriculumTopic | undefined = nextTopics[0];
  const streak = snapshot?.current_streak ?? Math.max(...profiles.map(p => p.streak_days ?? 0), 0);
  const subjectCode = student.preferred_subject ?? 'science';

  return (
    <AtlasShell
      variant="student"
      greeting={isHi ? 'विद्यार्थी' : `Hi, ${student.name.split(' ')[0]}`}
      actions={
        <>
          <button
            onClick={() => setLanguage(language === 'hi' ? 'en' : 'hi')}
            aria-label={isHi ? 'Switch to English' : 'हिन्दी में बदलें'}
            style={chromeBtn()}
          >
            {isHi ? 'EN' : 'हि'}
          </button>
          <button
            onClick={() => router.push('/notifications')}
            aria-label={isHi ? 'सूचनाएँ' : 'Notifications'}
            style={chromeBtn()}
          >
            <AtlasIcon name="bell" size={16} />
          </button>
          <button
            onClick={() => router.push('/profile')}
            aria-label={isHi ? 'प्रोफ़ाइल' : 'Profile'}
            style={{ ...chromeBtn(), padding: 6 }}
          >
            <span
              style={{
                width: 28, height: 28, borderRadius: '50%',
                background: 'linear-gradient(135deg, var(--accent), #C9831A)',
                color: 'white',
                fontFamily: 'var(--font-serif)',
                fontSize: 13, fontWeight: 500,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              {student.name.charAt(0).toUpperCase()}
            </span>
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* ─── 1. Today's mission ─── */}
        <AtlasCard
          style={{
            position: 'relative', overflow: 'hidden',
            padding: '32px 28px 28px',
            backgroundImage:
              'radial-gradient(ellipse at top right, rgba(232, 88, 28, 0.06), transparent 55%)',
          }}
        >
          <p className="atlas-eyebrow atlas-eyebrow-accent" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              aria-hidden="true"
              className="atlas-pulse"
              style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' }}
            />
            {isHi ? 'आज का मिशन' : "Today's mission"}
            {todaysTopic && (
              <>
                {' · '}
                <span className="atlas-tabnum">
                  {Math.max(8, Math.round((todaysTopic.estimated_minutes ?? 12)))} min
                </span>
              </>
            )}
          </p>

          <EditorialHeadline size="xl" as="h1" style={{ margin: '6px 0 14px', maxWidth: '14ch' }}>
            {todaysTopic?.title ?? (isHi ? 'अगला अध्याय शुरू करो' : 'Pick up where you left off')}
          </EditorialHeadline>

          <p style={{ color: 'var(--ink-2)', fontSize: 15, margin: '0 0 24px', maxWidth: '42ch' }}>
            {isHi
              ? 'एक छोटा-सा वॉकथ्रू, फिर एक छोटी क्विज़। पिछली बार के बाद बस वही ले रहे हैं।'
              : todaysTopic
                ? `A short walkthrough, then one focused quiz — picking up exactly where you left off in ${capitalize(subjectCode)}.`
                : 'A fresh start to today’s learning. Choose a subject below to begin.'}
          </p>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 22 }}>
            <MissionMeta label={isHi ? 'विषय' : 'Subject'} value={capitalize(subjectCode)} />
            <MissionMeta
              label={isHi ? 'अध्याय' : 'Chapter'}
              value={todaysTopic?.chapter_number ? `${todaysTopic.chapter_number}` : '—'}
            />
            <MissionMeta
              label={isHi ? 'महारत' : 'Mastery'}
              value={todayMastery ? `${todayMastery.from} → ${todayMastery.to}%` : '—'}
            />
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <AtlasButton
              variant="primary"
              icon="arrow-right"
              onClick={() => {
                if (todaysTopic) {
                  router.push(`/learn/${subjectCode}/${todaysTopic.chapter_number ?? 1}`);
                } else {
                  router.push('/learn');
                }
              }}
            >
              {isHi ? 'पाठ शुरू करो' : 'Begin lesson'}
            </AtlasButton>
            <AtlasButton variant="ghost" icon="refresh" iconPosition="left" onClick={() => router.push('/quiz')}>
              {isHi ? 'क्विज़ की समीक्षा' : 'Quiz revision'}
            </AtlasButton>
          </div>
        </AtlasCard>

        {/* ─── 2. The Atlas ─── */}
        <AtlasCard>
          <p className="atlas-eyebrow">
            {isHi ? 'अध्यायों का नक्शा' : 'The Atlas'} · Class {student.grade ?? '—'}
          </p>
          <h2
            style={{
              fontFamily: 'var(--font-serif)',
              fontWeight: 500,
              fontSize: 22,
              margin: '0 0 16px',
              letterSpacing: '-0.01em',
            }}
          >
            {isHi ? 'आप' : 'You are'}{' '}
            <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>{isHi ? 'यहाँ' : 'here'}</em>
          </h2>
          <AtlasChapterMap chapters={chapters} />
          <div
            style={{
              display: 'flex',
              gap: 16,
              flexWrap: 'wrap',
              marginTop: 12,
              fontFamily: 'var(--font-display)',
              fontSize: 11,
              color: 'var(--ink-3)',
            }}
          >
            <Legend swatch="#1F7A4C" label={`${isHi ? 'पूरा' : 'Mastered'} · ${chapters.filter(c => c.status === 'mastered').length}`} />
            <Legend swatch="#E8581C" label={isHi ? 'अभी' : 'Today'} />
            <Legend swatch="transparent" border="1.5px dashed var(--ink-4)" label={isHi ? 'आने वाला' : 'Upcoming'} />
          </div>
        </AtlasCard>

        {/* ─── 3. Rhythm (streak + last 7 days) ─── */}
        <AtlasCard>
          <p className="atlas-eyebrow">{isHi ? 'आपकी रफ़्तार' : 'Your rhythm'}</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 18, alignItems: 'center' }}>
            <StreakRing streak={streak} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span
                className="atlas-tabnum"
                style={{
                  fontFamily: 'var(--font-serif)',
                  fontWeight: 500,
                  fontSize: 30,
                  lineHeight: 1,
                  letterSpacing: '-0.02em',
                }}
              >
                {streak} {isHi ? 'दिन की लय' : 'day streak'}
              </span>
              <span
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 11,
                  color: 'var(--ink-3)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.12em',
                }}
              >
                {streak === 0
                  ? isHi
                    ? 'आज से शुरू करो'
                    : 'Start one today'
                  : isHi
                    ? 'चलते रहो'
                    : 'Keep it warm'}
              </span>
              <div style={{ display: 'flex', gap: 4, marginTop: 10 }} aria-label="Last 7 days">
                {last7Active.map((on, i) => (
                  <span
                    key={i}
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 5,
                      background: on ? 'var(--accent)' : 'var(--cream-3)',
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        </AtlasCard>

        {/* ─── 4. This week's wins ─── */}
        {recentWins.length > 0 && (
          <AtlasCard>
            <p className="atlas-eyebrow">{isHi ? 'इस हफ़्ते की जीतें' : "This week's wins"}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {recentWins.map(w => (
                <div
                  key={w.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '12px 14px',
                    background: 'var(--cream)',
                    borderRadius: 'var(--radius-atlas)',
                    border: '1px solid var(--line)',
                  }}
                >
                  <span
                    style={{
                      width: 32, height: 32, borderRadius: '50%',
                      background: 'var(--green-soft)', color: '#1F7A4C',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <AtlasIcon name="check" size={16} strokeWidth={2} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>
                      {w.title}
                    </strong>
                    <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{w.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </AtlasCard>
        )}

        {/* ─── 5. Quick actions ─── */}
        <AtlasCard>
          <p className="atlas-eyebrow">{isHi ? 'जल्दी' : 'Quick'}</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            <QuickTile icon="grid" label={isHi ? 'मुक़ाबला' : 'Compete'} onClick={() => router.push('/leaderboard')} />
            <QuickTile icon="scan" label={isHi ? 'स्कैन हल' : 'Scan'}    onClick={() => router.push('/scan')} />
            <QuickTile icon="clock" label={isHi ? 'दोहराओ' : 'Revise'}    onClick={() => router.push('/review')} />
            <QuickTile icon="foxy" label="Foxy"                          onClick={() => router.push('/foxy')} />
          </div>
        </AtlasCard>

        <p
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 11,
            color: 'var(--ink-4)',
            textAlign: 'center',
            margin: '12px 0 0',
            letterSpacing: '0.04em',
          }}
        >
          {isHi ? 'Foxy हमेशा यहाँ है — नीचे चैट करो।' : 'Foxy is one tap away — anytime.'}
        </p>
      </div>

      {/* Pinned Foxy chat affordance + BottomNav */}
      <button
        type="button"
        className="atlas-foxy-fab"
        onClick={() => router.push('/foxy')}
        aria-label={isHi ? 'Foxy से बात करो' : 'Ask Foxy'}
      >
        {isHi ? 'Foxy से पूछो' : 'Ask Foxy'}
      </button>
      <BottomNav />
    </AtlasShell>
  );
}

/* ─── Helpers ─────────────────────────────────────────────────────────── */

function capitalize(s: string | null | undefined): string {
  if (!s) return '—';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

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

function MissionMeta({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.16em',
          color: 'var(--ink-3)',
        }}
      >
        {label}
      </span>
      <span
        className="atlas-tabnum"
        style={{ fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 500, color: 'var(--ink)' }}
      >
        {value}
      </span>
    </div>
  );
}

function Legend({ swatch, label, border }: { swatch: string; label: string; border?: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: swatch,
          border: border ?? 'none',
        }}
      />
      {label}
    </span>
  );
}

function StreakRing({ streak }: { streak: number }) {
  const target = 30;
  const arc = Math.min(streak, target) / target;
  const c = 2 * Math.PI * 34;
  return (
    <svg width="80" height="80" viewBox="0 0 80 80" role="img" aria-label={`${streak} day streak`}>
      <circle cx="40" cy="40" r="34" fill="none" stroke="var(--cream-3)" strokeWidth="6" />
      <circle
        cx="40"
        cy="40"
        r="34"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="6"
        strokeDasharray={`${(arc * c).toFixed(1)} ${c.toFixed(1)}`}
        strokeLinecap="round"
        transform="rotate(-90 40 40)"
      />
      <text
        x="40"
        y="46"
        textAnchor="middle"
        fontFamily="Fraunces"
        fontSize="22"
        fontWeight="500"
        fill="var(--ink)"
        className="atlas-tabnum"
      >
        {streak}
      </text>
    </svg>
  );
}

function QuickTile({
  icon,
  label,
  onClick,
}: {
  icon: 'grid' | 'scan' | 'clock' | 'foxy';
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'var(--cream-2)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius-atlas)',
        padding: '14px 6px',
        textAlign: 'center',
        cursor: 'pointer',
        transition: 'all 200ms var(--ease-atlas)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--paper)';
        e.currentTarget.style.transform = 'translateY(-1px)';
        e.currentTarget.style.boxShadow = 'var(--shadow-atlas-1)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'var(--cream-2)';
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      <AtlasIcon name={icon} size={20} style={{ color: 'var(--accent)' }} />
      <small style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 11, color: 'var(--ink-2)' }}>
        {label}
      </small>
    </button>
  );
}

/**
 * The Atlas SVG — chapter graph. Renders up to ~5 chapter nodes centred
 * around the “current” chapter, with contour-style background lines for
 * the cartographic feel called for in the design proposal.
 */
function AtlasChapterMap({ chapters }: { chapters: AtlasChapterNode[] }) {
  const layout = useMemo(() => layoutChapters(chapters), [chapters]);
  if (chapters.length === 0) {
    return (
      <div
        style={{
          height: 140,
          background: 'var(--cream)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--radius-atlas)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--font-display)',
          fontSize: 12,
          color: 'var(--ink-3)',
        }}
      >
        Start a lesson to map your journey.
      </div>
    );
  }
  return (
    <div
      style={{
        background: 'var(--cream)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius-atlas)',
        padding: 14,
      }}
    >
      <svg viewBox="0 0 600 180" width="100%" height={170} role="img" aria-label="Chapter map">
        <g fill="none" stroke="rgba(26,18,7,0.06)" strokeWidth={1}>
          <path d="M0,40 C100,60 200,20 300,40 S500,60 600,30" />
          <path d="M0,90 C100,110 200,70 300,90 S500,110 600,80" />
          <path d="M0,140 C100,160 200,120 300,140 S500,160 600,130" />
        </g>
        {/* paths between nodes */}
        {layout.paths.map((p, i) => (
          <path
            key={i}
            d={p.d}
            fill="none"
            stroke={p.tone === 'done' ? 'var(--accent)' : 'var(--ink-4)'}
            strokeWidth={2}
            strokeLinecap="round"
            strokeDasharray={p.tone === 'upcoming' ? '4 4' : undefined}
          />
        ))}
        {/* nodes */}
        {layout.nodes.map((n, i) => {
          const isCurrent = n.status === 'current';
          const fill =
            n.status === 'mastered' ? '#1F7A4C' :
            isCurrent              ? 'var(--accent)' :
                                     'transparent';
          const stroke = n.status === 'upcoming' ? 'var(--ink-4)' : 'none';
          const dash   = n.status === 'upcoming' ? '3 3' : undefined;
          return (
            <g key={i} fontFamily="Sora" fontWeight={600} fontSize={11}>
              <circle cx={n.x} cy={n.y} r={isCurrent ? 22 : 14} fill={fill} stroke={stroke} strokeWidth={2} strokeDasharray={dash} />
              {isCurrent && (
                <circle cx={n.x} cy={n.y} r={32} fill="none" stroke="var(--accent)" strokeOpacity={0.25} strokeWidth={2}>
                  <animate attributeName="r" values="22;38;22" dur="2.6s" repeatCount="indefinite" />
                  <animate attributeName="stroke-opacity" values="0.4;0;0.4" dur="2.6s" repeatCount="indefinite" />
                </circle>
              )}
              <text
                x={n.x}
                y={n.y + (isCurrent ? 5 : 4)}
                textAnchor="middle"
                fill={isCurrent || n.status === 'mastered' ? 'white' : 'var(--ink-4)'}
                fontSize={isCurrent ? 13 : 11}
              >
                {n.number}
              </text>
              <text
                x={n.x}
                y={n.y + (isCurrent ? 42 : 32)}
                textAnchor="middle"
                fontSize={9}
                fontWeight={isCurrent ? 700 : 400}
                fill={n.status === 'upcoming' ? 'var(--ink-4)' : 'var(--ink-2)'}
              >
                {n.title.slice(0, 14)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function layoutChapters(chapters: AtlasChapterNode[]) {
  const xs = [60, 150, 240, 340, 440, 530];
  const ys = [100, 80, 110, 80, 100, 80];
  const nodes = chapters.slice(0, 6).map((c, i) => ({ ...c, x: xs[i], y: ys[i] }));
  const paths: { d: string; tone: 'done' | 'upcoming' }[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i];
    const b = nodes[i + 1];
    const tone: 'done' | 'upcoming' =
      a.status !== 'upcoming' && b.status !== 'upcoming' ? 'done' : 'upcoming';
    paths.push({
      d: `M${a.x + 14},${a.y} Q${(a.x + b.x) / 2},${(a.y + b.y) / 2 - 12} ${b.x - 14},${b.y}`,
      tone,
    });
  }
  return { nodes, paths };
}

// Suppress an unused-import warning while still keeping the named export
// hot for future use by EditorialHighlight (the verdict surface is on the
// parent page, but the import is here for parity).
void EditorialHighlight;
void AtlasPill;
