import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Analysis-surface derivation fix — STRUCTURAL pins
 * (always-on, runs in the NORMAL CI lane; no database required).
 *
 * Companion to the integration-lane e2e
 * (migrations/analysis-surfaces-derivation-e2e.test.ts). These pins grep the
 * migration SOURCE so the repoint cannot silently regress.
 *
 * THE BUG (RCA): get_bloom_progression + get_knowledge_gaps read FROM the
 * public.bloom_progression / public.knowledge_gaps tables, which the quiz/mastery
 * pipeline NEVER writes — so both RPCs always returned []. The progress page
 * (MasteryBloomPanel) and KnowledgeGapActions surfaces were therefore dead.
 *
 * THE FIX (one migration):
 *   - 20260623000700_derive_bloom_progression_and_knowledge_gaps_from_concept_mastery.sql
 *       Repoints BOTH RPCs to DERIVE from the populated public.concept_mastery
 *       (the single source of truth), preserving exact signatures + RETURNS jsonb
 *       + SECURITY DEFINER + search_path + student-scoped WHERE, and NEVER reading
 *       the empty bloom_progression / knowledge_gaps tables. No DROP TABLE/COLUMN.
 *       Idempotent: DROP FUNCTION IF EXISTS (exact signature) + CREATE OR REPLACE.
 *
 * THE BUGS THESE WOULD CATCH:
 *   - reverting either RPC to read FROM the empty bloom_progression / knowledge_gaps
 *     table (the dead-surface regression).
 *   - changing the preserved signature / RETURNS jsonb.
 *   - dropping SECURITY DEFINER / search_path / the student-scoped WHERE.
 *   - losing the confidence_score = 1 - mastery_probability contract.
 *   - losing the strict ">" severity thresholds (>0.7 critical, >0.4 high).
 *   - the 6 Bloom level keys drifting from concept_mastery.bloom_mastery.
 *   - the knowledge-gaps superset field set shrinking below what the consumers read.
 *   - the migration turning destructive (DROP TABLE/COLUMN) or losing idempotency.
 *
 * Mirrors the repo's grep-the-migration-file conformance style
 * (canonical-mastery-write-structure.test.ts, sm2-interval-clamp-structure.test.ts).
 */

const MIGRATION =
  'supabase/migrations/20260623000700_derive_bloom_progression_and_knowledge_gaps_from_concept_mastery.sql';

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

/** The two RPC bodies, isolated so per-RPC assertions don't bleed across the
 *  function boundary. Splits the normalised SQL at the get_knowledge_gaps DROP. */
function bloomBody(): string {
  const sql = normalised(MIGRATION);
  const split = sql.search(/DROP FUNCTION IF EXISTS public\.get_knowledge_gaps/i);
  return split === -1 ? sql : sql.slice(0, split);
}
function gapsBody(): string {
  const sql = normalised(MIGRATION);
  const split = sql.search(/DROP FUNCTION IF EXISTS public\.get_knowledge_gaps/i);
  return split === -1 ? '' : sql.slice(split);
}

