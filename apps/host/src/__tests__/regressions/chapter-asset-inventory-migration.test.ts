/**
 * Migration-shape pins for `20260703000300_chapter_asset_inventory.sql`
 * (Knowledge Intelligence Wave 1 Task 1.1 — the coverage-loop substrate:
 * chapter x dimension coverage rows on the cbse_syllabus SSoT).
 *
 * House seed-shape canary pattern (mirrors REG-125 /
 * concept-edges-seed-and-irt-theta-repoint.test.ts). Pins:
 *
 *  1. The dimension CHECK enumerates EXACTLY the 31 values of the
 *     educational-completeness model — no silent add/remove/rename.
 *  2. RLS is ENABLED in the SAME migration file (P8) with a deny-all
 *     policy scoped to anon, authenticated (service_role bypasses RLS —
 *     house service-role-only posture, cf. synthetic_monitor_results).
 *  3. UNIQUE (syllabus_id, dimension) — the upsert target for audit
 *     workers; one row per chapter x dimension.
 *  4. FK: syllabus_id → public.cbse_syllabus(id) ON DELETE CASCADE
 *     (verified against the baseline: cbse_syllabus_pkey is PRIMARY
 *     KEY ("id"), uuid).
 *  5. audit_method CHECK enumerates exactly the 5 provenance values.
 *  6. coverage_pct is bounded (NULL or 0..100).
 *  7. Strictly additive: no DROP / DELETE / UPDATE / TRUNCATE in
 *     executable SQL (the deny-all policy uses a DO-block
 *     duplicate_object guard, not DROP POLICY).
 *
 * Analysis runs on comment-stripped, string-blanked "structural" SQL
 * (same tokenizer contract as REG-125) so prose comments cannot trip the
 * scanner and string literals cannot hide executable SQL. The 31 CHECK
 * values themselves are string literals, so the enum pins assert on the
 * comment-stripped (noComments) text. Deterministic, no DB.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const MIGRATIONS_ROOT = resolve(process.cwd(), 'supabase/migrations');
const MIGRATION_FILE = '20260703000300_chapter_asset_inventory.sql';
const BASELINE_FILE = '00000000000000_baseline_from_prod.sql';

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

/** Extract the quoted values of an IN (...) list from comment-stripped SQL. */
function parseQuotedList(inList: string): string[] {
  const values: string[] = [];
  const re = /'([^']*)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inList)) !== null) values.push(m[1]);
  return values;
}

// ---------------------------------------------------------------------------
// The pinned 31-dimension educational-completeness model (order-exact)
// ---------------------------------------------------------------------------

const EXPECTED_DIMENSIONS = [
  'pages', 'headings', 'topics', 'subtopics', 'concepts',
  'learning_objectives', 'definitions', 'formulae',
  'examples', 'solved_examples', 'exercises', 'activities',
  'hots_questions', 'case_based_questions',
  'assertion_reason_questions', 'competency_questions',
  'common_mistakes', 'prerequisites',
  'concept_graph_links', 'real_world_applications',
  'tables', 'diagrams', 'image_explanations',
  'captions', 'summary', 'keywords', 'revision_notes',
  'mind_maps', 'flashcards', 'pyqs',
  'difficulty_mapping',
] as const;

const EXPECTED_AUDIT_METHODS = [
  'chunk_pass', 'pdf_verified', 'manual',
  'question_bank_scan', 'generated_content_scan',
] as const;

// ---------------------------------------------------------------------------
// Pins
// ---------------------------------------------------------------------------

