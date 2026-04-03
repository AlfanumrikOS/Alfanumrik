'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import { SUBJECT_META } from '@/lib/constants';
import { BottomNav } from '@/components/ui';

/* ── Subject display name mapping ── */
const SUBJECT_DISPLAY: Record<string, string> = {
  math: 'Mathematics', science: 'Science', physics: 'Physics',
  chemistry: 'Chemistry', biology: 'Biology', english: 'English',
  hindi: 'Hindi', sanskrit: 'Sanskrit', social_studies: 'Social Studies',
  computer_science: 'Computer Science', informatics_practices: 'Informatics Practices',
  economics: 'Economics', accountancy: 'Accountancy',
  political_science: 'Political Science', history: 'History', geography: 'Geography',
};

/* ── Types ── */
interface RAGChunk {
  chunk_id: string;
  chunk_text: string;
  topic: string | null;
  concept: string | null;
  chapter_title: string;
  chunk_index: number | null;
  page_number: number | null;
  media_url: string | null;
  media_type: string | null;
  media_description: string | null;
  content_type: string | null;
}

interface RAGQuestion {
  chunk_id: string;
  question_text: string | null;
  answer_text: string | null;
  question_type: string | null;
  ncert_exercise: string | null;
  marks_expected: number | null;
  bloom_level: string | null;
  chunk_text: string;
  topic: string | null;
  concept: string | null;
  chapter_title: string | null;
  media_url: string | null;
  page_number: number | null;
}

interface QAQuestion {
  question_id: string;
  question_text: string;
  question_text_hi: string | null;
  question_type: string;
  source_type: string;
  answer_text: string | null;
  answer_text_hi: string | null;
  answer_methodology: string | null;
  marks_expected: number | null;
  board_relevance: string | null;
  board_relevance_note: string | null;
  ncert_exercise: string | null;
  ncert_page: number | null;
  is_ncert: boolean;
  difficulty: number;
  bloom_level: string;
  options: string[] | string | null;
  correct_answer_index: number;
  explanation: string | null;
}

interface MediaItem {
  id: string;
  caption: string | null;
  alt_text: string | null;
  media_type: string;
  storage_url: string | null;
  page_number: number | null;
  source_book: string | null;
}

interface DbConcept {
  concept_id: string;
  concept_number: number;
  title: string;
  title_hi: string | null;
  learning_objective: string;
  explanation: string;
  key_formula: string | null;
  example_title: string | null;
  example_content: string | null;
  common_mistakes: string[] | null;
  exam_tips: string[] | null;
  diagram_refs: string[] | null;
  diagram_description: string | null;
  practice_question: string | null;
  practice_options: string[] | null;
  practice_correct_index: number | null;
  practice_explanation: string | null;
  difficulty: number;
  bloom_level: string;
  estimated_minutes: number;
}

type TabId = 'learn' | 'qa' | 'quiz' | 'foxy';

/* ── Source type labels ── */
const SOURCE_LABELS: Record<string, { label: string; labelHi: string; icon: string; color: string }> = {
  ncert_exercise: { label: 'NCERT Exercise', labelHi: 'NCERT अभ्यास', icon: '📘', color: 'bg-blue-100 text-blue-800' },
  ncert_intext: { label: 'In-Text Question', labelHi: 'पाठ में प्रश्न', icon: '📖', color: 'bg-green-100 text-green-800' },
  ncert_example: { label: 'NCERT Example', labelHi: 'NCERT उदाहरण', icon: '📝', color: 'bg-purple-100 text-purple-800' },
  cbse_style: { label: 'CBSE Style', labelHi: 'CBSE शैली', icon: '🎯', color: 'bg-orange-100 text-orange-800' },
  practice: { label: 'Practice', labelHi: 'अभ्यास', icon: '✏️', color: 'bg-gray-100 text-gray-700' },
};

const BOARD_LABELS: Record<string, { label: string; labelHi: string; color: string }> = {
  board_appeared: { label: 'Board Exam Pattern', labelHi: 'बोर्ड परीक्षा पैटर्न', color: 'bg-red-100 text-red-700' },
  board_pattern: { label: 'CBSE Important', labelHi: 'CBSE महत्वपूर्ण', color: 'bg-amber-100 text-amber-700' },
};

/* ══════════════════════════════════════════════════════════════
   CHAPTER DETAIL PAGE — Learn / Q&A / Quiz / Foxy
   URL: /learn/[subject]/[chapter]
   ══════════════════════════════════════════════════════════════ */

