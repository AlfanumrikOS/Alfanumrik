'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
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
  const [questions, setQuestions] = useState<QAQuestion[]>([]);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [qaFilter, setQaFilter] = useState<string>('all');
  const [expandedQ, setExpandedQ] = useState<Set<string>>(new Set());
  const [reviewedQs, setReviewedQs] = useState<Set<string>>(new Set());

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

      const [contentRes, qaRes, mediaRes] = await Promise.all([
        supabase.rpc('get_chapter_rag_content', {
          p_grade: grade,
          p_subject: subjectCode,
          p_chapter_number: chapterNumber,
        }),
        supabase.rpc('get_chapter_qa', {
          p_grade: grade,
          p_subject: subjectCode,
          p_chapter_number: chapterNumber,
        }),
        supabase
          .from('content_media')
          .select('id, caption, alt_text, media_type, storage_url, page_number, source_book')
          .eq('grade', `Grade ${grade}`)
          .eq('subject', subjectDisplay)
          .eq('chapter_number', chapterNumber)
          .eq('is_active', true)
          .order('page_number'),
      ]);

      if (contentRes.error) console.error('Content error:', contentRes.error.message);
      if (qaRes.error) console.error('QA error:', qaRes.error.message);

      setChunks((contentRes.data as RAGChunk[]) ?? []);
      setQuestions((qaRes.data as QAQuestion[]) ?? []);
      setMedia((mediaRes.data as MediaItem[]) ?? []);
    } catch (e) {
      console.error('Load chapter error:', e);
      setError(isHi ? 'अध्याय लोड नहीं हो पाया' : 'Could not load chapter');
    }
    setLoading(false);
  }, [student, subjectCode, chapterNumber, subjectDisplay, isHi]);

  useEffect(() => { loadData(); }, [loadData]);

  // Filtered Q&A questions
  const filteredQuestions = useMemo(() => {
    if (qaFilter === 'all') return questions;
    return questions.filter(q => q.source_type === qaFilter);
  }, [questions, qaFilter]);

  // Toggle question expansion
  const toggleQuestion = (id: string) => {
    setExpandedQ(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        next.add(id);
        setReviewedQs(r => new Set(r).add(id));
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
              <p className="text-xs text-gray-500">
                {isHi ? `कक्षा ${student?.grade || ''} • ${subjectDisplay}` : `Class ${student?.grade || ''} • ${subjectDisplay}`}
                {' • '}Ch. {chapterNumber}
              </p>
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
                {tab.id === 'qa' && questions.length > 0 && (
                  <span className="ml-1 text-[10px] bg-gray-200 rounded-full px-1.5">
                    {questions.length}
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

        {!loading && activeTab === 'learn' && <LearnTab chunks={chunks} media={media} isHi={isHi} />}
        {!loading && activeTab === 'qa' && (
          <QATab
            questions={filteredQuestions}
            allCount={questions.length}
            filter={qaFilter}
            onFilterChange={setQaFilter}
            expanded={expandedQ}
            onToggle={toggleQuestion}
            reviewedCount={reviewedQs.size}
            isHi={isHi}
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

/* ═══ LEARN TAB ═══ */
function LearnTab({ chunks, media, isHi }: { chunks: RAGChunk[]; media: MediaItem[]; isHi: boolean }) {
  if (chunks.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-4xl mb-3">📖</p>
        <p className="text-gray-500 text-sm">
          {isHi ? 'इस अध्याय की सामग्री जल्द ही उपलब्ध होगी' : 'Content for this chapter will be available soon'}
        </p>
      </div>
    );
  }

  // Group chunks by topic if available, otherwise render sequentially
  const grouped = groupChunksByTopic(chunks);

  return (
    <div className="space-y-4">
      {/* Chapter overview from first chunk */}
      {chunks.length > 0 && (
        <div className="bg-gradient-to-r from-orange-50 to-amber-50 rounded-lg p-4 border border-orange-100">
          <h2 className="text-sm font-semibold text-orange-800 mb-1">
            {isHi ? '📖 अध्याय सामग्री' : '📖 Chapter Content'}
          </h2>
          <p className="text-xs text-orange-600">
            {isHi
              ? `${chunks.length} खंड • NCERT पाठ्यपुस्तक से`
              : `${chunks.length} sections • From NCERT textbook`}
          </p>
        </div>
      )}

      {/* Media / Diagrams section */}
      {media.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">
            {isHi ? '🖼️ चित्र और आरेख' : '🖼️ Diagrams & Figures'}
          </h3>
          <div className="grid grid-cols-2 gap-3">
            {media.map(m => (
              <div key={m.id} className="border rounded-lg overflow-hidden">
                {m.storage_url ? (
                  <img src={m.storage_url} alt={m.alt_text || m.caption || 'Diagram'} className="w-full" loading="lazy" />
                ) : (
                  <div className="bg-gray-100 p-3 text-center text-xs text-gray-500">
                    {isHi ? 'चित्र उपलब्ध नहीं' : 'Image not available'}
                  </div>
                )}
                {m.caption && (
                  <p className="text-xs text-gray-600 p-2">{m.caption}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Content chunks */}
      {grouped.map((group, gi) => (
        <div key={gi} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          {group.topic && (
            <div className="bg-gray-50 px-4 py-2 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-700">{group.topic}</h3>
            </div>
          )}
          <div className="p-4 space-y-3">
            {group.chunks.map((chunk) => (
              <div key={chunk.chunk_id} className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                {chunk.chunk_text}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function groupChunksByTopic(chunks: RAGChunk[]): { topic: string | null; chunks: RAGChunk[] }[] {
  const groups: { topic: string | null; chunks: RAGChunk[] }[] = [];
  let currentTopic: string | null = null;
  let currentGroup: RAGChunk[] = [];

  for (const chunk of chunks) {
    const topic = chunk.topic || chunk.concept || null;
    if (topic !== currentTopic && currentGroup.length > 0) {
      groups.push({ topic: currentTopic, chunks: currentGroup });
      currentGroup = [];
    }
    currentTopic = topic;
    currentGroup.push(chunk);
  }
  if (currentGroup.length > 0) {
    groups.push({ topic: currentTopic, chunks: currentGroup });
  }
  return groups;
}

/* ═══ Q&A TAB ═══ */
function QATab({
  questions, allCount, filter, onFilterChange, expanded, onToggle, reviewedCount, isHi,
}: {
  questions: QAQuestion[];
  allCount: number;
  filter: string;
  onFilterChange: (f: string) => void;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  reviewedCount: number;
  isHi: boolean;
}) {
  const filters = [
    { id: 'all', label: 'All', labelHi: 'सभी' },
    { id: 'ncert_exercise', label: 'Exercise', labelHi: 'अभ्यास' },
    { id: 'ncert_intext', label: 'In-Text', labelHi: 'पाठ में' },
    { id: 'cbse_style', label: 'CBSE Style', labelHi: 'CBSE शैली' },
    { id: 'practice', label: 'Practice', labelHi: 'अभ्यास' },
  ];

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
        {questions.map((q, qi) => {
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
