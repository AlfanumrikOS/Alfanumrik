'use client';

/**
 * SnapDoubt — screen 10 "Snap a doubt" (`/foxy/snap`, `ff_foxy_snap_v1`).
 *
 * PRESENTATIONAL ONLY. Fetches nothing — every value is a prop, every write
 * (text submit, block select, intent tap, retry) is a callback the page
 * owns. House design system only: CSS custom properties (--orange,
 * --surface-*, --text-*, --border, --font-display), matching
 * packages/ui/src/today/v2/TodayHomeV2.tsx and
 * packages/ui/src/profile/v2/ProfileScreen.tsx. No third token system, no
 * `tokens/student-v2.ts` / `primitives/student-v2.tsx` import (house-CSS-var
 * decision for this build, see the calling page's doc comment).
 *
 * ============================================================================
 * WHAT IS REAL vs WHAT IS A PLACEHOLDER — read this before touching this file
 * ============================================================================
 *
 * SCREENS.md flags this screen ⛔ blocked on two real product/infra decisions
 * that are NOT this component's to make: (1) which OCR service/path to use,
 * and (2) whether the captured image is stored or discarded after extraction
 * (DPDP privacy call — SCREENS.md's own recommendation is discard-after-
 * extract). Neither decision is implemented here. This component ships
 * "taking extracted text as a prop" per SCREENS.md's own instruction, so it
 * is reviewable now without pre-empting either call.
 *
 * REAL (fully wired, exercisable end-to-end):
 *   - The typed-text fallback capture path. There is no camera/OCR call
 *     anywhere in this component — a student TYPES or pastes their question,
 *     and that exact text becomes the one "detected" block. This is the
 *     "your call" the spec left to engineering for making the flow
 *     exercisable without a camera; a text fallback is more honest than a
 *     camera button that silently does nothing.
 *   - Block SELECTION (tapping a block to work on it) — a real state
 *     transition that advances the flow to topic-matching + intents.
 *   - Topic matching — `match` is computed by the PAGE from the real
 *     `curriculum_topics` read (`useSnapCurriculumTopics` / the existing
 *     `GET /api/v2/learn/curriculum` route) via the deterministic
 *     `matchTopicFromText()` heuristic (`@alfanumrik/lib/foxy/snap-topic-match`).
 *     No AI/RAG call — see that module's doc comment.
 *   - The three intents (Explain / How to start / Hint only) — `onIntent`
 *     is expected to navigate to the REAL, EXISTING `/foxy` deep-link
 *     mechanism (`subject` + `mode` + `topic` + `prompt` query params — the
 *     exact same mechanism `learn/[subject]/[chapter]/page.tsx`'s "Ask Foxy"
 *     button already uses). The `mode` is NOT the same for all three:
 *     `explain` hands off as `doubt`, while `steps` and `hint` hand off as
 *     `homework` (Socratic ladder, never states the assigned problem's final
 *     answer). That mapping lives in the page (`INTENT_MODE`), not here —
 *     but it is why the `steps` label reads "How to start" rather than
 *     promising a full solution. See the page for the actual href
 *     construction; this component only calls the callback.
 *
 * PLACEHOLDER (clearly labeled in the UI, does not pretend to work):
 *   - "Take a photo" — permanently disabled here. No `getUserMedia`/camera
 *     API call, no image upload, no OCR call. Labeled "not connected yet" in
 *     both languages so it cannot be mistaken for a working camera button.
 *   - "Tap to crop" — a purely visual, inert affordance per block (a dashed
 *     frame + an "Adjust crop" pill). Clicking it does NOT crop anything;
 *     it only reveals a one-line note that cropping isn't wired up. There is
 *     no image, so there is nothing real to crop — this is UI scaffolding
 *     for a future camera/OCR integration, not a working feature.
 *
 * A future engineer wiring the real camera/OCR path should replace the
 * "capture" step's typed-text form with the real capture UI, have the OCR
 * result populate `blocks` (already the right shape — `{ id, text }`), and
 * decide whether to implement real per-block cropping before that point;
 * everything downstream (selection, topic match, three intents) already
 * works against arbitrary block text and needs no change.
 */

