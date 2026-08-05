import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * REG-365 — K9 leadership read-model P13 boundary (Foxy North-Star Phase 5).
 *
 * The two SECURITY DEFINER RPCs in 20260813000005_leadership_readmodels.sql
 * power the school-admin leadership tiles. Their contract is COUNTS AND
 * AVERAGES ONLY — never a student_id, name, email, or disclosure_excerpt.
 * Widening the projection to include per-student rows would breach P13.
 * This structural pin freezes that contract at the SQL-body level so a
 * future "add drill-down" edit cannot silently leak identifiers.
 *
 * Static SQL-text pin (no live DB).
 */

const migrationsDir = join(process.cwd(), '..', '..', 'supabase', 'migrations');
const sql = readFileSync(
  join(migrationsDir, '20260813000005_leadership_readmodels.sql'),
  'utf8',
);

// Split the two function bodies so each assertion targets its own RPC.
function extractFunctionBody(name: string): string {
  const re = new RegExp(
    `CREATE OR REPLACE FUNCTION public\\.${name}[\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$;`,
  );
  const m = sql.match(re);
  if (!m) throw new Error(`function body not found: ${name}`);
  // Strip line comments so DESCRIPTIVE header text can't false-positive an
  // absence check.
  return m[1]
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
}

const safeguardingBody = extractFunctionBody('get_school_safeguarding_counts');
const competencyBody = extractFunctionBody('get_school_competency_summary');

describe('migration 20260813000005 — leadership read-model P13 pins', () => {
  it('both RPCs are SECURITY DEFINER with a locked search_path', () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.get_school_safeguarding_counts[\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path = public, pg_temp/,
    );
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.get_school_competency_summary[\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path = public, pg_temp/,
    );
  });

  it('both RPCs enforce a school-admin scope guard before any read', () => {
    expect(safeguardingBody).toMatch(
      /IF NOT EXISTS[\s\S]*?school_admins[\s\S]*?auth\.uid\(\)[\s\S]*?is_active[\s\S]*?RAISE EXCEPTION/,
    );
    expect(competencyBody).toMatch(
      /IF NOT EXISTS[\s\S]*?school_admins[\s\S]*?auth\.uid\(\)[\s\S]*?is_active[\s\S]*?RAISE EXCEPTION/,
    );
  });

  it('safeguarding RPC body NEVER selects student identifiers or disclosure text (P13)', () => {
    expect(safeguardingBody).not.toMatch(/\bstudent_id\b/i);
    expect(safeguardingBody).not.toMatch(/\bdisclosure_excerpt\b/i);
    expect(safeguardingBody).not.toMatch(/\bemail\b/i);
    expect(safeguardingBody).not.toMatch(/\bphone\b/i);
    expect(safeguardingBody).not.toMatch(/full_name|first_name|last_name/i);
    // Body must be counts-only: count(*) is the primary aggregation shape.
    expect(safeguardingBody).toMatch(/count\(\*\)/i);
  });

  it('competency RPC body NEVER selects student identifiers, names, or free-text joins (P13)', () => {
    // p_know / concept_mastery joins by student_id in the JOIN clause are OK
    // as an aggregation key, but the body must NEVER surface it in the SELECT
    // projection. The final SELECT builds a jsonb_build_object of counts and
    // averages — no per-student columns.
    expect(competencyBody).not.toMatch(/\bemail\b/i);
    expect(competencyBody).not.toMatch(/\bphone\b/i);
    expect(competencyBody).not.toMatch(/full_name|first_name|last_name/i);
    // The final jsonb_build_object must only expose the whitelisted aggregate
    // keys — no student-identifying key names.
    const finalObj = competencyBody.match(
      /jsonb_build_object\(([\s\S]*?)\)\s*INTO v_result;/,
    );
    expect(finalObj, 'final jsonb_build_object not found').toBeTruthy();
    const objBody = finalObj![1];
    expect(objBody).not.toMatch(/student_id/i);
    expect(objBody).not.toMatch(/student_name/i);
    // Whitelisted aggregate keys only.
    expect(objBody).toMatch(/roster_size/);
    expect(objBody).toMatch(/avg_mastery_now/);
    expect(objBody).toMatch(/retention_pct_30d/);
  });

  it('grants EXECUTE only to authenticated (scope guard does the rest); revokes anon + PUBLIC', () => {
    expect(sql).toMatch(
      /REVOKE ALL\s+ON FUNCTION public\.get_school_safeguarding_counts\(uuid\) FROM PUBLIC/,
    );
    expect(sql).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.get_school_safeguarding_counts\(uuid\) FROM anon/,
    );
    expect(sql).toMatch(
      /GRANT\s+EXECUTE ON FUNCTION public\.get_school_safeguarding_counts\(uuid\) TO authenticated/,
    );
    expect(sql).toMatch(
      /REVOKE ALL\s+ON FUNCTION public\.get_school_competency_summary\(uuid\) FROM PUBLIC/,
    );
    expect(sql).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.get_school_competency_summary\(uuid\) FROM anon/,
    );
    expect(sql).toMatch(
      /GRANT\s+EXECUTE ON FUNCTION public\.get_school_competency_summary\(uuid\) TO authenticated/,
    );
  });

  it('is additive-only: no DROP FUNCTION, no DROP TABLE/COLUMN', () => {
    const activeDdl = sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    expect(activeDdl).not.toMatch(/DROP FUNCTION/i);
    expect(activeDdl).not.toMatch(/DROP TABLE/i);
    expect(activeDdl).not.toMatch(/DROP COLUMN/i);
  });
});