export default function ChapterDetailPage() {
  const { student, isLoggedIn, isLoading: authLoading, isHi } = useAuth();
  const router = useRouter();
  const params = useParams();

  const subjectCode = (params?.subject as string) || '';
  const chapterNumber = parseInt((params?.chapter as string) || '0', 10);

  const [activeTab, setActiveTab] = useState<TabId>('learn');
  const [chunks, setChunks] = useState<RAGChunk[]>([]);
  const [dbConcepts, setDbConcepts] = useState<DbConcept[]>([]);
  const [questions, setQuestions] = useState<QAQuestion[]>([]);
  const [ragDiagrams, setRagDiagrams] = useState<RAGChunk[]>([]);
  const [ragQuestions, setRagQuestions] = useState<RAGQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [qaFilter, setQaFilter] = useState<string>('all');
  const [expandedQ, setExpandedQ] = useState<Set<string>>(new Set());
  const [reviewedQs, setReviewedQs] = useState<Set<string>>(new Set());
  const [activeConcept, setActiveConcept] = useState(0);
  const [studyStartTime] = useState(Date.now()); // Track study duration for XP

  const subjectDisplay = SUBJECT_DISPLAY[subjectCode] || subjectCode;
  const subjectMeta = SUBJECT_META.find(s => s.code === subjectCode);
  const chapterTitle = chunks.length > 0 ? chunks[0].chapter_title : `Chapter ${chapterNumber}`;

  // Redirect if not logged in
  useEffect(() => {
    if (!authLoading && !isLoggedIn) router.replace('/login');
  }, [authLoading, isLoggedIn, router]);

  // Load chapter data
  const loadData = useCallback(async () => {
    if (!student?.grade || !subjectCode || !chapterNumber) return;
    setLoading(true);
    setError(null);

    try {
      const grade = (student.grade || '9').replace('Grade ', '').trim();

      // RAG-first: load content, diagrams, Q&A from RAG + structured concepts as supplement
      const [contentRes, diagramRes, ragQaRes, conceptsRes, legacyQaRes] = await Promise.all([
        // RAG content chunks (primary learning content)
        supabase.rpc('get_chapter_rag_content', {
          p_grade: grade,
          p_subject: subjectCode,
          p_chapter_number: chapterNumber,
          p_content_type: 'content',
        }),
        // RAG diagram chunks
        supabase.rpc('get_chapter_rag_content', {
          p_grade: grade,
          p_subject: subjectCode,
          p_chapter_number: chapterNumber,
          p_content_type: 'diagram',
        }),
        // RAG Q&A chunks (NCERT questions embedded)
        supabase.rpc('get_chapter_qa_from_rag', {
          p_grade: grade,
          p_subject: subjectCode,
          p_chapter_number: chapterNumber,
        }),
        // Structured concepts (supplementary, not primary)
        supabase.rpc('get_chapter_concepts', {
          p_grade: grade,
          p_subject: subjectCode,
          p_chapter_number: chapterNumber,
        }),
        // Legacy Q&A fallback (question_bank-based)
        supabase.rpc('get_chapter_qa', {
          p_grade: grade,
          p_subject: subjectCode,
          p_chapter_number: chapterNumber,
        }),
      ]);

      if (contentRes.error) console.error('RAG content error:', contentRes.error.message);
      if (diagramRes.error) console.error('RAG diagram error:', diagramRes.error.message);
      if (ragQaRes.error) console.error('RAG Q&A error:', ragQaRes.error.message);
      if (conceptsRes.error) console.error('Concepts error:', conceptsRes.error.message);

      setChunks((contentRes.data as RAGChunk[]) ?? []);
      setRagDiagrams((diagramRes.data as RAGChunk[]) ?? []);
      setRagQuestions((ragQaRes.data as RAGQuestion[]) ?? []);
      setDbConcepts((conceptsRes.data as DbConcept[]) ?? []);
      setQuestions((legacyQaRes.data as QAQuestion[]) ?? []);
    } catch (e) {
      console.error('Load chapter error:', e);
      setError(isHi ? 'अध्याय लोड नहीं हो पाया' : 'Could not load chapter');
    }
    setLoading(false);
  }, [student, subjectCode, chapterNumber, isHi]);

  useEffect(() => { loadData(); }, [loadData]);

  // Use RAG Q&A as primary, fall back to legacy questions if RAG is empty
  const useRagQa = ragQuestions.length > 0;

  // Filtered Q&A questions (legacy path)
  const filteredQuestions = useMemo(() => {
    if (qaFilter === 'all') return questions;
    return questions.filter((q: QAQuestion) => q.source_type === qaFilter);
  }, [questions, qaFilter]);

  // Filtered RAG Q&A
  const filteredRagQuestions = useMemo(() => {
    if (qaFilter === 'all') return ragQuestions;
    return ragQuestions.filter((q: RAGQuestion) => q.question_type === qaFilter);
  }, [ragQuestions, qaFilter]);

  // Toggle question expansion
  const toggleQuestion = (id: string) => {
    setExpandedQ((prev: Set<string>) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        next.add(id);
        setReviewedQs((r: Set<string>) => new Set(r).add(id));
      }
      return next;
    });
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" />
      </div>
    );
  }

  /* ── Tab definitions ── */
  const tabs: { id: TabId; label: string; labelHi: string; icon: string }[] = [
    { id: 'learn', label: 'Learn', labelHi: 'सीखें', icon: '📚' },
    { id: 'qa', label: 'Q&A', labelHi: 'प्रश्न-उत्तर', icon: '❓' },
    { id: 'quiz', label: 'Quiz', labelHi: 'क्विज़', icon: '🧠' },
    { id: 'foxy', label: 'Foxy', labelHi: 'फॉक्सी', icon: '🦊' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* ── Header ── */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-20">
        <div className="max-w-3xl mx-auto px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/learn')}
              className="text-gray-500 hover:text-gray-700 p-1"
              aria-label="Back"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                {subjectMeta && (
                  <span className="text-lg">{subjectMeta.icon}</span>
                )}
                <h1 className="text-base font-semibold text-gray-900 truncate">
                  {loading ? (isHi ? 'लोड हो रहा है...' : 'Loading...') : chapterTitle}
                </h1>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <p className="text-xs text-gray-500">
                  {isHi ? `कक्षा ${student?.grade || ''} • ${subjectDisplay}` : `Class ${student?.grade || ''} • ${subjectDisplay}`}
                  {' • '}Ch. {chapterNumber}
                </p>
                <span className="text-[9px] font-semibold bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">
                  NCERT 2025
                </span>
                {!loading && dbConcepts.length > 0 && (
                  <span className="text-[9px] font-medium bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full">
                    {dbConcepts.length} {isHi ? 'अवधारणाएं' : 'concepts'}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* ── Tab bar ── */}
          <div className="flex gap-1 mt-3 -mb-px">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 py-2 px-2 text-xs font-medium text-center rounded-t-lg border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-orange-500 text-orange-600 bg-orange-50'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <span className="mr-1">{tab.icon}</span>
                {isHi ? tab.labelHi : tab.label}
                {tab.id === 'qa' && (useRagQa ? ragQuestions.length : questions.length) > 0 && (
                  <span className="ml-1 text-[10px] bg-gray-200 rounded-full px-1.5">
                    {useRagQa ? ragQuestions.length : questions.length}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* ── Content ── */}
      <main className="max-w-3xl mx-auto px-4 py-4">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
            <p className="text-red-700 text-sm">{error}</p>
            <button onClick={loadData} className="text-red-600 text-sm underline mt-1">
              {isHi ? 'पुनः प्रयास करें' : 'Retry'}
            </button>
          </div>
        )}

        {loading && (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-white rounded-lg p-4 animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-3/4 mb-3" />
                <div className="h-3 bg-gray-200 rounded w-full mb-2" />
                <div className="h-3 bg-gray-200 rounded w-5/6" />
              </div>
            ))}
          </div>
        )}

        {!loading && activeTab === 'learn' && (
          <LearnTab
            dbConcepts={dbConcepts}
            chunks={chunks}
            ragDiagrams={ragDiagrams}
            questions={questions}
            isHi={isHi}
            activeConcept={activeConcept}
            setActiveConcept={setActiveConcept}
            subjectCode={subjectCode}
            subjectDisplay={subjectDisplay}
            grade={student?.grade || ''}
            chapterTitle={chapterTitle}
            chapterNumber={chapterNumber}
            router={router}
            studentId={student?.id}
            studyStartTime={studyStartTime}
          />
        )}
        {!loading && activeTab === 'qa' && (
          <QATab
            questions={useRagQa ? [] : filteredQuestions}
            ragQuestions={useRagQa ? filteredRagQuestions : []}
            allCount={useRagQa ? ragQuestions.length : questions.length}
            filter={qaFilter}
            onFilterChange={setQaFilter}
            expanded={expandedQ}
            onToggle={toggleQuestion}
            reviewedCount={reviewedQs.size}
            isHi={isHi}
            useRagQa={useRagQa}
          />
        )}
        {!loading && activeTab === 'quiz' && (
          <QuizTab subjectCode={subjectCode} chapterNumber={chapterNumber} isHi={isHi} router={router} />
        )}
        {!loading && activeTab === 'foxy' && (
          <FoxyTab chapterTitle={chapterTitle} subjectCode={subjectCode} isHi={isHi} router={router} />
        )}
      </main>

      <BottomNav />
    </div>
  );
}

