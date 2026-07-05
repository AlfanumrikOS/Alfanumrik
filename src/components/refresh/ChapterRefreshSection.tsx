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
 * Phase 8 rebuild: presentation rides Card + Button primitives and
 * token-only colour. The fetch, deep-link parsing, routing targets and
 * every data-testid are UNCHANGED — presentation only.
 *
 * Auto-hides (renders null) when the stack is empty.
 */

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { Card, Button } from '@/components/ui/primitives';

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
  { en: string; hi: string; icon: string; toneVar: string }
> = {
  'read':            { en: 'Read the chapter',                 hi: 'अध्याय पढ़ो',            icon: '📖', toneVar: 'var(--info)' },
  'explainer':       { en: 'See an explainer',                 hi: 'समझाओ',                 icon: '💡', toneVar: 'var(--warning)' },
  'worked-example':  { en: 'Walk through a worked example',    hi: 'हल किया उदाहरण देखो',  icon: '✏️', toneVar: 'var(--success)' },
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
        <h2 className="text-fluid-base font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
          {isHi ? '🔁 अध्याय दोहराओ' : '🔁 Chapter Refresh'}
        </h2>
      </header>

      {hasDeepLink && (
        <Card
          data-testid="refresh-from-quiz-card"
          variant="flat"
          className="p-4"
          style={{
            background: 'color-mix(in srgb, var(--primary) 6%, var(--surface-1))',
            borderColor: 'color-mix(in srgb, var(--primary) 15%, transparent)',
          }}
        >
          <p className="mb-2 text-fluid-2xs font-bold uppercase tracking-widest text-muted-foreground">
            {isHi ? 'क्विज़ से' : 'From your quiz'}
          </p>
          <p className="text-fluid-sm font-semibold text-foreground">
            {subjectLabel(fromQuizSubject as string, isHi)} · {isHi ? `अध्याय ${fromQuizChapter}` : `Chapter ${fromQuizChapter}`}
          </p>
          <Button
            variant="primary"
            fullWidth
            onClick={() => router.push(`/learn/${encodeURIComponent(fromQuizSubject as string)}/${fromQuizChapter}?mode=read&from=refresh`)}
            leadingIcon={<span>📖</span>}
            trailingIcon={<span>→</span>}
            className="mt-3"
          >
            {isHi ? 'अध्याय दोबारा पढ़ो' : 'Re-read this chapter'}
          </Button>
        </Card>
      )}

      {items.map((item) => {
        const m = MODALITY_LABELS[item.recommendedModality];
        return (
          <Card
            key={`${item.subjectCode}-${item.chapterNumber}`}
            data-testid="refresh-stack-card"
            variant="flat"
            className="p-4"
          >
            <div className="mb-3 flex items-center gap-3">
              <div
                className="flex h-11 w-11 items-center justify-center rounded-xl text-fluid-lg"
                style={{
                  background: `color-mix(in srgb, ${m.toneVar} 15%, var(--surface-1))`,
                  color: m.toneVar,
                }}
                aria-hidden="true"
              >
                {m.icon}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-fluid-sm font-semibold text-foreground">
                  {subjectLabel(item.subjectCode, isHi)} · {isHi ? `अध्याय ${item.chapterNumber}` : `Chapter ${item.chapterNumber}`}
                </p>
                <p className="mt-0.5 text-fluid-xs text-muted-foreground">
                  {isHi
                    ? `${item.daysSinceLastTouch} दिन — पिछली मास्ट्री ${Math.round(item.mastery * 100)}%`
                    : `${item.daysSinceLastTouch} days · was at ${Math.round(item.mastery * 100)}% mastery`}
                </p>
              </div>
            </div>
            <Button
              variant="secondary"
              fullWidth
              onClick={() => router.push(item.url)}
              leadingIcon={<span>{m.icon}</span>}
              trailingIcon={<span>→</span>}
              style={{
                backgroundColor: `color-mix(in srgb, ${m.toneVar} 12%, var(--surface-1))`,
                borderColor: `color-mix(in srgb, ${m.toneVar} 34%, transparent)`,
                color: 'var(--text-1)',
              }}
            >
              {isHi ? m.hi : m.en}
            </Button>
          </Card>
        );
      })}
    </section>
  );
}
