/**
 * FoxyStructuredRenderer — `MermaidBlock` (Wave 2, drawable diagrams).
 *
 * The mermaid runtime (~500 kB) is pulled in via a dynamic `import('mermaid')`
 * inside the render effect (P10 — it must never enter the shared/first-load
 * bundle) and runs with `securityLevel:'strict'`, pre-validated by
 * `mermaid.parse(code, { suppressErrors:true })`. This suite mocks that dynamic
 * import and pins the block's three-state machine:
 *
 *   - loading → ready: a valid diagram parses, renders, and the returned SVG is
 *     injected; the optional `title` becomes the figure caption + aria-label.
 *   - parse:false → error: a diagram that fails validation degrades to the quiet
 *     bilingual `chrome.diagramFailed` fallback (English + Hindi under isHi).
 *   - empty code → error, with NO mermaid load/parse attempted.
 *   - a structurally-invalid mermaid block routed to the guard renders null-safe
 *     (fallback, never a thrown exception in the message list).
 *   - a render() throw also degrades to the error fallback (defense-in-depth).
 *
 * P7 (bilingual chrome), P12 (safe degradation — no crash, no raw diagram
 * source shown).
 *
 * Owner: testing. Under test: frontend (renderer) + ai-engineer (schema guard).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import type { FoxyResponse } from '@alfanumrik/lib/foxy/schema';

// ── Mocks ────────────────────────────────────────────────────────────────────

// Mutable bilingual flag so individual tests can flip Hindi mode.
const mockIsHi = { value: false };
vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => ({ isHi: mockIsHi.value }),
}));

vi.mock('@alfanumrik/lib/useSubjectLookup', () => ({
  useSubjectLookup: () => () => ({
    code: 'science',
    icon: '⚛',
    color: '#10B981',
    name: 'Science',
  }),
}));

// The dynamic `import('mermaid')` inside the renderer resolves to this mock.
// `initialize` is a no-op; `parse` / `render` are reconfigured per test.
const mermaidInitialize = vi.fn();
const mermaidParse = vi.fn();
const mermaidRender = vi.fn();
vi.mock('mermaid', () => ({
  default: {
    initialize: mermaidInitialize,
    parse: mermaidParse,
    render: mermaidRender,
  },
}));

import { FoxyStructuredRenderer } from '@alfanumrik/ui/foxy/FoxyStructuredRenderer';

// ── Chrome strings under test (mirror FoxyStructuredRenderer CHROME map) ──────
const EN_LOADING = 'Drawing diagram…';
const EN_FAILED = "Diagram couldn't be drawn";
const HI_FAILED = 'डायग्राम नहीं बन पाया';

const SVG_MARKER = 'MMD_SVG_MARKER';
const DEFAULT_SVG = `<svg xmlns="http://www.w3.org/2000/svg"><text>${SVG_MARKER}</text></svg>`;
const VALID_CODE = 'flowchart TD\n  A[Evaporation] --> B[Condensation]';

function makeResponse(blocks: FoxyResponse['blocks']): FoxyResponse {
  return { title: 'Diagram Lesson', subject: 'science', blocks };
}

/** Build a mermaid block, bypassing the schema (the renderer is presentational). */
function mermaidBlock(fields: Record<string, unknown>): FoxyResponse['blocks'][number] {
  return { type: 'mermaid', ...fields } as unknown as FoxyResponse['blocks'][number];
}

