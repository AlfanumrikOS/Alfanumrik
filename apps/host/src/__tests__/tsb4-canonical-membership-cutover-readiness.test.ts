import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type CutoverStage = {
  id: string;
  state: 'landed' | 'planned' | 'decision_gated' | 'live_gated';
  action: string;
  evidence: string[];
  artifacts: string[];
};

type CutoverManifest = {
  generated_at: string;
  rcaItems: string[];
  canonicalTable: string;
  legacyTable: string;
  currentBoundaryReader: string;
  targetBoundaryReader: string;
  destructiveStepGate: string;
  stages: CutoverStage[];
};

const MANIFEST_REL = 'scripts/tsb4-canonical-membership-cutover.json';

function resolveRepo(rel: string): string | null {
  for (const candidate of [
    resolve(process.cwd(), rel),
    resolve(process.cwd(), '..', rel),
    resolve(process.cwd(), '..', '..', rel),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function readRepo(rel: string): string {
  const path = resolveRepo(rel);
  return path ? readFileSync(path, 'utf8').replace(/\r/g, '') : '';
}

function readJson<T>(rel: string): T {
  const path = resolveRepo(rel);
  expect(path, `${rel} should exist`).toBeTruthy();
  return JSON.parse(readFileSync(path!, 'utf8')) as T;
}

describe('TSB-4 canonical membership cutover readiness manifest', () => {
  it('records class_enrollments as the target and class_students as the current boundary risk', () => {
    const manifest = readJson<CutoverManifest>(MANIFEST_REL);

    expect(manifest.generated_at).toBe('2026-07-09');
    expect(manifest.rcaItems).toEqual(['RCA-03', 'RCA-21']);
    expect(manifest.canonicalTable).toBe('class_enrollments');
    expect(manifest.legacyTable).toBe('class_students');
    expect(manifest.currentBoundaryReader).toBe('packages/lib/src/rbac.ts:canAccessStudent');
    expect(manifest.targetBoundaryReader).toContain('packages/lib/src/rbac.ts:canAccessStudent');
    expect(manifest.targetBoundaryReader).toContain('packages/lib/src/domains/tenant.ts:listStudentsInClass');
    expect(manifest.destructiveStepGate).toMatch(/CEO-approved irreversible/i);
  });

  it('pins the required cutover stages in execution order', () => {
    const manifest = readJson<CutoverManifest>(MANIFEST_REL);
    const stageIds = manifest.stages.map((stage) => stage.id);

    expect(stageIds).toEqual([
      'soft-delete-sync-landed',
      'teacher-rls-and-fail-closed-backfill-landed',
      'dual-table-divergence-quantification',
      'boundary-reader-repoint',
      'route-helper-repoint',
      'live-tenant-smoke',
      'legacy-table-retirement',
    ]);

    expect(manifest.stages.find((stage) => stage.id === 'legacy-table-retirement')?.state).toBe(
      'decision_gated',
    );
    expect(manifest.stages.find((stage) => stage.id === 'live-tenant-smoke')?.state).toBe(
      'live_gated',
    );
  });

  it('cites artifacts that exist and evidence snippets that are still present', () => {
    const manifest = readJson<CutoverManifest>(MANIFEST_REL);

    for (const stage of manifest.stages) {
      expect(stage.action.trim().length, `${stage.id} action`).toBeGreaterThan(20);
      expect(stage.artifacts.length, `${stage.id} artifacts`).toBeGreaterThan(0);
      expect(stage.evidence.length, `${stage.id} evidence`).toBeGreaterThan(0);

      for (const artifact of stage.artifacts) {
        expect(resolveRepo(artifact), `${stage.id} artifact ${artifact}`).toBeTruthy();
      }

      const artifactText = stage.artifacts.map((artifact) => readRepo(artifact)).join('\n');
      for (const snippet of stage.evidence) {
        expect(artifactText, `${stage.id} evidence: ${snippet}`).toContain(snippet);
      }
    }
  });

  it('matches the current source truth: canAccessStudent and the tenant domain helper read class_enrollments', () => {
    const rbac = readRepo('packages/lib/src/rbac.ts');
    const tenantDomain = readRepo('packages/lib/src/domains/tenant.ts');

    const teacherPath = rbac.slice(
      rbac.indexOf('// Teacher: can access students in assigned classes'),
      rbac.indexOf('return false;', rbac.indexOf('// Teacher: can access students in assigned classes')),
    );

    expect(teacherPath).toContain(".from('class_enrollments')");
    expect(teacherPath).not.toContain(".from('class_students')");
    expect(tenantDomain).toContain(".from('class_enrollments')");
    expect(tenantDomain).toContain('Reads from the canonical');
  });
});
