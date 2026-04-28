/**
 * Unit tests for scripts/check-content-gaps.ts.
 *
 * These tests run in the standard Vitest unit suite (no Supabase required).
 * They assert (a) the query shape contract the script depends on and (b)
 * the gap-detection logic on synthetic input. Live-DB exercise of the
 * script is left to the nightly content-quality workflow.
 */
import { describe, it, expect } from 'vitest';
import {
  buildGapReport,
  QUERY_SHAPES,
  TARGET_SUBJECTS,
} from '../../scripts/check-content-gaps';

describe('check-content-gaps — query shape', () => {
  it('selects exactly subject + grade from rag_content_chunks (P13: no PII)', () => {
    expect(QUERY_SHAPES.rag_content_chunks.table).toBe('rag_content_chunks');
    expect(QUERY_SHAPES.rag_content_chunks.select).toBe('subject, grade');
    expect(QUERY_SHAPES.rag_content_chunks.filter).toEqual({ is_active: true });
  });

  it('selects exactly subject + grade from question_bank (P13: no PII)', () => {
    expect(QUERY_SHAPES.question_bank.table).toBe('question_bank');
    expect(QUERY_SHAPES.question_bank.select).toBe('subject, grade');
    expect(QUERY_SHAPES.question_bank.filter).toEqual({ is_active: true });
  });

  it('every TARGET_SUBJECTS grade is a string (P5)', () => {
    for (const t of TARGET_SUBJECTS) {
      for (const g of t.grades) {
        expect(typeof g).toBe('string');
        expect(g).toMatch(/^(6|7|8|9|10|11|12)$/);
      }
    }
  });
});

describe('check-content-gaps — buildGapReport', () => {
  it('returns one row per (subject, grade) pair in TARGET_SUBJECTS', () => {
    const report = buildGapReport([], []);
    const expectedPairs = TARGET_SUBJECTS.reduce((n, t) => n + t.grades.length, 0);
    expect(report.rows.length).toBe(expectedPairs);
  });

  it('flags catastrophic gap when chunks AND questions are zero', () => {
    const report = buildGapReport([], []);
    // With empty input, every pair is catastrophic.
    expect(report.catastrophicGaps).toBeGreaterThan(0);
    expect(report.catastrophicGaps).toBe(report.rows.length);
    expect(report.rows.every((r) => r.catastrophic)).toBe(true);
  });

  it('does NOT flag catastrophic when only chunks are zero', () => {
    // Need to seed enough question rows that math|Grade 10 is non-zero.
    const questionRows = Array.from({ length: 5 }, () => ({
      subject: 'math',
      grade: 'Grade 10',
    }));
    const report = buildGapReport([], questionRows);
    const mathGrade10 = report.rows.find(
      (r) => r.subject === 'math' && r.grade === '10',
    );
    expect(mathGrade10).toBeDefined();
    expect(mathGrade10!.questionCount).toBe(5);
    expect(mathGrade10!.catastrophic).toBe(false);
    // Still below P3 floor → questionOk=false but not catastrophic.
    expect(mathGrade10!.questionOk).toBe(false);
  });

  it('marks pair as OK when both floors are met', () => {
    // math grade 10 needs minChunks=100, minQuestions=100.
    const ragRows = Array.from({ length: 100 }, () => ({
      subject: 'math',
      grade: 'Grade 10',
    }));
    const questionRows = Array.from({ length: 100 }, () => ({
      subject: 'math',
      grade: 'Grade 10',
    }));
    const report = buildGapReport(ragRows, questionRows);
    const row = report.rows.find(
      (r) => r.subject === 'math' && r.grade === '10',
    )!;
    expect(row.ragOk).toBe(true);
    expect(row.questionOk).toBe(true);
    expect(row.catastrophic).toBe(false);
  });

  it('lowercases question_bank subject when bucketing (case-insensitive match)', () => {
    const questionRows = [{ subject: 'MATH', grade: 'Grade 8' }];
    const report = buildGapReport([], questionRows);
    const row = report.rows.find(
      (r) => r.subject === 'math' && r.grade === '8',
    )!;
    expect(row.questionCount).toBe(1);
  });

  it('ignores rows missing subject or grade (P13: no PII leak via null logging)', () => {
    const report = buildGapReport(
      [{ subject: null, grade: 'Grade 10' }, { subject: 'math', grade: null }],
      [{ subject: null, grade: null }],
    );
    expect(report.totalRagChunks).toBe(2);
    expect(report.totalQuestions).toBe(1);
    // None of the inputs were valid, so every pair is catastrophic.
    expect(report.catastrophicGaps).toBe(report.rows.length);
  });
});
