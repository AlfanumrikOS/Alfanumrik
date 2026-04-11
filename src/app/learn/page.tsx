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

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { getChaptersForSubject } from '@/lib/supabase';
import { BottomNav, LoadingFoxy } from '@/components/ui';
import { SUBJECT_META, getSubjectsForGrade } from '@/lib/constants';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';
import { getPlanConfig } from '@/lib/plans';

// Number of subjects unlocked per plan tier.
// tier 2+ (pro/unlimited) = unlimited (Infinity).
const SUBJECT_LIMIT_BY_TIER: Record<number, number> = {
  0: 2, // free
  1: 4, // starter
};

export default function LearnPage() {
  const { student, isLoggedIn, isLoading, isHi } = useAuth();
  const router = useRouter();

  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [chapters, setChapters] = useState<Array<{ chapter_number: number; title: string }>>([]);
  const [chaptersLoading, setChaptersLoading] = useState(false);
  const [lastStudied, setLastStudied] = useState<{ subject: string; chapter: number; chapterTitle: string; concept: number; timestamp: number } | null>(null);

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
    if (!selectedSubject || !student?.grade) { setChapters([]); return; }
    setChaptersLoading(true);
    getChaptersForSubject(selectedSubject, student.grade)
      .then(setChapters)
      .catch(() => setChapters([]))
      .finally(() => setChaptersLoading(false));
  }, [selectedSubject, student?.grade]);

  if (isLoading || !student) return <LoadingFoxy />;

  const allSubjects = getSubjectsForGrade(student.grade);
  const plan = getPlanConfig(student.subscription_plan);
  const subjectLimit = SUBJECT_LIMIT_BY_TIER[plan.tier] ?? Infinity;
  const allowedSubjects = subjectLimit === Infinity ? allSubjects : allSubjects.slice(0, subjectLimit);
  const lockedSubjects = subjectLimit === Infinity ? [] : allSubjects.slice(subjectLimit);

  const selectedMeta = SUBJECT_META.find(s => s.code === selectedSubject);

  // Guard: if selected subject is locked, reset selection
  if (selectedSubject && lockedSubjects.find(s => s.code === selectedSubject)) {
    setSelectedSubject(null);
  }

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

                {/* ── Unlocked subjects ── */}
                {allowedSubjects.map(s => {
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

                {/* ── Locked subjects ── */}
                {lockedSubjects.map(s => (
                  <button
                    key={s.code}
                    onClick={() => router.push('/pricing')}
                    className="rounded-2xl p-4 text-left transition-all active:scale-[0.97] relative overflow-hidden"
                    style={{
                      background: 'var(--surface-1)',
                      border: '1.5px solid var(--border)',
                      opacity: 0.55,
                    }}
                  >
                    {/* Lock badge */}
                    <div
                      className="absolute top-2 right-2 text-[10px] font-bold px-1.5 py-0.5 rounded-md"
                      style={{ background: 'rgba(0,0,0,0.08)', color: 'var(--text-3)' }}
                    >
                      🔒
                    </div>
                    <div className="text-3xl mb-2 grayscale">{s.icon}</div>
                    <div className="text-sm font-bold" style={{ color: 'var(--text-2)' }}>
                      {s.name}
                    </div>
                    <div className="text-[10px] font-semibold mt-1" style={{ color: 'var(--orange)' }}>
                      {isHi
                        ? `${plan.nextPlanLabel?.replace(' →', '') || 'अपग्रेड करो'} →`
                        : `Upgrade to unlock →`}
                    </div>
                  </button>
                ))}

              </div>

              {/* Upgrade prompt strip — only shown when there are locked subjects */}
              {lockedSubjects.length > 0 && (
                <button
                  onClick={() => router.push('/pricing')}
                  className="w-full mt-4 py-3 px-4 rounded-2xl text-sm font-bold flex items-center justify-between transition-all active:scale-[0.98]"
                  style={{
                    background: 'linear-gradient(135deg, rgba(232,88,28,0.08), rgba(245,158,11,0.08))',
                    border: '1.5px solid rgba(232,88,28,0.2)',
                    color: 'var(--orange)',
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

          ) : (
            /* ── Chapter List ── */
            <div>
              <p className="text-sm text-[var(--text-3)] mb-4 font-medium">
                {isHi ? 'कौन सा अध्याय पढ़ना है?' : 'Choose a chapter to study'}
              </p>

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
