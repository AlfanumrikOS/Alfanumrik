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
import { useDashboardData, useFeatureFlags } from '@/lib/swr';
import { useAllowedSubjects } from '@/lib/useAllowedSubjects';
import { reviewRoute } from '@/lib/routes/study-menu-routes';
import { BottomNav } from '@/components/ui';
import { DashboardSkeleton } from '@/components/Skeleton';
import {
  AtlasShell,
  AtlasCard,
  AtlasPill,
  AtlasIcon,
  EditorialHighlight,
} from '@/components/atlas';
import type { CurriculumTopic, StudentLearningProfile } from '@/lib/types';
import {
  buildAtlasChapters,
  type AtlasChapterNode,
} from '@/lib/dashboard/atlas-chapters';

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
  // Phase 5 Study-Menu v2 — route /review to /refresh when flag is on.
  const { data: flags } = useFeatureFlags();
  const flagsRecord = (flags ?? {}) as Record<string, boolean>;

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

      // Atlas chapter graph — single unified path that always renders
      // the full syllabus for the student's (grade, preferred_subject)
      // and overlays per-chapter mastery on top. Chapters automatically
      // move from `upcoming` to `current` to `mastered` as the student
      // accrues `concept_mastery` rows — no separate cold-start branch
      // and no windowing-to-only-mastered-chapters that used to hide
      // upcoming work from the graph.
      //
      // Two parallel fetches:
      //   - curriculum_topics filtered by grade + subjects.code (join
      //     filter mirrors `getNextTopics`).
      //   - concept_mastery for the student (any rows; can be empty).
      // Then a pure helper (`buildAtlasChapters`) does the windowing,
      // de-duping, status assignment so it can be unit-tested in
      // isolation — see src/lib/dashboard/atlas-chapters.test.ts.
      try {
        const subjectCode = student.preferred_subject ?? 'math';
        const [ctResult, cmResult] = await Promise.all([
          supabase
            .from('curriculum_topics')
            .select('chapter_number, title, display_order, subjects!inner(code)')
            .eq('grade', student.grade)
            .eq('is_active', true)
            .eq('subjects.code', subjectCode)
            .order('display_order'),
          supabase
            .from('concept_mastery')
            .select('mastery_probability, curriculum_topics!inner(chapter_number)')
            .eq('student_id', student.id),
        ]);
        if (cancelled) return;
        const curriculumRows = (ctResult.data as Array<{ chapter_number: number | null; title: string | null }> | null) ?? [];
        const masteryRows = (
          (cmResult.data as Array<{ mastery_probability: number | null; curriculum_topics?: { chapter_number?: number | null } | null }> | null) ?? []
        ).map((r) => ({
          chapter_number: r.curriculum_topics?.chapter_number ?? null,
          mastery_probability: r.mastery_probability,
        }));
        const built = buildAtlasChapters(curriculumRows, masteryRows);
        if (built.length > 0) setChapters(built);
        // If `built` is empty (curriculum query returned nothing — e.g.
        // a grade we haven't seeded yet), `resolvedChapters` takes over
        // at render time with its synthesised 5-node placeholder window.
        // Same fallback behaviour as the original code path.
      } catch { /* non-fatal — leave chapters empty, resolvedChapters handles it */ }

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
      <div className="atlas-dashboard-grid">
        {/* ─── LEFT COLUMN (7/12 on desktop) ─── */}
        <div className="atlas-dashboard-main" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* ─── 1. Today's mission ───
            Editorial dark-ink hero: magazine-style headline on warm ink
            background, single dominant orange CTA. This is the page's
            primary anchor — every other surface stays quieter. */}
        <section className="editorial-card editorial-card--ink atlas-mission-hero">
          <p className="atlas-mission-eyebrow">
            <span
              aria-hidden="true"
              className="atlas-pulse atlas-mission-eyebrow__dot"
            />
            {isHi ? 'आज' : 'Today'}
            {student.grade && (
              <>
                {' · '}
                {isHi ? `कक्षा ${student.grade}` : `Class ${student.grade}`}
              </>
            )}
            {todaysTopic && (
              <>
                {' · '}
                <span className="atlas-tabnum">
                  {Math.max(8, Math.round((todaysTopic.estimated_minutes ?? 12)))} min
                </span>
              </>
            )}
          </p>

          <h1 className="atlas-mission-headline">
            {todaysTopic?.title ?? (isHi ? 'अगला अध्याय शुरू करो' : 'Pick up where you left off')}
          </h1>

          <p className="atlas-mission-blurb">
            {isHi
              ? 'एक छोटा-सा वॉकथ्रू, फिर एक छोटी क्विज़। पिछली बार के बाद बस वही ले रहे हैं।'
              : todaysTopic
                ? `A short walkthrough, then one focused quiz — picking up exactly where you left off in ${capitalize(subjectCode)}.`
                : 'A fresh start to today’s learning. Choose a subject below to begin.'}
          </p>

          <div className="atlas-mission-meta-row">
            <MissionMeta dark label={isHi ? 'विषय' : 'Subject'} value={capitalize(subjectCode)} />
            <MissionMeta
              dark
              label={isHi ? 'अध्याय' : 'Chapter'}
              value={todaysTopic?.chapter_number ? `${todaysTopic.chapter_number}` : '—'}
            />
            <MissionMeta
              dark
              label={isHi ? 'महारत' : 'Mastery'}
              value={todayMastery ? `${todayMastery.from} → ${todayMastery.to}%` : '—'}
            />
          </div>

          <div className="atlas-mission-cta-row">
            <button
              type="button"
              className="atlas-mission-cta"
              onClick={() => {
                if (todaysTopic) {
                  router.push(`/learn/${subjectCode}/${todaysTopic.chapter_number ?? 1}`);
                } else {
                  router.push('/learn');
                }
              }}
            >
              <span>{isHi ? 'पाठ शुरू करो' : 'Begin lesson'}</span>
              <AtlasIcon name="arrow-right" size={18} strokeWidth={2.25} />
            </button>
            <button
              type="button"
              className="atlas-mission-ghost"
              onClick={() => router.push('/quiz')}
            >
              <AtlasIcon name="refresh" size={16} strokeWidth={2} />
              <span>{isHi ? 'क्विज़ की समीक्षा' : 'Quiz revision'}</span>
            </button>
          </div>
        </section>

        {/* ─── 1b. At-a-glance stats strip ───
            Three editorial cells in a single row — streak / week-active /
            total XP. Sits directly below the hero so the student sees
            their numbers immediately on first paint. */}
        <div className="dashboard-stat-strip" aria-label={isHi ? 'इस हफ़्ते के आँकड़े' : "This week's numbers"}>
          <div className="dashboard-stat-cell">
            <span className="dashboard-stat-cell__value atlas-tabnum">{streak}</span>
            <span className="dashboard-stat-cell__label">{isHi ? 'दिन की लय' : 'Day streak'}</span>
          </div>
          <div className="dashboard-stat-cell">
            <span className="dashboard-stat-cell__value atlas-tabnum">
              {last7Active.filter(Boolean).length}
              <small className="atlas-stat-suffix">/7</small>
            </span>
            <span className="dashboard-stat-cell__label">{isHi ? 'सक्रिय दिन' : 'Active days'}</span>
          </div>
          <div className="dashboard-stat-cell">
            <span className="dashboard-stat-cell__value atlas-tabnum">
              {(student.xp_total ?? snapshot?.total_xp ?? 0).toLocaleString('en-IN')}
            </span>
            <span className="dashboard-stat-cell__label">{isHi ? 'कुल XP' : 'Total XP'}</span>
          </div>
        </div>

        {/* ─── 2. The Atlas ───
            Wrapped in an editorial-card so the chapter graph reads as a
            framed editorial spread, not a free-floating SVG. The graph
            itself is untouched — only the surrounding chrome changed. */}
        <section className="editorial-card">
          <p className="editorial-eyebrow">
            {isHi ? 'आपका नक्शा' : 'Your atlas'} · {isHi ? `कक्षा ${student.grade ?? '—'}` : `Class ${student.grade ?? '—'}`}
          </p>
          <h2 className="editorial-section-title atlas-section-spaced">
            {isHi ? 'आप' : 'You are'}{' '}
            <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>{isHi ? 'यहाँ' : 'here'}</em>
          </h2>
          <AtlasChapterMap chapters={resolvedChapters(chapters, todaysTopic)} />
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
        </section>

        </div>

        {/* ─── RIGHT COLUMN (5/12 on desktop) ─── */}
        <aside className="atlas-dashboard-side" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

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

        {/* ─── 4. This week's wins ───
            Always rendered (no `recentWins.length > 0 &&` gate). The old
            conditional made the card pop in mid-load and push everything
            below it, which read as the dashboard "fluctuating" on every
            visit. Now the card holds its layout slot from first paint —
            empty-state copy on cold-start, real wins once data lands.
            One card swap, no layout shift. */}
        <AtlasCard>
          <p className="atlas-eyebrow">{isHi ? 'इस हफ़्ते की जीतें' : "This week's wins"}</p>
          {recentWins.length > 0 ? (
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
          ) : (
            <div
              style={{
                padding: '14px',
                background: 'var(--cream)',
                borderRadius: 'var(--radius-atlas)',
                border: '1px dashed var(--line)',
                fontFamily: 'var(--font-display)',
                fontSize: 12,
                color: 'var(--ink-3)',
                textAlign: 'center',
                lineHeight: 1.5,
              }}
            >
              {isHi
                ? 'अपनी पहली अवधारणा पूरी करो — जीतें यहाँ दिखेंगी।'
                : 'Master your first concept — your wins will land here.'}
            </div>
          )}
        </AtlasCard>

        {/* ─── 5. Quick actions ───
            Six editorial tiles in a real responsive grid (2 / 3 / 6 cols).
            Square aspect-ratio + min 44px tap target — fingers find
            squares faster than the old pills, and the grid scales cleanly
            from 360px to 1440px. */}
        <section>
          <p className="editorial-eyebrow atlas-section-eyebrow">{isHi ? 'जल्दी से जाओ' : 'Jump in'}</p>
          <div className="dashboard-tile-grid">
            <button type="button" className="dashboard-tile" onClick={() => router.push('/leaderboard')}>
              <span className="dashboard-tile__icon" aria-hidden="true">🏆</span>
              <span className="dashboard-tile__label">{isHi ? 'मुक़ाबला' : 'Compete'}</span>
            </button>
            <button type="button" className="dashboard-tile" onClick={() => router.push('/scan')}>
              <span className="dashboard-tile__icon" aria-hidden="true">📷</span>
              <span className="dashboard-tile__label">{isHi ? 'स्कैन' : 'Scan'}</span>
            </button>
            <button type="button" className="dashboard-tile" onClick={() => router.push(reviewRoute(flagsRecord))}>
              <span className="dashboard-tile__icon" aria-hidden="true">🔁</span>
              <span className="dashboard-tile__label">{isHi ? 'दोहराओ' : 'Revise'}</span>
            </button>
            <button type="button" className="dashboard-tile" onClick={() => router.push('/foxy')}>
              <span className="dashboard-tile__icon" aria-hidden="true">🦊</span>
              <span className="dashboard-tile__label">Foxy</span>
            </button>
            <button type="button" className="dashboard-tile" onClick={() => router.push('/quiz')}>
              <span className="dashboard-tile__icon" aria-hidden="true">✏️</span>
              <span className="dashboard-tile__label">{isHi ? 'अभ्यास' : 'Practice'}</span>
            </button>
            <button type="button" className="dashboard-tile" onClick={() => router.push('/simulations')}>
              <span className="dashboard-tile__icon" aria-hidden="true">🔬</span>
              <span className="dashboard-tile__label">{isHi ? 'प्रयोगशाला' : 'Lab'}</span>
            </button>
          </div>
        </section>

        {/* ─── 6. Foxy whisper (engagement loop) ─── */}
        <AtlasCard tone="teal" style={{ padding: '18px 20px' }}>
          <p className="atlas-eyebrow" style={{ color: 'var(--teal-deep)', marginBottom: 6 }}>
            <span aria-hidden="true" style={{ marginRight: 6 }}>🦊</span>
            {isHi ? 'Foxy की फुसफुसाहट' : 'Foxy whispers'}
          </p>
          <p
            style={{
              fontFamily: 'var(--font-serif)',
              fontWeight: 400,
              fontStyle: 'italic',
              fontSize: 16,
              lineHeight: 1.35,
              color: 'var(--teal-deep)',
              margin: 0,
            }}
          >
            {foxyWhisper(student.name, streak, recentWins.length, isHi)}
          </p>
        </AtlasCard>

        </aside>
      </div>

      <p
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 11,
          color: 'var(--ink-4)',
          textAlign: 'center',
          margin: '24px 0 0',
          letterSpacing: '0.04em',
        }}
      >
        {isHi ? 'Foxy हमेशा यहाँ है — नीचे चैट करो।' : 'Foxy is one tap away — anytime.'}
      </p>

      {/* Responsive grid: 7/5 on desktop, single column below 980px. Plain
          <style> tag (no styled-jsx — see AtlasShell for rationale). */}
      <style
        dangerouslySetInnerHTML={{
          __html: [
            '.atlas-dashboard-grid{display:grid;grid-template-columns:1fr;gap:20px;}',
            '@media (min-width: 980px){',
              '.atlas-dashboard-grid{grid-template-columns:7fr 5fr;gap:24px;align-items:start;}',
              '.atlas-dashboard-side{position:sticky;top:88px;}',
            '}',
          ].join(''),
        }}
      />

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

