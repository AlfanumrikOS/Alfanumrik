import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FLAG_DEFAULTS } from '@alfanumrik/lib/flags/defaults';

function repoPath(rel: string): string {
  const fromHost = resolve(process.cwd(), '..', '..', rel);
  if (existsSync(fromHost)) return fromHost;
  return resolve(process.cwd(), rel);
}

interface ProductSurfaceMatrixEntry {
  id: string;
  workflow: string;
  audience: 'student' | 'parent' | 'teacher' | 'school_admin' | 'super_admin';
  page: string;
  primaryCta: {
    label: string;
    targetPage?: string;
    targetApi?: string;
  };
  apis: string[];
  featureFlags: string[];
  dbWrites: string[];
  tests: string[];
  docs: string[];
  readiness: 'ready' | 'flagged' | 'blocked_external' | 'beta';
  owner: string;
}

describe('product surface matrix (RCA-12)', () => {
  it('maps core product journeys from page to CTA, API, flag, DB writes, tests, and docs', () => {
    expect(existsSync(repoPath('scripts/product-surface-matrix.json'))).toBe(true);

    const matrix = JSON.parse(
      readFileSync(repoPath('scripts/product-surface-matrix.json'), 'utf8'),
    ) as { surfaces: ProductSurfaceMatrixEntry[] };

    const required = [
      'student-today-home',
      'student-quiz-submit',
      'student-adaptive-tutor',
      'parent-glance',
      'parent-data-rights',
      'teacher-command-center',
      'teacher-remediation-comms',
      'school-admin-roster',
      'school-admin-billing-subscription',
      'school-pulse',
      'public-api-integrations',
      'super-admin-institutions-provisioning',
      'super-admin-pii-reports',
    ];
    expect(matrix.surfaces.length).toBeGreaterThanOrEqual(13);
    const ids = new Set(matrix.surfaces.map((entry) => entry.id));
    for (const id of required) {
      expect(ids.has(id), `${id} missing from product surface matrix`).toBe(true);
    }

    const knownFlags = new Set(Object.keys(FLAG_DEFAULTS));
    const validReadiness = new Set(['ready', 'flagged', 'blocked_external', 'beta']);

    for (const entry of matrix.surfaces) {
      expect(entry.workflow).toMatch(/\S/);
      expect(entry.owner).toMatch(/\S/);
      expect(validReadiness.has(entry.readiness), `${entry.id} has invalid readiness`).toBe(true);
      expect(existsSync(repoPath(entry.page)), `${entry.id} page missing: ${entry.page}`).toBe(true);
      expect(entry.primaryCta.label).toMatch(/\S/);
      expect(entry.primaryCta.targetApi || entry.primaryCta.targetPage).toBeTruthy();

      for (const api of entry.apis) {
        expect(existsSync(repoPath(api)), `${entry.id} API missing: ${api}`).toBe(true);
      }
      for (const flag of entry.featureFlags) {
        expect(knownFlags.has(flag), `${entry.id} references unregistered flag ${flag}`).toBe(true);
      }
      for (const testPath of entry.tests) {
        expect(existsSync(repoPath(testPath)), `${entry.id} test evidence missing: ${testPath}`).toBe(true);
      }
      for (const doc of entry.docs) {
        expect(existsSync(repoPath(doc)), `${entry.id} doc evidence missing: ${doc}`).toBe(true);
      }
      expect(entry.dbWrites.length).toBeGreaterThan(0);
    }
  });
});
