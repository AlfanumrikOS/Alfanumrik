'use client';

import { memo, useState } from 'react';
import { useSubjectLookup } from '@alfanumrik/lib/useSubjectLookup';
import { MathMarkdown } from '../math/MathMarkdown';
import { normalizeLatexDelimiters } from '../math/normalize';

// Re-export from the canonical normalizer so existing imports
// (`import { normalizeLatexDelimiters } from '.../RichContent'`) keep working.
export { normalizeLatexDelimiters } from '../math/normalize';

/* ══════════════════════════════════════════════════════════════
   RICH TEXT RENDERER
   Shared component used by both /page.tsx and /foxy/page.tsx

   Uses ReactMarkdown for proper rendering of Claude's markdown
   output: bold, italic, headings, lists, code, tables, LaTeX
   math ($..$ inline, $$..$$ block), and blockquotes.
   ══════════════════════════════════════════════════════════════ */

export interface RichContentProps {
  content: string;
  subjectKey: string;
  subjectConfig?: { color: string; icon: string };
}

// Local fallback used only when the subjects service hook hasn't returned yet —
// display keeps working even during first paint / offline.
const DEFAULT_CONFIG = { icon: '\u269B', color: '#10B981' };

/**
 * Cleans legacy markers from old stored messages that were produced
 * by the previous cleanMd() renderer. Converts them back to standard
 * markdown so ReactMarkdown can render them properly.
 */
function cleanLegacyMarkers(content: string): string {
  return content
    .replace(/\[FORMULA:\s*([^\]]+)\]/g, '`$1`')           // [FORMULA: x] -> `x`
    .replace(/\[KEY:\s*([^\]]+)\]/g, '**$1**')               // [KEY: bold]  -> **bold**
    .replace(/\[DIAGRAM:\s*([^\]]+)\]/g, '*Diagram: $1*')    // [DIAGRAM: x] -> *Diagram: x*
    .replace(/\[EXAMPLE:\s*([^\]]+)\]/g, '> $1');            // [EXAMPLE: x] -> > x
}

/**
 * Renders AI tutor responses with proper markdown formatting.
 * Supports: bold, italic, headings, lists, code blocks, tables,
 * LaTeX math (inline $...$ and block $$...$$), and links.
 *
 * Also handles these custom markers from Claude's system prompt:
 *   [ANS: answer]   - highlighted answer box
 *   [TIP: tip text]  - exam tip callout
 *   [MARKS: 2]       - marks badge
 */
function RichContentInner({ content, subjectKey, subjectConfig }: RichContentProps) {
  const lookup = useSubjectLookup();
  const resolved = lookup(subjectKey);
  const cfg = subjectConfig || (resolved ? { icon: resolved.icon, color: resolved.color } : DEFAULT_CONFIG);
  if (!content) return null;

  // Normalise `\(…\)` / `\[…\]` LaTeX to `$…$` / `$$…$$` so remark-math sees
  // it, THEN clean legacy markers from old stored messages.
  const cleaned = cleanLegacyMarkers(normalizeLatexDelimiters(content));

  // Extract custom markers that ReactMarkdown can't handle natively,
  // then render them as inline elements after markdown processing.
  // We process [ANS:], [TIP:], and [MARKS:] markers separately.
  const segments = splitCustomMarkers(cleaned, cfg.color);

  const COLLAPSE_THRESHOLD = 8;
  const elementCount = cleaned.split('\n\n').length;

  if (elementCount > COLLAPSE_THRESHOLD) {
    return <CollapsibleMarkdown content={cleaned} segments={segments} cfg={cfg} threshold={COLLAPSE_THRESHOLD} />;
  }

  return (
    <div className="overflow-hidden" style={{ overflowWrap: 'break-word', wordBreak: 'break-word' }}>
      {segments.map((seg, i) => (
        <SegmentRenderer key={i} segment={seg} cfg={cfg} />
      ))}
    </div>
  );
}

// ─── Custom marker handling ──────────────────────────────────────────────────

export interface Segment {
  type: 'markdown' | 'ans' | 'tip' | 'marks';
  content: string;
}

/**
 * Splits content into segments: regular markdown text and custom markers
 * ([ANS:], [TIP:], [MARKS:]) that need special rendering.
 *
 * Whitespace preservation: when a marker is adjacent to non-whitespace text
 * (e.g. "answer is[ANS: 50]today"), we inject a single space into the
 * preceding/trailing markdown segment so the rendered DOM has visible
 * whitespace between the badge and surrounding text. We never add a space
 * if one already exists, so well-formed input is unchanged.
 *
 * Exported for testability.
 */
