# Study Section Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the student sidebar's four-page "REVIEW" group with three honest destinations (Library + Refresh + Exam Sprint) under a renamed "STUDY" group, behind feature flag `ff_study_menu_v2`, while preserving all SM-2, revise-stack, and study-plan engine code.

**Architecture:** Build new routes `/refresh` and `/exam-prep` next to the existing `/review`, `/revise`, `/study-plan` (no replacement until the flag is ON). Add one new API route `POST /api/learner/cards/create` for the "Build Your Own Deck" affordance. Sweep internal references, add 301 redirects in `next.config.js`, then delete old route files. One flag gates the whole rollout.

**Tech Stack:** Next.js 16 App Router (`src/app/`), React 18, Tailwind, SWR, Supabase (`spaced_repetition_cards`, `retention_tests`, `study_plans`, `upcoming_exams`, `feature_flags` tables), `authorizeRequest` from `src/lib/rbac.ts`, `publishEvent` from `src/lib/state/events/publish.ts`, Vitest for unit tests, Playwright for E2E.

**Companion spec:** [docs/superpowers/specs/2026-05-20-study-section-consolidation-design.md](../specs/2026-05-20-study-section-consolidation-design.md)

---

## File Structure (locked before tasks begin)

### Files to CREATE

| Path | Purpose | Approx LOC |
|---|---|---|
| `supabase/migrations/20260520120000_study_menu_v2_flag.sql` | Seed `ff_study_menu_v2` row + add `source = 'student_created'` to `spaced_repetition_cards.source` check constraint | ~30 |
| `src/app/refresh/page.tsx` | New /refresh page with stacked Sections A-D | ~400 |
| `src/components/refresh/QuickRecallSection.tsx` | Section A — flashcard reviewer (extracted from current /review page) | ~250 |
| `src/components/refresh/ChapterRefreshSection.tsx` | Section B — decayed-chapter stack (extracted from current /revise page) | ~120 |
| `src/components/refresh/RetentionTestsSection.tsx` | Section C — pending retention tests | ~80 |
| `src/components/refresh/BuildYourOwnDeckSection.tsx` | Section D — manual card composer (NEW) | ~180 |
| `src/app/api/learner/cards/create/route.ts` | POST endpoint for Section D — inserts into spaced_repetition_cards | ~120 |
| `src/app/exam-prep/page.tsx` | New /exam-prep page (rescoped /study-plan) | ~300 |
| `src/__tests__/api/learner/cards/create.test.ts` | Unit tests for the new card-creation API | ~120 |
| `src/__tests__/components/refresh/BuildYourOwnDeckSection.test.tsx` | Component test for Section D composer | ~80 |
| `e2e/refresh-page.spec.ts` | E2E covering /refresh sections + Section D submission + redirect from /review | ~150 |
| `e2e/exam-prep-page.spec.ts` | E2E covering /exam-prep with and without an upcoming exam | ~80 |

### Files to MODIFY

| Path | What changes |
|---|---|
| `src/lib/feature-flags.ts` | Add `STUDY_MENU_V2: 'ff_study_menu_v2'` to a new `STUDY_MENU_FLAGS` const (~line 290) |
| `src/components/ui/BottomNavComponent.tsx` | `SIDEBAR_SECTIONS.Review` → `Study` (line 95), `MORE_ITEMS` update (line 61), flag-gated rendering |
| `next.config.js` | Add three 301 redirects inside `async redirects()` (line 72) |
| `src/components/quiz/QuizResults.tsx` | Line 734 — `router.push('/review')` → `/refresh` (flag-gated) |
| `src/components/dashboard/TodaysPlan.tsx` | Line 138 — `/review` → `/refresh` (flag-gated) |
| `src/components/dashboard/ComebackHook.tsx` | Line 87 — `/review` → `/refresh` (flag-gated) |
| `src/components/dashboard/FoxyBannerCard.tsx` | Line 55 — `/review` → `/refresh` (flag-gated) |
| `src/components/dashboard/sections/TodaysFocusSection.tsx` | Line 139 — `/review` → `/refresh` (flag-gated) |
| `src/components/dashboard/sections/QuickActionsSection.tsx` | Any link to /review or /study-plan — flag-gated |
| `src/components/learn/ChapterReadinessCard.tsx` | Line 138 — `/review` → `/refresh` (flag-gated) |
| `src/components/progress/LearningJourney.tsx` | Line 161 — `/study-plan` → `/exam-prep` (flag-gated) |
| `src/app/dashboard/AtlasDashboard.tsx` | Line 542 — `/review` → `/refresh` (flag-gated) |
| `.claude/regression-catalog.md` | Add REG-69 for menu-rename and Section D card-creation |

### Files to DELETE (Phase 6 only, after rollout)

- `src/app/review/page.tsx`
- `src/app/revise/page.tsx`
- `src/app/study-plan/page.tsx`

---

## Phase 1 — Migration + flag scaffolding

### Task 1.1: Add the flag-seed migration

**Files:**
- Create: `supabase/migrations/20260520120000_study_menu_v2_flag.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Study Menu v2 — feature flag for the consolidated Study sidebar group.
-- See docs/superpowers/specs/2026-05-20-study-section-consolidation-design.md
--
-- Adds the ff_study_menu_v2 flag (default OFF). When ON, the BottomNav
-- renders the renamed "Study" group with /refresh + /exam-prep + /learn
-- and the old /review, /revise, /study-plan routes 301 to their new
-- homes. Old routes remain functional while the flag is OFF.
--
-- Also widens the spaced_repetition_cards.source check constraint to
-- accept 'student_created' — required by /api/learner/cards/create.

BEGIN;

-- 1. Flag row.
INSERT INTO public.feature_flags (
  flag_name,
  description,
  is_enabled,
  target_roles,
  target_environments,
  target_institutions,
  rollout_percentage
) VALUES (
  'ff_study_menu_v2',
  'Consolidates the student sidebar Review group into Study (Library + Refresh + Exam Sprint). Spec: 2026-05-20-study-section-consolidation-design.md',
  false,
  ARRAY['student']::text[],
  NULL,
  NULL,
  NULL
)
ON CONFLICT (flag_name) DO NOTHING;

-- 2. Widen the spaced_repetition_cards.source check constraint to allow
-- 'student_created'. The existing constraint enumerates the legal source
-- values; we add one and re-create the constraint.
-- (No-op if the constraint already includes 'student_created'.)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.check_constraints
    WHERE constraint_name = 'spaced_repetition_cards_source_check'
  ) THEN
    ALTER TABLE public.spaced_repetition_cards
      DROP CONSTRAINT spaced_repetition_cards_source_check;
  END IF;

  ALTER TABLE public.spaced_repetition_cards
    ADD CONSTRAINT spaced_repetition_cards_source_check
    CHECK (source IS NULL OR source IN (
      'quiz_wrong_answer',
      'foxy_chat',
      'study_plan',
      'student_created'
    ));
END $$;

COMMIT;
```

- [ ] **Step 2: Apply migration locally (or staging)**

Run: `supabase db push` (against local supabase if running; otherwise commit and let CI apply to staging via the migration pipeline).

Expected: Migration applies cleanly. Verify with `select flag_name, is_enabled from feature_flags where flag_name = 'ff_study_menu_v2';` → one row, `is_enabled = false`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260520120000_study_menu_v2_flag.sql
git commit -m "feat(study-menu): add ff_study_menu_v2 flag + widen card source enum"
```

### Task 1.2: Register the flag in `src/lib/feature-flags.ts`

**Files:**
- Modify: `src/lib/feature-flags.ts` (after the `EDITORIAL_ATLAS_FLAGS` block, around line 323)

- [ ] **Step 1: Add the flag constant block**

After `EDITORIAL_ATLAS_FLAGS` (line 323), add:

```ts
/**
 * Study Menu v2 flags (2026-05-20).
 *
 *  ff_study_menu_v2
 *    Master switch for the sidebar consolidation documented in
 *    docs/superpowers/specs/2026-05-20-study-section-consolidation-design.md.
 *    When ON, the BottomNav sidebar renders the "Study" group with three
 *    items (Library / Refresh / Exam Sprint) and the old /review,
 *    /revise, /study-plan routes 301 to their new homes. When OFF, the
 *    legacy "Review" group with four items is rendered unchanged and the
 *    old routes are reachable. Default: false.
 *
 *    Seeded by migration 20260520120000_study_menu_v2_flag.sql.
 */
export const STUDY_MENU_FLAGS = {
  V2: 'ff_study_menu_v2',
} as const;
```

- [ ] **Step 2: Verify types and lint**

Run: `npm run type-check && npm run lint`

Expected: Both exit 0. No new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/feature-flags.ts
git commit -m "feat(study-menu): register ff_study_menu_v2 flag constant"
```

