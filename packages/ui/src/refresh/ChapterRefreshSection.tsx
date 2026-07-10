'use client';

/**
 * Refresh page — Section B "Chapter Refresh".
 *
 * Renders the decayed-chapter stack from /api/learner/revise-stack.
 * Each card shows the chapter title + days since last touch + the
 * recommended modality button (read / explainer / worked-example).
 *
 * Extracted from src/app/revise/page.tsx (2026-05-20). The fetch shape,
 * URL handling, and modality labels are copied verbatim.
 *
 * Auto-hides (renders null) when the stack is empty.
 */

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@alfanumrik/lib/AuthContext';

interface ReviseStackItem {
  subjectCode: string;
  chapterNumber: number;
  mastery: number;
  daysSinceLastTouch: number;
  recommendedModality: 'read' | 'explainer' | 'worked-example';
  url: string;
}

const MODALITY_LABELS: Record<
  ReviseStackItem['recommendedModality'],
  { en: string; hi: string; icon: string; tint: string }
> = {
  'read':            { en: 'Read the chapter',                 hi: 'अध्याय पढ़ो',            icon: '📖', tint: '#6366F1' },
  'explainer':       { en: 'See an explainer',                 hi: 'समझाओ',                 icon: '💡', tint: '#D97706' },
  'worked-example':  { en: 'Walk through a worked example',    hi: 'हल किया उदाहरण देखो',  icon: '✏️', tint: '#16A34A' },
};

const SUBJECT_HI: Record<string, string> = {
  math: 'गणित', mathematics: 'गणित', science: 'विज्ञान',
  physics: 'भौतिकी', chemistry: 'रसायन', biology: 'जीव विज्ञान',
  english: 'अंग्रेज़ी', hindi: 'हिंदी', history: 'इतिहास',
  geography: 'भूगोल', civics: 'नागरिक शास्त्र',
};

function subjectLabel(code: string, isHi: boolean): string {
  if (isHi && SUBJECT_HI[code.toLowerCase()]) return SUBJECT_HI[code.toLowerCase()];
  return code.charAt(0).toUpperCase() + code.slice(1);
}

export default function ChapterRefreshSection() {
  const { student, isHi } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const fromQuizSubject = searchParams.get('subject');
  const fromQuizChapter = searchParams.get('chapter');
  const fromSource = searchParams.get('from');
  const hasDeepLink =
    fromSource === 'quiz' &&
    typeof fromQuizSubject === 'string' && fromQuizSubject.length > 0 &&
    typeof fromQuizChapter === 'string' && /^\d{1,3}$/.test(fromQuizChapter);

  const [items, setItems] = useState<ReviseStackItem[] | null>(null);

  useEffect(() => {
    if (!student) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/learner/revise-stack', { credentials: 'same-origin' });
        if (res.status === 404) {
          if (!cancelled) setItems([]);
          return;
        }
        if (!res.ok) {
          if (!cancelled) setItems([]);
          return;
        }
        const data: { items: ReviseStackItem[] } = await res.json();
        if (!cancelled) setItems(data.items);
      } catch {
        if (!cancelled) setItems([]);
      }
    })();
    return () => { cancelled = true; };
  }, [student]);

  if (items === null) return null;          // loading
  if (!hasDeepLink && items.length === 0) return null;  // empty + no deep link

  return (
    <section data-testid="refresh-section-b" className="space-y-3">
      <header>
        <h2 className="text-base font-bold" style={{ fontFamily: 'var(--font-display)' }}>
          {isHi ? '🔁 अध्याय दोहराओ' : '🔁 Chapter Refresh'}
        </h2>
      </header>

      {hasDeepLink && (
        <div
          data-testid="refresh-from-quiz-card"
          className="rounded-2xl p-4"
          style={{ background: 'rgba(232,88,28,0.06)', border: '1px solid rgba(232,88,28,0.15)' }}
        >
          <p className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--text-3)' }}>
            {isHi ? 'क्विज़ से' : 'From your quiz'}
          </p>
          <p className="font-semibold text-sm">
            {subjectLabel(fromQuizSubject as string, isHi)} · {isHi ? `अध्याय ${fromQuizChapter}` : `Chapter ${fromQuizChapter}`}
          </p>
          <button
            onClick={() => router.push(`/learn/${encodeURIComponent(fromQuizSubject as string)}/${fromQuizChapter}?mode=read&from=refresh`)}
            className="mt-3 w-full py-2.5 rounded-xl text-sm font-bold text-white"
            style={{ background: 'var(--orange, #E8581C)' }}
          >
            📖 {isHi ? 'अध्याय दोबारा पढ़ो' : 'Re-read this chapter'} →
          </button>
        </div>
      )}

      {items.map((item) => {
        const m = MODALITY_LABELS[item.recommendedModality];
        return (
          <div
            key={`${item.subjectCode}-${item.chapterNumber}`}
            data-testid="refresh-stack-card"
            className="rounded-2xl p-4"
            style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
          >
            <div className="flex items-center gap-3 mb-3">
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center text-xl"
                style={{ background: `${m.tint}15`, color: m.tint }}
              >
                {m.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm truncate">
                  {subjectLabel(item.subjectCode, isHi)} · {isHi ? `अध्याय ${item.chapterNumber}` : `Chapter ${item.chapterNumber}`}
                </p>
                <p className="text-xs text-[var(--text-3)] mt-0.5">
                  {isHi
                    ? `${item.daysSinceLastTouch} दिन — पिछली मास्ट्री ${Math.round(item.mastery * 100)}%`
                    : `${item.daysSinceLastTouch} days · was at ${Math.round(item.mastery * 100)}% mastery`}
                </p>
              </div>
            </div>
            <button
              onClick={() => router.push(item.url)}
              className="w-full py-2.5 rounded-xl text-sm font-bold text-white"
              style={{ background: m.tint }}
            >
              {m.icon} {isHi ? m.hi : m.en} →
            </button>
          </div>
        );
      })}
    </section>
  );
}