export function splitCustomMarkers(text: string, _color: string): Segment[] {
  const segments: Segment[] = [];
  const re = /\[(ANS|TIP|MARKS):\s*([^\]]+)\]/g;
  let m: RegExpExecArray | null;
  let last = 0;

  while ((m = re.exec(text)) !== null) {
    // Preceding character: if the marker is touching non-whitespace text,
    // pad a space onto the trailing edge of the markdown segment.
    if (m.index > last) {
      let chunk = text.substring(last, m.index);
      const charBefore = chunk.charAt(chunk.length - 1);
      if (charBefore && !/\s/.test(charBefore)) {
        chunk = chunk + ' ';
      }
      segments.push({ type: 'markdown', content: chunk });
    }

    const tag = m[1].toLowerCase() as 'ans' | 'tip' | 'marks';
    segments.push({ type: tag, content: m[2] });
    last = m.index + m[0].length;
  }

  if (last < text.length) {
    let chunk = text.substring(last);
    // Trailing chunk: if the marker is touching non-whitespace text after,
    // pad a space onto the leading edge of the markdown segment.
    const charAfter = chunk.charAt(0);
    if (charAfter && !/\s/.test(charAfter)) {
      chunk = ' ' + chunk;
    }
    segments.push({ type: 'markdown', content: chunk });
  }
  return segments;
}

/**
 * Renders a single segment: either markdown or a custom marker.
 */
function SegmentRenderer({ segment, cfg }: { segment: Segment; cfg: { color: string; icon: string } }) {
  if (segment.type === 'ans') {
    return (
      <span
        className="inline-block px-3 py-1 my-1 rounded-lg font-extrabold text-sm"
        style={{ border: `2px solid ${cfg.color}`, color: cfg.color, background: `${cfg.color}08` }}
      >
        {segment.content}
      </span>
    );
  }
  if (segment.type === 'tip') {
    return (
      <div
        className="my-2 px-3 py-2.5 rounded-xl text-xs"
        // Wave 6: amber exam-tip callout routed through the --warning/--gold
        // status token (theme-aware) instead of raw #f59e0b / #fffbeb / #92400e.
        style={{
          background: 'color-mix(in srgb, var(--warning) 12%, var(--surface-1))',
          border: '1px solid color-mix(in srgb, var(--warning) 30%, transparent)',
          color: 'color-mix(in srgb, var(--warning) 55%, var(--text-1))',
        }}
      >
        <span className="font-extrabold">Exam Tip: </span>{segment.content}
      </div>
    );
  }
  if (segment.type === 'marks') {
    return (
      <span
        className="inline-block px-2 py-0.5 rounded-lg text-[11px] font-bold ml-1"
        style={{ background: '#7c3aed15', color: '#7c3aed' }}
      >
        ({segment.content} marks)
      </span>
    );
  }

  // Standard markdown rendering
  return (
    <MarkdownBlock content={segment.content} cfg={cfg} />
  );
}

/**
 * Renders a markdown text block using the canonical MathMarkdown pipeline
 * (packages/ui/src/math/MathMarkdown.tsx) with the subject-styled variant.
 * The component map lives there — extracted verbatim from this file during
 * the 2026-07 math-pipeline consolidation (zero visual change).
 */
function MarkdownBlock({ content, cfg }: { content: string; cfg: { color: string; icon: string } }) {
  return <MathMarkdown content={content} variant="subject" cfg={cfg} />;
}


// ─── Collapsible wrapper for long responses ──────────────────────────────────

function CollapsibleMarkdown({
  content,
  segments,
  cfg,
  threshold,
}: {
  content: string;
  segments: Segment[];
  cfg: { color: string; icon: string };
  threshold: number;
}) {
  const [expanded, setExpanded] = useState(false);

  // For collapsing: split markdown at double newlines to estimate "blocks"
  const totalBlocks = content.split('\n\n').length;

  if (expanded) {
    return (
      <div className="overflow-hidden" style={{ overflowWrap: 'break-word', wordBreak: 'break-word' }}>
        {segments.map((seg, i) => (
          <SegmentRenderer key={i} segment={seg} cfg={cfg} />
        ))}
        <button
          onClick={() => setExpanded(false)}
          className="mt-2 text-[11px] font-bold px-3 py-1.5 rounded-lg transition-all active:scale-95"
          style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}
        >
          Show less
        </button>
      </div>
    );
  }

  // Show truncated version: only the first part of the content
  const blocks = content.split('\n\n');
  const truncated = blocks.slice(0, threshold).join('\n\n');
  const truncatedSegments = splitCustomMarkers(cleanLegacyMarkers(truncated), cfg.color);

  return (
    <div className="overflow-hidden" style={{ overflowWrap: 'break-word', wordBreak: 'break-word' }}>
      {truncatedSegments.map((seg, i) => (
        <SegmentRenderer key={i} segment={seg} cfg={cfg} />
      ))}
      <button
        onClick={() => setExpanded(true)}
        className="mt-2 text-[11px] font-bold px-3 py-1.5 rounded-lg transition-all active:scale-95"
        style={{ background: `${cfg.color}10`, color: cfg.color, border: `1px solid ${cfg.color}25` }}
      >
        Show more ({totalBlocks - threshold} more sections)
      </button>
    </div>
  );
}

export const RichContent = memo(RichContentInner);
export default RichContent;
