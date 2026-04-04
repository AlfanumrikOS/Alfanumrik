'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import { GRADE_SUBJECTS, SUBJECT_META } from '@/lib/constants';
import { Card, MasteryRing, ProgressBar, BottomNav, EmptyState, Button } from '@/components/ui';
import { DashboardSkeleton } from '@/components/Skeleton';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';
import type { CurriculumTopic } from '@/lib/types';

/* ── Types ── */
interface ChapterGroup {
  chapter_number: number;
  title: string;
  title_hi: string | null;
  topics: CurriculumTopic[];
}

interface TopicMasteryRow {
  topic_id?: string;
  topic_tag?: string;
  chapter_number?: number | null;
  mastery_probability?: number;
  mastery_level?: string;
}

/* ── Helpers ── */
function getSubjectMeta(code: string) {
  return SUBJECT_META.find(s => s.code === code);
}

function getMasteryColor(pct: number): string {
  if (pct >= 95) return '#F5A623';
  if (pct >= 70) return '#16A34A';
  if (pct >= 40) return '#0891B2';
  if (pct > 0) return '#FF9800';
  return '#9C8E78';
}

function getMasteryLabel(pct: number, isHi: boolean): string {
  if (pct >= 95) return isHi ? 'महारत' : 'Mastered';
  if (pct >= 70) return isHi ? 'कुशल' : 'Proficient';
  if (pct >= 40) return isHi ? 'परिचित' : 'Familiar';
  if (pct > 0) return isHi ? 'विकासशील' : 'Developing';
  return isHi ? 'शुरू नहीं' : 'Not Started';
}

/* ══════════════════════════════════════════════════════════════
   LEARN PAGE — Chapter & Topic Browser
   Lets students browse CBSE curriculum by subject > chapter > topic
   ══════════════════════════════════════════════════════════════ */

