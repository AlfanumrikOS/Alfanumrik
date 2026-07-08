'use client';

/**
 * /learn — Subject & Chapter Browser
 *
 * The student mental model is: Subjects → Chapters → Read → Practice → Test.
 * This page IS the "Learn" tab destination. Students pick a subject, see all
 * chapters, and tap any chapter to go to /learn/[subject]/[chapter].
 *
 * Plan-based subject gating:
 *   free (tier 0)      → 2 subjects (first N in grade order)
 *   starter (tier 1)   → 4 subjects
 *   pro / unlimited    → all subjects
 *
 * Locked subjects are shown greyed out with an upgrade CTA — they are never
 * hidden, which helps students understand what upgrading unlocks.
 *
 * Phase 5a (premium-ui rebuild): the Subject grid + Chapter list are recomposed
 * on the canonical primitive layer (@alfanumrik/ui/ui/primitives). Presentation
 * only — every data hook, route, gate, localStorage read, and the celebration
 * trigger are byte-for-byte unchanged. Coverage % is derived through
 * calculateScorePercent (P1) and labelled as COVERAGE ("Chapters done"), kept
 * semantically distinct from exam-readiness (assessment C1/C2).
 */

import { useState, useEffect, useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useAuth } from '@alfanumrik/lib/AuthContext';

const CelebrationOverlay = dynamic(
  () => import('@alfanumrik/ui/quiz/CelebrationOverlay'),
  { ssr: false },
);
import { getChaptersForSubject, supabase } from '@alfanumrik/lib/supabase';
import { LoadingFoxy } from '@alfanumrik/ui/ui';
import {
  Card,
  Button,
  IconButton,
  Badge,
  ProgressBar,
  Alert,
  EmptyState,
  Skeleton,
} from '@alfanumrik/ui/ui/primitives';
import { calculateScorePercent } from '@alfanumrik/lib/scoring';
import { useAllowedSubjects } from '@alfanumrik/lib/useAllowedSubjects';
import { SectionErrorBoundary } from '@alfanumrik/ui/SectionErrorBoundary';
import { getPlanConfig } from '@alfanumrik/lib/plans';
import { useSubjectReadiness } from '@alfanumrik/lib/useSubjectReadiness';
import { ChapterReadinessBadge } from '@alfanumrik/ui/learn/ChapterReadinessBadge';
import { useSubjectsOsFlag } from '@alfanumrik/lib/use-subjects-os-flag';

// Phase 3 of Exam-Ready 360°. Lazy-loaded — the summary banner hides itself
// while the API is in-flight, so deferring its bundle keeps the chapter-list
// first paint snappy.
const SubjectReadinessSummary = dynamic(
  () => import('@alfanumrik/ui/learn/SubjectReadinessSummary'),
  { ssr: false, loading: () => null },
);

// "Alfa OS" Subjects experience (ff_subjects_os_v1, Tier 1 / presentation-only).
// Lazy-loaded so the flag-OFF path NEVER fetches this bundle — the OFF path
// stays byte-identical to today.
const SubjectsOSHub = dynamic(
  () => import('@alfanumrik/ui/learn/os/SubjectsOSHub'),
  { ssr: false, loading: () => null },
);

