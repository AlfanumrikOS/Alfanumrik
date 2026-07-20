'use client';

/**
 * math/katex-segments — the ONE KaTeX-direct segment renderer.
 *
 * Statically imports `katex` (and its CSS), so this module is the "heavy"
 * half of the canonical math pipeline. Two classes of consumer:
 *
 *   - `FoxyStructuredRenderer` imports it STATICALLY — the /foxy page already
 *     ships KaTeX, so this costs zero new bytes there (P10).
 *   - `MathRenderer` imports it LAZILY (React.lazy) — question-bank surfaces
 *     (quiz player, results, mock tests, admin previews) only download KaTeX
 *     when the content actually contains math.
 *
 * P12/P6 posture: `throwOnError: false` + try/catch + `<code>` fallback.
 * A malformed LaTeX span degrades to visible raw text — it can never throw
 * or blank a question/chat message.
 */

import React from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { normalizeMathSegments, tokenizeInline, type InlineSegment } from './normalize';

// ── KaTeX rendering ──────────────────────────────────────────────────────────

export interface KatexRender {
  ok: boolean;
  html: string;
}

/**
 * Sync KaTeX render. With `throwOnError: false`, KaTeX returns an error span
 * for malformed input rather than throwing — but defensively we wrap in
 * try/catch so any unexpected runtime error (e.g. KaTeX internal asserts)
 * still degrades to the fallback.
 *
 * `displayMode` selects block (centred, larger) vs inline rendering.
 */
export function renderKatex(latex: string, displayMode = true): KatexRender {
  try {
    const html = katex.renderToString(latex, {
      throwOnError: false,
      displayMode,
      output: 'html',
      strict: 'ignore',
    });
    // KaTeX with throwOnError:false emits a span with class
    // "katex-error" for malformed input. Treat that as a soft failure so the
    // caller can surface a fallback / report button.
    if (html.includes('katex-error')) {
      return { ok: false, html };
    }
    return { ok: true, html };
  } catch {
    return { ok: false, html: '' };
  }
}

// ── Inline markdown emphasis (safe, <strong>/<em> only) ──────────────────────

/**
 * Parse a plain-text (non-math) segment into React nodes, applying inline
 * markdown emphasis. Only `**bold**`/`__bold__` → <strong> and
 * `*italic*`/`_italic_` → <em> are recognised. No raw `**`/`__`/`*`/`_` may
 * leak through for well-formed markers. Output is a flat list of strings and
 * <strong>/<em> elements — never arbitrary HTML (XSS-safe).
 *
 * Bold is matched before italic so `**x**` is not mis-parsed as nested
 * italics. Markers must wrap non-empty, non-whitespace-only content.
 */
export function renderMarkdownInline(text: string, keyPrefix: string): React.ReactNode[] {
  // Single pass over the four marker styles. `**`/`__` (bold) before `*`/`_`
  // (italic) so the greedier bold delimiter wins.
  //
  // A FRESH RegExp is instantiated per call (not a shared module-level
  // constant) because this function recurses into matched bodies. A shared
  // /g regex carries `lastIndex` across calls, so a recursive inner call would
  // corrupt the outer loop's cursor — an infinite-growth bug. Per-call
  // instances each own their `lastIndex`.
  const TOKEN = /(\*\*|__)(?=\S)(.+?)(?<=\S)\1|(\*|_)(?=\S)(.+?)(?<=\S)\3/g;
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;

  while ((m = TOKEN.exec(text)) !== null) {
    if (m.index > last) {
      out.push(text.slice(last, m.index));
    }
    if (m[1] !== undefined) {
      // Bold: recurse so `**a *b* c**` keeps inner italics.
      out.push(
        <strong key={`${keyPrefix}-b${k}`}>
          {renderMarkdownInline(m[2], `${keyPrefix}-b${k}`)}
        </strong>,
      );
    } else {
      out.push(
        <em key={`${keyPrefix}-i${k}`}>
          {renderMarkdownInline(m[4], `${keyPrefix}-i${k}`)}
        </em>,
      );
    }
    last = m.index + m[0].length;
    k += 1;
  }
  if (last < text.length) {
    out.push(text.slice(last));
  }
  return out;
}

