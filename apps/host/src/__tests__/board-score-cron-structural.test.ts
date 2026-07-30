/**
 * Structural (source-text) pins for the nightly BoardScore cron —
 * `apps/host/src/app/api/cron/board-score/route.ts`.
 *
 * These are SOURCE-level pins, not behavioral execution — the cron loops
 * over live Supabase data with real fetch calls to a Deno Edge Function, so
 * full behavioral coverage would require an integration harness this repo
 * doesn't have for this route. What CAN be verified without one: that the
 * old per-grade "all subjects at grade" cache is genuinely gone (not just
 * renamed) and that the new per-student scoping function is the one
 * actually wired into the compute loop — the exact regression this batch
 * fixes (spec docs/superpowers/specs/2026-07-30-boardscore-subject-scoping.md
 * §4: "Replace `getActiveSubjectsForGrade(grade)`... the per-grade cache...
 * must become per-student").
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROUTE_PATH = path.resolve(
  __dirname,
  '../app/api/cron/board-score/route.ts',
);
const source = readFileSync(ROUTE_PATH, 'utf-8');

describe('cron/board-score route — per-student subject scoping (structural)', () => {
  it('imports getStudentBoardSubjects from the shared _lib module', () => {
    expect(source).toMatch(
      /import\s*\{\s*getStudentBoardSubjects\s*\}\s*from\s*['"]\.\/_lib\/get-student-board-subjects['"]/,
    );
  });

  it('calls getStudentBoardSubjects(studentId, grade) inside the per-student loop', () => {
    expect(source).toMatch(/getStudentBoardSubjects\(\s*studentId\s*,\s*grade\s*\)/);
  });

  it('the old grade-only subject function is gone — no getActiveSubjectsForGrade anywhere in this file', () => {
    expect(source).not.toMatch(/getActiveSubjectsForGrade/);
  });

  it('the old per-grade Map cache (subjectsByGrade) is gone — subjects are no longer cached by grade alone', () => {
    // A per-grade cache is invalid once subjects are student-scoped, because
    // two students in the same grade can have different selected_subjects
    // (spec §4). Assert no Map keyed only by grade drives subject selection.
    expect(source).not.toMatch(/subjectsByGrade/);
  });

  it('the compute call site is nested inside the per-student loop, not hoisted above it', () => {
    // The subjects lookup must happen AFTER `const { id: studentId, grade } = student;`
    // (i.e. inside the for...of activeStudents loop), not before it as a
    // one-time grade-keyed precomputation. The file's own header JSDoc also
    // mentions the call (for documentation) earlier in the file, so search
    // for the CALL SITE starting from the destructure, not from index 0.
    const studentDestructureIdx = source.indexOf('const { id: studentId, grade } = student;');
    expect(studentDestructureIdx).toBeGreaterThan(-1);
    const subjectsCallIdx = source.indexOf(
      'getStudentBoardSubjects(studentId, grade)',
      studentDestructureIdx,
    );
    expect(subjectsCallIdx).toBeGreaterThan(studentDestructureIdx);
  });

  it('there is no cross-student memoization structure (Map/cache) keyed by grade in this file', () => {
    // Broad canary: any `Map` construction in this file should not be
    // grade-keyed subject storage. The only acceptable residual `Map` usage
    // (if any) would not reference "grade" as a cache key concept.
    const mapDeclarations = source.match(/new Map[<(][^)]*\)/g) ?? [];
    for (const decl of mapDeclarations) {
      expect(decl.toLowerCase()).not.toContain('grade');
    }
  });
});