import { useState } from 'react';
import { Skeleton, EmptyState, Button } from '@alfanumrik/ui/ui';

export interface SnapDoubtBlock {
  id: string;
  /** The extracted (today: typed) question text. */
  text: string;
}

export interface SnapDoubtTopicMatch {
  topicId: string;
  title: string;
  titleHi: string | null;
  subjectCode: string;
  subjectName: string;
  chapterNumber: number | null;
  /** 0..1 — see `matchTopicFromText()`. */
  confidence: number;
}

export type SnapDoubtIntent = 'explain' | 'steps' | 'hint';

export interface SnapDoubtProps {
  isHi: boolean;
  /** Loading the real curriculum-topics read (for matching), not the blocks. */
  topicsLoading: boolean;
  topicsError: boolean;
  onRetryTopics: () => void;
  /** Blocks captured so far. Empty = the initial "capture" step. */
  blocks: SnapDoubtBlock[];
  /** Real: turns typed text into a new block. */
  onSubmitText: (text: string) => void;
  /** Real: clears all blocks and returns to the capture step. */
  onReset: () => void;
  selectedBlockId: string | null;
  /** Real: selects a block, advancing to topic-match + intents. */
  onSelectBlock: (id: string) => void;
  /** Real match for the currently-selected block, computed by the page. `null` = no confident match (or nothing selected yet). */
  match: SnapDoubtTopicMatch | null;
  /** Real: routes the selected block + match into the existing /foxy deep link. */
  onIntent: (intent: SnapDoubtIntent, block: SnapDoubtBlock) => void;
}

// The `steps` label used to read "Just the steps" / "सिर्फ़ स्टेप्स", which
// promised a full worked solution. The page now routes that intent through
// Foxy's `homework` mode, which will NOT solve an assigned problem end-to-end
// — so the button must not promise one. "How to start" / "कैसे शुरू करें" is
// what the student actually gets: the setup and the first step. See
// `INTENT_MODE` in apps/host/src/app/foxy/snap/page.tsx.
const INTENTS: Array<{ id: SnapDoubtIntent; icon: string; label: string; labelHi: string }> = [
  { id: 'explain', icon: '💡', label: 'Explain', labelHi: 'समझाओ' },
  { id: 'steps', icon: '📋', label: 'How to start', labelHi: 'कैसे शुरू करें' },
  { id: 'hint', icon: '🔑', label: 'Hint only', labelHi: 'सिर्फ़ संकेत' },
];

