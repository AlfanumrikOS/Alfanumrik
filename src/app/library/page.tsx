'use client';

/**
 * /library — NCERT Library (browse-first content discovery)
 *
 * Different from /learn (progress-tracked study flow). Library lets students
 * browse all available NCERT content freely with no progress pressure.
 *
 * Structure:
 *   1. Header with grade context + back arrow
 *   2. Recently explored strip (localStorage, optional)
 *   3. Subject tabs (horizontally scrollable)
 *   4. Chapter grid for selected subject
 *
 * Data layer reuses the exact same hooks as /learn:
 *   - useAllowedSubjects()  → subject list (plan + grade gated)
 *   - useAllowedChapters()  → chapter list for selected subject
 *
 * Routing for chapter detail: /learn/[subject]/[chapter] (existing page).
 */

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { useAllowedSubjects } from '@/lib/useAllowedSubjects';
import { useAllowedChapters } from '@/lib/useAllowedChapters';
import { LoadingFoxy } from '@/components/ui';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';

// ─── Local types ─────────────────────────────────────────────────────────────

interface RecentChapter {
  subject: string;
  subjectName: string;
  chapter: number;
  chapterTitle: string;
  viewedAt: number;
}

// ─── Recently-explored strip ──────────────────────────────────────────────────

function RecentlyExplored({
  items,
  isHi,
  onSelect,
}: {
  items: RecentChapter[];
  isHi: boolean;
  onSelect: (subject: string, chapter: number) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-base">📖</span>
        <h2 className="text-sm font-bold" style={{ color: 'var(--text-2)' }}>
          {isHi ? 'हाल ही में पढ़ा' : 'Recently explored'}
        </h2>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
        {items.map((item) => (
          <button
            key={`${item.subject}-${item.chapter}`}
            onClick={() => onSelect(item.subject, item.chapter)}
            className="flex-shrink-0 rounded-xl px-3 py-2.5 text-left transition-all active:scale-[0.97] min-w-[140px] max-w-[200px]"
            style={{
              background: 'var(--surface-1)',
              border: '1px solid var(--border)',
              boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
            }}
          >
            <div className="text-[10px] font-semibold text-orange-500 truncate mb-0.5">
              {item.subjectName}
            </div>
            <div className="text-xs font-medium truncate" style={{ color: 'var(--text-1)' }}>
              {item.chapterTitle}
            </div>
            <div className="text-[9px] mt-1" style={{ color: 'var(--text-3)' }}>
              {isHi ? `अध्याय ${item.chapter}` : `Ch ${item.chapter}`} →
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Subject tabs ─────────────────────────────────────────────────────────────

function SubjectTabs({
  subjects,
  selectedCode,
  onSelect,
}: {
  subjects: Array<{ code: string; name: string; nameHi: string; icon: string; color: string; isLocked: boolean }>;
  selectedCode: string | null;
  onSelect: (code: string) => void;
}) {
  const tabBarRef = useRef<HTMLDivElement>(null);

  // Scroll selected tab into view
  useEffect(() => {
    if (!selectedCode || !tabBarRef.current) return;
    const btn = tabBarRef.current.querySelector(`[data-code="${selectedCode}"]`) as HTMLElement | null;
    if (btn) btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [selectedCode]);

  return (
    <div
      ref={tabBarRef}
      className="flex gap-2 overflow-x-auto pb-2 no-scrollbar"
      role="tablist"
      aria-label="Subjects"
    >
      {subjects.map((s) => {
        const isSelected = s.code === selectedCode;
        return (
          <button
            key={s.code}
            data-code={s.code}
            role="tab"
            aria-selected={isSelected}
            onClick={() => !s.isLocked && onSelect(s.code)}
            className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all active:scale-[0.96]"
            style={
              isSelected
                ? {
                    background: s.color || 'var(--orange)',
                    color: '#fff',
                    boxShadow: `0 4px 12px ${s.color || 'var(--orange)'}40`,
                    border: '1.5px solid transparent',
                  }
                : {
                    background: 'var(--surface-1)',
                    color: s.isLocked ? 'var(--text-3)' : 'var(--text-2)',
                    border: '1.5px solid var(--border)',
                    opacity: s.isLocked ? 0.55 : 1,
                  }
            }
          >
            <span>{s.icon}</span>
            <span>{s.name}</span>
            {s.isLocked && <span>🔒</span>}
          </button>
        );
      })}
    </div>
  );
}

// ─── Chapter grid ─────────────────────────────────────────────────────────────

function ChapterGrid({
  subjectCode,
  subjectColor,
  subjectName,
  isHi,
  onChapterClick,
}: {
  subjectCode: string;
  subjectColor: string;
  subjectName: string;
  isHi: boolean;
  onChapterClick: (chapter: number, title: string, titleHi: string | null) => void;
}) {
  const { chapters, isLoading } = useAllowedChapters(subjectCode);
  const router = useRouter();

  if (isLoading) {
    return (
      <div className="text-center py-12">
        <div className="text-3xl animate-float mb-2">📚</div>
        <p className="text-sm" style={{ color: 'var(--text-3)' }}>
          {isHi ? 'अध्याय लोड हो रहे हैं...' : 'Loading chapters…'}
        </p>
      </div>
    );
  }

  if (chapters.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="text-5xl mb-3">🔍</div>
        <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-2)' }}>
          {isHi ? 'अभी कोई अध्याय उपलब्ध नहीं' : 'No chapters available yet'}
        </p>
        <p className="text-xs mb-5" style={{ color: 'var(--text-3)' }}>
          {isHi
            ? 'इस विषय का कंटेंट जल्द आ रहा है'
            : 'Content coming soon for this subject'}
        </p>
        <button
          onClick={() => router.push(`/foxy?subject=${subjectCode}&mode=learn`)}
          className="px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-all active:scale-95"
          style={{ background: subjectColor || 'var(--orange)' }}
        >
          🦊 {isHi ? 'Foxy से सीखो' : 'Learn with Foxy'}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <p className="text-xs font-medium mb-3" style={{ color: 'var(--text-3)' }}>
        {isHi
          ? `${chapters.length} अध्याय उपलब्ध`
          : `${chapters.length} chapter${chapters.length !== 1 ? 's' : ''} available`}
      </p>
      {chapters.map((ch) => {
        const displayTitle = (isHi && ch.title_hi) ? ch.title_hi : ch.title;
        const hasQuestions =
          (ch.verified_question_count ?? 0) > 0 || (ch.total_questions ?? 0) > 0;
        const questionCount = ch.verified_question_count ?? ch.total_questions ?? 0;

        return (
          <button
            key={ch.chapter_number}
            onClick={() => onChapterClick(ch.chapter_number, ch.title, ch.title_hi ?? null)}
            className="w-full rounded-2xl p-4 flex items-center gap-4 text-left transition-all active:scale-[0.98]"
            style={{
              background: 'var(--surface-1)',
              border: '1px solid var(--border)',
              boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
            }}
          >
            {/* Chapter number badge */}
            <div
              className="w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
              style={{
                background: `${subjectColor || 'var(--orange)'}15`,
                color: subjectColor || 'var(--orange)',
                border: `1.5px solid ${subjectColor || 'var(--orange)'}25`,
              }}
            >
              {ch.chapter_number}
            </div>

            {/* Text */}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold leading-snug" style={{ color: 'var(--text-1)' }}>
                {displayTitle}
              </div>
              <div className="text-[11px] mt-0.5 flex items-center gap-2 flex-wrap" style={{ color: 'var(--text-3)' }}>
                <span>
                  {isHi ? `अध्याय ${ch.chapter_number}` : `Chapter ${ch.chapter_number}`}
                </span>
                {hasQuestions && (
                  <>
                    <span>·</span>
                    <span>
                      {questionCount} {isHi ? 'प्रश्न' : 'questions'}
                    </span>
                  </>
                )}
                {ch.has_concepts && (
                  <>
                    <span>·</span>
                    <span className="font-medium text-orange-500">
                      {isHi ? 'अवधारणाएं ✓' : 'Concepts ✓'}
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Arrow */}
            <span className="flex-shrink-0 text-base" style={{ color: 'var(--text-3)' }}>→</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LibraryPage() {
  const { student, isLoggedIn, isLoading, isHi } = useAuth();
  const { subjects: allSubjects, unlocked: allowedSubjects } = useAllowedSubjects();
  const router = useRouter();

  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [recentChapters, setRecentChapters] = useState<RecentChapter[]>([]);

  // Auth guard
  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/login');
    if (!isLoading && isLoggedIn && student && !student.onboarding_completed)
      router.replace('/onboarding');
  }, [isLoading, isLoggedIn, student, router]);

  // Auto-select first subject once data arrives
  useEffect(() => {
    if (selectedSubject === null && allowedSubjects.length > 0) {
      setSelectedSubject(allowedSubjects[0].code);
    }
  }, [allowedSubjects, selectedSubject]);

  // Load recently-viewed chapters from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem('recently_viewed_chapters');
      if (!raw) return;
      const parsed = JSON.parse(raw) as RecentChapter[];
      // Keep at most 5 most recent
      const sorted = parsed
        .filter((r) => Date.now() - r.viewedAt < 14 * 24 * 60 * 60 * 1000)
        .sort((a, b) => b.viewedAt - a.viewedAt)
        .slice(0, 5);
      setRecentChapters(sorted);
    } catch { /* ignore */ }
  }, []);

  const handleChapterClick = (subjectCode: string, chapterNumber: number, title: string, titleHi: string | null) => {
    // Persist to recently-viewed in localStorage
    try {
      const raw = localStorage.getItem('recently_viewed_chapters');
      const existing: RecentChapter[] = raw ? JSON.parse(raw) : [];
      const subjectMeta = allSubjects.find((s) => s.code === subjectCode);
      const updated: RecentChapter[] = [
        {
          subject: subjectCode,
          subjectName: subjectMeta?.name ?? subjectCode,
          chapter: chapterNumber,
          chapterTitle: title,
          viewedAt: Date.now(),
        },
        ...existing.filter(
          (r) => !(r.subject === subjectCode && r.chapter === chapterNumber)
        ),
      ].slice(0, 10);
      localStorage.setItem('recently_viewed_chapters', JSON.stringify(updated));
    } catch { /* non-critical */ }

    router.push(`/learn/${subjectCode}/${chapterNumber}`);
  };

  if (isLoading || !student) return <LoadingFoxy />;

  const selectedMeta = allSubjects.find((s) => s.code === selectedSubject);

  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      {/* ── Header ── */}
      <header className="page-header">
        <div className="page-header-inner flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="text-lg transition-colors"
            style={{ color: 'var(--text-3)' }}
            aria-label={isHi ? 'वापस जाओ' : 'Go back'}
          >
            ←
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-bold leading-tight" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}>
              {isHi ? '📚 NCERT पुस्तकालय' : '📚 NCERT Library'}
            </h1>
            <p className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--text-3)' }}>
              {isHi
                ? `कक्षा ${student.grade} के सभी अध्याय देखें`
                : `Browse all chapters for Grade ${student.grade}`}
            </p>
          </div>
        </div>
      </header>

      <main className="app-container py-4 max-w-2xl mx-auto">
        <SectionErrorBoundary section="Library">

          {/* ── Recently explored ── */}
          <RecentlyExplored
            items={recentChapters}
            isHi={isHi}
            onSelect={(subject, chapter) => {
              const meta = allSubjects.find((s) => s.code === subject);
              if (meta) {
                handleChapterClick(subject, chapter, '', null);
              } else {
                router.push(`/learn/${subject}/${chapter}`);
              }
            }}
          />

          {/* ── Subject tabs ── */}
          {allSubjects.length > 0 && (
            <div className="mb-4">
              <SubjectTabs
                subjects={allSubjects}
                selectedCode={selectedSubject}
                onSelect={(code) => {
                  const s = allSubjects.find((sub) => sub.code === code);
                  if (s?.isLocked) {
                    router.push('/pricing');
                    return;
                  }
                  setSelectedSubject(code);
                }}
              />
            </div>
          )}

          {/* ── Chapter grid ── */}
          {selectedSubject && (
            <div
              className="rounded-2xl p-4"
              style={{
                background: 'var(--surface-2, var(--surface-1))',
                border: '1px solid var(--border)',
              }}
            >
              {/* Subject header row */}
              {selectedMeta && (
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-2xl">{selectedMeta.icon}</span>
                  <div>
                    <div className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>
                      {isHi ? selectedMeta.nameHi : selectedMeta.name}
                    </div>
                    <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                      {isHi ? 'NCERT अध्याय' : 'NCERT chapters'} · {isHi ? `कक्षा ${student.grade}` : `Grade ${student.grade}`}
                    </div>
                  </div>
                </div>
              )}

              <ChapterGrid
                subjectCode={selectedSubject}
                subjectColor={selectedMeta?.color ?? 'var(--orange)'}
                subjectName={
                  isHi
                    ? (selectedMeta?.nameHi ?? selectedMeta?.name ?? selectedSubject)
                    : (selectedMeta?.name ?? selectedSubject)
                }
                isHi={isHi}
                onChapterClick={(chapterNumber, title, titleHi) =>
                  handleChapterClick(selectedSubject, chapterNumber, title, titleHi)
                }
              />
            </div>
          )}

          {/* Empty state if no subjects at all */}
          {!isLoading && allSubjects.length === 0 && (
            <div className="text-center py-16">
              <div className="text-5xl mb-3">📭</div>
              <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-2)' }}>
                {isHi ? 'कोई विषय उपलब्ध नहीं' : 'No subjects available'}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                {isHi ? 'प्रोफ़ाइल में अपनी कक्षा जोड़ें' : 'Add your grade in profile settings'}
              </p>
            </div>
          )}

        </SectionErrorBoundary>
      </main>
    </div>
  );
}