// ── Segment → React nodes ────────────────────────────────────────────────────

export interface RenderSegmentOptions {
  /**
   * Parse `**bold**`/`*italic*` in text segments. Defaults to TRUE — the
   * Foxy `InlineContent` contract (model output is markdown-ish). Question-
   * bank surfaces pass FALSE so a literal `2*3*4` in a question is never
   * mangled into italics.
   */
  markdown?: boolean;
  /**
   * Force ALL math segments to render inline (displayMode=false). Used for
   * MCQ option rows, which must never contain display math.
   */
  forceInline?: boolean;
  /**
   * Wrap display-math output in a horizontally-scrollable block so long
   * equations scroll instead of clipping at 360px (mobile-web). OFF by
   * default to keep Foxy's DOM byte-identical; MathRenderer turns it on.
   */
  displayScroll?: boolean;
}

/**
 * Render an `InlineSegment[]` to React nodes.
 *
 * DEFAULTS ARE THE FOXY CONTRACT: with no options this produces exactly the
 * node shapes `FoxyStructuredRenderer`'s `InlineContent` always produced
 * (span[dangerouslySetInnerHTML] for math, `<code>` fallback on KaTeX
 * failure, markdown-emphasis fragments for text) — pinned by the
 * structured-rendering / inline-content / math-canary test suites.
 */
export function renderInlineSegments(
  segments: InlineSegment[],
  opts: RenderSegmentOptions = {},
): React.ReactNode[] {
  const { markdown = true, forceInline = false, displayScroll = false } = opts;
  return segments.map((seg, idx) => {
    if (seg.kind === 'math') {
      const display = forceInline ? false : seg.display;
      const rendered = renderKatex(seg.latex, display);
      if (!rendered.ok) {
        // Graceful degradation — show the raw inner expression as code.
        return (
          <code
            key={`m${idx}`}
            className="px-1 py-0.5 rounded bg-slate-100 border border-slate-200 font-mono text-[0.85em] text-slate-700"
          >
            {seg.latex}
          </code>
        );
      }
      const mathSpan = (
        <span
          key={`m${idx}`}
          // KaTeX output is a fixed, sanitised span/MathML tree — no script
          // or event handlers. Safe to inject.
          dangerouslySetInnerHTML={{ __html: rendered.html }}
        />
      );
      if (display && displayScroll) {
        // Narrow-viewport safety: long display equations scroll, not clip.
        return (
          <span key={`m${idx}`} className="block max-w-full overflow-x-auto">
            <span dangerouslySetInnerHTML={{ __html: rendered.html }} />
          </span>
        );
      }
      return mathSpan;
    }
    if (!markdown) {
      return <React.Fragment key={`t${idx}`}>{seg.value}</React.Fragment>;
    }
    return (
      <React.Fragment key={`t${idx}`}>
        {renderMarkdownInline(seg.value, `t${idx}`)}
      </React.Fragment>
    );
  });
}

// ── Lazy-loadable component (default export for React.lazy) ──────────────────

export interface MathSegmentsProps {
  content: string;
  /** Inline-only mode: all math renders inline; no display blocks. */
  inline?: boolean;
  /** Parse markdown emphasis in text segments (default false — question-bank posture). */
  markdown?: boolean;
}

/**
 * Default export consumed by `MathRenderer` via `React.lazy`. Runs the full
 * canonical pipeline: tokenize (both `\(..\)` and `$..$` delimiter families)
 * → undelimited-LaTeX rescue → KaTeX with fail-safe fallback.
 */
export default function MathSegments({
  content,
  inline = false,
  markdown = false,
}: MathSegmentsProps) {
  const nodes = React.useMemo<React.ReactNode[]>(() => {
    if (!content) return [];
    const segments = normalizeMathSegments(tokenizeInline(content));
    return renderInlineSegments(segments, {
      markdown,
      forceInline: inline,
      displayScroll: !inline,
    });
  }, [content, inline, markdown]);

  return <>{nodes}</>;
}
