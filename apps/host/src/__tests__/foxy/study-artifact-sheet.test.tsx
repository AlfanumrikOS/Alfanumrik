/**
 * StudyArtifactSheet — the ONE surface that renders a generated study artifact
 * (Diagram / Lesson notes) inside /foxy.
 *
 * Pins the four-state machine at the render layer:
 *
 *   loading   → the Foxy LoadingState with bilingual "building" copy
 *   ready     → the artifact, drawn through the EXISTING structured renderer
 *   abstained → a CALM notice (role="note"), never styled or worded as an
 *               error, and with NO retry affordance
 *   error     → bilingual copy per reason; the "Try again" retry is offered
 *               ONLY for the 'network' reason (400/401/403/404 are not
 *               retryable from the student's side)
 *
 * Plus the P12 defense-in-depth pin: a ready DiagramSpec whose mermaid source
 * fails client-side validation renders the calm fallback and the raw source is
 * NEVER handed to the renderer nor printed into the DOM.
 *
 * The structured renderer and next/dynamic are stubbed so this unit never
 * pulls the mermaid runtime.
 *
 * Owning agent: testing. Under test: frontend (sheet).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import React from 'react';

// The lazy Foxy <LoadingState> — stubbed so we can assert its bilingual label.
vi.mock('next/dynamic', () => ({
  default: () =>
    function LoadingStateStub(props: { primaryLabel?: string }) {
      return React.createElement(
        'div',
        { 'data-testid': 'foxy-artifact-loading' },
        props.primaryLabel,
      );
    },
}));

// The structured renderer (owner of the lazy mermaid runtime). Stubbed to a
// probe so we can assert BOTH what it receives and that it is never called
// with unvalidated source.
const rendererProps: Array<{ response: unknown; subjectKey: string }> = [];
vi.mock('@alfanumrik/ui/foxy/FoxyStructuredRenderer', () => ({
  FoxyStructuredRenderer: (props: { response: unknown; subjectKey: string }) => {
    rendererProps.push(props);
    return React.createElement(
      'div',
      { 'data-testid': 'structured-renderer' },
      JSON.stringify(props.response),
    );
  },
}));

import { StudyArtifactSheet } from '@/app/foxy/_components/StudyArtifactSheet';
import type { ArtifactState } from '@/app/foxy/_lib/study-artifacts';
import type { DiagramSpec } from '@alfanumrik/lib/diagram/types';
import type { LessonNotes } from '@alfanumrik/lib/lesson/types';
// The canonical bilingual Bloom's labels. Imported so the "no raw enum token"
// guard re-derives the machine values from the same source the component reads,
// rather than hardcoding a list that rots when a 7th level is added.
import { BLOOM_CONFIG } from '@alfanumrik/lib/cognitive-engine';

const VALID_CODE = 'flowchart TD\n  A[Atom] --> B[Molecule]';

const READY_DIAGRAM: DiagramSpec = {
  abstained: false,
  mermaidCode: VALID_CODE,
  diagramKind: 'flowchart',
  titleEn: 'From atoms to molecules',
  titleHi: 'परमाणु से अणु तक',
  captionEn: 'How atoms combine.',
  captionHi: 'परमाणु कैसे जुड़ते हैं।',
  citations: [
    {
      index: 0,
      chunk_id: 'c1',
      chapter_number: 3,
      chapter_title: 'Atoms and Molecules',
      page_number: 42,
      similarity: 0.9,
      excerpt: '…',
      media_url: null,
    },
  ],
  meta: {},
} as DiagramSpec;

const READY_LESSON: LessonNotes = {
  abstained: false,
  sections: [
    {
      kind: 'hook',
      headingEn: 'Why this matters',
      headingHi: 'यह क्यों ज़रूरी है',
      bodyEn: 'Everything around you is made of atoms.',
      bodyHi: 'तुम्हारे चारों ओर सब कुछ परमाणुओं से बना है।',
      citations: [],
      bloomLevel: 'understand',
    },
  ],
  adaptationApplied: [],
  citationsAll: [],
  meta: {},
} as unknown as LessonNotes;

function baseProps() {
  return {
    isHi: false,
    subjectKey: 'science',
    accentColor: '#10B981',
    chapterLabel: 'Science · Ch 3: Atoms and Molecules',
    onClose: vi.fn(),
    onRegenerate: vi.fn(),
  };
}

beforeEach(() => {
  rendererProps.length = 0;
});

// ── 1. Loading ───────────────────────────────────────────────────────────────

describe('Foxy StudyArtifactSheet — loading state', () => {
  it('renders the diagram sheet testid and the EN building copy', async () => {
    render(
      <StudyArtifactSheet kind="diagram" state={{ status: 'loading' }} {...baseProps()} />,
    );
    expect(screen.getByTestId('foxy-artifact-sheet-diagram')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId('foxy-artifact-loading').textContent).toBe(
        'Drawing your diagram from NCERT…',
      ),
    );
  });

  it('renders the Hindi building copy when isHi (P7)', async () => {
    render(
      <StudyArtifactSheet
        kind="diagram"
        state={{ status: 'loading' }}
        {...baseProps()}
        isHi
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('foxy-artifact-loading').textContent).toBe(
        'NCERT से तुम्हारा आरेख बना रहे हैं…',
      ),
    );
  });

  it('uses lesson-specific building copy for the lesson sheet', async () => {
    render(
      <StudyArtifactSheet kind="lesson" state={{ status: 'loading' }} {...baseProps()} />,
    );
    expect(screen.getByTestId('foxy-artifact-sheet-lesson')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId('foxy-artifact-loading').textContent).toBe(
        'Writing your notes from NCERT…',
      ),
    );
  });

  it('offers NO regenerate affordance while loading', () => {
    render(
      <StudyArtifactSheet kind="diagram" state={{ status: 'loading' }} {...baseProps()} />,
    );
    expect(screen.queryByText('Regenerate')).toBeNull();
  });
});

// ── 2. Ready — diagram ───────────────────────────────────────────────────────

describe('Foxy StudyArtifactSheet — ready diagram', () => {
  it('hands a validated one-block response to the structured renderer', () => {
    render(
      <StudyArtifactSheet
        kind="diagram"
        state={{ status: 'ready', data: READY_DIAGRAM }}
        {...baseProps()}
      />,
    );
    expect(rendererProps).toHaveLength(1);
    const response = rendererProps[0].response as {
      title: string;
      blocks: Array<{ type: string; code: string }>;
    };
    expect(response.blocks).toHaveLength(1);
    expect(response.blocks[0].type).toBe('mermaid');
    expect(response.blocks[0].code).toBe(VALID_CODE);
    expect(rendererProps[0].subjectKey).toBe('science');
  });

  it('renders the NCERT citation provenance', () => {
    render(
      <StudyArtifactSheet
        kind="diagram"
        state={{ status: 'ready', data: READY_DIAGRAM }}
        {...baseProps()}
      />,
    );
    expect(screen.getByText(/From your NCERT book/)).toBeTruthy();
    expect(screen.getByText(/Ch 3 · Atoms and Molecules · p\. 42/)).toBeTruthy();
  });

  it('shows the caption in the active language', () => {
    const { unmount } = render(
      <StudyArtifactSheet
        kind="diagram"
        state={{ status: 'ready', data: READY_DIAGRAM }}
        {...baseProps()}
      />,
    );
    expect(screen.getByText('How atoms combine.')).toBeTruthy();
    unmount();

    render(
      <StudyArtifactSheet
        kind="diagram"
        state={{ status: 'ready', data: READY_DIAGRAM }}
        {...baseProps()}
        isHi
      />,
    );
    expect(screen.getByText('परमाणु कैसे जुड़ते हैं।')).toBeTruthy();
  });

  it('offers Regenerate once settled', () => {
    const props = baseProps();
    render(
      <StudyArtifactSheet
        kind="diagram"
        state={{ status: 'ready', data: READY_DIAGRAM }}
        {...props}
      />,
    );
    fireEvent.click(screen.getByText('Regenerate').closest('button') as HTMLElement);
    expect(props.onRegenerate).toHaveBeenCalledTimes(1);
  });
});

// ── 3. P12 — an unsafe diagram never reaches the renderer ────────────────────

describe('Foxy StudyArtifactSheet — unsafe mermaid degrades calmly (P12)', () => {
  const unsafe: Array<[string, string]> = [
    ['<script> payload', 'flowchart TD\n  A["<script>alert(1)</script>"] --> B'],
    ['javascript: URI', 'flowchart TD\n  A["javascript:alert(1)"] --> B'],
    ['click callback', 'flowchart TD\n  A --> B\n  click A callback'],
    ['securityLevel override', "flowchart TD\n  %%{init: {'securityLevel':'loose'}}%%\n  A-->B"],
    ['non-allowlisted header', "alert('pwned')"],
  ];

  it.each(unsafe)('never calls the renderer for %s', (_label, code) => {
    render(
      <StudyArtifactSheet
        kind="diagram"
        state={{ status: 'ready', data: { ...READY_DIAGRAM, mermaidCode: code } }}
        {...baseProps()}
      />,
    );
    expect(rendererProps).toHaveLength(0);
    expect(screen.queryByTestId('structured-renderer')).toBeNull();
  });

  it.each(unsafe)('never prints the raw source for %s', (_label, code) => {
    const { container } = render(
      <StudyArtifactSheet
        kind="diagram"
        state={{ status: 'ready', data: { ...READY_DIAGRAM, mermaidCode: code } }}
        {...baseProps()}
      />,
    );
    expect(container.innerHTML).not.toContain('alert(1)');
    expect(container.innerHTML).not.toContain('javascript:');
    expect(container.querySelector('script')).toBeNull();
  });

  it('shows the CALM fallback notice (not an error) for an unrenderable spec', () => {
    render(
      <StudyArtifactSheet
        kind="diagram"
        state={{ status: 'ready', data: { ...READY_DIAGRAM, mermaidCode: '' } }}
        {...baseProps()}
      />,
    );
    expect(screen.getByText("Couldn't build this from NCERT yet")).toBeTruthy();
    expect(screen.queryByText('Try again')).toBeNull();
  });
});

// ── 4. Abstain is NOT an error ───────────────────────────────────────────────

describe('Foxy StudyArtifactSheet — abstain is a calm notice, never an error', () => {
  const abstained: ArtifactState<DiagramSpec> = {
    status: 'abstained',
    messageEn: 'This chapter has no NCERT diagram source yet.',
    messageHi: 'इस अध्याय का NCERT स्रोत अभी नहीं है।',
    suggestedAlternatives: [
      {
        grade: '9',
        subject_code: 'science',
        chapter_number: 4,
        chapter_title: 'Structure of the Atom',
        rag_status: 'ready',
      },
    ],
  };

  it('renders the abstain heading and the SERVER-authored message', () => {
    render(<StudyArtifactSheet kind="diagram" state={abstained} {...baseProps()} />);
    expect(screen.getByText("Couldn't build this from NCERT yet")).toBeTruthy();
    expect(
      screen.getByText('This chapter has no NCERT diagram source yet.'),
    ).toBeTruthy();
  });

  it('prefers the Hindi server message under isHi (P7)', () => {
    render(<StudyArtifactSheet kind="diagram" state={abstained} {...baseProps()} isHi />);
    expect(screen.getByText('अभी NCERT से यह नहीं बन पाया')).toBeTruthy();
    expect(screen.getByText('इस अध्याय का NCERT स्रोत अभी नहीं है।')).toBeTruthy();
  });

  it('shows NO error copy and NO retry button', () => {
    render(<StudyArtifactSheet kind="diagram" state={abstained} {...baseProps()} />);
    expect(screen.queryByText('Try again')).toBeNull();
    expect(screen.queryByText("Couldn't reach Foxy")).toBeNull();
    expect(screen.queryByText('Not available right now')).toBeNull();
    expect(screen.queryByText('Not available for this chapter')).toBeNull();
  });

  it('lists the suggested ready chapters', () => {
    render(<StudyArtifactSheet kind="diagram" state={abstained} {...baseProps()} />);
    expect(screen.getByText('Chapters that are ready')).toBeTruthy();
    expect(screen.getByText('Ch 4: Structure of the Atom')).toBeTruthy();
  });

  it('falls back to house copy when the server sent no abstain message', () => {
    render(
      <StudyArtifactSheet
        kind="lesson"
        state={{
          status: 'abstained',
          messageEn: '',
          messageHi: '',
          suggestedAlternatives: [],
        }}
        {...baseProps()}
      />,
    );
    expect(
      screen.getByText(/Foxy only uses your NCERT book/),
    ).toBeTruthy();
  });

  it('still offers Regenerate (abstain is a settled result)', () => {
    const props = baseProps();
    render(<StudyArtifactSheet kind="diagram" state={abstained} {...props} />);
    fireEvent.click(screen.getByText('Regenerate').closest('button') as HTMLElement);
    expect(props.onRegenerate).toHaveBeenCalledTimes(1);
  });
});

// ── 5. Errors — retry only for 'network' ─────────────────────────────────────

describe('Foxy StudyArtifactSheet — error states', () => {
  it('unsupported (400) → its own copy, NO retry', () => {
    render(
      <StudyArtifactSheet
        kind="diagram"
        state={{ status: 'error', reason: 'unsupported' }}
        {...baseProps()}
      />,
    );
    expect(screen.getByText('Not available for this chapter')).toBeTruthy();
    expect(screen.queryByText('Try again')).toBeNull();
  });

  it('unavailable (401/403/404) → quiet degrade copy, NO retry', () => {
    render(
      <StudyArtifactSheet
        kind="diagram"
        state={{ status: 'error', reason: 'unavailable' }}
        {...baseProps()}
      />,
    );
    expect(screen.getByText('Not available right now')).toBeTruthy();
    expect(
      screen.getByText('This is turned off for now. Foxy in the chat still works.'),
    ).toBeTruthy();
    expect(screen.queryByText('Try again')).toBeNull();
  });

  it("network → 'Couldn't reach Foxy' AND a working Try again", () => {
    const props = baseProps();
    render(
      <StudyArtifactSheet
        kind="diagram"
        state={{ status: 'error', reason: 'network' }}
        {...props}
      />,
    );
    expect(screen.getByText("Couldn't reach Foxy")).toBeTruthy();
    fireEvent.click(screen.getByText('Try again'));
    expect(props.onRegenerate).toHaveBeenCalledTimes(1);
  });

  it('renders Hindi error copy under isHi (P7)', () => {
    render(
      <StudyArtifactSheet
        kind="diagram"
        state={{ status: 'error', reason: 'network' }}
        {...baseProps()}
        isHi
      />,
    );
    expect(screen.getByText('Foxy तक नहीं पहुँच पाए')).toBeTruthy();
    expect(screen.getByText('फिर कोशिश करो')).toBeTruthy();
  });

  it('offers NO header Regenerate in an error state (retry lives in the card)', () => {
    render(
      <StudyArtifactSheet
        kind="diagram"
        state={{ status: 'error', reason: 'network' }}
        {...baseProps()}
      />,
    );
    expect(screen.queryByText('Regenerate')).toBeNull();
  });
});

// ── 6. Lesson body ───────────────────────────────────────────────────────────

describe('Foxy StudyArtifactSheet — lesson body', () => {
  it('renders each section heading + body in the active language', () => {
    const { unmount } = render(
      <StudyArtifactSheet
        kind="lesson"
        state={{ status: 'ready', data: READY_LESSON }}
        {...baseProps()}
      />,
    );
    expect(screen.getByText('Why this matters')).toBeTruthy();
    expect(screen.getByText('Everything around you is made of atoms.')).toBeTruthy();
    unmount();

    render(
      <StudyArtifactSheet
        kind="lesson"
        state={{ status: 'ready', data: READY_LESSON }}
        {...baseProps()}
        isHi
      />,
    );
    expect(screen.getByText('यह क्यों ज़रूरी है')).toBeTruthy();
    expect(
      screen.getByText('तुम्हारे चारों ओर सब कुछ परमाणुओं से बना है।'),
    ).toBeTruthy();
  });

  // ── Bloom's badge ──────────────────────────────────────────────────────────
  //
  // SUPERSEDED ASSERTION (rewritten 2026-08-11). This pair of `it`s replaces a
  // single test that asserted `getByText('understand')` + `getByTitle("Bloom's:
  // understand")` under the name "keeps Bloom's level untranslated in Hindi
  // mode (technical term — P7)". That test was pinning the DEFECT as correct.
  //
  // P7 permits "Bloom's" as an untranslated technical term. It does NOT permit
  // `understand` / `analyze` / `evaluate` — those are the raw lowercase members
  // of the `BloomLevel` union, i.e. MACHINE values. Leaking them to a grade
  // 6-12 student was an R5 jargon audit finding: the badge read `understand` in
  // English AND in Hindi, so the "untranslated" the old test defended was
  // untranslated *jargon*, not an untranslated technical term. The fix renders
  // `BLOOM_CONFIG[level].label` / `.labelHi` — a human-readable, genuinely
  // bilingual label — with the config's description as the tooltip.
  //
  // The rewrite is strictly stronger than what it replaces: it pins the exact
  // EN and HI strings in BOTH languages (the old test only looked at Hindi),
  // pins the tooltip in both, AND adds a standing guard that no raw BloomLevel
  // token — derived from BLOOM_CONFIG's own keys, so a 7th level is covered on
  // the day it is added — appears as rendered text or in any title attribute.

  /** Every raw `BloomLevel` union member — the machine values, re-derived. */
  const RAW_BLOOM_TOKENS = Object.keys(BLOOM_CONFIG);

  /**
   * Every place a raw enum token could surface to a student: element text and
   * `title` tooltips. Returns offenders so a failure names the leak.
   */
  function rawBloomTokenLeaks(container: HTMLElement): string[] {
    const leaks: string[] = [];
    for (const el of Array.from(container.querySelectorAll<HTMLElement>('*'))) {
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim();
      if (RAW_BLOOM_TOKENS.includes(own)) leaks.push(`text:${own}`);
      const title = el.getAttribute('title');
      if (title !== null) {
        for (const t of RAW_BLOOM_TOKENS) {
          // Bare token, or the old `Bloom's: understand` tooltip shape.
          if (title.trim() === t || new RegExp(`\\b${t}\\b`).test(title)) {
            leaks.push(`title:${title}`);
          }
        }
      }
    }
    return leaks;
  }

  it('the raw-token guard actually detects the superseded markup (non-vacuity)', () => {
    // A guard that inspects nothing passes everything. Feed it the EXACT DOM
    // the component used to produce and assert it reports both leaks, so the
    // two `toEqual([])` assertions below are known to be load-bearing rather
    // than trivially satisfied.
    const old = document.createElement('div');
    old.innerHTML = `<h4><span title="Bloom's: understand">understand</span></h4>`;
    expect(rawBloomTokenLeaks(old)).toEqual([
      'text:understand',
      "title:Bloom's: understand",
    ]);

    // And the current markup is clean.
    const now = document.createElement('div');
    now.innerHTML = `<h4><span title="Explain ideas or concepts">Understand</span></h4>`;
    expect(rawBloomTokenLeaks(now)).toEqual([]);
  });

  it("renders Bloom's as a human-readable label in English, never the raw enum token (P7)", () => {
    const { container } = render(
      <StudyArtifactSheet
        kind="lesson"
        state={{ status: 'ready', data: READY_LESSON }}
        {...baseProps()}
      />,
    );
    // The badge is present and carries the config's description as its tooltip.
    const badge = screen.getByTitle('Explain ideas or concepts');
    expect(badge.textContent).toBe('Understand');
    // …and the machine value never reaches the student.
    expect(rawBloomTokenLeaks(container)).toEqual([]);
  });

  it("renders Bloom's as a human-readable label in Hindi, never the raw enum token (P7)", () => {
    const { container } = render(
      <StudyArtifactSheet
        kind="lesson"
        state={{ status: 'ready', data: READY_LESSON }}
        {...baseProps()}
        isHi
      />,
    );
    const badge = screen.getByTitle('विचारों या अवधारणाओं को समझाओ');
    expect(badge.textContent).toBe('समझो');
    expect(rawBloomTokenLeaks(container)).toEqual([]);
  });

  it("the EN and HI Bloom's labels are genuinely different strings (P7 parity)", () => {
    // The defect's signature was one string serving both languages. Assert the
    // two renders disagree, so a regression to a single hardcoded label — raw
    // token or not — cannot pass the two tests above by accident.
    const { unmount } = render(
      <StudyArtifactSheet
        kind="lesson"
        state={{ status: 'ready', data: READY_LESSON }}
        {...baseProps()}
      />,
    );
    const en = screen.getByTitle('Explain ideas or concepts').textContent;
    unmount();

    render(
      <StudyArtifactSheet
        kind="lesson"
        state={{ status: 'ready', data: READY_LESSON }}
        {...baseProps()}
        isHi
      />,
    );
    const hi = screen.getByTitle('विचारों या अवधारणाओं को समझाओ').textContent;

    expect(en).not.toBe(hi);
    expect(hi).toMatch(/[ऀ-ॿ]/); // Devanagari, not a transliteration
    expect(en).toMatch(/^[A-Z]/); // human-cased, not the lowercase machine value
  });

  it('renders the calm fallback for an empty section list', () => {
    render(
      <StudyArtifactSheet
        kind="lesson"
        state={{ status: 'ready', data: { ...READY_LESSON, sections: [] } }}
        {...baseProps()}
      />,
    );
    expect(screen.getByText("Couldn't build this from NCERT yet")).toBeTruthy();
  });
});

