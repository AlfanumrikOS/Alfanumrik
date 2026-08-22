'use client';

/**
 * StudyArtifactSheet — the ONE surface that shows a generated study artifact
 * inside the /foxy workspace.
 *
 *   kind='diagram' → a `DiagramSpec` from POST /api/content/diagram
 *   kind='lesson'  → `LessonNotes` from GET /api/lesson
 *
 * Purely presentational: it renders the state it is handed and calls back for
 * close/retry/regenerate. It computes nothing, derives no mastery, and never
 * re-writes what the server produced.
 *
 * All four states are handled explicitly:
 *   loading    → the existing Foxy <LoadingState> (honest elapsed timer)
 *   ready      → the artifact + its NCERT citations
 *   abstained  → friendly bilingual "couldn't build this from NCERT yet" copy,
 *                the server's own bilingual message, and any suggested
 *                ready chapters. NEVER styled as an error.
 *   error      → bilingual copy by reason + a Try again action
 *
 * Chrome follows the existing Foxy bottom-sheet pattern (mobile topics sheet /
 * FoxyStudySheet): full-viewport scrim, rounded-top panel pinned to the bottom
 * on phones, centred and capped on desktop. Tailwind + the Foxy CSS design
 * tokens only; the subject accent colour is threaded through like every other
 * Foxy surface.
 */

import { useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { FoxyStructuredRenderer } from '@alfanumrik/ui/foxy/FoxyStructuredRenderer';
import type { DiagramSpec } from '@alfanumrik/lib/diagram/types';
import type { LessonNotes, LessonSection } from '@alfanumrik/lib/lesson/types';
import type { Citation } from '@alfanumrik/lib/ai/grounded-client';
import {
  ARTIFACT_CHROME,
  type ArtifactChrome,
  type ArtifactKind,
  type ArtifactState,
} from '../_lib/study-artifacts';
import { diagramSpecToFoxyResponse } from '../_lib/diagram-to-foxy-block';
import { BLOOM_CONFIG } from '@alfanumrik/lib/cognitive-engine';

const LoadingState = dynamic(
  () => import('@alfanumrik/ui/foxy/LoadingState').then((m) => ({ default: m.LoadingState })),
  { ssr: false, loading: () => null },
);

/** Per-section emoji. The headings themselves come bilingual from the server. */
const SECTION_ICON: Record<string, string> = {
  hook: '🪝',
  core_concepts: '💡',
  misconception_callouts: '⚠️',
  active_recall: '🧠',
  application: '🔧',
  revision_summary: '🔄',
};

interface BaseProps {
  isHi: boolean;
  /** CBSE subject CODE — threaded to the renderer for icon/colour lookup. */
  subjectKey: string;
  /** Accent colour of the active subject (same value the toolbar pills use). */
  accentColor: string;
  /** Already-formatted bilingual chapter label, e.g. "Ch 3: Atoms". */
  chapterLabel: string;
  onClose: () => void;
  onRegenerate: () => void;
}

export type StudyArtifactSheetProps = BaseProps &
  (
    | { kind: Extract<ArtifactKind, 'diagram'>; state: ArtifactState<DiagramSpec> }
    | { kind: Extract<ArtifactKind, 'lesson'>; state: ArtifactState<LessonNotes> }
  );

// ── Small shared pieces ──────────────────────────────────────────────────────

function CitationList({
  citations,
  chrome,
}: {
  citations: Citation[];
  chrome: ArtifactChrome;
}) {
  if (!citations || citations.length === 0) return null;
  // De-dupe by chapter+page so a 12-chunk answer doesn't print 12 near-identical rows.
  const seen = new Set<string>();
  const rows = citations.filter((c) => {
    const key = `${c.chapter_number}::${c.page_number ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return (
    <div className="mt-4 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
      <div
        className="text-[10px] font-bold uppercase tracking-wider mb-1.5"
        style={{ color: 'var(--text-3)' }}
      >
        📖 {chrome.sources}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {rows.map((c, i) => (
          <span
            key={`${c.chunk_id}-${i}`}
            className="text-[10px] font-semibold px-2 py-1 rounded-lg"
            style={{
              background: 'var(--surface-2)',
              color: 'var(--text-3)',
              border: '1px solid var(--border)',
            }}
          >
            {chrome.chapter} {c.chapter_number}
            {c.chapter_title ? ` · ${c.chapter_title}` : ''}
            {typeof c.page_number === 'number' ? ` · ${chrome.page} ${c.page_number}` : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

function NoticeCard({
  emoji,
  heading,
  body,
  accentColor,
  tone,
  children,
}: {
  emoji: string;
  heading: string;
  body: string;
  accentColor: string;
  tone: 'calm' | 'error';
  children?: React.ReactNode;
}) {
  const tint = tone === 'calm' ? accentColor : 'var(--text-3)';
  return (
    <div
      className="rounded-2xl p-4 text-center"
      style={{
        background:
          tone === 'calm'
            ? `color-mix(in srgb, ${accentColor} 8%, var(--surface-1))`
            : 'var(--surface-2)',
        border:
          tone === 'calm'
            ? `1.5px solid color-mix(in srgb, ${accentColor} 24%, transparent)`
            : '1px solid var(--border)',
      }}
      role="note"
    >
      <div className="text-3xl mb-2" aria-hidden="true">
        {emoji}
      </div>
      <div className="text-sm font-bold mb-1" style={{ color: tint }}>
        {heading}
      </div>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--text-2)' }}>
        {body}
      </p>
      {children}
    </div>
  );
}

// ── Bodies ───────────────────────────────────────────────────────────────────

function DiagramBody({
  spec,
  isHi,
  subjectKey,
  accentColor,
  chrome,
}: {
  spec: DiagramSpec;
  isHi: boolean;
  subjectKey: string;
  accentColor: string;
  chrome: ArtifactChrome;
}) {
  const response = diagramSpecToFoxyResponse(spec, {
    subjectCode: subjectKey,
    isHi,
    fallbackTitle: chrome.diagramTitle,
  });

  // A spec that carries no drawable/valid Mermaid source is treated exactly
  // like an abstain — friendly, never a crash (defense-in-depth over the
  // server's own gates).
  if (!response) {
    return (
      <NoticeCard
        emoji="🖼️"
        heading={chrome.abstainHeading}
        body={chrome.abstainBody}
        accentColor={accentColor}
        tone="calm"
      />
    );
  }

  const caption = isHi
    ? spec.captionHi || spec.captionEn
    : spec.captionEn || spec.captionHi;

  return (
    <div>
      {/* Reuses the SAME structured renderer (and therefore the same lazy
          mermaid runtime, strict security level and brand theme) that every
          Foxy chat diagram already goes through. */}
      <FoxyStructuredRenderer response={response} subjectKey={subjectKey} />
      {caption && (
        <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--text-2)' }}>
          {caption}
        </p>
      )}
      <CitationList citations={spec.citations ?? []} chrome={chrome} />
    </div>
  );
}

function LessonBody({
  notes,
  isHi,
  accentColor,
  chrome,
}: {
  notes: LessonNotes;
  isHi: boolean;
  accentColor: string;
  chrome: ArtifactChrome;
}) {
  const sections = notes.sections ?? [];

  if (sections.length === 0) {
    return (
      <NoticeCard
        emoji="📔"
        heading={chrome.abstainHeading}
        body={chrome.abstainBody}
        accentColor={accentColor}
        tone="calm"
      />
    );
  }

  return (
    <div className="space-y-3">
      {sections.map((s: LessonSection, i: number) => {
        const heading = isHi ? s.headingHi || s.headingEn : s.headingEn || s.headingHi;
        const body = isHi ? s.bodyHi || s.bodyEn : s.bodyEn || s.bodyHi;
        return (
          <section
            key={`${s.kind}-${i}`}
            className="rounded-2xl p-3.5"
            style={{
              background: 'var(--surface-1)',
              border: '1px solid var(--border)',
            }}
          >
            <h4
              className="flex items-center gap-2 text-sm font-bold mb-1.5"
              style={{ color: accentColor }}
            >
              <span aria-hidden="true">{SECTION_ICON[s.kind] ?? '📘'}</span>
              <span className="min-w-0 flex-1">{heading}</span>
              {/* "Bloom's" is a permitted technical term (P7), but the raw enum
                  TOKEN is not: this used to render the machine value verbatim
                  (`analyze`, `evaluate`) and put `Bloom's: analyze` in the
                  tooltip — untranslated in Hindi either way. Render the
                  canonical bilingual label from BLOOM_CONFIG instead. */}
              {s.bloomLevel && BLOOM_CONFIG[s.bloomLevel] && (
                <span
                  className="shrink-0 text-[9px] font-bold tracking-wide px-1.5 py-0.5 rounded"
                  style={{
                    background: `color-mix(in srgb, ${accentColor} 12%, transparent)`,
                    color: accentColor,
                  }}
                  title={isHi
                    ? BLOOM_CONFIG[s.bloomLevel].descriptionHi
                    : BLOOM_CONFIG[s.bloomLevel].description}
                >
                  {isHi
                    ? BLOOM_CONFIG[s.bloomLevel].labelHi
                    : BLOOM_CONFIG[s.bloomLevel].label}
                </span>
              )}
            </h4>
            <p
              className="text-[13px] leading-relaxed whitespace-pre-wrap"
              style={{ color: 'var(--text-1)' }}
            >
              {body}
            </p>
          </section>
        );
      })}
      <CitationList citations={notes.citationsAll ?? []} chrome={chrome} />
    </div>
  );
}