/* ═══ CONCEPT BLOCK TYPE ═══ */
interface EmbeddedDiagram {
  url: string;
  description: string | null;
  type: string;
}

interface ConceptBlock {
  title: string;
  explanation: string;
  example: string | null;
  formula: string | null;
  diagramRefs: string[];
  embeddedDiagrams: EmbeddedDiagram[];
  matchedMedia: MediaItem[];
  practiceQ: QAQuestion | null;
  learningObjective?: string;
  commonMistakes?: string[];
  examTips?: string[];
}

/** Match RAG diagram chunks to a concept by topic/concept name or page proximity.
 *  Returns at most 3 matches, prioritizing topic match over page proximity. */
function findRagDiagramsForConcept(concept: DbConcept, diagrams: RAGChunk[]): RAGChunk[] {
  if (diagrams.length === 0) return [];

  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const conceptTitle = normalize(concept.title);

  // Score each diagram for relevance to this concept
  const scored = diagrams.map(d => {
    let score = 0;
    // Topic or concept field matches the concept title
    if (d.topic && normalize(d.topic).includes(conceptTitle)) score += 10;
    if (d.concept && normalize(d.concept).includes(conceptTitle)) score += 10;
    // Concept title mentioned in diagram description or chunk text
    if (d.media_description && normalize(d.media_description).includes(conceptTitle)) score += 5;
    if (normalize(d.chunk_text).includes(conceptTitle)) score += 3;
    // Reverse: concept title contains the diagram topic
    if (d.topic && conceptTitle.includes(normalize(d.topic))) score += 4;
    return { diagram: d, score };
  });

  // Return top matches with score > 0, max 3
  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(s => s.diagram);
}

/** Convert DB chapter_concepts into ConceptBlocks with RAG diagram matching */
function dbConceptsToBlocks(concepts: DbConcept[], ragDiagrams: RAGChunk[]): ConceptBlock[] {
  return concepts.map((c) => {
    // Match RAG diagram chunks by topic/concept proximity or page number
    const matchedDiagrams = findRagDiagramsForConcept(c, ragDiagrams);
    return {
      title: c.title,
      explanation: c.explanation,
      example: c.example_content || null,
      formula: c.key_formula || null,
      diagramRefs: (c.diagram_refs || []) as string[],
      embeddedDiagrams: matchedDiagrams
        .filter((d: RAGChunk) => d.media_url)
        .map((d: RAGChunk) => ({ url: d.media_url!, description: d.media_description || d.chunk_text.slice(0, 100) || '', type: 'diagram' })),
      matchedMedia: [] as MediaItem[],
      practiceQ: c.practice_question ? {
        question_id: c.concept_id,
        question_text: c.practice_question,
        question_text_hi: null,
        question_type: 'mcq',
        source_type: 'practice',
        answer_text: c.practice_explanation || null,
        answer_text_hi: null,
        answer_methodology: null,
        marks_expected: 1,
        board_relevance: null,
        board_relevance_note: null,
        ncert_exercise: null,
        ncert_page: null,
        is_ncert: true,
        difficulty: c.difficulty,
        bloom_level: c.bloom_level,
        options: c.practice_options || null,
        correct_answer_index: c.practice_correct_index ?? 0,
        explanation: c.practice_explanation || null,
      } as QAQuestion : null,
      learningObjective: c.learning_objective,
      commonMistakes: c.common_mistakes || [],
      examTips: c.exam_tips || [],
    };
  });
}

/** Find actual media records matching diagram reference labels.
 *  Normalizes both ref and caption for flexible matching (Figure 1.1 / Fig. 1.1 / fig 1.1).
 *  Returns at most 3 matched media per concept to avoid flooding the UI. */
