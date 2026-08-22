'use client';

/**
 * ErasePanel — per-layer memory erasure control for the student memory screen
 * ("What Foxy remembers about me", Foxy North-Star Phase 1).
 *
 * Flow: pick a layer → confirm dialog (explains that erasing blanks Foxy's
 * memory immediately and data is purged within 30 days) → onErase(layer).
 * The page owns the DELETE /api/learner/memory call; this component is
 * presentation + confirmation only. Bilingual (P7).
 */

import { useState } from 'react';

/**
 * UI layer keys — mirror the GET /api/learner/memory response keys (camelCase).
 * These are NOT the DELETE wire values: the page maps them to the canonical
 * scope.layer enum ('preferences'|'long_memory'|'twin'|'cognitive', snake_case
 * long_memory) before calling DELETE /api/learner/memory.
 */
export type MemoryLayer = 'cognitive' | 'longMemory' | 'preferences';

export const MEMORY_LAYER_LABELS: Record<MemoryLayer, { en: string; hi: string }> = {
  cognitive: { en: 'Learning memory', hi: 'सीखने की मेमोरी' },
  longMemory: { en: 'Monthly summary', hi: 'मासिक सारांश' },
  preferences: { en: 'My preferences', hi: 'मेरी पसंद' },
};

export interface ErasePanelProps {
  isHi: boolean;
  /** Layer currently being erased (disables the buttons), or null. */
  erasingLayer: MemoryLayer | null;
  /** Called after the student CONFIRMS the erase dialog. */
  onErase: (layer: MemoryLayer) => void;
  /**
   * Display label of the currently-selected subject. Currently UNUSED in the
   * dialog copy: v1 purge is layer-wide; subject narrowing not yet honored
   * server-side — do not imply subject-only. Kept for when v2 honors it.
   */
  subjectLabel?: string;
}

