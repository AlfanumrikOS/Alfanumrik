/**
 * Migration-shape pins for the 2026-07-03 adaptive-substrate repair pair
 * (house seed-shape canary pattern, mirroring REG-125):
 *
 *  1. `20260703000100_concept_edges_seed_from_concept_codes.sql` (Task 0.9)
 *     The original 20260702000100 backfill seeded 0 rows in prod because it
 *     UUID-regex-guarded concept_graph.prerequisite_codes while prod codes are
 *     HUMAN concept_code strings ('m7.integers.concept'), and the other two
 *     sources were empty. The corrected seed must:
 *       - target ON CONFLICT (from_topic_id, to_topic_id, edge_type, source)
 *         — the EXACT column set of the real unique index
 *         `concept_edges_unique_edge` (cross-checked against 20260702000100,
 *         not hardcoded on faith),
 *       - write BOTH namespaces: source='concept_graph' (concept_graph.id) and
 *         source='concept_graph_topic_projection' (curriculum_topics.id, the
 *         namespace Loop D / learner_twin_snapshots.mastery_by_topic uses),
 *       - normalize the legacy 'Grade 7' format in the SELECT only,
 *       - carry the HARD 2-cycle assertion (RAISE EXCEPTION on any A→B + B→A
 *         pair within the same source),
 *       - contain NO DELETE / DROP / UPDATE / TRUNCATE / ALTER — additive
 *         INSERT ... ON CONFLICT DO NOTHING only; sources are read-only.
 *
 *  2. `20260703000200_irt_calibrator_theta_repoint.sql` (Task 0.8)
 *     recalibrate_question_irt_2pl read theta from student_skill_state, which
 *     has 0 rows and NO writer → theta constantly 0 → VAR_POP = 0 → the
 *     variance gate skipped 100% of questions since 2026-04-28. The repoint
 *     must:
 *       - keep the function name/signature and repoint theta to
 *         student_learning_profiles.irt_theta joined on
 *         (student_id, subject) — quiz_responses.subject exists in the
 *         baseline, and student_learning_profiles has UNIQUE
 *         (student_id, subject) so the LEFT JOIN cannot fan out,
 *       - clamp theta: GREATEST(-4.0, LEAST(4.0, COALESCE(slp.irt_theta, 0))),
 *       - keep the IRLS bounds (a∈[0.3,3.0], b∈[-4,4]), the variance gate,
 *         min-attempts default 30, and per-question exception isolation,
 *       - leave NO student_skill_state reference in executable SQL,
 *       - grant EXECUTE to service_role ONLY (REVOKE ALL FROM PUBLIC and from
 *         anon/authenticated re-asserted),
 *       - never DROP FUNCTION (CREATE OR REPLACE only).
 *
 * Analysis runs on comment-stripped, string-blanked "structural" SQL (same
 * tokenizer approach as REG-125) so header comments that quote the OLD broken
 * SQL — or mention student_skill_state in the rollback story — cannot trip
 * the scanner, while string-literal contents cannot hide executable SQL.
 * Deterministic, no DB.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const MIGRATIONS_ROOT = resolve(process.cwd(), 'supabase/migrations');
const SEED_FILE = '20260703000100_concept_edges_seed_from_concept_codes.sql';
const REPOINT_FILE = '20260703000200_irt_calibrator_theta_repoint.sql';
const CONCEPT_EDGES_FILE = '20260702000100_concept_edges.sql';

// ---------------------------------------------------------------------------
// SQL text preprocessing (same tokenizer contract as REG-125)
// ---------------------------------------------------------------------------

interface PreprocessedSql {
  /** Comments removed; string literals kept verbatim. */
  noComments: string;
  /** Comments removed AND single-quoted string CONTENTS blanked to spaces. */
  structural: string;
}