function findMediaForRefs(refs: string[], media: MediaItem[]): MediaItem[] {
  if (refs.length === 0 || media.length === 0) return [];

  const normalize = (s: string) => s.toLowerCase().replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
  // "Figure 1.1" → "figure 1.1", also generate variants: "fig. 1.1", "fig 1.1"
  const refVariants = (ref: string): string[] => {
    const n = normalize(ref);
    const variants = [n];
    if (n.startsWith('figure')) {
      const num = n.replace(/^figure\s*/, '');
      variants.push(`fig. ${num}`, `fig ${num}`);
    } else if (n.startsWith('fig.')) {
      const num = n.replace(/^fig\.\s*/, '');
      variants.push(`figure ${num}`, `fig ${num}`);
    } else if (n.startsWith('fig ')) {
      const num = n.replace(/^fig\s+/, '');
      variants.push(`figure ${num}`, `fig. ${num}`);
    }
    return variants;
  };

  const matched: MediaItem[] = [];
  for (const ref of refs) {
    if (matched.length >= 3) break;
    const variants = refVariants(ref);
    const found = media.find(m => {
      if (!m.caption) return false;
      const cap = normalize(m.caption);
      return variants.some(v => cap.includes(v) || v.includes(cap));
    });
    if (found && !matched.includes(found)) matched.push(found);
  }
  return matched;
}