export default function LearnPage() {
  const { student, isLoggedIn, isLoading, isHi } = useAuth();
  const { subjects: allSubjects, unlocked: allowedSubjects, locked: lockedSubjects } = useAllowedSubjects();
  const router = useRouter();
  const pathname = usePathname();

  // "Alfa OS" Subjects experience flag. Default OFF → legacy chapter list
  // renders unchanged (byte-identical). When ON, selecting a subject renders
  // the new SubjectsOSHub instead of the chapter list.
  const subjectsOsOn = useSubjectsOsFlag();

  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [chapters, setChapters] = useState<Array<{ chapter_number: number; title: string; verified_question_count?: number }>>([]);
  const [chaptersLoading, setChaptersLoading] = useState(false);
  const [lastStudied, setLastStudied] = useState<{ subject: string; chapter: number; chapterTitle: string; concept: number; timestamp: number } | null>(null);
  const [progressRows, setProgressRows] = useState<Array<{ subject: string; chapter_number: number; is_completed: boolean }>>([]);
  const [subjectTotalChapters, setSubjectTotalChapters] = useState<Record<string, number>>({});
  const [showChapterCelebration, setShowChapterCelebration] = useState(false);
  // Track previously-completed keys so we can fire celebration on new completions
  const [prevCompletedKeys, setPrevCompletedKeys] = useState<Set<string>>(new Set());

  // Load last-studied position from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem('alfanumrik_last_studied');
      if (stored) {
        const data = JSON.parse(stored);
        // Only show if studied within last 7 days
        if (Date.now() - data.timestamp < 7 * 24 * 60 * 60 * 1000) {
          setLastStudied(data);
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/login');
    if (!isLoading && isLoggedIn && student && !student.onboarding_completed) router.replace('/onboarding');
  }, [isLoading, isLoggedIn, student, router]);

  useEffect(() => {
    if (!student?.id) return;
    supabase
      .from('chapter_progress')
      .select('subject, chapter_number, is_completed')
      .eq('student_id', student.id)
      .then(({ data }) => {
        if (data) {
          const rows = data as Array<{ subject: string; chapter_number: number; is_completed: boolean }>;
          setProgressRows(rows);
          // Detect newly-completed chapters and fire celebration
          const newCompletedKeys = new Set(
            rows.filter(r => r.is_completed).map(r => `${r.subject}:${r.chapter_number}`),
          );
          const hasNewCompletion = [...newCompletedKeys].some(k => !prevCompletedKeys.has(k));
          if (prevCompletedKeys.size > 0 && hasNewCompletion) {
            setShowChapterCelebration(true);
          }
          setPrevCompletedKeys(newCompletedKeys);
        }
      });
    // TODO: call setShowChapterCelebration(true) when chapter completes via navigation return
  }, [student?.id, pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!student?.grade) return;
    supabase
      .from('chapters')
      .select('chapter_number, subject_id, subjects!inner(code)')
      .eq('grade', student.grade)
      .eq('is_active', true)
      .then(({ data }) => {
        if (data) {
          const counts: Record<string, number> = {};
          data.forEach((row: any) => {
            const code = row.subjects?.code;
            if (code) {
              counts[code] = (counts[code] || 0) + 1;
            }
          });
          setSubjectTotalChapters(counts);
        }
      });
  }, [student?.grade]);

  useEffect(() => {
    if (!selectedSubject || !student?.grade) { setChapters([]); return; }
    setChaptersLoading(true);
    getChaptersForSubject(selectedSubject, student.grade)
      .then(setChapters)
      .catch(() => setChapters([]))
      .finally(() => setChaptersLoading(false));
  }, [selectedSubject, student?.grade]);

  // Guard: if selected subject is locked (plan downgrade, grade change, etc.),
  // reset selection. Calling setSelectedSubject() during render is a React
  // anti-pattern — it must run from an effect.
  useEffect(() => {
    if (selectedSubject && lockedSubjects.find(s => s.code === selectedSubject)) {
      setSelectedSubject(null);
    }
  }, [selectedSubject, lockedSubjects]);

  // Phase 3 of Exam-Ready 360°: load readiness for the selected subject so
  // we can render a per-chapter badge inline. Single API call (vs N) — the
  // hook is keyed on subjectCode so it auto-re-fetches when the student
  // switches subjects.
  //
  // IMPORTANT: this hook + the useMemo below MUST stay above the early-return
  // on `isLoading || !student` so React's hook ordering invariant holds.
  // Moving them below the early return crashes ESLint react-hooks/rules-of-hooks
  // and produces a hook-mismatch error in dev mode (regression caught by CI
  // on the Phase 3 commit).
  const { readiness: subjectReadiness } = useSubjectReadiness(selectedSubject);
  const readinessByChapter = useMemo(() => {
    const map = new Map<number, (typeof subjectReadiness extends null ? never : NonNullable<typeof subjectReadiness>['chapters'][number]) | undefined>();
    for (const row of subjectReadiness?.chapters ?? []) {
      map.set(row.chapter_number, row);
    }
    return map;
  }, [subjectReadiness]);

  if (isLoading || !student) return <LoadingFoxy />;

  // allSubjects / allowedSubjects / lockedSubjects now come from the subjects
  // service hook above — plan + grade + stream gating lives on the server.
  const plan = getPlanConfig(student.subscription_plan);
  const selectedMeta = allSubjects.find(s => s.code === selectedSubject);
  const upgradeLabel = plan.nextPlanLabel?.replace(' →', '') || (isHi ? 'अपग्रेड करो' : 'Upgrade');

  // NCERT ordering: always present chapters in curriculum order.
  const orderedChapters = [...chapters].sort((a, b) => a.chapter_number - b.chapter_number);

  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      {showChapterCelebration && (
        <CelebrationOverlay
          scorePercent={80}
          xpEarned={100}
          isHi={isHi}
          onDismiss={() => setShowChapterCelebration(false)}
        />
      )}
      <header className="page-header">
        <div className="page-header-inner flex items-center gap-3">
          {selectedSubject ? (
            <IconButton
              variant="ghost"
              size="md"
              label={isHi ? 'वापस जाएं' : 'Go back'}
              icon={<span aria-hidden="true">←</span>}
              onClick={() => { setSelectedSubject(null); setChapters([]); }}
            />
          ) : null}
          <h1 className="text-fluid-lg font-bold text-foreground" style={{ fontFamily: 'var(--font-serif)' }}>
            {selectedSubject
              ? `${selectedMeta?.icon} ${selectedMeta?.name}`
              : (isHi ? '📚 विषय' : '📚 Subjects')}
          </h1>
        </div>
      </header>

      <main className="app-container py-4 max-w-2xl mx-auto">
        <SectionErrorBoundary section="Learn">

          {!selectedSubject ? (
            /* ── Subject Grid ── */
            <div>
              <p className="mb-4 text-fluid-sm font-medium text-muted-foreground">
                {isHi
                  ? `कक्षा ${student.grade} · कौन सा विषय पढ़ना है?`
                  : `Grade ${student.grade} · Choose a subject to study`}
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">

                {/* ── Unlocked subjects ── */}
                {allowedSubjects.map(s => {
                  const isCurrent = student.preferred_subject === s.code;
                  const total = subjectTotalChapters[s.code] || 0;
                  const completed = progressRows.filter(row => row.subject === s.code && row.is_completed).length;
                  // Coverage % (P1 formula via calculateScorePercent) — a COVERAGE
                  // signal (chapters done), NOT mastery/exam-readiness (C1/C2).
                  const coveragePct = calculateScorePercent(completed, total);
                  return (
                    <Card
                      key={s.code}
                      variant="interactive"
                      onClick={() => setSelectedSubject(s.code)}
                      aria-label={`${s.name}${isCurrent ? (isHi ? ' · अभी पढ़ रहे हो' : ' · current subject') : ''}`}
                      className="p-4"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span aria-hidden="true" className="text-fluid-3xl">{s.icon}</span>
                        {isCurrent && (
                          <Badge tone="brand" variant="soft">
                            {isHi ? '⭐ अभी' : '⭐ Current'}
                          </Badge>
                        )}
                      </div>
                      <h2 className="mt-2 text-fluid-base font-bold text-foreground">{s.name}</h2>
                      <p className="text-fluid-xs text-muted-foreground">
                        {isCurrent
                          ? (isHi ? 'अभी पढ़ रहे हो' : 'Current subject')
                          : (isHi ? 'अध्याय देखो →' : 'View chapters →')}
                      </p>
                      <div className="mt-3">
                        <ProgressBar
                          value={coveragePct}
                          tone="brand"
                          size="sm"
                          showValue
                          label={isHi ? 'अध्याय पूरे' : 'Chapters done'}
                        />
                        <p className="mt-1 text-fluid-xs tabular-nums text-muted-foreground">
                          {completed}/{total} {isHi ? 'अध्याय' : 'chapters'}
                        </p>
                      </div>
                    </Card>
                  );
                })}

                {/* ── Locked subjects ── (canonical Card + Button; never hidden,
                    always shows a growth-mindset reason + a supportive upgrade
                    Button → /pricing — assessment C5). */}
                {lockedSubjects.map(s => (
                  <Card key={s.code} variant="flat" className="flex flex-col p-4">
                    <div className="flex items-start justify-between gap-2">
                      <span aria-hidden="true" className="text-fluid-3xl opacity-60 grayscale">{s.icon}</span>
                      <span aria-hidden="true" className="text-muted-foreground">🔒</span>
                      <span className="sr-only">{isHi ? `लॉक: ${s.name}` : `Locked: ${s.name}`}</span>
                    </div>
                    <h2 className="mt-2 text-fluid-base font-bold text-foreground">{s.name}</h2>
                    <p className="text-fluid-xs text-muted-foreground">
                      {isHi ? `${upgradeLabel} पर अनलॉक करो` : 'Unlock with an upgrade'}
                    </p>
                    <Button
                      variant="secondary"
                      size="sm"
                      fullWidth
                      className="mt-3"
                      onClick={() => router.push('/pricing')}
                    >
                      {isHi ? 'अनलॉक करो' : 'Unlock'}
                    </Button>
                  </Card>
                ))}

              </div>

              {/* Upgrade prompt — single Alert, only when locked subjects exist. */}
              {lockedSubjects.length > 0 && (
                <Alert
                  tone="info"
                  icon={<span aria-hidden="true">🔓</span>}
                  className="mt-4"
                  title={isHi
                    ? `${lockedSubjects.length} और विषय अनलॉक करो`
                    : `Unlock ${lockedSubjects.length} more subject${lockedSubjects.length > 1 ? 's' : ''}`}
                  action={
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => router.push('/pricing')}
                    >
                      {plan.nextPlanLabel || (isHi ? 'अपग्रेड करो' : 'Upgrade')}
                    </Button>
                  }
                >
                  {isHi
                    ? 'अपने प्लान को अपग्रेड करके और विषय खोलो।'
                    : 'Upgrade your plan to open more subjects.'}
                </Alert>
              )}
            </div>

          ) : subjectsOsOn ? (
            /* ── Alfa OS Subjects experience (ff_subjects_os_v1, flag ON) ──
               Renders the per-subject hub in place of the legacy chapter list.
               OFF path skips this branch entirely and is byte-identical. */
            <SubjectsOSHub
              studentId={student.id}
              subjectCode={selectedSubject}
              grade={student.grade}
              subjectMeta={selectedMeta}
              isHi={isHi}
            />

          ) : (
            /* ── Chapter List ── */
            <div>
              <p className="mb-4 text-fluid-sm font-medium text-muted-foreground">
                {isHi ? 'कौन सा अध्याय पढ़ना है?' : 'Choose a chapter to study'}
              </p>

              {/* Phase 3 of Exam-Ready 360°: subject-level readiness summary.
                  Renders as a card showing how many chapters in this subject
                  are ready / almost / building / not_yet. Hides itself while
                  loading or when the API has nothing to show. */}
              {selectedSubject && (
                <SubjectReadinessSummary
                  subjectCode={selectedSubject}
                  subjectColor={selectedMeta?.color}
                />
              )}

              {/* ═══ CONTINUE WHERE YOU LEFT OFF ═══ */}
              {lastStudied && lastStudied.subject === selectedSubject && (
                <Card
                  variant="interactive"
                  onClick={() => router.push(`/learn/${lastStudied.subject}/${lastStudied.chapter}`)}
                  className="mb-4 p-4"
                  aria-label={isHi ? 'जहां छोड़ा था वहीं से शुरू करो' : 'Continue where you left off'}
                >
                  <div className="flex items-center gap-3">
                    <span aria-hidden="true" className="text-fluid-2xl">📖</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-fluid-xs font-bold text-primary">
                        {isHi ? 'जहां छोड़ा था वहीं से शुरू करो' : 'Continue where you left off'}
                      </p>
                      <p className="mt-0.5 truncate text-fluid-sm font-semibold text-foreground">
                        {lastStudied.chapterTitle}
                      </p>
                      <p className="text-fluid-xs text-muted-foreground">
                        {isHi ? `अवधारणा ${lastStudied.concept + 1}` : `Concept ${lastStudied.concept + 1}`}
                      </p>
                    </div>
                    <span aria-hidden="true" className="text-muted-foreground">→</span>
                  </div>
                </Card>
              )}

              {chaptersLoading ? (
                <div className="space-y-3" role="status" aria-label={isHi ? 'अध्याय लोड हो रहे हैं' : 'Loading chapters'}>
                  {[...Array(5)].map((_, i) => (
                    <Skeleton key={i} radius="lg" className="h-20 w-full" />
                  ))}
                </div>

              ) : orderedChapters.length === 0 ? (
                <EmptyState
                  icon="📚"
                  title={isHi ? 'अभी कोई अध्याय नहीं मिला' : 'No chapters available yet'}
                  description={isHi
                    ? 'Foxy से इस विषय के बारे में पूछो'
                    : 'Ask Foxy to teach you this subject'}
                  action={
                    <Button
                      variant="primary"
                      leadingIcon={<span aria-hidden="true">🦊</span>}
                      onClick={() => router.push(`/foxy?subject=${selectedSubject}&mode=learn`)}
                    >
                      {isHi ? 'Foxy से सीखो' : 'Learn with Foxy'}
                    </Button>
                  }
                />

              ) : (
                <div className="space-y-3">
                  {orderedChapters.map((ch) => {
                    const isCompleted = progressRows.some(
                      row => row.subject === selectedSubject && row.chapter_number === ch.chapter_number && row.is_completed,
                    );
                    const verifiedCount = ch.verified_question_count ?? 0;
                    return (
                      <Card key={ch.chapter_number} variant="flat" className="p-4">
                        <div className="flex items-start gap-3">
                          {/* Chapter number chip — 44px touch-scale, token-driven */}
                          <div
                            aria-hidden="true"
                            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-fluid-base font-bold text-foreground"
                          >
                            {ch.chapter_number}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <h2 className="text-fluid-base font-semibold text-foreground">
                                {ch.title}
                              </h2>
                              {/* Exam-readiness signal (distinct from "Completed" — C2). */}
                              <ChapterReadinessBadge
                                level={readinessByChapter.get(ch.chapter_number)?.level ?? null}
                              />
                              {/* Coverage/effort signal — success tone, semantically
                                  separate from readiness (assessment C2). */}
                              {isCompleted && (
                                <Badge tone="success" variant="soft" icon={<span aria-hidden="true">✓</span>}>
                                  {isHi ? 'पूरा हुआ' : 'Completed'}
                                </Badge>
                              )}
                              {verifiedCount > 0 && (
                                <Badge tone="info" variant="soft" icon={<span aria-hidden="true">📝</span>}>
                                  {verifiedCount} {isHi ? 'प्रश्न' : 'questions'}
                                </Badge>
                              )}
                            </div>
                            <p className="mt-0.5 text-fluid-xs text-muted-foreground">
                              {isHi
                                ? `अध्याय ${ch.chapter_number} · पढ़ो और समझो`
                                : `Chapter ${ch.chapter_number} · Read & understand`}
                            </p>
                          </div>
                        </div>

                        {/* Read → Practice → Test action row (all ≥44px). */}
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            variant="primary"
                            size="sm"
                            leadingIcon={<span aria-hidden="true">📖</span>}
                            onClick={() => router.push(`/learn/${selectedSubject}/${ch.chapter_number}`)}
                          >
                            {isHi ? 'पढ़ो' : 'Study'}
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            leadingIcon={<span aria-hidden="true">⚡</span>}
                            onClick={() => router.push(`/quiz?subject=${selectedSubject}&chapter=${ch.chapter_number}`)}
                          >
                            {isHi ? 'क्विज़' : 'Quiz'}
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            leadingIcon={<span aria-hidden="true">🦊</span>}
                            onClick={() => router.push(`/foxy?subject=${selectedSubject}&chapter=${ch.chapter_number}&mode=doubt`)}
                          >
                            {isHi ? 'Foxy से पूछो' : 'Ask Foxy'}
                          </Button>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          )}

        </SectionErrorBoundary>
      </main>


    </div>
  );
}
