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
 *     already uses: `?subject=<code>&mode=doubt&topic=<title>&prompt=<text>
 *     &source=snap_doubt`. `mode=doubt` has no built-in autoPrompt
 *     (`apps/host/src/app/foxy/_lib/foxy-constants.ts`), so the three
 *     intents differ only in the crafted `prompt` text — Foxy auto-sends
 *     whatever `prompt` carries (`apps/host/src/app/foxy/page.tsx`'s
 *     "Auto-send prompt parameter" effect).
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

// Crafted prompt prefixes per intent — the only thing distinguishing the
// three CTAs, since /foxy's `doubt` mode has no built-in autoPrompt.
const INTENT_PROMPT_PREFIX: Record<SnapDoubtIntent, { en: string; hi: string }> = {
  explain: {
    en: 'Explain this doubt in detail, step by step: ',
    hi: 'इस सवाल को विस्तार से, चरण दर चरण समझाओ: ',
  },
  steps: {
    en: 'Give me just the solution steps for this, no long explanation: ',
    hi: 'इसके हल के सिर्फ़ स्टेप्स दो, लंबी व्याख्या मत दो: ',
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
      params.set('mode', 'doubt');
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