function preprocess(raw: string): PreprocessedSql {
  let noComments = '';
  let structural = '';
  let state: 'code' | 'line' | 'block' | 'str' = 'code';
  let i = 0;
  const n = raw.length;
  while (i < n) {
    const c = raw[i];
    const d = i + 1 < n ? raw[i + 1] : '';
    if (state === 'code') {
      if (c === '-' && d === '-') {
        state = 'line';
        i += 2;
        continue;
      }
      if (c === '/' && d === '*') {
        state = 'block';
        i += 2;
        continue;
      }
      if (c === "'") {
        state = 'str';
        noComments += c;
        structural += c;
        i += 1;
        continue;
      }
      noComments += c;
      structural += c;
      i += 1;
      continue;
    }
    if (state === 'line') {
      if (c === '\n') {
        state = 'code';
        noComments += c;
        structural += c;
      }
      i += 1;
      continue;
    }
    if (state === 'block') {
      if (c === '*' && d === '/') {
        state = 'code';
        noComments += ' ';
        structural += ' ';
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    // state === 'str'
    if (c === "'" && d === "'") {
      noComments += "''";
      structural += '  ';
      i += 2;
      continue;
    }
    if (c === "'") {
      state = 'code';
      noComments += c;
      structural += c;
      i += 1;
      continue;
    }
    noComments += c;
    structural += c === '\n' ? '\n' : ' ';
    i += 1;
  }
  return { noComments, structural };
}

function loadMigration(file: string): PreprocessedSql & { raw: string } {
  const raw = readFileSync(join(MIGRATIONS_ROOT, file), 'utf8');
  return { raw, ...preprocess(raw) };
}

/** De-quoted, lower-cased column list of a parenthesized group. */
function parseColumnGroup(group: string): string[] {
  return group
    .split(',')
    .map((s) => s.trim().replace(/^"|"$/g, '').toLowerCase())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Source of truth: the real unique index on concept_edges (20260702000100)
// ---------------------------------------------------------------------------

function realUniqueEdgeColumns(): string[] {
  const { structural } = loadMigration(CONCEPT_EDGES_FILE);
  const m = structural.match(
    /create\s+unique\s+index\s+if\s+not\s+exists\s+concept_edges_unique_edge\s+on\s+(?:public\s*\.\s*)?concept_edges\s*\(([^)]+)\)/i,
  );
  expect(m, 'concept_edges_unique_edge index definition must exist in 20260702000100').not.toBeNull();
  return parseColumnGroup(m![1]);
}

// ---------------------------------------------------------------------------
// Migration 1 — concept_edges seed
// ---------------------------------------------------------------------------

describe(`${SEED_FILE} — concept_edges seed shape`, () => {
  it('exists at migrations root', () => {
    expect(existsSync(join(MIGRATIONS_ROOT, SEED_FILE))).toBe(true);
  });

  const seed = loadMigration(SEED_FILE);

  it('every ON CONFLICT target matches the REAL unique index columns exactly', () => {
    const indexCols = realUniqueEdgeColumns();
    expect(indexCols).toEqual(['from_topic_id', 'to_topic_id', 'edge_type', 'source']);

    const conflictRe = /on\s+conflict\s*\(([^)]+)\)\s*do\s+nothing/gi;
    const targets: string[][] = [];
    let m: RegExpExecArray | null;
    while ((m = conflictRe.exec(seed.structural)) !== null) {
      targets.push(parseColumnGroup(m[1]));
    }
    // One per backfill (A: concept_graph namespace, B: topic projection).
    expect(targets.length).toBeGreaterThanOrEqual(2);
    for (const target of targets) {
      expect(target, 'ON CONFLICT target must equal concept_edges_unique_edge columns').toEqual(indexCols);
    }
  });

  it('every INSERT into concept_edges is conflict-guarded (idempotent, re-runnable)', () => {
    const insertRe = /insert\s+into\s+(?:public\s*\.\s*)?concept_edges\b/gi;
    const inserts = seed.structural.match(insertRe) ?? [];
    expect(inserts.length).toBeGreaterThanOrEqual(2);
    const conflicts = seed.structural.match(/on\s+conflict\s*\([^)]+\)\s*do\s+nothing/gi) ?? [];
    expect(conflicts.length).toBe(inserts.length);
  });

  it('writes BOTH source tags: concept_graph AND concept_graph_topic_projection', () => {
    // Source tags are string literals — assert on comment-stripped text.
    expect(seed.noComments).toMatch(/'concept_graph'/);
    expect(seed.noComments).toMatch(/'concept_graph_topic_projection'/);
  });

  it('resolves prerequisites via concept_code (human codes), not a UUID regex cast', () => {
    expect(seed.structural).toMatch(/join\s+(?:public\s*\.\s*)?concept_graph\s+pre\s+on\s+pre\.concept_code\s*=\s*pc/i);
    // The original bug: pc::uuid behind a UUID-shape regex. Must not return.
    expect(seed.structural).not.toMatch(/pc\s*::\s*uuid/i);
    expect(seed.noComments).not.toMatch(/\[0-9a-f\]\{8\}/i);
  });

  it('projects into the curriculum_topics namespace via subjects.code with grade normalized in the SELECT only', () => {
    expect(seed.structural).toMatch(/join\s+(?:public\s*\.\s*)?subjects\s+s_dep\s+on\s+s_dep\.code\s*=\s*cg\.subject/i);
    expect(seed.structural).toMatch(/join\s+(?:public\s*\.\s*)?curriculum_topics\s+ct_dep/i);
    expect(seed.structural).toMatch(/join\s+(?:public\s*\.\s*)?curriculum_topics\s+ct_pre/i);
    // 'Grade 7' → '7' normalization (regex pattern lives in a string literal).
    expect(seed.noComments).toMatch(/regexp_replace\s*\(\s*cg\.grade\s*,\s*'\^Grade\\s\+'\s*,\s*''\s*\)/i);
    expect(seed.noComments).toMatch(/regexp_replace\s*\(\s*pre\.grade\s*,\s*'\^Grade\\s\+'\s*,\s*''\s*\)/i);
    expect(seed.structural).toMatch(/ct_dep\.chapter_number\s*=\s*cg\.chapter_number/i);
    expect(seed.structural).toMatch(/ct_pre\.chapter_number\s*=\s*pre\.chapter_number/i);
    // Self-edge exclusion in the projected namespace.
    expect(seed.structural).toMatch(/ct_pre\.id\s*<>\s*ct_dep\.id/i);
  });

  it('carries the HARD 2-cycle assertion (RAISE EXCEPTION on A→B + B→A within the same source)', () => {
    expect(seed.structural).toMatch(/raise\s+exception/i);
    expect(seed.structural).toMatch(/e2\.from_topic_id\s*=\s*e1\.to_topic_id/i);
    expect(seed.structural).toMatch(/e2\.to_topic_id\s*=\s*e1\.from_topic_id/i);
    expect(seed.structural).toMatch(/e2\.source\s*=\s*e1\.source/i);
  });

  it('reports unresolved prerequisite codes as WARNINGs (not silent, not fatal)', () => {
    expect(seed.structural).toMatch(/raise\s+warning/i);
    expect(seed.structural).toMatch(/not\s+exists\s*\(\s*select\s+1\s+from\s+(?:public\s*\.\s*)?concept_graph\s+pre\s+where\s+pre\.concept_code\s*=\s*pc/i);
  });

  it('is strictly additive: no DELETE / DROP / UPDATE / TRUNCATE / ALTER in executable SQL', () => {
    expect(seed.structural).not.toMatch(/\bdelete\b/i);
    expect(seed.structural).not.toMatch(/\bdrop\b/i);
    expect(seed.structural).not.toMatch(/\bupdate\b/i);
    expect(seed.structural).not.toMatch(/\btruncate\b/i);
    expect(seed.structural).not.toMatch(/\balter\b/i);
  });
});

// ---------------------------------------------------------------------------
// Migration 2 — IRT calibrator theta repoint
// ---------------------------------------------------------------------------

describe(`${REPOINT_FILE} — recalibrate_question_irt_2pl theta repoint`, () => {
  it('exists at migrations root', () => {
    expect(existsSync(join(MIGRATIONS_ROOT, REPOINT_FILE))).toBe(true);
  });

  const repoint = loadMigration(REPOINT_FILE);

  it('replaces the function in place (CREATE OR REPLACE, same name; never DROP FUNCTION)', () => {
    expect(repoint.structural).toMatch(/create\s+or\s+replace\s+function\s+recalibrate_question_irt_2pl\s*\(/i);
    expect(repoint.structural).not.toMatch(/drop\s+function/i);
    // Signature preserved: min-attempts default 30.
    expect(repoint.structural).toMatch(/p_min_attempts\s+int\s+default\s+30/i);
  });

  it('repoints theta to student_learning_profiles.irt_theta joined on (student_id, subject)', () => {
    expect(repoint.structural).toMatch(/left\s+join\s+student_learning_profiles\s+slp/i);
    expect(repoint.structural).toMatch(/slp\.student_id\s*=\s*r\.student_id/i);
    expect(repoint.structural).toMatch(/slp\.subject\s*=\s*r\.subject/i);
    expect(repoint.structural).toMatch(/from\s+quiz_responses\s+r/i);
  });

  it('clamps theta to ±4 with the 0 fallback: GREATEST(-4.0, LEAST(4.0, COALESCE(slp.irt_theta, 0)))', () => {
    expect(repoint.structural).toMatch(
      /greatest\s*\(\s*-4\.0\s*,\s*least\s*\(\s*4\.0\s*,\s*coalesce\s*\(\s*slp\.irt_theta\s*,\s*0\s*\)\s*\)\s*\)\s*::\s*numeric/i,
    );
  });

  it('leaves NO student_skill_state reference in the executable body', () => {
    // Header/rollback comments and string literals are stripped/blanked —
    // this asserts the dead table is gone from actual SQL.
    expect(repoint.structural).not.toMatch(/student_skill_state/i);
  });

  it('keeps the IRLS fit intact: bounds a∈[0.3,3.0] / b∈[-4,4], variance gate, exception isolation', () => {
    expect(repoint.structural).toMatch(/greatest\s*\(\s*least\s*\(\s*v_a\s*,\s*3\.0\s*\)\s*,\s*0\.3\s*\)/i);
    expect(repoint.structural).toMatch(/greatest\s*\(\s*least\s*\(\s*v_b\s*,\s*4\.0\s*\)\s*,\s*-4\.0\s*\)/i);
    // The variance gate is KEPT — with a live theta source it is a meaningful
    // degenerate-input guard, not the 100%-skip bug it used to amplify.
    expect(repoint.structural).toMatch(/v_theta_var\s*<\s*1e-6/i);
    expect(repoint.structural).toMatch(/exception\s+when\s+others\s+then/i);
    // Convergence loop bounds preserved.
    expect(repoint.structural).toMatch(/for\s+v_iter\s+in\s+1\.\.50\s+loop/i);
    expect(repoint.structural).toMatch(/v_max_delta\s*<\s*1e-4/i);
  });

  it('locks execution to service_role only', () => {
    expect(repoint.structural).toMatch(/revoke\s+all\s+on\s+function\s+recalibrate_question_irt_2pl\s*\(\s*uuid\s*,\s*int\s*\)\s+from\s+public/i);
    expect(repoint.structural).toMatch(/revoke\s+execute\s+on\s+function\s+recalibrate_question_irt_2pl\s*\(\s*uuid\s*,\s*int\s*\)\s+from\s+anon\s*,\s*authenticated/i);
    const grants = repoint.structural.match(/grant\s+execute\s+on\s+function[^;]+;/gi) ?? [];
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatch(/to\s+service_role/i);
    expect(grants[0]).not.toMatch(/authenticated|anon|public/i);
  });

  it('remains SECURITY DEFINER with a pinned search_path (documented cron-only posture)', () => {
    expect(repoint.structural).toMatch(/security\s+definer/i);
    expect(repoint.structural).toMatch(/set\s+search_path\s*=\s*public/i);
    // House rule: SECURITY DEFINER requires an in-file justification comment.
    expect(repoint.raw).toMatch(/SECURITY DEFINER justification/);
  });

  it('non-vacuity: the legacy body it replaces really did read student_skill_state', () => {
    const legacyPath = join(
      MIGRATIONS_ROOT,
      '_legacy/timestamped/20260428000400_irt_2pl_calibration_impl.sql',
    );
    expect(existsSync(legacyPath)).toBe(true);
    const legacy = preprocess(readFileSync(legacyPath, 'utf8'));
    expect(legacy.structural).toMatch(/left\s+join\s+student_skill_state\s+sss/i);
  });
});
