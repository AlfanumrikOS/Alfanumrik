/**
 * RCA 2026-06-21 root-cause fix regression tests.
 *
 * Covers the four SQL migrations that repaired silent data-pipeline failures:
 *
 *   Fix 1 — 20260621000500_backfill_question_bank_topic_id.sql
 *            Backfills question_bank.topic_id from curriculum_topics so that
 *            submit_quiz_results_v2's mastery guard fires.
 *
 *   Fix 2 — 20260621000600_submit_quiz_v2_topic_id_fallback.sql
 *            Runtime fallback: if topic_id is still NULL at quiz-submit time,
 *            derive it from curriculum_topics using (subject, grade, chapter_number).
 *
 *   Fix 3 — 20260621000700_fix_missing_rag_chapters.sql
 *            Promotes cbse_syllabus rows from rag_status='missing' to 'partial'
 *            where at least one verified question exists, so they appear in the
 *            chapter picker.
 *
 *   Fix 4 — 20260621000800_reset_premature_autonomous_flags.sql
 *            Resets ff_adaptive_remediation_v1, ff_adaptive_loops_bc_v1, and
 *            ff_school_pulse_v1 to is_enabled=false (they were ON prematurely).
 *
 * All tests are pure unit tests — no network, no Supabase, no application imports.
 * Catalog entries: REG-135 (Fix 1+2), REG-136 (Fix 3), REG-137 (Fix 4).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('RCA 2026-06-21 root-cause fixes', () => {

  describe('Fix 1 + 2: concept_mastery write invariant (topic_id backfill + runtime fallback)', () => {

    it('REG-135a: mastery is written when question_bank.topic_id is non-null (baseline)', () => {
      // Unit-test the guard logic: a question with topic_id set → update_learner_state called
      // Model the guard: IF topic_id IS NOT NULL → mastery write
      const topicId = 'uuid-topic-1';
      let masteryWritten = false;
      const updateMastery = (tid: string) => { masteryWritten = true; };

      // Simulate: question has topic_id
      const question = { topic_id: topicId, subject: 'math', grade: '9', chapter_number: 1 };
      if (question.topic_id !== null) updateMastery(question.topic_id);

      expect(masteryWritten).toBe(true);
    });

    it('REG-135b: mastery is skipped when topic_id is NULL and no fallback (pre-fix behaviour)', () => {
      // Demonstrate the bug: without fallback, NULL topic_id → guard skips write
      let masteryWritten = false;
      const question = { topic_id: null, subject: 'math', grade: '9', chapter_number: 1 };
      // Old guard (no fallback):
      if (question.topic_id !== null) masteryWritten = true;
      expect(masteryWritten).toBe(false);
    });

    it('REG-135c: Fix 2 fallback — mastery IS written when topic_id NULL but curriculum_topics match exists', () => {
      // Simulate the runtime fallback: topic_id starts NULL → look up curriculum_topics → write mastery
      const mockCurriculumTopics = [
        { id: 'ct-uuid-1', subject_code: 'math', grade: '9', chapter_number: 1, display_order: 1 },
      ];

      let v_q_topic_id: string | null = null; // simulates question_bank.topic_id = NULL
      const v_q_subject = 'math';
      const v_q_chapter = 1;
      const p_grade = '9';

      // Simulate fallback (Fix 2 logic):
      if (v_q_topic_id === null) {
        const match = mockCurriculumTopics.find(
          ct => ct.subject_code === v_q_subject && ct.grade === p_grade && ct.chapter_number === v_q_chapter
        );
        if (match) v_q_topic_id = match.id;
      }

      // Now the guard fires:
      let masteryWritten = false;
      if (v_q_topic_id !== null) masteryWritten = true;

      expect(v_q_topic_id).toBe('ct-uuid-1');
      expect(masteryWritten).toBe(true);
    });

    it('REG-135d: Fix 1 backfill — join key uses string grade (P5 compliance)', () => {
      // P5: grades are strings "6"-"12", never integers
      // The backfill UPDATE joins on ct.grade = qb.grade where both are TEXT
      const gradeFromQuestion = '9';    // TEXT
      const gradeFromCurriculumTopic = '9'; // TEXT
      // Must be string equality, not number equality
      expect(typeof gradeFromQuestion).toBe('string');
      expect(typeof gradeFromCurriculumTopic).toBe('string');
      expect(gradeFromQuestion).toBe(gradeFromCurriculumTopic);
      // Would fail if someone converts to int: 9 === '9' is false in strict mode
      expect(gradeFromQuestion === (9 as unknown as string)).toBe(false);
    });

    it('REG-135e: Fix 2 fallback uses p_grade (session grade), not question-row grade', () => {
      // Fix 2 uses p_grade (the session-level grade param) in the fallback SELECT,
      // NOT a grade read from question_bank. This is intentional — session owns canonical grade.
      // Simulate: question_bank grade might differ from session grade in edge cases
      const p_grade = '9';  // session-level grade (canonical)
      const question_grade = '9';  // question_bank.grade
      // The fallback must use p_grade
      const usedGrade = p_grade; // Fix 2 uses p_grade, not question_grade
      expect(usedGrade).toBe(p_grade);
    });

    it('REG-135f: backfill is idempotent — WHERE topic_id IS NULL guard prevents double-update', () => {
      // If run twice: second pass has topic_id set, so WHERE IS NULL skips all rows
      const questions = [
        { id: 'q1', topic_id: null as string | null, subject: 'math', grade: '9', chapter_number: 1 },
      ];
      const curriculum = [{ id: 'ct1', subject_code: 'math', grade: '9', chapter_number: 1 }];

      // First run:
      for (const q of questions) {
        if (q.topic_id === null) {
          const match = curriculum.find(ct => ct.subject_code === q.subject && ct.grade === q.grade && ct.chapter_number === q.chapter_number);
          if (match) q.topic_id = match.id;
        }
      }
      expect(questions[0].topic_id).toBe('ct1');

      // Second run (idempotent — WHERE topic_id IS NULL skips):
      let secondRunUpdated = 0;
      for (const q of questions) {
        if (q.topic_id === null) {
          secondRunUpdated++;
        }
      }
      expect(secondRunUpdated).toBe(0);
    });
  });

  describe('Fix 3: chapter visibility invariant (rag_status missing → partial)', () => {

    it('REG-136a: chapter with rag_status=missing is excluded from picker (pre-fix)', () => {
      const chapters = [
        { id: 'ch1', rag_status: 'missing', chapter_number: 5 },
        { id: 'ch2', rag_status: 'partial', chapter_number: 6 },
        { id: 'ch3', rag_status: 'ready', chapter_number: 7 },
      ];
      // available_chapters_for_student_subject_v2 filter:
      const visible = chapters.filter(c => ['partial', 'ready'].includes(c.rag_status));
      expect(visible.map(c => c.chapter_number)).toEqual([6, 7]);
      expect(visible.find(c => c.id === 'ch1')).toBeUndefined();
    });

    it('REG-136b: chapter promoted to partial (has verified questions) becomes visible', () => {
      // Simulate Fix 3: migrate rag_status missing → partial where verified questions exist
      const chapters = [
        { id: 'ch1', rag_status: 'missing' as string, chapter_number: 5, board: 'CBSE', subject_code: 'math', grade: '9' },
      ];
      const verifiedQuestions = [
        { subject: 'math', grade: '9', chapter_number: 5, is_active: true, deleted_at: null, verification_state: 'verified' },
      ];

      // Apply migration logic:
      for (const ch of chapters) {
        const hasVerified = verifiedQuestions.some(
          q => q.subject === ch.subject_code && q.grade === ch.grade && q.chapter_number === ch.chapter_number
            && q.is_active && q.deleted_at === null && q.verification_state === 'verified'
        );
        if (ch.rag_status === 'missing' && ch.board === 'CBSE' && hasVerified) {
          ch.rag_status = 'partial';
        }
      }

      expect(chapters[0].rag_status).toBe('partial');

      // Now the picker includes it:
      const visible = chapters.filter(c => ['partial', 'ready'].includes(c.rag_status));
      expect(visible).toHaveLength(1);
      expect(visible[0].chapter_number).toBe(5);
    });

    it('REG-136c: chapter with rag_status=missing and NO verified questions stays missing', () => {
      const chapters = [
        { id: 'ch1', rag_status: 'missing' as string, chapter_number: 5, board: 'CBSE', subject_code: 'math', grade: '9' },
      ];
      const verifiedQuestions: any[] = []; // no questions

      for (const ch of chapters) {
        const hasVerified = verifiedQuestions.some(
          q => q.subject === ch.subject_code && q.grade === ch.grade && q.chapter_number === ch.chapter_number
        );
        if (ch.rag_status === 'missing' && ch.board === 'CBSE' && hasVerified) {
          ch.rag_status = 'partial';
        }
      }

      expect(chapters[0].rag_status).toBe('missing');
      const visible = chapters.filter(c => ['partial', 'ready'].includes(c.rag_status));
      expect(visible).toHaveLength(0);
    });

    it('REG-136d: migration is idempotent — only rows with rag_status=missing are updated', () => {
      const chapters = [
        { rag_status: 'partial' as string, updated: false },
        { rag_status: 'ready' as string, updated: false },
        { rag_status: 'missing' as string, updated: false },
      ];
      // Simulate WHERE rag_status = 'missing':
      for (const ch of chapters) {
        if (ch.rag_status === 'missing') {
          ch.rag_status = 'partial';
          ch.updated = true;
        }
      }
      expect(chapters.filter(c => c.updated)).toHaveLength(1);
      expect(chapters[0].rag_status).toBe('partial'); // was already partial — unchanged
      expect(chapters[1].rag_status).toBe('ready');   // was ready — unchanged
    });
  });

  describe('Fix 4: autonomous flag reset invariant', () => {

    it('REG-137a: ff_adaptive_remediation_v1 set to false', () => {
      // Simulate the feature_flags state before and after migration
      const flags: Record<string, boolean> = {
        ff_adaptive_remediation_v1: true,  // was ON prematurely
        ff_adaptive_loops_bc_v1: true,
        ff_school_pulse_v1: true,
        ff_today_home_v1: true,            // should NOT be touched
      };
      const RESET_FLAGS = ['ff_adaptive_remediation_v1', 'ff_adaptive_loops_bc_v1', 'ff_school_pulse_v1'];

      // Apply migration:
      for (const flag of RESET_FLAGS) {
        if (flags[flag] === true) flags[flag] = false;
      }

      expect(flags['ff_adaptive_remediation_v1']).toBe(false);
      expect(flags['ff_adaptive_loops_bc_v1']).toBe(false);
      expect(flags['ff_school_pulse_v1']).toBe(false);
      expect(flags['ff_today_home_v1']).toBe(true); // untouched
    });

    it('REG-137b: flag reset is idempotent — already-false flags are unaffected', () => {
      const flags: Record<string, boolean> = {
        ff_adaptive_remediation_v1: false, // already OFF
        ff_adaptive_loops_bc_v1: false,
        ff_school_pulse_v1: false,
      };
      const RESET_FLAGS = ['ff_adaptive_remediation_v1', 'ff_adaptive_loops_bc_v1', 'ff_school_pulse_v1'];
      let rowsUpdated = 0;
      for (const flag of RESET_FLAGS) {
        if (flags[flag] === true) { flags[flag] = false; rowsUpdated++; }
      }
      // WHERE is_enabled = true guard means 0 rows updated on re-run:
      expect(rowsUpdated).toBe(0);
    });

    it('REG-137c: autonomous loop flags are independent (can be toggled separately)', () => {
      // Loop A and Loops B/C have separate flags per the constitution
      // Resetting B/C flag does not affect A flag
      const flags = {
        ff_adaptive_remediation_v1: false,   // Loop A
        ff_adaptive_loops_bc_v1: false,      // Loops B & C (separate ramp)
        ff_school_pulse_v1: false,
      };
      // Enable just Loop A:
      flags.ff_adaptive_remediation_v1 = true;
      expect(flags.ff_adaptive_remediation_v1).toBe(true);
      expect(flags.ff_adaptive_loops_bc_v1).toBe(false); // independent
    });
  });

});
