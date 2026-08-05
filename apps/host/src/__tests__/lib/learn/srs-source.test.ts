/**
 * E4 — SRS single read adapter (srs-source) tests.
 *
 * Two concerns:
 *
 *   1. PREDICATE PARITY (source-text pins, deno-parity pattern): the
 *      `get_review_cards` SQL RPC in the baseline migration and the
 *      domains/practice reads the adapter delegates to must agree on the
 *      due predicate: student's own + is_active = true +
 *      next_review_date <= today. Before the E4 fix, listDueCards /
 *      countDueByStudent silently omitted is_active and counted
 *      soft-deleted cards (design-flagged live bug).
 *
 *   2. DELEGATION: getDueItems/getDueCount are thin passthroughs over
 *      domains/practice — no re-implemented predicate in the adapter.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// ── Delegation mocks (registered before the adapter import is evaluated) ──

const listDueCardsMock = vi.fn(async () => ({ ok: true as const, data: [] }));
const countDueByStudentMock = vi.fn(async () => ({
  ok: true as const,
  data: { total: 3, bySubject: { math: 3 } },
}));

vi.mock('@alfanumrik/lib/domains/practice', () => ({
  listDueCards: (...args: unknown[]) => listDueCardsMock(...(args as [])),
  countDueByStudent: (...args: unknown[]) => countDueByStudentMock(...(args as [])),
}));

import { getDueItems, getDueCount } from '@alfanumrik/lib/learn/srs-source';

// ── repo-file resolver (deno-parity test pattern) ──────────────────────────

function findRepoFile(relPath: string): string {
  const rel = relPath.split('/');
  const anchors: string[] = [];
  if (typeof __dirname !== 'undefined') anchors.push(__dirname);
  anchors.push(process.cwd());
  for (const anchor of anchors) {
    let dir = anchor;
    for (let i = 0; i < 10; i++) {
      const candidate = join(dir, ...rel);
      if (existsSync(candidate)) return candidate;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new Error(`could not locate ${relPath}`);
}

describe('srs-source predicate parity (RPC ⇄ adapter)', () => {
  const rpcSql = readFileSync(
    findRepoFile('supabase/migrations/00000000000000_baseline_from_prod.sql'),
    'utf8',
  );
  const practiceSrc = readFileSync(
    findRepoFile('packages/lib/src/domains/practice.ts'),
    'utf8',
  );

  // Extract just the get_review_cards function body from the baseline dump.
  const rpcBodyMatch = rpcSql.match(
    /FUNCTION "public"\."get_review_cards"[\s\S]*?\$\$[\s\S]*?\$\$;/,
  );

  it('the get_review_cards RPC filters on is_active AND next_review_date <= CURRENT_DATE', () => {
    expect(rpcBodyMatch, 'get_review_cards must exist in the baseline').not.toBeNull();
    const body = rpcBodyMatch![0];
    expect(body).toMatch(/is_active\s*=\s*true/);
    expect(body).toMatch(/next_review_date\s*<=\s*CURRENT_DATE/);
    expect(body).toMatch(/student_id\s*=\s*p_student_id/);
  });

  it('listDueCards carries the SAME predicate (is_active + next_review_date + student_id)', () => {
    const fn = practiceSrc.slice(
      practiceSrc.indexOf('export async function listDueCards'),
      practiceSrc.indexOf('export async function getCardById'),
    );
    expect(fn).toContain(".eq('student_id', studentId)");
    expect(fn).toContain(".eq('is_active', true)");
    expect(fn).toContain(".lte('next_review_date', today)");
  });

  it('countDueByStudent carries the SAME predicate (E4 fix pin — is_active was missing)', () => {
    const fn = practiceSrc.slice(
      practiceSrc.indexOf('export async function countDueByStudent'),
      practiceSrc.indexOf('// ── concept_mastery'),
    );
    expect(fn).toContain(".eq('student_id', studentId)");
    expect(fn).toContain(".eq('is_active', true)");
    expect(fn).toContain(".lte('next_review_date', today)");
  });

  it('the adapter itself defines NO predicate — it delegates to domains/practice', () => {
    const adapterSrc = readFileSync(
      findRepoFile('packages/lib/src/learn/srs-source.ts'),
      'utf8',
    );
    // The adapter must never re-build a Supabase query of its own (doc
    // comments may MENTION the predicate; the code may not construct it).
    expect(adapterSrc).not.toContain('.from(');
    expect(adapterSrc).not.toContain(".lte('next_review_date'");
    expect(adapterSrc).not.toContain(".eq('is_active'");
    expect(adapterSrc).toContain("from '../domains/practice'");
  });

  it('resolve-next-action reads the due count through the adapter, not inline', () => {
    const resolverSrc = readFileSync(
      findRepoFile('packages/lib/src/state/learner-loop/resolve-next-action.ts'),
      'utf8',
    );
    expect(resolverSrc).toContain('getDueCount(studentId)');
    // The retired inline count must not come back.
    expect(resolverSrc).not.toContain(".from('spaced_repetition_cards')");
  });
});

describe('srs-source delegation', () => {
  it('getDueItems forwards studentId + opts to listDueCards', async () => {
    const res = await getDueItems('student-1', { limit: 5, subject: 'math' });
    expect(res.ok).toBe(true);
    expect(listDueCardsMock).toHaveBeenCalledWith('student-1', { limit: 5, subject: 'math' });
  });

  it('getDueCount forwards studentId and returns the ServiceResult as-is', async () => {
    const res = await getDueCount('student-1');
    expect(countDueByStudentMock).toHaveBeenCalledWith('student-1');
    expect(res).toEqual({ ok: true, data: { total: 3, bySubject: { math: 3 } } });
  });
});
