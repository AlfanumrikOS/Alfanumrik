'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useAuth } from '@/lib/AuthContext';
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
import { Card, Button, ProgressBar, BottomNav, LoadingFoxy } from '@/components/ui';
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
import type { CurriculumTopic } from '@/lib/types';
import { track } from '@/lib/posthog/client';
import { loadChapterContent } from './actions';
import type { ChapterContent } from '@/lib/learn/fetchChapterContent';
import { resolvePedagogyRule } from '@/lib/learn/pedagogy-content-rules';

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

export default function ChapterConceptPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const subject = params.subject as string;
  const chapterNum = parseInt(params.chapter as string, 10);

  const { student, isLoggedIn, isLoading, isHi } = useAuth();
  const { subjects: allSubjects, unlocked: allowedSubjects } = useAllowedSubjects();

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
  const [currentIdx, setCurrentIdx] = useState(0);
  const [activeTab, setActiveTab] = useState<'core' | 'example' | 'cheat'>('core');
  const [visibleSteps, setVisibleSteps] = useState<Record<number, number>>({});
  // Per-concept quick-check state, keyed by topic index
  const [conceptStates, setConceptStates] = useState<Record<number, ConceptState>>({});
  const [completedCount, setCompletedCount] = useState(0);
  const [showCompletion, setShowCompletion] = useState(false);

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
    const grade = student.grade;

    // Load RAG topics, curated concepts, questions, diagrams, and chapter/subject metadata in parallel
    const [
      ragTopicsRaw,
      curatedConcepts,
      questionsData,
      diagramsData,
      chapterMetaResult,
      subjectRow
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
        .maybeSingle()
    ]);

    if (chapterMetaResult?.data) {
      setChapterMeta(chapterMetaResult.data);
    } else {
      setChapterMeta(null);
    }

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

    setTopics(mergedTopics);
    setQuestions(questionsData as Question[]);
    setDiagrams(diagramsData as Diagram[]);
    setV2SourceUsed(curatedConcepts.length > 0 ? 'curated' : 'rag_fallback');
    setLoading(false);
  }, [student, subject, chapterNum, chapterReaderV2FlagOn]);

  useEffect(() => {
    if (student) load();
  }, [student?.id, load]);

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
    const pct = totalAnswered > 0 ? Math.round((correctCount / totalAnswered) * 100) : 0;
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

  if (isLoading || loading) return <LoadingFoxy />;

  if (!student) return null;

  // ── Completion screen ──
  if (showCompletion) {
    const correctCount = Object.values(conceptStates).filter(s => s.submitted && s.isCorrect).length;
    const totalAnswered = Object.values(conceptStates).filter(s => s.submitted).length;
    const pct = totalAnswered > 0 ? Math.round((correctCount / totalAnswered) * 100) : 0;

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
    // header slot; summary cards + CTAs remain as children. BottomNav is
    // owned by AppShell.nav; the legacy `pb-nav` clearance is dropped
    // since .app-shell-content already pads --shell-nav-h + safe-area.
    return (
      <div className="mesh-bg">
        <AppShell
          variant="mobile"
          nav={<BottomNav />}
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
        <main className="app-container py-6 max-w-lg mx-auto flex flex-col gap-5">
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

  // ── No topics fallback ──
  // Wrapped in AppShell variant="mobile" — same migration pattern as the
  // completion screen above. Header bag holds back-arrow + subject/chapter
  // breadcrumb; the empty-state CTAs stay in children. pb-nav dropped.
  if (topics.length === 0) {
    return (
      <div className="mesh-bg">
        <AppShell
          variant="mobile"
          nav={<BottomNav />}
          header={
            <div className="page-header-inner flex items-center gap-3">
              <button onClick={() => router.push('/dashboard')} className="text-[var(--text-3)]">&larr;</button>
              <span className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
                {subMeta?.icon} {subMeta?.name} · {isHi ? `अध्याय ${chapterNum}` : `Chapter ${chapterNum}`}
              </span>
            </div>
          }
        >
        <main className="app-container py-12 text-center">
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
  const progressPct = ((currentIdx + 1) / topics.length) * 100;
  const bloomLevel = (topic.bloom_focus || 'remember') as BloomLevel;
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
    <div className="app-container py-3">
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
          <span className="text-xs font-medium text-[var(--text-3)]">
            {currentIdx + 1}/{topics.length}
          </span>
        </div>
      </div>
      <ProgressBar value={progressPct} color={subMeta?.color} height={5} />
    </div>
  );

  return (
    <div className="mesh-bg">
      <AppShell
        variant="mobile"
        nav={<BottomNav />}
        header={learnHeaderContent}
      >
      {/* `h-full` lets `mt-auto` on the next-concept CTA pin it to the
          bottom of AppShell's content row — preserving the pre-shell
          "primary action stays in thumb reach" behavior. */}
      <main className="h-full app-container py-4 max-w-2xl mx-auto w-full flex flex-col gap-4">

        {/* ── Exam-Ready 360° Phase 2: per-chapter readiness card ──
            Suppressed on the very first concept of the chapter when the
            student hasn't attempted anything yet. Otherwise the card's
            "Review Weak Concepts" CTA competes for attention with the
            actual lesson below — students would land here, see a red
            "Not Yet Ready / 23/100" banner, and not know whether to
            click Review or start the concept. Once they've attempted
            at least one concept (or moved past the first), the readiness
            summary becomes useful context and is allowed to render. */}
        {(currentIdx > 0 || Object.values(conceptStates).some(s => s.submitted)) && (
          <ChapterReadinessCard
            subjectCode={subject}
            chapterNumber={chapterNum}
            subjectColor={subMeta?.color}
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

        {/* ── Progress bar + estimated time ── */}
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
          {/* Title — always visible so the student knows what they're attempting */}
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

          {/* Premium editorial-style tabs navigation */}
          <div className="flex border-b border-gray-100 pb-px gap-4">
            <button
              onClick={() => setActiveTab('core')}
              className={`pb-2 text-xs font-semibold tracking-wider uppercase border-b-2 transition-all ${
                activeTab === 'core'
                  ? 'border-[var(--accent)] text-[var(--accent)]'
                  : 'border-transparent text-[var(--text-3)] hover:text-[var(--text-2)]'
              }`}
            >
              📖 {isHi ? 'मुख्य पाठ' : 'Learning Core'}
            </button>
            <button
              onClick={() => setActiveTab('example')}
              className={`pb-2 text-xs font-semibold tracking-wider uppercase border-b-2 transition-all ${
                activeTab === 'example'
                  ? 'border-[var(--accent)] text-[var(--accent)]'
                  : 'border-transparent text-[var(--text-3)] hover:text-[var(--text-2)]'
              }`}
            >
              📝 {isHi ? 'हल किया हुआ उदाहरण' : 'Solved Example'}
            </button>
            <button
              onClick={() => setActiveTab('cheat')}
              className={`pb-2 text-xs font-semibold tracking-wider uppercase border-b-2 transition-all ${
                activeTab === 'cheat'
                  ? 'border-[var(--accent)] text-[var(--accent)]'
                  : 'border-transparent text-[var(--text-3)] hover:text-[var(--text-2)]'
              }`}
            >
              🦊 {isHi ? 'चीट शीट' : "Foxy's Notes"}
            </button>
          </div>

          {/* Tab contents */}
          <div className="mt-2">
            {activeTab === 'core' && (
              <div className="space-y-4">
                {/* Productive-failure banner: shown when flag is on and the Quick Check
                    has not yet been attempted. Tutorial content (description, diagram,
                    learning objectives) is hidden until attempt — Manu Kapur's productive
                    failure: struggle first, then teach. Auto-clears after submit. */}
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

                {/* Diagram — hidden until attempt when productive-failure is active */}
                {(!productiveFailureActive || isAnswered) && diagram && diagram.image_url && (
                  <div className="rounded-xl overflow-hidden mb-3" style={{ border: '1px solid var(--border)' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
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

                {/* Description — hidden until attempt when productive-failure is active */}
                {(!productiveFailureActive || isAnswered) && (topic as any).explanation ? (
                  <p className="text-sm leading-relaxed text-[var(--text-2)]" style={{ whiteSpace: 'pre-wrap' }}>
                    {isHi && (topic as any).explanation_hi ? (topic as any).explanation_hi : (topic as any).explanation}
                  </p>
                ) : (!productiveFailureActive || isAnswered) && topic.description ? (
                  <p className="text-sm leading-relaxed text-[var(--text-2)]" style={{ whiteSpace: 'pre-wrap' }}>
                    {topic.description}
                  </p>
                ) : null}

                {/* Learning Objectives — hidden until attempt when productive-failure is active */}
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
              // Parse Worked Solved Example
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
                {/* Formulas & Definitions */}
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

                {/* Common Board Mistakes */}
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

                {/* Foxy's Tip */}
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

              {/* Empty-state fallback for questions that lack MCQ options
                  (free-response prompts authored without a/b/c/d, or
                  malformed `options` JSON). Without this, the box rendered
                  a question + a disabled "Check Answer" button with no way
                  to answer — read as broken UX. We now route the student
                  to Foxy explicitly so they can still engage with the
                  concept. See screenshot from 2026-05-11 (Mathematics ·
                  Chapter 1, "Round 7,348,926 to the nearest lakh"). */}
              {opts.length === 0 && !isAnswered && (
                <div
                  className="rounded-xl p-4 flex items-start gap-3"
                  style={{
                    background: 'rgba(232, 88, 28, 0.06)',
                    border: '1px solid rgba(232, 88, 28, 0.18)',
                  }}
                >
                  <span className="text-xl shrink-0" aria-hidden="true">🦊</span>
                  <div className="flex-1">
                    <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-1)' }}>
                      {isHi
                        ? 'यह प्रश्न खुले उत्तर का है — Foxy के साथ हल करो।'
                        : 'This one needs working out — solve it with Foxy.'}
                    </p>
                    <p className="text-xs leading-relaxed" style={{ color: 'var(--text-2)' }}>
                      {isHi
                        ? 'Foxy तुम्हें step-by-step ले जाएगा। फिर अगली अवधारणा पर बढ़ो।'
                        : 'Foxy will walk you through it step by step, then you can move to the next concept.'}
                    </p>
                    <Button
                      color="#E8581C"
                      className="mt-3"
                      onClick={askFoxy}
                    >
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

                  let bg = 'var(--surface-2)';
                  let border = 'transparent';
                  let textColor = 'var(--text-2)';
                  let letterBg = 'var(--surface-1)';
                  let letterColor = 'var(--text-3)';

                  if (isAnswered) {
                    if (isCorrectOpt) {
                      bg = 'rgba(22,163,74,0.08)'; border = 'rgba(22,163,74,0.4)';
                      textColor = '#16A34A'; letterBg = '#16A34A'; letterColor = '#fff';
                    } else if (isSelected) {
                      bg = 'rgba(220,38,38,0.06)'; border = 'rgba(220,38,38,0.3)';
                      textColor = '#DC2626'; letterBg = '#DC2626'; letterColor = '#fff';
                    }
                  } else if (isSelected) {
                    bg = `${subMeta?.color || 'var(--orange)'}08`;
                    border = subMeta?.color || 'var(--orange)';
                    letterBg = subMeta?.color || 'var(--orange)';
                    letterColor = '#fff';
                  }

                  return (
                    <button
                      key={idx}
                      onClick={() => selectOption(idx)}
                      disabled={isAnswered}
                      className="w-full rounded-xl py-3 px-3 flex items-center gap-3 transition-all active:scale-[0.98] text-left"
                      style={{ background: bg, border: `1.5px solid ${border}`, minHeight: 48 }}
                    >
                      <span className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 transition-all" style={{ background: letterBg, color: letterColor }}>
                        {letter}
                      </span>
                      <span className="text-sm font-medium leading-snug flex-1" style={{ color: textColor }}>
                        {optText}
                      </span>
                      {isAnswered && isCorrectOpt && <span className="ml-auto text-base flex-shrink-0">✓</span>}
                      {isAnswered && isSelected && !isCorrectOpt && <span className="ml-auto text-base flex-shrink-0">✗</span>}
                    </button>
                  );
                })}
              </div>

              {/* Check Answer button — only when MCQ options exist. For
                  the no-options fallback above, the Foxy CTA replaces it
                  so we don't render a permanently-disabled button. */}
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

              {/* Explanation */}
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
                    {isHi && question.explanation_hi ? question.explanation_hi : question.explanation || (isHi ? 'ऊपर दी गई अवधारणा दोबारा पढ़ो।' : 'Review the concept above.')}
                  </p>
                </div>
              )}
              </Card>
            </div>
          );
        })()}



        {/* Navigation — Next is the primary action */}
        {currentIdx === topics.length - 1 ? (() => {
          // FIXED: Only show completion celebration if student has answered questions
          // and achieved a meaningful score. No more celebrating wrong answers.
          const answered = Object.values(conceptStates).filter(s => s.submitted).length;
          const correct = Object.values(conceptStates).filter(s => s.submitted && s.isCorrect).length;
          const chapterPct = answered > 0 ? Math.round((correct / answered) * 100) : 0;
          const isChapterComplete = answered > 0 && chapterPct >= 60;

          return isChapterComplete ? (
          <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl border border-green-200 p-5 text-center space-y-3 mt-auto mb-2">
            <h3 className="text-base font-bold text-green-800">
              {isHi ? 'अध्याय पूरा!' : 'Chapter Complete!'}
            </h3>
            <p className="text-xs text-green-600">
              {isHi ? `${correct}/${answered} सही — बहुत बढ़िया!` : `${correct}/${answered} correct — great job!`}
            </p>
            <div className="flex gap-2 pt-2">
              <button onClick={goPrev}
                className="flex-1 py-2 rounded-lg text-xs font-medium bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 active:scale-[0.98] transition-all">
                {isHi ? '← पिछला' : '← Previous'}
              </button>
              <button onClick={() => {
                  const p = new URLSearchParams({ subject, mode: 'practice' });
                  router.push(`/quiz?${p.toString()}`);
                }}
                className="flex-1 py-2 rounded-lg text-xs font-medium bg-green-600 text-white hover:bg-green-700 active:scale-[0.98] transition-all">
                {isHi ? '⚡ क्विज़ लो' : '⚡ Take Quiz'}
              </button>
            </div>
          </div>
          ) : (
          <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl border border-amber-200 p-5 text-center space-y-3 mt-auto mb-2">
            <h3 className="text-base font-bold text-amber-800">
              {isHi
                ? (answered === 0 ? 'अभ्यास करो!' : 'और अभ्यास करो!')
                : (answered === 0 ? 'Practice the concepts!' : 'Keep practicing!')}
            </h3>
            <p className="text-xs text-amber-600">
              {answered === 0
                ? (isHi ? 'प्रश्नों का उत्तर दो और अध्याय पूरा करो' : 'Answer the concept questions to complete this chapter')
                : (isHi ? `${correct}/${answered} सही (${chapterPct}%) — 60% चाहिए` : `${correct}/${answered} correct (${chapterPct}%) — need 60% to complete`)}
            </p>
            <div className="flex gap-2 pt-2">
              <button onClick={goPrev}
                className="flex-1 py-2 rounded-lg text-xs font-medium bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 active:scale-[0.98] transition-all">
                {isHi ? '← पिछला' : '← Previous'}
              </button>
              <button onClick={() => setCurrentIdx(0)}
                className="flex-1 py-2 rounded-lg text-xs font-medium bg-amber-600 text-white hover:bg-amber-700 active:scale-[0.98] transition-all">
                {isHi ? '🔄 फिर से करो' : '🔄 Try Again'}
              </button>
            </div>
          </div>
          );
        })()
        : (() => {
          // Strategic gate: when the current concept has a Quick Check and
          // the student hasn't attempted it yet, the Next button is the
          // secondary action — not the primary orange CTA. This nudges the
          // student toward the productive-failure attempt loop instead of
          // letting them skip straight through every concept.
          const hasUnattemptedCheck = !!question && !isAnswered && opts.length > 0;
          const primaryColor = hasUnattemptedCheck ? undefined : subMeta?.color;
          return (
          <div className="flex flex-col gap-2 mt-auto pb-2">
            {hasUnattemptedCheck && (
              <p className="text-[11px] text-center text-[var(--text-3)] -mb-1">
                {isHi
                  ? 'पहले Quick Check try करो — फिर आगे बढ़ो।'
                  : 'Attempt the Quick Check first, then move on.'}
              </p>
            )}
            <Button
              fullWidth
              variant={hasUnattemptedCheck ? 'ghost' : 'primary'}
              color={primaryColor}
              onClick={goNext}
            >
              {isHi
                ? `अगला: ${topics[currentIdx + 1]?.title?.slice(0, 28)} →`
                : `Next: ${topics[currentIdx + 1]?.title?.slice(0, 28)} →`}
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
          );
        })()}
      </main>
      </AppShell>
    </div>
  );
}
