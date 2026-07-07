'use client';

/**
 * FoxyToolsSheet — Foxy OS (ff_foxy_os_v1) mobile Tools bottom sheet (<lg only).
 * Phase 3 of the redesign.
 *
 * The second of the two Foxy OS bottom sheets (the first is FoxyStudySheet).
 * Holds the secondary controls that were previously crammed into the legacy
 * dark-gradient header or not yet surfaced on mobile:
 *   - Language selector (EN / HI / Hinglish) — segmented control.
 *   - Voice auto-speak toggle.
 *   - XP / streak / daily-usage readout (display-only).
 *   - "Chat history" entry → opens the existing ConversationManager slide-over.
 *   - "Your context" entry → opens the existing ContextPanel mobile sheet
 *     (only rendered when the page passes onOpenContext, i.e. ff_student_os_v1
 *     is ON — Tools sheet never invents a context surface that does not exist).
 *
 * PRESENTATION ONLY. Every action calls an existing handler passed as a prop
 * from /foxy/page.tsx — setLanguage / toggleVoiceMode / setConversationSidebarOpen
 * / setContextSheetOpen. No chat / scoring / AI logic lives here. Cosmic light
 * tokens only (no dark mode), CSS-only motion (no framer-motion). Bilingual via
 * `isHi`.
 *
 * Moving the XP / streak / usage readout off the dark gradient INTO this light
 * surface is the contrast fix from the Phase 3 a11y pass (the legacy header used
 * text-[8px]/[10px] at opacity-40/50 on a dark gradient — muted-on-muted). Here
 * the readout renders at >=12px on `--surface-2` with AA-passing `--text-*`.
 *
 * Accessibility: BottomSheet provides role="dialog" aria-modal, Escape, scroll
 * lock, a >=44px drag handle, focus trap, and focus-return-to-trigger. The
 * language control is a role="radiogroup" of role="radio" buttons.
 *
 * Lazy-loaded via dynamic() at the call site so the OFF path fetches zero new
 * chunks (P10).
 */

import { BottomSheet } from '@alfanumrik/ui/ui/primitives';

export interface ToolsSheetLanguage {
  /** Language code passed straight back to onSelectLanguage: 'en' | 'hi' | 'hinglish'. */
  code: string;
  /** Short pill label (EN / HI / Hing). */
  label: string;
}

interface FoxyToolsSheetProps {
  open: boolean;
  onClose: () => void;
  isHi: boolean;

  /** Language segmented control. */
  languages: ToolsSheetLanguage[];
  activeLanguage: string;
  /** When true (hindi/english subjects) the language control is read-only. */
  languageLocked: boolean;
  onSelectLanguage: (code: string) => void;

  /** Voice auto-speak. Hidden entirely when the browser has no TTS. */
  voiceSupported: boolean;
  voiceOn: boolean;
  onToggleVoice: () => void;

  /** Display-only readouts. */
  xpTotal: number;
  streakDays: number;
  studentGrade: string;
  /** Remaining/limit chat messages today, or null when usage is unknown. */
  usageRemaining: number | null;
  usageLimit: number | null;

  /** Opens the existing ConversationManager history slide-over. */
  onOpenHistory: () => void;
  /**
   * Opens the existing ContextPanel mobile sheet. OPTIONAL — present only when
   * the page has the ContextPanel surface available (ff_student_os_v1 ON). When
   * absent, the "Your context" row is not rendered (no invented surface).
   */
  onOpenContext?: () => void;
}