export default function LearnPage() {
  const { student, isLoggedIn, isLoading: authLoading, isHi } = useAuth();
  const router = useRouter();

  // State
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [chapters, setChapters] = useState<ChapterGroup[]>([]);
  const [expandedChapter, setExpandedChapter] = useState<number | null>(null);
  const [mastery, setMastery] = useState<TopicMasteryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastStudied, setLastStudied] = useState<{ subject: string; chapter: number; chapterTitle: string; concept: number; timestamp: number } | null>(null);

  // Redirect if not logged in
  useEffect(() => {
    if (!authLoading && !isLoggedIn) router.replace('/login');
  }, [authLoading, isLoggedIn, router]);

  // Grade subjects
  const gradeSubjects = useMemo(() => {
    if (!student) return [];
    const gradeKey = (student.grade || '9').replace('Grade ', '').trim();
    const codes = GRADE_SUBJECTS[gradeKey] || GRADE_SUBJECTS['9'];
    return SUBJECT_META.filter(s => codes.includes(s.code));
  }, [student]);

  // Auto-select preferred subject
  useEffect(() => {
    if (student && !selectedSubject && gradeSubjects.length > 0) {
      const preferred = gradeSubjects.find(s => s.code === student.preferred_subject);
      setSelectedSubject(preferred?.code || gradeSubjects[0].code);
    }
  }, [student, selectedSubject, gradeSubjects]);

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

  // Fetch chapters + topics when subject changes
  const loadChapters = useCallback(async () => {
    if (!student || !selectedSubject) return;
    setLoading(true);
    setError(null);
    setExpandedChapter(null);

    try {
      // Look up subject UUID
      const { data: subjectRow } = await supabase
        .from('subjects')
        .select('id')
        .eq('code', selectedSubject)
        .eq('is_active', true)
        .single();

      // Query curriculum_topics
      let query = supabase
        .from('curriculum_topics')
        .select('*')
        .eq('is_active', true)
        .order('chapter_number')
        .order('display_order')
        .limit(200);

      // Grade filter — handle both "9" and "Grade 9" formats
      const grade = student.grade || '9';
      query = query.or(`grade.eq.Grade ${grade},grade.eq.${grade}`);

      if (subjectRow?.id) {
        query = query.eq('subject_id', subjectRow.id);
      }

      const { data: topicsData, error: topicsError } = await query;
      if (topicsError) throw topicsError;

      // Group by chapter_number
      const chapterMap = new Map<number, ChapterGroup>();
      for (const topic of (topicsData ?? []) as CurriculumTopic[]) {
        const chNum = topic.chapter_number ?? 0;
        if (!chapterMap.has(chNum)) {
          chapterMap.set(chNum, {
            chapter_number: chNum,
            title: topic.title,
            title_hi: topic.title_hi,
            topics: [],
          });
        }
        chapterMap.get(chNum)!.topics.push(topic);
      }

      // Sort by chapter number and set first topic as chapter title
      const sorted = Array.from(chapterMap.values()).sort(
        (a, b) => a.chapter_number - b.chapter_number
      );

      setChapters(sorted);

      // Fetch mastery data for this subject
      const { data: masteryData } = await supabase
        .from('concept_mastery')
        .select('topic_id, mastery_probability, mastery_level')
        .eq('student_id', student.id)
        .order('updated_at', { ascending: false });

      setMastery((masteryData ?? []) as TopicMasteryRow[]);
    } catch (e) {
      console.error('Load chapters error:', e);
      setError(isHi ? 'अध्याय लोड नहीं हो पाए' : 'Could not load chapters');
    }

    setLoading(false);
  }, [student, selectedSubject, isHi]);

  useEffect(() => {
    loadChapters();
  }, [loadChapters]);

  // Get mastery for a topic
  const getTopicMastery = useCallback(
    (topicId: string): number => {
      const m = mastery.find(row => row.topic_id === topicId);
      return m?.mastery_probability ? Math.round(m.mastery_probability * 100) : 0;
    },
    [mastery]
  );

  // Chapter-level mastery average
  const getChapterMastery = useCallback(
    (topics: CurriculumTopic[]): number => {
      if (topics.length === 0) return 0;
      const total = topics.reduce((sum, t) => sum + getTopicMastery(t.id), 0);
      return Math.round(total / topics.length);
    },
    [getTopicMastery]
  );

  // Loading state
  if (authLoading) return <DashboardSkeleton />;
  if (!student) return <DashboardSkeleton />;

  const subjectMeta = selectedSubject ? getSubjectMeta(selectedSubject) : null;

  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      {/* ── Header ── */}
      <header className="page-header">
        <div className="page-header-inner flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/dashboard')}
              className="p-2 -ml-2 rounded-xl transition-all active:scale-90"
              aria-label={isHi ? 'वापस जाओ' : 'Go back'}
            >
              <span className="text-lg">&larr;</span>
            </button>
            <div>
              <h1
                className="text-lg font-bold"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {isHi ? 'पाठ्यक्रम' : 'Chapters'}
              </h1>
              <p className="text-xs text-[var(--text-3)]">
                {isHi
                  ? `कक्षा ${student.grade} - CBSE`
                  : `Grade ${student.grade} - CBSE`}
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="app-container py-4 space-y-4">
        <SectionErrorBoundary section="Learn">
          {/* ═══ SUBJECT SELECTOR — horizontal scroll pills ═══ */}
          <div className="overflow-x-auto -mx-4 px-4 scrollbar-hide">
            <div className="flex gap-2 pb-1" role="tablist" aria-label={isHi ? 'विषय चुनें' : 'Select subject'}>
              {gradeSubjects.map(s => {
                const active = s.code === selectedSubject;
                return (
                  <button
                    key={s.code}
                    onClick={() => setSelectedSubject(s.code)}
                    role="tab"
                    aria-selected={active}
                    className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold transition-all active:scale-[0.97]"
                    style={{
                      background: active ? `${s.color}15` : 'var(--surface-1)',
                      border: `1.5px solid ${active ? s.color : 'var(--border)'}`,
                      color: active ? s.color : 'var(--text-2)',
                    }}
                  >
                    <span>{s.icon}</span>
                    <span className="whitespace-nowrap">{s.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ═══ CONTINUE WHERE YOU LEFT OFF ═══ */}
          {lastStudied && lastStudied.subject === selectedSubject && (
            <button
              onClick={() => router.push(`/learn/${lastStudied.subject}/${lastStudied.chapter}`)}
              className="w-full rounded-xl p-4 mb-4 flex items-center gap-3 transition-all active:scale-[0.98]"
              style={{
                background: 'linear-gradient(135deg, rgba(232,88,28,0.06), rgba(245,166,35,0.06))',
                border: '1px solid rgba(232,88,28,0.15)',
              }}
            >
              <span className="text-xl">📖</span>
              <div className="flex-1 min-w-0 text-left">
                <div className="text-xs text-orange-600 font-semibold">
                  {isHi ? 'जहां छोड़ा था वहीं से शुरू करो' : 'Continue where you left off'}
                </div>
                <div className="text-sm font-medium text-gray-800 truncate mt-0.5">
                  {lastStudied.chapterTitle}
                </div>
                <div className="text-[10px] text-gray-400 mt-0.5">
                  {isHi ? `अवधारणा ${lastStudied.concept + 1}` : `Concept ${lastStudied.concept + 1}`}
                </div>
              </div>
              <span className="text-gray-400">→</span>
            </button>
          )}

          {/* ═══ LOADING ═══ */}
          {loading && (
            <div className="space-y-3">
              {[1, 2, 3, 4].map(i => (
                <div
                  key={i}
                  className="rounded-2xl p-4 animate-shimmer"
                  style={{
                    background: 'linear-gradient(90deg, var(--surface-2) 25%, var(--surface-3) 50%, var(--surface-2) 75%)',
                    backgroundSize: '200% 100%',
                    height: 72,
                  }}
                />
              ))}
            </div>
          )}

          {/* ═══ ERROR ═══ */}
          {error && !loading && (
            <Card>
              <div className="text-center py-6">
                <span className="text-3xl mb-3 block">&#x26A0;</span>
                <p className="text-sm font-semibold" style={{ color: '#DC2626' }}>
                  {error}
                </p>
                <Button
                  variant="soft"
                  size="sm"
                  onClick={loadChapters}
                  className="mt-3"
                >
                  {isHi ? 'फिर से कोशिश करो' : 'Try again'}
                </Button>
              </div>
            </Card>
          )}

          {/* ═══ EMPTY ═══ */}
          {!loading && !error && chapters.length === 0 && selectedSubject && (
            <EmptyState
              icon="📖"
              title={isHi ? 'कोई अध्याय नहीं मिला' : 'No chapters found'}
              description={
                isHi
                  ? 'इस विषय के लिए अभी तक अध्याय उपलब्ध नहीं हैं'
                  : 'Chapters for this subject are not available yet'
              }
              action={
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => router.push('/foxy')}
                >
                  {isHi ? 'Foxy से पूछो' : 'Ask Foxy instead'}
                </Button>
              }
            />
          )}

          {/* ═══ CHAPTER LIST ═══ */}
          {!loading && !error && chapters.length > 0 && (
            <div className="space-y-2">
              {chapters.map(chapter => {
                const expanded = expandedChapter === chapter.chapter_number;
                const chapterMastery = getChapterMastery(chapter.topics);
                const masteryColor = getMasteryColor(chapterMastery);
                const topicCount = chapter.topics.length;

                return (
                  <div key={chapter.chapter_number}>
                    {/* Chapter Card */}
                    <button
                      onClick={() =>
                        setExpandedChapter(expanded ? null : chapter.chapter_number)
                      }
                      className="w-full rounded-2xl p-4 flex items-center gap-3 transition-all active:scale-[0.98]"
                      style={{
                        background: expanded
                          ? `${subjectMeta?.color || 'var(--orange)'}06`
                          : 'var(--surface-1)',
                        border: `1.5px solid ${
                          expanded
                            ? subjectMeta?.color || 'var(--orange)'
                            : 'var(--border)'
                        }`,
                      }}
                      aria-expanded={expanded}
                    >
                      {/* Mastery Ring */}
                      <MasteryRing
                        value={chapterMastery}
                        size={44}
                        strokeWidth={3}
                        color={masteryColor}
                      >
                        <span
                          className="text-xs font-bold"
                          style={{ color: masteryColor }}
                        >
                          {chapter.chapter_number}
                        </span>
                      </MasteryRing>

                      {/* Title */}
                      <div className="flex-1 min-w-0 text-left">
                        <div className="text-sm font-semibold truncate">
                          {isHi && chapter.title_hi
                            ? chapter.title_hi
                            : chapter.title}
                        </div>
                        <div className="text-xs text-[var(--text-3)] mt-0.5">
                          {topicCount}{' '}
                          {isHi
                            ? topicCount === 1
                              ? 'टॉपिक'
                              : 'टॉपिक्स'
                            : topicCount === 1
                            ? 'topic'
                            : 'topics'}
                          {chapterMastery > 0 && (
                            <>
                              {' '}
                              &middot;{' '}
                              <span style={{ color: masteryColor }}>
                                {getMasteryLabel(chapterMastery, isHi)}
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Expand indicator */}
                      <span
                        className="text-sm transition-transform"
                        style={{
                          transform: expanded ? 'rotate(90deg)' : 'rotate(0)',
                          color: 'var(--text-3)',
                        }}
                      >
                        &#x203A;
                      </span>
                    </button>

                    {/* ── Expanded: Topic List ── */}
                    {expanded && (
                      <div
                        className="ml-4 pl-4 mt-1 mb-2 space-y-1 border-l-2"
                        style={{
                          borderColor: `${subjectMeta?.color || 'var(--orange)'}30`,
                        }}
                      >
                        {/* Open Chapter Detail Page */}
                        <button
                          onClick={() =>
                            router.push(
                              `/learn/${selectedSubject}/${chapter.chapter_number}`
                            )
                          }
                          className="w-full rounded-xl p-3 flex items-center gap-3 transition-all active:scale-[0.98]"
                          style={{
                            background: 'linear-gradient(135deg, #FFF7ED, #FEF3E2)',
                            border: '1px solid rgba(232,88,28,0.15)',
                          }}
                        >
                          <span className="text-lg">📖</span>
                          <div className="flex-1 text-left">
                            <div className="text-sm font-semibold" style={{ color: 'var(--orange)' }}>
                              {isHi ? 'अध्याय खोलें' : 'Open Chapter'}
                            </div>
                            <div className="text-[10px] text-[var(--text-3)]">
                              {isHi ? 'सीखें • प्रश्न-उत्तर • क्विज़ • फॉक्सी' : 'Learn • Q&A • Quiz • Foxy'}
                            </div>
                          </div>
                          <span className="text-sm" style={{ color: 'var(--orange)' }}>&#x203A;</span>
                        </button>

                        {chapter.topics.map(topic => {
                          const topicMastery = getTopicMastery(topic.id);
                          const tColor = getMasteryColor(topicMastery);

                          return (
                            <div
                              key={topic.id}
                              className="rounded-xl p-3 flex items-center gap-3"
                              style={{ background: 'var(--surface-1)' }}
                            >
                              {/* Topic mastery indicator */}
                              <div
                                className="w-2 h-2 rounded-full flex-shrink-0"
                                style={{ background: tColor }}
                              />

                              {/* Topic info */}
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium truncate">
                                  {isHi && topic.title_hi
                                    ? topic.title_hi
                                    : topic.title}
                                </div>
                                <div className="flex items-center gap-2 mt-0.5">
                                  {topic.bloom_focus && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-md font-medium"
                                      style={{
                                        background: 'var(--surface-2)',
                                        color: 'var(--text-3)',
                                      }}
                                    >
                                      {topic.bloom_focus}
                                    </span>
                                  )}
                                  {topic.estimated_minutes && (
                                    <span className="text-[10px] text-[var(--text-3)]">
                                      ~{topic.estimated_minutes}{' '}
                                      {isHi ? 'मिनट' : 'min'}
                                    </span>
                                  )}
                                  {topicMastery > 0 && (
                                    <span
                                      className="text-[10px] font-semibold"
                                      style={{ color: tColor }}
                                    >
                                      {topicMastery}%
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Action buttons */}
                              <div className="flex gap-1.5 flex-shrink-0">
                                <button
                                  onClick={() =>
                                    router.push(
                                      `/foxy?topic=${encodeURIComponent(
                                        topic.title
                                      )}&subject=${selectedSubject}`
                                    )
                                  }
                                  className="px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95"
                                  style={{
                                    background:
                                      'linear-gradient(135deg, #FFF7ED, #FEF3E2)',
                                    border: '1px solid rgba(232,88,28,0.15)',
                                    color: 'var(--orange)',
                                  }}
                                  title={isHi ? 'Foxy से सीखो' : 'Learn with Foxy'}
                                >
                                  {isHi ? '🦊 सीखो' : '🦊 Learn'}
                                </button>
                                <button
                                  onClick={() =>
                                    router.push(
                                      `/quiz?subject=${selectedSubject}&chapter=${chapter.chapter_number}`
                                    )
                                  }
                                  className="px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95"
                                  style={{
                                    background: 'var(--surface-2)',
                                    color: 'var(--text-2)',
                                  }}
                                  title={isHi ? 'क्विज़ लो' : 'Take quiz'}
                                >
                                  {isHi ? '⚡ क्विज़' : '⚡ Quiz'}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ═══ OVERALL SUBJECT PROGRESS ═══ */}
          {!loading && !error && chapters.length > 0 && (
            <Card className="mt-4">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-xl">{subjectMeta?.icon}</span>
                <div>
                  <div className="text-sm font-bold">
                    {isHi ? 'विषय प्रगति' : 'Subject Progress'}
                  </div>
                  <div className="text-xs text-[var(--text-3)]">
                    {chapters.length} {isHi ? 'अध्याय' : 'chapters'} &middot;{' '}
                    {chapters.reduce((s, c) => s + c.topics.length, 0)}{' '}
                    {isHi ? 'टॉपिक्स' : 'topics'}
                  </div>
                </div>
              </div>
              <ProgressBar
                value={
                  chapters.length > 0
                    ? Math.round(
                        chapters.reduce(
                          (sum, c) => sum + getChapterMastery(c.topics),
                          0
                        ) / chapters.length
                      )
                    : 0
                }
                color={subjectMeta?.color || 'var(--orange)'}
                height={8}
                showPercent
              />
            </Card>
          )}
        </SectionErrorBoundary>
      </main>

      <BottomNav />
    </div>
  );
}