describe(`${MIGRATION_FILE} — chapter_asset_inventory shape`, () => {
  it('exists at migrations root', () => {
    expect(existsSync(join(MIGRATIONS_ROOT, MIGRATION_FILE))).toBe(true);
  });

  const mig = loadMigration(MIGRATION_FILE);

  it('creates the table idempotently under public', () => {
    expect(mig.structural).toMatch(
      /create\s+table\s+if\s+not\s+exists\s+public\s*\.\s*chapter_asset_inventory\s*\(/i,
    );
  });

  it('non-vacuity: cbse_syllabus PK really is id uuid in the baseline', () => {
    const baselinePath = join(MIGRATIONS_ROOT, BASELINE_FILE);
    expect(existsSync(baselinePath)).toBe(true);
    const baseline = readFileSync(baselinePath, 'utf8');
    expect(baseline).toMatch(
      /ADD CONSTRAINT "cbse_syllabus_pkey" PRIMARY KEY \("id"\)/,
    );
    expect(baseline).toMatch(
      /CREATE TABLE IF NOT EXISTS "public"\."cbse_syllabus" \(\s*\n\s*"id" "uuid" DEFAULT "gen_random_uuid"\(\) NOT NULL/,
    );
  });

  it('FKs syllabus_id → public.cbse_syllabus(id) with ON DELETE CASCADE', () => {
    expect(mig.structural).toMatch(
      /syllabus_id\s+uuid\s+not\s+null\s+references\s+public\s*\.\s*cbse_syllabus\s*\(\s*id\s*\)\s+on\s+delete\s+cascade/i,
    );
  });

  it('dimension CHECK enumerates EXACTLY the 31 pinned values, in order', () => {
    // The values are string literals — parse from comment-stripped text.
    const m = mig.noComments.match(
      /dimension\s+text\s+not\s+null\s+constraint\s+chapter_asset_inventory_dimension_check\s+check\s*\(\s*dimension\s+in\s*\(([\s\S]*?)\)\)/i,
    );
    expect(m, 'dimension CHECK IN (...) must exist').not.toBeNull();
    const values = parseQuotedList(m![1]);
    expect(values).toEqual([...EXPECTED_DIMENSIONS]);
    expect(values).toHaveLength(31);
    // No duplicates.
    expect(new Set(values).size).toBe(31);
  });

  it('audit_method CHECK enumerates exactly the 5 provenance values', () => {
    const m = mig.noComments.match(
      /audit_method\s+text\s+not\s+null\s+constraint\s+chapter_asset_inventory_audit_method_check\s*\n?\s*check\s*\(\s*audit_method\s+in\s*\(([\s\S]*?)\)\)/i,
    );
    expect(m, 'audit_method CHECK IN (...) must exist').not.toBeNull();
    expect(parseQuotedList(m![1])).toEqual([...EXPECTED_AUDIT_METHODS]);
  });

  it('bounds coverage_pct to NULL or 0..100', () => {
    expect(mig.structural).toMatch(
      /coverage_pct\s+is\s+null\s+or\s*\(\s*coverage_pct\s*>=\s*0\s+and\s+coverage_pct\s*<=\s*100\s*\)/i,
    );
    expect(mig.structural).toMatch(/coverage_pct\s+numeric\s*\(\s*5\s*,\s*2\s*\)/i);
  });

  it('pins UNIQUE (syllabus_id, dimension) — one row per chapter x dimension', () => {
    expect(mig.structural).toMatch(
      /constraint\s+chapter_asset_inventory_syllabus_dimension_key\s+unique\s*\(\s*syllabus_id\s*,\s*dimension\s*\)/i,
    );
  });

  it('ENABLES RLS in the SAME migration (P8)', () => {
    expect(mig.structural).toMatch(
      /alter\s+table\s+public\s*\.\s*chapter_asset_inventory\s+enable\s+row\s+level\s+security/i,
    );
  });

  it('deny-all policy for anon + authenticated (service-role-only posture)', () => {
    const policy = mig.structural.match(
      /create\s+policy\s+"chapter_asset_inventory_deny_all"[\s\S]*?with\s+check\s*\(\s*false\s*\)/i,
    );
    expect(policy, 'deny-all policy must exist').not.toBeNull();
    const body = policy![0];
    expect(body).toMatch(/on\s+public\s*\.\s*chapter_asset_inventory/i);
    expect(body).toMatch(/for\s+all/i);
    expect(body).toMatch(/to\s+anon\s*,\s*authenticated/i);
    expect(body).toMatch(/using\s*\(\s*false\s*\)/i);
    // No permissive grant sneaks in beside the deny-all.
    expect(mig.structural).not.toMatch(/using\s*\(\s*true\s*\)/i);
    expect(mig.structural).not.toMatch(/\bgrant\b/i);
  });

  it('policy creation is idempotent via a duplicate_object guard (re-runnable)', () => {
    expect(mig.structural).toMatch(/exception\s+when\s+duplicate_object\s+then/i);
  });

  it('adds the gap-query index (dimension, coverage_pct) idempotently', () => {
    expect(mig.structural).toMatch(
      /create\s+index\s+if\s+not\s+exists\s+idx_chapter_asset_inventory_dimension_coverage\s+on\s+public\s*\.\s*chapter_asset_inventory\s*\(\s*dimension\s*,\s*coverage_pct\s*\)/i,
    );
  });

  it('documents the P13 evidence rule (IDs only, never content) in the comments', () => {
    // COMMENT ON ... IS '<literal>' — the rule lives in string literals,
    // so assert on comment-stripped text.
    expect(mig.noComments).toMatch(/comment\s+on\s+table\s+public\s*\.\s*chapter_asset_inventory/i);
    expect(mig.noComments).toMatch(
      /comment\s+on\s+column\s+public\s*\.\s*chapter_asset_inventory\s*\.\s*dimension/i,
    );
    expect(mig.noComments).toMatch(
      /comment\s+on\s+column\s+public\s*\.\s*chapter_asset_inventory\s*\.\s*evidence/i,
    );
    expect(mig.noComments.toLowerCase()).toContain('ids only');
  });

  it('is strictly additive: no DROP / DELETE / UPDATE / TRUNCATE in executable SQL', () => {
    expect(mig.structural).not.toMatch(/\bdrop\b/i);
    // `ON DELETE CASCADE` (FK action) is the only legitimate DELETE token;
    // forbid DELETE statements specifically.
    expect(mig.structural).not.toMatch(/\bdelete\s+from\b/i);
    expect(mig.structural.replace(/on\s+delete\s+cascade/gi, '')).not.toMatch(/\bdelete\b/i);
    expect(mig.structural).not.toMatch(/\bupdate\b/i);
    expect(mig.structural).not.toMatch(/\btruncate\b/i);
  });
});
