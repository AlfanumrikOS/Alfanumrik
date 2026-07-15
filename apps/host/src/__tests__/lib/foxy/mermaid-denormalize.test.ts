/**
 * Foxy `mermaid` block — denormalization contract (Wave 2).
 *
 * `denormalizeFoxyResponse` flattens a structured FoxyResponse into the legacy
 * `foxy_chat_messages.content` TEXT column (session resume, search, legacy
 * clients). For a `mermaid` block the ONLY human-readable artefact is its
 * `title` caption — the raw mermaid source (`flowchart TD ...`) is a wall of
 * program text that is useless to a student on resume and must NEVER be dumped
 * into the TEXT column (the JSONB payload stays the source of truth for the
 * actual drawable diagram).
 *
 * Contract pinned here:
 *   - mermaid WITH a title   → the legacy line is the title verbatim.
 *   - mermaid WITHOUT a title → the legacy line is the literal "[diagram]".
 *   - NEVER the raw mermaid `code`.
 *
 * Asserted on BOTH the Node copy (`packages/lib/src/foxy/denormalize.ts`) and
 * the Deno mirror (`supabase/functions/grounded-answer/structured-schema.ts`)
 * so the two 1-way transforms cannot drift.
 *
 * Owner: testing.
 */

import { describe, it, expect } from 'vitest';
import { denormalizeFoxyResponse } from '@alfanumrik/lib/foxy/denormalize';
import type { FoxyResponse } from '@alfanumrik/lib/foxy/schema';
// Deno mirror (pure TS — importable under Vitest).
import { denormalizeFoxyResponse as denormalizeDeno } from '../../../../../../supabase/functions/grounded-answer/structured-schema';

const RAW_CODE =
  'flowchart TD\n  A[Evaporation] --> B[Condensation]\n  B --> C[Precipitation]';

// ─────────────────────────────────────────────────────────────────────────────
// Node copy (src/lib/foxy/denormalize.ts)
// ─────────────────────────────────────────────────────────────────────────────

describe('denormalizeFoxyResponse (Node) — mermaid block', () => {
  it('uses the title as the legacy line when a title is present', () => {
    const payload: FoxyResponse = {
      title: 'Water Cycle Lesson',
      subject: 'science',
      blocks: [
        { type: 'paragraph', text: 'The water cycle moves water around Earth.' },
        { type: 'mermaid', code: RAW_CODE, title: 'The Water Cycle' } as FoxyResponse['blocks'][number],
      ],
    };
    const out = denormalizeFoxyResponse(payload);
    const lines = out.split('\n');
    // The mermaid block contributes exactly its title.
    expect(lines).toContain('The Water Cycle');
    // The raw mermaid source must never leak into the TEXT column.
    expect(out).not.toContain('flowchart');
    expect(out).not.toContain('Evaporation');
    expect(out).not.toContain(RAW_CODE);
  });

  it('emits the literal "[diagram]" placeholder when the mermaid block has no title', () => {
    const payload: FoxyResponse = {
      title: 'Photosynthesis',
      subject: 'science',
      blocks: [
        { type: 'mermaid', code: RAW_CODE } as FoxyResponse['blocks'][number],
      ],
    };
    const out = denormalizeFoxyResponse(payload);
    expect(out.split('\n')).toContain('[diagram]');
    expect(out).not.toContain('flowchart');
    expect(out).not.toContain(RAW_CODE);
  });

  it('treats a whitespace-only title as absent → "[diagram]"', () => {
    const payload: FoxyResponse = {
      title: 'X',
      subject: 'science',
      blocks: [
        { type: 'mermaid', code: RAW_CODE, title: '   ' } as FoxyResponse['blocks'][number],
      ],
    };
    const out = denormalizeFoxyResponse(payload);
    expect(out.split('\n')).toContain('[diagram]');
  });

  it('keeps the response title as the first line and never the diagram source', () => {
    const payload: FoxyResponse = {
      title: 'Lesson Title',
      subject: 'science',
      blocks: [
        { type: 'mermaid', code: RAW_CODE, title: 'Diagram Caption' } as FoxyResponse['blocks'][number],
      ],
    };
    const out = denormalizeFoxyResponse(payload);
    const lines = out.split('\n');
    expect(lines[0]).toBe('Lesson Title');
    expect(lines[1]).toBe('Diagram Caption');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Deno mirror (grounded-answer/structured-schema.ts)
// ─────────────────────────────────────────────────────────────────────────────

describe('denormalizeFoxyResponse (Deno mirror) — mermaid block', () => {
  it('uses the title as the legacy content when present, never the raw source', () => {
    const payload = {
      title: 'Water Cycle',
      subject: 'science' as const,
      blocks: [
        { type: 'paragraph' as const, text: 'Intro.' },
        { type: 'mermaid' as const, code: RAW_CODE, title: 'The Water Cycle' },
      ],
    };
    const out = denormalizeDeno(payload as never);
    expect(out).toContain('The Water Cycle');
    expect(out).not.toContain('flowchart');
    expect(out).not.toContain(RAW_CODE);
  });

  it('emits "[diagram]" when the mermaid block has no title', () => {
    const payload = {
      title: 'Photosynthesis',
      subject: 'science' as const,
      blocks: [{ type: 'mermaid' as const, code: RAW_CODE }],
    };
    const out = denormalizeDeno(payload as never);
    expect(out).toContain('[diagram]');
    expect(out).not.toContain('flowchart');
  });
});
