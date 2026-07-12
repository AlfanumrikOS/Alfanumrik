import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const deferredMigrationPath = resolve(
  REPO_ROOT,
  'supabase',
  'migrations',
  '20260712043958_teacher_remediation_open_status_dedupe.sql',
);
const assignedOnlyMigrationPath = resolve(
  REPO_ROOT,
  'supabase',
  'migrations',
  '20260619000400_teacher_remediation_dedupe_index.sql',
);
const routePath = resolve(
  REPO_ROOT,
  'apps',
  'host',
  'src',
  'app',
  'api',
  'teacher',
  'remediation',
  'route.ts',
);

describe('teacher remediation zero-downtime sequencing', () => {
  it('defers the data cleanup and all-open index migration from this release', () => {
    expect(existsSync(deferredMigrationPath)).toBe(false);

    const currentDatabaseContract = readFileSync(assignedOnlyMigrationPath, 'utf8');
    expect(currentDatabaseContract).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_teacher_remediation_assignments_open_dedupe[\s\S]*WHERE status = 'assigned'/i,
    );
  });

  it('deploys route compatibility before a future all-open database constraint', () => {
    const route = readFileSync(routePath, 'utf8');
    const insertErrorBlock = route.slice(
      route.indexOf('if (insertErr) {'),
      route.indexOf("logger.error('teacher_remediation_insert_failed'"),
    );

    expect(route).toContain("const OPEN_STATUSES = ['assigned', 'in_progress'] as const");
    expect(route).toContain("const OPEN_DEDUPE_INDEX = 'uq_teacher_remediation_assignments_open_dedupe'");
    expect(insertErrorBlock).toContain('isOpenAssignmentConflict(insertErr)');
    expect(insertErrorBlock).toContain('{ success: true, idempotent: true }');
    expect(insertErrorBlock).not.toContain(".eq('status', 'assigned')");
    expect(insertErrorBlock).not.toContain('survivorQuery');
  });
});