export default function ErasePanel({ isHi, erasingLayer, onErase }: ErasePanelProps) {
  const [confirmLayer, setConfirmLayer] = useState<MemoryLayer | null>(null);

  const layers = Object.keys(MEMORY_LAYER_LABELS) as MemoryLayer[];

  return (
    <section
      aria-label={isHi ? 'मेमोरी मिटाएँ' : 'Erase memory'}
      className="rounded-2xl p-4"
      style={{
        background: 'var(--surface-1, #fff)',
        border: '1.5px solid rgba(220,38,38,0.25)',
      }}
    >
      <h2
        className="text-sm font-bold mb-1"
        style={{ color: 'var(--text-1)', fontFamily: 'var(--font-display)' }}
      >
        🗑️ {isHi ? 'फॉक्सी की याददाश्त मिटाओ' : "Erase Foxy's memory"}
      </h2>
      <p className="text-xs mb-3" style={{ color: 'var(--text-3)' }}>
        {isHi
          ? 'यह तुम्हारा डेटा है — तुम इसे कभी भी मिटा सकते हो।'
          : 'This is your data — you can erase it any time.'}
      </p>

      <div className="flex flex-col gap-2">
        {layers.map((layer) => (
          <button
            key={layer}
            type="button"
            onClick={() => setConfirmLayer(layer)}
            disabled={erasingLayer !== null}
            className="w-full flex items-center justify-between rounded-xl px-3 py-3 min-h-[44px] text-sm font-semibold transition-all active:scale-[0.98] disabled:opacity-50"
            style={{ background: 'var(--surface-2, #F4F0E9)', color: 'var(--text-1)', border: '1px solid var(--border, #E5E0D8)' }}
          >
            <span>{isHi ? MEMORY_LAYER_LABELS[layer].hi : MEMORY_LAYER_LABELS[layer].en}</span>
            <span className="text-xs font-bold" style={{ color: '#DC2626' }}>
              {erasingLayer === layer
                ? (isHi ? 'मिटाया जा रहा है…' : 'Erasing…')
                : (isHi ? 'मिटाओ' : 'Erase')}
            </span>
          </button>
        ))}
      </div>

      {/* Confirm dialog */}
      {confirmLayer && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label={isHi ? 'मिटाने की पुष्टि करें' : 'Confirm erase'}
        >
          <button
            type="button"
            aria-label={isHi ? 'संवाद बंद करें' : 'Close dialog'}
            className="absolute inset-0 bg-black/40"
            onClick={() => setConfirmLayer(null)}
          />
          <div
            className="relative w-full max-w-sm rounded-2xl p-5"
            style={{ background: 'var(--surface-1, #fff)' }}
          >
            <div className="text-3xl mb-2" aria-hidden="true">🧹</div>
            <h3 className="text-base font-bold mb-2" style={{ color: 'var(--text-1)', fontFamily: 'var(--font-display)' }}>
              {isHi
                ? `${MEMORY_LAYER_LABELS[confirmLayer].hi} मिटाएँ?`
                : `Erase ${MEMORY_LAYER_LABELS[confirmLayer].en.toLowerCase()}?`}
            </h3>
            <p className="text-sm leading-relaxed mb-1" style={{ color: 'var(--text-2)' }}>
              {/* v1 purge is layer-wide; subject narrowing not yet honored
                  server-side — do not imply subject-only. NO layer's dialog
                  carries a subject parenthetical. */}
              {isHi
                ? 'फॉक्सी की यह याददाश्त तुरंत खाली हो जाएगी — फॉक्सी इसे भूल जाएगा।'
                : "Foxy's memory here will be blanked immediately — Foxy forgets it right away."}
            </p>
            {confirmLayer === 'cognitive' && (
              <p className="text-sm leading-relaxed mb-1" style={{ color: 'var(--text-2)' }}>
                {isHi
                  ? 'फॉक्सी तुम्हें फिर से शुरुआत से जानेगा: तुम्हारा दोहराने का शेड्यूल और सवालों की कठिनाई फिर से सेट होगी। तुम्हारे XP, स्ट्रीक और क्विज़ इतिहास नहीं मिटेंगे।'
                  : 'Foxy will start learning about you again from zero: your revision schedule and recommended question difficulty will reset. Your XP, streak, and quiz history are NOT deleted.'}
              </p>
            )}
            <p className="text-sm leading-relaxed mb-1" style={{ color: 'var(--text-2)' }}>
              {/* Fail-closed guard: while ANY erasure is in flight, ALL Foxy memory is blanked. */}
              {isHi
                ? 'जब तक मिटाना पूरा नहीं होता, फॉक्सी की पूरी याददाश्त खाली रहेगी।'
                : "While the erase is in progress, all of Foxy's memory stays blank."}
            </p>
            <p className="text-sm leading-relaxed mb-4" style={{ color: 'var(--text-2)' }}>
              {isHi
                ? 'तुम्हारा डेटा 30 दिनों के भीतर हमारे सिस्टम से पूरी तरह हटा दिया जाएगा। इसे वापस नहीं लाया जा सकता।'
                : 'Your data is fully purged from our systems within 30 days. This cannot be undone.'}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmLayer(null)}
                className="flex-1 rounded-xl px-3 py-3 min-h-[44px] text-sm font-bold"
                style={{ background: 'var(--surface-2, #F4F0E9)', color: 'var(--text-2)' }}
              >
                {isHi ? 'रद्द करें' : 'Cancel'}
              </button>
              <button
                type="button"
                data-testid="erase-confirm-button"
                onClick={() => {
                  const layer = confirmLayer;
                  setConfirmLayer(null);
                  onErase(layer);
                }}
                className="flex-1 rounded-xl px-3 py-3 min-h-[44px] text-sm font-bold text-white"
                style={{ background: '#DC2626' }}
              >
                {isHi ? 'हाँ, मिटाओ' : 'Yes, erase'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
