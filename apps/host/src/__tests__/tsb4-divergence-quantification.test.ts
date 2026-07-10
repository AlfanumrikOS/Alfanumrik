import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function repoPath(rel: string): string {
  for (const candidate of [
    resolve(process.cwd(), rel),
    resolve(process.cwd(), '..', rel),
    resolve(process.cwd(), '..', '..', rel),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return resolve(process.cwd(), rel);
}

describe('TSB-4 class membership divergence quantification SQL', () => {
  it('provides a read-only report for both divergence directions before table retirement', () => {
    const sql = readFileSync(
      repoPath('scripts/tsb4-class-membership-divergence-quantification.sql'),
      'utf8',
    );

    expect(sql).toContain('TSB-4');
    expect(sql).toContain('direction_a_ce_inactive_cs_active');
    expect(sql).toContain('direction_b_ce_active_cs_inactive');
    expect(sql).toContain('class_enrollments_only');
    expect(sql).toContain('class_students_only');
    expect(sql).toContain('authorization_widening');
    expect(sql).toMatch(/COUNT\(\*\)::int\s+AS\s+pair_count/i);
    expect(sql).toMatch(/FROM\s+public\.class_enrollments/i);
    expect(sql).toMatch(/JOIN\s+public\.class_students/i);
    expect(sql).not.toMatch(/\b(update|insert|delete|drop|alter|truncate|create|grant|revoke)\b/i);
  });
});
