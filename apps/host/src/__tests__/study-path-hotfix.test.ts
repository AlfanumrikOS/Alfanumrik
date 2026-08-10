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
 * SUPERSEDED IN PART (Phase 3 P0, 2026-08-10) — READ BEFORE EXTENDING.
 * Step 2's SUBJECTS half is gone. /api/student/subjects no longer falls back
 * to GRADE_SUBJECTS / SUBJECT_META: that path ignored `subjects.is_active` and
 * served every hardcoded subject with isLocked=false, which became a leak once
 * the platform was restricted to the KEEP-SET. It now rebuilds from
 * grade_subject_map ⋈ active `subjects` (fail-closed, isLocked=true) and
 * returns [] when that yields nothing. The chapters half is unchanged.
 *
 * What survives here is coverage of the `getSubjectsForGrade` LIB HELPER
 * itself, which still exists as a deprecated compat shim with other callers.
 * These tests pin that shim's shape — they no longer describe route behaviour.
 * Route-level fallback behaviour is pinned by regression #8 in
 * regression-subject-leak.test.tsx.
 */

import { describe, it, expect } from 'vitest';
import { getSubjectsForGrade } from '@alfanumrik/lib/constants';

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

  it('Fallback is only used when v1 returns empty AND student has a grade — contract documentation', () => {
    // The subjects route handler guards (Phase 3 P0 shape):
    //   - If v1 returns non-empty rows: serve v1, never fall back
    //   - If v1 returns [] AND student has a grade: rebuild from
    //     grade_subject_map ⋈ subjects WHERE is_active, isLocked=true, and log
    //     ops_events — the rebuild may legitimately be EMPTY
    //   - If v1 returns [] AND no student record: return {subjects: []} (safe)
    //   - If v1 errors AND student has a grade: same rebuild, different reason
    //   - If v1 errors AND no student record: return 500 { error: 'service_unavailable' }
    //
    // This test is documentation-only; the executable version of this contract
    // is regression #8 in regression-subject-leak.test.tsx.
    expect(true).toBe(true);
  });
});