export function FoxyToolsSheet({
  open,
  onClose,
  isHi,
  languages,
  activeLanguage,
  languageLocked,
  onSelectLanguage,
  voiceSupported,
  voiceOn,
  onToggleVoice,
  xpTotal,
  streakDays,
  studentGrade,
  usageRemaining,
  usageLimit,
  onOpenHistory,
  onOpenContext,
}: FoxyToolsSheetProps) {
  // Focus trap + focus-return are provided by the BottomSheet primitive.
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={isHi ? 'टूल्स' : 'Tools'}
      handleLabel={isHi ? 'टूल्स शीट बंद करें' : 'Close tools sheet'}
    >
      <div className="foxy-os-tools space-y-5">
        {/* ── Language selector ──────────────────────────────── */}
        <section>
          <h4 className="foxy-os-study-label" id="foxy-os-lang-label">
            {isHi ? 'भाषा' : 'Language'}
          </h4>
          <div
            role="radiogroup"
            aria-labelledby="foxy-os-lang-label"
            className="grid grid-cols-3 gap-2"
          >
            {languages.map((l) => {
              const isActive = l.code === activeLanguage;
              return (
                <button
                  key={l.code}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  disabled={languageLocked}
                  onClick={() => {
                    if (!languageLocked) onSelectLanguage(l.code);
                  }}
                  className="foxy-os-tools-seg rounded-xl text-xs font-bold transition-all active:scale-[0.97] disabled:cursor-default"
                  style={{
                    background: isActive ? 'var(--orange)' : 'var(--surface-2)',
                    border: isActive ? '1.5px solid var(--orange)' : '1.5px solid var(--border)',
                    color: isActive ? 'var(--on-accent)' : 'var(--text-2)',
                    opacity: languageLocked && !isActive ? 0.4 : 1,
                  }}
                  aria-label={l.label}
                >
                  {l.label}
                </button>
              );
            })}
          </div>
          {languageLocked && (
            <p className="text-xs mt-1.5" style={{ color: 'var(--text-3)' }}>
              {isHi
                ? '🔒 इस विषय में भाषा तय है'
                : '🔒 Language is fixed for this subject'}
            </p>
          )}
        </section>

        {/* ── Voice toggle ───────────────────────────────────── */}
        {voiceSupported && (
          <section>
            <h4 className="foxy-os-study-label">{isHi ? 'आवाज़' : 'Voice'}</h4>
            <button
              type="button"
              onClick={onToggleVoice}
              role="switch"
              aria-checked={voiceOn}
              className="foxy-os-tools-row w-full flex items-center gap-3 rounded-xl text-left transition-all active:scale-[0.99]"
              style={{
                background: voiceOn ? 'color-mix(in srgb, var(--accent-warm) 10%, transparent)' : 'var(--surface-2)',
                border: voiceOn ? '1.5px solid color-mix(in srgb, var(--accent-warm) 40%, transparent)' : '1.5px solid var(--border)',
              }}
              aria-label={
                isHi
                  ? voiceOn
                    ? 'वॉइस मोड बंद करें'
                    : 'वॉइस मोड चालू करें'
                  : voiceOn
                    ? 'Disable voice mode'
                    : 'Enable voice mode'
              }
            >
              <span className="text-lg" aria-hidden="true">{voiceOn ? '🔊' : '🔇'}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold" style={{ color: 'var(--text-1)' }}>
                  {isHi ? 'ऑटो-स्पीक' : 'Auto-speak replies'}
                </span>
                <span className="block text-xs" style={{ color: 'var(--text-3)' }}>
                  {voiceOn
                    ? isHi ? 'चालू — Foxy हर जवाब बोलेगा' : 'On — Foxy reads each reply aloud'
                    : isHi ? 'बंद' : 'Off'}
                </span>
              </span>
              <span
                className="foxy-os-tools-switch shrink-0"
                aria-hidden="true"
                style={{ background: voiceOn ? 'var(--orange)' : 'var(--border)' }}
              >
                <span
                  className="foxy-os-tools-knob"
                  style={{ transform: voiceOn ? 'translateX(18px)' : 'translateX(0)' }}
                />
              </span>
            </button>
          </section>
        )}

        {/* ── XP / streak / usage readout (display-only) ─────── */}
        <section aria-label={isHi ? 'तुम्हारी प्रगति' : 'Your progress'}>
          <h4 className="foxy-os-study-label">{isHi ? 'प्रगति' : 'Progress'}</h4>
          <div className="grid grid-cols-3 gap-2">
            <div
              className="foxy-os-tools-stat rounded-xl text-center"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
            >
              <span className="block text-base font-bold" style={{ color: 'var(--orange)' }}>
                {xpTotal}
              </span>
              <span className="block text-xs" style={{ color: 'var(--text-3)' }}>XP</span>
            </div>
            <div
              className="foxy-os-tools-stat rounded-xl text-center"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
            >
              <span className="block text-base font-bold" style={{ color: 'var(--text-1)' }}>
                {streakDays}
              </span>
              <span className="block text-xs" style={{ color: 'var(--text-3)' }}>
                {isHi ? 'दिन स्ट्रीक' : 'day streak'}
              </span>
            </div>
            <div
              className="foxy-os-tools-stat rounded-xl text-center"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
            >
              <span className="block text-base font-bold" style={{ color: 'var(--text-1)' }}>
                {isHi ? `कक्षा ${studentGrade}` : `Gr ${studentGrade}`}
              </span>
              <span className="block text-xs" style={{ color: 'var(--text-3)' }}>
                {isHi ? 'ग्रेड' : 'grade'}
              </span>
            </div>
          </div>
          {usageRemaining !== null && usageLimit !== null && (
            <p className="text-xs mt-2" style={{ color: 'var(--text-2)' }}>
              💬 {isHi ? 'आज बचे संदेश' : 'Messages left today'}:{' '}
              <span className="font-bold">{usageRemaining}/{usageLimit}</span>
            </p>
          )}
        </section>

        {/* ── Navigation entries ─────────────────────────────── */}
        <section aria-label={isHi ? 'और' : 'More'}>
          <div className="space-y-2">
            <button
              type="button"
              onClick={onOpenHistory}
              className="foxy-os-tools-row w-full flex items-center gap-3 rounded-xl text-left transition-all active:scale-[0.99]"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
              aria-label={isHi ? 'चैट हिस्ट्री खोलें' : 'Open chat history'}
            >
              <span className="text-lg" aria-hidden="true">🕑</span>
              <span className="flex-1 text-sm font-semibold" style={{ color: 'var(--text-1)' }}>
                {isHi ? 'चैट हिस्ट्री' : 'Chat history'}
              </span>
              <span className="text-sm" aria-hidden="true" style={{ color: 'var(--text-3)' }}>›</span>
            </button>

            {onOpenContext && (
              <button
                type="button"
                onClick={onOpenContext}
                className="foxy-os-tools-row w-full flex items-center gap-3 rounded-xl text-left transition-all active:scale-[0.99]"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
                aria-label={isHi ? 'तुम्हारा संदर्भ खोलें' : 'Open your context'}
              >
                <span className="text-lg" aria-hidden="true">🧭</span>
                <span className="flex-1 text-sm font-semibold" style={{ color: 'var(--text-1)' }}>
                  {isHi ? 'तुम्हारा संदर्भ' : 'Your context'}
                </span>
                <span className="text-sm" aria-hidden="true" style={{ color: 'var(--text-3)' }}>›</span>
              </button>
            )}
          </div>
        </section>
      </div>
    </BottomSheet>
  );
}

export default FoxyToolsSheet;