/**
 * Synthesize a useful chapter graph when concept_mastery has no rows yet
 * (cold-start students). Anchors on today's topic and shows it as the
 * "current" node with neighbour chapters around it. Prevents the
 * "blank canvas — start a lesson" empty state which reads as broken.
 *
 * Always returns up to 5 nodes (2 prior + current + 2 upcoming) so that
 * when real `chapters` data arrives later, the SVG keeps the same layout
 * footprint. Without the 5-node lock the seed would render e.g. 3 nodes,
 * the real data 5, and the user saw the chapter map visibly grow on
 * load — read as "flickering."
 *
 * When real chapters data exists, returns it (already capped to 6 in
 * the loader). Otherwise we synthesise the seed.
 */
function resolvedChapters(
  chapters: AtlasChapterNode[],
  todaysTopic: CurriculumTopic | undefined,
): AtlasChapterNode[] {
  if (chapters.length > 0) return chapters;
  const num = todaysTopic?.chapter_number ?? 3;
  const title = todaysTopic?.title ?? 'Today';
  // Always 5 nodes to match the typical real-data window. If the current
  // chapter is the first or second, we pad upward instead of going below 1.
  const start = num <= 2 ? 1 : num - 2;
  const seed: AtlasChapterNode[] = [];
  for (let i = start; i < start + 5; i++) {
    if (i === num) {
      seed.push({ number: i, title: title.slice(0, 24), status: 'current' });
    } else {
      seed.push({ number: i, title: `Chapter ${i}`, status: 'upcoming' });
    }
  }
  return seed;
}