beforeEach(() => {
  vi.clearAllMocks();
  // Sensible defaults; individual tests override.
  mermaidParse.mockResolvedValue(true);
  mermaidRender.mockResolvedValue({ svg: DEFAULT_SVG });
  mockIsHi.value = false;
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. valid code → loading → ready (injects the returned SVG + caption)
// ─────────────────────────────────────────────────────────────────────────────

describe('MermaidBlock — valid diagram renders to ready', () => {
  it('shows the loading state, then injects the SVG returned by mermaid.render', async () => {
    // Hold parse pending so the loading state is observable, then release it.
    let releaseParse!: (v: boolean) => void;
    mermaidParse.mockReturnValue(new Promise<boolean>((res) => { releaseParse = res; }));

    const { container } = render(
      <FoxyStructuredRenderer
        response={makeResponse([mermaidBlock({ code: VALID_CODE, title: 'The Water Cycle' })])}
      />,
    );

    // Loading state visible before parse resolves.
    expect(screen.getByText(EN_LOADING)).toBeInTheDocument();

    releaseParse(true);

    // The rendered SVG string is injected via dangerouslySetInnerHTML.
    await screen.findByText(SVG_MARKER);
    // Loading state is gone.
    expect(screen.queryByText(EN_LOADING)).not.toBeInTheDocument();
    // The figure exposes role="img" with the title as its accessible name,
    // and renders the title as a caption.
    expect(
      container.querySelector('[role="img"][aria-label="The Water Cycle"]'),
    ).not.toBeNull();
    expect(screen.getByText('The Water Cycle')).toBeInTheDocument();
    // render was called with the exact validated code.
    expect(mermaidRender).toHaveBeenCalledTimes(1);
    expect(mermaidRender.mock.calls[0][1]).toBe(VALID_CODE);
  });

  it('renders a titleless diagram to ready with the generic diagram aria-label', async () => {
    const { container } = render(
      <FoxyStructuredRenderer
        response={makeResponse([mermaidBlock({ code: VALID_CODE })])}
      />,
    );
    await screen.findByText(SVG_MARKER);
    // Falls back to the "Diagram" chrome label as the accessible name.
    expect(container.querySelector('[role="img"][aria-label="Diagram"]')).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. parse:false → error → bilingual fallback
// ─────────────────────────────────────────────────────────────────────────────

describe('MermaidBlock — parse failure degrades to the bilingual fallback', () => {
  it('shows the English fallback when mermaid.parse returns false', async () => {
    mermaidParse.mockResolvedValue(false);

    render(
      <FoxyStructuredRenderer
        response={makeResponse([mermaidBlock({ code: VALID_CODE, title: 'Broken Diagram' })])}
      />,
    );

    await screen.findByText(EN_FAILED);
    // parse failed → render must NOT be called (no attempt to draw invalid code).
    expect(mermaidRender).not.toHaveBeenCalled();
    // The optional title still shows as a caption so the student keeps context.
    expect(screen.getByText('Broken Diagram')).toBeInTheDocument();
    // The raw diagram source is never surfaced as prose.
    expect(screen.queryByText(/flowchart/)).not.toBeInTheDocument();
  });

  it('shows the Hindi fallback when isHi is true (P7)', async () => {
    mockIsHi.value = true;
    mermaidParse.mockResolvedValue(false);

    render(
      <FoxyStructuredRenderer
        response={makeResponse([mermaidBlock({ code: VALID_CODE })])}
      />,
    );

    await screen.findByText(HI_FAILED);
    // English fallback must not leak when Hindi is active.
    expect(screen.queryByText(EN_FAILED)).not.toBeInTheDocument();
  });

  it('degrades to the error fallback when mermaid.render throws', async () => {
    mermaidParse.mockResolvedValue(true);
    mermaidRender.mockRejectedValue(new Error('render blew up'));

    expect(() =>
      render(
        <FoxyStructuredRenderer
          response={makeResponse([mermaidBlock({ code: VALID_CODE })])}
        />,
      ),
    ).not.toThrow();

    await screen.findByText(EN_FAILED);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. empty code + guard null-safety
// ─────────────────────────────────────────────────────────────────────────────

describe('MermaidBlock — empty code / invalid block is null-safe', () => {
  it('renders the error fallback for an empty-code block WITHOUT loading mermaid', async () => {
    render(
      <FoxyStructuredRenderer
        response={makeResponse([mermaidBlock({ code: '' })])}
      />,
    );
    await screen.findByText(EN_FAILED);
    // Empty code short-circuits before the dynamic import — nothing is parsed.
    expect(mermaidParse).not.toHaveBeenCalled();
    expect(mermaidRender).not.toHaveBeenCalled();
  });

  it('renders null-safe (fallback, no throw) for a mermaid block with no code field', async () => {
    // isFoxyMermaidBlock returns false → the block routes through the guard's
    // null branch and shows the safe fallback instead of crashing the list.
    expect(() =>
      render(
        <FoxyStructuredRenderer
          response={makeResponse([mermaidBlock({ title: 'No code here' })])}
        />,
      ),
    ).not.toThrow();

    await screen.findByText(EN_FAILED);
    // The rest of the renderer is unharmed — the response title still renders.
    expect(screen.getByText('Diagram Lesson')).toBeInTheDocument();
    expect(mermaidParse).not.toHaveBeenCalled();
  });
});