// ── 7. Dismissal + a11y ──────────────────────────────────────────────────────

describe('Foxy StudyArtifactSheet — dismissal and a11y', () => {
  it('closes on the ✕ button', () => {
    const props = baseProps();
    render(
      <StudyArtifactSheet kind="diagram" state={{ status: 'loading' }} {...props} />,
    );
    fireEvent.click(screen.getByLabelText('Close'));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', () => {
    const props = baseProps();
    render(
      <StudyArtifactSheet kind="diagram" state={{ status: 'loading' }} {...props} />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('labels the close control in Hindi under isHi', () => {
    render(
      <StudyArtifactSheet
        kind="diagram"
        state={{ status: 'loading' }}
        {...baseProps()}
        isHi
      />,
    );
    expect(screen.getByLabelText('बंद करो')).toBeTruthy();
  });

  it('is an aria-labelled modal dialog carrying the chapter label', () => {
    render(
      <StudyArtifactSheet kind="diagram" state={{ status: 'loading' }} {...baseProps()} />,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('foxy-artifact-diagram-title');
    expect(screen.getByText('Science · Ch 3: Atoms and Molecules')).toBeTruthy();
  });

  it('renders no student identifier / email / phone anywhere (P13)', () => {
    const { container } = render(
      <StudyArtifactSheet
        kind="lesson"
        state={{ status: 'ready', data: READY_LESSON }}
        {...baseProps()}
      />,
    );
    expect(container.innerHTML).not.toMatch(/studentId|student_id|userId|@|\+91/i);
  });
});
