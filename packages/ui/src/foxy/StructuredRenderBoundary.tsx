'use client';

/**
 * StructuredRenderBoundary — error boundary specialized for the Foxy
 * structured renderer.
 *
 * Why this exists:
 *   The structured renderer assumes its `response` prop is shape-valid because
 *   the API has already validated it through `FoxyResponseSchema`. But the
 *   renderer is a moving target (new block types, KaTeX upgrades, server
 *   schema drift) and a runtime exception inside it would otherwise blank the
 *   chat bubble — leaving the user with no answer.
 *
 *   This boundary catches any render-phase exception and renders a fallback
 *   provided by the caller (the legacy markdown renderer of the same message
 *   text, per spec). The user always sees an answer.
 *
 * Why not reuse SectionErrorBoundary:
 *   `SectionErrorBoundary` renders a generic "section couldn't load" card —
 *   that's the wrong UX inside a chat bubble. We want a silent swap to the
 *   legacy renderer instead, with no "try again" affordance, because the
 *   message itself is unchanged.
 *
 * Product invariants:
 *   - P12 AI Safety: a malformed payload cannot blank the chat. The legacy
 *     `RichContent` rendering of `message.content` is always available as the
 *     ultimate fallback.
 *   - P10 Bundle Budget: this is a tiny class component (no extra deps). It is
 *     imported synchronously by /foxy because it must wrap every assistant
 *     bubble; the heavy `FoxyStructuredRenderer` itself remains lazy-loaded.
 *
 * Sentry breadcrumbs are intentionally avoided here: this fires on every
 * malformed payload and would spam the issue tracker. The API-side
 * `foxy.structured.invalid_payload` log is the canonical signal for ops.
 */

import { Component, type ReactNode } from 'react';

interface Props {
  /**
   * The structured renderer subtree. Wrap exactly this component so
   * componentDidCatch isolates failures to the structured render path.
   */
  children: ReactNode;
  /**
   * Replacement ReactNode shown when the structured render throws. Per spec,
   * pass the legacy `<RichContent ... />` rendering of the same assistant
   * text so the user always sees a usable answer.
   */
  fallback: ReactNode;
}

interface State {
  hasError: boolean;
}

export class StructuredRenderBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(): void {
    // Intentionally silent. See file-level comment.
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

export default StructuredRenderBoundary;