// ───────────────────────────────────────────────────────────────────────────
describe('analysis-surface derivation — migration present', () => {
  it('the derivation migration exists', () => {
    expect(resolve(MIGRATION)).not.toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// RPC 1: get_bloom_progression — derive per-subject Bloom averages.
// ───────────────────────────────────────────────────────────────────────────
describe('get_bloom_progression — derives from concept_mastery.bloom_mastery', () => {
  it('idempotency: DROP FUNCTION IF EXISTS the exact signature + CREATE OR REPLACE', () => {
    const sql = normalised(MIGRATION);
    expect(sql).toMatch(
      /DROP FUNCTION IF EXISTS public\.get_bloom_progression\(\s*p_student_id uuid\s*,\s*p_subject text\s*\)/i,
    );
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.get_bloom_progression/i);
  });

  it('preserves the signature (p_student_id uuid, p_subject text DEFAULT NULL) RETURNS jsonb', () => {
    const body = bloomBody();
    expect(body).toMatch(/p_student_id uuid/i);
    expect(body).toMatch(/p_subject text DEFAULT NULL/i);
    expect(body).toMatch(/RETURNS jsonb/i);
  });

  it('hardening retained: SECURITY DEFINER + SET search_path', () => {
    const body = bloomBody();
    expect(body).toMatch(/SECURITY DEFINER/i);
    expect(body).toMatch(/SET search_path\s*=\s*'?public'?/i);
  });

  it('is student-scoped: WHERE cm.student_id = p_student_id', () => {
    const body = bloomBody();
    expect(body).toMatch(/WHERE\s+cm\.student_id\s*=\s*p_student_id/i);
  });

  it('aggregates concept_mastery.bloom_mastery (references bloom_mastery + the 6 level keys)', () => {
    const body = bloomBody();
    expect(body).toMatch(/FROM concept_mastery\s+cm/i);
    expect(body).toMatch(/cm\.bloom_mastery/i);
    for (const key of ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create']) {
      expect(body, `missing bloom key '${key}'`).toMatch(
        new RegExp(`bloom_mastery->>'${key}'`, 'i'),
      );
    }
    // each level surfaces as a *_mastery field.
    for (const key of ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create']) {
      expect(body, `missing '${key}_mastery' output field`).toMatch(
        new RegExp(`'${key}_mastery'`, 'i'),
      );
    }
  });

  it('does NOT read FROM the empty bloom_progression table', () => {
    const body = bloomBody();
    expect(body).not.toMatch(/FROM\s+bloom_progression/i);
    expect(body).not.toMatch(/FROM\s+public\.bloom_progression/i);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// RPC 2: get_knowledge_gaps — derive weak concepts from concept_mastery.
// ───────────────────────────────────────────────────────────────────────────
describe('get_knowledge_gaps — derives weak concepts from concept_mastery', () => {
  it('idempotency: DROP FUNCTION IF EXISTS the exact signature + CREATE OR REPLACE', () => {
    const sql = normalised(MIGRATION);
    expect(sql).toMatch(
      /DROP FUNCTION IF EXISTS public\.get_knowledge_gaps\(\s*p_student_id uuid\s*,\s*p_subject text\s*,\s*p_limit integer\s*\)/i,
    );
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.get_knowledge_gaps/i);
  });

  it('preserves the signature (p_student_id uuid, p_subject text, p_limit integer) RETURNS jsonb', () => {
    const body = gapsBody();
    expect(body).toMatch(/p_student_id uuid/i);
    expect(body).toMatch(/p_subject text DEFAULT NULL/i);
    expect(body).toMatch(/p_limit integer DEFAULT 10/i);
    expect(body).toMatch(/RETURNS jsonb/i);
  });

  it('hardening retained: SECURITY DEFINER + SET search_path + student-scoped WHERE', () => {
    const body = gapsBody();
    expect(body).toMatch(/SECURITY DEFINER/i);
    expect(body).toMatch(/SET search_path\s*=\s*'?public'?/i);
    expect(body).toMatch(/WHERE\s+cm\.student_id\s*=\s*p_student_id/i);
  });

  it('derives from concept_mastery with the weakness filter (mastery_probability<0.5 OR error_count_conceptual>=2)', () => {
    const body = gapsBody();
    expect(body).toMatch(/FROM concept_mastery\s+cm/i);
    expect(body).toMatch(/cm\.mastery_probability\s*,?\s*0?\)?\s*<\s*0\.5/i);
    expect(body).toMatch(/cm\.error_count_conceptual\s*,?\s*0?\)?\s*>=\s*2/i);
  });

  it('confidence_score = 1 - mastery_probability', () => {
    const body = gapsBody();
    expect(body).toMatch(/\(\s*1\s*-\s*COALESCE\(\s*cm\.mastery_probability\s*,\s*0\s*\)\s*\)\s+AS confidence_score/i);
  });

  it('severity uses strict ">" thresholds (>0.7 critical, >0.4 high, else medium)', () => {
    const body = gapsBody();
    expect(body).toMatch(/WHEN\s+w\.confidence_score\s*>\s*0\.7\s+THEN\s+'critical'/i);
    expect(body).toMatch(/WHEN\s+w\.confidence_score\s*>\s*0\.4\s+THEN\s+'high'/i);
    expect(body).toMatch(/ELSE\s+'medium'/i);
    // strict ">" — never ">=" on the thresholds.
    expect(body).not.toMatch(/w\.confidence_score\s*>=\s*0\.7/i);
    expect(body).not.toMatch(/w\.confidence_score\s*>=\s*0\.4/i);
  });

  it('worst-first ordering: ORDER BY mastery_probability ASC', () => {
    const body = gapsBody();
    expect(body).toMatch(/ORDER BY\s+COALESCE\(\s*cm\.mastery_probability\s*,\s*0\s*\)\s+ASC/i);
    expect(body).toMatch(/ORDER BY\s+w\.mastery_probability\s+ASC/i);
  });

  it('emits the consumer-superset fields', () => {
    const body = gapsBody();
    for (const field of [
      'target_concept_name',
      'missing_prerequisite_name',
      'detection_method',
      'confidence_score',
      'subject',
      'topic',
      'mastery_probability',
      'severity',
      'status',
      'detected_at',
    ]) {
      expect(body, `missing emitted field '${field}'`).toMatch(
        new RegExp(`'${field}'`, 'i'),
      );
    }
    // status is the literal 'open'.
    expect(body).toMatch(/'status'\s*,\s*'open'/i);
  });

  it('does NOT read FROM the empty knowledge_gaps table', () => {
    const body = gapsBody();
    expect(body).not.toMatch(/FROM\s+knowledge_gaps/i);
    expect(body).not.toMatch(/FROM\s+public\.knowledge_gaps/i);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Whole-migration posture: non-destructive + idempotent.
// ───────────────────────────────────────────────────────────────────────────
describe('analysis-surface derivation — non-destructive + idempotent posture', () => {
  it('is strictly non-destructive — NO DROP TABLE / DROP COLUMN', () => {
    const sql = normalised(MIGRATION);
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/DROP\s+COLUMN/i);
  });

  it('does not write the empty analysis tables (no INSERT/UPDATE/DELETE on them)', () => {
    const sql = normalised(MIGRATION);
    expect(sql).not.toMatch(/INSERT INTO\s+(public\.)?bloom_progression/i);
    expect(sql).not.toMatch(/INSERT INTO\s+(public\.)?knowledge_gaps/i);
    expect(sql).not.toMatch(/UPDATE\s+(public\.)?bloom_progression/i);
    expect(sql).not.toMatch(/UPDATE\s+(public\.)?knowledge_gaps/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+(public\.)?bloom_progression/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+(public\.)?knowledge_gaps/i);
  });

  it('uses idempotent DROP FUNCTION IF EXISTS + CREATE OR REPLACE for both RPCs', () => {
    const sql = normalised(MIGRATION);
    expect((sql.match(/DROP FUNCTION IF EXISTS/gi) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((sql.match(/CREATE OR REPLACE FUNCTION/gi) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
