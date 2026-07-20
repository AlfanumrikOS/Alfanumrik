'use client';

/**
 * MathMarkdown — THE canonical markdown+math pipeline.
 *
 * The single react-markdown configuration on the platform:
 *   remarkPlugins: [remarkGfm, remarkMath] (+ remarkBreaks when `breaks`)
 *   rehypePlugins: [rehypeKatex]
 *
 * Consumers:
 *   - `foxy/RichContent` — `variant="subject"` (subject-colored chrome; the
 *     component map below is the exact map extracted from RichContent's
 *     MarkdownBlock — zero visual change to Foxy chat).
 *   - `learn/ChapterReadView` — `variant="plain"` + `breaks` (NCERT prose;
 *     default elements styled by the caller's `prose` classes).
 *
 * NOTE: `remark-breaks` is deliberately OFF by default — RichContent
 * intentionally removed it (pinned by RichContent-spacing.test.tsx: single
 * newlines must NOT produce <br>). ChapterReadView opts in.
 *
 * Callers that need `\(..\)`/`\[..\]` input converted for remark-math must
 * pre-run `normalizeLatexDelimiters` from `./normalize` (RichContent does).
 *
 * Do NOT add plugins here or create another ReactMarkdown config elsewhere —
 * one pipeline, one file.
 */

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

export interface MathMarkdownCfg {
  color: string;
  icon: string;
}

/** Neutral default for surfaces with no subject context (admin/quiz). */
const NEUTRAL_CFG: MathMarkdownCfg = { color: '#334155', icon: '' };

export interface MathMarkdownProps {
  content: string;
  /**
   * `subject` — Foxy chat chrome (headings/lists/quotes tinted by cfg.color).
   * `plain`   — no component overrides; caller styles via `prose` etc.
   */
  variant?: 'subject' | 'plain';
  /** Subject color/icon for the `subject` variant. Neutral when omitted. */
  cfg?: MathMarkdownCfg;
  /** Wire remark-breaks (single newline → <br>). Default OFF — see header. */
  breaks?: boolean;
}

/**
 * Subject-styled component map — extracted VERBATIM from
 * `foxy/RichContent.tsx`'s MarkdownBlock (2026-07 consolidation). Any change
 * here is a visual change to Foxy chat: get quality/ops review first.
 */
function subjectComponents(cfg: MathMarkdownCfg): React.ComponentProps<typeof ReactMarkdown>['components'] {
  return {
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
          <li className="flex gap-2.5 py-1.5 items-start" style={{ borderBottom: '1px solid #f0f0f0' }}>
            <span
              className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
              style={{ background: `${cfg.color}20`, color: cfg.color }}
            >
              {index + 1}
            </span>
            <span className="leading-relaxed text-sm">{children}</span>
          </li>
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
  };
}

export function MathMarkdown({
  content,
  variant = 'plain',
  cfg,
  breaks = false,
}: MathMarkdownProps) {
  const remarkPlugins = breaks
    ? [remarkGfm, remarkMath, remarkBreaks]
    : [remarkGfm, remarkMath];

  if (variant === 'subject') {
    return (
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={[rehypeKatex]}
        components={subjectComponents(cfg ?? NEUTRAL_CFG)}
      >
        {content}
      </ReactMarkdown>
    );
  }

  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={[rehypeKatex]}>
      {content}
    </ReactMarkdown>
  );
}

export default MathMarkdown;