/* ═══ LEARN TAB — CONCEPT CARDS (one at a time) ═══ */
function LearnTab({ dbConcepts, chunks, ragDiagrams, questions, isHi, activeConcept, setActiveConcept, subjectCode, subjectDisplay, grade, chapterTitle, chapterNumber, router, studentId, studyStartTime }: {
  dbConcepts: DbConcept[]; chunks: RAGChunk[]; ragDiagrams: RAGChunk[]; questions: QAQuestion[]; isHi: boolean;
  activeConcept: number; setActiveConcept: (n: number) => void;
  subjectCode: string; subjectDisplay: string; grade: string; chapterTitle: string; chapterNumber: number;
  router: ReturnType<typeof useRouter>;
  studentId?: string; studyStartTime: number;
}) {
  const [practiceAnswer, setPracticeAnswer] = useState<number | null>(null);
  const [practiceRevealed, setPracticeRevealed] = useState(false);
  const [conceptStartTime, setConceptStartTime] = useState(Date.now());

  // Use DB concepts — no regex fallback; concepts must come from generate-concepts pipeline
  const concepts = useMemo(() => {
    if (dbConcepts.length > 0) return dbConceptsToBlocks(dbConcepts, ragDiagrams);
    return []; // No regex fallback — concepts must be generated via generate-concepts pipeline
  }, [dbConcepts, ragDiagrams]);

  // Reset practice state and track time when concept changes
  useEffect(() => {
    setPracticeAnswer(null);
    setPracticeRevealed(false);
    setConceptStartTime(Date.now());
  }, [activeConcept]);

  // Award XP when moving to next concept IF student spent ≥15 seconds (real study)
  const handleNextConcept = (next: number) => {
    const timeSpent = (Date.now() - conceptStartTime) / 1000;
    if (timeSpent >= 15 && studentId) {
      // Fire-and-forget XP award for real study
      void supabase.rpc('add_xp', { p_student_id: studentId, p_xp: 5, p_source: `learn_${subjectCode}` }).then(() => {});
    }
    setActiveConcept(next);
  };

  if (concepts.length === 0) {
    if (chunks.length > 0) {
      // Chunks exist but structured concepts not yet generated
      return (
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-center">
            <p className="text-3xl mb-2">📖</p>
            <p className="text-sm font-medium text-amber-800">
              {isHi ? 'अध्याय सामग्री उपलब्ध है' : 'Chapter content is available'}
            </p>
            <p className="text-xs text-amber-600 mt-1">
              {isHi
                ? 'संरचित अवधारणाएं तैयार की जा रही हैं। तब तक नीचे पूर्वावलोकन देखें या फॉक्सी से पूछें।'
                : 'Structured concepts are being prepared. Preview content below or ask Foxy.'}
            </p>
          </div>

          {/* RAG chunk previews */}
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {chunks.slice(0, 8).map((chunk, i) => (
              <div key={chunk.chunk_id || i} className="bg-white rounded-lg border border-gray-200 p-3">
                <p className="text-xs text-gray-600 leading-relaxed">
                  {chunk.chunk_text.slice(0, 100).trim()}{chunk.chunk_text.length > 100 ? '...' : ''}
                </p>
                {chunk.topic && (
                  <span className="inline-block mt-1.5 text-[10px] bg-gray-100 text-gray-500 rounded px-1.5 py-0.5">
                    {chunk.topic}
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Ask Foxy button */}
          <button
            onClick={() => {
              const p = new URLSearchParams({ subject: subjectCode, chapter: chapterTitle, mode: 'learn' });
              router.push(`/foxy?${p.toString()}`);
            }}
            className="w-full bg-orange-500 text-white rounded-lg py-3 text-sm font-medium hover:bg-orange-600 transition-colors"
          >
            {isHi ? '🦊 इस अध्याय के बारे में फॉक्सी से पूछें' : '🦊 Ask Foxy about this chapter'}
          </button>
        </div>
      );
    }

    return (
      <div className="text-center py-12">
        <p className="text-4xl mb-3">📖</p>
        <p className="text-gray-500 text-sm">
          {isHi ? 'इस अध्याय की सामग्री जल्द ही उपलब्ध होगी' : 'Content for this chapter will be available soon'}
        </p>
      </div>
    );
  }

  const concept = concepts[activeConcept] || concepts[0];
  const total = concepts.length;
  const isFirst = activeConcept === 0;
  const isLast = activeConcept === total - 1;

  return (
    <div className="space-y-3">
      {/* ── Concept navigator pills ── */}
      {total > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
          {concepts.map((c, i) => (
            <button
              key={i}
              onClick={() => setActiveConcept(i)}
              className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                i === activeConcept
                  ? 'bg-orange-500 text-white'
                  : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              <span className="font-bold">{i + 1}</span>
              <span className="truncate max-w-[20ch]">{c.title.length > 20 ? c.title.slice(0, 20) + '...' : c.title}</span>
            </button>
          ))}
        </div>
      )}

      {/* ── Progress dots ── */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1.5">
          {concepts.map((_, i) => (
            <button
              key={i}
              onClick={() => setActiveConcept(i)}
              className={`w-2 h-2 rounded-full transition-all ${
                i === activeConcept ? 'bg-orange-500 w-4' : i < activeConcept ? 'bg-orange-300' : 'bg-gray-200'
              }`}
            />
          ))}
        </div>
        <span className="text-[10px] text-gray-400 font-medium">
          {activeConcept + 1}/{total}
        </span>
      </div>

      {/* ── Chapter overview card (shown on first concept) ── */}
      {isFirst && (
        <div className="bg-gradient-to-br from-gray-50 to-orange-50 rounded-xl border border-gray-200 p-4">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            {isHi ? 'अध्याय अवलोकन' : 'Chapter Overview'}
          </h3>
          <p className="text-sm font-bold text-gray-900 leading-snug">{chapterTitle}</p>
          <p className="text-xs text-gray-500 mt-1">
            {isHi ? `कक्षा ${grade}` : `Class ${grade}`} &bull; {subjectDisplay}
          </p>
          <div className="flex gap-3 mt-2.5">
            <span className="text-xs text-gray-600">
              {concepts.length} {isHi ? 'अवधारणाएं' : 'concepts'}
            </span>
            <span className="text-xs text-gray-600">
              {questions.length} {isHi ? 'प्रश्न-उत्तर उपलब्ध' : 'Q&A available'}
            </span>
          </div>
          <div className="mt-2.5 border-t border-gray-200 pt-2">
            <span className="text-[10px] font-semibold text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
              NCERT 2025
            </span>
          </div>
        </div>
      )}

      {/* ── CONCEPT CARD ── */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">

        {/* Title bar */}
        <div className="bg-gradient-to-r from-orange-500 to-amber-500 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="bg-white/20 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
              {activeConcept + 1}
            </span>
            <h2 className="text-sm font-bold text-white leading-tight">{concept.title}</h2>
          </div>
        </div>

        {/* Learning Objective (if from DB concepts) */}
        {concept.learningObjective && (
          <div className="px-4 py-2.5 bg-indigo-50 border-b border-indigo-100">
            <h3 className="text-[10px] uppercase font-semibold text-indigo-500 mb-1 tracking-wide">
              {isHi ? 'सीखने का उद्देश्य' : 'Learning Objective'}
            </h3>
            <p className="text-sm text-indigo-800">{concept.learningObjective}</p>
          </div>
        )}

        {/* Explanation */}
        <div className="px-4 py-3 border-b border-gray-100">
          <h3 className="text-[10px] uppercase font-semibold text-gray-400 mb-1.5 tracking-wide">
            {isHi ? 'समझें' : 'Understand'}
          </h3>
          <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
            {concept.explanation}
          </p>
        </div>

        {/* Formula (if exists) */}
        {concept.formula && (
          <div className="px-4 py-2.5 bg-blue-50 border-b border-blue-100">
            <h3 className="text-[10px] uppercase font-semibold text-blue-500 mb-1 tracking-wide">
              {isHi ? 'सूत्र' : 'Formula'}
            </h3>
            <p className="text-sm font-mono text-blue-800 bg-white/60 rounded px-3 py-1.5 inline-block">
              {concept.formula}
            </p>
          </div>
        )}

        {/* Embedded Diagrams — from RAG chunks with media_url (first-class Voyage-indexed content) */}
        {concept.embeddedDiagrams.length > 0 && (
          <div className="px-4 py-3 border-b border-gray-100">
            {concept.embeddedDiagrams.map((d, i) => (
              <div key={i} className="mb-2">
                {d.url.endsWith('.pdf') ? (
                  <div className="bg-purple-50 rounded-lg border border-purple-200 p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-purple-600">📄</span>
                      <span className="text-xs font-semibold text-purple-700">{isHi ? 'NCERT आरेख' : 'NCERT Diagram'}</span>
                    </div>
                    {d.description && <p className="text-xs text-purple-600 mb-2">{d.description}</p>}
                    <a
                      href={d.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-purple-700 bg-white border border-purple-300 rounded-lg px-3 py-1.5 hover:bg-purple-50"
                    >
                      {isHi ? 'पाठ्यपुस्तक में देखें' : 'View in textbook'} ↗
                    </a>
                  </div>
                ) : (
                  <div className="rounded-lg border border-gray-200 overflow-hidden">
                    <img src={d.url} alt={d.description || 'Diagram'} className="w-full" loading="lazy" />
                    {d.description && <p className="text-[10px] text-gray-500 px-2 py-1 bg-gray-50">{d.description}</p>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Matched Media from content_media table — fallback diagrams */}
        {(concept.matchedMedia && concept.matchedMedia.length > 0) ? (
          <div className="px-4 py-2.5 bg-purple-50 border-b border-purple-100">
            <h3 className="text-[10px] uppercase font-semibold text-purple-500 mb-2 tracking-wide">
              {isHi ? 'चित्र' : 'Diagrams'}
            </h3>
            <div className="space-y-2">
              {concept.matchedMedia.map((m, i) => (
                <div key={i} className="bg-white rounded-lg border border-purple-200 overflow-hidden">
                  {m.storage_url ? (
                    <img src={m.storage_url} alt={m.alt_text || m.caption || 'Diagram'} className="w-full" loading="lazy" />
                  ) : (
                    <div className="p-3 text-center">
                      <span className="text-2xl">📊</span>
                      <p className="text-xs text-purple-600 mt-1 font-medium">{m.caption}</p>
                      {m.alt_text && <p className="text-[10px] text-gray-500 mt-0.5">{m.alt_text}</p>}
                    </div>
                  )}
                  {m.caption && m.storage_url && (
                    <p className="text-[10px] text-purple-600 px-2 py-1 bg-purple-50">{m.caption}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : concept.diagramRefs.length > 0 ? (
          <div className="px-4 py-2.5 bg-purple-50 border-b border-purple-100">
            <h3 className="text-[10px] uppercase font-semibold text-purple-500 mb-1.5 tracking-wide">
              {isHi ? 'संदर्भित चित्र' : 'Referenced Diagrams'}
            </h3>
            <div className="flex flex-wrap gap-2">
              {concept.diagramRefs.map((ref, i) => (
                <span key={i} className="text-xs bg-white border border-purple-200 rounded-lg px-2.5 py-1 text-purple-700">
                  📊 {ref}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {/* Common Mistakes */}
        {concept.commonMistakes && concept.commonMistakes.length > 0 && (
          <div className="px-4 py-2.5 bg-red-50 border-b border-red-100">
            <h3 className="text-[10px] uppercase font-semibold text-red-500 mb-1.5 tracking-wide">
              {isHi ? '⚠️ सामान्य गलतियाँ' : '⚠️ Common Mistakes'}
            </h3>
            <ul className="space-y-1">
              {concept.commonMistakes.map((m, i) => (
                <li key={i} className="text-xs text-red-700 flex gap-1.5">
                  <span className="text-red-400 mt-0.5">•</span>
                  <span>{typeof m === 'string' ? m : String(m)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Exam Tips */}
        {concept.examTips && concept.examTips.length > 0 && (
          <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-100">
            <h3 className="text-[10px] uppercase font-semibold text-amber-600 mb-1.5 tracking-wide">
              {isHi ? '🎯 परीक्षा टिप्स' : '🎯 Exam Tips'}
            </h3>
            <ul className="space-y-1">
              {concept.examTips.map((t, i) => (
                <li key={i} className="text-xs text-amber-700 flex gap-1.5">
                  <span className="text-amber-400 mt-0.5">★</span>
                  <span>{typeof t === 'string' ? t : String(t)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Example */}
        {concept.example && (
          <div className="px-4 py-3 bg-green-50 border-b border-green-100">
            <h3 className="text-[10px] uppercase font-semibold text-green-600 mb-1.5 tracking-wide">
              {isHi ? 'उदाहरण' : 'Example'}
            </h3>
            <p className="text-sm text-green-800 leading-relaxed whitespace-pre-wrap">
              {concept.example}
            </p>
          </div>
        )}

        {/* Practice Question */}
        {concept.practiceQ && (
          <div className="px-4 py-3 bg-amber-50">
            <h3 className="text-[10px] uppercase font-semibold text-amber-600 mb-2 tracking-wide">
              {isHi ? 'अभ्यास' : 'Quick Check'}
            </h3>
            <p className="text-sm font-medium text-gray-800 mb-2">{concept.practiceQ.question_text}</p>
            {concept.practiceQ.options && (
              <div className="space-y-1.5">
                {safeParseOptions(concept.practiceQ.options).map((opt: string, oi: number) => {
                  const isCorrect = oi === concept.practiceQ!.correct_answer_index;
                  const isSelected = practiceAnswer === oi;
                  const showResult = practiceRevealed;
                  return (
                    <button
                      key={oi}
                      onClick={() => {
                        if (!practiceRevealed) {
                          setPracticeAnswer(oi);
                          setPracticeRevealed(true);
                        }
                      }}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm border transition-all ${
                        showResult && isCorrect
                          ? 'bg-green-100 border-green-400 text-green-800 font-medium'
                          : showResult && isSelected && !isCorrect
                          ? 'bg-red-50 border-red-300 text-red-700'
                          : isSelected
                          ? 'bg-orange-50 border-orange-300'
                          : 'bg-white border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <span className="font-mono text-xs mr-2">{String.fromCharCode(65 + oi)})</span>
                      {opt}
                      {showResult && isCorrect && <span className="float-right text-green-600">✓</span>}
                      {showResult && isSelected && !isCorrect && <span className="float-right text-red-500">✗</span>}
                    </button>
                  );
                })}
              </div>
            )}
            {practiceRevealed && concept.practiceQ.explanation && (
              <p className="text-xs text-gray-600 mt-2 bg-white rounded p-2 border border-gray-100">
                {concept.practiceQ.explanation}
              </p>
            )}
          </div>
        )}

        {/* Foxy hook */}
        <div className="px-4 py-2.5 border-t border-gray-100">
          <button
            onClick={() => {
              const p = new URLSearchParams({ subject: subjectCode, chapter: chapterTitle, mode: 'doubt', message: `Explain "${concept.title}" in simple words` });
              router.push(`/foxy?${p.toString()}`);
            }}
            className="flex items-center gap-2 text-xs text-orange-600 hover:text-orange-700 font-medium"
          >
            <span>🦊</span>
            {isHi ? 'फॉक्सी से यह समझें' : 'Ask Foxy to explain this'}
          </button>
        </div>
      </div>

      {/* ── Navigation buttons ── */}
      <div className="flex gap-3">
        <button
          onClick={() => handleNextConcept(Math.max(0, activeConcept - 1))}
          disabled={isFirst}
          className={`flex-1 py-2.5 rounded-lg text-sm font-medium border transition-all ${
            isFirst
              ? 'bg-gray-50 text-gray-300 border-gray-100 cursor-not-allowed'
              : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300 active:scale-[0.98]'
          }`}
        >
          {isHi ? '← पिछला' : '← Previous'}
        </button>
        <button
          onClick={() => handleNextConcept(Math.min(total - 1, activeConcept + 1))}
          disabled={isLast}
          className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
            isLast
              ? 'bg-gray-50 text-gray-300 border border-gray-100 cursor-not-allowed'
              : 'bg-orange-500 text-white hover:bg-orange-600 active:scale-[0.98]'
          }`}
        >
          {isHi ? 'अगला →' : 'Next →'}
        </button>
      </div>
    </div>
  );
}

/* ═══ Q&A TAB ═══ */
function QATab({
  questions, ragQuestions, allCount, filter, onFilterChange, expanded, onToggle, reviewedCount, isHi, useRagQa,
}: {
  questions: QAQuestion[];
  ragQuestions: RAGQuestion[];
  allCount: number;
  filter: string;
  onFilterChange: (f: string) => void;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  reviewedCount: number;
  isHi: boolean;
  useRagQa: boolean;
}) {
  // Only show filters that have at least 1 question
  const sourceCounts: Record<string, number> = {};
  if (useRagQa) {
    for (const q of ragQuestions) {
      const key = q.question_type || 'practice';
      sourceCounts[key] = (sourceCounts[key] || 0) + 1;
    }
  } else {
    for (const q of questions) {
      sourceCounts[q.source_type] = (sourceCounts[q.source_type] || 0) + 1;
    }
  }
  const allFilters = [
    { id: 'all', label: 'All', labelHi: 'सभी' },
    { id: 'ncert_exercise', label: 'Exercise', labelHi: 'अभ्यास' },
    { id: 'ncert_intext', label: 'In-Text', labelHi: 'पाठ में' },
    { id: 'cbse_style', label: 'CBSE Style', labelHi: 'CBSE शैली' },
    { id: 'practice', label: 'Practice', labelHi: 'अभ्यास' },
  ];
  // Show "All" always + only filters that have questions
  const filters = allFilters.filter(f => f.id === 'all' || (sourceCounts[f.id] || 0) > 0);

  if (allCount === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-4xl mb-3">❓</p>
        <p className="text-gray-500 text-sm">
          {isHi ? 'इस अध्याय के प्रश्न जल्द ही उपलब्ध होंगे' : 'Questions for this chapter will be available soon'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Progress bar */}
      <div className="bg-white rounded-lg border border-gray-200 p-3">
        <div className="flex justify-between items-center mb-1">
          <span className="text-xs text-gray-600">
            {isHi ? `${reviewedCount}/${allCount} प्रश्न देखे` : `${reviewedCount}/${allCount} questions reviewed`}
          </span>
          <span className="text-xs font-medium text-orange-600">
            {allCount > 0 ? Math.round((reviewedCount / allCount) * 100) : 0}%
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-1.5">
          <div
            className="bg-orange-500 h-1.5 rounded-full transition-all"
            style={{ width: `${allCount > 0 ? (reviewedCount / allCount) * 100 : 0}%` }}
          />
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {filters.map(f => (
          <button
            key={f.id}
            onClick={() => onFilterChange(f.id)}
            className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              filter === f.id
                ? 'bg-orange-500 text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {isHi ? f.labelHi : f.label}
          </button>
        ))}
      </div>

      {/* Questions list */}
      <div className="space-y-3">
        {useRagQa ? ragQuestions.map((q, qi) => {
          const isExpanded = expanded.has(q.chunk_id);
          const srcInfo = SOURCE_LABELS[q.question_type || 'practice'] || SOURCE_LABELS.practice;

          return (
            <div key={q.chunk_id} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <button
                onClick={() => onToggle(q.chunk_id)}
                className="w-full text-left p-4 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <span className="text-xs text-gray-400 font-mono mt-0.5">{qi + 1}.</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 font-medium leading-snug">
                      {q.question_text || q.chunk_text.slice(0, 200)}
                    </p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${srcInfo.color}`}>
                        {srcInfo.icon} {isHi ? srcInfo.labelHi : srcInfo.label}
                        {q.ncert_exercise && ` (${q.ncert_exercise})`}
                      </span>
                      {q.marks_expected && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600">
                          {q.marks_expected} {isHi ? 'अंक' : 'marks'}
                        </span>
                      )}
                      {q.bloom_level && (
                        <span className="text-[10px] text-gray-400 capitalize">{q.bloom_level}</span>
                      )}
                    </div>
                  </div>
                  <svg
                    className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>
              {isExpanded && (
                <div className="border-t border-gray-100 bg-gray-50 p-4">
                  {q.answer_text && (
                    <div className="mb-3">
                      <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">
                        {isHi ? 'उत्तर' : 'Answer'}
                      </h4>
                      <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                        {q.answer_text}
                      </div>
                    </div>
                  )}
                  {q.topic && (
                    <span className="inline-block text-[10px] bg-blue-50 text-blue-600 rounded px-2 py-0.5">
                      {q.topic}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        }) : questions.map((q, qi) => {
          const isExpanded = expanded.has(q.question_id);
          const srcInfo = SOURCE_LABELS[q.source_type] || SOURCE_LABELS.practice;
          const boardInfo = q.board_relevance ? BOARD_LABELS[q.board_relevance] : null;

          return (
            <div key={q.question_id} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <button
                onClick={() => onToggle(q.question_id)}
                className="w-full text-left p-4 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <span className="text-xs text-gray-400 font-mono mt-0.5">
                    {qi + 1}.
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 font-medium leading-snug">
                      {q.question_text}
                    </p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${srcInfo.color}`}>
                        {srcInfo.icon} {isHi ? srcInfo.labelHi : srcInfo.label}
                        {q.ncert_exercise && ` (${q.ncert_exercise})`}
                      </span>
                      {boardInfo && (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${boardInfo.color}`}>
                          {isHi ? boardInfo.labelHi : boardInfo.label}
                        </span>
                      )}
                      {q.marks_expected && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600">
                          {q.marks_expected} {isHi ? 'अंक' : 'marks'}
                        </span>
                      )}
                      <span className="text-[10px] text-gray-400">
                        {'●'.repeat(q.difficulty)}{'○'.repeat(3 - q.difficulty)}
                      </span>
                    </div>
                  </div>
                  <svg
                    className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-gray-100 bg-gray-50 p-4">
                  {/* MCQ options */}
                  {q.options && (
                    <div className="mb-3">
                      {(Array.isArray(q.options) ? q.options : safeParseOptions(q.options)).map((opt: string, oi: number) => (
                        <div
                          key={oi}
                          className={`flex items-center gap-2 py-1.5 px-3 rounded text-sm mb-1 ${
                            oi === q.correct_answer_index
                              ? 'bg-green-50 text-green-800 font-medium'
                              : 'text-gray-600'
                          }`}
                        >
                          <span className="font-mono text-xs">
                            {String.fromCharCode(65 + oi)})
                          </span>
                          {opt}
                          {oi === q.correct_answer_index && (
                            <span className="ml-auto text-green-600 text-xs">✓</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Answer text */}
                  {q.answer_text && (
                    <div className="mb-3">
                      <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">
                        {isHi ? 'उत्तर' : 'Answer'}
                      </h4>
                      <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                        {q.answer_text}
                      </div>
                    </div>
                  )}

                  {/* Explanation */}
                  {q.explanation && (
                    <div className="mb-3">
                      <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">
                        {isHi ? 'व्याख्या' : 'Explanation'}
                      </h4>
                      <div className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
                        {q.explanation}
                      </div>
                    </div>
                  )}

                  {/* Board relevance note */}
                  {q.board_relevance_note && (
                    <div className="bg-amber-50 border border-amber-200 rounded p-2 mt-2">
                      <p className="text-xs text-amber-700">
                        🎯 {q.board_relevance_note}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function safeParseOptions(opts: unknown): string[] {
  if (Array.isArray(opts)) return opts;
  if (typeof opts === 'string') {
    try { return JSON.parse(opts); } catch { return []; }
  }
  return [];
}

/* ═══ QUIZ TAB ═══ */
function QuizTab({
  subjectCode, chapterNumber, isHi, router,
}: {
  subjectCode: string; chapterNumber: number; isHi: boolean; router: ReturnType<typeof useRouter>;
}) {
  const quizOptions = [
    { count: 5, label: 'Quick Quiz', labelHi: 'त्वरित क्विज़', desc: '~5 min', icon: '⚡' },
    { count: 10, label: 'Practice', labelHi: 'अभ्यास', desc: '~12 min', icon: '📝' },
    { count: 15, label: 'Full Quiz', labelHi: 'पूर्ण क्विज़', desc: '~20 min', icon: '📋' },
    { count: 20, label: 'Test Mode', labelHi: 'परीक्षा मोड', desc: '~30 min', icon: '🎯' },
  ];

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-r from-blue-50 to-cyan-50 rounded-lg p-4 border border-blue-100">
        <h2 className="text-sm font-semibold text-blue-800">
          {isHi ? '🧠 अध्याय क्विज़' : '🧠 Chapter Quiz'}
        </h2>
        <p className="text-xs text-blue-600 mt-1">
          {isHi
            ? 'इस अध्याय के प्रश्नों से अभ्यास करें। प्रश्न दोहराए नहीं जाएंगे।'
            : 'Practice with questions from this chapter. Questions won\'t repeat until you\'ve seen 80% of the pool.'}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {quizOptions.map(opt => (
          <button
            key={opt.count}
            onClick={() => router.push(`/quiz?subject=${subjectCode}&chapter=${chapterNumber}&count=${opt.count}`)}
            className="bg-white rounded-lg border border-gray-200 p-4 text-left hover:border-orange-300 hover:shadow-sm transition-all"
          >
            <span className="text-2xl">{opt.icon}</span>
            <h3 className="text-sm font-semibold text-gray-800 mt-2">
              {isHi ? opt.labelHi : opt.label}
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {opt.count} {isHi ? 'प्रश्न' : 'questions'} • {opt.desc}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ═══ FOXY TAB ═══ */
function FoxyTab({
  chapterTitle, subjectCode, isHi, router,
}: {
  chapterTitle: string; subjectCode: string; isHi: boolean; router: ReturnType<typeof useRouter>;
}) {
  const suggestions = [
    { text: isHi ? 'इस अध्याय की मुख्य अवधारणाएं समझाइए' : 'Explain the key concepts of this chapter', mode: 'learn' },
    { text: isHi ? 'महत्वपूर्ण सूत्र क्या हैं?' : 'What are the important formulas?', mode: 'learn' },
    { text: isHi ? 'इस अध्याय के लिए परीक्षा टिप्स दीजिए' : 'Give me exam tips for this chapter', mode: 'revision' },
    { text: isHi ? 'सामान्य गलतियों में मेरी मदद करें' : 'Help me with common mistakes', mode: 'doubt' },
    { text: isHi ? 'त्वरित संशोधन नोट्स दीजिए' : 'Quick revision notes please', mode: 'revision' },
  ];

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-r from-orange-50 to-yellow-50 rounded-lg p-4 border border-orange-100">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-2xl">🦊</span>
          <h2 className="text-sm font-semibold text-orange-800">
            {isHi ? 'फॉक्सी — आपका AI ट्यूटर' : 'Foxy — Your AI Tutor'}
          </h2>
        </div>
        <p className="text-xs text-orange-600">
          {isHi
            ? `${chapterTitle} के बारे में कुछ भी पूछें। फॉक्सी NCERT पाठ्यपुस्तक से जवाब देगा।`
            : `Ask anything about ${chapterTitle}. Foxy answers from NCERT textbook content.`}
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-gray-500 uppercase">
          {isHi ? 'सुझाए गए प्रश्न' : 'Suggested Questions'}
        </p>
        {suggestions.map((s, i) => (
          <button
            key={i}
            onClick={() => {
              const params = new URLSearchParams({
                subject: subjectCode,
                chapter: chapterTitle,
                mode: s.mode,
                message: s.text,
              });
              router.push(`/foxy?${params.toString()}`);
            }}
            className="w-full bg-white rounded-lg border border-gray-200 p-3 text-left hover:border-orange-300 hover:shadow-sm transition-all"
          >
            <p className="text-sm text-gray-700">{s.text}</p>
          </button>
        ))}
      </div>

      <button
        onClick={() => {
          const params = new URLSearchParams({
            subject: subjectCode,
            chapter: chapterTitle,
          });
          router.push(`/foxy?${params.toString()}`);
        }}
        className="w-full bg-orange-500 text-white rounded-lg py-3 text-sm font-medium hover:bg-orange-600 transition-colors"
      >
        {isHi ? '🦊 फॉक्सी से चैट करें' : '🦊 Chat with Foxy'}
      </button>
    </div>
  );
}