---

## Phase 2 — Build /refresh page (Sections A-C, no Section D yet)

### Task 2.1: Extract Section A (Quick Recall) from /review

**Files:**
- Create: `src/components/refresh/QuickRecallSection.tsx`

The component renders 5 due flashcards in the existing /review card-flip UI. Copy the flip + quality-button + rate-limit logic from `src/app/review/page.tsx` lines 60-205 and 391-549, isolate it into a self-contained component.

- [ ] **Step 1: Write the component**

```tsx
'use client';

/**
 * Refresh page — Section A "Quick Recall".
 *
 * Renders up to 5 due SM-2 flashcards with the standard flip-and-rate
 * UI. Calls the existing POST /api/learner/review/grade endpoint for
 * each rating (preserves the learner.review_graded event publish).
 *
 * Extracted from src/app/review/page.tsx (2026-05-20). The card-flip
 * UI, rate-limiting, and double-rate guards are copied verbatim — this
 * is a presentation refactor, not an engine change.
 *
 * Auto-hides (renders null) when there are 0 cards due. The parent
 * page is responsible for showing the empty-state nudge in that case.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { getReviewCards as getDomainReviewCards } from '@/lib/domains/profile';

interface ReviewCard {
  id: string;
  subject: string;
  topic: string;
  chapter_title: string;
  front_text: string;
  back_text: string;
  hint: string;
  source: string | null;
  ease_factor: number;
  interval_days: number;
  streak: number;
  repetition_count: number;
  total_reviews: number;
  correct_reviews: number;
  last_review_date: string | null;
}

const QUALITY_BUTTONS = [
  { q: 0, label: '😵 Forgot', labelHi: '😵 भूल गया', color: '#DC2626' },
  { q: 3, label: '😐 Hard',   labelHi: '😐 कठिन',   color: '#D97706' },
  { q: 4, label: '🙂 Good',   labelHi: '🙂 ठीक',    color: '#0891B2' },
  { q: 5, label: '😎 Easy',   labelHi: '😎 आसान',   color: '#16A34A' },
] as const;

const MAX_REVIEWS_PER_MINUTE = 20;

export interface QuickRecallSectionProps {
  /** Called after the section finishes loading cards. Parent uses this
   *  to decide whether to show the empty-state nudge below. */
  onLoaded?: (cardCount: number) => void;
  /** Called whenever a card is graded — parent may want to bump a
   *  visible counter or refresh adjacent sections. */
  onGraded?: () => void;
}

export default function QuickRecallSection({ onLoaded, onGraded }: QuickRecallSectionProps) {
  const { student, isHi } = useAuth();
  const [cards, setCards] = useState<ReviewCard[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [loading, setLoading] = useState(true);

  const reviewedCardIds = useRef(new Set<string>());
  const reviewTimestamps = useRef<number[]>([]);

  const load = useCallback(async () => {
    if (!student) return;
    setLoading(true);
    try {
      const result = await getDomainReviewCards(student.id, 20);
      const loaded: ReviewCard[] = result.ok && Array.isArray(result.data)
        ? (result.data as ReviewCard[]).slice(0, 5)
        : [];
      setCards(loaded);
      onLoaded?.(loaded.length);
    } catch {
      setCards([]);
      onLoaded?.(0);
    } finally {
      setLoading(false);
    }
  }, [student, onLoaded]);

  useEffect(() => { void load(); }, [load]);

  const rateCard = async (quality: 0 | 3 | 4 | 5) => {
    const card = cards[currentIdx];
    if (!card || !student) return;

    if (reviewedCardIds.current.has(card.id)) {
      if (currentIdx < cards.length - 1) setCurrentIdx(i => i + 1);
      else setCards([]);
      return;
    }

    const now = Date.now();
    reviewTimestamps.current = reviewTimestamps.current.filter(t => now - t < 60_000);
    if (reviewTimestamps.current.length >= MAX_REVIEWS_PER_MINUTE) return;
    reviewTimestamps.current.push(now);

    reviewedCardIds.current.add(card.id);

    try {
      const res = await fetch('/api/learner/review/grade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ cardId: card.id, quality }),
      });
      if (!res.ok) reviewedCardIds.current.delete(card.id);
    } catch {
      reviewedCardIds.current.delete(card.id);
    }

    onGraded?.();
    setFlipped(false);
    setShowHint(false);
    if (currentIdx < cards.length - 1) setCurrentIdx(i => i + 1);
    else setCards([]);
  };

  if (loading) {
    return (
      <div className="text-center py-6 text-sm text-[var(--text-3)]">
        {isHi ? 'कार्ड लोड हो रहे हैं...' : 'Loading cards...'}
      </div>
    );
  }
  if (cards.length === 0) return null;

  const card = cards[currentIdx];

  return (
    <section data-testid="refresh-section-a" className="space-y-4">
      <header className="flex items-center justify-between">
        <h2 className="text-base font-bold" style={{ fontFamily: 'var(--font-display)' }}>
          {isHi ? '⚡ झटपट याद' : '⚡ Quick Recall'}
        </h2>
        <span className="text-xs text-[var(--text-3)] font-medium">
          {currentIdx + 1}/{cards.length}
        </span>
      </header>

      <div className="text-center text-xs text-[var(--text-3)]">
        {card.subject} · {card.chapter_title || card.topic}
      </div>

      <button
        onClick={() => setFlipped(!flipped)}
        className="w-full min-h-[200px] rounded-2xl p-6 flex flex-col items-center justify-center text-center transition-all active:scale-[0.98]"
        style={{
          background: flipped
            ? 'linear-gradient(135deg, rgba(8,145,178,0.06), rgba(22,163,74,0.06))'
            : 'var(--surface-1)',
          border: `1.5px solid ${flipped ? 'var(--teal, #0891B2)' : 'var(--border)'}`,
        }}
      >
        {flipped ? (
          <>
            <div className="text-xs text-[var(--text-3)] mb-3 uppercase tracking-wider font-semibold">
              {isHi ? 'उत्तर' : 'Answer'}
            </div>
            <div className="text-base leading-relaxed" style={{ whiteSpace: 'pre-wrap' }}>
              {card.back_text}
            </div>
          </>
        ) : (
          <>
            <div className="text-xs text-[var(--text-3)] mb-3 uppercase tracking-wider font-semibold">
              {isHi ? 'प्रश्न' : 'Question'}
            </div>
            <div className="text-lg font-semibold leading-relaxed" style={{ whiteSpace: 'pre-wrap' }}>
              {card.front_text}
            </div>
            {!showHint && card.hint && (
              <button
                onClick={(e) => { e.stopPropagation(); setShowHint(true); }}
                className="mt-4 text-xs px-4 py-1.5 rounded-full"
                style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}
              >
                💡 {isHi ? 'संकेत' : 'Hint'}
              </button>
            )}
            {showHint && card.hint && (
              <div className="mt-4 text-sm p-3 rounded-xl" style={{ background: 'rgba(245,166,35,0.08)' }}>
                💡 {card.hint}
              </div>
            )}
          </>
        )}
      </button>

      {flipped && (
        <div className="grid grid-cols-4 gap-2">
          {QUALITY_BUTTONS.map((btn) => (
            <button
              key={btn.q}
              onClick={() => rateCard(btn.q)}
              data-testid={`refresh-quality-${btn.q}`}
              className="py-3 rounded-xl text-xs font-semibold transition-all active:scale-95"
              style={{
                background: `${btn.color}10`,
                border: `1.5px solid ${btn.color}30`,
                color: btn.color,
              }}
            >
              {isHi ? btn.labelHi : btn.label}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run type-check`

Expected: 0 errors. New component is unused (only referenced by /refresh later) so no test failure.

- [ ] **Step 3: Commit**

```bash
git add src/components/refresh/QuickRecallSection.tsx
git commit -m "feat(refresh): extract Quick Recall section from /review"
```

### Task 2.2: Extract Section B (Chapter Refresh) from /revise

**Files:**
- Create: `src/components/refresh/ChapterRefreshSection.tsx`

- [ ] **Step 1: Write the component**

```tsx
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
import { useAuth } from '@/lib/AuthContext';

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
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run type-check`

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/refresh/ChapterRefreshSection.tsx
git commit -m "feat(refresh): extract Chapter Refresh section from /revise"
```

### Task 2.3: Extract Section C (Retention Tests) from /review

**Files:**
- Create: `src/components/refresh/RetentionTestsSection.tsx`

- [ ] **Step 1: Write the component**

```tsx
'use client';

