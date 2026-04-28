'use client';

import React, { memo, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeKatex from 'rehype-katex';
import { useSubjectLookup } from '@/lib/useSubjectLookup';

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

  // Clean legacy markers from old stored messages
  const cleaned = cleanLegacyMarkers(content);

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
        style={{ background: '#fffbeb', border: '1px solid #f59e0b30', color: '#92400e' }}
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
 * Renders a markdown text block using ReactMarkdown with subject-aware styling.
 */
function MarkdownBlock({ content, cfg }: { content: string; cfg: { color: string; icon: string } }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath, remarkBreaks]}
      rehypePlugins={[rehypeKatex]}
      components={{
        // Headings styled with subject color
        h1: ({ children }) => (
          <h3 className="text-base font-bold mt-4 mb-2 pb-2" style={{ borderBottom: `2px solid ${cfg.color}30` }}>
            {children}
          </h3>
        ),
        h2: ({ children }) => (
          <h3 className="text-base font-bold mt-4 mb-2 pb-2" style={{ borderBottom: `2px solid ${cfg.color}30` }}>
            {children}
          </h3>
        ),
        h3: ({ children }) => (
          <h4 className="text-sm font-bold mt-4 mb-2 uppercase tracking-wide" style={{ color: cfg.color }}>
            {cfg.icon} {children}
          </h4>
        ),
        h4: ({ children }) => (
          <h5 className="text-sm font-semibold mt-2 mb-1" style={{ color: cfg.color }}>
            {children}
          </h5>
        ),

        // Code: inline and block
        code: ({ className, children, ...props }) => {
          const isBlock = className?.startsWith('language-');
          if (isBlock) {
            return (
              <code
                className={`block max-w-full px-3 py-1.5 my-1 rounded-lg font-semibold text-xs ${className || ''}`}
                style={{
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  fontFamily: 'monospace',
                  overflowWrap: 'break-word',
                  overflowX: 'auto' as const,
                }}
                {...props}
              >
                {children}
              </code>
            );
          }
          return (
            <code
              className="inline-block max-w-full px-1.5 py-0.5 rounded text-xs font-mono"
              style={{
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                overflowWrap: 'break-word',
              }}
              {...props}
            >
              {children}
            </code>
          );
        },

        // Pre: wrapper for code blocks
        pre: ({ children }) => (
          <pre className="my-2 overflow-x-auto">{children}</pre>
        ),

        // Tables for NCERT-style data
        table: ({ children }) => (
          <div className="overflow-x-auto my-2">
            <table className="min-w-full text-xs border-collapse border border-gray-200">
              {children}
            </table>
          </div>
        ),
        th: ({ children }) => (
          <th className="border border-gray-200 px-2 py-1 text-left font-medium" style={{ background: `${cfg.color}08` }}>
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="border border-gray-200 px-2 py-1">{children}</td>
        ),

        // Lists — styled with subject color accents
        ul: ({ children }) => (
          <ul className="my-2 space-y-1 pl-1">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="my-3 px-4 py-3 rounded-r-xl list-none counter-reset-[li]" style={{ background: `${cfg.color}08`, borderLeft: `3px solid ${cfg.color}` }}>
            {React.Children.map(children, (child, i) => {
              if (!React.isValidElement(child)) return child;
              return React.cloneElement(child as React.ReactElement<{ 'data-index'?: number }>, { 'data-index': i });
            })}
          </ol>
        ),
        li: ({ children, ...props }) => {
          const index = (props as { 'data-index'?: number })['data-index'];
          const isOrdered = typeof index === 'number';
          if (isOrdered) {
            return (
              <div className="flex gap-2.5 py-1.5 items-start" style={{ borderBottom: '1px solid #f0f0f0' }}>
                <span
                  className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                  style={{ background: `${cfg.color}20`, color: cfg.color }}
                >
                  {index + 1}
                </span>
                <span className="leading-relaxed text-sm">{children}</span>
              </div>
            );
          }
          return (
            <li className="flex gap-2 items-start text-sm ml-2">
              <span className="shrink-0 mt-1.5 w-1.5 h-1.5 rounded-full" style={{ background: cfg.color }} />
              <span className="leading-relaxed">{children}</span>
            </li>
          );
        },

        // Blockquotes — styled as reference/excerpt callouts
        blockquote: ({ children }) => (
          <div
            className="my-3 px-4 py-3 rounded-xl text-sm leading-relaxed"
            style={{ background: `${cfg.color}08`, border: `1px solid ${cfg.color}25` }}
          >
            {children}
          </div>
        ),

        // Links
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:opacity-80"
            style={{ color: cfg.color }}
          >
            {children}
          </a>
        ),

        // Paragraphs — wordSpacing is defensive: helps numbers/math feel
        // legible if upstream emits compressed whitespace runs.
        p: ({ children }) => (
          <p
            className="my-1.5 leading-[1.75] text-[var(--text-2)]"
            style={{ whiteSpace: 'normal', wordSpacing: '0.05em' }}
          >
            {children}
          </p>
        ),

        // Bold — key terms styled with subject color. paddingRight prevents
        // the borderBottom underline from visually fusing with the next
        // character when bold text is immediately followed by plain text
        // (e.g. **important**word).
        strong: ({ children }) => (
          <span
            className="font-bold"
            style={{
              color: cfg.color,
              borderBottom: `2px solid ${cfg.color}40`,
              paddingBottom: 1,
              paddingRight: '2px',
              marginRight: '1px',
            }}
          >
            {children}
          </span>
        ),

        // Emphasis
        em: ({ children }) => <em>{children}</em>,

        // Horizontal rule
        hr: () => <hr className="my-3 border-t" style={{ borderColor: `${cfg.color}25` }} />,
      }}
    >
      {content}
    </ReactMarkdown>
  );
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
