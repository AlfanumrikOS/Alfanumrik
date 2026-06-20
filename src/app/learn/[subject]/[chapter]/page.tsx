'use client';

import { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useAuth } from '@/lib/AuthContext';
import { calculateScorePercent } from '@/lib/scoring';
import {
  getChapterTopics,
  getChapterQuestions,
  getTopicDiagrams,
  recordLearningEvent,
  updateChapterProgress,
  getFeatureFlags,
  supabase,
} from '@/lib/supabase';
import {
  getChapterTopicsFromConcepts,
  isUsableChapterDeck,
} from '@/lib/chapter-reader/get-concepts-from-table';
import { Card, Button, ProgressBar, LoadingFoxy } from '@/components/ui';
// Mobile-first responsive shell (2026-05-19, Phase 2 — followup #1 of PR #867).
// Wraps the chapter concept walkthrough in a CSS-Grid shell with safe-area
// insets, scroll-compacting header, and one-handed mode. The page header
// (subject icon + chapter title + Read-mode toggle + concept counter +
// progress bar) moves into AppShell.header; the concept cards, Quick Check,
// and "next concept" CTA remain as children. See dashboard/page.tsx for the
// reference migration.
import { AppShell } from '@/components/responsive';
import { useAllowedSubjects } from '@/lib/useAllowedSubjects';
import { BLOOM_CONFIG, type BloomLevel } from '@/lib/cognitive-engine';
import confetti from 'canvas-confetti';
import type { CurriculumTopic } from '@/lib/types';
import { track } from '@/lib/posthog/client';
import { loadChapterContent } from './actions';
import type { ChapterContent } from '@/lib/learn/fetchChapterContent';
import { resolvePedagogyRule } from '@/lib/learn/pedagogy-content-rules';
import { useChapterReadiness } from '@/lib/useChapterReadiness';

// Lazy-loaded so the markdown + KaTeX bundle stays out of first paint.
// Only pulled when the student opens Read mode.
const ChapterReadView = dynamic(
  () => import('@/components/learn/ChapterReadView'),
  { ssr: false, loading: () => <LoadingFoxy /> },
);

// Phase 2 of Exam-Ready 360°. Lazy-loaded — the card hides itself while
// the readiness API is in-flight, so deferring its bundle keeps first
// paint snappy on slow networks (no skeleton, no LCP penalty).
const ChapterReadinessCard = dynamic(
  () => import('@/components/learn/ChapterReadinessCard'),
  { ssr: false, loading: () => null },
);

const OPTION_LETTERS = ['A', 'B', 'C', 'D'];

interface Question {
  id: string;
  question_text: string;
  question_hi: string | null;
  options: string | string[];
  correct_answer_index: number;
  explanation: string | null;
  explanation_hi: string | null;
  bloom_level: string;
  difficulty: number;
  chapter_number: number;
}

interface Diagram {
  id: string;
  image_url: string;
  caption: string | null;
  caption_hi: string | null;
  alt_text: string | null;
}

interface ConceptState {
  selectedOption: number | null;
  submitted: boolean;
  isCorrect: boolean;
}