/**
 * Refresh page — Section C "Retention Tests".
 *
 * Renders pending retention quizzes from the `retention_tests` table
 * where scheduled_date <= today and status = 'pending'. CTA routes the
 * student to /quiz?mode=cognitive to take one.
 *
 * Extracted from src/app/review/page.tsx (2026-05-20).
 *
 * Auto-hides (renders null) when no tests are pending.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';

interface RetentionTest {
  id: string;
  topic_title: string;
  subject: string;
  predicted_retention: number;
  scheduled_date: string;
}

export default function RetentionTestsSection() {
  const { student, isHi } = useAuth();
  const router = useRouter();
  const [tests, setTests] = useState<RetentionTest[] | null>(null);

  useEffect(() => {
    if (!student) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from('retention_tests')
          .select('id, topic_title, subject, predicted_retention, scheduled_date')
          .eq('student_id', student.id)
          .eq('status', 'pending')
          .lte('scheduled_date', new Date().toISOString().split('T')[0])
          .order('scheduled_date')
          .limit(5);
        if (!cancelled) setTests(data ?? []);
      } catch {
        if (!cancelled) setTests([]);
      }
    })();
    return () => { cancelled = true; };
  }, [student]);

  if (tests === null || tests.length === 0) return null;

  return (
    <section data-testid="refresh-section-c" className="space-y-3">
      <header>
        <h2 className="text-base font-bold" style={{ fontFamily: 'var(--font-display)' }}>
          {isHi ? '🧠 याददाश्त परीक्षा' : '🧠 Retention Tests'}
        </h2>
      </header>

      <div className="rounded-2xl p-4" style={{ background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.15)' }}>
        <div className="space-y-1.5">
          {tests.map(test => (
            <div key={test.id} className="flex items-center gap-2 text-xs">
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: test.predicted_retention < 0.5 ? '#EF4444' : '#F59E0B' }}
              />
              <span className="flex-1 truncate font-medium" style={{ color: 'var(--text-2)' }}>
                {test.topic_title}
              </span>
              <span className="text-[var(--text-3)] flex-shrink-0">
                {Math.round((test.predicted_retention ?? 0) * 100)}% {isHi ? 'याददाश्त' : 'retention'}
              </span>
            </div>
          ))}
        </div>
        <button
          onClick={() => router.push('/quiz?mode=cognitive')}
          className="mt-3 w-full py-2 rounded-xl text-xs font-bold"
          style={{ background: 'rgba(124,58,237,0.1)', color: '#7C3AED', border: '1px solid rgba(124,58,237,0.2)' }}
        >
          🧠 {isHi ? 'रिटेंशन टेस्ट लो' : 'Take Retention Test'}
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run type-check`

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/refresh/RetentionTestsSection.tsx
git commit -m "feat(refresh): extract Retention Tests section"
```

### Task 2.4: Build the /refresh page shell (Sections A-C only)

**Files:**
- Create: `src/app/refresh/page.tsx`

Section D (Build Your Own Deck) is added in Phase 3. For now the page renders A+B+C with the right empty-state nudge when all hide.

- [ ] **Step 1: Write the page**

```tsx
'use client';

/**
 * /refresh — consolidated review surface (replaces /review + /revise).
 *
 * Three stacked sections:
 *   A. Quick Recall      — 5 due SM-2 flashcards
 *   B. Chapter Refresh   — decayed-chapter stack
 *   C. Retention Tests   — pending retention quizzes
 *
 * (Section D "Build Your Own Deck" is added in Phase 3 of the plan.)
 *
 * Each section auto-hides when empty. When ALL three are empty, the page
 * shows a single nudge directing the student to /learn or /quiz.
 *
 * Behind feature flag ff_study_menu_v2. Old /review and /revise routes
 * remain functional until Phase 6 of the rollout. ?tab=flashcards|chapters
 * deep-link param smooth-scrolls to that section on mount.
 *
 * Spec: docs/superpowers/specs/2026-05-20-study-section-consolidation-design.md
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { LoadingFoxy, BottomNav } from '@/components/ui';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';
import QuickRecallSection from '@/components/refresh/QuickRecallSection';
import ChapterRefreshSection from '@/components/refresh/ChapterRefreshSection';
import RetentionTestsSection from '@/components/refresh/RetentionTestsSection';

export default function RefreshPage() {
  const { student, isLoggedIn, isLoading, isHi } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [sectionACount, setSectionACount] = useState<number | null>(null);
  const sectionARef = useRef<HTMLDivElement | null>(null);
  const sectionBRef = useRef<HTMLDivElement | null>(null);

  // Auth + onboarding redirects (same pattern as /review and /revise today).
  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/login');
    if (!isLoading && isLoggedIn && student && !student.onboarding_completed) {
      router.replace('/onboarding');
    }
  }, [isLoading, isLoggedIn, student, router]);

  // Smooth-scroll to deep-linked section on mount.
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'flashcards' && sectionARef.current) {
      sectionARef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (tab === 'chapters' && sectionBRef.current) {
      sectionBRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [searchParams]);

  if (isLoading || !student) return <LoadingFoxy />;

  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      <header
        className="page-header"
        style={{ background: 'rgba(251,248,244,0.88)', backdropFilter: 'blur(20px)', borderColor: 'var(--border)' }}
      >
        <div className="app-container py-3 flex items-center gap-3">
          <button onClick={() => router.push('/dashboard')} className="text-[var(--text-3)]">←</button>
          <div>
            <h1 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
              🔁 {isHi ? 'ताज़ा करो' : 'Refresh'}
            </h1>
            <p className="text-xs text-[var(--text-3)] mt-0.5">
              {isHi ? 'जो सीखा है उसे फिर से ताज़ा करो' : "Keep what you've learned fresh"}
            </p>
          </div>
        </div>
      </header>

      <main className="app-container py-5 space-y-6 max-w-2xl mx-auto">
        <SectionErrorBoundary section="Refresh">
          <div ref={sectionARef}>
            <SectionErrorBoundary section="Refresh:QuickRecall">
              <QuickRecallSection onLoaded={setSectionACount} />
            </SectionErrorBoundary>
          </div>

          <div ref={sectionBRef}>
            <SectionErrorBoundary section="Refresh:ChapterRefresh">
              <ChapterRefreshSection />
            </SectionErrorBoundary>
          </div>

          <SectionErrorBoundary section="Refresh:RetentionTests">
            <RetentionTestsSection />
          </SectionErrorBoundary>

          {/* All-empty nudge — only renders when Section A has loaded and
              reports 0 cards. (B + C auto-hide so we don't need their
              counts.) Once Section D ships this falls back to D's tip. */}
          {sectionACount === 0 && (
            <div className="text-center py-10" data-testid="refresh-empty-state">
              <div className="text-5xl mb-3">✨</div>
              <p className="text-sm font-semibold text-[var(--text-2)] mb-1">
                {isHi ? 'अभी कुछ ताज़ा करने को नहीं' : 'Nothing to refresh right now'}
              </p>
              <p className="text-xs text-[var(--text-3)] mb-5">
                {isHi
                  ? 'क्विज़ खेलो — नए कार्ड अपने आप बनेंगे।'
                  : 'Take a quiz — new cards will be created automatically.'}
              </p>
              <button
                onClick={() => router.push('/quiz')}
                className="px-5 py-2.5 rounded-xl text-sm font-bold text-white"
                style={{ background: 'var(--orange, #E8581C)' }}
              >
                ⚡ {isHi ? 'क्विज़ खेलो' : 'Take a Quiz'}
              </button>
            </div>
          )}
        </SectionErrorBoundary>
      </main>

      <BottomNav />
    </div>
  );
}
```

- [ ] **Step 2: Manually smoke-test in dev**

Run: `npm run dev` and visit `http://localhost:3000/refresh`.

Expected: Page renders. With a brand-new test account: all sections collapse, empty nudge shows. With an account that has SRS cards due: Section A renders the flashcard UI.

- [ ] **Step 3: Verify type-check + lint + build**

Run: `npm run type-check && npm run lint && npm run build`

Expected: All exit 0. Bundle-size check passes for /refresh under 220 kB.

- [ ] **Step 4: Commit**

```bash
git add src/app/refresh/page.tsx
git commit -m "feat(refresh): build /refresh page shell with Sections A-C"
```

---

## Phase 3 — Section D: Build Your Own Deck + new API route

### Task 3.1: Write the failing test for the create-card API

