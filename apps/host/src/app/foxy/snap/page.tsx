'use client';

/**
 * /foxy/snap — screen 10 "Snap a doubt" (`ff_foxy_snap_v1`). NEW route; it
 * does not exist today. Additive: when the flag is OFF the route behaves as
 * if it never existed (`notFound()`), same shape as `/revision`
 * (`ff_revision_os_v1`) and `/practice` (`ff_practice_os_v1`) — no legacy
 * equivalent to redirect to.
 *
 * SCREENS.md flags this screen ⛔ blocked on two real product/infra
 * decisions this page does NOT make: which OCR path to use, and whether the
 * captured image is stored or discarded after extraction (DPDP). Neither a
 * camera nor an OCR call exists anywhere in this route. See
 * `packages/ui/src/foxy/v2/SnapDoubt.tsx`'s doc comment for the exact
 * real-vs-placeholder breakdown; this page only wires the REAL parts:
 *
 *   - topic matching, via `useSnapCurriculumTopics()` (the EXISTING
 *     `GET /api/v2/learn/curriculum` route — no new query) +
 *     `matchTopicFromText()` (deterministic word-overlap heuristic,
 *     `@alfanumrik/lib/foxy/snap-topic-match`).
 *   - the three-intent hand-off into `/foxy`, using the SAME deep-link
 *     mechanism `learn/[subject]/[chapter]/page.tsx`'s "Ask Foxy" button
 *     already uses: `?subject=<code>&mode=<mode>&topic=<title>&prompt=<text>
 *     &source=snap_doubt`. Neither `mode=doubt` nor `mode=homework` has a
 *     built-in autoPrompt, so the intents differ in TWO things: the `mode`
 *     (see `INTENT_MODE`) and the crafted `prompt` text (see
 *     `INTENT_PROMPT_PREFIX`) — Foxy auto-sends whatever `prompt` carries
 *     (`apps/host/src/app/foxy/page.tsx`'s "Auto-send prompt parameter"
 *     effect).
 *
 * ACADEMIC INTEGRITY (2026-08-31): the mode is NOT uniform across the three
 * intents. `explain` stays `doubt`; `steps` and `hint` route to `homework`,
 * which carries the Socratic hint-ladder directive. `source=snap_doubt` is
 * carried for analytics only — it is NOT read by `/api/foxy`, so it can
 * never be the thing that enforces this. `mode` is. Read `INTENT_MODE`'s
 * comment before changing any of the three.
 */

import { useMemo, useState, useCallback } from 'react';
import { notFound, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useRequireAuth } from '@alfanumrik/lib/useRequireAuth';
import { useFeatureFlags } from '@alfanumrik/lib/swr';
import { useSnapCurriculumTopics } from '@alfanumrik/lib/foxy/use-snap-curriculum-topics';
import { matchTopicFromText } from '@alfanumrik/lib/foxy/snap-topic-match';
import { Skeleton } from '@alfanumrik/ui/ui';
import { SectionErrorBoundary } from '@alfanumrik/ui/SectionErrorBoundary';
import type { SnapDoubtBlock, SnapDoubtIntent, SnapDoubtTopicMatch } from '@alfanumrik/ui/foxy/v2/SnapDoubt';

const SnapDoubt = dynamic(() => import('@alfanumrik/ui/foxy/v2/SnapDoubt'), {
  loading: () => <Skeleton height={320} rounded="rounded-2xl" />,
});

// Foxy mode per intent — NOT uniform, and deliberately so.
//
// A photographed problem is not automatically homework. A student may snap a
// worked textbook example they simply don't understand, and forcing a Socratic
// hint ladder onto that would be worse than today. So the doubt/homework split
// is preserved per intent:
//
//   - `explain` stays `doubt`: genuine concept explanation is a legitimate
//     direct answer, and `foxy_tutor_doubt_v1` (which `doubt` selects) is
//     built for exactly that. Unchanged from launch.
//   - `steps` and `hint` move to `homework`: these are the two taps a student
//     reaches for when the photographed problem is one THEY have been assigned
//     to solve. `MODE_DIRECTIVES.homework`
//     (`packages/lib/src/foxy/prompt-sections.ts`) renders after the template's
//     Output Format section and overrides it with a one-rung-per-turn Socratic
//     ladder plus an explicit "do NOT state its final answer" rule — while
//     still always allowing full concept explanation, checking work the student
//     already did, and solving a DIFFERENT analogous problem.
//
// Before this split, `steps` on a snapped worksheet returned the assigned
// problem solved end-to-end. That was the integrity hole.
const INTENT_MODE: Record<SnapDoubtIntent, 'doubt' | 'homework'> = {
  explain: 'doubt',
  steps: 'homework',
  hint: 'homework',
};

