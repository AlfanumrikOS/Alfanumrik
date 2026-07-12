import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const MIGRATION =
  'supabase/migrations/20260712052203_enforce_one_experience_v3_flags_disabled.sql';
const FLAGS = [
  'ff_ui_v3_student',
  'ff_ui_v3_teacher',
  'ff_ui_v3_parent',
  'ff_ui_v3_school_admin',
  'ff_ui_v3_super_admin',
] as const;

const REPO_ROOT = [process.cwd(), resolve(process.cwd(), '../..')].find((candidate) =>
  existsSync(resolve(candidate, 'supabase/migrations')),
);
if (!REPO_ROOT) throw new Error('Repository root with supabase/migrations was not found');
const sql = readFileSync(resolve(REPO_ROOT, MIGRATION), 'utf8').replace(/\r/g, '');
const executableSql = sql
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

describe('One Experience V3 feature-flag enforcement migration', () => {
  it('is forward-only, transactional, and leaves schema privileges untouched', () => {
    expect(executableSql).toMatch(/^\s*BEGIN;/i);
    expect(executableSql).toMatch(/COMMIT;\s*$/i);
    expect(executableSql).not.toMatch(/\b(?:ALTER|CREATE|DROP)\s+(?:TABLE|POLICY)\b/i);
    expect(executableSql).not.toMatch(/\b(?:GRANT|REVOKE|DELETE|TRUNCATE)\b/i);
    expect(executableSql).not.toMatch(/\bSECURITY\s+DEFINER\b/i);
  });

  it('fails closed when the canonical feature_flags table is absent', () => {
    expect(executableSql).toMatch(
      /IF\s+to_regclass\s*\(\s*'public\.feature_flags'\s*\)\s+IS\s+NULL\s+THEN[\s\S]*?RAISE\s+EXCEPTION/i,
    );
    expect(executableSql).not.toMatch(/RAISE\s+NOTICE[\s\S]*feature_flags/i);
  });

  it('inserts every role flag explicitly disabled at zero rollout', () => {
    expect(executableSql).toMatch(
      /INSERT\s+INTO\s+public\.feature_flags\s*\(\s*flag_name\s*,\s*is_enabled\s*,\s*rollout_percentage\b/i,
    );
    for (const flag of FLAGS) {
      expect(executableSql).toMatch(new RegExp(`\\('${flag}',\\s*false,\\s*0,`, 'i'));
      expect((executableSql.match(new RegExp(`'${flag}'`, 'g')) ?? []).length).toBe(2);
    }
  });

  it('forces the same OFF/0 posture on conflict instead of preserving stale state', () => {
    expect(executableSql).toMatch(
      /ON\s+CONFLICT\s*\(\s*flag_name\s*\)\s+DO\s+UPDATE\s+SET[\s\S]*?is_enabled\s*=\s*false\s*,[\s\S]*?rollout_percentage\s*=\s*0/i,
    );
    expect(executableSql).not.toMatch(/ON\s+CONFLICT\s*\(\s*flag_name\s*\)\s+DO\s+NOTHING/i);
  });

  it('asserts all five rows are disabled at zero before committing', () => {
    expect(executableSql).toMatch(/compliant_flag_count\s*<>\s*5/i);
    expect(executableSql).toMatch(/is_enabled\s+IS\s+FALSE/i);
    expect(executableSql).toMatch(/rollout_percentage\s*=\s*0/i);
    expect(executableSql).toMatch(
      /IF\s+compliant_flag_count\s*<>\s*5\s+THEN[\s\S]*?RAISE\s+EXCEPTION/i,
    );
  });
});
