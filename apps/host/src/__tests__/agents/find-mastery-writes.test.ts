import { describe, expect, it } from 'vitest';
import {
  findMasteryWrites,
  FORBIDDEN_MASTERY_WRITE_TABLES,
} from '@alfanumrik/lib/agents/registry';

/**
 * Detector unit tests for `findMasteryWrites` (GenAI Phase 3, spec §3(e)).
 *
 * The detector is the TEETH behind the WHAT/HOW mastery-write boundary: it
 * statically scans a source string for direct Supabase writes
 * (`.from('<t>').insert|update|upsert|delete(`) to any of the 9 forbidden
 * mastery/progression tables, ignoring reads (`.select`). These tests pin its
 * positive-match, dedupe/sort, and false-positive-avoidance behavior so the
 * conformance harness (agent-registry-conformance.test.ts) can trust it.
 */
describe('findMasteryWrites — WHAT/HOW mastery-write detector (GenAI Phase 3)', () => {
  describe('positive: flags direct writes to forbidden mastery tables', () => {
    it('detects .insert() on a forbidden table', () => {
      const src = `await supabase.from('concept_mastery').insert({ student_id: id });`;
      expect(findMasteryWrites(src)).toEqual(['concept_mastery']);
    });

    it('detects .update() on a forbidden table', () => {
      const src = `await supabase.from('learner_mastery').update({ mastery: 0.9 }).eq('id', x);`;
      expect(findMasteryWrites(src)).toEqual(['learner_mastery']);
    });

    it('detects .upsert() on a forbidden table', () => {
      const src = `await supabase.from('cme_concept_state').upsert(row);`;
      expect(findMasteryWrites(src)).toEqual(['cme_concept_state']);
    });

    it('detects .delete() on a forbidden table', () => {
      const src = `await supabase.from('knowledge_gaps').delete().eq('student_id', id);`;
      expect(findMasteryWrites(src)).toEqual(['knowledge_gaps']);
    });

    it('tolerates whitespace and newlines between .from(...) and the write method', () => {
      const src = `
        await supabase
          .from(  "student_skill_state"  )
          .update({ level: 3 })
          .eq('id', x);
      `;
      expect(findMasteryWrites(src)).toEqual(['student_skill_state']);
    });

    it('tolerates double or single quotes around the table name', () => {
      const single = `supabase.from('bloom_progression').insert(r)`;
      const double = `supabase.from("bloom_progression").insert(r)`;
      expect(findMasteryWrites(single)).toEqual(['bloom_progression']);
      expect(findMasteryWrites(double)).toEqual(['bloom_progression']);
    });

    it('dedupes and sorts multiple forbidden-table writes', () => {
      const src = `
        await supabase.from('student_learning_profiles').upsert(a);
        await supabase.from('concept_mastery').insert(b);
        await supabase.from('concept_mastery').update(c).eq('id', x);
        await supabase.from('adaptive_mastery').delete().eq('id', y);
      `;
      // sorted + deduped: adaptive_mastery, concept_mastery, student_learning_profiles
      expect(findMasteryWrites(src)).toEqual([
        'adaptive_mastery',
        'concept_mastery',
        'student_learning_profiles',
      ]);
    });

    it('covers cme_error_log (the 9th forbidden table)', () => {
      const src = `await supabase.from('cme_error_log').insert(entry);`;
      expect(findMasteryWrites(src)).toEqual(['cme_error_log']);
    });
  });

  describe('negative: does NOT flag reads, non-forbidden writes, or substrings', () => {
    it('does NOT flag a .select() read on a forbidden table', () => {
      const src = `const { data } = await supabase.from('concept_mastery').select('*').eq('student_id', id);`;
      expect(findMasteryWrites(src)).toEqual([]);
    });

    it('does NOT flag a read even when chained through eq/order', () => {
      const src = `
        await supabase
          .from('learner_mastery')
          .select('mastery, concept_id')
          .eq('student_id', id)
          .order('updated_at');
      `;
      expect(findMasteryWrites(src)).toEqual([]);
    });

    it('does NOT flag a write to a non-forbidden table', () => {
      const src = `await supabase.from('quiz_sessions').insert(session);`;
      expect(findMasteryWrites(src)).toEqual([]);
    });

    it('does NOT flag a substring false-positive (e.g. concept_mastery_audit)', () => {
      // The regex anchors the table name inside quotes, so a differently-named
      // table that merely CONTAINS a forbidden name as a substring is not matched.
      const src = `await supabase.from('concept_mastery_audit').insert(row);`;
      expect(findMasteryWrites(src)).toEqual([]);
    });

    it('does NOT flag a forbidden name appearing only in a comment or string literal', () => {
      const src = `
        // We never write concept_mastery here.
        const label = 'concept_mastery';
        await supabase.from('quiz_responses').insert({ note: label });
      `;
      expect(findMasteryWrites(src)).toEqual([]);
    });

    it('returns empty for source with no Supabase calls at all', () => {
      expect(findMasteryWrites('export const x = 1;')).toEqual([]);
    });
  });

  describe('table-set parameterization', () => {
    it('honors a custom (smaller) forbidden-table set', () => {
      const src = `
        await supabase.from('concept_mastery').insert(a);
        await supabase.from('knowledge_gaps').insert(b);
      `;
      expect(findMasteryWrites(src, ['knowledge_gaps'])).toEqual(['knowledge_gaps']);
    });

    it('defaults to all 9 canonical forbidden tables', () => {
      expect(FORBIDDEN_MASTERY_WRITE_TABLES).toHaveLength(9);
      // Every canonical forbidden table is detected by the default call.
      for (const table of FORBIDDEN_MASTERY_WRITE_TABLES) {
        const src = `await supabase.from('${table}').insert(row);`;
        expect(findMasteryWrites(src)).toEqual([table]);
      }
    });
  });
});