// ── Sheet ────────────────────────────────────────────────────────────────────

export function StudyArtifactSheet(props: StudyArtifactSheetProps) {
  const { isHi, subjectKey, accentColor, chapterLabel, onClose, onRegenerate, kind, state } =
    props;
  const chrome = isHi ? ARTIFACT_CHROME.hi : ARTIFACT_CHROME.en;
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape closes — matches every other Foxy overlay affordance.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Move focus into the panel so keyboard + screen-reader users land here.
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  const headerIcon = kind === 'diagram' ? '🗺️' : '📔';
  const headerTitle = kind === 'diagram' ? chrome.diagramTitle : chrome.lessonTitle;
  const titleId = `foxy-artifact-${kind}-title`;

  const settled = state.status === 'ready' || state.status === 'abstained';

  return (
    <>
      {/* Scrim */}
      <div
        className="fixed inset-0 z-[90]"
        style={{ background: 'rgba(0,0,0,0.45)' }}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid={`foxy-artifact-sheet-${kind}`}
        className="fixed z-[91] flex flex-col outline-none
                   inset-x-0 bottom-0 rounded-t-3xl max-h-[85dvh]
                   sm:inset-x-auto sm:left-1/2 sm:bottom-auto sm:top-1/2
                   sm:-translate-x-1/2 sm:-translate-y-1/2
                   sm:w-[min(640px,calc(100vw-32px))] sm:max-h-[80dvh] sm:rounded-3xl"
        style={{
          background: 'var(--surface-2)',
          boxShadow: '0 -8px 40px rgba(0,0,0,0.18)',
        }}
      >
        {/* Grab handle (mobile affordance, matches the topics sheet) */}
        <div className="flex justify-center pt-3 pb-1 sm:hidden" aria-hidden="true">
          <div className="w-10 h-1 rounded-full" style={{ background: 'var(--border)' }} />
        </div>

        {/* Header */}
        <div
          className="px-4 py-3 flex items-center gap-2.5 shrink-0"
          style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-1)' }}
        >
          <span
            className="w-9 h-9 rounded-xl flex items-center justify-center text-lg shrink-0"
            style={{ background: `color-mix(in srgb, ${accentColor} 14%, transparent)` }}
            aria-hidden="true"
          >
            {headerIcon}
          </span>
          <div className="min-w-0 flex-1">
            <h3
              id={titleId}
              className="text-sm font-bold truncate"
              style={{ color: 'var(--text-1)' }}
            >
              {headerTitle}
            </h3>
            {chapterLabel && (
              <p className="text-[11px] truncate" style={{ color: 'var(--text-3)' }}>
                {chapterLabel}
              </p>
            )}
          </div>
          {settled && (
            <button
              type="button"
              onClick={onRegenerate}
              // The text label is `hidden sm:inline`, so on mobile the bare `↻`
              // glyph would be the entire accessible name. Mirror the Close
              // button below and name the control explicitly (bilingual via
              // `chrome`); the visible label stays exactly as-is.
              aria-label={chrome.regenerate}
              className="shrink-0 h-11 px-3 rounded-xl text-[11px] font-bold transition-all active:scale-95"
              style={{
                background: 'var(--surface-2)',
                color: 'var(--text-3)',
                border: '1px solid var(--border)',
              }}
            >
              ↻ <span className="hidden sm:inline">{chrome.regenerate}</span>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label={chrome.close}
            className="shrink-0 w-11 h-11 rounded-xl flex items-center justify-center text-sm font-bold transition-all active:scale-90"
            style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}
          >
            ✕
          </button>
        </div>

        {/* Body — the four states */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {state.status === 'idle' && null}

          {state.status === 'loading' && (
            <LoadingState
              primaryLabel={kind === 'diagram' ? chrome.building : chrome.buildingLesson}
            />
          )}

          {state.status === 'abstained' && (
            <NoticeCard
              emoji={kind === 'diagram' ? '🖼️' : '📔'}
              heading={chrome.abstainHeading}
              // Prefer the server's own bilingual abstain copy; fall back to
              // house copy when the envelope carried none.
              body={
                (isHi ? state.messageHi || state.messageEn : state.messageEn || state.messageHi) ||
                chrome.abstainBody
              }
              accentColor={accentColor}
              tone="calm"
            >
              {state.suggestedAlternatives.length > 0 && (
                <div className="mt-3 text-left">
                  <div
                    className="text-[10px] font-bold uppercase tracking-wider mb-1.5"
                    style={{ color: 'var(--text-3)' }}
                  >
                    {chrome.abstainAlternatives}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {state.suggestedAlternatives.slice(0, 6).map((alt, i) => (
                      <span
                        key={`${alt.subject_code}-${alt.chapter_number}-${i}`}
                        className="text-[10px] font-semibold px-2 py-1 rounded-lg"
                        style={{
                          background: 'var(--surface-1)',
                          color: 'var(--text-2)',
                          border: '1px solid var(--border)',
                        }}
                      >
                        {chrome.chapter} {alt.chapter_number}: {alt.chapter_title}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </NoticeCard>
          )}

          {state.status === 'error' && (
            <NoticeCard
              emoji={state.reason === 'network' ? '📶' : '🔌'}
              heading={
                state.reason === 'unsupported'
                  ? chrome.errUnsupportedHeading
                  : state.reason === 'unavailable'
                    ? chrome.errUnavailableHeading
                    : chrome.errNetworkHeading
              }
              body={
                state.reason === 'unsupported'
                  ? chrome.errUnsupportedBody
                  : state.reason === 'unavailable'
                    ? chrome.errUnavailableBody
                    : chrome.errNetworkBody
              }
              accentColor={accentColor}
              tone="error"
            >
              {state.reason === 'network' && (
                <button
                  type="button"
                  onClick={onRegenerate}
                  className="mt-3 min-h-[44px] px-4 rounded-xl text-xs font-bold text-white transition-all active:scale-95"
                  style={{ background: accentColor }}
                >
                  {chrome.retry}
                </button>
              )}
            </NoticeCard>
          )}

          {state.status === 'ready' &&
            (props.kind === 'diagram' ? (
              <DiagramBody
                spec={(props.state as ArtifactState<DiagramSpec> & { status: 'ready' }).data}
                isHi={isHi}
                subjectKey={subjectKey}
                accentColor={accentColor}
                chrome={chrome}
              />
            ) : (
              <LessonBody
                notes={(props.state as ArtifactState<LessonNotes> & { status: 'ready' }).data}
                isHi={isHi}
                accentColor={accentColor}
                chrome={chrome}
              />
            ))}
        </div>
      </div>
    </>
  );
}

export default StudyArtifactSheet;