/**
 * Foxy whispers — short, deterministic, engagement nudges keyed off the
 * student's current state. Pure function so re-renders don't flicker the
 * copy. Picks a tone matched to where the student is in the loop:
 *   - cold start (no streak, no wins): invitation
 *   - building (1-4 day streak): reinforcement
 *   - on a roll (5+ day streak or recent wins): celebration + tease
 */
function foxyWhisper(name: string, streak: number, winCount: number, isHi: boolean): string {
  const first = name.split(' ')[0] ?? name;
  if (isHi) {
    if (streak === 0 && winCount === 0)
      return `नमस्ते ${first}, चलो आज से लय शुरू करें — सिर्फ़ 10 मिनट काफी हैं।`;
    if (streak >= 5)
      return `${streak} दिन की लय, ${first}! इसी रफ़्तार से अगले अध्याय में महारत मिलेगी।`;
    if (winCount > 0)
      return `बहुत बढ़िया, ${first}। हाल की जीतें मेरे लिए ख़ुशी की बात हैं।`;
    return `अच्छा, ${first}, आज की मिशन तुम्हारी अगली जीत की तरफ़ ले जाती है।`;
  }
  if (streak === 0 && winCount === 0)
    return `Hi ${first}, let's set the rhythm today — even ten minutes counts.`;
  if (streak >= 5)
    return `${streak} days strong, ${first}. Keep this pace and the next chapter is yours.`;
  if (winCount > 0)
    return `Quietly proud of your recent wins, ${first}. The next one's close.`;
  return `Today's mission lands you closer to mastery, ${first}. I'm right here if you stall.`;
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

function MissionMeta({
  label,
  value,
  dark = false,
}: {
  label: string;
  value: string;
  dark?: boolean;
}) {
  // `dark` switches the colour palette so the same component reads
  // correctly on the dark-ink hero card (cream text + warm accent)
  // as it does on the default paper card (ink text on cream).
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.16em',
          color: dark ? 'rgba(255,255,255,0.55)' : 'var(--ink-3)',
        }}
      >
        {label}
      </span>
      <span
        className="atlas-tabnum"
        style={{
          fontFamily: 'var(--font-serif)',
          fontSize: 18,
          fontWeight: 500,
          color: dark ? 'var(--cream)' : 'var(--ink)',
        }}
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
