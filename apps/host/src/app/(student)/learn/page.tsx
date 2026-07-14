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
import {  LoadingFoxy, PremiumCard, GlowButton, LockedCard } from '@alfanumrik/ui/ui';
import { useAllowedSubjects } from '@alfanumrik/lib/useAllowedSubjects';
import { SectionErrorBoundary } from '@alfanumrik/ui/SectionErrorBoundary';
import { getPlanConfig } from '@alfanumrik/lib/plans';
import { useSubjectReadiness } from '@alfanumrik/lib/useSubjectReadiness';
import { ChapterReadinessBadge } from '@alfanumrik/ui/learn/ChapterReadinessBadge';
import { useSubjectsOsFlag } from '@alfanumrik/lib/use-subjects-os-flag';
import StudentV3Gate from '../_components/StudentV3Gate';
import { StudentLearnV3 } from '../_components/StudentV3Pages';

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

function LegacyLearnPage() {
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
            <button
              onClick={() => { setSelectedSubject(null); setChapters([]); }}
              className="text-[var(--text-3)] text-lg p-2 rounded-lg"
              aria-label={isHi ? 'वापस जाएं' : 'Go back'}
            >
              ←
            </button>
          ) : null}
          <h1 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
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
              <p className="text-sm text-[var(--text-3)] mb-4 font-medium">
                {isHi
                  ? `कक्षा ${student.grade} · कौन सा विषय पढ़ना है?`
                  : `Grade ${student.grade} · Choose a subject to study`}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">

                {/* ── Unlocked subjects ── */}
                {allowedSubjects.map(s => {
                  const isCurrent = student.preferred_subject === s.code;
                  return (
                    <button
                      key={s.code}
                      onClick={() => setSelectedSubject(s.code)}
                      className="card-hover rounded-2xl p-4 text-left transition-all active:scale-[0.97] cursor-pointer relative overflow-hidden"
                      style={{
                        background: isCurrent
                          ? `color-mix(in srgb, ${s.color} 8%, var(--surface-1))`
                          : 'var(--surface-1)',
                        border: `1px solid ${isCurrent ? s.color : 'var(--border)'}`,
                        boxShadow: isCurrent
                          ? `var(--shadow-md), 0 0 0 1px color-mix(in srgb, ${s.color} 20%, transparent)`
                          : 'var(--shadow-md)',
                      }}
                    >
                      {isCurrent && (
                        <div
                          className="absolute top-0 left-0 right-0 h-1"
                          style={{ background: s.color || 'var(--orange)' }}
                        />
                      )}
                      <div className="text-3xl mb-2">{s.icon}</div>
                      <div
                        className="text-sm font-bold"
                        style={{ color: isCurrent ? s.color : 'var(--text-1)' }}
                      >
                        {s.name}
                      </div>
                      <div className="text-[10px] text-[var(--text-3)] mt-1">
                        {isCurrent
                          ? (isHi ? '⭐ अभी पढ़ रहे हो' : '⭐ Current subject')
                          : (isHi ? 'अध्याय देखो →' : 'View chapters →')}
                      </div>
                      {(() => {
                        const total = subjectTotalChapters[s.code] || 0;
                        const completed = progressRows.filter(row => row.subject === s.code && row.is_completed).length;
                        const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
                        return (
                          <div className="mt-3">
                            <div className="w-full rounded-full h-1.5 mt-1 overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                              <div
                                  className="h-1.5 rounded-full transition-all duration-500"
                                  style={{
                                    width: `${pct}%`,
                                    backgroundColor: s.color || 'var(--orange)',
                                  }}
                              />
                            </div>
                            <div className="text-[11px] text-[var(--text-3)] mt-1 flex justify-between">
                              <span><span className="font-bold">{pct}%</span> {isHi ? 'पूरा' : 'Done'}</span>
                              <span>{completed}/{total} {isHi ? 'अध्याय' : 'Ch'}</span>
                            </div>
                          </div>
                        );
                      })()}
                    </button>
                  );
                })}

                {/* ── Locked subjects ── (uses the LockedCard primitive; tap → /pricing) */}
                {lockedSubjects.map(s => (
                  <LockedCard
                    key={s.code}
                    variant="plan"
                    icon={s.icon}
                    title={s.name}
                    reason={isHi
                      ? `${plan.nextPlanLabel?.replace(' →', '') || 'अपग्रेड'} पर अनलॉक करो`
                      : 'Unlock with an upgrade'}
                    actionLabel={isHi
                      ? `${plan.nextPlanLabel?.replace(' →', '') || 'अपग्रेड करो'}`
                      : 'Upgrade to unlock'}
                    onAction={() => router.push('/pricing')}
                    className="p-4"
                  />
                ))}

              </div>

              {/* Upgrade prompt strip — only shown when there are locked subjects */}
              {lockedSubjects.length > 0 && (
                <button
                  onClick={() => router.push('/pricing')}
                  className="w-full mt-4 py-3 px-4 rounded-2xl text-sm font-bold flex items-center justify-between transition-all active:scale-[0.98]"
                  style={{
                    background: 'linear-gradient(135deg, rgb(var(--accent-warm-rgb) / 0.08), rgb(var(--accent-warm-rgb) / 0.04))',
                    border: '1px solid rgb(var(--accent-warm-rgb) / 0.2)',
                    color: 'var(--accent-warm)',
                  }}
                >
                  <span>
                    🔓 {isHi
                      ? `${lockedSubjects.length} और विषय अनलॉक करो`
                      : `Unlock ${lockedSubjects.length} more subject${lockedSubjects.length > 1 ? 's' : ''}`}
                  </span>
                  <span style={{ opacity: 0.7 }}>
                    {plan.nextPlanLabel || (isHi ? 'अपग्रेड करो →' : 'Upgrade →')}
                  </span>
                </button>
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
              <p className="text-sm text-[var(--text-3)] mb-4 font-medium">
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
                <button
                  onClick={() => router.push(`/learn/${lastStudied.subject}/${lastStudied.chapter}`)}
                  className="w-full rounded-xl p-4 mb-4 flex items-center gap-3 transition-all active:scale-[0.98]"
                  style={{
                    background: 'linear-gradient(135deg, rgb(var(--accent-warm-rgb) / 0.06), rgb(var(--accent-warm-rgb) / 0.03))',
                    border: '1px solid rgb(var(--accent-warm-rgb) / 0.15)',
                  }}
                >
                  <span className="text-xl">📖</span>
                  <div className="flex-1 min-w-0 text-left">
                    <div className="text-xs font-semibold" style={{ color: 'var(--accent-warm)' }}>
                      {isHi ? 'जहां छोड़ा था वहीं से शुरू करो' : 'Continue where you left off'}
                    </div>
                    <div className="text-sm font-medium truncate mt-0.5" style={{ color: 'var(--text-1)' }}>
                      {lastStudied.chapterTitle}
                    </div>
                    <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                      {isHi ? `अवधारणा ${lastStudied.concept + 1}` : `Concept ${lastStudied.concept + 1}`}
                    </div>
                  </div>
                  <span style={{ color: 'var(--text-3)' }}>→</span>
                </button>
              )}

              {chaptersLoading ? (
                <div className="space-y-3">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="h-16 bg-[var(--surface-2)] rounded-xl animate-pulse" />
                  ))}
                </div>

              ) : chapters.length === 0 ? (
                <div className="text-center py-10">
                  <div className="text-5xl mb-3">📚</div>
                  <p className="text-sm font-semibold text-[var(--text-2)] mb-1">
                    {isHi ? 'अभी कोई अध्याय नहीं मिला' : 'No chapters available yet'}
                  </p>
                  <p className="text-xs text-[var(--text-3)] mb-6">
                    {isHi
                      ? 'Foxy से इस विषय के बारे में पूछो'
                      : 'Ask Foxy to teach you this subject'}
                  </p>
                  <GlowButton
                    className="warm-cta"
                    icon="🦊"
                    onClick={() => router.push(`/foxy?subject=${selectedSubject}&mode=learn`)}
                  >
                    {isHi ? 'Foxy से सीखो' : 'Learn with Foxy'}
                  </GlowButton>
                </div>

              ) : (
                <div className="space-y-3">
                  {chapters.map((ch) => (
                    <div
                      key={ch.chapter_number}
                      className="rounded-xl overflow-hidden"
                      style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
                    >
                      <button
                        onClick={() => router.push(`/learn/${selectedSubject}/${ch.chapter_number}`)}
                        className="w-full p-4 flex items-center gap-4 text-left transition-all active:scale-[0.98]"
                      >
                        {/* Chapter number badge */}
                        <div
                          className="w-11 h-11 rounded-xl flex items-center justify-center text-sm font-bold flex-shrink-0"
                          style={{
                            background: `${selectedMeta?.color || 'var(--orange)'}20`,
                            color: selectedMeta?.color || 'var(--orange)',
                          }}
                        >
                          {ch.chapter_number}
                        </div>

                        {/* Title */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="text-base font-semibold" style={{ color: 'var(--text-1)' }}>
                              {ch.title}
                            </div>
                            {/* Phase 3 of Exam-Ready 360°: per-chapter badge.
                                Falls back to null when the subject-readiness
                                map hasn't loaded — never blocks the row. */}
                            <ChapterReadinessBadge
                              level={readinessByChapter.get(ch.chapter_number)?.level ?? null}
                            />
                            {(() => {
                              const isCompleted = progressRows.some(row => row.subject === selectedSubject && row.chapter_number === ch.chapter_number && row.is_completed);
                              if (isCompleted) {
                                return (
                                  <span
                                    className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                                    style={{
                                      background: 'color-mix(in srgb, var(--green) 12%, var(--surface-1))',
                                      color: 'var(--green)',
                                      border: '1px solid color-mix(in srgb, var(--green) 25%, transparent)',
                                    }}
                                  >
                                    {isHi ? '✓ पूरा हुआ' : '✓ Completed'}
                                  </span>
                                );
                              }
                              return null;
                            })()}
                          </div>
                          <div className="text-[11px] text-[var(--text-3)] mt-0.5 flex items-center gap-2 flex-wrap">
                            <span>
                              {isHi
                                ? `अध्याय ${ch.chapter_number} · पढ़ो और समझो`
                                : `Chapter ${ch.chapter_number} · Read & understand`}
                            </span>
                            {(ch.verified_question_count ?? 0) > 0 && (
                              <span
                                className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-md"
                                style={{
                                  background: `${selectedMeta?.color || 'var(--orange)'}12`,
                                  color: selectedMeta?.color || 'var(--orange)',
                                }}
                              >
                                📝 {ch.verified_question_count} {isHi ? 'प्रश्न' : 'questions'}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Arrow */}
                        <span className="text-[var(--text-3)] flex-shrink-0">→</span>
                      </button>

                      {/* Quick-quiz pill — inline, no re-setup needed */}
                      <div
                        className="px-4 pb-3 flex gap-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={() => router.push(`/quiz?subject=${selectedSubject}&chapter=${ch.chapter_number}`)}
                          className="text-xs font-bold px-3 py-2 rounded-lg transition-all active:scale-95"
                          style={{
                            background: `${selectedMeta?.color || 'var(--orange)'}10`,
                            color: selectedMeta?.color || 'var(--orange)',
                            border: `1px solid ${selectedMeta?.color || 'var(--orange)'}25`,
                          }}
                        >
                          ⚡ {isHi ? 'क्विज़' : 'Quiz'}
                        </button>
                        <button
                          onClick={() => router.push(`/foxy?subject=${selectedSubject}&chapter=${ch.chapter_number}&mode=doubt`)}
                          className="text-xs font-bold px-3 py-2 rounded-lg transition-all active:scale-95"
                          style={{
                            background: 'rgb(var(--accent-warm-rgb) / 0.06)',
                            color: 'var(--accent-warm)',
                            border: '1px solid rgb(var(--accent-warm-rgb) / 0.15)',
                          }}
                        >
                          🦊 {isHi ? 'Foxy से पूछो' : 'Ask Foxy'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </SectionErrorBoundary>
      </main>


    </div>
  );
}

export default function LearnPage() {
  return <StudentV3Gate legacy={<LegacyLearnPage />} v3={<StudentLearnV3 />} />;
}
