'use client';

/**
 * /learn — Subject & Chapter Browser
 *
 * The student mental model is: Subjects → Chapters → Read → Practice → Test.
 * This page IS the "Learn" tab destination. Students pick a subject, see all
 * chapters, and tap any chapter to go to /learn/[subject]/[chapter].
 *
 * Previously "Learn" routed to /study-plan (a plan generator), which was
 * confusing. This page fixes that.
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { getChaptersForSubject } from '@/lib/supabase';
import { BottomNav, LoadingFoxy } from '@/components/ui';
import { SUBJECT_META, getSubjectsForGrade } from '@/lib/constants';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';

export default function LearnPage() {
  const { student, isLoggedIn, isLoading, isHi } = useAuth();
  const router = useRouter();

  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [chapters, setChapters] = useState<Array<{ chapter_number: number; title: string }>>([]);
  const [chaptersLoading, setChaptersLoading] = useState(false);

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/');
  }, [isLoading, isLoggedIn, router]);

  useEffect(() => {
    if (!selectedSubject || !student?.grade) { setChapters([]); return; }
    setChaptersLoading(true);
    getChaptersForSubject(selectedSubject, student.grade)
      .then(setChapters)
      .catch(() => setChapters([]))
      .finally(() => setChaptersLoading(false));
  }, [selectedSubject, student?.grade]);

  if (isLoading || !student) return <LoadingFoxy />;

  const subjects = getSubjectsForGrade(student.grade);
  const selectedMeta = SUBJECT_META.find(s => s.code === selectedSubject);

  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      <header className="page-header">
        <div className="page-header-inner flex items-center gap-3">
          {selectedSubject ? (
            <button
              onClick={() => { setSelectedSubject(null); setChapters([]); }}
              className="text-[var(--text-3)] text-lg"
              aria-label={isHi ? 'वापस जाओ' : 'Back'}
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
              <div className="grid grid-cols-2 gap-3">
                {subjects.map(s => {
                  const isCurrent = student.preferred_subject === s.code;
                  return (
                    <button
                      key={s.code}
                      onClick={() => setSelectedSubject(s.code)}
                      className="rounded-2xl p-4 text-left transition-all active:scale-[0.97]"
                      style={{
                        background: isCurrent ? `${s.color}10` : 'var(--surface-1)',
                        border: `1.5px solid ${isCurrent ? s.color : 'var(--border)'}`,
                        boxShadow: isCurrent ? `0 4px 16px ${s.color}20` : '0 2px 8px rgba(0,0,0,0.04)',
                      }}
                    >
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
                    </button>
                  );
                })}
              </div>
            </div>

          ) : (
            /* ── Chapter List ── */
            <div>
              <p className="text-sm text-[var(--text-3)] mb-4 font-medium">
                {isHi ? 'कौन सा अध्याय पढ़ना है?' : 'Choose a chapter to study'}
              </p>

              {chaptersLoading ? (
                <div className="text-center py-10">
                  <div className="text-3xl animate-float mb-2">📖</div>
                  <p className="text-sm text-[var(--text-3)]">
                    {isHi ? 'अध्याय लोड हो रहे हैं...' : 'Loading chapters...'}
                  </p>
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
                  <button
                    onClick={() => router.push(`/foxy?subject=${selectedSubject}&mode=learn`)}
                    className="px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-all active:scale-95"
                    style={{ background: selectedMeta?.color || 'var(--orange)' }}
                  >
                    🦊 {isHi ? 'Foxy से सीखो' : 'Learn with Foxy'}
                  </button>
                </div>

              ) : (
                <div className="space-y-2">
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
                            background: `${selectedMeta?.color || 'var(--orange)'}12`,
                            color: selectedMeta?.color || 'var(--orange)',
                          }}
                        >
                          {ch.chapter_number}
                        </div>

                        {/* Title */}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>
                            {ch.title}
                          </div>
                          <div className="text-[11px] text-[var(--text-3)] mt-0.5">
                            {isHi
                              ? `अध्याय ${ch.chapter_number} · पढ़ो और समझो`
                              : `Chapter ${ch.chapter_number} · Read & understand`}
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
                          className="text-[10px] font-bold px-3 py-1.5 rounded-lg transition-all active:scale-95"
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
                          className="text-[10px] font-bold px-3 py-1.5 rounded-lg transition-all active:scale-95"
                          style={{
                            background: 'rgba(232,88,28,0.06)',
                            color: 'var(--orange)',
                            border: '1px solid rgba(232,88,28,0.15)',
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

      <BottomNav />
    </div>
  );
}
