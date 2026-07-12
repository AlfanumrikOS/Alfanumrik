import { describe, expect, it } from 'vitest';
import {
  getRoleManifest,
  resolveCapabilities,
  resolveExperienceV3Landing,
} from '@alfanumrik/lib/experience-v3';

describe('Experience V3 canonical landing resolver', () => {
  it('redirects only when the legacy alias and canonical home are both allowed', () => {
    const student = resolveCapabilities({ role: 'student', permissions: ['study_plan.view'] }).manifest;
    const operator = resolveCapabilities({ role: 'super-admin', permissions: ['system.audit'] }).manifest;

    expect(resolveExperienceV3Landing({ enabled: true, manifest: student, legacyPath: '/dashboard' }))
      .toEqual({ kind: 'redirect', href: '/today' });
    expect(resolveExperienceV3Landing({ enabled: true, manifest: operator, legacyPath: '/super-admin' }))
      .toEqual({ kind: 'redirect', href: '/super-admin/command' });
  });

  it('preserves flag-off and unmapped legacy routes', () => {
    const manifest = getRoleManifest('student');

    expect(resolveExperienceV3Landing({ enabled: false, manifest, legacyPath: '/dashboard' }))
      .toEqual({ kind: 'legacy' });
    expect(resolveExperienceV3Landing({ enabled: true, manifest, legacyPath: '/unmapped-deep-link' }))
      .toEqual({ kind: 'legacy' });
  });

  it('denies an enabled assignment when its canonical home is not authorized', () => {
    const manifest = resolveCapabilities({ role: 'student', permissions: [] }).manifest;

    expect(resolveExperienceV3Landing({ enabled: true, manifest, legacyPath: '/dashboard' }))
      .toEqual({ kind: 'denied' });
  });
});
