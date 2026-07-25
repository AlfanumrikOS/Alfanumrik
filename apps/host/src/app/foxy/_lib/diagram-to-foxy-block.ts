/**
 * Adapts a `DiagramSpec` (from POST /api/content/diagram) into the EXISTING,
 * sanctioned Foxy structured-render envelope so the diagram is drawn by the
 * SAME Mermaid renderer every Foxy chat turn already uses.
 *
 * Why this shape rather than a new renderer:
 *   The only Mermaid renderer in the codebase is `MermaidBlock`, a private
 *   component inside `packages/ui/src/foxy/FoxyStructuredRenderer.tsx`. It owns
 *   the one-time lazy `import('mermaid')` (kept OUT of the shared bundle — P10),
 *   `securityLevel:'strict'` + `htmlLabels:false` (P12), the Foxy brand
 *   themeVariables, and the bilingual loading/failed fallbacks (P7). Exporting
 *   it would mean editing a REG-55-pinned shared file; synthesizing a one-block
 *   `FoxyResponse` reuses all of it additively, with zero new Mermaid code and
 *   zero new bytes (the chunk is already fetched for chat diagrams).
 *
 * NOTE: `packages/ui/src/DiagramViewer.tsx` is an <Image>-based renderer for
 * stored NCERT figure URLs — it does NOT render Mermaid and is not usable here.
 *
 * Safety: the code is re-checked client-side with `validateMermaidCode` (the
 * same grammar/allowlist gate the schema layer applies) before it is handed to
 * the renderer. A failing spec returns `null` and the sheet shows the friendly
 * fallback instead of attempting to draw untrusted source.
 */

import {
  validateMermaidCode,
  FOXY_MAX_MERMAID_CODE_LEN,
  FOXY_MAX_MERMAID_TITLE_LEN,
  type FoxyResponse,
  type FoxySubject,
} from '@alfanumrik/lib/foxy/schema';
import type { DiagramSpec } from '@alfanumrik/lib/diagram/types';

/** Max length of `FoxyResponse.title` per the schema. */
const MAX_RESPONSE_TITLE_LEN = 120;

/**
 * Map a CBSE subject CODE (the codes Foxy's subject tabs use) onto the narrow
 * `FoxySubjectEnum`. Only affects the renderer's fallback icon/colour — the
 * caller also passes `subjectKey`, which wins.
 */
export function toFoxySubject(subjectCode: string): FoxySubject {
  switch (subjectCode) {
    case 'math':
    case 'mathematics':
      return 'math';
    case 'science':
    case 'physics':
    case 'chemistry':
    case 'biology':
      return 'science';
    case 'social_studies':
    case 'history':
    case 'history_sr':
    case 'geography':
    case 'political_science':
    case 'economics':
      return 'sst';
    case 'english':
      return 'english';
    default:
      return 'general';
  }
}

function clamp(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/**
 * Build the one-block `FoxyResponse` the structured renderer draws.
 * Returns `null` when the spec carries no drawable, valid Mermaid source —
 * callers must render the friendly fallback in that case, never a crash.
 */
export function diagramSpecToFoxyResponse(
  spec: DiagramSpec,
  opts: { subjectCode: string; isHi: boolean; fallbackTitle: string },
): FoxyResponse | null {
  const code = (spec.mermaidCode ?? '').trim();
  if (!code) return null;
  if (code.length > FOXY_MAX_MERMAID_CODE_LEN) return null;
  if (validateMermaidCode(code) !== null) return null;

  const primaryTitle = opts.isHi ? spec.titleHi : spec.titleEn;
  const altTitle = opts.isHi ? spec.titleEn : spec.titleHi;
  const heading = clamp(
    primaryTitle || altTitle || opts.fallbackTitle,
    MAX_RESPONSE_TITLE_LEN,
  );

  const primaryCaption = opts.isHi ? spec.captionHi : spec.captionEn;
  const altCaption = opts.isHi ? spec.captionEn : spec.captionHi;
  const caption = clamp(primaryCaption || altCaption || '', FOXY_MAX_MERMAID_TITLE_LEN);

  return {
    title: heading || opts.fallbackTitle,
    subject: toFoxySubject(opts.subjectCode),
    blocks: [
      {
        type: 'mermaid',
        code,
        ...(caption ? { title: caption } : {}),
      },
    ],
  };
}
