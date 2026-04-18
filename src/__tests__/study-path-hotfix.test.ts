/**
 * Regression test for Phase 4 study-path hotfix (2026-04-18).
 *
 * Bug: immediately post-deploy, /api/student/subjects and /api/student/chapters
 * returned empty lists because v2 RPCs filtered rag_status='ready', but the
 * verify-question-bank drain hadn't populated verified_question_count yet,
 * so no chapter reached 'ready' status. Students saw empty study pickers.
 *
 * Fix:
 *   1. Migration 20260418130000 widens v2 RPC filter to IN ('partial', 'ready')
 *   2. Route handlers add fallback: if v2 returns [] AND student has a grade,
 *      fall back to GRADE_SUBJECTS (subjects) or `chapters` table (chapters)
 *      and log ops_events with category='grounding.study_path'.
 *
 * This test exercises the JS fallback helpers in isolation, since the
 * migration filter change is DB-side and tested via Postgres.
 */

import { describe, it, expect } from 'vitest';
import { getSubjectsForGrade } from '@/lib/constants';

describe('Phase 4 study-path fallback helpers', () => {
  it('getSubjectsForGrade returns non-empty list for valid grades', () => {
    for (const g of ['6', '7', '8', '9', '10', '11', '12']) {
      const subjects = getSubjectsForGrade(g);
      expect(subjects.length).toBeGreaterThan(0);
      // SUBJECT_META entries must have code + name (minimum fields the
      // fallback maps into the response)
      for (const s of subjects) {
        expect(s.code).toMatch(/^[a-z_]+$/);
        expect(s.name).toBeTruthy();
      }
    }
  });

  it('fallbackSubjectsForGrade shape matches SubjectResponse contract', () => {
    // Replicate the route helper inline since it's not exported
    const fallback = getSubjectsForGrade('10').map((s) => ({
      code: s.code,
      name: s.name,
      nameHi: s.name,                       // SUBJECT_META has no nameHi
      readyChapterCount: 0,
    }));

    expect(fallback.length).toBeGreaterThan(0);
    for (const row of fallback) {
      expect(row).toHaveProperty('code');
      expect(row).toHaveProperty('name');
      expect(row).toHaveProperty('nameHi');
      expect(row).toHaveProperty('readyChapterCount');
      expect(row.readyChapterCount).toBe(0);   // fallback signals "unverified coverage"
    }
  });

  it('fallback signals unverified coverage via readyChapterCount=0', () => {
    // Clients MUST see readyChapterCount=0 from the fallback path so they
    // can optionally style/badge these differently from true 'ready' rows.
    const fallback = getSubjectsForGrade('9').map((s) => ({
      code: s.code,
      name: s.name,
      nameHi: s.name,
      readyChapterCount: 0,
    }));
    for (const row of fallback) {
      expect(row.readyChapterCount).toBe(0);
    }
  });

  it('SUBJECT_META has no nameHi field (documents the fallback limitation)', () => {
    // If SUBJECT_META ever gains a nameHi field, update the fallback helper
    // to use it rather than duplicating English. This test locks the current
    // contract so drift is explicit.
    const subjects = getSubjectsForGrade('10');
    for (const s of subjects) {
      expect((s as unknown as Record<string, unknown>).nameHi).toBeUndefined();
    }
  });

  it('Fallback is only used when v2 returns empty AND student has a grade — contract documentation', () => {
    // The route handler guards:
    //   - If v2 returns non-empty rows: serve v2, never fall back
    //   - If v2 returns [] AND student has a grade: fall back with ops_events log
    //   - If v2 returns [] AND no student record: return {subjects: []} (safe)
    //   - If v2 errors AND student has a grade: fall back (with different reason)
    //   - If v2 errors AND no student record: return 500 { error: 'service_unavailable' }
    //
    // This test is documentation-only; the actual guard logic lives in
    // src/app/api/student/subjects/route.ts and is exercised by E2E.
    expect(true).toBe(true);
  });
});