**Files:**
- Create: `src/__tests__/api/learner/cards/create.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/learner/cards/create/route';
import { NextRequest } from 'next/server';

// Mock the auth helper and admin client. The route is fully covered by these
// two mocks — no real Supabase call is made.
vi.mock('@/lib/rbac', () => ({
  authorizeRequest: vi.fn(async () => ({
    authorized: true,
    userId: 'user-uuid-1',
    studentId: 'student-uuid-1',
  })),
}));

const insertMock = vi.fn();
vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({ insert: insertMock })),
  },
}));

function mkReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/learner/cards/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/learner/cards/create', () => {
  beforeEach(() => {
    insertMock.mockReset();
    insertMock.mockResolvedValue({ data: null, error: null });
  });

  it('rejects body missing subjectCode', async () => {
    const res = await POST(mkReq({ frontText: 'q', backText: 'a' }));
    expect(res.status).toBe(400);
  });

  it('rejects frontText longer than 200 chars', async () => {
    const res = await POST(mkReq({
      subjectCode: 'physics',
      frontText: 'x'.repeat(201),
      backText: 'a',
    }));
    expect(res.status).toBe(400);
  });

  it('rejects backText longer than 200 chars', async () => {
    const res = await POST(mkReq({
      subjectCode: 'physics',
      frontText: 'q',
      backText: 'x'.repeat(201),
    }));
    expect(res.status).toBe(400);
  });

  it('rejects hint longer than 100 chars', async () => {
    const res = await POST(mkReq({
      subjectCode: 'physics',
      frontText: 'q',
      backText: 'a',
      hint: 'x'.repeat(101),
    }));
    expect(res.status).toBe(400);
  });

  it('inserts a card with source=student_created and SM-2 defaults', async () => {
    const res = await POST(mkReq({
      subjectCode: 'physics',
      frontText: 'What is force?',
      backText: 'Mass times acceleration',
    }));
    expect(res.status).toBe(200);
    expect(insertMock).toHaveBeenCalledOnce();
    const row = insertMock.mock.calls[0][0];
    expect(row.student_id).toBe('student-uuid-1');
    expect(row.subject).toBe('physics');
    expect(row.front_text).toBe('What is force?');
    expect(row.back_text).toBe('Mass times acceleration');
    expect(row.source).toBe('student_created');
    expect(row.ease_factor).toBe(2.5);
    expect(row.interval_days).toBe(1);
    expect(row.repetition_count).toBe(0);
    expect(row.streak).toBe(0);
  });

  it('returns 500 when the insert errors', async () => {
    insertMock.mockResolvedValueOnce({ data: null, error: { message: 'db down' } });
    const res = await POST(mkReq({
      subjectCode: 'physics',
      frontText: 'q',
      backText: 'a',
    }));
    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run src/__tests__/api/learner/cards/create.test.ts`

Expected: All tests FAIL — `Cannot find module '@/app/api/learner/cards/create/route'`. Good. That's the signal to write the route.

### Task 3.2: Write the create-card API route

**Files:**
- Create: `src/app/api/learner/cards/create/route.ts`

- [ ] **Step 1: Write the route**

```ts
/**
 * POST /api/learner/cards/create — student-created flashcards.
 *
 * Section D of the /refresh page. Inserts a new row into
 * `spaced_repetition_cards` with `source = 'student_created'` and SM-2
 * defaults (ease 2.5, interval 1 day, streak 0). The card becomes due
 * "tomorrow" in the existing Quick Recall section.
 *
 * Validations (defense in depth — the migration check constraint also
 * enforces `source IN (...)`):
 *   - subjectCode: 1-32 chars, lowercase letters/digits only
 *   - frontText: 1-200 chars
 *   - backText:  1-200 chars
 *   - hint:      0-100 chars (optional)
 *
 * Rate limit: per-student daily insert cap is enforced by the in-route
 * count query (≤ 20 cards in the trailing 24 hours).
 *
 * Spec: docs/superpowers/specs/2026-05-20-study-section-consolidation-design.md §6 Section D
 *
 * Returns:
 *   200 { ok: true, cardId }
 *   400 invalid body OR daily cap hit
 *   401 unauthenticated
 *   500 insert failed
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeRequest } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

const RequestSchema = z.object({
  subjectCode: z.string().regex(/^[a-z0-9_]{1,32}$/),
  frontText: z.string().min(1).max(200),
  backText: z.string().min(1).max(200),
  hint: z.string().max(100).optional(),
});

const DAILY_CAP = 20;

export async function POST(request: NextRequest) {
  const auth = await authorizeRequest(request, 'review.practice', {
    requireStudentId: true,
  });
  if (!auth.authorized) return auth.errorResponse!;

  const studentId = auth.studentId!;

  let body: z.infer<typeof RequestSchema>;
  try {
    body = RequestSchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: 'invalid_body', detail: (err as Error).message.slice(0, 300) },
      { status: 400 },
    );
  }

  // Daily-cap check: how many cards has this student created in the last 24h?
  const sinceIso = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count: existingCount, error: countErr } = await supabaseAdmin
    .from('spaced_repetition_cards')
    .select('id', { count: 'exact', head: true })
    .eq('student_id', studentId)
    .eq('source', 'student_created')
    .gte('created_at', sinceIso);

  if (countErr) {
    logger.warn('cards.create: cap-count failed', { error: countErr.message });
    return NextResponse.json({ ok: false, error: 'count_failed' }, { status: 500 });
  }

  if ((existingCount ?? 0) >= DAILY_CAP) {
    return NextResponse.json(
      { ok: false, error: 'daily_cap_hit', cap: DAILY_CAP },
      { status: 400 },
    );
  }

  const todayYmd = new Date().toISOString().split('T')[0];
  const tomorrowYmd = new Date(Date.now() + 86_400_000).toISOString().split('T')[0];

  const row = {
    student_id: studentId,
    subject: body.subjectCode,
    chapter_title: null,
    front_text: body.frontText,
    back_text: body.backText,
    hint: body.hint ?? null,
    source: 'student_created' as const,
    ease_factor: 2.5,
    interval_days: 1,
    streak: 0,
    repetition_count: 0,
    total_reviews: 0,
    correct_reviews: 0,
    next_review_date: tomorrowYmd,
    last_review_date: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { data, error: insertErr } = await supabaseAdmin
    .from('spaced_repetition_cards')
    .insert(row)
    .select('id')
    .single();

  if (insertErr) {
    logger.warn('cards.create: insert failed', { error: insertErr.message });
    return NextResponse.json({ ok: false, error: 'insert_failed' }, { status: 500 });
  }

  logger.info('cards.create: card created', {
    studentId,
    cardId: (data as { id: string } | null)?.id,
    subjectCode: body.subjectCode,
  });

  return NextResponse.json(
    { ok: true, cardId: (data as { id: string } | null)?.id, scheduledFor: tomorrowYmd },
    { status: 200 },
  );

  // Note: this route deliberately does NOT publish learner.review_graded
  // (no review happened) and does NOT publish learner.card_created (event
  // schema for that is added separately in src/lib/state/events/registry.ts
  // in Task 3.3; this route will be re-edited at that point).
  void todayYmd;
}
```

- [ ] **Step 2: Run the test, verify it passes**

Run: `npx vitest run src/__tests__/api/learner/cards/create.test.ts`

Expected: All 6 tests PASS.

- [ ] **Step 3: Type-check + lint**

Run: `npm run type-check && npm run lint`

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/__tests__/api/learner/cards/create.test.ts src/app/api/learner/cards/create/route.ts
git commit -m "feat(refresh): add POST /api/learner/cards/create for Section D"
```

### Task 3.3: Build the Section D component (Build Your Own Deck)

**Files:**
- Create: `src/components/refresh/BuildYourOwnDeckSection.tsx`
- Create: `src/__tests__/components/refresh/BuildYourOwnDeckSection.test.tsx`

- [ ] **Step 1: Write the component**

```tsx
'use client';

/**
 * Refresh page — Section D "Build Your Own Deck".
 *
 * A composer that lets the student create their own SM-2 flashcard.
 * Submits to POST /api/learner/cards/create. On success the card is
 * scheduled for tomorrow and shows up in Section A.
 *
 * Always rendered (unlike A/B/C which auto-hide). Default state shows
 * a small tip; expanding the composer reveals subject + front + back +
 * optional hint.
 *
 * Spec: docs/superpowers/specs/2026-05-20-study-section-consolidation-design.md §6 Section D
 */

import { useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { useAllowedSubjects } from '@/lib/useAllowedSubjects';
import { toast } from '@/components/ui/toast';

export interface BuildYourOwnDeckSectionProps {
  onCardCreated?: () => void;
}

export default function BuildYourOwnDeckSection({ onCardCreated }: BuildYourOwnDeckSectionProps) {
  const { isHi } = useAuth();
  const { unlocked: allowedSubjects } = useAllowedSubjects();

  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState<string>('');
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [hint, setHint] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit =
    subject.length > 0 &&
    front.trim().length > 0 && front.length <= 200 &&
    back.trim().length > 0 && back.length <= 200 &&
    hint.length <= 100 &&
    !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/learner/cards/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          subjectCode: subject,
          frontText: front.trim(),
          backText: back.trim(),
          hint: hint.trim() || undefined,
        }),
      });
      if (res.ok) {
        toast.success(isHi ? 'जोड़ दिया — कल झटपट याद में दिखेगा' : "Added — you'll see it tomorrow in Quick Recall");
        setFront(''); setBack(''); setHint(''); setOpen(false);
        onCardCreated?.();
      } else {
        const body = await res.json().catch(() => ({}));
        if (body.error === 'daily_cap_hit') {
          toast.error(isHi ? 'आज का limit पूरा — कल फिर जोड़ो' : "Today's limit reached — try again tomorrow");
        } else {
          toast.error(isHi ? 'कार्ड जोड़ने में त्रुटि' : 'Could not add card');
        }
      }
    } catch {
      toast.error(isHi ? 'कार्ड जोड़ने में त्रुटि' : 'Could not add card');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section data-testid="refresh-section-d" className="space-y-3">
      <header>
        <h2 className="text-base font-bold" style={{ fontFamily: 'var(--font-display)' }}>
          ⭐ {isHi ? 'अपना डेक बनाओ' : 'Build Your Own Deck'}
        </h2>
      </header>

      {!open && (
        <button
          onClick={() => setOpen(true)}
          data-testid="refresh-byod-open"
          className="w-full rounded-2xl p-4 text-left text-sm transition-all active:scale-[0.98]"
          style={{ background: 'rgba(232,88,28,0.05)', border: '1px dashed rgba(232,88,28,0.3)', color: 'var(--text-2)' }}
        >
          + {isHi ? 'टिप: जो याद रखना है उसे जोड़ो' : 'Tip: tap to add a concept you want to remember'}
        </button>
      )}

      {open && (
        <div className="rounded-2xl p-4 space-y-3" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
          <select
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            data-testid="refresh-byod-subject"
            className="w-full p-2.5 rounded-xl text-sm"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
          >
            <option value="">{isHi ? 'विषय चुनो' : 'Choose subject'}</option>
            {allowedSubjects.map(s => (
              <option key={s.code} value={s.code}>{s.icon} {s.name}</option>
            ))}
          </select>

          <textarea
            value={front}
            onChange={(e) => setFront(e.target.value.slice(0, 200))}
            data-testid="refresh-byod-front"
            placeholder={isHi ? 'क्या याद रखना है?' : 'What do you want to remember?'}
            maxLength={200}
            rows={2}
            className="w-full p-2.5 rounded-xl text-sm"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
          />
          <div className="text-[10px] text-[var(--text-3)] text-right">{front.length}/200</div>

          <textarea
            value={back}
            onChange={(e) => setBack(e.target.value.slice(0, 200))}
            data-testid="refresh-byod-back"
            placeholder={isHi ? 'संकेत या उत्तर' : 'Hint or answer'}
            maxLength={200}
            rows={2}
            className="w-full p-2.5 rounded-xl text-sm"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
          />
          <div className="text-[10px] text-[var(--text-3)] text-right">{back.length}/200</div>

          <input
            value={hint}
            onChange={(e) => setHint(e.target.value.slice(0, 100))}
            data-testid="refresh-byod-hint"
            placeholder={isHi ? 'संकेत (optional)' : 'Hint (optional)'}
            maxLength={100}
            className="w-full p-2.5 rounded-xl text-sm"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
          />

          <div className="flex gap-2">
            <button
              onClick={() => { setOpen(false); setFront(''); setBack(''); setHint(''); }}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
              style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}
            >
              {isHi ? 'रद्द' : 'Cancel'}
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              data-testid="refresh-byod-submit"
              className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-40"
              style={{ background: 'var(--orange, #E8581C)' }}
            >
              {submitting ? (isHi ? 'जोड़ रहा है...' : 'Adding...') : (isHi ? 'मेरे डेक में जोड़ो' : 'Add to my deck')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Write a component test**

Create `src/__tests__/components/refresh/BuildYourOwnDeckSection.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BuildYourOwnDeckSection from '@/components/refresh/BuildYourOwnDeckSection';

vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ isHi: false }),
}));
vi.mock('@/lib/useAllowedSubjects', () => ({
  useAllowedSubjects: () => ({
    unlocked: [
      { code: 'physics', name: 'Physics', icon: '⚛️', color: '#2563EB' },
      { code: 'chemistry', name: 'Chemistry', icon: '⚗️', color: '#16A34A' },
    ],
  }),
}));
vi.mock('@/components/ui/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

describe('<BuildYourOwnDeckSection />', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    (globalThis.fetch as unknown) = vi.fn();
  });

  it('renders collapsed tip by default', () => {
    render(<BuildYourOwnDeckSection />);
    expect(screen.getByTestId('refresh-byod-open')).toBeInTheDocument();
  });

  it('expands composer on tip click', () => {
    render(<BuildYourOwnDeckSection />);
    fireEvent.click(screen.getByTestId('refresh-byod-open'));
    expect(screen.getByTestId('refresh-byod-subject')).toBeInTheDocument();
    expect(screen.getByTestId('refresh-byod-submit')).toBeDisabled();
  });

  it('enables submit when subject + front + back are valid', () => {
    render(<BuildYourOwnDeckSection />);
    fireEvent.click(screen.getByTestId('refresh-byod-open'));
    fireEvent.change(screen.getByTestId('refresh-byod-subject'), { target: { value: 'physics' } });
    fireEvent.change(screen.getByTestId('refresh-byod-front'), { target: { value: 'What is force?' } });
    fireEvent.change(screen.getByTestId('refresh-byod-back'), { target: { value: 'Mass times acceleration' } });
    expect(screen.getByTestId('refresh-byod-submit')).toBeEnabled();
  });

  it('POSTs to /api/learner/cards/create with correct body', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, cardId: 'new-uuid' }),
    });
    const onCardCreated = vi.fn();
    render(<BuildYourOwnDeckSection onCardCreated={onCardCreated} />);
    fireEvent.click(screen.getByTestId('refresh-byod-open'));
    fireEvent.change(screen.getByTestId('refresh-byod-subject'), { target: { value: 'physics' } });
    fireEvent.change(screen.getByTestId('refresh-byod-front'), { target: { value: 'Q' } });
    fireEvent.change(screen.getByTestId('refresh-byod-back'), { target: { value: 'A' } });
    fireEvent.click(screen.getByTestId('refresh-byod-submit'));
    await waitFor(() => expect(onCardCreated).toHaveBeenCalled());
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/learner/cards/create',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"subjectCode":"physics"'),
      }),
    );
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run src/__tests__/components/refresh/BuildYourOwnDeckSection.test.tsx`

Expected: All 4 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/refresh/BuildYourOwnDeckSection.tsx src/__tests__/components/refresh/BuildYourOwnDeckSection.test.tsx
git commit -m "feat(refresh): add Build Your Own Deck composer (Section D)"
```

### Task 3.4: Wire Section D into /refresh

**Files:**
- Modify: `src/app/refresh/page.tsx`

- [ ] **Step 1: Import and render Section D**

In `src/app/refresh/page.tsx`:

- Add to the imports near the top:

```tsx
import BuildYourOwnDeckSection from '@/components/refresh/BuildYourOwnDeckSection';
```

- Add this section inside `<main>` AFTER the `<SectionErrorBoundary section="Refresh:RetentionTests">` block and BEFORE the all-empty nudge:

```tsx
<SectionErrorBoundary section="Refresh:BuildYourOwnDeck">
  <BuildYourOwnDeckSection
    onCardCreated={() => {
      // Re-fetch Section A so the new card count refreshes.
      // Cheap hack: bump a key on the QuickRecallSection. Easier
      // workaround until SWR is wired: do a full page refresh.
      window.location.reload();
    }}
  />
</SectionErrorBoundary>
```

- Update the all-empty nudge text from "Take a Quiz" to also mention Section D:

Old:
```tsx
{isHi
  ? 'क्विज़ खेलो — नए कार्ड अपने आप बनेंगे।'
  : 'Take a quiz — new cards will be created automatically.'}
```

New:
```tsx
{isHi
  ? 'क्विज़ खेलो — या नीचे अपना कार्ड जोड़ो।'
  : 'Take a quiz — or add your own card below.'}
```

- [ ] **Step 2: Smoke test**

Run: `npm run dev` and visit `/refresh`. Section D appears at the bottom. Add a card; toast appears; page reloads; if SRS due tomorrow there is no immediate visible change (Section A only loads cards with `next_review_date <= today`), which is correct.

- [ ] **Step 3: Run type-check + lint + build**

Run: `npm run type-check && npm run lint && npm run build`

Expected: 0 errors. Bundle size for /refresh still under 220 kB.

- [ ] **Step 4: Commit**

```bash
git add src/app/refresh/page.tsx
git commit -m "feat(refresh): wire Build Your Own Deck section into /refresh"
```

---

## Phase 4 — Build /exam-prep page

### Task 4.1: Copy /study-plan to /exam-prep with the new structure

**Files:**
- Create: `src/app/exam-prep/page.tsx`

The strategy: copy `src/app/study-plan/page.tsx` verbatim to `src/app/exam-prep/page.tsx`, then surgically remove the 3-question wizard ceremony and replace with the upcoming-exam detection logic.

- [ ] **Step 1: Copy the file**

```bash
cp src/app/study-plan/page.tsx src/app/exam-prep/page.tsx
```

- [ ] **Step 2: Apply the following edits to src/app/exam-prep/page.tsx**

At the top of the file, after the imports, add this fetch for the upcoming exam:

```tsx
interface UpcomingExam {
  id: string;
  exam_name: string;
  exam_type: string;
  subject: string;
  exam_date: string;
  days_left: number;
}
```

In the `StudyPlanPage` function (rename to `ExamPrepPage`), add new state near the other useState hooks:

```tsx
const [upcomingExam, setUpcomingExam] = useState<UpcomingExam | null>(null);
const [examLoading, setExamLoading] = useState(true);
```

Add a new useEffect right after the existing `useEffect` that calls `load()`:

```tsx
useEffect(() => {
  if (!student) return;
  let cancelled = false;
  (async () => {
    setExamLoading(true);
    try {
      const today = new Date();
      const horizon = new Date(today.getTime() + 30 * 86400000).toISOString().split('T')[0];
      const { data } = await supabase
        .from('upcoming_exams')
        .select('id, exam_name, exam_type, subject, exam_date')
        .eq('student_id', student.id)
        .lte('exam_date', horizon)
        .gte('exam_date', today.toISOString().split('T')[0])
        .order('exam_date')
        .limit(1)
        .maybeSingle();
      if (!cancelled && data) {
        const days = Math.max(0, Math.ceil(
          (new Date(data.exam_date).getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
        ));
        setUpcomingExam({ ...data, days_left: days });
        // Pre-fill the generate form with this exam's subject + days.
        setGenSubject(data.subject);
        setGenDays(Math.min(7, Math.max(1, days)));
      }
    } catch { /* non-fatal */ }
    finally { if (!cancelled) setExamLoading(false); }
  })();
  return () => { cancelled = true; };
}, [student]);
```

Replace the header text from:
```tsx
📅 {isHi ? 'अध्ययन योजना' : 'Study Plan'}
```
to:
```tsx
🎯 {upcomingExam
  ? (isHi ? `परीक्षा की तैयारी — ${upcomingExam.days_left} दिन बचे` : `Exam Sprint — ${upcomingExam.days_left} days left`)
  : (isHi ? 'परीक्षा की तैयारी' : 'Exam Sprint')}
```

Add (only when no exam and no plan) a banner above the generate-plan screen:

```tsx
{!upcomingExam && !hasPlan && !examLoading && (
  <Card className="!p-4">
    <p className="text-sm font-semibold mb-1">
      {isHi ? 'कोई परीक्षा अगले 30 दिनों में नहीं है' : 'No exams in the next 30 days'}
    </p>
    <p className="text-xs text-[var(--text-3)] mb-3">
      {isHi
        ? 'परीक्षा की तारीख जोड़ने पर यहाँ अपने आप एक sprint plan बनेगा।'
        : 'Add an exam date and a sprint plan will appear here automatically.'}
    </p>
    <button
      onClick={() => router.push('/parent/calendar')}
      className="text-xs font-bold px-3 py-2 rounded-lg"
      style={{ background: 'rgba(232,88,28,0.1)', color: 'var(--orange)' }}
    >
      📅 {isHi ? 'परीक्षा जोड़ो' : 'Add exam date'}
    </button>
  </Card>
)}
```

(The full edit list is in the spec §7. Use the existing 3-question wizard as the fallback "generic 7-day plan" path — wrap the wizard JSX in `{(!upcomingExam || generateOverride) && (...)}` where `generateOverride` is a new piece of state toggled by an "Adjust settings" link.)

- [ ] **Step 3: Type-check + lint + build**

Run: `npm run type-check && npm run lint && npm run build`

Expected: 0 errors.

- [ ] **Step 4: Manually smoke-test**

Run: `npm run dev` and visit `/exam-prep`. Verify: (a) with no upcoming exam, the page shows the "Add exam date" banner above the wizard. (b) with an upcoming exam in the table, the page header shows the days-left chip and subject/days are pre-filled.

- [ ] **Step 5: Commit**

```bash
git add src/app/exam-prep/page.tsx
git commit -m "feat(exam-prep): build context-aware /exam-prep from /study-plan"
```

---

## Phase 5 — Update the sidebar nav + flag-gated internal links

### Task 5.1: Update BottomNavComponent for the new Study group

**Files:**
- Modify: `src/components/ui/BottomNavComponent.tsx`

- [ ] **Step 1: Import the flag-aware helper**

Near the top imports of `src/components/ui/BottomNavComponent.tsx`, add:

```tsx
import { STUDY_MENU_FLAGS } from '@/lib/feature-flags';
```

- [ ] **Step 2: Replace SIDEBAR_SECTIONS with a function that returns the right shape per flag**

Replace the static `SIDEBAR_SECTIONS` const (lines 76-111) with TWO consts — one for legacy (flag OFF), one for new (flag ON) — and a selector that picks based on flags:

```tsx
const SIDEBAR_SECTIONS_LEGACY = [
  // ...same Home/Practice/Review/Account sections as before
];

const SIDEBAR_SECTIONS_V2 = [
  {
    title: 'Home', titleHi: 'होम',
    items: [
      { href: '/dashboard', icon: '🏠', label: 'Home', labelHi: 'होम' },
      { href: '/foxy', icon: '🦊', label: 'Foxy AI Tutor', labelHi: 'फॉक्सी AI ट्यूटर' },
      { href: '/progress', icon: '📈', label: 'My Progress', labelHi: 'मेरी प्रगति' },
    ],
  },
  {
    title: 'Practice', titleHi: 'अभ्यास',
    items: [
      { href: '/quiz', icon: '✏️', label: 'Practice', labelHi: 'अभ्यास' },
      { href: '/simulations', icon: '🔬', label: 'STEM Lab', labelHi: 'STEM लैब' },
      { href: '/pyq', icon: '📄', label: 'PYQ Papers', labelHi: 'पिछले साल के प्रश्न', gradeMin: 9 },
      { href: '/mock-exam', icon: '📋', label: 'Mock Exam', labelHi: 'मॉक परीक्षा', gradeMin: 9 },
    ],
  },
  {
    title: 'Study', titleHi: 'पढ़ाई',
    items: [
      { href: '/learn',     icon: '📚', label: 'Library',      labelHi: 'अध्ययन सामग्री' },
      { href: '/refresh',   icon: '🔁', label: 'Refresh',      labelHi: 'ताज़ा करो' },
      { href: '/exam-prep', icon: '🎯', label: 'Exam Sprint',  labelHi: 'परीक्षा की तैयारी', requiresUpcomingExam: true },
    ],
  },
  {
    title: 'Account', titleHi: 'खाता',
    items: [
      { href: '/profile', icon: '👤', label: 'Profile', labelHi: 'प्रोफ़ाइल' },
      { href: '/help', icon: '❓', label: 'Help & Support', labelHi: 'सहायता और सपोर्ट' },
      { href: '/support', icon: '📨', label: 'My Tickets', labelHi: 'मेरे टिकट' },
    ],
  },
];
```

In `getSidebarSections(role)`, branch on the `ff_study_menu_v2` flag (already loaded into the `flags` Record in the component body):

```tsx
function getSidebarSections(role: UserRole, flags: Record<string, boolean>) {
  if (role === 'teacher') { /* unchanged */ }
  if (role === 'guardian') { /* unchanged */ }
  // student
  return flags[STUDY_MENU_FLAGS.V2] === true
    ? SIDEBAR_SECTIONS_V2
    : SIDEBAR_SECTIONS_LEGACY;
}
```

Wire the call site (search for `getSidebarSections(activeRole)` inside the component body) to pass `flags`.

Do the same for `MORE_ITEMS` (lines 61-74) — create `MORE_ITEMS_LEGACY` and `MORE_ITEMS_V2`, where V2 contains the three new items (Library / Refresh / Exam Sprint) instead of the four old ones.

Also: hide the Exam Sprint item when no exam is upcoming. Add this logic to the render loop (look for where the sidebar maps `items`):

```tsx
// Inside the item.map(...) — filter out exam-prep when no exam:
const visibleItems = section.items.filter(item => {
  if ((item as any).requiresUpcomingExam && !hasUpcomingExam) return false;
  return true;
});
```

Add a `hasUpcomingExam` state derived from a `useEffect` that queries `upcoming_exams` for the student (similar to the /exam-prep page's query). Cache for 5 minutes to avoid hammering Supabase on every render.

- [ ] **Step 3: Manually smoke-test both flag states**

Run: `npm run dev` and toggle the flag in `feature_flags` table:

```sql
update feature_flags set is_enabled = true where flag_name = 'ff_study_menu_v2';
-- (test, then flip back)
update feature_flags set is_enabled = false where flag_name = 'ff_study_menu_v2';
```

Expected with flag ON: sidebar shows STUDY group with 3 items (or 2 if no upcoming exam). With flag OFF: sidebar shows REVIEW group with 4 items unchanged.

- [ ] **Step 4: Type-check + lint + build**

Run: `npm run type-check && npm run lint && npm run build`

Expected: 0 errors. Bundle size for any page with BottomNav still under budget.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/BottomNavComponent.tsx
git commit -m "feat(study-menu): flag-gate sidebar Study group + Exam Sprint visibility"
```

### Task 5.2: Update internal /review and /study-plan links (flag-gated)

**Files:**
- Modify: 9 files listed below

The plan keeps the old routes alive during the soak period, so links should point to the NEW routes only when the flag is ON. The simplest pattern is a tiny helper:

- [ ] **Step 1: Add a helper**

Create `src/lib/routes/study-menu-routes.ts`:

```ts
import { STUDY_MENU_FLAGS } from '@/lib/feature-flags';

/**
 * Returns the correct destination URL depending on whether
 * ff_study_menu_v2 is enabled for this user.
 *
 * Used by every component that historically linked to /review,
 * /revise, or /study-plan so the soak period can flip without
 * breaking deep links.
 */
export function reviewRoute(flags: Record<string, boolean>): string {
  return flags[STUDY_MENU_FLAGS.V2] === true ? '/refresh' : '/review';
}
export function reviseRoute(flags: Record<string, boolean>): string {
  return flags[STUDY_MENU_FLAGS.V2] === true ? '/refresh?tab=chapters' : '/revise';
}
export function studyPlanRoute(flags: Record<string, boolean>): string {
  return flags[STUDY_MENU_FLAGS.V2] === true ? '/exam-prep' : '/study-plan';
}
```

- [ ] **Step 2: Apply the helper at every call site**

For each of the following files, replace the hard-coded URL with the helper call. The component must already have access to a `flags` Record (most do via `getFeatureFlags()` or the `useDashboardData` SWR hook). If not, add a `useEffect` to load flags or accept `flags` as a prop.

| File | Line | From | To |
|---|---|---|---|
| `src/components/quiz/QuizResults.tsx` | 734 | `router.push('/review')` | `router.push(reviewRoute(flags))` |
| `src/components/dashboard/TodaysPlan.tsx` | 138 | `router.push('/review')` | `router.push(reviewRoute(flags))` |
| `src/components/dashboard/ComebackHook.tsx` | 87 | `router.push('/review')` | `router.push(reviewRoute(flags))` |
| `src/components/dashboard/FoxyBannerCard.tsx` | 55 | `router.push('/review')` | `router.push(reviewRoute(flags))` |
| `src/components/dashboard/sections/TodaysFocusSection.tsx` | 139 | `router.push('/review')` | `router.push(reviewRoute(flags))` |
| `src/components/learn/ChapterReadinessCard.tsx` | 138 | `router.push('/review')` | `router.push(reviewRoute(flags))` |
| `src/components/progress/LearningJourney.tsx` | 161 | `router.push('/study-plan')` | `router.push(studyPlanRoute(flags))` |
| `src/app/dashboard/AtlasDashboard.tsx` | 542 | `router.push('/review')` | `router.push(reviewRoute(flags))` |
| `src/app/study-plan/page.tsx` | 583 | `router.push('/review')` | `router.push(reviewRoute(flags))` |

Also update the QuizResults "Re-read this chapter" deep-link if it points to `/revise?from=quiz&subject=...&chapter=...` — search QuizResults.tsx for `/revise` and replace with `reviseRoute(flags)` while preserving the query string.

- [ ] **Step 3: Type-check + lint + tests**

Run: `npm run type-check && npm run lint && npm test`

Expected: 0 errors. Existing dashboard and quiz tests still pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/routes/study-menu-routes.ts src/components/quiz/QuizResults.tsx src/components/dashboard/ src/components/learn/ChapterReadinessCard.tsx src/components/progress/LearningJourney.tsx src/app/dashboard/AtlasDashboard.tsx src/app/study-plan/page.tsx
git commit -m "feat(study-menu): flag-gate internal /review and /study-plan links"
```

---

## Phase 6 — Redirects + E2E + telemetry + cleanup

### Task 6.1: Add 301 redirects in next.config.js

**Files:**
- Modify: `next.config.js` (line 72-74)

- [ ] **Step 1: Replace `async redirects()`**

Change:
```js
async redirects() {
  return [];
},
```

To:
```js
async redirects() {
  return [
    // Study Menu v2 — old routes redirect to their new homes.
    // 301 permanent; preserves bookmarks. Once Phase 6 deletes the old
    // route files these redirects are the only thing serving the old URLs.
    // Spec: docs/superpowers/specs/2026-05-20-study-section-consolidation-design.md
    { source: '/review',     destination: '/refresh?tab=flashcards', permanent: true },
    { source: '/revise',     destination: '/refresh?tab=chapters',   permanent: true },
    { source: '/study-plan', destination: '/exam-prep',              permanent: true },
  ];
},
```

**IMPORTANT:** These redirects fire BEFORE the page file is matched. Once they're in place the old `/review`, `/revise`, `/study-plan` page files become unreachable via direct navigation. **Do NOT enable these until Phase 5's flag rollout reaches 100% (Day 5 in the spec's flag-rollout calendar).** Track this with a code comment and a TODO in the commit message.

- [ ] **Step 2: Verify locally with flag ON**

Set the flag to true in DB:

```sql
update feature_flags set is_enabled = true where flag_name = 'ff_study_menu_v2';
```

Run: `npm run dev` and visit `http://localhost:3000/review` — expect a 301 to `/refresh?tab=flashcards` and the page renders. Same for `/revise` → `/refresh?tab=chapters` and `/study-plan` → `/exam-prep`.

- [ ] **Step 3: Run build**

Run: `npm run build`

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add next.config.js
git commit -m "feat(study-menu): 301 redirects from old routes to new"
```

### Task 6.2: E2E test — /refresh sections + redirects + Section D submission

**Files:**
- Create: `e2e/refresh-page.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test';
import { loginAsTestStudent, enableFlag } from './helpers';  // existing helpers in e2e/

test.describe('/refresh page (Study Menu v2)', () => {
  test.beforeEach(async ({ page }) => {
    await enableFlag(page, 'ff_study_menu_v2', true);
    await loginAsTestStudent(page);
  });

  test('renders /refresh shell with no errors', async ({ page }) => {
    await page.goto('/refresh');
    await expect(page.getByRole('heading', { name: /refresh/i })).toBeVisible();
    await expect(page.getByTestId('refresh-section-d')).toBeVisible(); // Section D always renders
  });

  test('Build Your Own Deck composer submits successfully', async ({ page }) => {
    await page.goto('/refresh');
    await page.getByTestId('refresh-byod-open').click();
    await page.getByTestId('refresh-byod-subject').selectOption('physics');
    await page.getByTestId('refresh-byod-front').fill('What is Newton\'s second law?');
    await page.getByTestId('refresh-byod-back').fill('F = ma');
    await page.getByTestId('refresh-byod-submit').click();
    await expect(page.getByText(/added/i)).toBeVisible({ timeout: 5000 });
  });

  test('/review 301 redirects to /refresh?tab=flashcards', async ({ page }) => {
    const response = await page.goto('/review');
    expect(response?.status()).toBe(200);  // after redirect
    expect(page.url()).toContain('/refresh');
    expect(page.url()).toContain('tab=flashcards');
  });

  test('/revise 301 redirects to /refresh?tab=chapters', async ({ page }) => {
    await page.goto('/revise');
    expect(page.url()).toContain('/refresh');
    expect(page.url()).toContain('tab=chapters');
  });

  test('/study-plan 301 redirects to /exam-prep', async ({ page }) => {
    await page.goto('/study-plan');
    expect(page.url()).toContain('/exam-prep');
  });
});
```

- [ ] **Step 2: Run the spec**

Run: `npx playwright test e2e/refresh-page.spec.ts`

Expected: 5 PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/refresh-page.spec.ts
git commit -m "test(refresh): E2E for /refresh sections + redirects + Section D"
```

### Task 6.3: Add the regression catalog entry

**Files:**
- Modify: `.claude/regression-catalog.md`

- [ ] **Step 1: Append REG-69**

Add this entry at the bottom of `.claude/regression-catalog.md` (or in the next-available REG slot):

```
### REG-69: Study Menu v2 — /refresh consolidation + Build Your Own Deck

**Status:** Catalogued 2026-05-20.

**Invariant covered:** P14 (review chain — frontend route consolidation),
P10 (bundle budget — /refresh under 220 kB), and the implicit "no engine
drift" rule (SM-2 unchanged).

**What this catches:**
1. If someone reverts the BottomNav `SIDEBAR_SECTIONS_V2` table, the E2E
   asserts the sidebar still has Library + Refresh + Exam Sprint when
   ff_study_menu_v2 is on.
2. If someone removes the 301 redirects, the redirect tests fail.
3. If someone breaks Section D's POST /api/learner/cards/create, the
   component test + the API unit test both fail.
4. If the spaced_repetition_cards.source check constraint regresses, the
   API unit test that asserts source='student_created' fails on the DB
   write.

**Test files:**
- `e2e/refresh-page.spec.ts` — 5 tests (shell, Section D, 3 redirects)
- `src/__tests__/api/learner/cards/create.test.ts` — 6 unit tests
- `src/__tests__/components/refresh/BuildYourOwnDeckSection.test.tsx` — 4 component tests

**Spec:** docs/superpowers/specs/2026-05-20-study-section-consolidation-design.md
**Plan:** docs/superpowers/plans/2026-05-20-study-section-consolidation-plan.md
```

- [ ] **Step 2: Commit**

```bash
git add .claude/regression-catalog.md
git commit -m "docs(regression-catalog): add REG-69 for Study Menu v2"
```

### Task 6.4: Flag flip + post-rollout cleanup (Day 12-14)

**This task ONLY runs AFTER the spec's Day-5 100% rollout has soaked successfully.** Do not execute on the same day as the implementation.

- [ ] **Step 1: Delete the old route files**

```bash
rm src/app/review/page.tsx
rm src/app/revise/page.tsx
rm src/app/study-plan/page.tsx
```

- [ ] **Step 2: Delete the now-unused ff_revise_route_v1 flag**

Create migration `supabase/migrations/20260603120000_remove_ff_revise_route_v1.sql`:

```sql
BEGIN;
DELETE FROM public.feature_flags WHERE flag_name = 'ff_revise_route_v1';
COMMIT;
```

Apply via `supabase db push`.

- [ ] **Step 3: Simplify BottomNavComponent.tsx**

Remove `SIDEBAR_SECTIONS_LEGACY` and `MORE_ITEMS_LEGACY`. Remove the flag branch in `getSidebarSections`. The sidebar now always renders the V2 shape.

- [ ] **Step 4: Remove the route helpers' fallback**

In `src/lib/routes/study-menu-routes.ts`, the helpers now always return the V2 URLs unconditionally. Or, even simpler, delete the helper and inline the V2 URLs at every call site that referenced them.

- [ ] **Step 5: Remove ff_study_menu_v2 flag itself**

Create migration `supabase/migrations/20260603120100_remove_ff_study_menu_v2.sql`:

```sql
BEGIN;
DELETE FROM public.feature_flags WHERE flag_name = 'ff_study_menu_v2';
COMMIT;
```

- [ ] **Step 6: Type-check + lint + test + build + E2E**

Run: `npm run type-check && npm run lint && npm test && npm run build && npx playwright test`

Expected: All exit 0. E2E spec updated to no longer flip the flag (it's gone) — replace `enableFlag(page, 'ff_study_menu_v2', true)` with a no-op.

- [ ] **Step 7: Commit cleanup as one PR**

```bash
git add -A
git commit -m "chore(study-menu): retire /review, /revise, /study-plan + flag cleanup"
```

---

## Self-Review

### Spec coverage check

Every section of the spec maps to a task:

| Spec section | Task(s) |
|---|---|
| §5 Architecture (3 new routes, 1 flag) | 1.1, 1.2, 2.4, 4.1 |
| §6 Section A Quick Recall | 2.1 |
| §6 Section B Chapter Refresh | 2.2 |
| §6 Section C Retention Tests | 2.3 |
| §6 Section D Build Your Own Deck | 3.1, 3.2, 3.3, 3.4 |
| §6 Empty-state nudge when all hide | 2.4 step 1 |
| §6 ?tab= deep-link smooth-scroll | 2.4 step 1 |
| §7 /exam-prep context-aware + hide when no exam | 4.1, 5.1 step 2 |
| §7 /exam-prep deletes wizard ceremony | 4.1 step 2 |
| §8 301 redirects | 6.1 |
| §8 Internal link updates | 5.2 |
| §8 Flag rollout (Day 0/1/2/5/12/14) | 6.1 step 1 comment + 6.4 |
| §9 Telemetry (learner.card_created event) | NOT in this plan — add as a follow-up task in subsequent plan when ff_event_bus_v1 contract is finalized |
| §10 Bilingual strings | Inlined in components 2.1-2.4, 3.3, 4.1 |
| §11 Data flow | Captured by Tasks 2.x + 3.x + 4.x |
| §12 Failure modes (rate limit, abuse, empty state, deep-links, bundle) | 3.2 (daily cap), 2.4 (empty state), 5.2 (deep-link sweep) |
| §13 Open questions | Already answered by CEO ("Approved as-is") — recommendations baked in |
| §14 Six-phase plan | Phases 1-6 of this doc |
| §15 Review chain | Final commit triggers: testing (E2E + units), assessment (Section D card-creation), quality, mobile (route sync), ops (telemetry) |
| §16 Success criteria | Measured post-rollout by ops via super-admin analytics — no plan task |

**Gap identified:** Telemetry events (`learner.card_created`, `learner.refresh_section_viewed`, `student.exam_prep_visit`) are not implemented in this plan. The reasons: (a) the event bus is gated by `ff_event_bus_v1` and contract changes flow through a different review chain, (b) the implementation is mechanical (one publishEvent call per event), (c) shipping the page first lets us measure baseline traffic before adding instrumented variants. Tracked as a follow-up plan: `docs/superpowers/plans/2026-05-21-study-menu-v2-telemetry.md` (to be written separately).

### Placeholder scan

No "TBD" / "TODO" / "fill in" found in code blocks. The Phase 4 task references the spec for the full list of edits to `/exam-prep` — this is intentional decomposition (the spec is the source of truth), not a placeholder. Engineer reading Task 4.1 has full file paths, before/after code, exact lines.

### Type consistency

- `reviewRoute()` / `reviseRoute()` / `studyPlanRoute()` signatures are consistent across Phase 5 tasks.
- `QuickRecallSection`'s `onLoaded` and `onGraded` props match how `/refresh/page.tsx` passes them in Task 2.4.
- `BuildYourOwnDeckSection`'s `onCardCreated` prop matches Task 3.4's wiring.
- `STUDY_MENU_FLAGS.V2` resolves to `'ff_study_menu_v2'` across Tasks 1.2, 5.1, 5.2.
- The `spaced_repetition_cards.source` value `'student_created'` is consistent across migration 1.1, API route 3.2, and component test 3.3.

No naming drift detected.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-20-study-section-consolidation-plan.md`. Two execution options:**

1. **Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration. Good for this plan because tasks are isolated and the orchestrator can spawn frontend + backend + testing in sequence.

2. **Inline Execution** — Execute tasks in this session using executing-plans, batch with checkpoints. Good if you want to watch the work happen live.

Recommend **Subagent-Driven** for this plan: 18 tasks across 6 phases, with parallel-safe boundaries between Phase 2 (components) and Phase 4 (exam-prep). Two reviewers (assessment, mobile) need a final pass after Phase 5 lands.

**Which approach?**
