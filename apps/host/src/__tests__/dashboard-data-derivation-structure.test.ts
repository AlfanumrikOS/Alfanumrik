import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * get_dashboard_data bloom + knowledge_gaps derivation fix — STRUCTURAL pins
 * (always-on, runs in the NORMAL CI lane; no database required).
 *
 * Companion to the integration-lane e2e
 * (migrations/dashboard-data-derivation-e2e.test.ts). These pins grep the
 * migration SOURCE so the repoint cannot silently regress.
 *
 * THE BUG (RCA): get_dashboard_data (baseline) read the empty
 * public.bloom_progression / public.knowledge_gaps tables INLINE
 * (bloom_progression LIMIT 1 -> v_bloom; knowledge_gaps LIMIT 3 -> v_gaps).
 * The quiz/mastery pipeline NEVER writes those tables, so the dashboard's
 * 'bloom' and 'knowledge_gaps' keys were dead (null / []).
 *
 * THE FIX (one migration):
 *   - 20260623000800_derive_dashboard_bloom_and_gaps_from_concept_mastery.sql
 *       Repoints get_dashboard_data's INLINE reads to DERIVE from the populated
 *       public.concept_mastery (the single source of truth) — mirroring the
 *       sibling 20260623000700 RPC derivation, but PRESERVING get_dashboard_data's
 *       OWN emitted shape (NOT the standalone RPCs' shape):
 *         * bloom = a SINGLE jsonb object with 7 keys (current_bloom_level + the
 *           6 *_mastery levels), or NULL when no practiced concepts.
 *         * knowledge_gaps = a jsonb ARRAY of EXACTLY 5 fields
 *           { id, target_concept_name, missing_prerequisite_name, status,
 *           confidence_score }, ordered confidence_score DESC, LIMIT 3,
 *           status = 'open'.
 *       Signature, all ~11 top-level keys, SECURITY DEFINER, search_path, and the
 *       student-scoped WHERE are PRESERVED. Never reads the empty tables.
 *       Idempotent: DROP FUNCTION IF EXISTS (exact signature) + CREATE OR REPLACE.
 *
 * THE BUGS THESE WOULD CATCH:
 *   - reverting the inline reads back to FROM bloom_progression / knowledge_gaps
 *     (the dead-surface regression).
 *   - changing the preserved signature (p_student_id uuid) RETURNS jsonb.
 *   - dropping SECURITY DEFINER / search_path / the student-scoped lookup.
 *   - the bloom object shape drifting from the 7-key single-object contract.
 *   - the knowledge_gaps array drifting from the 5-field { id,
 *     target_concept_name, missing_prerequisite_name, status, confidence_score }
 *     shape, or losing status='open' / confidence_score = 1 - mastery_probability.
 *   - the migration turning destructive (DROP TABLE/COLUMN) or writing the empty
 *     tables, or losing idempotency.
 *
 * Mirrors the repo's grep-the-migration-file conformance style
 * (analysis-surfaces-derivation-structure.test.ts — REG-135 — and
 * canonical-mastery-write-structure.test.ts).
 */

const MIGRATION =
  'supabase/migrations/20260623000800_derive_dashboard_bloom_and_gaps_from_concept_mastery.sql';

function resolve(rel: string): string | null {
  for (const c of [path.resolve(process.cwd(), rel), path.resolve(process.cwd(), '..', rel)]) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}
function read(rel: string): string {
  const p = resolve(rel);
  return p ? fs.readFileSync(p, 'utf-8') : '';
}
/** Collapse whitespace + strip line comments so matching is layout-tolerant and
 *  never matches the RCA prose in the header comments. */
function normalised(rel: string): string {
  return read(rel)
    .replace(/^\s*--.*$/gm, '')
    .replace(/\s+/g, ' ');
}

// ───────────────────────────────────────────────────────────────────────────
describe('dashboard-data derivation — migration present', () => {
  it('the derivation migration exists', () => {
    expect(resolve(MIGRATION)).not.toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Signature + idempotency.
// ───────────────────────────────────────────────────────────────────────────
describe('get_dashboard_data — signature preserved + idempotent', () => {
  it('idempotency: DROP FUNCTION IF EXISTS the exact signature + CREATE OR REPLACE', () => {
    const sql = normalised(MIGRATION);
    expect(sql).toMatch(
      /DROP FUNCTION IF EXISTS public\.get_dashboard_data\(\s*p_student_id uuid\s*\)/i,
    );
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.get_dashboard_data/i);
  });

  it('preserves the signature (p_student_id uuid) RETURNS jsonb', () => {
    const sql = normalised(MIGRATION);
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.get_dashboard_data\(\s*p_student_id uuid\s*\)\s*RETURNS jsonb/i,
    );
  });

  it('hardening retained: SECURITY DEFINER + SET search_path', () => {
    const sql = normalised(MIGRATION);
    expect(sql).toMatch(/SECURITY DEFINER/i);
    expect(sql).toMatch(/SET search_path\s*=\s*'?public'?/i);
  });

  it('is student-scoped: looks the student up by p_student_id', () => {
    const sql = normalised(MIGRATION);
    expect(sql).toMatch(/FROM students WHERE id = p_student_id/i);
    // every derived read is keyed on the same student.
    expect(sql).toMatch(/WHERE\s+cm\.student_id\s*=\s*p_student_id/i);
  });

  it('preserves all ~11 top-level emitted keys', () => {
    const sql = normalised(MIGRATION);
    for (const key of [
      'profiles',
      'due_count',
      'unread_count',
      'knowledge_gaps',
      'velocity',
      'bloom',
      'cbse_readiness',
      'exams',
      'nudges',
      'retention_score',
      'error_breakdown',
    ]) {
      expect(sql, `missing top-level key '${key}'`).toMatch(new RegExp(`'${key}'`, 'i'));
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// bloom — single 7-key object derived from concept_mastery.bloom_mastery.
// ───────────────────────────────────────────────────────────────────────────
describe('bloom — derived from concept_mastery.bloom_mastery (single 7-key object)', () => {
  it('aggregates concept_mastery.bloom_mastery (references bloom_mastery + the 6 level keys)', () => {
    const sql = normalised(MIGRATION);
    expect(sql).toMatch(/FROM concept_mastery\s+cm/i);
    expect(sql).toMatch(/cm\.bloom_mastery/i);
    for (const key of ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create']) {
      expect(sql, `missing bloom key '${key}'`).toMatch(
        new RegExp(`bloom_mastery->>'${key}'`, 'i'),
      );
    }
  });

  it('emits the SINGLE-object 7-key shape (current_bloom_level + the 6 *_mastery levels)', () => {
    const sql = normalised(MIGRATION);
    // built as one object via jsonb_build_object, not an array per subject.
    expect(sql).toMatch(/'current_bloom_level'/i);
    for (const key of ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create']) {
      expect(sql, `missing '${key}_mastery' output field`).toMatch(
        new RegExp(`'${key}_mastery'`, 'i'),
      );
    }
  });

  it('current_bloom_level uses the >= 0.6 highest-level rule with a remember fallback', () => {
    const sql = normalised(MIGRATION);
    expect(sql).toMatch(/create_mastery\s*>=\s*0\.6\s+THEN\s+'create'/i);
    expect(sql).toMatch(/ELSE\s+'remember'/i);
  });

  it('does NOT read FROM the empty bloom_progression table', () => {
    const sql = normalised(MIGRATION);
    expect(sql).not.toMatch(/FROM\s+bloom_progression/i);
    expect(sql).not.toMatch(/FROM\s+public\.bloom_progression/i);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// knowledge_gaps — 5-field array derived from concept_mastery weak concepts.
// ───────────────────────────────────────────────────────────────────────────
describe('knowledge_gaps — derived weak concepts from concept_mastery (5-field array)', () => {
  it('derives from concept_mastery with the weakness filter (mastery_probability<0.5 OR error_count_conceptual>=2)', () => {
    const sql = normalised(MIGRATION);
    expect(sql).toMatch(/FROM concept_mastery\s+cm/i);
    expect(sql).toMatch(/cm\.mastery_probability\s*,?\s*0?\)?\s*<\s*0\.5/i);
    expect(sql).toMatch(/cm\.error_count_conceptual\s*,?\s*0?\)?\s*>=\s*2/i);
  });

  it('confidence_score = 1 - mastery_probability', () => {
    const sql = normalised(MIGRATION);
    expect(sql).toMatch(
      /\(\s*1\s*-\s*COALESCE\(\s*cm\.mastery_probability\s*,\s*0\s*\)\s*\).*?AS confidence_score/i,
    );
  });

  it('emits EXACTLY the 5-field shape { id, target_concept_name, missing_prerequisite_name, status, confidence_score }', () => {
    const sql = normalised(MIGRATION);
    for (const field of [
      'target_concept_name',
      'missing_prerequisite_name',
      'status',
      'confidence_score',
    ]) {
      expect(sql, `missing emitted field '${field}'`).toMatch(new RegExp(`AS ${field}`, 'i'));
    }
    // the 'id' field (topic_id AS id) is the 5th field.
    expect(sql).toMatch(/AS id/i);
    // status is the literal 'open' (mapping the prior inline status != 'resolved' domain).
    expect(sql).toMatch(/'open'(::text)?\s+AS status/i);
  });

  it('worst-first ordering + LIMIT (prior inline cap of 3)', () => {
    const sql = normalised(MIGRATION);
    expect(sql).toMatch(/ORDER BY\s+g\.confidence_score DESC/i);
    expect(sql).toMatch(/ORDER BY\s+COALESCE\(\s*cm\.mastery_probability\s*,\s*0\s*\)\s+ASC/i);
    expect(sql).toMatch(/LIMIT 3/i);
  });

  it('does NOT read FROM the empty knowledge_gaps table', () => {
    const sql = normalised(MIGRATION);
    expect(sql).not.toMatch(/FROM\s+knowledge_gaps/i);
    expect(sql).not.toMatch(/FROM\s+public\.knowledge_gaps/i);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Whole-migration posture: non-destructive + idempotent + no writes to the
// empty source tables.
// ───────────────────────────────────────────────────────────────────────────
describe('dashboard-data derivation — non-destructive + idempotent posture', () => {
  it('is strictly non-destructive — NO DROP TABLE / DROP COLUMN', () => {
    const sql = normalised(MIGRATION);
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/DROP\s+COLUMN/i);
  });

  it('does not write the empty source tables (no INSERT/UPDATE/DELETE on them)', () => {
    const sql = normalised(MIGRATION);
    expect(sql).not.toMatch(/INSERT INTO\s+(public\.)?bloom_progression/i);
    expect(sql).not.toMatch(/INSERT INTO\s+(public\.)?knowledge_gaps/i);
    expect(sql).not.toMatch(/UPDATE\s+(public\.)?bloom_progression/i);
    expect(sql).not.toMatch(/UPDATE\s+(public\.)?knowledge_gaps/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+(public\.)?bloom_progression/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+(public\.)?knowledge_gaps/i);
  });

  it('uses idempotent DROP FUNCTION IF EXISTS + CREATE OR REPLACE', () => {
    const sql = normalised(MIGRATION);
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION/i);
  });

  it('re-asserts the grant posture (anon revoked; authenticated + service_role granted)', () => {
    const sql = normalised(MIGRATION);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.get_dashboard_data\(uuid\) FROM anon/i);
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.get_dashboard_data\(uuid\) TO authenticated,?\s*service_role/i,
    );
  });
});
