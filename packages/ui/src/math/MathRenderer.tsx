'use client';

/**
 * MathRenderer — THE canonical math renderer for question-bank surfaces.
 *
 * Drop-in replacement for plain `{text}` JSX on any surface that may carry
 * LaTeX: quiz player (question/options/explanation), QuizResults,
 * MisconceptionExplainer, NCERT written-answer surfaces, mock-test runner and
 * results, super-admin question detail views.
 *
 * Pipeline (single source of truth):
 *   tokenizeInline (accepts `\(..\)`, `\[..\]`, `$..$`, `$$..$$`)
 *   → normalizeMathSegments (undelimited-LaTeX rescue, strict allowlist)
 *   → KaTeX with fail-safe `<code>` fallback (P6/P12: never throws, never
 *     blanks a question).
 *
 * P10 bundle posture: this module does NOT statically import KaTeX. Content
 * with no math renders as plain text at zero cost; content with math lazily
 * loads the shared `katex-segments` chunk (React.lazy). While loading — or if
 * the chunk fails on flaky 4G — the RAW TEXT is shown, never a blank.
 *
 * Rendering rules:
 *   - `inline` — all math forced inline (use for MCQ option rows; an option
 *     must never contain display math).
 *   - display math (block mode) is wrapped with `max-width:100%;
 *     overflow-x:auto` so long equations scroll at 360px instead of clipping.
 *   - `markdown` is OFF by default: a literal `2*3*4` in a question is never
 *     mangled into italics. (Foxy surfaces keep emphasis via their own path.)
 *
 * NEVER render a string that was sliced mid-LaTeX (e.g. `.slice(0, 80)` list
 * cells) through this component with math in it — a truncated `\frac{1}{`
 * degrades to the code fallback (safe but ugly). Truncated previews should
 * stay plain text with a `title` attribute; render math on the detail view.
 */

import React, { Suspense } from 'react';
import { containsRenderableMath } from './normalize';

const LazyMathSegments = React.lazy(() => import('./katex-segments'));

export interface MathRendererProps {
  /** The (possibly math-bearing) text. Nullish renders nothing. */
  content: string | null | undefined;
  /** Force all math inline — for option rows / one-line contexts. */
  inline?: boolean;
  /** Parse `**bold**`/`*italic*` in non-math text (default false). */
  markdown?: boolean;
  /** Optional wrapper class (applied to a span around the output). */
  className?: string;
}

interface BoundaryProps {
  fallback: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Minimal error boundary: if the lazy chunk fails to load (flaky 4G) or an
 * unexpected render error escapes, show the raw text — never a blank
 * question (P6) and never a crash in the quiz flow (P12-adjacent).
 */
class MathErrorBoundary extends React.Component<BoundaryProps, { failed: boolean }> {
  constructor(props: BoundaryProps) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) return this.props.fallback;
    return this.props.children;
  }
}

export function MathRenderer({
  content,
  inline = false,
  markdown = false,
  className,
}: MathRendererProps) {
  if (content == null || content === '') return null;

  // Fast path: no math anywhere → plain text, zero KaTeX cost.
  if (!containsRenderableMath(content)) {
    if (className) return <span className={className}>{content}</span>;
    return <>{content}</>;
  }

  // Raw text is the universal fallback: shown while the KaTeX chunk loads,
  // and permanently if the chunk fails. Visible > pretty (P6).
  const rawFallback = <>{content}</>;

  const body = (
    <MathErrorBoundary fallback={rawFallback}>
      <Suspense fallback={rawFallback}>
        <LazyMathSegments content={content} inline={inline} markdown={markdown} />
      </Suspense>
    </MathErrorBoundary>
  );

  if (className) return <span className={className}>{body}</span>;
  return body;
}

export default MathRenderer;