function ChapterConceptPageContent() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const subject = params.subject as string;
  const chapterNum = parseInt(params.chapter as string, 10);

  const { student, isLoggedIn, isLoading, isHi } = useAuth();
  const { subjects: allSubjects, unlocked: allowedSubjects } = useAllowedSubjects();
  const { readiness } = useChapterReadiness(subject, chapterNum);
  const [conceptMasteries, setConceptMasteries] = useState<Record<string, number>>({});

  const [topics, setTopics] = useState<CurriculumTopic[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [diagrams, setDiagrams] = useState<Diagram[]>([]);
  const [chapterMeta, setChapterMeta] = useState<{
    title: string;
    title_hi: string | null;
    ncert_page_start: number | null;
    ncert_page_end: number | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  // P0 fix: error flag for the content fetch. When `load()` rejects (flaky
  // Indian-4G network) we surface a retryable error card instead of hanging
  // forever on <LoadingFoxy />. Distinct from the topics.length===0 empty
  // state (which means "loaded OK, no concepts").
  const [loadError, setLoadError] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [activeTab, setActiveTab] = useState<'core' | 'example' | 'cheat'>('core');
  const [visibleSteps, setVisibleSteps] = useState<Record<number, number>>({});
  // Per-concept quick-check state, keyed by topic index
  const [conceptStates, setConceptStates] = useState<Record<number, ConceptState>>({});
  const [completedCount, setCompletedCount] = useState(0);
  const [showCompletion, setShowCompletion] = useState(false);
  const [revealedCorePoints, setRevealedCorePoints] = useState<Record<number, number>>({});
  const [showAllCore, setShowAllCore] = useState<Record<number, boolean>>({});
  const [phase, setPhase] = useState<'explaining' | 'quiz' | 'report'>('explaining');
  const [completedTopics, setCompletedTopics] = useState<Set<string>>(new Set());
  const [quizCurrentIdx, setQuizCurrentIdx] = useState(0);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, { selectedOption: number; isCorrect: boolean }>>({});
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [quizSelectedOption, setQuizSelectedOption] = useState<number | null>(null);

  // ── Phase 2-B: Read mode (gated by ff_learn_read_mode_v1) ──
  // The flag controls visibility of the Practice/Read toggle. When the page
  // is opened with `?mode=read`, we auto-switch on first paint (deep-link
  // pattern) but only if the flag is on.
  const [readModeFlagOn, setReadModeFlagOn] = useState(false);
  // ── Chapter Reader v2 (gated by ff_chapter_reader_v2) ──
  // When ON: load() prefers the curated `chapter_concepts` table over the
  // RAG-chunk grouping path that produced textbook-dump output. Per-chapter
  // quality gate (isUsableChapterDeck) falls back to legacy when concept
  // rows are sparse or look like placeholder one-liners. Telemetry flag
  // `learn_v2_source` records which path actually rendered.
  const [chapterReaderV2FlagOn, setChapterReaderV2FlagOn] = useState(false);
  const [v2SourceUsed, setV2SourceUsed] = useState<'curated' | 'rag_fallback' | null>(null);
  // ── Pedagogy v2 / Wave 1: Productive Failure flip ──
  // When ff_productive_failure_v1 is on AND the resolved pedagogy rule says
  // productiveFailure (true for every persona except improve_basics), the
  // concept description + learning objectives are hidden until the student
  // attempts the Quick Check. Wave 1C: persona is now read from
  // students.academic_goal so improve_basics gets the worked-example-first
  // exception (resolver flips productiveFailure=false, workedExampleFirst=true).
  const [productiveFailureFlagOn, setProductiveFailureFlagOn] = useState(false);
  const [academicGoal, setAcademicGoal] = useState<string | null>(null);
  const productiveFailureRule = useMemo(
    () => resolvePedagogyRule(academicGoal, 'daily', 'zpd_problem'),
    [academicGoal],
  );
  const productiveFailureActive =
    productiveFailureFlagOn &&
    productiveFailureRule.productiveFailure &&
    !productiveFailureRule.workedExampleFirst;
  const [mode, setMode] = useState<'practice' | 'read'>('practice');
  const [readContent, setReadContent] = useState<ChapterContent | null>(null);
  const [readLoading, setReadLoading] = useState(false);
  // Guard so we only fire `learn_chapter_started` once per page load.
  const [chapterStartedFired, setChapterStartedFired] = useState(false);
  const language: 'en' | 'hi' = isHi ? 'hi' : 'en';

  const subMeta = allSubjects.find(s => s.code === subject);

  // Telemetry context shared by every learn_* event for this page.
  const telemetryBase = useMemo(
    () => ({
      subject_code: subject,
      grade: student?.grade ?? '',
      chapter_number: chapterNum,
      language,
    }),
    [subject, student?.grade, chapterNum, language],
  );

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/login');
  }, [isLoading, isLoggedIn, router]);

  // Plan-gate: redirect to /learn if this subject is locked for the student's plan.
  // Wait until the subjects service has returned something before redirecting —
  // otherwise a first-paint empty list would incorrectly bounce the student.
  useEffect(() => {
    if (!student || isLoading) return;
    if (allSubjects.length === 0) return;
    const entry = allSubjects.find(s => s.code === subject);
    if (!entry || entry.isLocked) {
      router.replace('/learn');
    }
  }, [student, isLoading, subject, allSubjects, router]);

  const load = useCallback(async () => {
    if (!student) return;
    setLoading(true);
    setLoadError(false);
    const grade = student.grade;

    // P0 fix: the entire fetch+merge body is wrapped in try/catch/finally so a
    // single rejected query (flaky network) can never leave the student stuck
    // on the skeleton. `finally` ALWAYS clears `loading`; `catch` flips the
    // retryable error state.
    try {
    // Load RAG topics, curated concepts, questions, diagrams, and chapter/subject metadata in parallel
    const [
      ragTopicsRaw,
      curatedConcepts,
      questionsData,
      diagramsData,
      chapterMetaResult,
      subjectRow,
      masteryResult
    ] = await Promise.all([
      getChapterTopics(subject, grade, chapterNum),
      chapterReaderV2FlagOn
        ? getChapterTopicsFromConcepts(subject, grade, chapterNum)
        : Promise.resolve([]),
      getChapterQuestions(subject, grade, chapterNum, 30),
      getTopicDiagrams(subject, grade, chapterNum),
      supabase
        .from('chapters')
        .select('title, title_hi, ncert_page_start, ncert_page_end')
        .eq('subject_code', subject)
        .eq('grade', grade.replace(/^Grade\s*/i, '').trim())
        .eq('chapter_number', chapterNum)
        .eq('is_active', true)
        .maybeSingle(),
      supabase
        .from('subjects')
        .select('id')
        .eq('code', subject)
        .maybeSingle(),
      supabase
        .from('concept_mastery_score')
        .select('concept_code, mastery_score')
        .eq('student_id', student.id)
    ]);

    if (chapterMetaResult?.data) {
      setChapterMeta(chapterMetaResult.data);
    } else {
      setChapterMeta(null);
    }

    const masteryMap: Record<string, number> = {};
    if (masteryResult?.data) {
      masteryResult.data.forEach((row: any) => {
        if (row.concept_code) {
          masteryMap[row.concept_code] = row.mastery_score;
        }
      });
    }
    setConceptMasteries(masteryMap);

    const normalizedGrade = grade.replace(/^Grade\s*/i, '').trim();
    let curriculumTopics: Array<{ id: string; title: string }> = [];
    if (subjectRow?.data) {
      const { data: ctData } = await supabase
        .from('curriculum_topics')
        .select('id, title')
        .eq('subject_id', subjectRow.data.id)
        .eq('grade', normalizedGrade)
        .eq('chapter_number', chapterNum);
      if (ctData) {
        curriculumTopics = ctData;
      }
    }

    const ragTopics = ragTopicsRaw as CurriculumTopic[];

    // Merge curated concepts into RAG topics to ensure 100% NCERT coverage
    const mergedTopics: CurriculumTopic[] = [];
    const usedCuratedIds = new Set<string>();

    ragTopics.forEach((ragTopic) => {
      // Find a matching curated concept by title (case-insensitive, alphanumeric match)
      const matchingCurated = curatedConcepts.find((c) => {
        const cleanCurated = c.title.toLowerCase().replace(/[^a-z0-9]/g, '');
        const cleanRag = ragTopic.title.toLowerCase().replace(/[^a-z0-9]/g, '');
        return cleanCurated === cleanRag || cleanRag.includes(cleanCurated) || cleanCurated.includes(cleanRag);
      });

      if (matchingCurated) {
        mergedTopics.push({
          ...ragTopic,
          ...matchingCurated,
          id: ragTopic.id, // Explicitly retain RAG/curriculum topic ID to avoid foreign key violations
          ncert_page_range: ragTopic.ncert_page_range || matchingCurated.ncert_page_range || null,
          description: (matchingCurated as any).explanation || matchingCurated.description || ragTopic.description,
          topic_type: 'merged_concept',
        } as any);
        usedCuratedIds.add(matchingCurated.id);
      } else {
        mergedTopics.push(ragTopic);
      }
    });

    // Append any curated concepts that were not matched to any RAG topic
    curatedConcepts.forEach((c) => {
      if (!usedCuratedIds.has(c.id)) {
        // Attempt to match unmatched curated concept to curriculum_topics by title to prevent FK errors
        const cleanCurated = c.title.toLowerCase().replace(/[^a-z0-9]/g, '');
        const matchedCt = curriculumTopics.find((ct) => {
          const cleanCt = ct.title.toLowerCase().replace(/[^a-z0-9]/g, '');
          return cleanCt === cleanCurated || cleanCt.includes(cleanCurated) || cleanCurated.includes(cleanCt);
        });

        mergedTopics.push({
          ...c,
          id: matchedCt ? matchedCt.id : c.id,
        });
      }
    });

    // Sort by display order / ordering to keep logical sequence
    mergedTopics.sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));

    const sortedQuestions = [...(questionsData as Question[])].sort((a, b) => {
      const bloomOrder: Record<string, number> = {
        remember: 1,
        understand: 2,
        apply: 3,
        analyze: 4,
        evaluate: 5,
        create: 6,
        hots: 7,
      };
      const aLevel = (a.bloom_level || 'remember').toLowerCase();
      const bLevel = (b.bloom_level || 'remember').toLowerCase();
      return (bloomOrder[aLevel] || 1) - (bloomOrder[bLevel] || 1);
    });

    setTopics(mergedTopics);
    setQuestions(sortedQuestions);
    setDiagrams(diagramsData as Diagram[]);
    setV2SourceUsed(curatedConcepts.length > 0 ? 'curated' : 'rag_fallback');
    setPhase('explaining');
    setCompletedTopics(new Set());
    setQuizCurrentIdx(0);
    setQuizAnswers({});
    } catch (err: unknown) {
      // Transient fetch failure — surface a retryable error card. Note this is
      // distinct from "loaded OK but empty": getChapterTopics() swallows RAG
      // errors and returns [], so a network failure on the OTHER queries
      // (questions/diagrams/chapter meta) is the path that reaches here.
      console.warn('[learn] chapter load failed:', err instanceof Error ? err.message : String(err));
      setLoadError(true);
    } finally {
      // ALWAYS clear loading — this is the line that previously never ran on a
      // rejected await, leaving the student stuck on the permanent skeleton.
      setLoading(false);
    }
  }, [student, subject, chapterNum, chapterReaderV2FlagOn]);

  useEffect(() => {
    if (student) load();
  }, [student?.id, load]);

  // P0 defense-in-depth: skeleton-timeout backstop. If we're still in the
  // loading state 8s after it began (e.g. an await silently stalls on a dead
  // socket without ever rejecting on Indian 4G), flip to the error card so the
  // student always gets a Retry path instead of a permanent skeleton. The
  // timer is cleared the moment loading ends (success OR error), so a normal
  // fast load never trips it.
  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => {
      setLoadError(true);
      setLoading(false);
    }, 8000);
    return () => clearTimeout(t);
  }, [loading]);

  // Fire `learn_chapter_started` exactly once after data arrives. We need
  // student.grade + topics + questions to be ready so the payload counts
  // are accurate. Subsequent re-renders are no-ops because of the guard.
  useEffect(() => {
    if (chapterStartedFired) return;
    if (!student || loading) return;
    if (!telemetryBase.grade) return;
    track('learn_chapter_started', {
      ...telemetryBase,
      topic_count: topics.length,
      question_count: questions.length,
      // Chapter Reader v2: which data source rendered this chapter.
      // 'curated' = chapter_concepts table, 'rag_fallback' = legacy RAG chunks
      // path (either flag off, no rows, or quality gate rejected).
      // null when the v2 flag was off (legacy unconditional path).
      v2_source: v2SourceUsed ?? 'flag_off',
    });
    setChapterStartedFired(true);
  }, [chapterStartedFired, student, loading, telemetryBase, topics.length, questions.length, v2SourceUsed]);

  // Read flag (ff_learn_read_mode_v1) once per session — single round-trip
  // shared with the rest of the dashboard's flag fetch (cached in lib/swr).
  // Productive-failure flag (ff_productive_failure_v1) piggybacks the same
  // fetch so we don't double-roundtrip on chapter open.
  useEffect(() => {
    if (!student) return;
    let cancelled = false;
    (async () => {
      try {
        const flags = await getFeatureFlags({ role: 'student' });
        if (!cancelled) {
          setReadModeFlagOn(Boolean(flags?.ff_learn_read_mode_v1));
          setProductiveFailureFlagOn(Boolean(flags?.ff_productive_failure_v1));
          setChapterReaderV2FlagOn(Boolean(flags?.ff_chapter_reader_v2));
        }
      } catch {
        // Flags fail closed — practice mode only, tutorial-first preserved.
        if (!cancelled) {
          setReadModeFlagOn(false);
          setProductiveFailureFlagOn(false);
          setChapterReaderV2FlagOn(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [student?.id]);

  // Wave 1C: read students.academic_goal once per session so the
  // productive-failure resolver knows the persona. Without this, the
  // resolver fell back to pass_comfortably for everyone — meaning
  // improve_basics (confidence-fragile) students saw productive-failure
  // when they should have seen worked-example-first.
  useEffect(() => {
    if (!student?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from('students')
          .select('academic_goal')
          .eq('id', student.id)
          .maybeSingle();
        const goal = (data as { academic_goal?: string | null } | null)?.academic_goal ?? null;
        if (!cancelled) setAcademicGoal(goal);
      } catch {
        if (!cancelled) setAcademicGoal(null);
      }
    })();
    return () => { cancelled = true; };
  }, [student?.id]);

  // Deep-link: `?mode=read` auto-toggles into Read mode on first paint when
  // the flag is on. Triggered once flag state resolves.
  useEffect(() => {
    if (!readModeFlagOn || mode === 'read') return;
    if (searchParams?.get('mode') === 'read') {
      setMode('read');
      track('learn_read_mode_opened', {
        ...telemetryBase,
        trigger: 'deep_link',
        chunk_count: 0, // updated when content loads
      });
    }
  }, [readModeFlagOn, mode, searchParams, telemetryBase]);

  // Fetch chapter prose lazily when the student first enters Read mode.
  useEffect(() => {
    if (mode !== 'read' || readContent || readLoading || !student) return;
    let cancelled = false;
    setReadLoading(true);
    loadChapterContent({
      subjectCode: subject,
      grade: student.grade,
      chapterNumber: chapterNum,
      language,
    })
      .then((content) => {
        if (cancelled) return;
        setReadContent(content);
        if (!content) {
          track('learn_read_mode_fallback', {
            ...telemetryBase,
            reason: 'empty',
          });
        }
      })
      .catch(() => {
        if (cancelled) return;
        setReadContent(null);
        track('learn_read_mode_fallback', {
          ...telemetryBase,
          reason: 'error',
        });
      })
      .finally(() => {
        if (!cancelled) setReadLoading(false);
      });
    return () => { cancelled = true; };
  }, [mode, readContent, readLoading, student, subject, chapterNum, telemetryBase]);

  // Save current study position for "continue where you left off"
  useEffect(() => {
    if (subject && chapterNum && !loading) {
      try {
        localStorage.setItem('alfanumrik_last_studied', JSON.stringify({
          subject,
          chapter: chapterNum,
          chapterTitle: subMeta?.name ? `${subMeta.name} · Chapter ${chapterNum}` : `Chapter ${chapterNum}`,
          concept: currentIdx,
          timestamp: Date.now(),
        }));
      } catch {}
    }
  }, [subject, chapterNum, currentIdx, subMeta?.name, loading]);

  // Save chapter completion to database when student achieves >= 60%
  useEffect(() => {
    if (!showCompletion || !student) return;
    const correctCount = Object.values(conceptStates).filter(s => s.submitted && s.isCorrect).length;
    const totalAnswered = Object.values(conceptStates).filter(s => s.submitted).length;
    const pct = calculateScorePercent(correctCount, totalAnswered);
    const scoreGood = totalAnswered > 0 && pct >= 60;
    if (scoreGood) {
      updateChapterProgress(subject, student.grade, chapterNum).catch((err: unknown) => {
        console.warn('[chapter-progress] update failed:', err instanceof Error ? err.message : String(err));
      });
    }
    track('learn_chapter_completed', {
      ...telemetryBase,
      score_pct: pct,
      total_answered: totalAnswered,
      correct_count: correctCount,
      passed_threshold: scoreGood,
    });
  }, [showCompletion, student, conceptStates, subject, chapterNum, telemetryBase]);

  const parseOptions = (opts: string | string[]): string[] => {
    if (Array.isArray(opts)) return opts;
    try { return JSON.parse(opts); } catch { return []; }
  };

  const selectOption = (optIdx: number) => {
    if (conceptStates[currentIdx]?.submitted) return;
    setConceptStates(prev => ({
      ...prev,
      [currentIdx]: { selectedOption: optIdx, submitted: false, isCorrect: false },
    }));
  };

  const submitAnswer = () => {
    const state = conceptStates[currentIdx];
    if (!state || state.selectedOption === null || state.submitted) return;
    const q = questions[currentIdx % Math.max(questions.length, 1)];
    if (!q) return;
    const isCorrect = state.selectedOption === q.correct_answer_index;
    setConceptStates(prev => ({
      ...prev,
      [currentIdx]: { ...state, submitted: true, isCorrect },
    }));

    if (isCorrect) {
      confetti({
        particleCount: 50,
        spread: 60,
        origin: { y: 0.8 },
        colors: ['#16A34A', '#22C55E', '#86EFAC']
      });
    }

    if (student && topics[currentIdx]) {
      recordLearningEvent(
        student.id,
        topics[currentIdx].id,
        isCorrect,
        'practice',
        q?.bloom_level || topics[currentIdx].bloom_focus || 'remember',
      ).catch((err: unknown) => {
        console.warn('[learn] recordLearningEvent failed:', err instanceof Error ? err.message : String(err));
      });
    }
    if (!conceptStates[currentIdx]?.submitted) {
      setCompletedCount(prev => prev + 1);
    }
    track('learn_quick_check_submitted', {
      ...telemetryBase,
      concept_idx: currentIdx,
      is_correct: isCorrect,
    });
  };

  const goNext = () => {
    if (currentIdx < topics.length - 1) {
      const nextIdx = currentIdx + 1;
      setCurrentIdx(nextIdx);
      setActiveTab('core');
      track('learn_concept_advanced', {
        ...telemetryBase,
        concept_idx: nextIdx,
        direction: 'next',
      });
    } else {
      setShowCompletion(true);
    }
  };

  const handleMarkUnderstood = () => {
    const topic = topics[currentIdx];
    if (!topic) return;

    const nextCompleted = new Set(completedTopics);
    nextCompleted.add(topic.id);
    setCompletedTopics(nextCompleted);

    // Track concept advanced
    track('learn_concept_advanced', {
      ...telemetryBase,
      concept_idx: currentIdx,
      direction: 'next',
    });

    // Check if there is an uncompleted topic in the list
    let nextUncompletedIdx = -1;
    for (let i = 0; i < topics.length; i++) {
      const idx = (currentIdx + i + 1) % topics.length;
      if (!nextCompleted.has(topics[idx].id)) {
        nextUncompletedIdx = idx;
        break;
      }
    }

    if (nextCompleted.size >= topics.length || nextUncompletedIdx === -1) {
      // Transition to Quiz Phase!
      if (questions.length === 0) {
        setPhase('report');
        if (student) {
          updateChapterProgress(subject, student.grade, chapterNum).catch(console.warn);
        }
      } else {
        setPhase('quiz');
        setQuizCurrentIdx(0);
        setQuizAnswers({});
        setQuizSelectedOption(null);
      }
    } else {
      // Navigate to next uncompleted topic
      setCurrentIdx(nextUncompletedIdx);
      setActiveTab('core');
    }
  };

  const goPrev = () => {
    if (currentIdx > 0) {
      const prevIdx = currentIdx - 1;
      setCurrentIdx(prevIdx);
      setActiveTab('core');
      track('learn_concept_advanced', {
        ...telemetryBase,
        concept_idx: prevIdx,
        direction: 'previous',
      });
    }
  };

  const askFoxy = () => {
    const topic = topics[currentIdx];
    const topicParam = topic ? encodeURIComponent(topic.title) : '';
    track('learn_foxy_doubt_clicked', {
      ...telemetryBase,
      source: 'in_flow',
    });
    router.push(`/foxy?subject=${subject}&mode=doubt&topic=${topicParam}`);
  };

  const handleReviewWeakConcept = useCallback(() => {
    const firstWeakIdx = topics.findIndex((t) => {
      if (!t.slug) return false;
      const score = conceptMasteries[t.slug] ?? 0;
      return score < 60;
    });

    if (firstWeakIdx !== -1) {
      setMode('practice');
      setPhase('explaining');
      setCurrentIdx(firstWeakIdx);
      setActiveTab('core');
      track('learn_review_weak_concept_clicked', {
        ...telemetryBase,
        concept_idx: firstWeakIdx,
      });
    } else if (topics.length > 0) {
      setMode('practice');
      setPhase('explaining');
      setCurrentIdx(0);
      setActiveTab('core');
    }
  }, [topics, conceptMasteries, telemetryBase]);

  const switchToReadMode = () => {
    setMode('read');
    track('learn_read_mode_opened', {
      ...telemetryBase,
      trigger: 'header',
      chunk_count: readContent?.sources.length ?? 0,
    });
  };

  const switchToPracticeMode = () => {
    setMode('practice');
  };

  const getTopicIdForQuestion = useCallback((q: Question) => {
    if (!q) return null;
    if ((q as any).topic_id) {
      const exactMatch = topics.find(t => t.id === (q as any).topic_id);
      if (exactMatch) return exactMatch.id;
    }
    const cleanQText = q.question_text.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const t of topics) {
      const cleanTitle = t.title.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (cleanTitle.length > 3 && (cleanQText.includes(cleanTitle) || cleanTitle.includes(cleanQText))) {
        return t.id;
      }
    }
    if (q.explanation) {
      const cleanExplanation = q.explanation.toLowerCase().replace(/[^a-z0-9]/g, '');
      for (const t of topics) {
        const cleanTitle = t.title.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (cleanTitle.length > 3 && cleanExplanation.includes(cleanTitle)) {
          return t.id;
        }
      }
    }
    return topics.length > 0 ? topics[0].id : null;
  }, [topics]);

  const handleFinishQuiz = useCallback(() => {
    setPhase('report');
    if (student) {
      updateChapterProgress(subject, student.grade, chapterNum).catch((err: unknown) => {
        console.warn('[chapter-progress] update failed:', err instanceof Error ? err.message : String(err));
      });
    }
    const totalQ = questions.length;
    const correctQ = Object.values(quizAnswers).filter(a => a.isCorrect).length;
    const pct = calculateScorePercent(correctQ, totalQ);

    if (pct >= 60) {
      setTimeout(() => {
        confetti({
          particleCount: 150,
          spread: 80,
          origin: { y: 0.6 },
          colors: ['#16A34A', '#FDE047', '#3B82F6']
        });
      }, 300);
    }

    track('learn_chapter_completed', {
      ...telemetryBase,
      score_pct: pct,
      total_answered: totalQ,
      correct_count: correctQ,
      passed_threshold: pct >= 60,
    });
  }, [student, subject, chapterNum, questions, quizAnswers, telemetryBase]);

  if (isLoading || loading) return <LoadingFoxy />;

  if (!student) return null;

  // ── Completion screen ──
  if (showCompletion) {
    const correctCount = Object.values(conceptStates).filter(s => s.submitted && s.isCorrect).length;
    const totalAnswered = Object.values(conceptStates).filter(s => s.submitted).length;
    const pct = calculateScorePercent(correctCount, totalAnswered);

    // Which concepts did the student get wrong?
    const wrongTopics = Object.entries(conceptStates)
      .filter(([, s]) => s.submitted && !s.isCorrect)
      .map(([idx]) => topics[parseInt(idx)])
      .filter(Boolean)
      .slice(0, 3);

    // FIXED: Do NOT celebrate if student hasn't answered anything or scored below 60%.
    // Previously: totalAnswered === 0 was treated as "good" — this rewarded doing nothing.
    const scoreGood = totalAnswered > 0 && pct >= 60;
    const scoreLabel = totalAnswered === 0
      ? (isHi ? '📝 अवधारणाओं के प्रश्नों का अभ्यास करो' : '📝 Practice the concept questions to complete this chapter')
      : pct >= 80
        ? (isHi ? '🌟 शानदार! तुमने अध्याय में महारत हासिल की!' : '🌟 Excellent! You\'ve mastered this chapter!')
        : pct >= 60
          ? (isHi ? '👍 अच्छा! क्विज़ देने के लिए तैयार हो!' : '👍 Good work! Ready for the quiz!')
          : (isHi ? '💪 थोड़ा और अभ्यास करो — नीचे कमज़ोर अवधारणाएँ देखो' : '💪 A bit more practice needed — see weak concepts below');

    // Completion screen — wrapped in AppShell variant="mobile". Page header
    // (back arrow + Chapter Complete/Summary title) moves into the sticky
    // header slot; summary cards + CTAs remain as children.
    return (
      <div className="mesh-bg">
        <AppShell
          variant="mobile"
          
          header={
            <div className="page-header-inner flex items-center gap-3">
              <button onClick={() => router.push('/learn')} className="text-[var(--text-3)]">&larr;</button>
              <h1 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
                {scoreGood
                  ? (isHi ? 'अध्याय पूरा!' : 'Chapter Complete!')
                  : (isHi ? 'अध्याय सारांश' : 'Chapter Summary')}
              </h1>
            </div>
          }
        >
        <main className="w-full px-4 md:px-8 py-6 max-w-2xl mx-auto flex flex-col gap-5">
          <div className="text-center py-4">
            <div className="text-6xl mb-3">{scoreGood ? '🎉' : '📊'}</div>
            <h2 className="text-2xl font-bold mb-1" style={{ fontFamily: 'var(--font-display)' }}>
              {scoreGood
                ? (isHi ? `अध्याय ${chapterNum} पूरा!` : `Chapter ${chapterNum} Done!`)
                : (isHi ? `अध्याय ${chapterNum} — और अभ्यास करो` : `Chapter ${chapterNum} — More Practice Needed`)}
            </h2>
            <p className="text-sm text-[var(--text-3)]">
              {subMeta?.name} · {isHi ? `${topics.length} अवधारणाएँ पढ़ीं` : `${topics.length} concepts covered`}
            </p>
            {scoreLabel && (
              <p className="text-sm font-semibold mt-3 px-4" style={{ color: scoreGood ? '#16A34A' : '#D97706' }}>
                {scoreLabel}
              </p>
            )}
          </div>

          {totalAnswered > 0 && (() => {
            const parameterBreakdown = {
              remember: { attempted: 0, correct: 0, label: isHi ? 'स्मरण और याद' : 'Remember & Recall', icon: '🧠', color: '#6B7280' },
              understand: { attempted: 0, correct: 0, label: isHi ? 'समझें और समझाएं' : 'Understand & Explain', icon: '💡', color: '#2563EB' },
              apply: { attempted: 0, correct: 0, label: isHi ? 'लागू करें और हल करें' : 'Apply & Solve', icon: '🛠️', color: '#059669' },
              hots: { attempted: 0, correct: 0, label: isHi ? 'उच्च स्तरीय सोच (HOTS)' : 'Higher Order Thinking (HOTS)', icon: '🔥', color: '#7C3AED' },
            };

            topics.forEach((t, idx) => {
              const q = questions[idx % Math.max(questions.length, 1)];
              if (!q) return;
              const state = conceptStates[idx];
              if (!state || !state.submitted) return;

              const level = q.bloom_level?.toLowerCase() || 'remember';
              let paramKey: 'remember' | 'understand' | 'apply' | 'hots' = 'remember';
              if (level === 'understand') paramKey = 'understand';
              else if (level === 'apply') paramKey = 'apply';
              else if (['analyze', 'evaluate', 'create', 'hots'].includes(level)) paramKey = 'hots';

              parameterBreakdown[paramKey].attempted += 1;
              if (state.isCorrect) {
                parameterBreakdown[paramKey].correct += 1;
              }
            });

            return (
              <Card>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-bold text-[var(--text-2)]">
                    {isHi ? 'त्वरित जाँच स्कोर' : 'Quick Check Score'}
                  </span>
                  <span className="text-lg font-bold" style={{ color: scoreGood ? '#16A34A' : '#DC2626' }}>
                    {correctCount}/{totalAnswered} ({pct}%)
                  </span>
                </div>
                <ProgressBar value={pct} color={scoreGood ? '#16A34A' : '#DC2626'} showPercent />

                <div className="mt-5 pt-4 border-t border-gray-100 space-y-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                    {isHi ? 'CBSE पैरामीटर विश्लेषण' : 'CBSE Parameter Breakdown'}
                  </p>
                  <div className="grid gap-2">
                    {Object.entries(parameterBreakdown).map(([key, stat]) => {
                      const pPct = stat.attempted > 0 ? Math.round((stat.correct / stat.attempted) * 100) : 0;
                      return (
                        <div key={key} className="flex flex-col gap-1 p-2.5 rounded-xl bg-gray-50 border border-gray-100/50">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-gray-700 flex items-center gap-1.5">
                              <span>{stat.icon}</span>
                              <span>{stat.label}</span>
                            </span>
                            {stat.attempted > 0 ? (
                              <span className="font-bold text-gray-600">
                                {stat.correct}/{stat.attempted} ({pPct}%)
                              </span>
                            ) : (
                              <span className="text-[10px] text-gray-400 italic">
                                {isHi ? 'अमूल्यांकित' : 'Not tested'}
                              </span>
                            )}
                          </div>
                          {stat.attempted > 0 && (
                            <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1 overflow-hidden">
                              <div
                                className="h-1.5 rounded-full"
                                style={{
                                  width: `${pPct}%`,
                                  backgroundColor: stat.color,
                                }}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </Card>
            );
          })()}

          {/* Weak concepts — shown when score < 60% */}
          {wrongTopics.length > 0 && (
            <div className="rounded-2xl p-4" style={{ background: 'rgba(220,38,38,0.04)', border: '1px solid rgba(220,38,38,0.12)' }}>
              <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#DC2626' }}>
                {isHi ? '⚠️ इन अवधारणाओं पर और ध्यान दो' : '⚠️ Review these concepts'}
              </p>
              <div className="space-y-2">
                {wrongTopics.map((t, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: 'rgba(220,38,38,0.08)', color: '#DC2626' }}>✗</span>
                    <span className="text-xs text-[var(--text-2)]">{t.title}</span>
                  </div>
                ))}
              </div>
              <button
                onClick={() => {
                  track('learn_foxy_doubt_clicked', {
                    ...telemetryBase,
                    source: 'completion_weak_concepts',
                  });
                  router.push(`/foxy?subject=${subject}&chapter=${chapterNum}&mode=doubt`);
                }}
                className="mt-3 text-xs font-bold px-3 py-1.5 rounded-lg transition-all active:scale-95"
                style={{ background: 'rgba(220,38,38,0.08)', color: '#DC2626', border: '1px solid rgba(220,38,38,0.2)' }}
              >
                🦊 {isHi ? 'Foxy से ये समझो' : 'Clear doubts with Foxy'}
              </button>
            </div>
          )}

          <div className="space-y-3">
            {scoreGood ? (
              <Button
                fullWidth
                color={subMeta?.color}
                onClick={() => {
                  track('learn_take_quiz_clicked', {
                    ...telemetryBase,
                    score_pct: pct,
                  });
                  router.push(`/quiz?subject=${subject}&chapter=${chapterNum}`);
                }}
              >
                ⚡ {isHi ? `अध्याय ${chapterNum} का क्विज़ दो` : `Take Chapter ${chapterNum} Quiz`}
              </Button>
            ) : (
              <Button
                fullWidth
                color={subMeta?.color}
                onClick={askFoxy}
              >
                🦊 {isHi ? 'Foxy के साथ कमज़ोर हिस्से सुधारो' : 'Fix weak spots with Foxy'}
              </Button>
            )}
            <Button
              fullWidth
              variant="ghost"
              onClick={() => router.push(`/learn/${subject}/${chapterNum + 1}`)}
            >
              📖 {isHi ? `अगला अध्याय ${chapterNum + 1} →` : `Next Chapter ${chapterNum + 1} →`}
            </Button>
            {!scoreGood && (
              <Button
                fullWidth
                variant="ghost"
                onClick={() => router.push(`/quiz?subject=${subject}&chapter=${chapterNum}`)}
              >
                ⚡ {isHi ? 'फिर भी क्विज़ दो' : 'Take Quiz anyway'}
              </Button>
            )}
            <Button fullWidth variant="ghost" onClick={() => router.push('/learn')}>
              {isHi ? '← विषय सूची पर वापस जाओ' : '← Back to Subjects'}
            </Button>
          </div>
        </main>
        </AppShell>
      </div>
    );
  }

  // ── Load-error fallback (P0) ──
  // Distinct from the empty state below: this means the content fetch FAILED
  // (network/transient), not "loaded OK with no concepts". Mirrors the empty
  // state's AppShell + centered-card styling but offers a Retry that
  // re-invokes load(). Placed before the empty check because on error we have
  // no trustworthy topics to reason about.
  if (loadError) {
    return (
      <div className="mesh-bg">
        <AppShell
          variant="mobile"
          header={
            <div className="page-header-inner flex items-center gap-3">
              <button onClick={() => router.push('/dashboard')} className="text-[var(--text-3)]">&larr;</button>
              <span className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
                {subMeta?.icon} {subMeta?.name} · {isHi ? `अध्याय ${chapterNum}` : `Chapter ${chapterNum}`}
              </span>
            </div>
          }
        >
        <main className="w-full px-4 md:px-8 py-12 text-center">
          <div className="text-5xl mb-4">📡</div>
          <p className="text-base font-semibold text-[var(--text-2)] mb-2">
            {isHi ? 'यह अध्याय लोड नहीं हो सका' : "Couldn't load this chapter"}
          </p>
          <p className="text-sm text-[var(--text-3)] mb-6">
            {isHi ? 'नेटवर्क धीमा लग रहा है — फिर से कोशिश करो।' : 'Your network looks slow — please try again.'}
          </p>
          <Button onClick={() => load()} color={subMeta?.color}>
            🔄 {isHi ? 'फिर से कोशिश करो' : 'Retry'}
          </Button>
          <button
            onClick={() => router.push('/learn')}
            className="mt-3 block mx-auto px-6 py-2.5 rounded-xl text-sm font-semibold text-[var(--text-3)] hover:bg-gray-50 active:scale-[0.98] transition-all"
          >
            {isHi ? '← विषय सूची पर वापस जाओ' : '← Back to Subjects'}
          </button>
        </main>
        </AppShell>
      </div>
    );
  }

  // ── No topics fallback ──
  // Wrapped in AppShell variant="mobile" — same migration pattern as the
  // completion screen above. Header bag holds back-arrow + subject/chapter
  // breadcrumb; the empty-state CTAs stay in children. pb-nav dropped.
  if (topics.length === 0) {
    return (
      <div className="mesh-bg">
        <AppShell
          variant="mobile"
          
          header={
            <div className="page-header-inner flex items-center gap-3">
              <button onClick={() => router.push('/dashboard')} className="text-[var(--text-3)]">&larr;</button>
              <span className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
                {subMeta?.icon} {subMeta?.name} · {isHi ? `अध्याय ${chapterNum}` : `Chapter ${chapterNum}`}
              </span>
            </div>
          }
        >
        <main className="w-full px-4 md:px-8 py-12 text-center">
          <div className="text-5xl mb-4">📚</div>
          <p className="text-base font-semibold text-[var(--text-2)] mb-2">
            {isHi ? 'अभी कोई अवधारणा नहीं मिली' : 'No concepts found for this chapter yet'}
          </p>
          <p className="text-sm text-[var(--text-3)] mb-6">
            {isHi ? 'Foxy से इस अध्याय के बारे में पूछो' : 'Ask Foxy to teach you this chapter'}
          </p>
          <Button onClick={askFoxy} color={subMeta?.color}>
            🦊 {isHi ? 'Foxy से सीखो' : 'Learn with Foxy'}
          </Button>
          <button
            onClick={() => {
              const p = new URLSearchParams({ subject, mode: 'practice' });
              router.push(`/quiz?${p.toString()}`);
            }}
            className="mt-3 px-6 py-2.5 rounded-xl text-sm font-semibold bg-orange-500 text-white hover:bg-orange-600 active:scale-[0.98] transition-all"
          >
            {isHi ? '⚡ क्विज़ लो' : '⚡ Take a Quiz'}
          </button>
        </main>
        </AppShell>
      </div>
    );
  }

  const topic = topics[currentIdx];
  const question = questions.length > 0 ? questions[currentIdx % questions.length] : null;
  const diagram = diagrams.length > 0 ? diagrams[currentIdx % diagrams.length] : null;
  const conceptState = conceptStates[currentIdx];
  
  let progressPct = topics.length > 0 ? ((currentIdx + 1) / topics.length) * 100 : 0;
  if (phase === 'quiz') {
    progressPct = questions.length > 0 ? ((quizCurrentIdx + 1) / questions.length) * 100 : 100;
  } else if (phase === 'report') {
    progressPct = 100;
  }
  
  const bloomLevel = (topic?.bloom_focus || 'remember') as BloomLevel;
  const bloomCfg = BLOOM_CONFIG[bloomLevel] || BLOOM_CONFIG.remember;
  const opts = question ? parseOptions(question.options) : [];
  const isAnswered = conceptState?.submitted ?? false;
  const isCorrect = conceptState?.isCorrect ?? false;

  // ── Phase 2-B: Read mode branch ─────────────────────────────────────
  // When the flag is on AND the student is in Read mode, render the
  // chapter prose instead of the practice walkthrough. The toggle in the
  // header lets them switch back. If the fetcher returned no content,
  // ChapterReadView shows a friendly fallback and offers to switch back.
  if (mode === 'read' && readModeFlagOn) {
    return (
      <ChapterReadView
        subjectName={subMeta?.name ?? subject}
        subjectColor={subMeta?.color}
        subjectIcon={subMeta?.icon}
        chapterNumber={chapterNum}
        isHi={isHi}
        loading={readLoading}
        content={readContent}
        onBack={() => router.push('/dashboard')}
        onSwitchToPractice={switchToPracticeMode}
      />
    );
  }

  // ── Main concept walkthrough ──
  // Wrapped in AppShell variant="mobile". The page header (subject+chapter
  // breadcrumb, optional Read-mode toggle, concept counter, ProgressBar)
  // moves into the sticky header slot — AppShell.header is itself
  // position:sticky with backdrop blur, so the original inline backdrop
  // is dropped (the appshell-header CSS already paints the same effect).
  // The main column (Readiness card, concept card, Quick Check, next-CTA)
  // remains as children. The legacy `pb-nav` clearance is dropped since
  // .app-shell-content already pads --shell-nav-h + safe-area on the
  // bottom — so the "next concept" CTA pins above the BottomNav without
  // needing extra clearance.
  const learnHeaderContent = (
    <div className="w-full px-4 md:px-8 py-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <button onClick={() => router.push('/dashboard')} className="text-[var(--text-3)] mr-1">&larr;</button>
          <span className="text-lg">{subMeta?.icon}</span>
          <span className="text-sm font-semibold truncate" style={{ color: subMeta?.color }}>
            {subMeta?.name} · {isHi ? `अध्याय ${chapterNum}` : `Chapter ${chapterNum}`}
            {chapterMeta ? `: ${isHi && chapterMeta.title_hi ? chapterMeta.title_hi : chapterMeta.title}` : ''}
            {chapterMeta?.ncert_page_start ? (isHi ? ` (पृष्ठ ${chapterMeta.ncert_page_start}-${chapterMeta.ncert_page_end})` : ` (Pages ${chapterMeta.ncert_page_start}-${chapterMeta.ncert_page_end})`) : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {phase === 'explaining' && (
            <button
              type="button"
              onClick={() => setIsSidebarOpen(true)}
              className="md:hidden text-[10px] font-bold px-2.5 py-1 rounded-full transition-all active:scale-95 flex items-center gap-1"
              style={{ background: 'rgba(232,88,28,0.10)', color: 'var(--orange)', border: '1px solid rgba(232,88,28,0.2)' }}
            >
              📋 {isHi ? 'सूची' : 'Index'}
            </button>
          )}
          {readModeFlagOn && (
            <button
              type="button"
              onClick={switchToReadMode}
              className="text-[10px] font-bold px-2 py-1 rounded-full transition-all active:scale-95"
              style={{ background: 'rgba(124,58,237,0.10)', color: '#7C3AED', border: '1px solid rgba(124,58,237,0.2)' }}
              data-testid="learn-mode-read-toggle"
              aria-label={isHi ? 'पढ़ाई मोड पर जाएँ' : 'Switch to Read mode'}
            >
              📖 {isHi ? 'पढ़ें' : 'Read'}
            </button>
          )}
          {phase === 'explaining' && (
            <span className="text-xs font-medium text-[var(--text-3)]">
              {currentIdx + 1}/{topics.length}
            </span>
          )}
          {phase === 'quiz' && (
            <span className="text-xs font-medium text-[var(--text-3)]">
              {quizCurrentIdx + 1}/{questions.length}
            </span>
          )}
        </div>
      </div>
      <ProgressBar value={progressPct} color={subMeta?.color} height={5} />
    </div>
  );

  return (
    <div className="mesh-bg">
      <AppShell
        variant="mobile"
        
        header={learnHeaderContent}
        bleed={true}
      >
      {/* `h-full` lets `mt-auto` on the next-concept CTA pin it to the
          bottom of AppShell's content row — preserving the pre-shell
          "primary action stays in thumb reach" behavior. */}
      <main className="h-full w-full px-4 md:px-8 py-4 flex flex-col md:flex-row gap-6">
        
        {/* Sidebar Index (hidden on mobile, permanent on desktop md:flex) */}
        {phase === 'explaining' && (
          <aside className="hidden md:flex flex-col w-64 shrink-0 bg-white/70 backdrop-blur-md border border-gray-100 rounded-2xl p-4 self-start sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-3" style={{ fontFamily: 'var(--font-display)' }}>
              {isHi ? 'अध्याय की अवधारणाएँ' : 'Chapter Concepts'}
            </h3>
            <div className="space-y-1.5">
              {topics.map((t, idx) => {
                const isSelected = idx === currentIdx;
                const isCompleted = completedTopics.has(t.id);

                return (
                  <button
                    key={t.id}
                    onClick={() => {
                      setCurrentIdx(idx);
                      setActiveTab('core');
                    }}
                    className={`w-full text-left p-3 rounded-xl transition-all duration-200 flex items-center gap-3 text-xs border ${
                      isSelected 
                        ? 'bg-orange-50/50 border-orange-200 shadow-sm font-semibold text-orange-950' 
                        : 'border-transparent hover:bg-gray-50 text-gray-700'
                    }`}
                  >
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 transition-all ${
                      isCompleted 
                        ? 'bg-green-100 text-green-700 font-bold' 
                        : isSelected 
                          ? 'bg-orange-500 text-white shadow-sm' 
                          : 'bg-gray-100 text-gray-400'
                    }`}>
                      {isCompleted ? '✓' : isSelected ? '▶' : idx + 1}
                    </span>
                    <span className="leading-snug font-medium line-clamp-2">
                      {isHi && t.title_hi ? t.title_hi : t.title}
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>
        )}

        {/* Slide-out Mobile Drawer */}
        {phase === 'explaining' && isSidebarOpen && (
          <div className="fixed inset-0 z-50 flex md:hidden animate-fadeIn">
            {/* Backdrop */}
            <div 
              className="absolute inset-0 bg-black/30 backdrop-blur-sm"
              onClick={() => setIsSidebarOpen(false)}
            />
            {/* Drawer Content */}
            <div className="absolute right-0 top-0 bottom-0 w-72 bg-white p-4 shadow-2xl flex flex-col gap-4 overflow-y-auto">
              <div className="flex items-center justify-between border-b pb-2">
                <h3 className="text-sm font-bold text-gray-800" style={{ fontFamily: 'var(--font-display)' }}>
                  {isHi ? 'अध्याय की अवधारणाएँ' : 'Chapter Concepts'}
                </h3>
                <button onClick={() => setIsSidebarOpen(false)} className="text-gray-400 font-bold text-lg">&times;</button>
              </div>
              <div className="space-y-1.5 flex-1">
                {topics.map((t, idx) => {
                  const isSelected = idx === currentIdx;
                  const isCompleted = completedTopics.has(t.id);

                  return (
                    <button
                      key={t.id}
                      onClick={() => {
                        setCurrentIdx(idx);
                        setActiveTab('core');
                        setIsSidebarOpen(false);
                      }}
                      className={`w-full text-left p-3 rounded-xl transition-all duration-200 flex items-center gap-3 text-xs border ${
                        isSelected 
                          ? 'bg-orange-50/50 border-orange-200 shadow-sm font-semibold text-orange-950' 
                          : 'border-transparent hover:bg-gray-50 text-gray-700'
                      }`}
                    >
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 transition-all ${
                        isCompleted 
                          ? 'bg-green-100 text-green-700 font-bold' 
                          : isSelected 
                            ? 'bg-orange-500 text-white shadow-sm' 
                            : 'bg-gray-100 text-gray-400'
                      }`}>
                        {isCompleted ? '✓' : isSelected ? '▶' : idx + 1}
                      </span>
                      <span className="leading-snug font-medium line-clamp-2">
                        {isHi && t.title_hi ? t.title_hi : t.title}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Main Card Panel Column */}
        <div className="flex-1 max-w-2xl w-full flex flex-col gap-4">

          {phase === 'explaining' && (
            <>
              {/* ── Exam-Ready 360° Phase 2: per-chapter readiness card ── */}
              {(currentIdx > 0 ||
                Object.values(conceptStates).some(s => s.submitted) ||
                (readiness && readiness.recent_quiz_count > 0)) && (
                <ChapterReadinessCard
                  subjectCode={subject}
                  chapterNumber={chapterNum}
                  subjectColor={subMeta?.color}
                  onReviewWeakConcept={handleReviewWeakConcept}
                />
              )}

              {/* Concept label */}
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-[var(--text-3)] uppercase tracking-wider">
                  {isHi ? `अवधारणा ${currentIdx + 1}/${topics.length}` : `Concept ${currentIdx + 1} of ${topics.length}`}
                </span>
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{ background: `${bloomCfg.color}18`, color: bloomCfg.color }}
                >
                  {bloomCfg.icon} {isHi ? bloomCfg.labelHi : bloomCfg.label}
                </span>
              </div>

              {/* Progress bar + estimated time */}
              <div className="space-y-1">
                <div className="w-full bg-gray-200 rounded-full h-1.5">
                  <div
                    className="bg-orange-500 h-1.5 rounded-full transition-all duration-500"
                    style={{ width: `${((currentIdx + 1) / topics.length) * 100}%` }}
                  />
                </div>
                {(() => {
                  const remaining = topics.length - currentIdx - 1;
                  const remainingMin = remaining * 3;
                  return remaining > 0 ? (
                    <p className="text-[10px] text-gray-400 text-right">
                      {isHi ? `~${remainingMin} मिनट शेष` : `~${remainingMin} min remaining`}
                    </p>
                  ) : null;
                })()}
              </div>

              {/* Concept card with tabbed layout */}
              <Card className="!p-5 flex flex-col gap-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold leading-tight mb-1" style={{ fontFamily: 'var(--font-display)' }}>
                      {isHi && (topic as { title_hi?: string | null }).title_hi
                        ? (topic as { title_hi?: string | null }).title_hi
                        : topic.title}
                    </h2>
                    {topic.ncert_page_range && (
                      <p className="text-xs text-gray-500 font-medium flex items-center gap-1">
                        📖 {isHi ? `एनसीईआरटी पृष्ठ ${topic.ncert_page_range}` : `NCERT Page ${topic.ncert_page_range}`}
                      </p>
                    )}
                  </div>
                  {(topic as any).key_formula && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 uppercase whitespace-nowrap">
                      {isHi ? '📐 सूत्र शामिल' : '📐 Formula Included'}
                    </span>
                  )}
                </div>

                <div className="flex p-1 bg-gray-50 rounded-xl border border-gray-100 gap-1">
                  <button
                    onClick={() => setActiveTab('core')}
                    className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all duration-200 flex items-center justify-center gap-1.5 ${
                      activeTab === 'core'
                        ? 'bg-white text-[var(--orange)] shadow-sm'
                        : 'text-gray-500 hover:text-gray-800'
                    }`}
                  >
                    📖 {isHi ? 'मुख्य पाठ' : 'Learning Core'}
                  </button>
                  <button
                    onClick={() => setActiveTab('example')}
                    className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all duration-200 flex items-center justify-center gap-1.5 ${
                      activeTab === 'example'
                        ? 'bg-white text-[var(--orange)] shadow-sm'
                        : 'text-gray-500 hover:text-gray-800'
                    }`}
                  >
                    📝 {isHi ? 'हल किया हुआ उदाहरण' : 'Solved Example'}
                  </button>
                  <button
                    onClick={() => setActiveTab('cheat')}
                    className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all duration-200 flex items-center justify-center gap-1.5 ${
                      activeTab === 'cheat'
                        ? 'bg-white text-[var(--orange)] shadow-sm'
                        : 'text-gray-500 hover:text-gray-800'
                    }`}
                  >
                    🦊 {isHi ? 'चीट शीट' : "Foxy's Notes"}
                  </button>
                </div>

                <div className="mt-2">
                  {activeTab === 'core' && (
                    <div className="space-y-4">
                      {productiveFailureActive && question && !isAnswered && (
                        <div
                          className="rounded-xl p-3 mb-3"
                          style={{ background: 'rgba(249,115,22,0.06)', border: '1px solid rgba(249,115,22,0.2)' }}
                          data-testid="productive-failure-banner"
                        >
                          <p className="text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: '#F97316' }}>
                            {isHi ? 'पहले इसे आज़माओ' : 'Try this first'}
                          </p>
                          <p className="text-xs text-[var(--text-2)] leading-snug">
                            {isHi
                              ? 'पाठ देखने से पहले नीचे का सवाल हल करो — सीखने का यह सबसे असरदार तरीका है।'
                              : 'Attempt the Quick Check below before reading the explanation — research shows this is the most effective way to learn.'}
                          </p>
                        </div>
                      )}

                      {(!productiveFailureActive || isAnswered) && diagram && diagram.image_url && (
                        <div className="rounded-xl overflow-hidden mb-3" style={{ border: '1px solid var(--border)' }}>
                          <img
                            src={diagram.image_url}
                            alt={diagram.alt_text || topic.title}
                            className="w-full object-contain max-h-52"
                            style={{ background: 'var(--surface-2)' }}
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                          {(diagram.caption || diagram.caption_hi) && (
                            <p className="text-[11px] text-[var(--text-3)] px-3 py-2 text-center">
                              {isHi && diagram.caption_hi ? diagram.caption_hi : diagram.caption}
                            </p>
                          )}
                        </div>
                      )}

                      {(() => {
                        const coreText = isHi && (topic as any).explanation_hi
                          ? (topic as any).explanation_hi
                          : (topic as any).explanation
                          ? (topic as any).explanation
                          : topic.description || '';

                         const coreBlocks = parseCbseTeacherExplanation(coreText, topic.title, isHi);
                        const totalBlocks = coreBlocks.length;
                        const currentRevealedCount = revealedCorePoints[currentIdx] || 1;
                        const showAll = showAllCore[currentIdx] || false;

                        if (totalBlocks <= 0) return null;

                        const visibleBlocks = showAll ? coreBlocks : coreBlocks.slice(0, currentRevealedCount);

                        return (
                          <>
                            {(!productiveFailureActive || isAnswered) && totalBlocks > 1 && (
                              <div className="flex items-center justify-between mb-2 text-[10px] text-gray-400 font-bold uppercase tracking-wider bg-gray-50/50 p-2 rounded-lg border border-gray-100">
                                <div className="flex items-center gap-1.5">
                                  <span>{isHi ? 'प्रगति' : 'Progress'}:</span>
                                  <div className="flex gap-1">
                                    {coreBlocks.map((_, bIdx) => (
                                      <span
                                        key={bIdx}
                                        className="w-1.5 h-1.5 rounded-full transition-all duration-300"
                                        style={{
                                          backgroundColor: showAll || bIdx < currentRevealedCount
                                            ? (subMeta?.color || 'var(--orange)')
                                            : 'var(--border)'
                                        }}
                                      />
                                    ))}
                                  </div>
                                  <span className="ml-1 text-gray-500">
                                    {showAll ? totalBlocks : currentRevealedCount}/{totalBlocks}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setShowAllCore(prev => ({ ...prev, [currentIdx]: !showAll }))}
                                  className="transition-all flex items-center gap-1 uppercase tracking-wider font-bold"
                                  style={{ color: subMeta?.color || 'var(--orange)' }}
                                >
                                  {showAll 
                                    ? (isHi ? '⚡ चरणबद्ध पढ़ें' : '⚡ Read Stepwise') 
                                    : (isHi ? '📖 सब दिखाएं' : '📖 Show All')}
                                </button>
                              </div>
                            )}

                            {(!productiveFailureActive || isAnswered) && (
                              <div className="space-y-4 animate-fadeIn">
                                {visibleBlocks.map((block: any, bIdx) => {
                                  const theme = STEP_THEMES[block.type as keyof typeof STEP_THEMES] || STEP_THEMES.fact;
                                  return (
                                    <div
                                      key={bIdx}
                                      className="p-5 rounded-2xl border transition-all duration-300 animate-fadeIn bg-white shadow-sm"
                                      style={{
                                        borderLeft: `4px solid ${theme.color}`,
                                        borderColor: 'var(--border)',
                                      }}
                                    >
                                      <div className="flex items-center justify-between mb-3">
                                        <span className="text-xs font-bold flex items-center gap-2" style={{ color: theme.color }}>
                                          <span>{theme.icon}</span>
                                          <span style={{ fontFamily: 'var(--font-display)' }}>
                                            {isHi && block.titleHi ? block.titleHi : block.title}
                                          </span>
                                        </span>
                                        <span
                                          className="text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-0.5 rounded-full"
                                          style={{ backgroundColor: theme.badgeBg, color: theme.badgeFg }}
                                        >
                                          {theme.label}
                                        </span>
                                      </div>
                                      <p className="text-xs font-medium leading-relaxed whitespace-pre-wrap text-[var(--text-2)]">
                                        {isHi && block.contentHi ? block.contentHi : block.content}
                                      </p>
                                      {block.mathExpression && (
                                        <div className="mt-3 p-3.5 bg-gray-50 rounded-xl font-mono text-center text-xs font-bold text-gray-900 border border-gray-100/80">
                                          {block.mathExpression}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            {!showAll && currentRevealedCount < totalBlocks && (!productiveFailureActive || isAnswered) && (
                              <Button
                                fullWidth
                                variant="soft"
                                color={subMeta?.color}
                                onClick={() => setRevealedCorePoints(prev => ({ ...prev, [currentIdx]: currentRevealedCount + 1 }))}
                                className="mt-3 text-xs font-bold py-2.5 rounded-xl transition-all active:scale-[0.97]"
                              >
                                👇 {isHi ? 'अगला बिंदु समझें' : 'Next Concept Point'} ({currentRevealedCount}/{totalBlocks})
                              </Button>
                            )}

                            {(!showAll && currentRevealedCount === totalBlocks && totalBlocks > 1 && (!productiveFailureActive || isAnswered)) && (
                              <div
                                className="rounded-xl p-3 mt-3 flex items-center gap-2 border animate-fadeIn"
                                style={{
                                  background: 'rgba(22, 163, 74, 0.04)',
                                  borderColor: 'rgba(22, 163, 74, 0.15)',
                                }}
                              >
                                <span className="text-base">🚀</span>
                                <span className="text-xs font-bold text-green-700">
                                  {isHi 
                                    ? 'सभी मुख्य बिंदु पढ़ लिए! नीचे के प्रश्न का उत्तर दें।' 
                                    : 'All points read! Ready to check your understanding below.'}
                                </span>
                              </div>
                            )}
                          </>
                        );
                      })()}

                      {/* Teacher's Corner */}
                      {(!productiveFailureActive || isAnswered) && (() => {
                        const insights = getTeacherInsights(topic.title, isHi);
                        return (
                          <div className="mt-6 p-5 rounded-2xl bg-[#0F2A2E] text-[#F5F0EA] border border-emerald-950/40 shadow-lg space-y-4 animate-fadeIn">
                            <div className="flex items-center justify-between pb-3 border-b border-emerald-900/30">
                              <span className="text-sm font-bold text-white flex items-center gap-2" style={{ fontFamily: 'var(--font-serif)' }}>
                                <span>🎓</span>
                                <span>{isHi ? 'शिक्षक का ब्लैकबोर्ड (Tricks & Analogy)' : "Teacher's Blackboard (Tricks & Analogy)"}</span>
                              </span>
                              <span className="text-[10px] font-extrabold uppercase tracking-wider text-amber-300 bg-amber-950/40 px-2.5 py-0.5 rounded-full border border-amber-500/20">
                                CBSE Guide
                              </span>
                            </div>

                            {/* Analogy */}
                            <div className="space-y-1.5">
                              <p className="text-[10px] font-extrabold text-teal-300 uppercase tracking-widest flex items-center gap-1.5">
                                <span>💡</span>
                                <span>{isHi ? 'सरल दैनिक जीवन का उदाहरण (Analogy)' : 'Real-World Analogy'}</span>
                              </p>
                              <p className="text-xs text-[#F5F0EA] leading-relaxed font-medium opacity-90">
                                {insights.analogy}
                              </p>
                            </div>

                            {/* Exam Hack */}
                            <div className="space-y-1.5">
                              <p className="text-[10px] font-extrabold text-teal-300 uppercase tracking-widest flex items-center gap-1.5">
                                <span>🎯</span>
                                <span>{isHi ? 'बोर्ड परीक्षा टिप (Exam Secret)' : 'Board Exam Secret'}</span>
                              </p>
                              <p className="text-xs text-[#F5F0EA] leading-relaxed font-medium opacity-90">
                                {insights.examHack}
                              </p>
                            </div>

                            {/* Mnemonic */}
                            {insights.mnemonic && (
                              <div className="space-y-1.5">
                                <p className="text-[10px] font-extrabold text-teal-300 uppercase tracking-widest flex items-center gap-1.5">
                                  <span>🔑</span>
                                  <span>{isHi ? 'याद रखने का शॉर्टकट (Memory Trick)' : 'Memory Shortcut / Mnemonic'}</span>
                                </p>
                                <p className="text-xs text-amber-200 font-mono font-bold bg-teal-950/30 p-3 rounded-xl border border-teal-900/50">
                                  {insights.mnemonic}
                                </p>
                              </div>
                            )}

                            {/* Ask Doubt Link */}
                            <div className="pt-2">
                              <button
                                onClick={() => {
                                  const promptText = isHi
                                    ? `कृपया मुझे "${topic.title}" की अवधारणा को एक और सरल उदाहरण और बोर्ड परीक्षा के प्रश्नों के साथ समझाएं।`
                                    : `Please explain the concept of "${topic.title}" with another simple analogy and show me how CBSE asks questions from this topic.`;
                                  const topicParam = encodeURIComponent(topic.title);
                                  track('learn_foxy_doubt_clicked', {
                                    ...telemetryBase,
                                    source: 'in_flow',
                                  });
                                  router.push(`/foxy?subject=${subject}&mode=doubt&topic=${topicParam}&prompt=${encodeURIComponent(promptText)}`);
                                }}
                                className="w-full py-3 px-4 rounded-xl text-xs font-bold bg-gradient-to-r from-[var(--orange)] to-amber-500 text-white hover:opacity-95 active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-md shadow-orange-950/20"
                              >
                                💬 {isHi ? 'शिक्षक से इस विषय पर डाउट पूछें' : 'Ask Teacher a Doubt / Analogy'}
                              </button>
                            </div>
                          </div>
                        );
                      })()}

                      {(!productiveFailureActive || isAnswered) && topic.learning_objectives && topic.learning_objectives.length > 0 && (
                        <div className="rounded-xl p-3" style={{ background: `${subMeta?.color || 'var(--orange)'}08`, border: `1px solid ${subMeta?.color || 'var(--orange)'}20` }}>
                          <p className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: subMeta?.color }}>
                            {isHi ? 'इस अवधारणा में सीखोगे' : 'You will learn'}
                          </p>
                          <ul className="space-y-1">
                            {topic.learning_objectives.slice(0, 4).map((obj, i) => (
                              <li key={i} className="flex items-start gap-2 text-xs text-[var(--text-2)]">
                                <span className="mt-0.5 flex-shrink-0" style={{ color: subMeta?.color }}>•</span>
                                {obj}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

                  {activeTab === 'example' && (() => {
                    const exampleRaw = isHi && (topic as any).example_content_hi
                      ? (topic as any).example_content_hi
                      : (topic as any).example_content
                      ? (topic as any).example_content
                      : isHi
                      ? `प्रश्न: ${topic.title} को समझाइए और एक उदाहरण दीजिए।\n\n[चरण 1: परिभाषा]\nसबसे पहले, ${topic.title} की मुख्य अवधारणा को समझें। यह एक महत्वपूर्ण CBSE अवधारणा है।\n\n[चरण 2: व्याख्या]\nइस नियम के अनुसार, हम चरणों में काम करते हैं।\n\n[चरण 3: बोर्ड परीक्षा टिप]\nपरीक्षा में अच्छे अंक प्राप्त करने के लिए हमेशा साफ-सुथरा आरेख बनाएं और महत्वपूर्ण शब्दों को रेखांकित करें।`
                      : `Question: Explain the core concepts of ${topic.title} and give a step-by-step solved problem.\n\n[Step 1: Definition & Formula]\nLet's state the fundamental principle of ${topic.title}. Understand the main variables and relations.\n\n[Step 2: Mathematical Derivation / Application]\nApply the formula step-by-step to compute the result. Ensure units are correct.\n\n[Step 3: Board Exam Tip]\nAlways write down the given values, state the formula used, and draw a neat diagram to score full marks in your CBSE board exams.`;

                    const steps = exampleRaw.split(/(?=\[Step|\[चरण|Step|चरण)/i).map((s: string) => s.trim()).filter(Boolean);
                    const maxSteps = steps.length;
                    const revealedCount = visibleSteps[currentIdx] || 1;

                    return (
                      <div className="space-y-4">
                        <div className="space-y-3">
                          {steps.slice(0, revealedCount).map((stepText: string, sIdx: number) => {
                            return (
                              <div
                                key={sIdx}
                                className={`p-3 rounded-xl transition-all duration-300 animate-fadeIn ${
                                  sIdx === 0
                                    ? 'bg-cream border border-orange-100'
                                    : 'bg-gray-50 border border-gray-100'
                                }`}
                              >
                                <p className="text-sm text-[var(--text-2)] whitespace-pre-wrap leading-relaxed">
                                  {stepText}
                                </p>
                              </div>
                            );
                          })}
                        </div>

                        {revealedCount < maxSteps && (
                          <Button
                            fullWidth
                            variant="soft"
                            color={subMeta?.color}
                            onClick={() => setVisibleSteps(prev => ({ ...prev, [currentIdx]: revealedCount + 1 }))}
                            className="mt-2 text-xs font-bold py-2 rounded-xl transition-all active:scale-[0.97]"
                          >
                            👇 {isHi ? 'अगला चरण देखें' : 'Reveal Next Step'} ({revealedCount}/{maxSteps})
                          </Button>
                        )}
                      </div>
                    );
                  })()}

                  {activeTab === 'cheat' && (
                    <div className="space-y-3">
                      {((topic as any).key_formula || isHi) && (
                        <div className="p-3.5 rounded-xl bg-orange-50/40 border border-orange-100/60">
                          <p className="text-[10px] font-bold text-orange-600 uppercase tracking-wider mb-1.5">
                            📐 {isHi ? 'महत्वपूर्ण सूत्र / दृष्टिकोण' : 'Key Formula / Mnemonic'}
                          </p>
                          <p className="text-sm font-semibold text-gray-800 font-mono">
                            {(topic as any).key_formula || (isHi ? 'मुख्य अवधारणाओं को याद रखें।' : 'Understand the relations and apply rules step by step.')}
                          </p>
                        </div>
                      )}

                      <div className="p-3.5 rounded-xl bg-red-50/30 border border-red-100/50">
                        <p className="text-[10px] font-bold text-red-600 uppercase tracking-wider mb-1.5">
                          ⚠️ {isHi ? 'सीबीएसई बोर्ड परीक्षा की सामान्य गलतियाँ' : 'Common Board Exam Mistakes to Avoid'}
                        </p>
                        <ul className="space-y-1.5 text-xs text-red-800/80 leading-relaxed list-disc pl-4">
                          <li>
                            {isHi
                              ? 'जल्दबाजी में संकेतों (+/-) की गलती न करें।'
                              : 'Do not hurry through calculations; check the signs (+/-) at each step.'}
                          </li>
                          <li>
                            {isHi
                              ? 'हमेशा अपने उत्तर के साथ सही इकाई (SI units) लिखें।'
                              : 'Always specify the final units in the answer; CBSE deducts marks for missing units.'}
                          </li>
                          <li>
                            {isHi
                              ? 'उत्तर लिखने से पहले दिया गया डेटा (Given data) जरूर लिखें।'
                              : 'For maximum marks, write down the "Given parameters" before starting the calculation.'}
                          </li>
                        </ul>
                      </div>

                      <div className="p-3.5 rounded-xl bg-teal-50/30 border border-teal-100/50">
                        <p className="text-[10px] font-bold text-teal-700 uppercase tracking-wider mb-1">
                          🦊 {isHi ? 'Foxy की सलाह' : "Foxy's Quick Revision Tip"}
                        </p>
                        <p className="text-xs text-teal-900/80 leading-relaxed">
                          {isHi
                            ? 'इस अवधारणा से सीधे सवाल पूछे जाते हैं। परिभाषा के साथ एक उदाहरण याद रखें!'
                            : 'CBSE frequently asks direct theoretical or derivation questions on this concept. Memorize the basic statement along with one solved board example!'}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </Card>

              {/* Quick Check */}
              {question && (() => {
                const getQuestionParameter = (q: any) => {
                  const level = q?.bloom_level?.toLowerCase() || 'remember';
                  if (level === 'remember') return { label: isHi ? '🧠 स्मरण और याद' : '🧠 Remember & Recall', color: '#6B7280', bg: 'rgba(107, 114, 128, 0.08)' };
                  if (level === 'understand') return { label: isHi ? '💡 समझें और समझाएं' : '💡 Understand & Explain', color: '#2563EB', bg: 'rgba(37, 99, 235, 0.08)' };
                  if (level === 'apply') return { label: isHi ? '🛠️ लागू करें और हल करें' : '🛠️ Apply & Solve', color: '#059669', bg: 'rgba(5, 150, 105, 0.08)' };
                  return { label: isHi ? '🔥 उच्च स्तरीय सोच (HOTS)' : '🔥 Higher Order Thinking (HOTS)', color: '#7C3AED', bg: 'rgba(124, 58, 237, 0.08)' };
                };
                const param = getQuestionParameter(question);

                return (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[11px] font-bold text-[var(--text-3)] uppercase tracking-wider">
                        {isHi ? '⚡ त्वरित जाँच' : '⚡ Quick Check'}
                      </p>
                      <span
                        className="text-[10px] font-bold px-2.5 py-0.5 rounded-full"
                        style={{ color: param.color, background: param.bg }}
                      >
                        {param.label}
                      </span>
                    </div>
                    <Card className="!p-4">
                      <p className="text-sm font-semibold leading-relaxed mb-4" style={{ whiteSpace: 'pre-wrap' }}>
                        {isHi && question.question_hi ? question.question_hi : question.question_text}
                      </p>

                      {opts.length === 0 && !isAnswered && (
                        <div className="rounded-xl p-4 flex items-start gap-3" style={{ background: 'rgba(232, 88, 28, 0.06)', border: '1px solid rgba(232, 88, 28, 0.18)' }}>
                          <span className="text-xl shrink-0" aria-hidden="true">🦊</span>
                          <div className="flex-1">
                            <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-1)' }}>
                              {isHi ? 'यह प्रश्न खुले उत्तर का है — Foxy के साथ हल करो।' : 'This one needs working out — solve it with Foxy.'}
                            </p>
                            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-2)' }}>
                              {isHi ? 'Foxy तुम्हें step-by-step ले जाएगा। फिर अगली अवधारणा पर बढ़ो।' : 'Foxy will walk you through it step by step, then you can move to the next concept.'}
                            </p>
                            <Button color="#E8581C" className="mt-3" onClick={askFoxy}>
                              🦊 {isHi ? 'Foxy से हल कराओ' : 'Solve with Foxy'}
                            </Button>
                          </div>
                        </div>
                      )}

                      <div className="space-y-2">
                        {opts.map((opt, idx) => {
                          const letter = OPTION_LETTERS[idx] || String(idx + 1);
                          const optText = opt.replace(/^[A-D][\.\)]\s*/, '');
                          const isSelected = conceptState?.selectedOption === idx;
                          const isCorrectOpt = idx === question.correct_answer_index;

                          let bg = 'white';
                          let border = 'rgba(26, 18, 7, 0.08)';
                          let textColor = 'var(--text-2)';
                          let letterBg = 'var(--surface-2)';
                          let letterColor = 'var(--text-3)';

                          if (isAnswered) {
                            if (isCorrectOpt) {
                              bg = 'rgba(22, 163, 74, 0.08)';
                              border = 'rgba(22, 163, 74, 0.4)';
                              textColor = '#16A34A';
                              letterBg = '#16A34A';
                              letterColor = '#fff';
                            } else if (isSelected) {
                              bg = 'rgba(220, 38, 38, 0.06)';
                              border = 'rgba(220, 38, 38, 0.3)';
                              textColor = '#DC2626';
                              letterBg = '#DC2626';
                              letterColor = '#fff';
                            }
                          } else if (isSelected) {
                            const activeColor = subMeta?.color || 'var(--orange)';
                            bg = `${activeColor}08`;
                            border = activeColor;
                            letterBg = activeColor;
                            letterColor = '#fff';
                          }

                          return (
                            <button
                              key={idx}
                              onClick={() => selectOption(idx)}
                              disabled={isAnswered}
                              className={`w-full rounded-xl py-3.5 px-4 flex items-center gap-3 border transition-all duration-200 text-left active:scale-[0.98] ${
                                !isAnswered && !isSelected ? 'hover:border-gray-300 hover:bg-gray-50/50' : ''
                              }`}
                              style={{ 
                                backgroundColor: bg, 
                                border: `1.5px solid ${border}`, 
                                minHeight: 52 
                              }}
                            >
                              <span 
                                className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 transition-all" 
                                style={{ backgroundColor: letterBg, color: letterColor }}
                              >
                                {letter}
                              </span>
                              <span className="text-sm font-semibold leading-snug flex-1" style={{ color: textColor }}>
                                {optText}
                              </span>
                              {isAnswered && isCorrectOpt && <span className="ml-auto text-base text-green-600 font-bold flex-shrink-0">✓</span>}
                              {isAnswered && isSelected && !isCorrectOpt && <span className="ml-auto text-base text-red-600 font-bold flex-shrink-0">✗</span>}
                            </button>
                          );
                        })}
                      </div>

                      {!isAnswered && opts.length > 0 && (
                        <Button
                          fullWidth
                          className="mt-3"
                          color={subMeta?.color}
                          onClick={submitAnswer}
                          disabled={conceptState?.selectedOption === undefined || conceptState?.selectedOption === null}
                        >
                          {isHi ? 'जवाब जाँचो' : 'Check Answer'}
                        </Button>
                      )}

                      {isAnswered && (
                        <div
                          className="mt-3 rounded-xl p-3"
                          style={{
                            background: isCorrect ? 'rgba(22,163,74,0.05)' : 'rgba(220,38,38,0.04)',
                            border: `1px solid ${isCorrect ? 'rgba(22,163,74,0.15)' : 'rgba(220,38,38,0.12)'}`,
                          }}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <span>{isCorrect ? '🎉' : '💡'}</span>
                            <span className="text-xs font-bold" style={{ color: isCorrect ? '#16A34A' : '#DC2626' }}>
                              {isCorrect
                                ? (isHi ? 'शाबाश! सही जवाब!' : 'Correct!')
                                : (isHi ? 'गलत — पर सीखो!' : 'Not quite — here\'s why:')}
                            </span>
                          </div>
                          <p className="text-xs leading-relaxed text-[var(--text-2)]">
                            {isHi && question.explanation_hi ? question.explanation_hi : question.explanation || (isHi ? 'ऊपर दी गई अवधारणा दोबारा पढ़ो।' : 'Review the concept.')}
                          </p>
                        </div>
                      )}
                    </Card>
                  </div>
                );
              })()}

              {/* Explainer Phase Navigation */}
              <div className="flex flex-col gap-2 mt-auto pb-2">
                <Button
                  fullWidth
                  color={subMeta?.color}
                  onClick={handleMarkUnderstood}
                >
                  {isHi ? '✓ अवधारणा समझी, आगे बढ़ें →' : '✓ Understood, Continue →'}
                </Button>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={goPrev} disabled={currentIdx === 0} className="flex-1">
                    ← {isHi ? 'पिछला' : 'Prev'}
                  </Button>
                  <Button variant="soft" color="#E8581C" onClick={askFoxy} className="flex-1">
                    🦊 {isHi ? 'Foxy से पूछो' : 'Ask Foxy'}
                  </Button>
                </div>
              </div>
            </>
          )}

          {phase === 'quiz' && (
            <div className="space-y-4 animate-fadeIn">
              {/* Quiz status / progress */}
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold text-[var(--text-3)] uppercase tracking-wider">
                  {isHi ? `प्रश्न ${quizCurrentIdx + 1}/${questions.length}` : `Question ${quizCurrentIdx + 1} of ${questions.length}`}
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-100">
                  📝 {isHi ? 'NCERT आधारित मूल्यांकन' : 'NCERT Aligned Quiz'}
                </span>
              </div>

              {questions.length === 0 ? (
                <Card className="p-6 text-center">
                  <p className="text-sm font-semibold text-gray-600 mb-4">
                    {isHi ? 'इस अध्याय के लिए कोई अभ्यास प्रश्न नहीं मिले।' : 'No quiz questions found for this chapter.'}
                  </p>
                  <Button onClick={() => setPhase('report')} color={subMeta?.color}>
                    {isHi ? 'परिणाम रिपोर्ट देखें' : 'View Performance Report'}
                  </Button>
                </Card>
              ) : (() => {
                const q = questions[quizCurrentIdx];
                const qOpts = parseOptions(q.options);
                const isAns = quizAnswers[q.id] !== undefined;
                const selectAns = quizAnswers[q.id];
                const isCorr = selectAns?.isCorrect ?? false;

                return (
                  <Card className="!p-5 flex flex-col gap-4">
                    <p className="text-sm font-semibold leading-relaxed mb-2" style={{ whiteSpace: 'pre-wrap' }}>
                      {isHi && q.question_hi ? q.question_hi : q.question_text}
                    </p>

                    <div className="space-y-2">
                      {qOpts.map((opt, idx) => {
                        const letter = OPTION_LETTERS[idx] || String(idx + 1);
                        const optText = opt.replace(/^[A-D][\.\)]\s*/, '');
                        const isSel = quizSelectedOption === idx;
                        const isCorrOpt = idx === q.correct_answer_index;

                        let bg = 'white';
                        let border = 'rgba(26, 18, 7, 0.08)';
                        let textColor = 'var(--text-2)';
                        let letterBg = 'var(--surface-2)';
                        let letterColor = 'var(--text-3)';

                        if (isAns) {
                          if (isCorrOpt) {
                            bg = 'rgba(22, 163, 74, 0.08)';
                            border = 'rgba(22, 163, 74, 0.4)';
                            textColor = '#16A34A';
                            letterBg = '#16A34A';
                            letterColor = '#fff';
                          } else if (selectAns?.selectedOption === idx) {
                            bg = 'rgba(220, 38, 38, 0.06)';
                            border = 'rgba(220, 38, 38, 0.3)';
                            textColor = '#DC2626';
                            letterBg = '#DC2626';
                            letterColor = '#fff';
                          }
                        } else if (isSel) {
                          const activeColor = subMeta?.color || 'var(--orange)';
                          bg = `${activeColor}08`;
                          border = activeColor;
                          letterBg = activeColor;
                          letterColor = '#fff';
                        }

                        return (
                          <button
                            key={idx}
                            onClick={() => {
                              if (!isAns) setQuizSelectedOption(idx);
                            }}
                            disabled={isAns}
                            className={`w-full rounded-xl py-3.5 px-4 flex items-center gap-3 transition-all duration-200 text-left active:scale-[0.98] ${
                              !isAns && !isSel ? 'hover:border-gray-300 hover:bg-gray-50/50' : ''
                            }`}
                            style={{ 
                              backgroundColor: bg, 
                              border: `1.5px solid ${border}`, 
                              minHeight: 52 
                            }}
                          >
                            <span
                              className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 transition-all"
                              style={{ backgroundColor: letterBg, color: letterColor }}
                            >
                              {letter}
                            </span>
                            <span className="text-sm font-semibold leading-snug flex-1" style={{ color: textColor }}>
                              {optText}
                            </span>
                            {isAns && isCorrOpt && <span className="ml-auto text-base text-green-600 font-bold flex-shrink-0">✓</span>}
                            {isAns && selectAns?.selectedOption === idx && !isCorrOpt && <span className="ml-auto text-base text-red-600 font-bold flex-shrink-0">✗</span>}
                          </button>
                        );
                      })}
                    </div>

                    {!isAns && (
                      <Button
                        fullWidth
                        className="mt-3"
                        color={subMeta?.color}
                        onClick={() => {
                          if (quizSelectedOption === null) return;
                          const isCorrect = quizSelectedOption === q.correct_answer_index;
                          
                          if (isCorrect) {
                            confetti({
                              particleCount: 50,
                              spread: 60,
                              origin: { y: 0.8 },
                              colors: ['#16A34A', '#22C55E', '#86EFAC']
                            });
                          }

                          setQuizAnswers(prev => ({
                            ...prev,
                            [q.id]: { selectedOption: quizSelectedOption, isCorrect }
                          }));

                          const matchedTopicId = getTopicIdForQuestion(q);
                          if (student && matchedTopicId) {
                            recordLearningEvent(
                              student.id,
                              matchedTopicId,
                              isCorrect,
                              'practice',
                              q.bloom_level
                            ).catch((err: unknown) => {
                              console.warn('[quiz] recordLearningEvent failed:', err instanceof Error ? err.message : String(err));
                            });
                          }

                          track('learn_quick_check_submitted', {
                            ...telemetryBase,
                            concept_idx: quizCurrentIdx,
                            is_correct: isCorrect,
                            source: 'chapter_quiz',
                          });
                        }}
                        disabled={quizSelectedOption === null}
                      >
                        {isHi ? 'जवाब जाँचो' : 'Check Answer'}
                      </Button>
                    )}

                    {isAns && (
                      <div className="space-y-4 mt-2">
                        <div
                          className="rounded-xl p-3"
                          style={{
                            background: isCorr ? 'rgba(22,163,74,0.05)' : 'rgba(220,38,38,0.04)',
                            border: `1px solid ${isCorr ? 'rgba(22,163,74,0.15)' : 'rgba(220,38,38,0.12)'}`,
                          }}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <span>{isCorr ? '🎉' : '💡'}</span>
                            <span className="text-xs font-bold" style={{ color: isCorr ? '#16A34A' : '#DC2626' }}>
                              {isCorr
                                ? (isHi ? 'शाबाश! सही जवाब!' : 'Correct!')
                                : (isHi ? 'गलत — पर सीखो!' : 'Incorrect. Let\'s understand:')}
                            </span>
                          </div>
                          <p className="text-xs leading-relaxed text-[var(--text-2)] whitespace-pre-wrap">
                            {isHi && q.explanation_hi ? q.explanation_hi : q.explanation || (isHi ? 'अवधारणा की व्याख्या उपलब्ध नहीं है।' : 'No explanation available.')}
                          </p>
                        </div>

                        {quizCurrentIdx < questions.length - 1 ? (
                          <Button
                            fullWidth
                            color={subMeta?.color}
                            onClick={() => {
                              setQuizSelectedOption(null);
                              setQuizCurrentIdx(prev => prev + 1);
                            }}
                          >
                            {isHi ? 'अगला प्रश्न →' : 'Next Question →'}
                          </Button>
                        ) : (
                          <Button
                            fullWidth
                            color={subMeta?.color}
                            onClick={handleFinishQuiz}
                          >
                            {isHi ? 'परिणाम रिपोर्ट देखें →' : 'View Performance Report →'}
                          </Button>
                        )}
                      </div>
                    )}
                  </Card>
                );
              })()}
            </div>
          )}

          {phase === 'report' && (() => {
            const totalQ = questions.length;
            const correctQ = Object.values(quizAnswers).filter(a => a.isCorrect).length;
            const pct = calculateScorePercent(correctQ, totalQ);
            const scoreGood = pct >= 60;

            const topicStats: Record<string, { total: number; correct: number; title: string; title_hi?: string | null; id: string }> = {};
            questions.forEach((q) => {
              const topicId = getTopicIdForQuestion(q) || 'unknown';
              const topic = topics.find(t => t.id === topicId);
              const ans = quizAnswers[q.id];
              if (!ans) return;

              if (!topicStats[topicId]) {
                topicStats[topicId] = {
                  id: topicId,
                  total: 0,
                  correct: 0,
                  title: topic ? topic.title : (isHi ? 'अतिरिक्त अभ्यास' : 'Additional Concepts'),
                  title_hi: topic ? topic.title_hi : null,
                };
              }
              topicStats[topicId].total += 1;
              if (ans.isCorrect) {
                topicStats[topicId].correct += 1;
              }
            });

            const strengths = Object.values(topicStats).filter(s => s.correct === s.total);
            const gaps = Object.values(topicStats).filter(s => s.correct < s.total);

            return (
              <div className="space-y-5 animate-fadeIn">
                <Card className="text-center py-6 flex flex-col items-center gap-2">
                  <div className="text-5xl mb-1">{scoreGood ? '🏆' : '📈'}</div>
                  <h2 className="text-xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>
                    {isHi ? 'क्विज़ पूरा हुआ!' : 'Quiz Completed!'}
                  </h2>
                  <p className="text-xs text-[var(--text-3)] mb-2">
                    {isHi ? `अध्याय ${chapterNum} के प्रश्नों का मूल्यांकन` : `Performance evaluation for Chapter ${chapterNum}`}
                  </p>
                  
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-3xl font-extrabold" style={{ color: scoreGood ? '#16A34A' : '#D97706' }}>
                      {correctQ}/{totalQ}
                    </span>
                    <span className="text-sm font-bold text-gray-500">
                      ({pct}%)
                    </span>
                  </div>
                  
                  <ProgressBar value={pct} color={scoreGood ? '#16A34A' : '#D97706'} showPercent />
                  
                  <p className="text-xs font-semibold px-4 mt-2" style={{ color: scoreGood ? '#16A34A' : '#D97706' }}>
                    {scoreGood
                      ? (isHi ? 'शानदार! तुमने इस अध्याय की अधिकांश अवधारणाओं को समझ लिया है।' : 'Great job! You have understood most of the concepts in this chapter.')
                      : (isHi ? 'अच्छा प्रयास! कुछ अवधारणाओं को दोबारा पढ़ने की आवश्यकता है।' : 'Nice try! Some concepts need to be reviewed to complete the syllabus.')}
                  </p>
                </Card>

                <div className="space-y-4">
                  {strengths.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-green-700 flex items-center gap-1.5" style={{ fontFamily: 'var(--font-display)' }}>
                        <span>✓</span>
                        <span>{isHi ? 'तुम्हारी ताकत (महारत हासिल अवधारणाएं)' : 'Your Strengths (Mastered Concepts)'}</span>
                      </h3>
                      <div className="grid gap-2">
                        {strengths.map((s, idx) => (
                          <div key={idx} className="flex items-center justify-between p-3 rounded-xl bg-green-50/40 border border-green-100 text-xs">
                            <span className="font-semibold text-gray-800">
                              {isHi && s.title_hi ? s.title_hi : s.title}
                            </span>
                            <span className="font-bold text-green-700 bg-green-100 px-2 py-0.5 rounded-full text-[10px]">
                              {s.correct}/{s.total} {isHi ? 'सही' : 'Correct'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {gaps.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-red-600 flex items-center gap-1.5" style={{ fontFamily: 'var(--font-display)' }}>
                        <span>⚠️</span>
                        <span>{isHi ? 'सुधार की जरूरत (अवधारणा अंतराल)' : 'Gaps in Understanding'}</span>
                      </h3>
                      <div className="grid gap-3">
                        {gaps.map((s, idx) => {
                          const topicIndex = topics.findIndex(t => t.id === s.id);
                          return (
                            <div key={idx} className="p-3.5 rounded-xl bg-red-50/20 border border-red-100/50 flex flex-col gap-2.5">
                              <div className="flex items-start justify-between gap-3 text-xs">
                                <span className="font-semibold text-gray-800 leading-snug">
                                  {isHi && s.title_hi ? s.title_hi : s.title}
                                </span>
                                <span className="font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full text-[10px] whitespace-nowrap">
                                  {s.correct}/{s.total} {isHi ? 'सही' : 'Correct'}
                                </span>
                              </div>

                              <div className="flex gap-2">
                                {topicIndex !== -1 && (
                                  <button
                                    onClick={() => {
                                      setPhase('explaining');
                                      setCurrentIdx(topicIndex);
                                      setActiveTab('core');
                                    }}
                                    className="flex-1 py-1.5 px-3 rounded-lg text-[10px] font-bold bg-white border border-red-200 text-red-700 hover:bg-red-50 active:scale-[0.98] transition-all flex items-center justify-center gap-1"
                                  >
                                    📖 {isHi ? 'अवधारणा दोबारा पढ़ें' : 'Re-explain Concept'}
                                  </button>
                                )}
                                <button
                                  onClick={() => {
                                    const topicParam = encodeURIComponent(s.title);
                                    track('learn_foxy_doubt_clicked', {
                                      ...telemetryBase,
                                      source: 'gaps_report',
                                      topic_title: s.title,
                                    });
                                    router.push(`/foxy?subject=${subject}&mode=doubt&topic=${topicParam}`);
                                  }}
                                  className="flex-1 py-1.5 px-3 rounded-lg text-[10px] font-bold bg-red-600 text-white hover:bg-red-700 active:scale-[0.98] transition-all flex items-center justify-center gap-1"
                                >
                                  🦊 {isHi ? 'Foxy से डाउट पूछें' : 'Ask Foxy'}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-3 pt-3 border-t border-gray-100">
                  <Button
                    fullWidth
                    color={subMeta?.color}
                    onClick={() => {
                      setPhase('explaining');
                      setCurrentIdx(0);
                      setActiveTab('core');
                      setCompletedTopics(new Set());
                      setQuizAnswers({});
                      setQuizCurrentIdx(0);
                      setQuizSelectedOption(null);
                    }}
                  >
                    🔄 {isHi ? 'अध्याय को दोबारा पढ़ें' : 'Restart Chapter'}
                  </Button>
                  <Button
                    fullWidth
                    variant="ghost"
                    onClick={() => router.push('/dashboard')}
                  >
                    🏠 {isHi ? 'डैशबोर्ड पर वापस जाएं' : 'Return to Dashboard'}
                  </Button>
                </div>
              </div>
            );
          })()}
        </div>
      </main>
      </AppShell>
    </div>
  );
}

export default function ChapterConceptPage() {
  return (
    <Suspense>
      <ChapterConceptPageContent />
    </Suspense>
  );
}

interface CoreContentBlock {
  type: 'heading' | 'list' | 'highlight' | 'paragraph';
  text: string;
  items?: string[];
}

function parseLearningCoreText(text: string): CoreContentBlock[] {
  if (!text) return [];

  // Split by double newlines to isolate paragraphs/blocks
  const rawBlocks = text.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  const parsed: CoreContentBlock[] = [];

  for (const block of rawBlocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    const isBulletList = lines.every(l => /^[-\*\u2022\u25E6]\s+/.test(l));
    const isNumberedList = lines.every(l => /^\d+[\.\)]\s+/.test(l));

    if (lines.length > 1 && (isBulletList || isNumberedList)) {
      const items = lines.map(l => l.replace(/^([-\*\u2022\u25E6]|\d+[\.\)])\s+/, '').trim());
      parsed.push({
        type: 'list',
        text: block,
        items
      });
      continue;
    }

    if (lines.length === 1 && (/^[-\*\u2022\u25E6]\s+/.test(lines[0]) || /^\d+[\.\)]\s+/.test(lines[0]))) {
      parsed.push({
        type: 'list',
        text: block,
        items: [lines[0].replace(/^([-\*\u2022\u25E6]|\d+[\.\)])\s+/, '').trim()]
      });
      continue;
    }

    const cleanBlock = block.replace(/\*\*+/g, '').trim();
    const isHeading = 
      (cleanBlock.length < 60 && !/[\.\?\!\।]$/.test(cleanBlock)) || 
      cleanBlock.endsWith(':') || 
      (block.startsWith('**') && block.endsWith('**') && !block.includes('\n'));

    if (isHeading) {
      parsed.push({
        type: 'heading',
        text: cleanBlock
      });
      continue;
    }

    const isHighlight = /^(definition|note|important|key\s+concept|attention|warning|tippani|paribhasha|mahatvapurna|महत्वपूर्ण|परिभाषा|नोट|विशेष|ध्यान दें)[:\-]/i.test(cleanBlock);
    
    if (isHighlight) {
      parsed.push({
        type: 'highlight',
        text: cleanBlock
      });
      continue;
    }

    parsed.push({
      type: 'paragraph',
      text: block
    });
  }

  return parsed;
}

interface TeacherInsight {
  analogy: string;
  examHack: string;
  mnemonic: string | null;
}

const TEACHER_INSIGHTS: Record<string, Record<string, TeacherInsight>> = {
  en: {
    electricity: {
      analogy: "Imagine water flowing through a pipe. Voltage is the water pressure pushing it, Current is the water flowing per second, and Resistance is a narrow squeeze in the pipe that slows the water down.",
      examHack: "CBSE loves asking for the V-I graph. Always plot V on the y-axis and I on the x-axis. The slope of the line gives you the Resistance (R = V/I). Don't forget to mention that temperature must remain constant!",
      mnemonic: "V = I × R (Viper Is Red)"
    },
    chemical: {
      analogy: "Balancing a chemical equation is like a recipe for cookies. If you start with 2 cups of flour and 1 cup of chocolate chips, your final cookies must contain exactly 2 cups of flour and 1 cup of chips. No atoms can vanish or appear out of thin air!",
      examHack: "CBSE examiners check physical states. Always write symbols like (s) for solid, (l) for liquid, (g) for gas, and (aq) for aqueous next to reactants and products to score full marks.",
      mnemonic: "Law of Conservation of Mass: Mass is neither created nor destroyed."
    },
    acid: {
      analogy: "Think of the pH scale as a thermometer for acidity. Neutral 7 is like comfortable room temperature. As you go down towards 0, it gets freezing cold (super acidic like lemon juice). As you go up to 14, it gets boiling hot (super basic like bleach).",
      examHack: "Remember that pH is logarithmic. A change of 1 pH unit means a 10-fold change in H+ concentration. CBSE often tests this concept in conceptual multiple-choice questions.",
      mnemonic: "BAR: Blue litmus turns Acid Red. Base turns Red to Blue (Base = Blue)!"
    },
    trigonometry: {
      analogy: "Trigonometric ratios are like scaling factor recipes for right-angled triangles. If you know one angle, the ratios tell you the exact proportion between the sides, no matter how tiny or massive the triangle is.",
      examHack: "CBSE height & distance questions always depend on a correct diagram. Draw the diagram first, mark the angles of elevation/depression clearly, and state which triangle you are applying tan/sin to.",
      mnemonic: "SOH CAH TOA (Some Of Her Children Are Having Trouble Over Algebra) or Pandit Badri Prasad Har Har Bole (P/H = Sin, B/H = Cos, P/B = Tan)."
    },
    mitosis: {
      analogy: "Mitosis is like a photocopy machine. You put in one document (cell) and get two identical copies. Meiosis is like dividing a recipe in half to share; it reduces the chromosome count so offspring have the correct number.",
      examHack: "Make sure you can draw and label the stages of mitosis (especially Metaphase where chromosomes align at the equator). CBSE diagrams are evaluated on labelling accuracy.",
      mnemonic: "PMAT: Prophase, Metaphase (Middle), Anaphase (Apart), Telophase (Two)."
    },
    quadratic: {
      analogy: "Finding the roots of a quadratic equation is like finding where a rollercoaster touches the ground level. The discriminant (D = b² − 4ac) is like a detector: if D > 0, it hits twice; if D = 0, it barely grazes once; if D < 0, it stays flying!",
      examHack: "CBSE frequently asks for the nature of roots. Always write the value of D first, show your calculation clearly, and then state whether the roots are 'Real and Distinct', 'Real and Equal', or 'No Real Roots'.",
      mnemonic: "Discriminant detector: positive = 2 real roots, zero = 1 real root, negative = no real roots."
    },
    light: {
      analogy: "Think of light refraction like a lawnmower moving from concrete to grass at an angle. The wheel that hits the grass first slows down first, causing the lawnmower to turn (bend). That's exactly why light bends when it goes from air to glass!",
      examHack: "Sign conventions! object distance (u) is ALWAYS negative. For convex mirror/lens, focal length (f) is positive. For concave mirror/lens, focal length (f) is negative. Draw ray diagrams with arrows (no arrows = 0 marks!).",
      mnemonic: "Concave is a Cave: curves inward. Convex is Vexed: bulges outward."
    },
    photosynthesis: {
      analogy: "Photosynthesis is like a solar-powered kitchen. The leaf is the kitchen, sunlight is the gas stove, CO₂ is the raw ingredient from the air, and water is the other ingredient from the soil. The leaf cooks them into glucose (food) and releases O₂ as the aroma!",
      examHack: "CBSE loves the balanced equation: 6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂ (in presence of sunlight and chlorophyll). Always mention 'in the presence of sunlight and chlorophyll' — students lose marks by omitting the conditions.",
      mnemonic: "CO₂ + Water + Sunlight → Glucose + O₂. Remember: 'CWS makes GO' (Carbon Water Sunlight → Glucose Oxygen)."
    },
    digestive: {
      analogy: "Your digestive system is like a factory assembly line. The mouth is the crushing machine (teeth grind food), the stomach is the acid bath (HCl breaks it down), the small intestine is the quality control department (absorbs nutrients), and the large intestine is the waste management unit.",
      examHack: "CBSE frequently asks about the role of enzymes. Remember: Salivary amylase (mouth, breaks starch), Pepsin (stomach, breaks proteins), Bile (liver, emulsifies fats), Pancreatic juice (breaks all three). Always write the organ + enzyme + substrate for full marks.",
      mnemonic: "My Stomach Likes Lunch: Mouth → Stomach → Liver (bile) → Large intestine. Enzymes: 'Some People Buy Pancakes' (Salivary amylase, Pepsin, Bile, Pancreatic juice)."
    },
    metals: {
      analogy: "Metals and non-metals are like two teams in a tug-of-war. Metals are the team that loves to give away electrons (they're generous donors). Non-metals are the team that loves to grab electrons (they're greedy takers). When they meet, an ionic bond forms — like a handshake agreement!",
      examHack: "CBSE asks the reactivity series almost every year. Remember the order from most reactive to least: K, Na, Ca, Mg, Al, Zn, Fe, Ni, Sn, Pb, H, Cu, Hg, Ag, Au, Pt. Questions on displacement reactions always depend on this series.",
      mnemonic: "King Naughty Called Maggie All Zinc's Friends: Nick Sat Plucking Hair; Cute Hens Argued Goldenly Platinum. (K Na Ca Mg Al Zn Fe Ni Sn Pb H Cu Hg Ag Au Pt)"
    },
    magnetic: {
      analogy: "Magnetic field lines around a current-carrying wire are like the ripples when you dip a stick straight into water. The ripples form concentric circles around the stick. Similarly, magnetic field lines form concentric circles around the wire.",
      examHack: "CBSE loves the right-hand thumb rule and Fleming's left-hand rule. For the right-hand rule: thumb = current direction, curled fingers = magnetic field direction. For Fleming's: Forefinger = Field, Middle finger = Current, Thumb = Force/Motion.",
      mnemonic: "Fleming's Left: FBI rule — Forefinger = B (Field), Middle = I (Current), Thumb = F (Force). Right-hand rule: Thumb Up = Current Up, Fingers Curl = Field direction."
    },
    heredity: {
      analogy: "Genes are like a recipe book passed from parents to children. Each parent contributes one copy of every recipe (gene). Some recipes are 'bold font' (dominant) and always show up, while others are 'light font' (recessive) and only appear when both copies are light.",
      examHack: "CBSE always asks Mendel's monohybrid cross. Draw the Punnett square neatly with all 4 boxes filled. State phenotypic ratio (3:1) and genotypic ratio (1:2:1) separately — many students mix them up and lose marks.",
      mnemonic: "Mendel's 3:1 ratio: 'Three Tall, One Short' — TT, Tt, Tt, tt. Dominant always wins unless both copies are recessive (tt)."
    },
    carbon: {
      analogy: "Carbon is like a social butterfly at a party. It has 4 hands (valence electrons) and can shake hands with up to 4 other atoms at once. This is why carbon forms millions of compounds — it's the most 'friendly' element in chemistry!",
      examHack: "CBSE loves homologous series questions. Remember: each next member differs by -CH₂- and 14 u in molecular mass. Write the general formula (CₙH₂ₙ₊₂ for alkanes) and at least 3 members with names for full marks.",
      mnemonic: "Carbon's tetravalency: 'Carbon Has Four Hands' — it can bond with H, O, N, and even itself. Homologous: 'Meth-Eth-Prop-But' (1C, 2C, 3C, 4C)."
    },
    lifeprocess: {
      analogy: "Life processes are like the daily chores that keep a house running. Nutrition is grocery shopping, respiration is paying the electricity bill (energy), transportation is the plumbing system (blood), and excretion is taking out the garbage.",
      examHack: "CBSE often asks 'why are life processes necessary?' — the answer must mention 'maintenance of living state' and 'repair of damaged molecules'. For respiration, always distinguish between aerobic (with O₂, 38 ATP) and anaerobic (without O₂, 2 ATP).",
      mnemonic: "NTRE: Nutrition, Transportation, Respiration, Excretion — the 4 pillars of life processes."
    },
    control: {
      analogy: "The nervous system is like a WhatsApp group for your body. The brain is the admin, nerves are the internet cables, and electrical impulses are the messages. The endocrine system is like posting a letter — hormones travel through blood and take longer to arrive but the effect lasts longer.",
      examHack: "CBSE loves comparing nervous vs hormonal control. Make a table: Speed (nerve = fast, hormone = slow), Duration (nerve = short, hormone = long), Pathway (nerve = electrical, hormone = chemical via blood). Always mention at least 3 differences.",
      mnemonic: "Nervous = Express Delivery (fast, short). Hormones = Regular Post (slow, long-lasting). Brain → Spinal Cord → Nerves = Central → Peripheral."
    },
    linear: {
      analogy: "A linear equation in two variables is like a seesaw balance. If you change x, y adjusts to keep the equation balanced. The graph is a straight line — every point on that line is a solution that keeps both sides equal.",
      examHack: "CBSE asks for the graphical method of solving pair of linear equations. Always: (1) make a table of at least 3 values for each equation, (2) plot both lines on the same graph, (3) clearly mark the intersection point as the solution. Write 'consistent/inconsistent' as conclusion.",
      mnemonic: "One solution = intersecting lines, No solution = parallel lines (a₁/a₂ = b₁/b₂ ≠ c₁/c₂), Infinite solutions = coincident lines (a₁/a₂ = b₁/b₂ = c₁/c₂)."
    },
    ap: {
      analogy: "An Arithmetic Progression is like climbing stairs where each step has the same height. The first step is 'a' (first term), and each subsequent step adds 'd' (common difference). If d is positive, you climb up; if negative, you climb down.",
      examHack: "CBSE 4-mark AP questions almost always need: aₙ = a + (n−1)d (nth term) and Sₙ = n/2 [2a + (n−1)d] (sum). Write both formulas first, then substitute. For 'find the number of terms', set aₙ = given value and solve for n.",
      mnemonic: "AP formulas: 'An Apple a Day' — Aₙ = A + (n−1)D. Sum: 'Snake eats N/2 apples' — Sₙ = n/2 × [2a + (n−1)d]."
    },
    circle: {
      analogy: "A tangent to a circle is like a cricket ball just grazing the edge of a round boundary. It touches at exactly one point and then flies away. The radius to that touching point is always perpendicular (90°) to the tangent — like the umpire standing straight at that point!",
      examHack: "CBSE construction questions (tangents from external point) carry 3-4 marks. Steps: draw the circle, join center to external point, bisect that line, draw arc to find tangent points. Label everything — marks are given for each construction step shown.",
      mnemonic: "Tangent touches once, at 90° to radius. From external point: always 2 tangents, equal in length."
    },
    surfacearea: {
      analogy: "Surface area is like the wrapping paper needed to cover a gift box — it's the total outside area. Volume is like how much sand you can pour inside the box. A cylinder is like a tin can: two circular lids (tops) + one curved sheet wrapped around.",
      examHack: "CBSE loves combination problems (cone on cylinder, hemisphere on cylinder). Always calculate each shape's contribution separately, then add. For CSA: don't include the joining circle. For TSA: include all exposed surfaces only.",
      mnemonic: "Cylinder: CSA = 2πrh (the label), TSA = 2πr(r+h) (label + 2 lids). Cone: CSA = πrl (the cone wrapper). Sphere: TSA = 4πr²."
    },
    statistics: {
      analogy: "Mean, Median, and Mode are like three friends describing a cricket team's scores. Mean says 'let's share equally' (total/count). Median says 'let's find the middle person when lined up'. Mode says 'let's find the most popular score'.",
      examHack: "CBSE asks for mean using Direct, Assumed Mean, or Step Deviation method. Step Deviation is fastest for large numbers. Always state which method you're using. For median of grouped data, use: L + [(N/2 - cf)/f] × h. Write the formula first!",
      mnemonic: "Mean = Sum/N, Median = Middle value, Mode = Most frequent. For grouped data: 'Learn the Median formula by heart' — L + [(N/2 − cf)/f] × h."
    },
    polynomial: {
      analogy: "A polynomial is like a machine with gears. The degree tells you how many curves the machine can make. Degree 1 (linear) = straight road, Degree 2 (quadratic) = one hill/valley, Degree 3 (cubic) = a snake-like road with two turns.",
      examHack: "CBSE always asks the relationship between zeroes and coefficients. For ax² + bx + c: sum of zeroes = −b/a, product of zeroes = c/a. Always verify your zeroes satisfy both relationships for full marks.",
      mnemonic: "Sum = −b/a (Subtract B over A), Product = c/a (Carry C over A). Zeroes of p(x) are where the graph crosses the x-axis."
    },
    realnumber: {
      analogy: "Real numbers are like a number line highway. Rational numbers are the well-marked exits (fractions, terminating/repeating decimals). Irrational numbers are the stretches between exits that go on forever without repeating (like √2 or π). Together they cover every point on the highway.",
      examHack: "CBSE loves HCF × LCM = Product of two numbers. For Euclid's division: always write a = bq + r clearly. For prime factorization: draw the factor tree. Always state 'by the Fundamental Theorem of Arithmetic' when using prime factorization.",
      mnemonic: "HCF = smallest powers of common primes. LCM = highest powers of all primes. HCF × LCM = a × b."
    },
    democracy: {
      analogy: "Democracy is like a class where every student gets one vote to decide the picnic destination. Even if the topper wants mountains but the majority wants beach, beach wins. That's the power of majority rule — every vote counts equally!",
      examHack: "CBSE asks 'why democracy?' and 'what are the challenges?' — structure your answer as: (1) merits/demerits table, (2) at least 3 points for each, (3) examples from India. Mention 'accountability', 'dignity', and 'conflict resolution' for the merits section.",
      mnemonic: "Democracy's 5 features: PEARL — People's participation, Equality, Accountability, Rule of law, Liberty."
    },
    federalism: {
      analogy: "Federalism is like a family business. The grandfather (Central government) makes big decisions. Each son (State government) runs their own branch with their own rules for local matters. Some decisions need both to agree (Concurrent List), like choosing the family logo.",
      examHack: "CBSE loves the 3 lists: Union (Defence, Foreign affairs), State (Police, Agriculture), Concurrent (Education, Marriage). Always mention the 73rd/74th Amendment for local self-governance (Panchayats/Municipalities). Draw a simple diagram of the 3-tier structure.",
      mnemonic: "3 Lists: 'U Suck Candy' — Union, State, Concurrent. Residuary powers go to Central government."
    },
    development: {
      analogy: "Development is not just about getting richer — it's like upgrading from a bicycle to a car to a plane. But if the car pollutes the air and the plane makes you deaf, are you really better off? That's why we need to look at income + health + education together (HDI).",
      examHack: "CBSE compares countries using HDI (Human Development Index), not just per capita income. Always mention the 3 indicators: (1) Per capita income, (2) Literacy rate, (3) Infant mortality rate. Give examples: Sri Lanka has better HDI than India despite lower income.",
      mnemonic: "HDI = Income + Literacy + Life expectancy. 'I Love Life' — the three pillars of development."
    },
    globalisation: {
      analogy: "Globalisation is like a giant shopping mall where shops from every country set up stalls. MNCs are the big chain stores that open branches everywhere. WTO is the mall's security guard making sure every shop follows the same trade rules.",
      examHack: "CBSE asks about impact of globalisation on India. Always present both sides: positive (more jobs, better technology, consumer choice) and negative (small industries suffer, job insecurity, cultural impact). Mention 'SEZs' and 'liberalisation' for bonus marks.",
      mnemonic: "Globalisation = Trade + Technology + MNCs. LPG reforms: Liberalisation, Privatisation, Globalisation (1991)."
    },
    resources: {
      analogy: "Resources are like tools in a toolbox. Some are renewable (like a rechargeable battery — forests, water). Others are non-renewable (like a match — once burned, gone forever — coal, petroleum). Sustainable development means using the toolbox wisely so future generations also have tools.",
      examHack: "CBSE loves resource classification. Remember the 4 ways: (1) Origin: biotic/abiotic, (2) Exhaustibility: renewable/non-renewable, (3) Ownership: individual/community/national/international, (4) Status: potential/developed/stock/reserve. Make a classification chart for 5-mark questions.",
      mnemonic: "Resource classification: 'OEOS' — Origin, Exhaustibility, Ownership, Status. Sustainable = 'Use wisely, save for kids'."
    }
  },
  hi: {
    electricity: {
      analogy: "इसे पानी की नली की तरह समझें। वोल्टेज पानी का दबाव है, करंट बहता हुआ पानी है, और प्रतिरोध नली का तंग हिस्सा है जो पानी के बहाव को धीमा कर देता है।",
      examHack: "CBSE अक्सर V-I ग्राफ पूछता है। हमेशा y-अक्ष पर V और x-अक्ष पर I को प्लॉट करें। रेखा का ढलान आपको प्रतिरोध (R = V/I) देगा। यह उल्लेख करना न भूलें कि तापमान स्थिर रहना चाहिए!",
      mnemonic: "V = I × R (वीआईपी लोग हमेशा राज करते हैं - VIP Raj)"
    },
    chemical: {
      analogy: "रासायनिक समीकरण को संतुलित करना बिस्कुट बनाने की रेसिपी की तरह है। यदि आप 2 कप आटा और 1 कप चॉकलेट के साथ शुरू करते हैं, तो तैयार बिस्कुट में भी बिल्कुल उतना ही आटा और चॉकलेट होना चाहिए। कोई भी परमाणु अचानक गायब या उत्पन्न नहीं हो सकता!",
      examHack: "CBSE परीक्षक भौतिक अवस्थाओं (s, l, g, aq) की जांच करते हैं। पूर्ण अंक प्राप्त करने के लिए अभिकारकों और उत्पादों के बगल में ठोस (s), तरल (l), गैस (g), और जलीय (aq) लिखना न भूलें।",
      mnemonic: "द्रव्यमान संरक्षण का नियम: द्रव्यमान न तो बनाया जा सकता है और न ही नष्ट किया जा सकता है।"
    },
    acid: {
      analogy: "pH स्केल को अम्लता मापने वाले थर्मामीटर की तरह समझें। उदासीन 7 आरामदायक कमरे के तापमान जैसा है। जैसे-जैसे आप 0 की ओर नीचे जाते हैं, यह बहुत अम्लीय (नींबू के रस की तरह) होता जाता है। जैसे-जैसे आप 14 की ओर ऊपर जाते हैं, यह क्षारीय (साबुन की तरह) होता जाता है।",
      examHack: "याद रखें कि pH मान में 1 इकाई के बदलाव का मतलब H+ आयनों की सांद्रता में 10 गुना बदलाव है। CBSE अक्सर इस पर बहुविकल्पीय प्रश्न पूछता है।",
      mnemonic: "अनीला: अम्ल नीले लिटमस को लाल करता है। छालनी: क्षारक लाल को नीला करता है।"
    },
    trigonometry: {
      analogy: "त्रिकोणमितीय अनुपात समकोण त्रिभुज के पक्षों के बीच के अनुपात को दर्शाते हैं। यदि आपको एक कोण पता है, तो अनुपात आपको भुजाओं के बीच का सटीक संबंध बताते हैं, चाहे त्रिभुज कितना भी छोटा या बड़ा क्यों न हो।",
      examHack: "ऊंचाई और दूरी (Heights and Distances) वाले प्रश्नों में हमेशा एक सही आरेख आवश्यक होता है। पहले आरेख बनाएं, उन्नयन/अवनमन कोणों को स्पष्ट रूप से दर्शाएं, और बताएं कि आप किस त्रिभुज में tan/sin लगा रहे हैं।",
      mnemonic: "लाल/कक्का (LAL/KKA): L/K = साइन (Sin), A/K = कॉस (Cos), L/A = टेन (Tan)."
    },
    mitosis: {
      analogy: "माइटोसिस एक फोटोकॉपी मशीन की तरह है। आप एक कोशिका डालते हैं और दो बिल्कुल वैसी ही कोशिकाएँ प्राप्त करते हैं। मियोसिस गुणसूत्रों की संख्या को आधा कर देता है ताकि संतान में गुणसूत्रों की संख्या सामान्य रहे।",
      examHack: "सुनिश्चित करें कि आप समसूत्री विभाजन के चरणों (विशेष रूप से मेटाफ़ेज़) का आरेख बना सकते हैं। CBSE में आरेखों के नामांकन (labelling) पर अंक मिलते हैं।",
      mnemonic: "PMAT: Prophase, Metaphase (मध्य), Anaphase (अलग), Telophase (दो)."
    },
    quadratic: {
      analogy: "द्विघात समीकरण के मूल खोजना यह पता लगाने जैसा है कि हवा में फेंकी गई गेंद जमीन को कहाँ छूती है। विविक्तकर (D = b² − 4ac) एक डिटेक्टर की तरह है: यदि D > 0, गेंद जमीन को दो बार छूती है; यदि D = 0, यह जमीन को केवल एक बार छूती है; यदि D < 0, यह हवा में ही रहती है।",
      examHack: "CBSE अक्सर मूलों की प्रकृति पूछता है। हमेशा पहले D का मान लिखें, गणना स्पष्ट रूप से दिखाएं, और फिर लिखें कि मूल 'वास्तविक और भिन्न', 'वास्तविक और समान', या 'वास्तविक नहीं' हैं।",
      mnemonic: "D का नियम: धनात्मक = 2 मूल, शून्य = 1 मूल, ऋणात्मक = कोई वास्तविक मूल नहीं।"
    },
    light: {
      analogy: "प्रकाश के अपवर्तन को कंक्रीट से घास पर तिरछे जाने वाले पहिये की तरह समझें। जो पहिया पहले घास को छुएगा वह पहले धीमा हो जाएगा, जिससे पहिया मुड़ जाएगा। यही कारण है कि प्रकाश हवा से कांच में जाने पर मुड़ जाता है!",
      examHack: "चिह्न परिपाटी (Sign Conventions) में छात्र सबसे ज्यादा गलती करते हैं। याद रखें: वस्तु की दूरी (u) हमेशा ऋणात्मक होती है। उत्तल दर्पण/लेंस के लिए फोकस दूरी (f) धनात्मक होती है। अवतल के लिए ऋणात्मक होती है। किरणों पर तीरों के निशान जरूर लगाएं!",
      mnemonic: "अवतल (Concave): अंदर की ओर झुका हुआ (गुफा की तरह)। उत्तल (Convex): ऊपर की ओर उठा हुआ तल।"
    },
    photosynthesis: {
      analogy: "प्रकाश संश्लेषण एक सौर ऊर्जा से चलने वाली रसोई की तरह है। पत्ती रसोई है, सूर्य का प्रकाश गैस चूल्हा है, CO₂ हवा से आया कच्चा माल है, और पानी मिट्टी से आया दूसरा सामान। पत्ती इन्हें ग्लूकोज (भोजन) में पकाती है और O₂ को सुगंध की तरह छोड़ती है!",
      examHack: "CBSE संतुलित समीकरण पूछता है: 6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂ (सूर्य प्रकाश और क्लोरोफिल की उपस्थिति में)। हमेशा 'सूर्य प्रकाश और क्लोरोफिल की उपस्थिति में' लिखें — इसे छोड़ने पर अंक कटते हैं।",
      mnemonic: "CO₂ + पानी + सूर्य → ग्लूकोज + O₂। याद रखें: 'CPS बनाए GO' (कार्बन पानी सूर्य → ग्लूकोज ऑक्सीजन)।"
    },
    digestive: {
      analogy: "पाचन तंत्र एक फैक्ट्री असेंबली लाइन की तरह है। मुँह कुचलने वाली मशीन है (दाँत भोजन पीसते हैं), पेट एसिड बाथ है (HCl तोड़ता है), छोटी आंत गुणवत्ता नियंत्रण विभाग है (पोषक तत्व अवशोषित करती है), और बड़ी आंत कचरा प्रबंधन इकाई है।",
      examHack: "CBSE अक्सर एंजाइमों की भूमिका पूछता है। याद रखें: लार एमाइलेज (मुँह, स्टार्च तोड़ता है), पेप्सिन (पेट, प्रोटीन तोड़ता है), पित्त (यकृत, वसा का पायसीकरण), अग्न्याशय रस (तीनों तोड़ता है)। पूर्ण अंक के लिए अंग + एंजाइम + सब्सट्रेट लिखें।",
      mnemonic: "पाचन क्रम: 'मुँह पेट छोटी बड़ी' — मुँह → आमाशय → छोटी आंत → बड़ी आंत। एंजाइम: 'सप पैन' (सैलिवरी एमाइलेज, पेप्सिन, अग्न्याशय रस)।"
    },
    metals: {
      analogy: "धातु और अधातु दो टीमों की रस्साकशी की तरह हैं। धातुएँ वह टीम हैं जो इलेक्ट्रॉन देना पसंद करती हैं (वे उदार दाता हैं)। अधातुएँ वह टीम हैं जो इलेक्ट्रॉन लेना पसंद करती हैं (वे लालची लेने वाली हैं)। जब वे मिलते हैं, तो आयनिक बंध बनता है!",
      examHack: "CBSE हर साल सक्रियता श्रेणी पूछता है। क्रम याद रखें: K, Na, Ca, Mg, Al, Zn, Fe, Ni, Sn, Pb, H, Cu, Hg, Ag, Au, Pt। विस्थापन अभिक्रियाओं के प्रश्न हमेशा इस श्रेणी पर निर्भर करते हैं।",
      mnemonic: "के ना कर मगर अलू जिंदा फिर नींबू सनकी प्लम हवाई कप हगा औरंगजेब प्लेटिनम (K Na Ca Mg Al Zn Fe Ni Sn Pb H Cu Hg Ag Au Pt)"
    },
    magnetic: {
      analogy: "धारावाहक तार के चारों ओर चुंबकीय क्षेत्र रेखाएँ वैसी ही हैं जैसे पानी में सीधी छड़ी डालने पर बनने वाली लहरें। लहरें छड़ी के चारों ओर संकेंद्रित वृत्त बनाती हैं। इसी तरह, चुंबकीय क्षेत्र रेखाएँ तार के चारों ओर संकेंद्रित वृत्त बनाती हैं।",
      examHack: "CBSE दायें हाथ का अंगूठा नियम और फ्लेमिंग का बायें हाथ का नियम पूछता है। दायें हाथ: अंगूठा = धारा दिशा, मुड़ी उंगलियाँ = चुंबकीय क्षेत्र। फ्लेमिंग: तर्जनी = क्षेत्र, मध्यमा = धारा, अंगूठा = बल।",
      mnemonic: "फ्लेमिंग बायाँ: FBI — Forefinger = B (क्षेत्र), Middle = I (धारा), Thumb = F (बल)।"
    },
    heredity: {
      analogy: "जीन एक रेसिपी बुक की तरह हैं जो माता-पिता से बच्चों को मिलती हैं। हर माता-पिता हर रेसिपी (जीन) की एक कॉपी देते हैं। कुछ रेसिपी 'बोल्ड फॉन्ट' (प्रभावी) में होती हैं और हमेशा दिखती हैं, जबकि अन्य 'हल्के फॉन्ट' (अप्रभावी) में होती हैं।",
      examHack: "CBSE हमेशा मेंडल का एकसंकर क्रॉस पूछता है। पनेट वर्ग (Punnett square) साफ-सुथरा बनाएं। लक्षणप्ररूपी अनुपात (3:1) और जीनप्ररूपी अनुपात (1:2:1) अलग-अलग लिखें।",
      mnemonic: "मेंडल का 3:1 अनुपात: TT, Tt, Tt, tt। प्रभावी हमेशा जीतता है जब तक दोनों कॉपी अप्रभावी (tt) न हों।"
    },
    carbon: {
      analogy: "कार्बन एक पार्टी में सोशल बटरफ्लाई की तरह है। इसके 4 हाथ (संयोजकता इलेक्ट्रॉन) हैं और यह एक साथ 4 अन्य परमाणुओं के साथ हाथ मिला सकता है। इसीलिए कार्बन लाखों यौगिक बनाता है — यह रसायन विज्ञान का सबसे 'मिलनसार' तत्व है!",
      examHack: "CBSE समजातीय श्रेणी पर प्रश्न पूछता है। याद रखें: प्रत्येक अगला सदस्य -CH₂- और 14u आणविक द्रव्यमान से भिन्न होता है। सामान्य सूत्र (एल्केन: CₙH₂ₙ₊₂) और कम से कम 3 सदस्यों के नाम लिखें।",
      mnemonic: "कार्बन की चतुर्संयोजकता: 'कार्बन के चार हाथ'। समजातीय: 'मीथ-ईथ-प्रोप-ब्यूट' (1C, 2C, 3C, 4C)।"
    },
    lifeprocess: {
      analogy: "जैव प्रक्रियाएँ घर चलाने के दैनिक कामों की तरह हैं। पोषण किराने की खरीदारी है, श्वसन बिजली बिल भुगतान है (ऊर्जा), परिवहन प्लंबिंग सिस्टम है (रक्त), और उत्सर्जन कचरा बाहर फेंकना है।",
      examHack: "CBSE पूछता है 'जैव प्रक्रियाएँ क्यों आवश्यक हैं?' — उत्तर में 'जीवित अवस्था का रखरखाव' और 'क्षतिग्रस्त अणुओं की मरम्मत' जरूर लिखें। श्वसन के लिए: वायवीय (O₂ के साथ, 38 ATP) और अवायवीय (O₂ के बिना, 2 ATP) में अंतर करें।",
      mnemonic: "NTRE: पोषण (Nutrition), परिवहन (Transportation), श्वसन (Respiration), उत्सर्जन (Excretion) — जैव प्रक्रियाओं के 4 स्तंभ।"
    },
    control: {
      analogy: "तंत्रिका तंत्र आपके शरीर के WhatsApp ग्रुप की तरह है। मस्तिष्क एडमिन है, तंत्रिकाएँ इंटरनेट केबल हैं, और विद्युत आवेग संदेश हैं। अंतःस्रावी तंत्र पत्र भेजने जैसा है — हार्मोन रक्त से यात्रा करते हैं और पहुँचने में समय लगता है लेकिन प्रभाव लंबा रहता है।",
      examHack: "CBSE तंत्रिका बनाम हार्मोनल नियंत्रण की तुलना पूछता है। तालिका बनाएं: गति (तंत्रिका = तेज़, हार्मोन = धीमी), अवधि (तंत्रिका = कम, हार्मोन = लंबी), मार्ग (तंत्रिका = विद्युत, हार्मोन = रासायनिक)। कम से कम 3 अंतर लिखें।",
      mnemonic: "तंत्रिका = एक्सप्रेस डिलीवरी (तेज़, छोटी)। हार्मोन = सामान्य डाक (धीमी, लंबे समय तक)। मस्तिष्क → मेरुरज्जु → तंत्रिकाएँ।"
    },
    linear: {
      analogy: "दो चरों में रैखिक समीकरण एक झूले के संतुलन की तरह है। यदि आप x बदलते हैं, तो y समीकरण को संतुलित रखने के लिए समायोजित होता है। ग्राफ एक सीधी रेखा है — उस रेखा पर हर बिंदु एक हल है।",
      examHack: "CBSE ग्राफीय विधि से रैखिक समीकरण युग्म हल करने को पूछता है। हमेशा: (1) प्रत्येक समीकरण के लिए कम से कम 3 मानों की तालिका बनाएं, (2) एक ही ग्राफ पर दोनों रेखाएं प्लॉट करें, (3) प्रतिच्छेदन बिंदु को हल के रूप में स्पष्ट चिह्नित करें।",
      mnemonic: "एक हल = प्रतिच्छेदी रेखाएं, कोई हल नहीं = समांतर रेखाएं, अनंत हल = संपाती रेखाएं।"
    },
    ap: {
      analogy: "समांतर श्रेणी (AP) सीढ़ियाँ चढ़ने जैसी है जहाँ हर सीढ़ी की ऊँचाई समान है। पहली सीढ़ी 'a' (पहला पद) है, और हर अगली सीढ़ी 'd' (सार्व अंतर) जोड़ती है। d धनात्मक हो तो ऊपर चढ़ो, ऋणात्मक हो तो नीचे उतरो।",
      examHack: "CBSE 4 अंक के AP प्रश्नों में: aₙ = a + (n−1)d (nवाँ पद) और Sₙ = n/2 [2a + (n−1)d] (योग)। पहले दोनों सूत्र लिखें, फिर मान रखें।",
      mnemonic: "AP सूत्र: Aₙ = A + (n−1)D। योग: Sₙ = n/2 × [2a + (n−1)d]।"
    },
    circle: {
      analogy: "वृत्त की स्पर्श रेखा क्रिकेट की गेंद की तरह है जो गोल बाउंड्री के किनारे को छूकर निकल जाती है। यह ठीक एक बिंदु पर छूती है। उस बिंदु तक त्रिज्या हमेशा स्पर्श रेखा पर लंबवत (90°) होती है।",
      examHack: "CBSE रचना प्रश्न (बाहरी बिंदु से स्पर्श रेखाएँ) 3-4 अंक के होते हैं। चरण: वृत्त बनाएं, केंद्र से बाहरी बिंदु जोड़ें, उस रेखा को समद्विभाजित करें। हर रचना चरण को दिखाने पर अंक मिलते हैं।",
      mnemonic: "स्पर्श रेखा एक बार छूती है, त्रिज्या से 90° पर। बाहरी बिंदु से: हमेशा 2 स्पर्श रेखाएँ, समान लंबाई।"
    },
    surfacearea: {
      analogy: "पृष्ठीय क्षेत्रफल उपहार बॉक्स पर लगाने वाले रैपिंग पेपर की तरह है — यह कुल बाहरी क्षेत्र है। आयतन बॉक्स में कितनी रेत भर सकते हैं। बेलन एक टिन के डिब्बे जैसा है: दो गोल ढक्कन + एक लपेटा हुआ कर्व शीट।",
      examHack: "CBSE संयोजित आकृतियों (शंकु + बेलन, अर्धगोला + बेलन) पर प्रश्न पूछता है। हर आकृति का योगदान अलग से गिनें, फिर जोड़ें। CSA में: जुड़ने वाला वृत्त शामिल न करें। TSA में: केवल खुली सतहें शामिल करें।",
      mnemonic: "बेलन: CSA = 2πrh, TSA = 2πr(r+h)। शंकु: CSA = πrl। गोला: TSA = 4πr²।"
    },
    statistics: {
      analogy: "माध्य, माध्यिका, और बहुलक क्रिकेट टीम के स्कोर बताने वाले तीन दोस्तों की तरह हैं। माध्य कहता है 'बराबर बाँटो' (कुल/संख्या)। माध्यिका कहता है 'बीच वाला खोजो'। बहुलक कहता है 'सबसे ज्यादा बार आने वाला खोजो'।",
      examHack: "CBSE माध्य की गणना प्रत्यक्ष, कल्पित माध्य, या पद विचलन विधि से पूछता है। बड़ी संख्याओं के लिए पद विचलन विधि सबसे तेज़ है। सवर्गीकृत आंकड़ों के माध्यिका सूत्र: L + [(N/2 - cf)/f] × h।",
      mnemonic: "माध्य = योग/N, माध्यिका = बीच का मान, बहुलक = सबसे अधिक बार। सूत्र: L + [(N/2 − cf)/f] × h।"
    },
    polynomial: {
      analogy: "बहुपद एक गियर वाली मशीन की तरह है। घात बताता है कि मशीन कितने मोड़ ले सकती है। घात 1 (रैखिक) = सीधी सड़क, घात 2 (द्विघात) = एक पहाड़ी, घात 3 (त्रिघात) = साँप जैसी सड़क।",
      examHack: "CBSE हमेशा शून्यकों और गुणांकों के बीच संबंध पूछता है। ax² + bx + c के लिए: शून्यकों का योग = −b/a, शून्यकों का गुणनफल = c/a। दोनों संबंधों से सत्यापित करें।",
      mnemonic: "योग = −b/a, गुणनफल = c/a। p(x) के शून्यक वे बिंदु हैं जहाँ ग्राफ x-अक्ष को काटता है।"
    },
    realnumber: {
      analogy: "वास्तविक संख्याएँ संख्या रेखा के राजमार्ग की तरह हैं। परिमेय संख्याएँ चिह्नित निकास बिंदु हैं (भिन्न, सांत/आवर्ती दशमलव)। अपरिमेय संख्याएँ बीच के वे भाग हैं जो बिना दोहराव के अनंत तक जाते हैं (जैसे √2 या π)।",
      examHack: "CBSE पसंद करता है: HCF × LCM = दो संख्याओं का गुणनफल। यूक्लिड विभाजन के लिए: a = bq + r स्पष्ट लिखें। अभाज्य गुणनखंड के लिए: गुणनखंड वृक्ष बनाएं। 'अंकगणित की मूलभूत प्रमेय' जरूर लिखें।",
      mnemonic: "HCF = उभयनिष्ठ अभाज्य गुणनखंडों की न्यूनतम घात। LCM = सभी अभाज्य गुणनखंडों की अधिकतम घात। HCF × LCM = a × b।"
    },
    democracy: {
      analogy: "लोकतंत्र एक ऐसी कक्षा है जहाँ हर छात्र को पिकनिक स्थान चुनने का एक वोट मिलता है। भले ही टॉपर पहाड़ चाहे लेकिन बहुमत बीच चाहे, तो बीच जीतता है। यही बहुमत का नियम है!",
      examHack: "CBSE पूछता है 'लोकतंत्र क्यों?' और 'चुनौतियाँ क्या हैं?' — उत्तर की संरचना: (1) गुण/दोष तालिका, (2) प्रत्येक के कम से कम 3 बिंदु, (3) भारत से उदाहरण। गुणों में 'जवाबदेही', 'गरिमा', और 'संघर्ष समाधान' जरूर लिखें।",
      mnemonic: "लोकतंत्र की 5 विशेषताएँ: जनभागीदारी, समानता, जवाबदेही, कानून का शासन, स्वतंत्रता।"
    },
    federalism: {
      analogy: "संघवाद पारिवारिक व्यवसाय की तरह है। दादाजी (केंद्र सरकार) बड़े फैसले लेते हैं। हर बेटा (राज्य सरकार) अपनी शाखा अपने नियमों से चलाता है। कुछ फैसलों में दोनों की सहमति चाहिए (समवर्ती सूची)।",
      examHack: "CBSE 3 सूचियाँ पूछता है: संघ (रक्षा, विदेश), राज्य (पुलिस, कृषि), समवर्ती (शिक्षा, विवाह)। स्थानीय स्वशासन के लिए 73वें/74वें संशोधन (पंचायत/नगरपालिका) जरूर लिखें।",
      mnemonic: "3 सूचियाँ: संघ, राज्य, समवर्ती। अवशिष्ट शक्तियाँ केंद्र सरकार को मिलती हैं।"
    },
    development: {
      analogy: "विकास सिर्फ अमीर होना नहीं है — यह साइकिल से कार और फिर हवाई जहाज में अपग्रेड करने जैसा है। लेकिन अगर कार प्रदूषण फैलाए तो क्या आप वाकई बेहतर हैं? इसीलिए आय + स्वास्थ्य + शिक्षा (HDI) तीनों देखने होंगे।",
      examHack: "CBSE देशों की तुलना HDI (मानव विकास सूचकांक) से करता है, सिर्फ प्रति व्यक्ति आय से नहीं। 3 संकेतक: (1) प्रति व्यक्ति आय, (2) साक्षरता दर, (3) शिशु मृत्यु दर। उदाहरण: श्रीलंका का HDI भारत से बेहतर है।",
      mnemonic: "HDI = आय + साक्षरता + जीवन प्रत्याशा। 'आसान जीवन' — विकास के तीन स्तंभ।"
    },
    globalisation: {
      analogy: "वैश्वीकरण एक विशाल शॉपिंग मॉल की तरह है जहाँ हर देश की दुकानें हैं। MNC बड़ी चेन स्टोर हैं। WTO मॉल का सिक्योरिटी गार्ड है जो सुनिश्चित करता है कि हर दुकान समान नियम मानें।",
      examHack: "CBSE भारत पर वैश्वीकरण के प्रभाव पूछता है। दोनों पक्ष प्रस्तुत करें: सकारात्मक (अधिक नौकरियाँ, बेहतर तकनीक) और नकारात्मक (छोटे उद्योग प्रभावित, नौकरी असुरक्षा)। 'SEZ' और 'उदारीकरण' लिखें।",
      mnemonic: "वैश्वीकरण = व्यापार + तकनीक + MNC। LPG सुधार: उदारीकरण, निजीकरण, वैश्वीकरण (1991)।"
    },
    resources: {
      analogy: "संसाधन टूलबॉक्स में औजारों की तरह हैं। कुछ नवीकरणीय हैं (रिचार्जेबल बैटरी की तरह — वन, जल)। कुछ अनवीकरणीय हैं (माचिस की तरह — एक बार जले तो हमेशा के लिए खत्म — कोयला, पेट्रोलियम)।",
      examHack: "CBSE संसाधन वर्गीकरण पूछता है। 4 तरीके: (1) उत्पत्ति: जैव/अजैव, (2) समाप्यता: नवीकरणीय/अनवीकरणीय, (3) स्वामित्व: व्यक्तिगत/सामुदायिक/राष्ट्रीय/अंतर्राष्ट्रीय, (4) स्थिति: संभावी/विकसित/भंडार/आरक्षित।",
      mnemonic: "संसाधन वर्गीकरण: उत्पत्ति, समाप्यता, स्वामित्व, स्थिति। सतत विकास = 'समझदारी से उपयोग करो, बच्चों के लिए बचाओ'।"
    }
  }
};

function getTeacherInsights(topicTitle: string, isHi: boolean): TeacherInsight {
  const lang = isHi ? 'hi' : 'en';
  const title = (topicTitle || '').toLowerCase();
  const titleHi = (topicTitle || '');
  
  // Map of keyword patterns to insight keys — expanded for 20+ topics
  const KEYWORD_MAP: Array<{ key: string; patterns: RegExp }> = [
    { key: 'electricity', patterns: /ohm|electr|poten|resist|circuit|विद्युत|प्रतिरोध|ओम/ },
    { key: 'chemical', patterns: /chem.*react|equat|balanc|रासायनिक|अभिक्रिया|समीकरण|संतुलित/ },
    { key: 'acid', patterns: /acid|base|ph\b|salt|अम्ल|क्षार|लवण|pH/ },
    { key: 'trigonometry', patterns: /trig|sin\b|cos\b|tan\b|ratio|height.*distance|त्रिकोणमित|ऊंचाई.*दूरी/ },
    { key: 'mitosis', patterns: /mitos|meios|cell.?divis|कोशिका.?विभाजन|समसूत्री|अर्धसूत्री/ },
    { key: 'quadratic', patterns: /quadrat|discrimin|roots.*equat|द्विघात|मूल|विविक्तकर/ },
    { key: 'light', patterns: /\blight\b|reflect|refract|mirror|lens|प्रकाश|अपवर्तन|परावर्तन|दर्पण|लेंस/ },
    { key: 'photosynthesis', patterns: /photosynth|chlorophyll|प्रकाश.*संश्लेषण|क्लोरोफिल|पत्ती/ },
    { key: 'digestive', patterns: /digest|stomach|intestin|enzyme|पाचन|आमाशय|आंत|एंजाइम/ },
    { key: 'metals', patterns: /metal.*non|non.*metal|reactivity.*series|ionic|धातु|अधातु|सक्रियता|आयनिक/ },
    { key: 'magnetic', patterns: /magnet|solenoid|fleming|electro.*magnet|चुंबक|सोलेनॉइड|फ्लेमिंग|विद्युत.*चुंबक/ },
    { key: 'heredity', patterns: /heredit|mendel|gene|chromosome|आनुवंशिक|मेंडल|जीन|गुणसूत्र/ },
    { key: 'carbon', patterns: /carbon.*compound|organic|hydrocarbon|homolog|कार्बन.*यौगिक|कार्बनिक|हाइड्रोकार्बन|समजातीय/ },
    { key: 'lifeprocess', patterns: /life.*process|nutrition|respiration|excretion|जैव.*प्रक्रिया|पोषण|श्वसन|उत्सर्जन/ },
    { key: 'control', patterns: /control.*coord|nervous|hormone|endocrine|नियंत्रण.*समन्वय|तंत्रिका|हार्मोन|अंतःस्रावी/ },
    { key: 'linear', patterns: /linear.*equat|pair.*equat|रैखिक.*समीकरण|समीकरण.*युग्म/ },
    { key: 'ap', patterns: /arithmetic.*progress|a\.?p\.|common.*differ|समांतर.*श्रेणी|सार्व.*अंतर/ },
    { key: 'circle', patterns: /circle|tangent|chord|secant|वृत्त|स्पर्श.*रेखा|जीवा/ },
    { key: 'surfacearea', patterns: /surface.*area|volume|cylinder|cone|sphere|पृष्ठीय.*क्षेत्रफल|आयतन|बेलन|शंकु|गोला/ },
    { key: 'statistics', patterns: /statistic|mean|median|mode|सांख्यिकी|माध्य|माध्यिका|बहुलक/ },
    { key: 'polynomial', patterns: /polynomial|zero.*polynomial|बहुपद|शून्यक/ },
    { key: 'realnumber', patterns: /real.*number|irrational|euclid|hcf|lcm|वास्तविक.*संख्या|अपरिमेय|यूक्लिड/ },
    { key: 'democracy', patterns: /democra|लोकतंत्र/ },
    { key: 'federalism', patterns: /federal|union.*list|state.*list|संघवाद|संघ.*सूची/ },
    { key: 'development', patterns: /\bdevelop|hdi|human.*develop|विकास|मानव.*विकास/ },
    { key: 'globalisation', patterns: /globali[sz]|mnc|wto|वैश्वीकरण/ },
    { key: 'resources', patterns: /resource.*develop|renewable|non.*renewable|संसाधन|नवीकरणीय|अनवीकरणीय/ },
  ];

  for (const { key, patterns } of KEYWORD_MAP) {
    if (patterns.test(title) || patterns.test(titleHi)) {
      if (TEACHER_INSIGHTS[lang][key]) {
        return TEACHER_INSIGHTS[lang][key];
      }
    }
  }
  
  // Fallback — generic but still helpful
  return {
    analogy: isHi
      ? `इस अवधारणा को दैनिक जीवन के उदाहरण से समझें। जब आप इसे अपने आस-पास की चीज़ों से जोड़ते हैं, तो जटिल विज्ञान/गणित भी बिल्कुल आसान लगने लगता है।`
      : `Think of this concept in terms of simple daily systems. Connecting abstract rules to real-world objects makes the underlying logic feel natural and easy to grasp.`,
    examHack: isHi
      ? `सीबीएसई बोर्ड परीक्षा टिप: परिभाषा लिखते समय मुख्य वैज्ञानिक शब्दों को जरूर शामिल करें और समीकरण/सूत्र को हमेशा बॉक्स में बंद करें। इससे परीक्षक को आपकी स्पष्टता दिखती है।`
      : `CBSE Board Exam Tip: When writing definitions, underline the core scientific terms. Always enclose final formulas/derivations in a box; it shows the examiner you are confident.`,
    mnemonic: isHi
      ? `याद रखने का तरीका: अवधारणा को तीन मुख्य भागों में तोड़ें और अपने शब्दों में एक सरल नियम बनाएं।`
      : `Memory Tip: Break this concept into three simple steps and formulate a short memory sentence in your own words.`
  };
}

interface CbseStep {
  title: string;
  titleHi: string;
  type: 'story' | 'problem' | 'math' | 'fact' | 'summary' | 'definition' | 'list';
  content: string;
  contentHi?: string;
  mathExpression?: string;
  listItems?: string[];
}

const STEP_THEMES: Record<string, { icon: string; badge: string; bg: string; label: string; color: string; badgeBg: string; badgeFg: string }> = {
  story: { icon: "📖", badge: "Context / कहानी", bg: "bg-white", label: "Real-world Hook", color: "#10B981", badgeBg: "rgba(16, 185, 129, 0.12)", badgeFg: "#059669" },
  problem: { icon: "❓", badge: "Problem / समस्या", bg: "bg-white", label: "Core Problem", color: "#F59E0B", badgeBg: "rgba(245, 158, 11, 0.12)", badgeFg: "#D97706" },
  math: { icon: "📐", badge: "Math / गणना", bg: "bg-white", label: "Calculation Step", color: "#3B82F6", badgeBg: "rgba(59, 130, 246, 0.12)", badgeFg: "#2563EB" },
  fact: { icon: "💡", badge: "Concept / अवधारणा", bg: "bg-white", label: "Concept Breakdown", color: "#6366F1", badgeBg: "rgba(99, 102, 241, 0.12)", badgeFg: "#4F46E5" },
  summary: { icon: "🎯", badge: "Summary / सारांश", bg: "bg-white", label: "CBSE Exam Focus", color: "#8B5CF6", badgeBg: "rgba(139, 92, 246, 0.12)", badgeFg: "#7C3AED" },
  definition: { icon: "📝", badge: "Definition / परिभाषा", bg: "bg-white", label: "Key Definition", color: "#0891B2", badgeBg: "rgba(8, 145, 178, 0.12)", badgeFg: "#0891B2" },
  list: { icon: "📋", badge: "Key Points / मुख्य बिंदु", bg: "bg-white", label: "Important Points", color: "#F43F5E", badgeBg: "rgba(244, 63, 94, 0.12)", badgeFg: "#E11D48" },
};

const getCbseCustomTutorCard = (text: string, title: string, isHi: boolean): CbseStep[] | null => {
  const lowerText = (text || '').toLowerCase();
  const lowerTitle = (title || '').toLowerCase();
  
  // "A Lakh Varieties" math narrative
  if (lowerText.includes('eshwarappa') || lowerText.includes('lakh varieties') || lowerText.includes('chintamani') || (lowerText.includes('lakh') && lowerText.includes('varieties'))) {
    return [
      {
        title: "Step 1: The Real-Life Scenario (दैनिक जीवन का संदर्भ)",
        titleHi: "चरण 1: दैनिक जीवन का संदर्भ",
        type: "story",
        content: "A farmer named Eshwarappa learns that India once had about 1 Lakh (1,00,000) varieties of rice. Today, we only have a handful. Estu wonders: If we taste a new variety of rice every single day, can we taste all 1 Lakh varieties in a 100-year lifetime?",
        contentHi: "चिंतामणि के एक किसान ईश्वरप्पा को पता चलता है कि हमारे देश में कभी लगभग 1 लाख (1,00,000) धान की किस्में थीं। एस्तु सोचता है: यदि हम हर दिन एक नई किस्म का स्वाद चखें, तो क्या हम 100 वर्ष के जीवन में सभी 1 लाख किस्मों का स्वाद चख पाएंगे?"
      },
      {
        title: "Step 2: Understanding the Mathematical Problem (गणितीय समस्या की समझ)",
        titleHi: "चरण 2: गणितीय समस्या की समझ",
        type: "problem",
        content: "We need to compare the total number of days in 100 years with 1 Lakh (1,00,000). Let's convert a lifetime of 100 years into days.",
        contentHi: "हमें 100 वर्षों में कुल दिनों की संख्या की तुलना 1 लाख (1,00,000) से करनी होगी। आइए 100 वर्ष के जीवनकाल को दिनों में बदलें।"
      },
      {
        title: "Step 3: The Step-by-Step Calculation (चरण-दर-चरण गणना)",
        titleHi: "चरण 3: चरण-दर-चरण गणना",
        type: "math",
        content: "1. Days in 1 ordinary year = 365\n2. Days in 100 years = 100 × 365 = 36,500 days.\n(Note: Even if we account for leap years, it adds only about 25 days, making it 36,525 days).\n\nNow, let's compare: 36,500 days vs 1,00,000 rice varieties.",
        contentHi: "1. 1 सामान्य वर्ष में दिन = 365\n2. 100 वर्षों में दिन = 100 × 365 = 36,500 दिन।\n(नोट: यदि हम लीप वर्ष भी जोड़ें, तो यह लगभग 36,525 दिन होगा)।\n\nअब तुलना करें: 36,500 दिन बनाम 1,00,000 धान की किस्में।",
        mathExpression: "100 \\text{ Years} \\times 365 \\text{ days/year} = 36,500 \\text{ days} \\ll 1,00,000 \\text{ (1 Lakh)}"
      },
      {
        title: "Step 4: The Final CBSE Board Conclusion (निष्कर्ष)",
        titleHi: "चरण 4: बोर्ड परीक्षा का निष्कर्ष",
        type: "summary",
        content: "Since 36,500 is much smaller than 1,00,000, we CANNOT taste all the varieties. In fact, we would need almost 274 years to taste them all (1,00,000 ÷ 365 ≈ 274 years)!\n\nKey Concept: 1 Lakh = 1,00,000 (which is the smallest 6-digit number, written with a 1 followed by 5 zeroes). In place value: 1 Lakh = 10 Ten Thousands.",
        contentHi: "चूंकि 36,500 दिन 1,00,000 से बहुत कम हैं, इसलिए हम सभी किस्मों का स्वाद नहीं चख पाएंगे। वास्तव में, सभी का स्वाद चखने के लिए हमें लगभग 274 वर्ष (1,00,000 ÷ 365 ≈ 274 वर्ष) लगेंगे!\n\nमुख्य अवधारणा: 1 लाख = 1,00,000 (जो कि सबसे छोटी 6-अंकीय संख्या है, जिसे 1 के बाद 5 शून्य लिखकर दर्शाया जाता है)।"
      }
    ];
  }

  // Photosynthesis custom card
  if (/photosynth|प्रकाश.*संश्लेषण/i.test(lowerTitle) || (/photosynth|chlorophyll/i.test(lowerText) && lowerText.length < 300)) {
    return [
      { title: "Step 1: Why Do Plants Need Food?", titleHi: "चरण 1: पौधों को भोजन की आवश्यकता क्यों है?", type: "story",
        content: "Just like you need breakfast to start your day, plants need glucose (sugar) for energy. But plants can't walk to a restaurant — so they make their own food using sunlight, CO₂ from air, and water from soil. This incredible process is called Photosynthesis!",
        contentHi: "जैसे आपको दिन शुरू करने के लिए नाश्ते की ज़रूरत है, पौधों को ऊर्जा के लिए ग्लूकोज (शर्करा) चाहिए। लेकिन पौधे रेस्तरां नहीं जा सकते — इसलिए वे सूर्य प्रकाश, हवा से CO₂, और मिट्टी से पानी का उपयोग करके अपना भोजन बनाते हैं। इस अद्भुत प्रक्रिया को प्रकाश संश्लेषण कहते हैं!" },
      { title: "Step 2: The Chemical Equation", titleHi: "चरण 2: रासायनिक समीकरण", type: "math",
        content: "6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂\n(In the presence of Sunlight + Chlorophyll)\n\nCarbon Dioxide + Water → Glucose + Oxygen\n\nThe chlorophyll in leaves absorbs sunlight and powers this reaction.",
        contentHi: "6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂\n(सूर्य प्रकाश + क्लोरोफिल की उपस्थिति में)\n\nकार्बन डाइऑक्साइड + पानी → ग्लूकोज + ऑक्सीजन\n\nपत्तियों में क्लोरोफिल सूर्य प्रकाश को अवशोषित करके इस अभिक्रिया को शक्ति देता है।",
        mathExpression: "6\\text{CO}_2 + 6\\text{H}_2\\text{O} \\xrightarrow{\\text{Sunlight, Chlorophyll}} \\text{C}_6\\text{H}_{12}\\text{O}_6 + 6\\text{O}_2" },
      { title: "Step 3: CBSE Board Exam Focus", titleHi: "चरण 3: बोर्ड परीक्षा फोकस", type: "summary",
        content: "Key Points for Board Exam:\n• Site of photosynthesis: Chloroplasts in leaf cells (specifically mesophyll)\n• Raw materials: CO₂ (from stomata) + H₂O (from roots via xylem)\n• Products: Glucose (stored as starch) + O₂ (released via stomata)\n• Conditions: Sunlight + Chlorophyll are necessary\n• Always mention conditions in the equation for full marks!",
        contentHi: "बोर्ड परीक्षा के मुख्य बिंदु:\n• प्रकाश संश्लेषण का स्थान: पत्ती कोशिकाओं में हरित लवक (मीसोफिल)\n• कच्चे माल: CO₂ (रंध्रों से) + H₂O (जड़ों से जाइलम द्वारा)\n• उत्पाद: ग्लूकोज (स्टार्च के रूप में संग्रहित) + O₂ (रंध्रों से निकलती है)\n• शर्तें: सूर्य प्रकाश + क्लोरोफिल आवश्यक\n• पूर्ण अंक के लिए समीकरण में शर्तें जरूर लिखें!" },
    ];
  }
  
  return null;
};

/** Detect if a paragraph is primarily a mathematical expression or formula */
function isMathParagraph(p: string): boolean {
  // Count math-like characters vs total
  const mathChars = (p.match(/[0-9=+\-×÷²³√∑∫πΔ><≥≤≠∞±∝∴∵→←⇒⇐αβγθλμσφψω]/g) || []).length;
  const hasFormulaPatterns = /[a-z][\s]*[=][\s]*[a-z0-9]/i.test(p) || /\d+\s*[×÷+\-]\s*\d+/.test(p) || /[²³√∑∫]/.test(p);
  return (mathChars > p.length * 0.15 && p.length < 300) || hasFormulaPatterns;
}

/** Detect definition-style paragraphs */
function isDefinitionParagraph(p: string): boolean {
  return /^(definition|defn|note|important|key\s*concept|attention|warning|remember|formula|law|theorem|rule|principle|परिभाषा|नोट|महत्वपूर्ण|विशेष|ध्यान|सूत्र|नियम|प्रमेय|सिद्धांत)[:\-–—]/i.test(p.trim());
}

/** Detect list paragraphs (bullets or numbered) */
function isListParagraph(p: string): boolean {
  const lines = p.split('\n').filter(l => l.trim().length > 0);
  if (lines.length < 2) return false;
  const listLines = lines.filter(l => /^[\s]*[-•●◦▸▹★✓✗\*]\s+/.test(l) || /^[\s]*\d+[\.\)]\s+/.test(l) || /^[\s]*[a-z][\.\)]\s+/i.test(l));
  return listLines.length >= lines.length * 0.6;
}

/** Extract list items from a list paragraph */
function extractListItems(p: string): string[] {
  return p.split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .map(l => l.replace(/^[-•●◦▸▹★✓✗\*]\s+/, '').replace(/^\d+[\.\)]\s+/, '').replace(/^[a-z][\.\)]\s+/i, '').trim())
    .filter(Boolean);
}

/** Detect if paragraph has a markdown-style heading */
function extractHeading(p: string): { heading: string; body: string } | null {
  // ## Heading or ### Heading
  const mdMatch = p.match(/^(#{1,4})\s+(.+?)\n([\s\S]*)/);
  if (mdMatch) return { heading: mdMatch[2].trim(), body: mdMatch[3].trim() };
  // **Bold Heading** followed by content
  const boldMatch = p.match(/^\*\*(.+?)\*\*[\s:]*\n([\s\S]*)/);
  if (boldMatch) return { heading: boldMatch[1].trim(), body: boldMatch[2].trim() };
  return null;
}

/** Extract math expressions from text for highlighted rendering */
function extractMathExpression(p: string): string | undefined {
  // Look for inline formulas like "V = IR", "a² + b² = c²", "F = ma"
  const formulaMatch = p.match(/(?:^|\n)\s*([A-Za-z₀-₉]+\s*[=]\s*[^\n]{3,40})\s*(?:\n|$)/);
  if (formulaMatch) return formulaMatch[1].trim();
  return undefined;
}

function parseCbseTeacherExplanation(text: string, title: string, isHi: boolean): CbseStep[] {
  const custom = getCbseCustomTutorCard(text, title, isHi);
  if (custom) return custom;

  if (!text || text.trim().length === 0) {
    return [{
      title: isHi ? "अवधारणा का परिचय" : "Concept Introduction",
      titleHi: "अवधारणा का परिचय",
      type: "fact",
      content: text || ''
    }];
  }

  // Split by double newlines (respecting Hindi sentence endings with ।)
  const rawParagraphs = text
    .split(/\n\s*\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 8);
  
  if (rawParagraphs.length === 0) {
    return [{
      title: isHi ? "अवधारणा का परिचय" : "Concept Introduction",
      titleHi: "अवधारणा का परिचय",
      type: "fact",
      content: text
    }];
  }

  const steps: CbseStep[] = [];

  if (rawParagraphs.length === 1) {
    // Single block — try to split by sentences for better card-per-concept
    const sentencePattern = /[^.!?\।]+[.!?\।]+/g;
    const sentences = rawParagraphs[0].match(sentencePattern) || [rawParagraphs[0]];
    
    if (sentences.length <= 2) {
      // Too short to split — detect type intelligently
      const p = rawParagraphs[0];
      let type: CbseStep['type'] = 'fact';
      if (isDefinitionParagraph(p)) type = 'definition';
      else if (isMathParagraph(p)) type = 'math';
      else if (isListParagraph(p)) type = 'list';

      steps.push({
        title: isHi ? "अवधारणा विवरण" : "Concept Details",
        titleHi: "अवधारणा विवरण",
        type,
        content: p,
        mathExpression: type === 'math' ? extractMathExpression(p) : undefined,
        listItems: type === 'list' ? extractListItems(p) : undefined,
      });
    } else {
      // Split into 3 balanced groups
      const groupSize = Math.ceil(sentences.length / 3);
      const typeMap: CbseStep['type'][] = ['story', 'fact', 'summary'];
      const titleMap = isHi
        ? ['चरण 1: संदर्भ और परिचय', 'चरण 2: विस्तृत समझ', 'चरण 3: मुख्य सारांश']
        : ['Step 1: Context & Introduction', 'Step 2: Core Explanation', 'Step 3: Key Takeaway'];
      
      for (let i = 0; i < sentences.length; i += groupSize) {
        const stepIdx = Math.min(Math.floor(i / groupSize), 2);
        const content = sentences.slice(i, i + groupSize).join(' ').trim();
        if (!content) continue;
        steps.push({
          title: titleMap[stepIdx],
          titleHi: titleMap[stepIdx],
          type: typeMap[stepIdx],
          content,
          mathExpression: typeMap[stepIdx] === 'math' ? extractMathExpression(content) : undefined,
        });
      }
    }
  } else {
    // Multiple paragraphs — classify each intelligently
    rawParagraphs.forEach((p, idx) => {
      const stepNum = idx + 1;
      let type: CbseStep['type'] = 'fact';
      let stepTitle = '';
      let mathExpr: string | undefined;
      let listItems: string[] | undefined;

      // Check for markdown headings within the paragraph
      const headingExtract = extractHeading(p);
      if (headingExtract && headingExtract.body.length > 5) {
        stepTitle = headingExtract.heading;
        p = headingExtract.body;
      }

      // Classify paragraph type
      if (isDefinitionParagraph(p)) {
        type = 'definition';
        if (!stepTitle) stepTitle = isHi ? `चरण ${stepNum}: मुख्य परिभाषा` : `Step ${stepNum}: Key Definition`;
      } else if (isListParagraph(p)) {
        type = 'list';
        listItems = extractListItems(p);
        if (!stepTitle) stepTitle = isHi ? `चरण ${stepNum}: मुख्य बिंदु` : `Step ${stepNum}: Key Points`;
      } else if (isMathParagraph(p)) {
        type = 'math';
        mathExpr = extractMathExpression(p);
        if (!stepTitle) stepTitle = isHi ? `चरण ${stepNum}: गणितीय व्याख्या` : `Step ${stepNum}: Mathematical Breakdown`;
      } else if (/example|for instance|consider|suppose|उदाहरण|मान लो|विचार करें/i.test(p)) {
        type = 'problem';
        if (!stepTitle) stepTitle = isHi ? `चरण ${stepNum}: हल किया हुआ उदाहरण` : `Step ${stepNum}: Worked Example`;
      } else if (idx === 0) {
        type = 'story';
        if (!stepTitle) stepTitle = isHi ? `चरण 1: संदर्भ और परिचय` : `Step 1: Real-life Context & Hook`;
      } else if (idx === rawParagraphs.length - 1) {
        type = 'summary';
        if (!stepTitle) stepTitle = isHi ? `चरण ${stepNum}: मुख्य सारांश और निष्कर्ष` : `Step ${stepNum}: CBSE Summary & Takeaway`;
      } else {
        if (!stepTitle) stepTitle = isHi ? `चरण ${stepNum}: विस्तृत समझ` : `Step ${stepNum}: Concept Breakdown`;
      }
      
      steps.push({
        title: stepTitle,
        titleHi: stepTitle,
        type,
        content: p,
        mathExpression: mathExpr,
        listItems,
      });
    });
  }
  
  return steps;
}