// Crafted prompt prefixes per intent — together with INTENT_MODE above, the
// only thing distinguishing the three CTAs, since neither /foxy's `doubt` nor
// its `homework` mode has a built-in autoPrompt.
//
// These MUST NOT contradict the mode they ship with. The old `steps` text
// ("just the solution steps, no long explanation") asked for precisely what
// `MODE_DIRECTIVES.homework` forbids; sending it under `mode=homework` would
// put two opposing instructions in one prompt. It now asks for the method and
// the FIRST step only — which is rung 2 of the homework ladder, stated in the
// student's own words. `hint` was already ladder-shaped and is unchanged.
const INTENT_PROMPT_PREFIX: Record<SnapDoubtIntent, { en: string; hi: string }> = {
  explain: {
    en: 'Explain this doubt in detail, step by step: ',
    hi: 'इस सवाल को विस्तार से, चरण दर चरण समझाओ: ',
  },
  steps: {
    en: 'Show me how to start this — the setup and the first step only, then let me try the rest: ',
    hi: 'इसे शुरू कैसे करें यह दिखाओ — सिर्फ़ सेटअप और पहला स्टेप, फिर बाक़ी मुझे ख़ुद करने दो: ',
  },
  hint: {
    en: "Give me a hint only — don't solve it or give the final answer: ",
    hi: 'सिर्फ़ एक संकेत दो — इसे हल मत करो और अंतिम उत्तर मत दो: ',
  },
};

let blockIdSeq = 0;
function nextBlockId(): string {
  blockIdSeq += 1;
  return `snap-block-${Date.now()}-${blockIdSeq}`;
}

export default function SnapDoubtPage() {
  const router = useRouter();
  const { isReady, isHi } = useRequireAuth();
  const { data: flags, isLoading: flagsLoading } = useFeatureFlags();
  const flagOn = flags?.ff_foxy_snap_v1 === true;

  const [blocks, setBlocks] = useState<SnapDoubtBlock[]>([]);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);

  // Only fetch the real topic list once the route is confirmed reachable —
  // no point spending a request behind a flag that's about to 404.
  const { topics, isLoading: topicsLoading, error: topicsError, mutate: retryTopics } =
    useSnapCurriculumTopics(flagOn && isReady);

  const selectedBlock = useMemo(
    () => blocks.find((b) => b.id === selectedBlockId) ?? null,
    [blocks, selectedBlockId],
  );

  // Real, synchronous match — recomputed whenever the selected block or the
  // topic list changes. See snap-topic-match.ts for what "real" means here.
  const match: SnapDoubtTopicMatch | null = useMemo(() => {
    if (!selectedBlock || topics.length === 0) return null;
    const best = matchTopicFromText(selectedBlock.text, topics);
    if (!best) return null;
    return {
      topicId: best.topic.id,
      title: best.topic.title,
      titleHi: best.topic.titleHi,
      subjectCode: best.topic.subjectCode,
      subjectName: best.topic.subjectName,
      chapterNumber: best.topic.chapterNumber,
      confidence: best.confidence,
    };
  }, [selectedBlock, topics]);

  const handleSubmitText = useCallback((text: string) => {
    const id = nextBlockId();
    setBlocks((prev) => [...prev, { id, text }]);
    setSelectedBlockId(id);
  }, []);

  const handleReset = useCallback(() => {
    setBlocks([]);
    setSelectedBlockId(null);
  }, []);

  const handleIntent = useCallback(
    (intent: SnapDoubtIntent, block: SnapDoubtBlock) => {
      const prefix = isHi ? INTENT_PROMPT_PREFIX[intent].hi : INTENT_PROMPT_PREFIX[intent].en;
      const params = new URLSearchParams();
      if (match?.subjectCode) params.set('subject', match.subjectCode);
      params.set('mode', INTENT_MODE[intent]);
      if (match?.title) params.set('topic', match.title);
      params.set('prompt', `${prefix}${block.text}`);
      params.set('source', 'snap_doubt');
      router.push(`/foxy?${params.toString()}`);
    },
    [router, isHi, match],
  );

  // Resolved OFF → the route does not exist.
  if (!flagsLoading && !flagOn) {
    notFound();
  }

  // Still resolving flag/auth → neutral loading, never flash a 404.
  if (flagsLoading || !isReady) {
    return (
      <main className="app-container py-6" data-testid="snap-gate-loading">
        <Skeleton height={28} width="40%" className="mb-4" />
        <Skeleton height={220} rounded="rounded-2xl" />
      </main>
    );
  }

  return (
    <SectionErrorBoundary section="Snap a doubt">
      <SnapDoubt
        isHi={isHi}
        topicsLoading={topicsLoading}
        topicsError={topicsError}
        onRetryTopics={() => retryTopics()}
        blocks={blocks}
        onSubmitText={handleSubmitText}
        onReset={handleReset}
        selectedBlockId={selectedBlockId}
        onSelectBlock={setSelectedBlockId}
        match={match}
        onIntent={handleIntent}
      />
    </SectionErrorBoundary>
  );
}
