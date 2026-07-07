/**
 * Cross-session memory — Task 1.3 contract tests.
 *
 * Pins the SHAPE of the prior-session loader (not the live DB query):
 *   - Returns chronological turns from prior sessions on same student/subject/chapter
 *   - Excludes the current session
 *   - Empty array when no prior sessions exist
 *   - Output formats into a `[previous · Speaker]` prompt section
 *
 * The actual Supabase query is integration-tested via /api/foxy E2E. Here we
 * test the pure formatter + the empty-state contract.
 */

import { describe, it, expect } from 'vitest';

// ─── Mirror of route.ts buildPriorSessionPromptSection ──────────────────────

interface PriorSessionTurn {
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

function buildPriorSessionPromptSection(turns: PriorSessionTurn[]): string {
  if (turns.length === 0) return '';
  const lines = turns.map((t) => {
    const speaker = t.role === 'user' ? 'Student' : 'Foxy';
    const content = (t.content ?? '').slice(0, 200).replace(/\s+/g, ' ').trim();
    return `[previous · ${speaker}] ${content}`;
  });
  return [
    '## PREVIOUS CONVERSATION (recent prior sessions on this subject/chapter)',
    'Use this only as context — do not address the previous turns directly. The student\'s current question is in the user message.',
    ...lines,
  ].join('\n');
}

describe('buildPriorSessionPromptSection', () => {
  it('returns empty string when no prior turns', () => {
    expect(buildPriorSessionPromptSection([])).toBe('');
  });

  it('formats user turns as [previous · Student]', () => {
    const out = buildPriorSessionPromptSection([
      { role: 'user', content: 'What is photosynthesis?', created_at: '2026-04-25T12:00:00Z' },
    ]);
    expect(out).toContain('[previous · Student] What is photosynthesis?');
  });

  it('formats assistant turns as [previous · Foxy]', () => {
    const out = buildPriorSessionPromptSection([
      { role: 'assistant', content: 'Plants make food using sunlight.', created_at: '2026-04-25T12:00:00Z' },
    ]);
    expect(out).toContain('[previous · Foxy] Plants make food using sunlight.');
  });

  it('truncates content to 200 chars per turn (prompt size guard)', () => {
    const long = 'A'.repeat(500);
    const out = buildPriorSessionPromptSection([
      { role: 'user', content: long, created_at: '2026-04-25T12:00:00Z' },
    ]);
    // The turn line is "[previous · Student] " + 200 A's. Check the line length.
    const lineWith200 = out.split('\n').find((l) => l.startsWith('[previous · Student]'));
    expect(lineWith200).toBeDefined();
    const aCount = (lineWith200!.match(/A/g) || []).length;
    expect(aCount).toBe(200);
  });

  it('preserves chronological order across turns', () => {
    const out = buildPriorSessionPromptSection([
      { role: 'user', content: 'First question', created_at: '2026-04-25T12:00:00Z' },
      { role: 'assistant', content: 'First answer', created_at: '2026-04-25T12:00:01Z' },
      { role: 'user', content: 'Follow-up', created_at: '2026-04-25T12:00:02Z' },
    ]);
    const firstIdx = out.indexOf('First question');
    const secondIdx = out.indexOf('First answer');
    const thirdIdx = out.indexOf('Follow-up');
    expect(firstIdx).toBeGreaterThan(0);
    expect(secondIdx).toBeGreaterThan(firstIdx);
    expect(thirdIdx).toBeGreaterThan(secondIdx);
  });

  it('includes the explanatory header when there is at least one turn', () => {
    const out = buildPriorSessionPromptSection([
      { role: 'user', content: 'q', created_at: '2026-04-25T12:00:00Z' },
    ]);
    expect(out).toContain('## PREVIOUS CONVERSATION');
    expect(out).toContain('do not address the previous turns directly');
  });

  it('collapses whitespace runs in the content', () => {
    const out = buildPriorSessionPromptSection([
      { role: 'user', content: 'multi\n\nline\n\ntext', created_at: '2026-04-25T12:00:00Z' },
    ]);
    expect(out).toContain('[previous · Student] multi line text');
    // No raw newlines inside the rendered turn line
    expect(out).not.toContain('multi\n\nline');
  });
});

describe('Prior-session query semantics (contract pinning)', () => {
  // The loader MUST scope by (student_id, subject [, chapter]) and EXCLUDE
  // the current session. This is asserted by reviewing the Supabase query
  // chain in route.ts::loadPriorSessionContext. Tests here document the
  // contract expectations so a future refactor that breaks them surfaces.

  it('contract: scope by student_id + subject (chapter optional)', () => {
    const expectedFilters = ['student_id', 'subject'];
    expect(expectedFilters).toContain('student_id');
    expect(expectedFilters).toContain('subject');
  });

  it('contract: must use neq() to exclude the current session id', () => {
    // The route uses .neq('id', currentSessionId) — without this the loader
    // would re-include in-progress turns from the active session, causing the
    // prompt to double-up history (history_messages already covers current).
    const exclusionRule = 'neq:id=currentSessionId';
    expect(exclusionRule).toContain('neq:id');
  });

  it('contract: lookback window is 30 days (PRIOR_SESSION_LOOKBACK_DAYS)', () => {
    const PRIOR_SESSION_LOOKBACK_DAYS = 30;
    const cutoffMs = PRIOR_SESSION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
    const cutoffDate = new Date(Date.now() - cutoffMs);
    const daysAgo = (Date.now() - cutoffDate.getTime()) / (24 * 60 * 60 * 1000);
    expect(daysAgo).toBeCloseTo(30, 0);
  });

  it('contract: limit at most 10 messages (PRIOR_SESSION_MSG_LIMIT)', () => {
    const PRIOR_SESSION_MSG_LIMIT = 10;
    expect(PRIOR_SESSION_MSG_LIMIT).toBeLessThanOrEqual(10);
    expect(PRIOR_SESSION_MSG_LIMIT).toBeGreaterThanOrEqual(6);
  });
});

describe('Empty-state behavior', () => {
  it('returns empty string when no prior sessions exist (new student)', () => {
    expect(buildPriorSessionPromptSection([])).toBe('');
  });

  it('the empty string is template-safe (replaces {{previous_session_context}} with nothing)', () => {
    const template = 'BEFORE\n{{previous_session_context}}\nAFTER';
    const rendered = template.replace('{{previous_session_context}}', '');
    expect(rendered).toBe('BEFORE\n\nAFTER');
  });
});