function ConfidenceBar({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const color = confidence >= 0.6 ? '#16A34A' : confidence >= 0.45 ? '#F59E0B' : 'var(--text-3)';
  return (
    <div className="w-16 h-1.5 rounded-full overflow-hidden flex-shrink-0" style={{ background: 'var(--surface-2)' }}>
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

/** The capture step — typed-text fallback is REAL; the camera button is a labeled placeholder. */
function CaptureStep({
  isHi,
  onSubmitText,
}: {
  isHi: boolean;
  onSubmitText: (text: string) => void;
}) {
  const [value, setValue] = useState('');

  return (
    <section data-testid="snap-capture-step" className="flex flex-col gap-4">
      {/* Placeholder — no camera/OCR call. Permanently disabled and labeled. */}
      <button
        type="button"
        disabled
        aria-disabled="true"
        data-testid="snap-camera-placeholder"
        className="w-full rounded-2xl p-6 text-center cursor-not-allowed"
        style={{ background: 'var(--surface-2)', border: '2px dashed var(--border)', color: 'var(--text-3)' }}
      >
        <div className="text-4xl mb-2" aria-hidden="true">📷</div>
        <p className="text-sm font-bold" style={{ color: 'var(--text-2)' }}>
          {isHi ? 'फ़ोटो लो' : 'Take a photo'}
        </p>
        <p className="text-xs mt-1">
          {isHi ? 'अभी कनेक्ट नहीं है — जल्द आ रहा है' : 'Not connected yet — coming soon'}
        </p>
      </button>

      <div className="flex items-center gap-2">
        <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
        <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
          {isHi ? 'या' : 'or'}
        </span>
        <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
      </div>

      <div>
        <label htmlFor="snap-text-input" className="text-xs font-bold mb-2 block" style={{ color: 'var(--text-2)' }}>
          {isHi ? 'अपना सवाल टाइप करो' : 'Type your doubt'}
        </label>
        <textarea
          id="snap-text-input"
          data-testid="snap-text-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={4}
          placeholder={isHi ? 'जैसे: 3x + 5 = 20 हल करो' : 'e.g. Solve: 3x + 5 = 20'}
          className="w-full rounded-xl p-3 text-sm"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
        />
        <button
          type="button"
          data-testid="snap-detect-button"
          disabled={value.trim().length === 0}
          onClick={() => {
            const text = value.trim();
            if (!text) return;
            onSubmitText(text);
            setValue('');
          }}
          className="w-full rounded-xl text-sm font-bold mt-3"
          style={{
            minHeight: 48,
            background: 'var(--accent-warm-strong)',
            color: 'var(--on-accent)',
            opacity: value.trim().length === 0 ? 0.5 : 1,
          }}
        >
          {isHi ? 'सवाल पहचानो' : 'Detect question'}
        </button>
      </div>
    </section>
  );
}

/** One "detected" block. Selecting it is real; "Adjust crop" is an inert placeholder. */
function BlockCard({
  block,
  isHi,
  selected,
  onSelect,
}: {
  block: SnapDoubtBlock;
  isHi: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const [showCropNote, setShowCropNote] = useState(false);

  return (
    <div
      data-testid={`snap-block-${block.id}`}
      data-selected={selected}
      className="rounded-2xl p-4"
      style={{
        background: 'var(--surface-1)',
        border: selected ? '2px solid var(--orange)' : '1px dashed var(--border)',
      }}
    >
      <button
        type="button"
        onClick={onSelect}
        data-testid={`snap-block-select-${block.id}`}
        className="w-full text-left"
      >
        <p className="text-sm" style={{ color: 'var(--text-1)' }}>{block.text}</p>
      </button>
      <div className="flex items-center justify-between mt-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
          {isHi ? 'पता चला पाठ (अनक्रॉप्ड)' : 'Detected text (uncropped)'}
        </span>
        <button
          type="button"
          data-testid={`snap-crop-placeholder-${block.id}`}
          onClick={(e) => {
            e.stopPropagation();
            setShowCropNote((v) => !v);
          }}
          className="text-[10px] font-bold px-2 py-1 rounded-md"
          style={{ background: 'var(--surface-2)', color: 'var(--text-3)', border: '1px solid var(--border)' }}
        >
          {isHi ? '✂ क्रॉप एडजस्ट करो' : '✂ Adjust crop'}
        </button>
      </div>
      {showCropNote && (
        <p className="text-[11px] mt-2" style={{ color: 'var(--text-3)' }} data-testid={`snap-crop-note-${block.id}`}>
          {isHi
            ? 'क्रॉपिंग अभी कनेक्ट नहीं है — पूरा पता चला पाठ इस्तेमाल हो रहा है।'
            : "Cropping isn't wired up yet — the full detected text is used as-is."}
        </p>
      )}
    </div>
  );
}

export default function SnapDoubt({
  isHi,
  topicsLoading,
  topicsError,
  onRetryTopics,
  blocks,
  onSubmitText,
  onReset,
  selectedBlockId,
  onSelectBlock,
  match,
  onIntent,
}: SnapDoubtProps) {
  const selectedBlock = blocks.find((b) => b.id === selectedBlockId) ?? null;

  return (
    <main className="app-container py-6 pb-nav" data-testid="snap-doubt-screen">
      <h1 className="text-2xl font-bold mb-1" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}>
        {isHi ? 'सवाल स्नैप करो' : 'Snap a doubt'}
      </h1>
      <p className="text-sm mb-5" style={{ color: 'var(--text-3)' }}>
        {isHi
          ? 'अपना सवाल टाइप करो — कैमरा अभी नहीं जुड़ा है।'
          : "Type your doubt below — camera capture isn't connected yet."}
      </p>

      {/* Empty state = the capture step itself. */}
      {blocks.length === 0 ? (
        <CaptureStep isHi={isHi} onSubmitText={onSubmitText} />
      ) : (
        <div className="flex flex-col gap-3" data-testid="snap-blocks-step">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
              {isHi ? 'पता चले सवाल' : 'Detected questions'}
            </p>
            <button
              type="button"
              onClick={onReset}
              data-testid="snap-reset"
              className="text-xs font-semibold"
              style={{ color: 'var(--orange)' }}
            >
              {isHi ? 'फिर से शुरू करो' : 'Start over'}
            </button>
          </div>

          {blocks.map((block) => (
            <BlockCard
              key={block.id}
              block={block}
              isHi={isHi}
              selected={block.id === selectedBlockId}
              onSelect={() => onSelectBlock(block.id)}
            />
          ))}

          {selectedBlock && (
            <section data-testid="snap-match-panel" className="rounded-2xl p-4 mt-2" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
              <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--text-3)' }}>
                {isHi ? 'मिलता-जुलता विषय' : 'Matched topic'}
              </p>

              {topicsLoading ? (
                <Skeleton height={48} rounded="rounded-xl" />
              ) : topicsError ? (
                <EmptyState
                  icon="😕"
                  title={isHi ? 'विषय लोड नहीं हो पाए' : "Couldn't load topics"}
                  action={
                    <Button variant="soft" onClick={onRetryTopics}>
                      {isHi ? 'फिर कोशिश करें' : 'Retry'}
                    </Button>
                  }
                />
              ) : match ? (
                <div className="flex items-center gap-3" data-testid="snap-match-found">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate" style={{ color: 'var(--text-1)' }}>
                      {isHi && match.titleHi ? match.titleHi : match.title}
                    </p>
                    <p className="text-xs truncate" style={{ color: 'var(--text-3)' }}>
                      {match.subjectName}
                      {match.chapterNumber != null ? ` · ${isHi ? 'अध्याय' : 'Ch.'} ${match.chapterNumber}` : ''}
                    </p>
                  </div>
                  <ConfidenceBar confidence={match.confidence} />
                </div>
              ) : (
                <p className="text-xs" data-testid="snap-match-none" style={{ color: 'var(--text-3)' }}>
                  {isHi
                    ? 'कोई भरोसेमंद मिलान नहीं मिला — फिर भी Foxy से पूछ सकते हो।'
                    : "No confident match — you can still ask Foxy."}
                </p>
              )}

              <div className="grid grid-cols-3 gap-2 mt-4">
                {INTENTS.map((intent) => (
                  <button
                    key={intent.id}
                    type="button"
                    data-testid={`snap-intent-${intent.id}`}
                    onClick={() => onIntent(intent.id, selectedBlock)}
                    className="rounded-xl p-2.5 text-center"
                    style={{ background: 'rgba(232,88,28,0.08)', border: '1px solid rgba(232,88,28,0.18)' }}
                  >
                    <div className="text-lg mb-0.5" aria-hidden="true">{intent.icon}</div>
                    <div className="text-[11px] font-bold" style={{ color: 'var(--orange)' }}>
                      {isHi ? intent.labelHi : intent.label}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </main>
  );
}
